// AI Influencer overdue-delivery watchdog (external Viktor-delivery model).
//
// The buyer is promised their AI influencer "within 24 hours" (see the
// QueueCard countdown in room30-portal). Under the default external model
// (INFLUENCER_INTERNAL_PIPELINE_ENABLED unset/0) the team (Viktor) builds
// every job by hand and calls the external API to complete it. If the team
// forgets a job, it sits non-terminal forever, the buyer keeps staring at a
// countdown that already hit zero, and nothing ever frees their build slot.
//
// This watchdog enforces the delivery SLA the user signed off on:
//   - At 24h since creation: re-alert the team (Viktor Slack), once per job.
//     This is a delivery-promise nudge, so it is intentionally keyed off
//     createdAt regardless of progress.
//   - At 72h with NO ACTIVITY: auto-fail the job, which returns the buyer's
//     slot (countActiveInfluencerJobs excludes status='failed') and surfaces
//     the Retry path in the portal. The team is told it was returned.
//
// "Activity" = the last write to the row (updated_at, which Drizzle bumps via
// $onUpdate on every db.update().set(...)). Every Viktor step - claim,
// generating_base, angle/setting/main-image uploads, complete - is a Drizzle
// update, so a job Viktor is actively building keeps a fresh updated_at and is
// never auto-failed, even if its createdAt is days old. We only auto-fail a job
// that has been genuinely silent (abandoned mid-build) for the full window.
// This fixes the "GENERATION HALTED" false-positive where a partially built
// influencer (e.g. some angles + settings already delivered) was killed purely
// because the original submission was older than 72h.
//
// Only runs under the external model. When the internal Higgsfield/Enhancor
// pipeline is ON it owns lifecycle (retry caps + the #ops stuck-job sweeper),
// so layering a 72h external auto-fail on top would be wrong.
//
// Kill switch: INFLUENCER_OVERDUE_WATCHDOG_DISABLED=1.
// Cadence override: INFLUENCER_OVERDUE_WATCHDOG_INTERVAL_MS (default 30 min,
//   floor 5 min). Threshold overrides (ms): INFLUENCER_OVERDUE_REALERT_MS
//   (default 24h), INFLUENCER_OVERDUE_FAIL_MS (default 72h).
//
// Multi-worker safety: every state flip is an atomic UPDATE scoped by the
// dedupe/terminal-status predicate (overdue_alerted_at IS NULL for the
// re-alert; status NOT IN terminal for the auto-fail), so concurrent worker
// replicas during a rolling restart simply no-op on rows another already
// claimed.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencersTable,
  portalNotificationsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { notifyViktor, isInternalInfluencerPipelineEnabled } from "./viktor-slack";

const DEFAULT_REALERT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FAIL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 90 * 1000;

// Buyer-facing failure copy. Honest about the delay, points at Retry, and
// uses plain hyphens only (no em/en dashes) per the project style.
export const OVERDUE_FAIL_REASON =
  "This build took longer than expected, so we returned it to you - tap Retry to start it again. We're sorry for the wait.";

// status NOT IN ('ready','ready_degraded','failed'): an undelivered job in
// any non-terminal stage (queued, generating_base, enhancing, swapping_scenes).
const nonTerminal = sql`${aiInfluencerJobsTable.status} not in ('ready', 'ready_degraded', 'failed')`;

// "No activity since cutoff." Keys off updated_at (Drizzle $onUpdate bumps it on
// every db.update().set(...), which is how every Viktor step writes the row),
// falling back to created_at for any legacy row that predates updated_at. A job
// Viktor is actively building keeps a fresh updated_at and is excluded here,
// even when its created_at is far older than the window.
function noActivitySince(cutoff: Date) {
  return sql`coalesce(${aiInfluencerJobsTable.updatedAt}, ${aiInfluencerJobsTable.createdAt}) < ${cutoff}`;
}

function readEnvMs(name: string, fallback: number, floor = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < floor) return fallback;
  return n;
}

