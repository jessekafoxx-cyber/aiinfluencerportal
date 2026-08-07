/**
 * Task #587 - one-shot KIT (ConvertKit) backfill driver.
 *
 * Reads every existing contact source (funnel_leads, paid orders,
 * portal_users.is_a_list, coaching_agreements, live-event invites) and
 * enqueues the matching tag-add operations into the kit_sync_outbox.
 * The worker drain loop then applies them against KIT.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run kit:backfill            # dry-run
 *   pnpm --filter @workspace/scripts run kit:backfill -- --apply # writes
 *
 * Safe to re-run: KIT add-tag is idempotent at the API layer, and the
 * outbox processes each row exactly once before being marked succeeded.
 */

import { runKitBackfill } from "../../../artifacts/api-server/src/lib/kit-backfill";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await runKitBackfill({ dryRun: !apply });
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to enqueue these into kit_sync_outbox.");
  } else {
    console.log("\nEnqueued. The worker drain loop (every 15s) will push these to KIT.");
  }
}

main().catch((err) => {
  console.error("[kit-backfill] failed:", err);
  process.exit(1);
});
