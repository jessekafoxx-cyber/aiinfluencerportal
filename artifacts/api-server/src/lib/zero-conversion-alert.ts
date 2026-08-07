import { db, ordersTable } from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { logger } from "./logger";

// Zero-conversion alerting must look at REAL paid orders only. Promo
// grants, reconciler flips, enrollment syncs, founder-code redemptions,
// admin grants and migration backfills all flip main_product_paid=true
// without a buyer ever clicking through the funnel - none of them can
// produce an upsell either way, so they would dilute the alert into
// uselessness if we counted them.
//
// Task #582: Stripe is now the live processor. Both stripe_verified_payment
// (one-time main / cart) and stripe_subscription_active (Platinum trial
// start) count, plus the legacy whop_verified_payment for any pre-cutover
// orders that may still come through during the transition.
const VERIFIED_PAYMENT_SOURCES = [
  "stripe_verified_payment",
  "stripe_subscription_active",
  "whop_verified_payment",
];

/**
 * Zero-conversion alert.
 *
 * Background: in Task #454 the funnel ran for 100+ paid main orders without a
 * single upsell or downsell flip. The buyers were clicking the buttons; the
 * server just kept silently rejecting the charges (a placeholder Whop plan id
 * on downsell3, missing/expired upsell tokens, etc.) and nothing surfaced
 * until weekly revenue numbers came in.
 *
 * This worker runs every 10 minutes inside the worker process and inspects the
 * most recent N completed main orders. If every one of them has all four
 * upsell columns false, it logs a high-severity error so the on-call dashboard
 * (and any log-based pager) trips immediately. The check is intentionally
 * stateless and idempotent: it just looks at the live orders table.
 *
 * Tuning knobs (env vars, all optional):
 *   ZERO_CONVERSION_ALERT_DISABLED=1            kill switch
 *   ZERO_CONVERSION_ALERT_INTERVAL_MS=600000    poll interval (default 10 min)
 *   ZERO_CONVERSION_ALERT_WINDOW=20             how many recent paid orders
 *                                               must be zero-conversion before
 *                                               we alert (default 20)
 *   ZERO_CONVERSION_ALERT_MAX_AGE_MS=86400000   only consider orders younger
 *                                               than this (default 24h)
 */

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_WINDOW = 20;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

function parseIntOr(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function runZeroConversionAlertOnce(opts?: {
  windowSize?: number;
  maxAgeMs?: number;
}): Promise<{
  inspected: number;
  zeroConversion: boolean;
  oldestOrderId?: string;
  newestOrderId?: string;
}> {
  const windowSize = opts?.windowSize ?? parseIntOr(process.env["ZERO_CONVERSION_ALERT_WINDOW"], DEFAULT_WINDOW);
  const maxAgeMs = opts?.maxAgeMs ?? parseIntOr(process.env["ZERO_CONVERSION_ALERT_MAX_AGE_MS"], DEFAULT_MAX_AGE_MS);
  const since = new Date(Date.now() - maxAgeMs);

  const rows = await db
    .select({
      id: ordersTable.id,
      createdAt: ordersTable.createdAt,
      upsell1Paid: ordersTable.upsell1Paid,
      downsell1Paid: ordersTable.downsell1Paid,
      upsell2Paid: ordersTable.upsell2Paid,
      upsell3Paid: ordersTable.upsell3Paid,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.mainProductPaid, true),
        inArray(ordersTable.paymentSourceType, VERIFIED_PAYMENT_SOURCES),
        eq(ordersTable.receiptVerified, true),
        gte(ordersTable.createdAt, since),
      ),
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(windowSize);

  if (rows.length < windowSize) {
    return { inspected: rows.length, zeroConversion: false };
  }

  const anyConversion = rows.some(
    (r) => r.upsell1Paid || r.downsell1Paid || r.upsell2Paid || r.upsell3Paid,
  );

  const result = {
    inspected: rows.length,
    zeroConversion: !anyConversion,
    newestOrderId: rows[0]?.id,
    oldestOrderId: rows[rows.length - 1]?.id,
  };

  if (!anyConversion) {
    logger.error(
      {
        windowSize,
        maxAgeMs,
        oldestOrderId: result.oldestOrderId,
        newestOrderId: result.newestOrderId,
        sampleOrderIds: rows.map((r) => r.id),
      },
      `[zero-conversion-alert] ${windowSize} consecutive paid orders with ZERO upsell/downsell conversions in the last ${Math.round(maxAgeMs / 3600000)}h. ` +
        "Check artifacts/api-server logs for charge-upsell errors (placeholder plan ids, invalid upsellToken, Whop chargeUser failures).",
    );
  }
  return result;
}

export function startZeroConversionAlert(): void {
  if (timer) return;
  if (process.env["ZERO_CONVERSION_ALERT_DISABLED"] === "1") {
    logger.warn("ZERO_CONVERSION_ALERT_DISABLED=1; not starting zero-conversion alert");
    return;
  }
  const intervalMs = parseIntOr(process.env["ZERO_CONVERSION_ALERT_INTERVAL_MS"], DEFAULT_INTERVAL_MS);
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runZeroConversionAlertOnce();
    } catch (err) {
      logger.warn({ err }, "[zero-conversion-alert] tick failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  // First check shortly after boot so a misconfiguration is flagged within
  // a minute of deploy rather than after the first 10-minute interval.
  setTimeout(() => void tick(), 30_000).unref?.();
  logger.info({ intervalMs }, "[zero-conversion-alert] started");
}

export function stopZeroConversionAlert(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
