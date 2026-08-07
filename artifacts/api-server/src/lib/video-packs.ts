/**
 * AI Video Studio credit pricing (Tasks #828, #837).
 *
 * Buy-any-quantity at a flat $2.50 per credit (Task #837 replaced the old
 * per-minute pack catalog). A purchase is a one-time PaymentIntent stamped
 * with purpose=video_credits + portalUserId + qty so the shared Stripe webhook
 * grants the credits via grantVideoCreditsFromStripe().
 */

/** Price of a single video credit, in cents. */
export const PRICE_PER_CREDIT_CENTS = 250;

/** Currency for all credit purchases. */
export const CREDIT_CURRENCY = "usd";

/** Allowed purchase quantity bounds (whole credits). */
export const MIN_CREDIT_QTY = 1;
export const MAX_CREDIT_QTY = 1000;

/** Suggested quantities surfaced in the buy UI; any quantity is allowed. */
export const CREDIT_QTY_PRESETS = [10, 25, 50, 100] as const;

/** Total price in cents for a given whole-credit quantity. */
export function creditPriceCents(qty: number): number {
  return Math.round(qty) * PRICE_PER_CREDIT_CENTS;
}

/** Normalize/validate a requested quantity; returns null when out of range. */
export function normalizeCreditQty(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_CREDIT_QTY || n > MAX_CREDIT_QTY) {
    return null;
  }
  return n;
}
