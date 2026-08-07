/**
 * Task #662 (follow-up): GoHighLevel grant webhooks for bump2, bump3,
 * upsell1, upsell2, upsell3, downsell1, downsell3.
 *
 * Generic per-product companion to /api/portal/ghl/grant-bump1
 * (`ghl-bump1-webhook.ts`). Each route flips one `*_paid` boolean on
 * the buyer's existing `orders` row and stamps the originating GHL
 * receipt id into the matching `ghl_*_order_id` column. The bump1
 * file is intentionally NOT collapsed into this one - it shipped on
 * its own (migration 0065) and is the canonical reference any future
 * agent will read.
 *
 * Pre-condition: the buyer's `orders` row already exists, created by
 * `/api/portal/ghl/enroll` when the main masterclass purchase fired.
 * Each per-product GHL workflow should include a small Wait step
 * before POSTing here so it lands after the enroll webhook. If the
 * row hasn't landed yet we return 409 so GHL retries.
 *
 * Mutual exclusion: the `grant-downsell3` route flips the SHARED
 * `upsell3Paid` flag (see replit.md - the downsell-3 cart slug maps
 * to its own catalog entry but flips upsell3Paid). The receipt id is
 * stored separately on `ghl_downsell3_order_id` so we can tell which
 * path the buyer took during audits.
 *
 * Auth: shared secret in `X-GHL-Webhook-Secret` header, constant-
 * time compared against `GHL_WEBHOOK_SECRET`. 503 when env var unset.
 *
 * Idempotency: keyed off the target `*_paid` column. Replays return
 * `{ alreadyPaid: true, flipped: false }`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, ordersTable } from "@workspace/db";

const router: IRouter = Router();

const grantBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  ghlOrderId: z.string().trim().min(1).max(200),
  amountPaidCents: z.number().int().nonnegative().optional(),
});

type PaidField =
  | "bump2Paid"
  | "bump3Paid"
  | "upsell1Paid"
  | "upsell2Paid"
  | "upsell3Paid"
  | "downsell1Paid"
  | "doneForYouPackPaid";

type ReceiptField =
  | "ghlBump2OrderId"
  | "ghlBump3OrderId"
  | "ghlUpsell1OrderId"
  | "ghlUpsell2OrderId"
  | "ghlUpsell3OrderId"
  | "ghlDownsell1OrderId"
  | "ghlDownsell3OrderId";

interface GrantConfig {
  path: string;
  logTag: string;
  paidField: PaidField;
  receiptField: ReceiptField;
  // Optional sibling boolean column flipped to true alongside
  // `paidField`. Used for downsell-1 -> doneForYouPackPaid so the
  // $97 funnel DFY Pack buyer unlocks the same DFY content that
  // the $197 portal sidebar add-on grants. No receipt-id slot
  // because we already stamp the GHL receipt on `receiptField`.
  secondaryPaidField?: PaidField;
}

const GRANTS: GrantConfig[] = [
  { path: "/portal/ghl/grant-bump2", logTag: "ghl_bump2", paidField: "bump2Paid", receiptField: "ghlBump2OrderId" },
  { path: "/portal/ghl/grant-bump3", logTag: "ghl_bump3", paidField: "bump3Paid", receiptField: "ghlBump3OrderId" },
  { path: "/portal/ghl/grant-upsell1", logTag: "ghl_upsell1", paidField: "upsell1Paid", receiptField: "ghlUpsell1OrderId" },
  { path: "/portal/ghl/grant-upsell2", logTag: "ghl_upsell2", paidField: "upsell2Paid", receiptField: "ghlUpsell2OrderId" },
  { path: "/portal/ghl/grant-upsell3", logTag: "ghl_upsell3", paidField: "upsell3Paid", receiptField: "ghlUpsell3OrderId" },
  // downsell-1 is the $97 discounted DFY Pack. Flip the sibling
  // doneForYouPackPaid flag too so the buyer unlocks DFY content
  // immediately - the DFY content gate in dfy.ts only checks
  // doneForYouPackPaid. (Historical downsell-1 buyers had this
  // gap and were granted manually.)
  {
    path: "/portal/ghl/grant-downsell1",
    logTag: "ghl_downsell1",
    paidField: "downsell1Paid",
    receiptField: "ghlDownsell1OrderId",
    secondaryPaidField: "doneForYouPackPaid",
  },
  // downsell3 flips the SHARED upsell3Paid flag but stamps its own receipt id.
  { path: "/portal/ghl/grant-downsell3", logTag: "ghl_downsell3", paidField: "upsell3Paid", receiptField: "ghlDownsell3OrderId" },
];

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function makeHandler(cfg: GrantConfig) {
  return async (req: Request, res: Response) => {
    const expected = process.env.GHL_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error(
        { event: `${cfg.logTag}_misconfigured` },
        `[${cfg.logTag}] GHL_WEBHOOK_SECRET not set; refusing request`,
      );
      return res.status(503).json({ ok: false, error: "ghl_webhook_disabled" });
    }
    const presented =
      (req.header("x-ghl-webhook-secret") ?? req.header("x-webhook-secret") ?? "").trim();
    if (!presented || !constantTimeEquals(presented, expected)) {
      req.log.warn({ event: `${cfg.logTag}_unauthorized` }, `[${cfg.logTag}] bad secret`);
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Mirror enroll/bump1: flatten the standard GHL wrapper keys and
    // scrub literal `{{placeholder}}` strings so workflows where the
    // contact field was empty don't fail validation.
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

    const parsed = grantBodySchema.safeParse(merged);
    if (!parsed.success) {
      req.log.warn(
        {
          event: `${cfg.logTag}_bad_request`,
          issues: parsed.error.issues,
          bodyKeys: Object.keys(rawBody),
          mergedKeys: Object.keys(merged),
        },
        `[${cfg.logTag}] body validation failed`,
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
          { event: `${cfg.logTag}_no_main_order`, email, ghlOrderId },
          `[${cfg.logTag}] no paid masterclass order found for email; GHL may need to retry`,
        );
        return res.status(409).json({
          ok: false,
          error: "no_masterclass_order",
          hint: "Masterclass enrollment has not landed yet; increase the GHL Wait or retry.",
        });
      }

      const paidCol = ordersTable[cfg.paidField];
      const receiptCol = ordersTable[cfg.receiptField];
      const alreadyTrue = existing[cfg.paidField] === true;
      const existingReceipt = existing[cfg.receiptField] as string | null | undefined;
      const secondaryAlreadyTrue =
        cfg.secondaryPaidField != null && existing[cfg.secondaryPaidField] === true;

      let alreadyPaid = false;
      let flipped = false;
      let secondaryFlipped = false;

      if (alreadyTrue) {
        alreadyPaid = true;
        // Back-fill the receipt id if a non-GHL path flipped this
        // flag earlier (e.g. legacy Whop or manual admin grant).
        // Also back-fill the sibling entitlement flag for the same
        // reason - legacy downsell-1 rows pre-dating this webhook
        // never had doneForYouPackPaid set, so the buyer needs the
        // back-fill to actually see DFY content.
        const backfill: Record<string, unknown> = {};
        if (!existingReceipt) backfill[cfg.receiptField] = ghlOrderId;
        if (cfg.secondaryPaidField && !secondaryAlreadyTrue) {
          backfill[cfg.secondaryPaidField] = true;
          secondaryFlipped = true;
        }
        if (Object.keys(backfill).length > 0) {
          backfill.updatedAt = new Date();
          await db
            .update(ordersTable)
            .set(backfill)
            .where(eq(ordersTable.id, existing.id));
        }
      } else {
        // Use a SQL-level increment for total_amount so concurrent
        // grant webhooks for different products on the same order
        // can't clobber each other with a stale `existing` read.
        // The paid-flag guard (`paid_col = false`) still prevents a
        // duplicate flip + double increment for the same product.
        const inc = amountPaidCents ?? 0;
        const setPayload: Record<string, unknown> = {
          [cfg.paidField]: true,
          [cfg.receiptField]: ghlOrderId,
          totalAmount: sql`COALESCE(${ordersTable.totalAmount}, 0) + ${inc}`,
          updatedAt: new Date(),
        };
        // Flip the sibling entitlement flag in the same UPDATE so the
        // buyer gets both the funnel-flag (e.g. downsell1Paid) and the
        // content gate (e.g. doneForYouPackPaid) atomically.
        if (cfg.secondaryPaidField) {
          setPayload[cfg.secondaryPaidField] = true;
        }
        const result = await db
          .update(ordersTable)
          .set(setPayload)
          .where(and(eq(ordersTable.id, existing.id), eq(paidCol, false)))
          .returning({ id: ordersTable.id });
        flipped = result.length > 0;
        if (!flipped) {
          // Lost the race - another concurrent webhook flipped it
          // first. Treat as already paid for idempotency.
          alreadyPaid = true;
          // Best-effort: stamp our receipt id if still missing.
          const [post] = await db
            .select({ receipt: receiptCol })
            .from(ordersTable)
            .where(eq(ordersTable.id, existing.id))
            .limit(1);
          if (post && !post.receipt) {
            await db
              .update(ordersTable)
              .set({ [cfg.receiptField]: ghlOrderId, updatedAt: new Date() })
              .where(eq(ordersTable.id, existing.id));
          }
        }
      }

      req.log.info(
        {
          event: `${cfg.logTag}_ok`,
          orderId: existing.id,
          ghlOrderId,
          email,
          alreadyPaid,
          flipped,
        },
        `[${cfg.logTag}] processed`,
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
          event: `${cfg.logTag}_error`,
          err: err instanceof Error ? err.message : String(err),
          ghlOrderId,
          email,
        },
        `[${cfg.logTag}] processing failed`,
      );
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  };
}

for (const cfg of GRANTS) {
  router.post(cfg.path, makeHandler(cfg));
}

export default router;
