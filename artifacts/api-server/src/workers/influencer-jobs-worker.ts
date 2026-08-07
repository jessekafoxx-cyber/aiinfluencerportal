// ─────────────────────────────────────────────────────────────────────────────
// Influencer-jobs worker tick.
//
// Runs in the Media Worker process. Every INFLUENCER_WORKER_INTERVAL_MS:
//   1. advanceQueuedJobs()  — dispatch Higgsfield for any new "queued" job.
//   2. finalizeReadyJobs()  — promote jobs whose pipeline finished AND
//                              eta_at has passed; replay any unnotified
//                              "ready" jobs (crash recovery).
//
// Honors AUTOMATION_WORKERS_DISABLED=1 alongside the rest of the worker
// host so a quiet env can be brought up without consuming jobs.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "../lib/logger";
import {
  advanceQueuedJobs,
  finalizeReadyJobs,
  pollHiggsfieldStuckJobs,
  resumeStuckScenes,
  runSceneJobsTick,
} from "../lib/influencer-pipeline";

let timer: NodeJS.Timeout | null = null;

export function startInfluencerJobsWorker(): void {
  if (timer) return;
  if (process.env.AUTOMATION_WORKERS_DISABLED === "1") {
    logger.warn("AUTOMATION_WORKERS_DISABLED=1 — skipping influencer-jobs worker");
    return;
  }
  const intervalMs = Number(process.env.INFLUENCER_WORKER_INTERVAL_MS ?? 30_000);
  const tick = async () => {
    try {
      await advanceQueuedJobs();
    } catch (err) {
      logger.error({ err }, "influencer-jobs worker: advanceQueuedJobs failed");
    }
    try {
      // Higgsfield outbound webhooks have proven unreliable on this
      // platform — self-poll the job-set status endpoint for any job
      // stuck in generating_base past the threshold and apply the
      // result through the same path the webhook would.
      await pollHiggsfieldStuckJobs();
    } catch (err) {
      logger.error({ err }, "influencer-jobs worker: pollHiggsfieldStuckJobs failed");
    }
    try {
      // Slice B: claim child scene-job rows under independent lease,
      // delegate to the single-scene engine, persist forensic outcome
      // onto the child row. Replaces the legacy inline fan-out for
      // any parent that has child rows; the legacy resumeStuckScenes
      // below remains as a no-op for those parents (it bows out via
      // hasChildSceneJobs) and as a safety net for in-flight rollbacks
      // of pre-Slice-B parents that never seeded child rows.
      const tickRes = await runSceneJobsTick(`worker-${process.pid}`);
      if (tickRes.claimed > 0 || tickRes.released > 0) {
        logger.info(
          { ...tickRes },
          "influencer-jobs worker: scene-jobs tick",
        );
      }
    } catch (err) {
      logger.error({ err }, "influencer-jobs worker: runSceneJobsTick failed");
    }
    try {
      // Worker-restart safety net for pre-Slice-B parents only: re-drive
      // scene fan-out for any swapping_scenes job whose scenes still have
      // eligible (pending/failed-under-cap with elapsed backoff) entries.
      // Slice B parents are skipped via the hasChildSceneJobs guard.
      await resumeStuckScenes();
    } catch (err) {
      logger.error({ err }, "influencer-jobs worker: resumeStuckScenes failed");
    }
    try {
      await finalizeReadyJobs();
    } catch (err) {
      logger.error({ err }, "influencer-jobs worker: finalizeReadyJobs failed");
    }
    // Re-arm with setTimeout (not setInterval) so a slow tick can not pile
    // up overlapping passes — same pattern as startPeriodicMediaProcessor.
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  // First tick fires after a short warm-up so the rest of the runtime
  // (DB pool, connectors) is ready.
  timer = setTimeout(tick, 5_000);
  timer.unref?.();
  logger.info({ intervalMs }, "influencer-jobs worker started");
}

export function stopInfluencerJobsWorker(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
