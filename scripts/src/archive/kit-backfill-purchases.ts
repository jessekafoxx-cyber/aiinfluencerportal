/**
 * Task #599 - one-shot KIT v3 Purchases backfill driver.
 *
 * Walks orders / coaching_agreements / research_credit_purchases /
 * os_tool_credit_purchases and enqueues a `purchase` outbox row per
 * line. The api-server worker drain loop pushes them to KIT v3
 * /purchases. Idempotent at KIT (dedup on transaction_id).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run kit:backfill-purchases            # dry-run
 *   pnpm --filter @workspace/scripts run kit:backfill-purchases -- --apply # writes
 */

import { runKitPurchasesBackfill } from "../../../artifacts/api-server/src/lib/kit-purchases-backfill";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await runKitPurchasesBackfill({ dryRun: !apply });
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log(
      "\nDry-run only. Re-run with --apply to enqueue these into kit_sync_outbox.",
    );
  } else {
    console.log(
      "\nEnqueued. The worker drain loop will push these to KIT v3 /purchases.",
    );
  }
}

main().catch((err) => {
  console.error("[kit-backfill-purchases] failed:", err);
  process.exit(1);
});
