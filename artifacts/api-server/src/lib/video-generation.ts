/**
 * AI Video Studio generation orchestration (Task #828).
 *
 * Shared by the generate route, the HeyGen webhook, and the worker polling
 * fallback so all three converge on ONE finalize/fail path:
 *   - getOrCreateTalkingPhoto: cache HeyGen photo-avatars in heygen_avatars
 *   - resolveAndApplyHeygenStatus: fetch authoritative HeyGen status for a job
 *     and either finalize (download to storage) or fail+refund - idempotent.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  heygenAvatarsTable,
  videoJobsTable,
  type VideoJob,
} from "@workspace/db";
import { logger } from "./logger";
import {
  getHeygenVideoStatus,
  uploadTalkingPhoto,
  EDIT_CREDITS_COST,
  type VideoAspectRatio,
} from "./heygen";
import {
  downloadRemoteToStorage,
  downloadSourceImageBytes,
  hashImageBytes,
} from "./video-storage";
import { refundVideoCredits } from "./video-credits";

export type { VideoAspectRatio };

/**
 * Resolve (or mint + cache) a HeyGen talking_photo_id for a source image.
 * Cache key is (portalUserId, sha256(image bytes)).
 */
export async function getOrCreateTalkingPhoto(opts: {
  portalUserId: number;
  influencerId: number | null;
  sourceImageUrl: string;
}): Promise<string> {
  const { buffer, contentType } = await downloadSourceImageBytes(opts.sourceImageUrl);
  const hash = hashImageBytes(buffer);

  const [existing] = await db
    .select()
    .from(heygenAvatarsTable)
    .where(
      and(
        eq(heygenAvatarsTable.portalUserId, opts.portalUserId),
        eq(heygenAvatarsTable.sourceImageHash, hash),
      ),
    )
    .limit(1);
  if (existing?.heygenAvatarId && existing.status === "ready") {
    return existing.heygenAvatarId;
  }

  const talkingPhotoId = await uploadTalkingPhoto(buffer, contentType);

  if (existing) {
    await db
      .update(heygenAvatarsTable)
      .set({ heygenAvatarId: talkingPhotoId, status: "ready", errorMessage: null })
      .where(eq(heygenAvatarsTable.id, existing.id));
  } else {
    await db
      .insert(heygenAvatarsTable)
      .values({
        portalUserId: opts.portalUserId,
        influencerId: opts.influencerId,
        sourceImageUrl: opts.sourceImageUrl,
        sourceImageHash: hash,
        heygenAvatarId: talkingPhotoId,
        status: "ready",
      })
      .onConflictDoUpdate({
        target: [heygenAvatarsTable.portalUserId, heygenAvatarsTable.sourceImageHash],
        set: { heygenAvatarId: talkingPhotoId, status: "ready", errorMessage: null },
      });
  }
  return talkingPhotoId;
}

async function finalizeCompletedJob(
  job: VideoJob,
  status: { videoUrl: string; thumbnailUrl: string | null; durationSeconds: number | null },
): Promise<VideoJob> {
  let storedVideoUrl: string;
  try {
    storedVideoUrl = await downloadRemoteToStorage(status.videoUrl, {
      prefix: "video.",
      fallbackExt: "mp4",
      fallbackContentType: "video/mp4",
    });
  } catch (err) {
    logger.error(
      { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
      "[video] failed to store HeyGen output, will retry on next poll",
    );
    return job; // leave generating; next poll/webhook retries the download
  }

  let storedThumbnailUrl: string | null = null;
  if (status.thumbnailUrl) {
    try {
      storedThumbnailUrl = await downloadRemoteToStorage(status.thumbnailUrl, {
        prefix: "thumb.",
        fallbackExt: "jpg",
        fallbackContentType: "image/jpeg",
      });
    } catch {
      storedThumbnailUrl = null; // non-fatal
    }
  }

  const [updated] = await db
    .update(videoJobsTable)
    .set({
      status: "completed",
      rawVideoUrl: storedVideoUrl,
      thumbnailUrl: storedThumbnailUrl,
      durationSeconds: status.durationSeconds,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(and(eq(videoJobsTable.id, job.id), eq(videoJobsTable.status, "generating")))
    .returning();
  return updated ?? job;
}

/**
 * Refund the generation cost (idempotent) and mark the job failed.
 */
export async function failJobAndRefund(
  job: VideoJob,
  errorMessage: string,
): Promise<VideoJob> {
  if (job.generationCreditsCost > 0 && job.refundedCredits < job.generationCreditsCost) {
    await refundVideoCredits({
      portalUserId: job.portalUserId,
      amount: job.generationCreditsCost,
      reason: "generation failed",
      refType: "video_job",
      refId: String(job.id),
      idempotencyKey: `refund:gen:${job.id}`,
    });
  }
  const [updated] = await db
    .update(videoJobsTable)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 1000),
      refundedCredits: job.generationCreditsCost,
    })
    .where(eq(videoJobsTable.id, job.id))
    .returning();
  return updated ?? job;
}

