/**
 * Task #662: GoHighLevel direct enrollment webhook.
 *
 * GoHighLevel now owns checkout / upsell / thank-you for the AI Influencer
 * Masterclass ($27 main offer). When a buyer completes purchase inside GHL,
 * GHL (or a Zapier zap targeting the same trigger) POSTs to this endpoint
 * and we:
 *
 *   1. Upsert a portal_users row by lower(email) so first/last name + phone
 *      land on the row immediately. Clerk id is filled in later, on first
 *      Clerk sign-in, by `ensurePortalUserForClerk()` claiming the
 *      lower(email) shell row (Task #505 invariant).
 *
 *   2. Upsert an `orders` row keyed `ghl:<ghlOrderId>` with:
 *        - main_product_paid = true
 *        - payment_source_type = 'ghl_verified_payment' (Task #662 enum
 *          extension; CHECK constraint enforced in migration 0064)
 *        - payment_verified = true, receipt_verified = true
 *        - ghl_order_id = the GHL receipt id (satisfies the
 *          receipt_verified-implies-receipt-id CHECK)
 *
 *   3. Fire `enrollPurchaserAndSendEmail()` so the buyer gets a Clerk
 *      invitation + branded welcome email pointing at /members/sign-up
 *      (or a "training unlocked" email if they already have a Clerk
 *      account). The email_logs dedupe inside that helper makes the
 *      whole webhook safe to retry.
 *
 * Auth: shared secret in `X-GHL-Webhook-Secret` header, constant-time
 * compared against `GHL_WEBHOOK_SECRET`. If the secret env var is unset
 * the endpoint returns 503 - never silently allow unauthenticated writes
 * to paid_* flags.
 *
 * Scope: this endpoint ONLY unlocks the AI Influencer Masterclass (the
 * $27 main bundle, mapped to `mainProductPaid=true`). Future upgrades
 * (DFY, Platinum, portal sidebar add-ons, high-ticket coaching) will
 * each get their own zap targeting their own webhook path so the
 * product->entitlement mapping stays explicit and auditable.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, ordersTable, portalUsersTable } from "@workspace/db";
import { provenanceFor } from "../lib/payment-provenance";
import { enrollPurchaserAndSendEmail } from "../lib/purchase-enrollment";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GHL Custom Data fields resolve to empty strings when the underlying
// contact field is blank (e.g. {{contact.last_name}} on a contact with no
// last name renders as ""), so every optional string here must accept
// "" / null / undefined interchangeably. Email is the only hard requirement.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().max(max).optional(),
  );

const enrollBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: optionalText(120),
  lastName: optionalText(120),
  phone: optionalText(40),
  // GHL invoice / contact / order id. Required for idempotency and to
  // satisfy the receipt-verified CHECK constraint. Free-form text from
  // GHL; we never parse it.
  ghlOrderId: z.string().trim().min(1).max(200),
  // Optional revenue stamp for reporting. If GHL is the source of truth
  // for the cart total, send it through; otherwise we leave totalAmount
  // at 0 and accounting reconciles from the GHL side.
  amountPaidCents: z.number().int().nonnegative().optional(),
  // Optional freeform reason for the audit trail / grant_reason column.
  reason: z.string().trim().min(1).max(200).optional(),
});

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

router.post(
  "/portal/ghl/enroll",
  async (req: Request, res: Response) => {
    const expected = process.env.GHL_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error(
        { event: "ghl_enroll_misconfigured" },
        "[ghl-enroll] GHL_WEBHOOK_SECRET not set; refusing request",
      );
      return res.status(503).json({ ok: false, error: "ghl_webhook_disabled" });
    }
    const presented =
      (req.header("x-ghl-webhook-secret") ?? req.header("x-webhook-secret") ?? "").trim();
    if (!presented || !constantTimeEquals(presented, expected)) {
      req.log.warn({ event: "ghl_enroll_unauthorized" }, "[ghl-enroll] bad secret");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // GoHighLevel sometimes nests Custom Data under `customData`,
    // `custom_data`, or `payload`/`data` wrappers depending on workflow
    // trigger type and version. Flatten any of those onto the root before
    // validating so the same handler accepts both shapes.
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const wrapperKeys = ["customData", "custom_data", "data", "payload"];
    const merged: Record<string, unknown> = { ...rawBody };
    for (const key of wrapperKeys) {
      const v = rawBody[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (merged[k] === undefined) merged[k] = val;
        }
      }
    }
    // GHL's `{{contact.*}}` tokens sometimes render as the literal
    // placeholder `{{contact.id}}` when the trigger lacks a contact
    // context (rare). Treat that as missing rather than a string.
    for (const k of Object.keys(merged)) {
      const v = merged[k];
      if (typeof v === "string" && /^\{\{[^}]+\}\}$/.test(v.trim())) {
        merged[k] = undefined;
      }
    }

    const parsed = enrollBodySchema.safeParse(merged);
    if (!parsed.success) {
      req.log.warn(
        {
          event: "ghl_enroll_bad_request",
          issues: parsed.error.issues,
          bodyKeys: Object.keys(rawBody),
          wrapperKeysFound: wrapperKeys.filter((k) => k in rawBody),
          mergedKeys: Object.keys(merged),
        },
        "[ghl-enroll] body validation failed",
      );
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        issues: parsed.error.issues,
        receivedKeys: Object.keys(rawBody),
      });
    }

    const { email, firstName, lastName, phone, ghlOrderId, amountPaidCents, reason } = parsed.data;
    const orderId = `ghl:${ghlOrderId}`;
    const reasonText = reason ?? "ghl_enroll_webhook:ai_influencer_masterclass";

    try {
      // -------- Step 1: upsert portal_users shell row by lower(email) ----
      // Mirrors `ensurePortalUserForClerk` step 2 but without a clerkId.
      // On first Clerk sign-in the email-claim path will attach the
      // clerkId to this same row.
      const [existingUser] = await db
        .select()
        .from(portalUsersTable)
        .where(sql`lower(${portalUsersTable.email}) = lower(${email})`)
        .limit(1);

      if (existingUser) {
        const updates: Partial<typeof portalUsersTable.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (firstName && !existingUser.firstName) updates.firstName = firstName;
        if (lastName && !existingUser.lastName) updates.lastName = lastName;
        if (!existingUser.orderId) updates.orderId = orderId;
        if (Object.keys(updates).length > 1) {
          await db
            .update(portalUsersTable)
            .set(updates)
            .where(eq(portalUsersTable.id, existingUser.id));
        }
      } else {
        // Buyer has a verified GHL payment - they MUST land active so
        // requireActive does not 403 them on first portal sign-in
        // (Task #745: "Clerk accounts stuck at isActive=false" repro).
        await db
          .insert(portalUsersTable)
          .values({
            email,
            firstName: firstName ?? null,
            lastName: lastName ?? null,
            portalKey: "room30",
            role: "user",
            isActive: true,
            orderId,
          })
          .onConflictDoNothing();
      }

      // -------- Step 2: upsert orders row, flip mainProductPaid ---------
      const [existingOrder] = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, orderId));

      const stamp = provenanceFor({
        source: "ghl_verified_payment",
        reason: reasonText,
        hasReceiptId: true,
      });

      let alreadyPaid = false;
      let flipped = false;

      if (existingOrder) {
        if (existingOrder.mainProductPaid === true) {
          alreadyPaid = true;
        } else {
          const result = await db
            .update(ordersTable)
            .set({
              mainProductPaid: true,
              totalAmount: (existingOrder.totalAmount ?? 0) + (amountPaidCents ?? 0),
              ghlOrderId,
              paymentSourceType: stamp.paymentSourceType,
              grantReason: stamp.grantReason,
              paymentVerified: stamp.paymentVerified,
              receiptVerified: stamp.receiptVerified,
              phone: existingOrder.phone ?? phone ?? null,
              updatedAt: new Date(),
            })
            .where(and(eq(ordersTable.id, orderId), eq(ordersTable.mainProductPaid, false)))
            .returning({ id: ordersTable.id });
          flipped = result.length > 0;
          if (!flipped) alreadyPaid = true;
        }
      } else {
        const inserted = await db
          .insert(ordersTable)
          .values({
            id: orderId,
            email,
            phone: phone ?? null,
            ghlOrderId,
            mainProductPaid: true,
            totalAmount: amountPaidCents ?? 0,
            currentStep: "thank-you",
            productSlugs: "main",
            paymentSourceType: stamp.paymentSourceType,
            grantReason: stamp.grantReason,
            paymentVerified: stamp.paymentVerified,
            receiptVerified: stamp.receiptVerified,
          })
          .onConflictDoNothing({ target: ordersTable.id })
          .returning({ id: ordersTable.id });
        flipped = inserted.length > 0;
        if (!flipped) alreadyPaid = true;
      }

      // -------- Step 3: Clerk invitation + welcome email ----------------
      // enrollPurchaserAndSendEmail is idempotent per (email, orderId)
      // via email_logs metadata.orderId so it is safe to call on
      // already-paid replays too - it'll just return status=skipped.
      const enroll = await enrollPurchaserAndSendEmail({
        email,
        orderId,
        portalKey: "room30",
        extraMetadata: {
          ghlOrderId,
          source: "ghl_verified_payment",
        },
      });

      // enrollPurchaserAndSendEmail can return { status: "failed" } on
      // Clerk invite / Resend errors without throwing. Surface that as a
      // non-2xx so GHL marks the execution row as Error and retries on
      // its own retry schedule, instead of silently 200ing while the
      // buyer never gets a portal account.
      if (enroll.status === "failed") {
        req.log.error(
          {
            event: "ghl_enroll_failed",
            orderId,
            ghlOrderId,
            email,
            alreadyPaid,
            flipped,
            enroll,
          },
          "[ghl-enroll] enrollment failed; returning 502 for GHL retry",
        );
        return res.status(502).json({
          ok: false,
          error: "enrollment_failed",
          orderId,
          alreadyPaid,
          flipped,
          enroll,
        });
      }

      // -------- Step 4: GHL tag mirror (purchase tag + cleanup) --------
      // Add the canonical "ai influencer masterclass + dfy build" tag
      // and remove "not-purchased" + legacy "Purchased" tags so the GHL
      // "Purchased - Follow Up" workflow fires for GHL-originated
      // purchases too. This mirrors the call in stripe-paid-state.ts
      // (markStripeOrderPaid) for the Stripe path.
      //
      // Only fires on a fresh flip (!alreadyPaid) so webhook replays
      // skip the tag calls entirely. tagGhlPurchased is also gated on
      // funnel_leads.ghl_purchased_tagged_at internally, so a replay
      // would be a no-op anyway - this just avoids 4 wasted GHL round
      // trips.
      //
      // Bounded-await at 2500ms (matches the Stripe path) so a flaky
      // GHL response can never hold up the 200 we owe GHL's workflow
      // runner. On timeout the tag write is dropped for this request;
      // `pnpm --filter @workspace/scripts run backfill:ghl-leads --
      // --hours=720 --include-tagged` catches any drops.
      if (!alreadyPaid) {
        try {
          const { tagGhlPurchased } = await import("../lib/ghl-sync");
          await Promise.race([
            tagGhlPurchased({
              email,
              firstName: firstName ?? null,
              phone: phone ?? null,
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 2500)),
          ]);
        } catch (err) {
          req.log.warn(
            {
              event: "ghl_enroll_tag_threw",
              err: err instanceof Error ? err.message : String(err),
              email,
            },
            "[ghl-enroll] tagGhlPurchased threw (already logged inside helper)",
          );
        }
      }

      req.log.info(
        {
          event: "ghl_enroll_ok",
          orderId,
          ghlOrderId,
          email,
          alreadyPaid,
          flipped,
          enroll,
        },
        "[ghl-enroll] processed",
      );

      return res.status(200).json({
        ok: true,
        orderId,
        alreadyPaid,
        flipped,
        enroll,
      });
    } catch (err) {
      req.log.error(
        {
          event: "ghl_enroll_error",
          err: err instanceof Error ? err.message : String(err),
          ghlOrderId,
          email,
        },
        "[ghl-enroll] processing failed",
      );
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  },
);

export default router;