export interface OverdueWatchdogThresholds {
  realertMs?: number;
  failMs?: number;
}

export interface UndeliveredJobRow {
  id: number;
  clientId: number;
  influencerId: number | null;
  status: string;
  createdAt: Date;
  overdueAlertedAt: Date | null;
}

// List every non-terminal job older than thresholdMs. Read-only; used by the
// auto-fail pass and by the one-off backlog script's dry-run.
export async function listUndeliveredInfluencerJobs(
  thresholdMs: number,
): Promise<UndeliveredJobRow[]> {
  const cutoff = new Date(Date.now() - thresholdMs);
  const rows = await db
    .select({
      id: aiInfluencerJobsTable.id,
      clientId: aiInfluencerJobsTable.clientId,
      influencerId: aiInfluencerJobsTable.influencerId,
      status: aiInfluencerJobsTable.status,
      createdAt: aiInfluencerJobsTable.createdAt,
      overdueAlertedAt: aiInfluencerJobsTable.overdueAlertedAt,
    })
    .from(aiInfluencerJobsTable)
    .where(and(nonTerminal, noActivitySince(cutoff)));
  return rows as UndeliveredJobRow[];
}

export interface AutoFailResult {
  failed: Array<{ id: number; clientId: number; influencerId: number | null }>;
}

// Atomically fail every non-terminal job older than thresholdMs, then run the
// per-row side effects: flip any materialized influencer to 'failed' (so the
// gallery Retry path, which requires status='failed', works), drop an in-portal
// notification for the buyer, and tell the team it was returned. Shared by the
// scheduler and the one-off backlog script.
export async function autoFailUndeliveredInfluencerJobs(opts: {
  thresholdMs: number;
  notifyTeam?: boolean;
}): Promise<AutoFailResult> {
  const cutoff = new Date(Date.now() - opts.thresholdMs);

  // Single atomic claim. Concurrent replicas no-op on rows the other flipped
  // (the nonTerminal predicate no longer matches).
  const claimed = await db
    .update(aiInfluencerJobsTable)
    .set({
      status: "failed",
      failureReason: OVERDUE_FAIL_REASON,
      completedAt: new Date(),
    })
    .where(and(nonTerminal, noActivitySince(cutoff)))
    .returning({
      id: aiInfluencerJobsTable.id,
      clientId: aiInfluencerJobsTable.clientId,
      influencerId: aiInfluencerJobsTable.influencerId,
    });

  for (const job of claimed) {
    try {
      // If the team had already materialized an influencer row, flip it to
      // 'failed' too so the buyer's gallery Retry (POST /retry, which 409s
      // unless the influencer is 'failed') re-dispatches cleanly.
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
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), jobId: job.id },
        "[influencer-overdue-watchdog] post-fail side effect failed",
      );
    }
    if (opts.notifyTeam) {
      void notifyViktor({ jobId: job.id, reason: "auto_failed" });
    }
  }

  if (claimed.length > 0) {
    logger.warn(
      { failed: claimed.length, jobIds: claimed.map((j) => j.id), thresholdMs: opts.thresholdMs },
      "[influencer-overdue-watchdog] auto-failed undelivered jobs (slots returned)",
    );
  }
  return { failed: claimed };
}

