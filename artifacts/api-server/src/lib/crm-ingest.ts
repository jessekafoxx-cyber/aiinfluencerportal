import { asc, eq, sql } from "drizzle-orm";
import {
  db,
  crmContacts,
  crmPipelineStages,
  crmContactEvents,
} from "@workspace/db";
import { logger } from "./logger.js";

// Task #607 follow-on: small helper that mirrors what
// `POST /api/crm/webhook/contact` does, but invoked directly in-process
// from the lead-capture paths (`/funnel/lead`, `/stripe/create-checkout-
// intent`) so every funnel lead lands in the internal Sales CRM next to
// its KIT/WATI counterparts. Best-effort: every error is swallowed and
// logged - never blocks the buyer's redirect or checkout creation.
//
// Mirrors the upsert semantics of the webhook handler:
//  - first time we see an email -> insert into crm_contacts at the
//    "new" pipeline stage (or first stage if "new" is missing).
//  - re-submit -> patch only the columns the new submit actually
//    provided, preserving any prior CRM-edited values.
//
// Keep this in sync with crm.ts:/crm/webhook/contact handler. If the
// webhook grows extra fields, extend `CrmContactInput` here too.

export interface CrmContactInput {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  source?: string | null;
  valueCents?: number | null;
  notes?: string | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget upsert into crm_contacts. Returns silently on any
 * failure; callers should NOT await this in a way that surfaces errors
 * to the user. Call sites use `void enqueueCrmContact(...)` so the
 * promise rejects nowhere.
 */
export async function enqueueCrmContact(input: CrmContactInput): Promise<void> {
  const email = (input.email || "").trim();
  if (!email) return;
  const lower = email.toLowerCase();
  try {
    const stagesRows = await db
      .select()
      .from(crmPipelineStages)
      .orderBy(asc(crmPipelineStages.sortOrder));
    const newStage = stagesRows.find((s) => s.key === "new") ?? stagesRows[0];

    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(sql`lower(${crmContacts.email}) = ${lower}`)
      .limit(1);

    const now = new Date();
    if (existing) {
      await db
        .update(crmContacts)
        .set({
          phone: input.phone ?? existing.phone,
          firstName: input.firstName ?? existing.firstName,
          lastName: input.lastName ?? existing.lastName,
          company: input.company ?? existing.company,
          source: input.source ?? existing.source,
          valueCents:
            typeof input.valueCents === "number" && input.valueCents > 0
              ? input.valueCents
              : existing.valueCents,
          notes: input.notes ?? existing.notes,
          properties: input.properties ?? existing.properties,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(crmContacts.id, existing.id));
      return;
    }

    await db.insert(crmContacts).values({
      email,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      company: input.company ?? null,
      source: input.source ?? null,
      valueCents: typeof input.valueCents === "number" ? input.valueCents : 0,
      notes: input.notes ?? null,
      properties: input.properties ?? null,
      stageId: newStage?.id ?? null,
      lastActivityAt: now,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), email: lower },
      "[crm-ingest] enqueueCrmContact failed",
    );
  }
}

export interface CrmContactRefundInput {
  email: string;
  /** Short machine string e.g. "stripe_charge.refunded", "admin_revoke", "whop_refund_dfy". */
  reason: string;
  /** Optional human-readable detail (charge id, agreement id, admin email, etc). */
  detail?: string | null;
  /** Optional dollar amount refunded, in cents. */
  amountCents?: number | null;
  /** Origin of the revoke - "stripe_webhook" | "admin" | "whop_webhook" etc. */
  source?: string | null;
  /** Free-form extra payload stored on the crm_contact_events row. */
  payload?: Record<string, unknown> | null;
}

/**
 * Task #646 - fire-and-forget mirror of a refund / admin revoke back to
 * the internal Sales CRM. We do NOT move the contact off its current
 * stage (that would disrupt board layout) - instead we:
 *   - tag `properties.refunded = true` + `properties.refundedAt`
 *   - write a `refunded` row into `crm_contact_events` so the
 *     activity feed shows it
 *   - move the contact to a stage flagged `is_lost = true` (typically
 *     "lost") if one exists, so reps stop working it
 * Best-effort: every error is swallowed and logged. Callers should
 * `void markCrmContactRefunded(...)` so the webhook ack is never
 * blocked.
 */
export async function markCrmContactRefunded(
  input: CrmContactRefundInput,
): Promise<void> {
  const email = (input.email || "").trim();
  if (!email) return;
  const lower = email.toLowerCase();
  try {
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(sql`lower(${crmContacts.email}) = ${lower}`)
      .limit(1);
    if (!existing) {
      // No CRM row for this buyer - nothing to revoke. Skip silently;
      // the buyer was never tracked as a lead so reps cannot be working
      // a stale row.
      return;
    }

    const stagesRows = await db
      .select()
      .from(crmPipelineStages)
      .orderBy(asc(crmPipelineStages.sortOrder));
    const lostStage = stagesRows.find((s) => s.isLost) ?? null;

    const now = new Date();
    const prevProps =
      (existing.properties as Record<string, unknown> | null | undefined) ?? {};
    const mergedProps: Record<string, unknown> = {
      ...prevProps,
      refunded: true,
      refundedAt: now.toISOString(),
      refundReason: input.reason,
      ...(input.detail ? { refundDetail: input.detail } : {}),
      ...(typeof input.amountCents === "number"
        ? { refundAmountCents: input.amountCents }
        : {}),
    };

    await db
      .update(crmContacts)
      .set({
        properties: mergedProps,
        stageId: lostStage?.id ?? existing.stageId,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(crmContacts.id, existing.id));

    try {
      await db.insert(crmContactEvents).values({
        contactId: existing.id,
        eventName: "refunded",
        source: input.source ?? null,
        payload: {
          reason: input.reason,
          detail: input.detail ?? null,
          amountCents:
            typeof input.amountCents === "number" ? input.amountCents : null,
          ...(input.payload ?? {}),
        },
      });
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          email: lower,
          contactId: existing.id,
        },
        "[crm-ingest] markCrmContactRefunded event insert failed",
      );
    }
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        email: lower,
        reason: input.reason,
      },
      "[crm-ingest] markCrmContactRefunded failed",
    );
  }
}
