/**
 * Task #598 - one-shot WATI (WhatsApp) backfill driver.
 *
 * Mirrors `kit-backfill.ts`. Reads every existing contact source
 * (funnel_leads, paid orders, portal_users.is_a_list,
 * coaching_agreements, live-event invites) and enqueues the matching
 * tag-add operations into the wati_sync_outbox. The worker drain loop
 * then applies them against WATI. Rows without a phone number on file
 * are skipped (WhatsApp routing requires a phone).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run wati:backfill            # dry-run
 *   pnpm --filter @workspace/scripts run wati:backfill -- --apply # writes
 *
 * Safe to re-run: WATI tag-add is idempotent at the API layer, and the
 * outbox processes each row exactly once before being marked succeeded.
 */

import { runWatiBackfill } from "../../../artifacts/api-server/src/lib/wati-backfill";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await runWatiBackfill({ dryRun: !apply });
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to enqueue these into wati_sync_outbox.");
  } else {
    console.log("\nEnqueued. The worker drain loop (every 15s) will push these to WATI.");
  }
}

main().catch((err) => {
  console.error("[wati-backfill] failed:", err);
  process.exit(1);
});
