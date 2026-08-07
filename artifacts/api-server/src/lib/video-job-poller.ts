// AI Video Studio HeyGen polling fallback (Task #828).
//
// The HeyGen webhook is the fast path; this scheduler is the safety net for
// missed/disabled webhooks. Every tick it picks up video_jobs still in
// "generating" and resolves their authoritative HeyGen status via the shared
// resolveAndApplyHeygenStatus() (same finalize/fail path as the webhook), so
// jobs always converge even with no webhook configured.
//
// Runs on the Media Worker process (per the runtime layout in replit.md), not
// the API. No distributed lease is taken: resolveAndApplyHeygenStatus is
// idempotent (no-op once a job leaves "generating", refunds keyed by
// idempotencyKey), so concurrent worker replicas during a rolling restart are
// safe.
//
// Kill switch: VIDEO_POLLER_DISABLED=1.
// Cadence override: VIDEO_POLLER_INTERVAL_MS (default 30s, floor 15s).

import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, videoJobsTable, videoCreditTransactionsTable, type VideoJob } from "@workspace/db";
import { logger } from "./logger";
import { isHeygenConfigured, EDIT_CREDITS_COST } from "./heygen";
import { refundVideoCredits } from "./video-credits";
import {
  resolveAndApplyHeygenStatus,
  failJobAndRefund,
  failEditAndRefund,
} from "./video-generation";

const DEFAULT_INTERVAL_MS = 30 * 1000;
const FIRST_DELAY_MS = 20 * 1000;
const BATCH_LIMIT = 25;
// Grace window so the webhook gets first crack before we poll.
const MIN_AGE_MS = 15 * 1000;
// Hard timeout: a job stuck "generating" past this is failed + refunded.
const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
// Hard timeout: an auto-edit stuck "editing"/"pending" past this (no Remotion
// webhook) is failed and its edit credits refunded.
const EDIT_TIMEOUT_MS = 30 * 60 * 1000;
// Reconcile window: a "pending" edit that never got its editCreditsCharged flag
// stamped (debit committed but the in-request stamp + compensation both failed)
// is durably refunded + failed here. Healthy /auto-edit requests confirm in
// milliseconds, so anything still unconfirmed past this is genuinely stranded.
const EDIT_RECONCILE_MS = 2 * 60 * 1000;

let started = false;
let timer: NodeJS.Timeout | null = null;

function disabled(): boolean {
  return process.env["VIDEO_POLLER_DISABLED"] === "1";
}

