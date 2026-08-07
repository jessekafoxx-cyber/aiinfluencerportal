/**
 * Podcast auto-edit worker (Task #839).
 *
 * Runs ONLY on the media worker (never the autoscale web server). Atomically
 * claims the oldest video_jobs row with editStatus='pending' whose generation
 * is complete, runs the in-Replit ffmpeg podcast edit, and marks it
 * completed (+editedVideoUrl) or failed (+refund). ffmpeg is heavy, so it
 * processes one job per tick. The poller's 30-min stuck-edit sweep remains the
 * backstop for a crash mid-render.
 *
 * Kill switch: MEDIA_WORKERS_DISABLED=1. Interval: VIDEO_EDIT_WORKER_INTERVAL_MS
 * (default 15s).
 */

import { and, eq, sql } from "drizzle-orm";
import { db, videoJobsTable, type VideoJob } from "@workspace/db";
import { logger } from "./logger";
import { failEditAndRefund } from "./video-generation";
import { runPodcastEdit, isEditPipelineConfigured } from "./video-edit-pipeline";

let running = false;
let timer: NodeJS.Timeout | null = null;

async function claimNextPendingEdit(): Promise<VideoJob | null> {
  // SKIP LOCKED so multiple worker instances during a rolling restart never
  // grab the same job. Only claim jobs whose generation actually finished.
  const claimed = await db.execute<{ id: number }>(sql`
    UPDATE video_jobs
    SET edit_status = 'editing', updated_at = now()
    WHERE id = (
      SELECT id FROM video_jobs
      WHERE edit_status = 'pending'
        AND status = 'completed'
        AND raw_video_url IS NOT NULL
        AND deleted_at IS NULL
        AND (metadata->>'editCreditsCharged') IS NOT NULL
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const row = (claimed.rows ?? claimed)[0] as { id: number } | undefined;
  if (!row?.id) return null;
  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, row.id))
    .limit(1);
  return job ?? null;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = await claimNextPendingEdit();
    if (!job) return;
    logger.info({ jobId: job.id, style: job.editStyle }, "[video-edit-worker] claimed edit");
    const meta =
      job.metadata && typeof job.metadata === "object"
        ? (job.metadata as Record<string, unknown>)
        : {};
    const attemptNo = typeof meta["editAttempts"] === "number" ? (meta["editAttempts"] as number) : 1;
    try {
      const editedVideoUrl = await runPodcastEdit(job);
      // Guard on editStatus='editing' AND the SAME attempt: if the 30-min
      // stuck-edit sweep already timed this job out (failed + refunded) while we
      // were rendering - and a retry then advanced the row to attempt N+1 and a
      // sibling worker re-claimed it to 'editing' - the row no longer represents
      // OUR attempt, so it matches 0 rows and we DISCARD the late result instead
      // of overwriting N+1 with N's video (which would hand the buyer both an
      // edited video AND a refund, or clobber the newer attempt).
      const done = await db
        .update(videoJobsTable)
        .set({ editStatus: "completed", editedVideoUrl, editErrorMessage: null })
        .where(
          and(
            eq(videoJobsTable.id, job.id),
            eq(videoJobsTable.editStatus, "editing"),
            sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
          ),
        )
        .returning({ id: videoJobsTable.id });
      if (done.length === 0) {
        logger.warn(
          { jobId: job.id },
          "[video-edit-worker] edit finished but row is no longer 'editing' (timed out/refunded); discarding result",
        );
      } else {
        logger.info({ jobId: job.id }, "[video-edit-worker] edit completed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, err: msg }, "[video-edit-worker] edit failed");
      await failEditAndRefund(job, msg);
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[video-edit-worker] tick error",
    );
  } finally {
    running = false;
  }
}

export function startVideoEditWorker(): void {
  if (process.env["MEDIA_WORKERS_DISABLED"] === "1") {
    logger.info("[video-edit-worker] disabled via MEDIA_WORKERS_DISABLED");
    return;
  }
  if (!isEditPipelineConfigured()) {
    logger.warn(
      "[video-edit-worker] OPENAI_API_KEY missing; podcast edits will fail+refund until configured",
    );
  }
  const intervalMs = Number(process.env["VIDEO_EDIT_WORKER_INTERVAL_MS"]) || 15_000;
  if (timer) return;
  timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs }, "[video-edit-worker] started");
}