/**
 * Fail a stuck auto-edit and refund its edit credits. Idempotent per render
 * attempt (refund keyed by remotionRenderId || job id), and the editStatus
 * transition out of "editing"/"pending" stops any later sweep from re-firing.
 */
export async function failEditAndRefund(
  job: VideoJob,
  errorMessage: string,
): Promise<VideoJob> {
  // The edit_credits_cost column is INTEGER and cannot hold the fractional
  // 0.5-credit charge, so refunds are driven off the EDIT_CREDITS_COST constant
  // (the ledger supports fractional sub-units). The editStatus gate stops a
  // completed edit from ever being refunded; refundVideoCredits is also
  // idempotent on its key, so timeout-sweep + worker can't double-refund. The key
  // is per-attempt (metadata.editAttempts, stamped by /auto-edit at debit time) so
  // a retried edit refunds the attempt it actually charged - a stable per-job key
  // would dedupe the second attempt's refund and silently keep the charge.
  // Only refund a CONFIRMED charge. metadata.editCreditsCharged is stamped by
  // /auto-edit only after the debit commits, so a job swept while 'pending' before
  // the debit landed (claimed-but-never-charged) is reset to 'failed' WITHOUT a
  // spurious refund that would credit a balance that never paid.
  const meta =
    job.metadata && typeof job.metadata === "object"
      ? (job.metadata as Record<string, unknown>)
      : {};
  const chargeConfirmed = meta["editCreditsCharged"] != null;
  const attemptNo = typeof meta["editAttempts"] === "number" ? (meta["editAttempts"] as number) : 1;
  if ((job.editStatus === "editing" || job.editStatus === "pending") && chargeConfirmed) {
    await refundVideoCredits({
      portalUserId: job.portalUserId,
      amount: EDIT_CREDITS_COST,
      reason: "auto-edit failed",
      refType: "video_job_edit",
      refId: String(job.id),
      idempotencyKey: `refund:edit:${job.id}:${attemptNo}`,
    });
  }
  // Compare-and-set on the SAME attempt + an in-flight edit state. A late/stuck
  // worker for attempt N must not overwrite a row a retry already advanced to
  // attempt N+1 (which would clobber N+1's pending/editing state to 'failed' and
  // strand N+1's charge). 0 rows -> no-op, return the row we were handed.
  const [updated] = await db
    .update(videoJobsTable)
    .set({
      editStatus: "failed",
      editErrorMessage: errorMessage.slice(0, 1000),
    })
    .where(
      and(
        eq(videoJobsTable.id, job.id),
        inArray(videoJobsTable.editStatus, ["editing", "pending"]),
        sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
      ),
    )
    .returning();
  return updated ?? job;
}

/**
 * Fetch authoritative HeyGen status for a job and apply it. Idempotent:
 * no-op when the job is no longer "generating" or has no heygenVideoId.
 * Used by the webhook and the worker poll alike.
 */
export async function resolveAndApplyHeygenStatus(job: VideoJob): Promise<VideoJob> {
  if (job.status !== "generating" || !job.heygenVideoId) return job;
  const status = await getHeygenVideoStatus(job.heygenVideoId);
  if (status.state === "completed") {
    return finalizeCompletedJob(job, status);
  }
  if (status.state === "failed") {
    return failJobAndRefund(job, status.errorMessage);
  }
  return job; // still pending
}