function intervalMs(): number {
  const raw = process.env["VIDEO_POLLER_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 15_000) return DEFAULT_INTERVAL_MS;
  return n;
}

export async function pollVideoJobsOnce(): Promise<{
  scanned: number;
  resolved: number;
  timedOut: number;
  editsTimedOut: number;
  editsReconciled: number;
  errors: number;
}> {
  const result = {
    scanned: 0,
    resolved: 0,
    timedOut: 0,
    editsTimedOut: 0,
    editsReconciled: 0,
    errors: 0,
  };
  const cutoff = new Date(Date.now() - MIN_AGE_MS);
  const rows: VideoJob[] = await db
    .select()
    .from(videoJobsTable)
    .where(and(eq(videoJobsTable.status, "generating"), lt(videoJobsTable.updatedAt, cutoff)))
    .orderBy(asc(videoJobsTable.updatedAt))
    .limit(BATCH_LIMIT);

  for (const job of rows) {
    result.scanned++;
    try {
      const ageMs = Date.now() - new Date(job.createdAt).getTime();
      if (ageMs > GENERATION_TIMEOUT_MS) {
        await failJobAndRefund(job, "Generation timed out");
        result.timedOut++;
        continue;
      }
      const before = job.status;
      const updated = await resolveAndApplyHeygenStatus(job);
      if (updated.status !== before) result.resolved++;
    } catch (err) {
      result.errors++;
      logger.error(
        { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
        "[video-poller] failed to resolve job",
      );
    }
  }

  // Reconcile charged-but-unconfirmed edits: editStatus='pending' with no
  // editCreditsCharged flag past EDIT_RECONCILE_MS. This is the durable backstop
  // for the case where /auto-edit committed the debit but BOTH the flag-stamp and
  // its in-request compensating refund failed (e.g. cascading DB transient). The
  // worker never claims these (it requires editCreditsCharged) and the 30-min
  // stuck sweep won't refund them (its refund also gates on the flag), so they
  // would otherwise strand the buyer's charge.
  const reconcileCutoff = new Date(Date.now() - EDIT_RECONCILE_MS);
  const unconfirmed: VideoJob[] = await db
    .select()
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.editStatus, "pending"),
        lt(videoJobsTable.updatedAt, reconcileCutoff),
        isNull(videoJobsTable.deletedAt),
        sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
      ),
    )
    .orderBy(asc(videoJobsTable.updatedAt))
    .limit(BATCH_LIMIT);
  for (const job of unconfirmed) {
    result.scanned++;
    try {
      // Atomically CLAIM the reconcile by flipping pending->failed, guarded on
      // editStatus='pending' AND editCreditsCharged still NULL. This wins exactly
      // once and, crucially, excludes a row the original /auto-edit request just
      // confirmed (stamp set editCreditsCharged) - so we never refund a charge
      // for an edit that is now genuinely enqueued. Losers / confirmed rows match
      // 0 rows and are skipped.
      const [claimed] = await db
        .update(videoJobsTable)
        .set({ editStatus: "failed", editErrorMessage: "Auto-edit could not be enqueued" })
        .where(
          and(
            eq(videoJobsTable.id, job.id),
            eq(videoJobsTable.editStatus, "pending"),
            sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
          ),
        )
        .returning();
      if (!claimed) continue;

      const meta =
        claimed.metadata && typeof claimed.metadata === "object"
          ? (claimed.metadata as Record<string, unknown>)
          : {};
      const attemptNo = typeof meta["editAttempts"] === "number" ? (meta["editAttempts"] as number) : null;
      // Refund only if a debit actually committed for the current attempt - a row
      // stranded BEFORE its debit (claim set, process died pre-debit) has no charge
      // to return, so refunding it would mint phantom credits. Refund is idempotent
      // on its key. If the refund itself fails, roll the claim back to 'pending' so
      // the next tick retries instead of leaving a 'failed' row whose charge was
      // never returned.
      if (attemptNo != null && claimed.portalUserId != null) {
        const debitKey = `edit:${claimed.id}:${attemptNo}`;
        const [debit] = await db
          .select({ id: videoCreditTransactionsTable.id })
          .from(videoCreditTransactionsTable)
          .where(eq(videoCreditTransactionsTable.idempotencyKey, debitKey))
          .limit(1);
        if (debit) {
          try {
            await refundVideoCredits({
              portalUserId: claimed.portalUserId,
              amount: EDIT_CREDITS_COST,
              reason: "auto-edit could not be enqueued",
              refType: "video_job_edit",
              refId: String(claimed.id),
              idempotencyKey: `refund:edit:${claimed.id}:${attemptNo}`,
            });
          } catch (refundErr) {
            // Roll the claim back to 'pending' so the next tick retries - but
            // compare-and-set on the SAME attempt + the 'failed' state + still
            // unconfirmed, so we never overwrite a row a concurrent retry has
            // already advanced to attempt N+1 (which would orphan attempt N's
            // identity). If a retry won, this matches 0 rows and we leave it be.
            await db
              .update(videoJobsTable)
              .set({ editStatus: "pending", editErrorMessage: null })
              .where(
                and(
                  eq(videoJobsTable.id, claimed.id),
                  eq(videoJobsTable.editStatus, "failed"),
                  sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
                  sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
                ),
              )
              .catch(() => {});
            throw refundErr;
          }
        }
      }
      result.editsReconciled++;
    } catch (err) {
      result.errors++;
      logger.error(
        { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
        "[video-poller] failed to reconcile unconfirmed edit",
      );
    }
  }

  // Sweep stuck auto-edits: editStatus pending/editing with no Remotion
  // webhook past EDIT_TIMEOUT_MS. updatedAt is bumped when the edit starts, so
  // it is the safest staleness signal here.
  const editCutoff = new Date(Date.now() - EDIT_TIMEOUT_MS);
  const stuckEdits: VideoJob[] = await db
    .select()
    .from(videoJobsTable)
    .where(
      and(
        inArray(videoJobsTable.editStatus, ["editing", "pending"]),
        lt(videoJobsTable.updatedAt, editCutoff),
        isNull(videoJobsTable.deletedAt),
      ),
    )
    .orderBy(asc(videoJobsTable.updatedAt))
    .limit(BATCH_LIMIT);
  for (const job of stuckEdits) {
    result.scanned++;
    try {
      await failEditAndRefund(job, "Auto-edit timed out");
      result.editsTimedOut++;
    } catch (err) {
      result.errors++;
      logger.error(
        { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
        "[video-poller] failed to time out edit",
      );
    }
  }
  return result;
}

async function tick(): Promise<void> {
  if (disabled() || !isHeygenConfigured()) return;
  try {
    const result = await pollVideoJobsOnce();
    if (
      result.resolved > 0 ||
      result.timedOut > 0 ||
      result.editsTimedOut > 0 ||
      result.editsReconciled > 0 ||
      result.errors > 0
    ) {
      logger.info({ result }, "[video-poller] tick complete");
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[video-poller] tick failed",
    );
  }
}

export function startVideoJobPoller(): void {
  if (started) return;
  if (disabled()) {
    logger.info("[video-poller] disabled via VIDEO_POLLER_DISABLED=1");
    return;
  }
  if (!isHeygenConfigured()) {
    logger.info("[video-poller] HEYGEN_API_KEY not set; poller will not run");
    return;
  }
  started = true;
  const ms = intervalMs();
  logger.info({ intervalMs: ms }, "[video-poller] scheduler started");
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), ms);
    timer.unref?.();
  }, FIRST_DELAY_MS).unref?.();
}

export function stopVideoJobPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
