/**
 * Backlog sweep for Task #459.
 *
 * Finds every recent unpaid orders row whose buyer email Whop already
 * recognizes as a valid member of the main product, and flips
 * mainProductPaid + selected bumps in place. Mirrors what the live
 * webhook (membership.went_valid bundle path) and the
 * /portal/setup-account self-heal would do, just batched against the
 * historical rows that were stranded by the original bundle gating bug.
 *
 * Usage:
 *   DRY_RUN=1 LOOKBACK_DAYS=30 pnpm --filter @workspace/scripts run recover:free-promos
 *   pnpm --filter @workspace/scripts run recover:free-promos
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID  (required)
 *   DATABASE_URL                    (required)
 *   LOOKBACK_DAYS                   (default 30)
 *   LIMIT                           (default 500)
 *   DRY_RUN=1                       (no DB writes, no emails)
 *   REQUEST_DELAY_MS                (default 150) inter-request pacing to
 *                                   stay under Whop's Cloudflare burst
 *                                   limit. Set to 0 to disable. The
 *                                   underlying whopRequest also retries
 *                                   429/5xx with exponential backoff, so
 *                                   pacing is belt-and-suspenders -- it
 *                                   keeps the sweep from ever needing the
 *                                   retries in the first place.
 *
 * Re-running after a partial failure: the sweep is idempotent. Rows that
 * already flipped show up as `alreadyPaid` next time, so it is safe to
 * just re-run until `errors` reaches 0 -- no manual sleep loops needed.
 */
import { sweepFreePromoOrders } from "../../../artifacts/api-server/src/lib/free-promo-reconcile";

async function main() {
  const lookbackDays = Number(process.env.LOOKBACK_DAYS || 30);
  const limit = Number(process.env.LIMIT || 500);
  const dryRun = process.env.DRY_RUN === "1";
  const requestDelayMs = Number(process.env.REQUEST_DELAY_MS ?? 150);

  console.log(
    `[recover:free-promos] lookbackDays=${lookbackDays} limit=${limit} dryRun=${dryRun} requestDelayMs=${requestDelayMs}`,
  );

  const result = await sweepFreePromoOrders({ lookbackDays, limit, dryRun, requestDelayMs });

  console.log(`[recover:free-promos] considered=${result.considered}`);
  console.log(`[recover:free-promos] reconciled=${result.reconciled.length}`);
  console.log(`[recover:free-promos] alreadyPaid=${result.alreadyPaid}`);
  console.log(`[recover:free-promos] notInWhop=${result.notInWhop}`);
  console.log(`[recover:free-promos] errors=${result.errors}`);
  console.log(`[recover:free-promos] rateLimited=${result.rateLimited}`);
  for (const r of result.reconciled) {
    console.log(`[recover:free-promos]   ${dryRun ? "WOULD-FLIP" : "FLIPPED"} order=${r.orderId} email=${r.email}`);
  }
  if (result.rateLimited > 0) {
    console.log(
      `[recover:free-promos] WARNING: ${result.rateLimited} row(s) hit Whop rate limits even after backoff retries. Re-run the script to retry them; the sweep is idempotent.`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[recover:free-promos] failed", e);
    process.exit(1);
  },
);
