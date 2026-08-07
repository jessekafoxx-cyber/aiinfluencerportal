/**
 * Task #778 — One-off reset helper for research generation jobs that are
 * wedged in pending/processing forever.
 *
 * Research doc generation runs as a fire-and-forget background worker
 * (`runResearchGeneration`). The job row in `research_generation_jobs` is
 * written as status='processing' and only flips to complete/error at the
 * very end. If the API/worker process restarts mid-run, or an LLM/scrape
 * step hangs without throwing, the row stays 'processing' forever and the
 * 409 "already in progress" guard on POST /portal/research/generate
 * permanently blocks the user.
 *
 * The research-job-sweeper scheduler (lib/research-job-sweeper-scheduler.ts)
 * fixes this going forward, but this script gives immediate relief before
 * the next deploy: it flips currently-stuck rows to status='error' with a
 * clear errorMessage so the user can retry right away.
 *
 * It ONLY changes the `status` / `error_message` values - never schema.
 *
 * Usage:
 *   # Dry-run: list stale rows that WOULD be reset (default)
 *   pnpm --filter @workspace/scripts run reset:stuck-research-jobs
 *
 *   # Apply the reset
 *   pnpm --filter @workspace/scripts run reset:stuck-research-jobs -- --apply
 *
 *   # Override the staleness threshold in minutes (default 20)
 *   pnpm --filter @workspace/scripts run reset:stuck-research-jobs -- --apply --minutes 30
 *
 * Idempotent: re-running after a reset finds no stale rows and exits 0.
 */

import { and, eq, lt, or } from "drizzle-orm";
import { db, researchGenerationJobsTable } from "@workspace/db";

const STALE_ERROR_MESSAGE =
  "Generation timed out and was automatically cancelled - please try again.";

function parseArgs(argv: string[]): { apply: boolean; minutes: number } {
  let apply = false;
  let minutes = 20;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--minutes") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) minutes = n;
      i++;
    }
  }
  return { apply, minutes };
}

async function main() {
  const { apply, minutes } = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const stale = await db
    .select({
      id: researchGenerationJobsTable.id,
      userId: researchGenerationJobsTable.userId,
      status: researchGenerationJobsTable.status,
      progress: researchGenerationJobsTable.progress,
      progressLabel: researchGenerationJobsTable.progressLabel,
      updatedAt: researchGenerationJobsTable.updatedAt,
    })
    .from(researchGenerationJobsTable)
    .where(
      and(
        or(
          eq(researchGenerationJobsTable.status, "pending"),
          eq(researchGenerationJobsTable.status, "processing"),
        ),
        lt(researchGenerationJobsTable.updatedAt, cutoff),
      ),
    );

  console.log(
    `Found ${stale.length} stale research job(s) (status pending/processing, no progress for >${minutes}m):`,
  );
  for (const j of stale) {
    console.log(
      `  job #${j.id} user=${j.userId} status=${j.status} progress=${j.progress}% ` +
        `label=${JSON.stringify(j.progressLabel)} updatedAt=${j.updatedAt?.toISOString?.() ?? j.updatedAt}`,
    );
  }

  if (stale.length === 0) {
    console.log("Nothing to reset. Exiting.");
    return;
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to flip these rows to status=error.");
    return;
  }

  const updated = await db
    .update(researchGenerationJobsTable)
    .set({ status: "error", errorMessage: STALE_ERROR_MESSAGE, updatedAt: new Date() })
    .where(
      and(
        or(
          eq(researchGenerationJobsTable.status, "pending"),
          eq(researchGenerationJobsTable.status, "processing"),
        ),
        lt(researchGenerationJobsTable.updatedAt, cutoff),
      ),
    )
    .returning({ id: researchGenerationJobsTable.id });

  console.log(`\nReset ${updated.length} job(s) to status=error: [${updated.map((r) => r.id).join(", ")}]`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("reset-stuck-research-jobs failed:", err);
    process.exit(1);
  });
