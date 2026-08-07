/**
 * Task #700: GoHighLevel Platinum Club reactivate webhook.
 *
 * Reverse of Task #699's cancel webhook. When a buyer reactivates a
 * cancelled Platinum sub OR converts a free trial after the fact (e.g.
 * support flips a flag in GHL, buyer pays an outstanding invoice in
 * GHL), GHL POSTs here to re-grant access immediately. Stripe's
 * `invoice.payment_succeeded` will eventually do the same via the
 * existing webhook safety net, but for GHL-driven reactivations the
 * portal stays locked until that fires - this endpoint closes the gap.
 *
 * Scope: Platinum Club only (mirrors the other GHL webhooks). Flips
 * `platinumPaid` (and `upsell3Paid` when the original entitlement came
 * through the upsell-3 / downsell-3 trial path, detected via
 * `productSlugs`) back to true via `markStripeOrderPaid()` so
 * provenance, FP event id persistence, CHECK constraints, KIT/WATI
 * tagging and per-flip side-effects all behave identically to the
 * Stripe `invoice.payment_succeeded` path.
 *
 * Never touches `mainProductPaid` or any other entitlement.
 *
 * Auth: shared secret in `X-GHL-Webhook-Secret`, constant-time compared
 * against `GHL_WEBHOOK_SECRET`. 503 if env var unset, 401 on bad/missing
 * secret. Idempotent: replay against an already-granted row returns 200
 * with `reactivated.platinumPaid=false` / `upsell3Paid=false`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { eq, or, sql, type SQL } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, ordersTable } from "@workspace/db";
import { markStripeOrderPaid } from "../lib/stripe-paid-state";

const router: IRouter = Router();

const reactivateBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  ghlContactId: z.string().trim().min(1).max(200).optional().nullable(),
  stripeSubscriptionId: z.string().trim().min(1).max(200).optional().nullable(),
  reason: z.string().trim().min(1).max(500).optional().nullable(),
});

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Decide which paid column(s) the order's `productSlugs` originally
 * carried. A row that was created from the funnel's upsell-3 or
 * downsell-3 trial flips `upsell3Paid`; a row created from the
 * standalone Platinum SKU flips `platinumPaid`. We re-grant exactly
 * the column(s) that match the buyer's original entitlement path so
 * `upsell3Paid` is never granted to a standalone-Platinum buyer.
 */
function paidFieldsForOrder(productSlugs: string | null): {
  grantUpsell3: boolean;
  grantPlatinum: boolean;
} {
  const slugs = (productSlugs ?? "").toLowerCase();
  const grantUpsell3 =
    slugs.includes("upsell3") ||
    slugs.includes("downsell3") ||
    slugs.includes("downsell-3");
  // Standalone Platinum requires an EXPLICIT platinum marker in the
  // order's productSlugs. We must NOT default to granting Platinum
  // for any order without a trial marker - a buyer who only ever
  // bought the main product (productSlugs="main", no Platinum
  // history) would otherwise be silently upgraded by this webhook.
  // Trial-path and standalone are mutually exclusive entitlement
  // columns (see "Platinum-only scope" gotcha): if the trial marker
  // is present, only re-grant `upsell3Paid`.
  const grantPlatinum = !grantUpsell3 && slugs.includes("platinum");
  return { grantUpsell3, grantPlatinum };
}

