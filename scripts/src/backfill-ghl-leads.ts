/**
 * Backfill funnel_leads rows that never got pushed to GoHighLevel.
 *
 * Why this exists:
 *   The /api/funnel/lead route and the Stripe paid-flip both
 *   originally fired `void (async () => upsertGhlContact(...))()` for
 *   the GHL mirror. On serverless / short-lived request runtimes the
 *   runtime tears down the request context the moment `res.json()` is
 *   sent, so an in-flight `fetch` to GHL gets cancelled mid-call and
 *   the contact never lands. In a recent 48h audit, 24 of 35 leads
 *   (including 23 paid buyers) were silently missing from GHL because
 *   of this pattern. The live code paths are now bounded-awaited, but
 *   we still need a way to walk the table and re-push anything that
 *   slipped through during the dropped window.
 *
 * What it does:
 *   For every funnel_leads row in the lookback window that has
 *   `ghl_contact_id IS NULL`:
 *     1. Upsert the contact in GHL via /contacts/upsert.
 *     2. Cache the returned contact id back onto funnel_leads.
 *     3. If a matching paid main order exists (lower(email) join,
 *        main_product_paid=true), apply the "Purchased" +
 *        "purchased: ai influencer masterclass + dfy build" tags and
 *        remove "not-purchased", then stamp ghl_purchased_tagged_at.
 *     4. Else, if the row is >= 5 minutes old, apply "not-purchased"
 *        and stamp ghl_not_purchased_tagged_at.
 *     5. Else, leave the row alone (the not-purchased scheduler will
 *        pick it up once the 5-minute grace window elapses).
 *
 * How to run (one-shot, against prod):
 *   DATABASE_URL=$PROD_DATABASE_URL \
 *   GHL_API_KEY=... \
 *   GHL_LOCATION_ID=... \
 *   pnpm --filter @workspace/scripts run backfill:ghl-leads -- --hours=48
 *
 * Flags:
 *   --hours=<n>   lookback window in hours (default 48, max 720)
 *   --dry-run     print the worklist + plan without calling GHL or
 *                 mutating funnel_leads.
 *   --include-tagged
 *                 also re-process rows that already have a
 *                 ghl_contact_id but no ghl_purchased_tagged_at and
 *                 a paid order (useful if Stripe's paid flip dropped
 *                 the Purchased tag mid-fetch).
 *
 * Idempotent: GHL upsert is by-email, the tag endpoints are
 * idempotent (POST add / DELETE remove are no-ops if already in/out),
 * and the stamp UPDATEs guard on `IS NULL` so re-runs are safe.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, funnelLeadsTable, ordersTable } from "@workspace/db";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

// Canonical purchase tag - the ONLY tag applied on a paid main flip.
const TAG_PURCHASED_AI_INFLUENCER_MASTERCLASS =
  "ai influencer masterclass + dfy build";
// Legacy tags actively removed on every paid backfill so existing
// contacts get cleaned up over time.
const LEGACY_TAG_PURCHASED = "Purchased";
const LEGACY_TAG_PURCHASED_PREFIXED =
  "purchased: ai influencer masterclass + dfy build";
const TAG_NOT_PURCHASED = "not-purchased";
const NOT_PURCHASED_DELAY_MS = 5 * 60 * 1000;

interface Args {
  hours: number;
  dryRun: boolean;
  includeTagged: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let hours = 48;
  let dryRun = false;
  let includeTagged = false;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--include-tagged") includeTagged = true;
    else if (a.startsWith("--hours=")) {
      const v = parseInt(a.slice("--hours=".length), 10);
      if (Number.isFinite(v) && v > 0) hours = Math.min(v, 720);
    }
  }
  return { hours, dryRun, includeTagged };
}

function getConfig(): { apiKey: string; locationId: string } {
  const apiKey = process.env.GHL_API_KEY?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  if (!apiKey || !locationId) {
    throw new Error(
      "GHL_API_KEY and GHL_LOCATION_ID must both be set in the environment.",
    );
  }
  return { apiKey, locationId };
}

async function ghlFetch(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

interface WorkRow {
  id: number;
  email: string;
  firstName: string | null;
  phone: string | null;
  country: string | null;
  sourcePage: string | null;
  createdAt: Date;
  isPaid: boolean;
  ghlContactId: string | null;
  ghlPurchasedTaggedAt: Date | null;
  ghlNotPurchasedTaggedAt: Date | null;
}

async function loadWorklist(args: Args): Promise<WorkRow[]> {
  const cutoff = new Date(Date.now() - args.hours * 60 * 60 * 1000);

  const nullCondition = isNull(funnelLeadsTable.ghlContactId);
  const taggedButUnstampedPaidCondition = and(
    sql`${funnelLeadsTable.ghlContactId} IS NOT NULL`,
    isNull(funnelLeadsTable.ghlPurchasedTaggedAt),
    sql`EXISTS (
      SELECT 1 FROM ${ordersTable} o
      WHERE lower(o.email) = ${funnelLeadsTable.email}
        AND o.main_product_paid = true
    )`,
  );

  const where = and(
    sql`${funnelLeadsTable.createdAt} >= ${cutoff}`,
    args.includeTagged
      ? or(nullCondition, taggedButUnstampedPaidCondition)
      : nullCondition,
  );

  const rows = await db
    .select({
      id: funnelLeadsTable.id,
      email: funnelLeadsTable.email,
      firstName: funnelLeadsTable.firstName,
      phone: funnelLeadsTable.phone,
      country: funnelLeadsTable.country,
      sourcePage: funnelLeadsTable.sourcePage,
      createdAt: funnelLeadsTable.createdAt,
      ghlContactId: funnelLeadsTable.ghlContactId,
      ghlPurchasedTaggedAt: funnelLeadsTable.ghlPurchasedTaggedAt,
      ghlNotPurchasedTaggedAt: funnelLeadsTable.ghlNotPurchasedTaggedAt,
      isPaid: sql<boolean>`EXISTS (
        SELECT 1 FROM ${ordersTable} o
        WHERE lower(o.email) = ${funnelLeadsTable.email}
          AND o.main_product_paid = true
      )`,
    })
    .from(funnelLeadsTable)
    .where(where)
    .orderBy(funnelLeadsTable.createdAt);

  return rows as WorkRow[];
}

async function processRow(
  row: WorkRow,
  cfg: { apiKey: string; locationId: string },
  dryRun: boolean,
): Promise<{
  status: "ok" | "skipped_young" | "upsert_failed" | "no_contact_id";
  contactId: string | null;
  tagAction: string;
}> {
  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  const source = row.sourcePage
    ? `funnel:lead (${row.sourcePage})`
    : "funnel:lead";

  let contactId = row.ghlContactId;

  if (!contactId) {
    if (dryRun) {
      return { status: "ok", contactId: "DRY_RUN", tagAction: "(dry-run)" };
    }
    const body: Record<string, unknown> = {
      locationId: cfg.locationId,
      email: row.email,
      source,
    };
    if (row.firstName) body.firstName = row.firstName;
    if (row.phone) body.phone = row.phone;
    if (row.country) body.country = row.country;
    const up = await ghlFetch(cfg.apiKey, "/contacts/upsert", {
      method: "POST",
      body,
    });
    if (!up.ok) {
      console.warn(
        `[backfill] upsert failed id=${row.id} email=${row.email} status=${up.status} body=${up.text.slice(0, 200)}`,
      );
      return { status: "upsert_failed", contactId: null, tagAction: "(none)" };
    }
    contactId = up.json?.contact?.id ?? null;
    if (!contactId) {
      console.warn(
        `[backfill] upsert ok but no contact id id=${row.id} email=${row.email}`,
      );
      return { status: "no_contact_id", contactId: null, tagAction: "(none)" };
    }

    await db
      .update(funnelLeadsTable)
      .set({ ghlContactId: contactId, lastSeenAt: new Date() })
      .where(
        and(
          eq(funnelLeadsTable.id, row.id),
          isNull(funnelLeadsTable.ghlContactId),
        ),
      );
  }

  // Now apply tag based on paid status.
  let tagAction = "(none)";
  if (row.isPaid) {
    // Even if already stamped, run the legacy-tag REMOVE pass so
    // existing buyers get cleaned up. Re-run is idempotent (DELETE is
    // a no-op when the tag is absent). Only the canonical ADD is
    // gated on the one-shot stamp.
    if (!dryRun) {
      // Always clean up legacy tags + not-purchased.
      await ghlFetch(cfg.apiKey, `/contacts/${contactId}/tags`, {
        method: "DELETE",
        body: { tags: [LEGACY_TAG_PURCHASED] },
      });
      await ghlFetch(cfg.apiKey, `/contacts/${contactId}/tags`, {
        method: "DELETE",
        body: { tags: [LEGACY_TAG_PURCHASED_PREFIXED] },
      });
      await ghlFetch(cfg.apiKey, `/contacts/${contactId}/tags`, {
        method: "DELETE",
        body: { tags: [TAG_NOT_PURCHASED] },
      });
    }

    if (!row.ghlPurchasedTaggedAt) {
      if (!dryRun) {
        const addCanonical = await ghlFetch(
          cfg.apiKey,
          `/contacts/${contactId}/tags`,
          {
            method: "POST",
            body: { tags: [TAG_PURCHASED_AI_INFLUENCER_MASTERCLASS] },
          },
        );
        if (addCanonical.ok) {
          await db
            .update(funnelLeadsTable)
            .set({ ghlPurchasedTaggedAt: new Date() })
            .where(
              and(
                eq(funnelLeadsTable.id, row.id),
                isNull(funnelLeadsTable.ghlPurchasedTaggedAt),
              ),
            );
          tagAction = "+canonical (-legacy x3)";
        } else {
          console.warn(
            `[backfill] canonical tag-write failed id=${row.id} email=${row.email} status=${addCanonical.status} - leaving ghlPurchasedTaggedAt unstamped for retry`,
          );
          tagAction = "canonical FAILED (legacy cleaned)";
        }
      } else {
        tagAction = "+canonical (-legacy x3) [DRY]";
      }
    } else {
      tagAction = "(already stamped; legacy cleaned)";
    }
  } else if (ageMs >= NOT_PURCHASED_DELAY_MS) {
    if (!row.ghlNotPurchasedTaggedAt) {
      if (!dryRun) {
        const addNotPurchased = await ghlFetch(
          cfg.apiKey,
          `/contacts/${contactId}/tags`,
          { method: "POST", body: { tags: [TAG_NOT_PURCHASED] } },
        );
        if (addNotPurchased.ok) {
          await db
            .update(funnelLeadsTable)
            .set({ ghlNotPurchasedTaggedAt: new Date() })
            .where(
              and(
                eq(funnelLeadsTable.id, row.id),
                isNull(funnelLeadsTable.ghlNotPurchasedTaggedAt),
              ),
            );
          tagAction = "not-purchased";
        } else {
          console.warn(
            `[backfill] not-purchased tag-write failed id=${row.id} email=${row.email} status=${addNotPurchased.status} - leaving stamp for retry`,
          );
          tagAction = "not-purchased (tag-write FAILED - will retry)";
        }
      } else {
        tagAction = "not-purchased";
      }
    } else {
      tagAction = "(already tagged not-purchased)";
    }
  } else {
    return { status: "skipped_young", contactId, tagAction: "(<5min)" };
  }

  return { status: "ok", contactId, tagAction };
}

async function main() {
  const args = parseArgs();
  const cfg = getConfig();
  console.log(
    `[backfill] starting hours=${args.hours} dryRun=${args.dryRun} includeTagged=${args.includeTagged}`,
  );

  const rows = await loadWorklist(args);
  console.log(`[backfill] worklist: ${rows.length} row(s)`);
  if (rows.length === 0) {
    console.log("[backfill] nothing to do, exiting.");
    return;
  }

  const stats = {
    ok: 0,
    skipped_young: 0,
    upsert_failed: 0,
    no_contact_id: 0,
    paid: 0,
    not_purchased: 0,
  };

  for (const row of rows) {
    if (row.isPaid) stats.paid += 1;
    const result = await processRow(row, cfg, args.dryRun);
    stats[result.status] += 1;
    console.log(
      `[backfill] id=${row.id} email=${row.email} paid=${row.isPaid} -> ${result.status} contact=${result.contactId ?? "-"} tag="${result.tagAction}"`,
    );
    if (result.tagAction === "not-purchased") stats.not_purchased += 1;
    // Small pacing delay to avoid hammering GHL.
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[backfill] done. stats=${JSON.stringify(stats)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] fatal", err);
    process.exit(1);
  });
