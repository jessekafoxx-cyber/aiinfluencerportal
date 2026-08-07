// Research generation job stale-sweeper scheduler (Task #778).
//
// Research doc generation runs as a fire-and-forget background worker
// (`runResearchGeneration`, kicked off via setImmediate from
// `POST /portal/research/generate`). The job row in
// `research_generation_jobs` is written as `status = "processing"` and
// only flips to `complete`/`error` at the very end of the run. If the
// API/worker process restarts mid-run, or an LLM / web-scrape step
// hangs without throwing, the row stays `processing` forever.
//
// Because the generate endpoint returns 409 ("already in progress")
// whenever a `pending`/`processing` job exists for that user, a hung
// job permanently blocks the user from starting a new one and the
// frontend keeps polling it forever.
//
// This sweeper is the safety net: every interval it flips any
// `pending`/`processing` job whose `updatedAt` is older than
// STALE_THRESHOLD_MS to `status = "error"` with a clear message. The
// worker bumps `updatedAt` on every progress step, so a genuinely
// long-but-progressing generation keeps its row fresh and is never
// killed - only a truly hung run goes stale. Flipping to `error`
// clears the 409 block (the endpoint only blocks on pending/processing)
// and the portal page already renders the `error` state with a
// "Try Again" / Retry button.
//
// Multi-worker safety: the UPDATE is a single atomic statement scoped
// by status + updatedAt staleness, so concurrent worker replicas
// during a rolling restart simply no-op on rows the other already
// flipped (the WHERE no longer matches). No lease needed.
//
// Kill switch: RESEARCH_JOB_SWEEPER_DISABLED=1.
// Cadence override: RESEARCH_JOB_SWEEPER_INTERVAL_MS (default 5 min,
// floor 60s).

import { and, eq, lt, or, sql } from "drizzle-orm";
import { db, researchGenerationJobsTable } from "@workspace/db";
import { logger } from "./logger";

// A research job is considered hung once its `updatedAt` has not moved
// for this long. Generation normally completes in a few minutes; 20
// minutes of zero progress is well past any healthy run.
export const STALE_THRESHOLD_MS = 20 * 60 * 1000;

const STALE_ERROR_MESSAGE =
  "Generation timed out and was automatically cancelled - please try again.";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 60 * 1000;

let started = false;
let timer: NodeJS.Timeout | null = null;

function readIntervalMs(): number {
  const raw = process.env["RESEARCH_JOB_SWEEPER_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_INTERVAL_MS;
  return n;
}

export interface ResearchJobSweepResult {
  swept: number;
}

// Atomically flip every stale pending/processing job to error. Returns
// the number of rows swept this run.
export async function sweepStaleResearchJobsOnce(opts: {
  thresholdMs?: number;
} = {}): Promise<ResearchJobSweepResult> {
  const thresholdMs = opts.thresholdMs ?? STALE_THRESHOLD_MS;
  const cutoff = new Date(Date.now() - thresholdMs);

  const swept = await db
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

  if (swept.length > 0) {
    logger.warn(
      { swept: swept.length, jobIds: swept.map((r) => r.id), thresholdMs },
      "[research-job-sweeper] marked stale research jobs as error",
    );
  }

  return { swept: swept.length };
}

async function tick(): Promise<void> {
  if (process.env["RESEARCH_JOB_SWEEPER_DISABLED"] === "1") return;
  try {
    await sweepStaleResearchJobsOnce();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[research-job-sweeper] tick failed",
    );
  }
}

export function startResearchJobSweeperScheduler(): void {
  if (started) return;
  if (process.env["RESEARCH_JOB_SWEEPER_DISABLED"] === "1") {
    logger.info("[research-job-sweeper] disabled via RESEARCH_JOB_SWEEPER_DISABLED=1");
    return;
  }
  started = true;
  const intervalMs = readIntervalMs();
  logger.info(
    { intervalMs, thresholdMs: STALE_THRESHOLD_MS },
    "[research-job-sweeper] scheduler started",
  );
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
  }, FIRST_DELAY_MS).unref?.();
}

export function stopResearchJobSweeperScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
