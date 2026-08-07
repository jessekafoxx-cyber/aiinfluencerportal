/**
 * One-off cleanup for the AI Influencer backlog of jobs that were never
 * delivered under the external Viktor-delivery model and are wedged in a
 * non-terminal status (queued / generating_base / enhancing / swapping_scenes)
 * forever.
 *
 * Failing a job returns the buyer's build slot automatically -
 * `countActiveInfluencerJobs` excludes status='failed' - and the portal then
 * surfaces a Retry path so the buyer can re-request. This mirrors exactly what
 * the going-forward watchdog (lib/influencer-overdue-watchdog.ts) does at the
 * 72h threshold: flip the job to 'failed' with a buyer-facing reason, flip any
 * linked influencer to 'failed' so the gallery Retry re-dispatches, and drop an
 * in-portal notification. The failure copy below is kept identical to
 * OVERDUE_FAIL_REASON in that watchdog - update both together if it changes.
 *
 * This script ONLY changes status / failure_reason / completed_at on jobs (+
 * the linked influencer status) and inserts portal notifications - never schema.
 * It does NOT spam the team Slack (a one-off bulk cleanup of dozens of jobs
 * shouldn't fire dozens of "auto-failed" pings).
 *
 * Usage:
 *   # Dry-run: list the stuck jobs that WOULD be failed (default)
 *   pnpm --filter @workspace/scripts run clear:stuck-influencer-backlog
 *
 *   # Apply the cleanup
 *   pnpm --filter @workspace/scripts run clear:stuck-influencer-backlog -- --apply
 *
 *   # Override the age threshold in hours (default 24)
 *   pnpm --filter @workspace/scripts run clear:stuck-influencer-backlog -- --apply --hours 48
 *
 * Run against PROD by exporting PROD's DATABASE_URL for the invocation.
 * Idempotent: re-running after a cleanup finds no stuck rows and exits 0.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencersTable,
  portalNotificationsTable,
} from "@workspace/db";

// Must stay identical to OVERDUE_FAIL_REASON in
// artifacts/api-server/src/lib/influencer-overdue-watchdog.ts. Plain hyphens
// only (no em/en dashes) per project style.
const OVERDUE_FAIL_REASON =
  "This build took longer than expected, so we returned it to you - tap Retry to start it again. We're sorry for the wait.";

const nonTerminal = sql`${aiInfluencerJobsTable.status} not in ('ready', 'ready_degraded', 'failed')`;

function parseArgs(argv: string[]): { apply: boolean; hours: number } {
  let apply = false;
  let hours = 24;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--hours") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) hours = n;
      i++;
    }
  }
  return { apply, hours };
}

async function main() {
  const { apply, hours } = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stuck = await db
    .select({
      id: aiInfluencerJobsTable.id,
      clientId: aiInfluencerJobsTable.clientId,
      influencerId: aiInfluencerJobsTable.influencerId,
      status: aiInfluencerJobsTable.status,
      createdAt: aiInfluencerJobsTable.createdAt,
    })
    .from(aiInfluencerJobsTable)
    .where(and(nonTerminal, lt(aiInfluencerJobsTable.createdAt, cutoff)));

  const byCustomer = new Set(stuck.map((j) => j.clientId));
  console.log(
    `Found ${stuck.length} stuck AI Influencer job(s) across ${byCustomer.size} customer(s) ` +
      `(non-terminal, older than ${hours}h):`,
  );
  for (const j of stuck) {
    console.log(
      `  job #${j.id} client=${j.clientId} status=${j.status} ` +
        `influencerId=${j.influencerId ?? "(none)"} createdAt=${j.createdAt?.toISOString?.() ?? j.createdAt}`,
    );
  }

  if (stuck.length === 0) {
    console.log("Nothing to clear. Exiting.");
    return;
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to fail these jobs and return each buyer's slot.");
    return;
  }

  // Atomic claim - flips every matching job to terminal 'failed' in one UPDATE.
  const failed = await db
    .update(aiInfluencerJobsTable)
    .set({
      status: "failed",
      failureReason: OVERDUE_FAIL_REASON,
      completedAt: new Date(),
    })
    .where(and(nonTerminal, lt(aiInfluencerJobsTable.createdAt, cutoff)))
    .returning({
      id: aiInfluencerJobsTable.id,
      clientId: aiInfluencerJobsTable.clientId,
      influencerId: aiInfluencerJobsTable.influencerId,
    });

  for (const job of failed) {
    if (job.influencerId != null) {
      await db
        .update(aiInfluencersTable)
        .set({ status: "failed" })
        .where(
          and(
            eq(aiInfluencersTable.id, job.influencerId),
            sql`${aiInfluencersTable.status} <> 'failed'`,
          ),
        );
    }
    await db.insert(portalNotificationsTable).values({
      clientId: job.clientId,
      type: "influencer_failed",
      title: "Your AI influencer build needs a retry",
      body: "This build took longer than expected, so we returned it to you. Tap to retry it - it's free and won't use an extra build.",
      payload: { jobId: job.id, influencerId: job.influencerId },
      href: "/your-influencers",
    });
  }

  console.log(
    `\nFailed ${failed.length} job(s) and returned their slots: [${failed.map((r) => r.id).join(", ")}]`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("clear-stuck-influencer-backlog failed:", err);
    process.exit(1);
  });