// Re-alert the team for jobs that crossed the 24h promise window but are not
// yet at the 72h auto-fail threshold. A single atomic UPDATE both selects and
// claims (stamps overdue_alerted_at) so a job that flips terminal between
// "select" and "claim" - on a concurrent replica or via the auto-fail pass -
// can never be alerted (the nonTerminal predicate is re-evaluated at claim
// time). Returns the count alerted. When failMs is supplied we also bound the
// candidate set to younger-than-fail-cutoff jobs, so even if the thresholds are
// mis-set (failMs <= realertMs) we never re-alert a job that should be failed.
export async function realertOverdueInfluencerJobs(opts: {
  realertMs: number;
  failMs?: number;
}): Promise<{ realerted: number }> {
  const realertCutoff = new Date(Date.now() - opts.realertMs);
  const failCutoff =
    opts.failMs != null ? new Date(Date.now() - opts.failMs) : null;

  // Note: this UPDATE bumps updated_at (Drizzle $onUpdate), so it counts as
  // "activity" and pushes the no-activity auto-fail clock forward once. That is
  // intentional and safe - it only ever delays an auto-fail, never causes a
  // false one, which matches the priority of never killing a job a buyer might
  // still be expecting. The re-alert fires at most once per job (overdue_alerted_at
  // dedupe), so the delay is bounded.
  const claimed = await db
    .update(aiInfluencerJobsTable)
    .set({ overdueAlertedAt: new Date() })
    .where(
      and(
        nonTerminal,
        lt(aiInfluencerJobsTable.createdAt, realertCutoff),
        ...(failCutoff ? [gte(aiInfluencerJobsTable.createdAt, failCutoff)] : []),
        sql`${aiInfluencerJobsTable.overdueAlertedAt} is null`,
      ),
    )
    .returning({ id: aiInfluencerJobsTable.id });

  for (const c of claimed) {
    void notifyViktor({ jobId: c.id, reason: "overdue" });
  }

  if (claimed.length > 0) {
    logger.warn(
      { realerted: claimed.length, realertMs: opts.realertMs },
      "[influencer-overdue-watchdog] re-alerted team about overdue jobs",
    );
  }
  return { realerted: claimed.length };
}

// One full pass: auto-fail past the 72h threshold first (so those rows become
// terminal and drop out of the re-alert candidate set), then re-alert the
// 24h-72h band.
export async function runInfluencerOverdueWatchdogOnce(
  thresholds: OverdueWatchdogThresholds = {},
): Promise<{ failed: number; realerted: number }> {
  const realertMs = thresholds.realertMs ?? readEnvMs("INFLUENCER_OVERDUE_REALERT_MS", DEFAULT_REALERT_MS, 60_000);
  const failMs = thresholds.failMs ?? readEnvMs("INFLUENCER_OVERDUE_FAIL_MS", DEFAULT_FAIL_MS, 60_000);

  const { failed } = await autoFailUndeliveredInfluencerJobs({ thresholdMs: failMs, notifyTeam: true });
  const { realerted } = await realertOverdueInfluencerJobs({ realertMs, failMs });
  return { failed: failed.length, realerted };
}

let started = false;
let timer: NodeJS.Timeout | null = null;

function readIntervalMs(): number {
  return readEnvMs("INFLUENCER_OVERDUE_WATCHDOG_INTERVAL_MS", DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
}

async function tick(): Promise<void> {
  if (process.env["INFLUENCER_OVERDUE_WATCHDOG_DISABLED"] === "1") return;
  // External-delivery model only. When the internal pipeline owns generation
  // its own retry caps + stuck sweeper handle lifecycle.
  if (isInternalInfluencerPipelineEnabled()) return;
  try {
    await runInfluencerOverdueWatchdogOnce();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[influencer-overdue-watchdog] tick failed",
    );
  }
}

export function startInfluencerOverdueWatchdog(): void {
  if (started) return;
  if (process.env["INFLUENCER_OVERDUE_WATCHDOG_DISABLED"] === "1") {
    logger.info("[influencer-overdue-watchdog] disabled via INFLUENCER_OVERDUE_WATCHDOG_DISABLED=1");
    return;
  }
  started = true;
  const intervalMs = readIntervalMs();
  logger.info(
    {
      intervalMs,
      realertMs: readEnvMs("INFLUENCER_OVERDUE_REALERT_MS", DEFAULT_REALERT_MS, 60_000),
      failMs: readEnvMs("INFLUENCER_OVERDUE_FAIL_MS", DEFAULT_FAIL_MS, 60_000),
    },
    "[influencer-overdue-watchdog] scheduler started",
  );
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
  }, FIRST_DELAY_MS).unref?.();
}

export function stopInfluencerOverdueWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
