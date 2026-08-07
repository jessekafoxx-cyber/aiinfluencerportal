/**
 * AI Video Studio inbound webhooks (Task #828).
 *
 * Mounted at /api/video/webhook OUTSIDE the admin gate (HeyGen / Remotion
 * call these server-to-server, not as a logged-in admin). Authenticated by a
 * shared secret rather than the portal session.
 *
 * The webhook is an optimization: the Media Worker polling fallback fully
 * resolves every job even if a webhook is missed, so both paths converge on
 * resolveAndApplyHeygenStatus().
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, videoJobsTable } from "@workspace/db";
import { resolveAndApplyHeygenStatus } from "../lib/video-generation.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verify the shared secret from header or query against the env secret. */
function verifySecret(req: Request, envVar: string): boolean {
  const expected = process.env[envVar];
  if (!expected) return false; // never accept unauthenticated when unset
  const provided =
    (req.headers["x-webhook-secret"] as string | undefined) ||
    (typeof req.query.secret === "string" ? req.query.secret : "");
  return Boolean(provided) && constantTimeEqual(provided, expected);
}

/** POST /api/video/webhook/heygen - HeyGen completion callback. */
router.post("/heygen", async (req: Request, res: Response) => {
  if (!process.env.HEYGEN_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  if (!verifySecret(req, "HEYGEN_WEBHOOK_SECRET")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as {
    event_type?: string;
    event_data?: { video_id?: string };
  };
  const videoId = body.event_data?.video_id;
  if (!videoId) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.heygenVideoId, videoId))
    .limit(1);
  if (!job) {
    // Not one of ours (or already cleaned up) - ack so HeyGen stops retrying.
    res.status(200).json({ ok: true, matched: false });
    return;
  }

  // Ack immediately; resolve authoritative status out of band so a slow
  // storage download never makes HeyGen think the webhook failed.
  res.status(200).json({ ok: true });
  resolveAndApplyHeygenStatus(job).catch((err) => {
    req.log?.error(
      { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
      "[video] heygen webhook resolve failed",
    );
  });
});

// The Remotion auto-edit webhook was removed in Task #839. Edits now run as an
// in-Replit ffmpeg job on the media worker (lib/video-edit-worker.ts), so there
// is no external render service to call back. The worker writes editStatus +
// editedVideoUrl directly and the poller sweeps stuck edits.

export default router;
