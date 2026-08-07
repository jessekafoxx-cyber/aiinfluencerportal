/**
 * Task #662 (follow-up): GoHighLevel order bump 1 webhook.
 *
 * Companion to `/api/portal/ghl/enroll`. The AI Influencer Masterclass
 * funnel in GHL sells an additional order bump ("IG Follower / TikTok
 * Slideshow Masterclass", legacy slug `bump1`). A second GHL workflow
 * triggered by that bump's "Order Submitted" event POSTs here so the
 * backend can flip `orders.bump1_paid=true` on the buyer's existing
 * masterclass row.
 *
 * Pre-condition: the buyer's `orders` row already exists (the
 * masterclass enrollment webhook fires first; the bump1 workflow has a
 * 20s Wait step to make sure of it). This endpoint does NOT create
 * portal_users or send Clerk invites - the masterclass webhook already
 * did. It only flips the bump flag.
 *
 * Auth: same shared secret + header as `/portal/ghl/enroll`
 * (`X-GHL-Webhook-Secret` constant-time compared against
 * `GHL_WEBHOOK_SECRET`). 503 if env var unset.
 *
 * Idempotency: keyed off `orders.bump1_paid`. Replays return
 * `{ alreadyPaid: true, flipped: false }`. The bump's own GHL receipt
 * id is recorded on `orders.ghl_bump1_order_id` for audit.
 *
 * Scope: bump1 only. Bump2 / bump3 / upsells will each get their own
 * webhook path per the per-product convention (see ghl-webhook.ts).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, ordersTable } from "@workspace/db";

const router: IRouter = Router();

const grantBumpBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  ghlOrderId: z.string().trim().min(1).max(200),
  amountPaidCents: z.number().int().nonnegative().optional(),
});

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

router.post(
  "/portal/ghl/grant-bump1",
  async (req: Request, res: Response) => {
    const expected = process.env.GHL_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error(
        { event: "ghl_bump1_misconfigured" },
        "[ghl-bump1] GHL_WEBHOOK_SECRET not set; refusing request",
      );
      return res.status(503).json({ ok: false, error: "ghl_webhook_disabled" });
    }
    const presented =
      (req.header("x-ghl-webhook-secret") ?? req.header("x-webhook-secret") ?? "").trim();
    if (!presented || !constantTimeEquals(presented, expected)) {
      req.log.warn({ event: "ghl_bump1_unauthorized" }, "[ghl-bump1] bad secret");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Mirror the enroll webhook's wrapper-flattening + placeholder
    // scrubbing so the same handler accepts both flat and `customData`
    // wrapped GHL payloads.
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

    const parsed = grantBumpBodySchema.safeParse(merged);
    if (!parsed.success) {
      req.log.warn(
        {
          event: "ghl_bump1_bad_request",
          issues: parsed.error.issues,
          bodyKeys: Object.keys(rawBody),
          mergedKeys: Object.keys(merged),
        },
        "[ghl-bump1] body validation failed",
      );
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        issues: parsed.error.issues,
        receivedKeys: Object.keys(rawBody),
      });
    }

    const { email, ghlOrderId, amountPaidCents } = parsed.data;

    try {
      // Find the buyer's masterclass order row. It should always be the
      // newest paid row for this email (created by /portal/ghl/enroll
      // moments earlier). Tolerate the rare edge case where the row
      // doesn't exist yet (GHL fired faster than the 20s Wait) by
      // returning 409 so GHL can retry.
      const [existing] = await db
        .select()
        .from(ordersTable)
        .where(
          and(
            sql`lower(${ordersTable.email}) = lower(${email})`,
            eq(ordersTable.mainProductPaid, true),
          ),
        )
        .orderBy(sql`${ordersTable.createdAt} DESC NULLS LAST`)
        .limit(1);

      if (!existing) {
        req.log.warn(
          { event: "ghl_bump1_no_main_order", email, ghlOrderId },
          "[ghl-bump1] no paid masterclass order found for email; GHL may need to retry",
        );
        return res.status(409).json({
          ok: false,
          error: "no_masterclass_order",
          hint: "Masterclass enrollment has not landed yet; increase the GHL Wait or retry.",
        });
      }

      let alreadyPaid = false;
      let flipped = false;

      if (existing.bump1Paid === true) {
        alreadyPaid = true;
        // Stamp the bump receipt id if it was missing (back-fill for
        // rows flipped by a non-GHL path earlier).
        if (!existing.ghlBump1OrderId) {
          await db
            .update(ordersTable)
            .set({ ghlBump1OrderId: ghlOrderId, updatedAt: new Date() })
            .where(eq(ordersTable.id, existing.id));
        }
      } else {
        const result = await db
          .update(ordersTable)
          .set({
            bump1Paid: true,
            ghlBump1OrderId: ghlOrderId,
            totalAmount: (existing.totalAmount ?? 0) + (amountPaidCents ?? 0),
            updatedAt: new Date(),
          })
          .where(and(eq(ordersTable.id, existing.id), eq(ordersTable.bump1Paid, false)))
          .returning({ id: ordersTable.id });
        flipped = result.length > 0;
        if (!flipped) alreadyPaid = true;
      }

      req.log.info(
        {
          event: "ghl_bump1_ok",
          orderId: existing.id,
          ghlOrderId,
          email,
          alreadyPaid,
          flipped,
        },
        "[ghl-bump1] processed",
      );

      return res.status(200).json({
        ok: true,
        orderId: existing.id,
        alreadyPaid,
        flipped,
      });
    } catch (err) {
      req.log.error(
        {
          event: "ghl_bump1_error",
          err: err instanceof Error ? err.message : String(err),
          ghlOrderId,
          email,
        },
        "[ghl-bump1] processing failed",
      );
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  },
);

export default router;
