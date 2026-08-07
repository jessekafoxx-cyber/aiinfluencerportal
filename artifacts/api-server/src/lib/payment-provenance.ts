/**
 * Paid-state provenance.
 *
 * Every code path that flips `orders.main_product_paid = true` MUST go
 * through one of the helpers in this file. Direct .set({ mainProductPaid:
 * true }) calls in app code are a regression. The lint/grep canary is
 * any new occurrence of `mainProductPaid: true` outside this file plus
 * the four files the audit catalogued in migration 0052's preamble.
 *
 * Originally introduced in Task #551 to track which code path flipped a
 * paid row. Task #582 extended the source-type enum to cover Stripe now
 * that the funnel runs on Stripe end-to-end. Whop sources are kept on
 * the enum because historical orders carry them and the reconciler /
 * setup-account fallback paths still resolve old Whop receipts during
 * the cutover window.
 */

export const PAYMENT_SOURCE_TYPES = [
  // ---- Stripe (current funnel) -----------------------------------------
  // Real Stripe payment_intent.succeeded with a real Stripe charge id.
  // This is the ONLY source that counts as live revenue going forward.
  "stripe_verified_payment",
  // First invoice on a Stripe Subscription with status=active. Counts
  // as verified revenue (subscription is active, the buyer was charged
  // by Stripe), but is tracked separately so analytics can split
  // one-time vs recurring.
  "stripe_subscription_active",
  // Background reconciler that matches a Stripe customer/charge after
  // the fact (e.g. webhook delivery failure recovery). API-validated.
  "stripe_reconciler",
  // 100%-off promo redemption against a real Stripe PromotionCode
  // (MAY2026). The buyer never pays a cent, so there is no Stripe
  // PaymentIntent receipt - but the redemption is recorded on the
  // Stripe coupon and is still verified against Stripe.
  "stripe_free_promo",

  // ---- GoHighLevel (Task #662) -----------------------------------------
  // Real GHL purchase delivered via the POST /api/portal/ghl/enroll
  // webhook. GHL owns checkout/upsell/thank-you end-to-end for the
  // AI Influencer Masterclass ($27 main offer); the webhook is the
  // canonical signal that money changed hands and counts as live
  // revenue alongside `stripe_verified_payment`. The receipt id lives
  // on `orders.ghl_order_id`.
  "ghl_verified_payment",

  // ---- Whop (legacy / cutover) -----------------------------------------
  // Real Whop payment.succeeded with a receipt id - pre-Task-#582.
  "whop_verified_payment",
  "whop_free_promo",
  "whop_reconciler",
  "whop_setup_account_fallback",
  "whop_enrollment_sync",

  // ---- Grants ----------------------------------------------------------
  "platinum_founder_code",
  "admin_grant",
  "migration_backfill",
] as const;

export type PaymentSourceType = (typeof PAYMENT_SOURCE_TYPES)[number];

/**
 * Sources that count as "real revenue" for analytics, zero-conversion
 * alerting, weekly accounting, and the Meta CAPI Purchase event.
 *
 * Post-Task-#582 the live funnel runs on Stripe, so the new revenue
 * sources are `stripe_verified_payment` and `stripe_subscription_active`.
 * `whop_verified_payment` is still here so that historical pre-cutover
 * orders continue to be counted as revenue (we don't want to retroactively
 * delete revenue from analytics just because the processor changed).
 */
const REAL_REVENUE_SOURCES: ReadonlySet<PaymentSourceType> = new Set([
  "stripe_verified_payment",
  "stripe_subscription_active",
  "ghl_verified_payment",
  "whop_verified_payment",
]);

/**
 * Sources that count as "validated against the upstream processor in some
 * form" (vs admin grants). Used by ops dashboards.
 */
const VERIFIED_SOURCES: ReadonlySet<PaymentSourceType> = new Set([
  "stripe_verified_payment",
  "stripe_subscription_active",
  "stripe_reconciler",
  "stripe_free_promo",
  "ghl_verified_payment",
  "whop_verified_payment",
  "whop_free_promo",
  "whop_reconciler",
  "whop_setup_account_fallback",
  "whop_enrollment_sync",
]);

const STRIPE_SOURCES: ReadonlySet<PaymentSourceType> = new Set([
  "stripe_verified_payment",
  "stripe_subscription_active",
  "stripe_reconciler",
  "stripe_free_promo",
]);

const WHOP_SOURCES: ReadonlySet<PaymentSourceType> = new Set([
  "whop_verified_payment",
  "whop_free_promo",
  "whop_reconciler",
  "whop_setup_account_fallback",
  "whop_enrollment_sync",
]);

export function isRealRevenueSource(s: PaymentSourceType | null | undefined): boolean {
  return s != null && REAL_REVENUE_SOURCES.has(s);
}

/** @deprecated Use `isVerifiedSource`. Retained for older Whop call sites. */
export function isVerifiedWhopSource(s: PaymentSourceType | null | undefined): boolean {
  return s != null && WHOP_SOURCES.has(s);
}

export function isVerifiedSource(s: PaymentSourceType | null | undefined): boolean {
  return s != null && VERIFIED_SOURCES.has(s);
}

export function isStripeSource(s: PaymentSourceType | null | undefined): boolean {
  return s != null && STRIPE_SOURCES.has(s);
}

export function isWhopSource(s: PaymentSourceType | null | undefined): boolean {
  return s != null && WHOP_SOURCES.has(s);
}

export interface PaymentProvenanceStamp {
  paymentSourceType: PaymentSourceType;
  grantReason: string;
  paymentVerified: boolean;
  receiptVerified: boolean;
}

/**
 * Build the provenance fields for an UPDATE/INSERT that flips
 * `main_product_paid=true`. Caller passes the source and a short reason
 * (free-form, stored in `grant_reason`) plus whether a real processor
 * receipt id is present on the same write. Booleans are derived from
 * the source to keep the policy in one place and impossible to set
 * wrong at the call site.
 *
 * - `payment_verified` is true for every verified upstream source (any
 *   stripe_* or whop_* value). The reconcilers count as verified because
 *   they validate against the processor's API.
 * - `receipt_verified` is true ONLY when the caller asserts a real
 *   processor receipt id was written on the same row. The DB CHECK
 *   constraint will reject the write at the DB level if the caller lies
 *   about this and no receipt id is actually on the row.
 */
export function provenanceFor(opts: {
  source: PaymentSourceType;
  reason: string;
  hasReceiptId: boolean;
}): PaymentProvenanceStamp {
  const verified = VERIFIED_SOURCES.has(opts.source);
  return {
    paymentSourceType: opts.source,
    grantReason: opts.reason,
    paymentVerified: verified,
    receiptVerified: verified && opts.hasReceiptId,
  };
}
