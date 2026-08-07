/**
 * Task #699: GoHighLevel Platinum Club cancel / trial-end webhook.
 *
 * The "VIP Club Cancelation" workflow in GoHighLevel fires when a
 * Platinum Club subscription is cancelled OR a free trial ends without
 * converting. Stripe's `customer.subscription.deleted` event handles
 * cancels eventually but can be late or missing for trial-end-without-
 * conversion / out-of-band cancels, so GHL POSTs here to revoke access
 * immediately.
 *
 * Scope: Platinum Club only (mirrors the scope note on the other GHL
 * webhooks). Flips `platinumPaid` and `upsell3Paid` back to false via
 * `revokeStripeOrderPaid()` so provenance is stamped, CHECK constraints
 * are respected, and the downstream side-effects (KIT/WATI refund
 * mirror) fire identically to the Stripe `subscription.deleted` path.
 *
 * Never touches `mainProductPaid` or any other entitlement.
 *
 * Auth: shared secret in `X-GHL-Webhook-Secret` header, constant-time
 * compared against `GHL_WEBHOOK_SECRET`. 503 if env var unset, 401 on
 * bad/missing secret. Idempotent: replay against an already-revoked
 * row returns 200 with `revoked.platinumPaid=false` / `upsell3Paid=false`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { eq, or, sql, type SQL } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, ordersTable } from "@workspace/db";
import { revokeStripeOrderPaid } from "../lib/stripe-paid-state";

const router: IRouter = Router();

const cancelBodySchema = z.object({
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

router.post(
  "/portal/ghl/platinum-cancel",
  async (req: Request, res: Response) => {
    const expected = process.env.GHL_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error(
        { event: "ghl_platinum_cancel_misconfigured" },
        "[ghl-platinum-cancel] GHL_WEBHOOK_SECRET not set; refusing request",
      );
      return res.status(503).json({ ok: false, error: "ghl_webhook_disabled" });
    }
    const presented =
      (req.header("x-ghl-webhook-secret") ?? req.header("x-webhook-secret") ?? "").trim();
    if (!presented || !constantTimeEquals(presented, expected)) {
      req.log.warn(
        { event: "ghl_platinum_cancel_unauthorized" },
        "[ghl-platinum-cancel] bad secret",
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

    const parsed = cancelBodySchema.safeParse(merged);
    if (!parsed.success) {
      req.log.warn(
        {
          event: "ghl_platinum_cancel_bad_request",
          issues: parsed.error.issues,
          bodyKeys: Object.keys(rawBody),
          mergedKeys: Object.keys(merged),
        },
        "[ghl-platinum-cancel] body validation failed",
      );
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        issues: parsed.error.issues,
        receivedKeys: Object.keys(rawBody),
      });
    }

    const { email, ghlContactId, stripeSubscriptionId, reason } = parsed.data;
    const reasonText = `ghl_platinum_cancel: ${reason ?? "vip_club_cancelation"}`;

    try {
      // Find every orders row currently carrying Platinum entitlement
      // for this buyer, either by lower(email) or by stripeSubscriptionId
      // when supplied. The OR on subscription id makes us resilient to
      // case/typo differences between the email GHL has and the email
      // on the orders row.
      const conds: SQL[] = [sql`lower(${ordersTable.email}) = lower(${email})`];
      if (stripeSubscriptionId) {
        conds.push(eq(ordersTable.stripeSubscriptionId, stripeSubscriptionId));
      }
      const matchExpr = conds.length === 1 ? conds[0]! : or(...conds)!;

      const candidates = await db
        .select({
          id: ordersTable.id,
          email: ordersTable.email,
          platinumPaid: ordersTable.platinumPaid,
          upsell3Paid: ordersTable.upsell3Paid,
        })
        .from(ordersTable)
        .where(
          sql`${matchExpr} AND (${ordersTable.platinumPaid} = true OR ${ordersTable.upsell3Paid} = true)`,
        );

      if (candidates.length === 0) {
        req.log.warn(
          {
            event: "ghl_platinum_cancel_no_match",
            email,
            ghlContactId: ghlContactId ?? null,
            stripeSubscriptionId: stripeSubscriptionId ?? null,
          },
          "[ghl-platinum-cancel] no orders with Platinum entitlement found",
        );
        return res.status(200).json({
          ok: true,
          email,
          ordersAffected: 0,
          revoked: { platinumPaid: false, upsell3Paid: false },
          alreadyRevoked: true,
        });
      }

      let platinumRevoked = false;
      let upsell3Revoked = false;
      let ordersAffected = 0;

      for (const c of candidates) {
        let touched = false;
        if (c.platinumPaid === true) {
          const r = await revokeStripeOrderPaid({
            orderId: c.id,
            paidField: "platinumPaid",
            reason: reasonText,
          });
          if (r.revoked) {
            platinumRevoked = true;
            touched = true;
          }
        }
        if (c.upsell3Paid === true) {
          const r = await revokeStripeOrderPaid({
            orderId: c.id,
            paidField: "upsell3Paid",
            reason: reasonText,
          });
          if (r.revoked) {
            upsell3Revoked = true;
            touched = true;
          }
        }
        if (touched) ordersAffected += 1;
      }

      const alreadyRevoked = ordersAffected === 0;

      req.log.info(
        {
          event: "ghl_platinum_cancel_ok",
          email,
          ghlContactId: ghlContactId ?? null,
          stripeSubscriptionId: stripeSubscriptionId ?? null,
          ordersAffected,
          platinumRevoked,
          upsell3Revoked,
          alreadyRevoked,
          candidateCount: candidates.length,
        },
        "[ghl-platinum-cancel] processed",
      );

      return res.status(200).json({
        ok: true,
        email,
        ordersAffected,
        revoked: {
          platinumPaid: platinumRevoked,
          upsell3Paid: upsell3Revoked,
        },
        alreadyRevoked,
      });
    } catch (err) {
      req.log.error(
        {
          event: "ghl_platinum_cancel_error",
          err: err instanceof Error ? err.message : String(err),
          email,
        },
        "[ghl-platinum-cancel] processing failed",
      );
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  },
);

export default router;
