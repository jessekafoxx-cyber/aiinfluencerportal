/**
 * Command Center conversion ingestion helpers.
 *
 * Imported dynamically from stripe-paid-state.ts so cc_* writes are
 * fire-and-forget and never block the Stripe webhook path.
 *
 * recordCcConversion - write / accumulate a cc_conversions row for a
 *   real-revenue paid_* flip. Idempotent via ON CONFLICT DO UPDATE on
 *   stripe_payment_intent_id (main+bump flips share a PI, so amounts
 *   and slug lists accumulate on the same row).
 *   After writing, fires Meta CAPI Purchase and Google Ads offline
 *   conversion (both fire-and-forget, stamp pushed flags on success).
 *
 * revokeCcConversion - mark the matching cc_conversions row as a refund
 *   when revokeStripeOrderPaid fires. Sets is_refund=true rather than
 *   deleting so attribution history is preserved.
 */

import { db, ccConversions, ccVisitors, ccTouchpoints } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  sendMetaPurchaseEvent,
  isMetaCapiConfigured,
} from "../services/metaCapi.js";
import {
  pushGoogleOfflineConversion,
  isGoogleAdsConfigured,
} from "./google-ads-offline.js";

export async function recordCcConversion(opts: {
  email: string;
  stripePaymentIntentId: string;
  stripeCustomerId?: string | null;
  amountCents: number;
  slug: string;
  paidField: string;
}): Promise<void> {
  const emailNorm = opts.email.trim().toLowerCase();

  const [vis] = await db
    .select({ id: ccVisitors.id })
    .from(ccVisitors)
    .where(sql`lower(${ccVisitors.email}) = ${emailNorm}`)
    .limit(1);
  const visitorId = vis?.id ?? null;

  let channel: string | null = null;
  let campaignType: string | null = null;
  let utmSource: string | null = null;
  let utmMedium: string | null = null;
  let utmCampaign: string | null = null;
  let fbclid: string | null = null;
  let gclid: string | null = null;

  if (visitorId) {
    const [tp] = await db
      .select()
      .from(ccTouchpoints)
      .where(eq(ccTouchpoints.visitorId, visitorId))
      .orderBy(desc(ccTouchpoints.occurredAt))
      .limit(1);
    if (tp) {
      channel = tp.channel;
      campaignType = tp.campaignType;
      utmSource = tp.utmSource;
      utmMedium = tp.utmMedium;
      utmCampaign = tp.utmCampaign;
      fbclid = tp.fbclid;
      gclid = tp.gclid;
    }
  }

  const [upserted] = await db
    .insert(ccConversions)
    .values({
      visitorId,
      email: emailNorm,
      stripePaymentIntentId: opts.stripePaymentIntentId,
      stripeCustomerId: opts.stripeCustomerId ?? null,
      amountCents: opts.amountCents,
      productType: opts.paidField === "mainProductPaid" ? "standard" : "addon",
      productSlugs: opts.slug,
      channel,
      campaignType,
      attributionModel: "last_touch",
      utmSource,
      utmMedium,
      utmCampaign,
      fbclid,
      gclid,
      metaCapiPushed: false,
      googleOfflinePushed: false,
      isRefund: false,
    })
    .onConflictDoUpdate({
      target: ccConversions.stripePaymentIntentId,
      set: {
        amountCents: sql`cc_conversions.amount_cents + EXCLUDED.amount_cents`,
        productSlugs: sql`COALESCE(cc_conversions.product_slugs, '') || ',' || EXCLUDED.product_slugs`,
        updatedAt: new Date(),
      },
    })
    .returning();

  logger.info(
    {
      email: emailNorm,
      pi: opts.stripePaymentIntentId,
      slug: opts.slug,
      amountCents: opts.amountCents,
      visitorId,
      channel,
    },
    "[cc-conversion] recorded",
  );

  if (!upserted) return;

  // Fire Meta CAPI Purchase for ALL qualifying paid conversions — since the
  // browser pixel was removed (Option A), the server-side CAPI call is the
  // sole source of Purchase events sent to Meta. No fbclid/channel filter;
  // Meta deduplicates by event_id (cc:pi: prefix avoids collision with the
  // main-flow order_<id>_main events).
  if (isMetaCapiConfigured()) {
    const capiEventId = `cc:pi:${opts.stripePaymentIntentId}`;
    void sendMetaPurchaseEvent({
      eventId: capiEventId,
      email: emailNorm,
      fbc: upserted.fbclid
        ? `fb.1.${Date.now()}.${upserted.fbclid}`
        : null,
      value: upserted.amountCents / 100,
      currency: "USD",
      orderType: "standard",
      contentName: opts.slug,
      contentIds: opts.slug ? [opts.slug] : undefined,
    })
      .then((result) => {
        if (result.ok && !result.skipped) {
          return db
            .update(ccConversions)
            .set({ metaCapiPushed: true, updatedAt: new Date() })
            .where(eq(ccConversions.stripePaymentIntentId, opts.stripePaymentIntentId));
        }
        return undefined;
      })
      .catch((err: Error) =>
        logger.warn({ err: err.message, pi: opts.stripePaymentIntentId }, "[cc-conversion] CAPI push failed"),
      );
  }

  // Fire Google Ads offline conversion when a gclid is present.
  if (isGoogleAdsConfigured() && upserted.gclid) {
    void pushGoogleOfflineConversion({
      gclid: upserted.gclid,
      valueMicros: upserted.amountCents * 10_000,
      conversionDateTime: upserted.occurredAt ?? new Date(),
      email: emailNorm,
    })
      .then((ok) => {
        if (ok) {
          return db
            .update(ccConversions)
            .set({ googleOfflinePushed: true, updatedAt: new Date() })
            .where(eq(ccConversions.stripePaymentIntentId, opts.stripePaymentIntentId));
        }
        return undefined;
      })
      .catch((err: Error) =>
        logger.warn({ err: err.message, gclid: upserted.gclid }, "[cc-conversion] Google offline push failed"),
      );
  }
}

export async function revokeCcConversion(opts: {
  orderId: string;
  stripePaymentIntentId?: string | null;
}): Promise<void> {
  if (!opts.stripePaymentIntentId) return;

  const result = await db
    .update(ccConversions)
    .set({ isRefund: true, updatedAt: new Date() })
    .where(eq(ccConversions.stripePaymentIntentId, opts.stripePaymentIntentId))
    .returning({ id: ccConversions.id });

  if (result.length > 0) {
    logger.info(
      { pi: opts.stripePaymentIntentId, orderId: opts.orderId },
      "[cc-conversion] revoked (isRefund=true)",
    );
  }
}