router.post(
  "/portal/ghl/platinum-reactivate",
  async (req: Request, res: Response) => {
    const expected = process.env.GHL_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error(
        { event: "ghl_platinum_reactivate_misconfigured" },
        "[ghl-platinum-reactivate] GHL_WEBHOOK_SECRET not set; refusing request",
      );
      return res.status(503).json({ ok: false, error: "ghl_webhook_disabled" });
    }
    const presented =
      (req.header("x-ghl-webhook-secret") ?? req.header("x-webhook-secret") ?? "").trim();
    if (!presented || !constantTimeEquals(presented, expected)) {
      req.log.warn(
        { event: "ghl_platinum_reactivate_unauthorized" },
        "[ghl-platinum-reactivate] bad secret",
      );
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Same wrapper-flattening + placeholder-scrubbing as the other GHL
    // webhooks so flat-body and Custom-Data-wrapped payloads both work.
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
    for (const k of Object.keys(merged)) {
      const v = merged[k];
      if (typeof v === "string" && /^\{\{[^}]+\}\}$/.test(v.trim())) {
        merged[k] = undefined;
      }
    }

    const parsed = reactivateBodySchema.safeParse(merged);
    if (!parsed.success) {
      req.log.warn(
        {
          event: "ghl_platinum_reactivate_bad_request",
          issues: parsed.error.issues,
          bodyKeys: Object.keys(rawBody),
          mergedKeys: Object.keys(merged),
        },
        "[ghl-platinum-reactivate] body validation failed",
      );
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        issues: parsed.error.issues,
        receivedKeys: Object.keys(rawBody),
      });
    }

    const { email, ghlContactId, stripeSubscriptionId, reason } = parsed.data;
    const reasonText = `ghl_platinum_reactivate: ${reason ?? "vip_club_reactivation"}`;

    try {
      // Match by lower(email) OR stripeSubscriptionId (when supplied)
      // so we are resilient to case/typo differences between the email
      // GHL has and the email on the orders row.
      const conds: SQL[] = [sql`lower(${ordersTable.email}) = lower(${email})`];
      if (stripeSubscriptionId) {
        conds.push(eq(ordersTable.stripeSubscriptionId, stripeSubscriptionId));
      }
      const matchExpr = conds.length === 1 ? conds[0]! : or(...conds)!;

      const candidates = await db
        .select({
          id: ordersTable.id,
          email: ordersTable.email,
          productSlugs: ordersTable.productSlugs,
          platinumPaid: ordersTable.platinumPaid,
          upsell3Paid: ordersTable.upsell3Paid,
          stripeCustomerId: ordersTable.stripeCustomerId,
          stripePaymentIntentId: ordersTable.stripePaymentIntentId,
          stripeSubscriptionId: ordersTable.stripeSubscriptionId,
          mainProductPaid: ordersTable.mainProductPaid,
        })
        .from(ordersTable)
        .where(
          // Defense-in-depth: only consider rows whose productSlugs
          // mention a Platinum/trial marker. `paidFieldsForOrder()`
          // also enforces this in code, but filtering at the SQL
          // level keeps a main-only buyer's order entirely out of
          // the candidate set so we cannot accidentally grant
          // Platinum to someone who never had it.
          sql`${matchExpr}
              AND ${ordersTable.mainProductPaid} = true
              AND (
                lower(${ordersTable.productSlugs}) LIKE '%upsell3%'
                OR lower(${ordersTable.productSlugs}) LIKE '%downsell3%'
                OR lower(${ordersTable.productSlugs}) LIKE '%downsell-3%'
                OR lower(${ordersTable.productSlugs}) LIKE '%platinum%'
              )`,
        );

      if (candidates.length === 0) {
        req.log.warn(
          {
            event: "ghl_platinum_reactivate_no_match",
            email,
            ghlContactId: ghlContactId ?? null,
            stripeSubscriptionId: stripeSubscriptionId ?? null,
          },
          "[ghl-platinum-reactivate] no orders found for buyer",
        );
        return res.status(200).json({
          ok: true,
          email,
          ordersAffected: 0,
          reactivated: { platinumPaid: false, upsell3Paid: false },
          alreadyActive: true,
        });
      }

      let platinumGranted = false;
      let upsell3Granted = false;
      let ordersAffected = 0;

      for (const c of candidates) {
        const fields = paidFieldsForOrder(c.productSlugs);
        let touched = false;

        if (fields.grantUpsell3 && c.upsell3Paid !== true) {
          const r = await markStripeOrderPaid({
            orderId: c.id,
            slug: "upsell3",
            source: "stripe_subscription_active",
            reason: reasonText,
            stripe: {
              customerId: c.stripeCustomerId,
              paymentIntentId: c.stripePaymentIntentId,
              subscriptionId: stripeSubscriptionId ?? c.stripeSubscriptionId,
            },
            amountCents: 0,
          });
          if (!r.alreadyPaid && r.flipped) {
            upsell3Granted = true;
            touched = true;
          }
        }

        if (fields.grantPlatinum && c.platinumPaid !== true) {
          const r = await markStripeOrderPaid({
            orderId: c.id,
            slug: "platinum_club",
            source: "stripe_subscription_active",
            reason: reasonText,
            stripe: {
              customerId: c.stripeCustomerId,
              paymentIntentId: c.stripePaymentIntentId,
              subscriptionId: stripeSubscriptionId ?? c.stripeSubscriptionId,
            },
            amountCents: 0,
          });
          if (!r.alreadyPaid && r.flipped) {
            platinumGranted = true;
            touched = true;
          }
        }

        if (touched) ordersAffected += 1;
      }

      const alreadyActive = ordersAffected === 0;

      req.log.info(
        {
          event: "ghl_platinum_reactivate_ok",
          email,
          ghlContactId: ghlContactId ?? null,
          stripeSubscriptionId: stripeSubscriptionId ?? null,
          ordersAffected,
          platinumGranted,
          upsell3Granted,
          alreadyActive,
          candidateCount: candidates.length,
        },
        "[ghl-platinum-reactivate] processed",
      );

      return res.status(200).json({
        ok: true,
        email,
        ordersAffected,
        reactivated: {
          platinumPaid: platinumGranted,
          upsell3Paid: upsell3Granted,
        },
        alreadyActive,
      });
    } catch (err) {
      req.log.error(
        {
          event: "ghl_platinum_reactivate_error",
          err: err instanceof Error ? err.message : String(err),
          email,
        },
        "[ghl-platinum-reactivate] processing failed",
      );
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  },
);

export default router;
