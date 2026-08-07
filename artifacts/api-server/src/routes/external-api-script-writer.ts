// External API - Script Writer SOP generation endpoints.
//
// Mounted into externalApiRouter (which already validates x-api-key via
// requireExternalApiKey). Lets a partner agent async-generate the seven
// text/structured Script Writer SOPs (podcast clips, speaking clips,
// selfie yapping, viral slideshows, viral carousels, overlay clips,
// fast-motion clips) on behalf of a buyer, resolved by email - plus the
// matching seven "ideas" variants (podcast-ideas, speaking-ideas,
// selfie-ideas, slideshow-ideas, carousel-ideas, overlay-ideas,
// fastmotion-ideas) so partners can fetch topic ideas before generating
// a full script.
//
// The generation logic is NOT duplicated here. Each SOP's portal handler
// is imported from ./portal and invoked in-process behind a synthetic
// Express req/res pair so the prompts, brain resolution, scrubbing, and
// job enqueue stay single-sourced. The handlers respond 202 { jobId };
// the same job row is then polled via GET .../jobs/:id.
//
// Job ownership is keyed off a deterministic owner key derived from the
// buyer's email (their Clerk id when present, else `ext:<portalUserId>`)
// so submit + poll always resolve the same owner and never collide with
// in-portal jobs.

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getScriptJob, type ScriptJobType } from "../lib/script-jobs";
import { ensurePortalUserByEmail, resolveAppUserIdForPortalUser } from "./external-api";
import type { AuditWriter } from "./external-api-influencers";
import {
  podcastClipHandler,
  speakingClipHandler,
  selfieClipHandler,
  slideshowHandler,
  carouselHandler,
  overlayHandler,
  fastmotionHandler,
  podcastIdeasHandler,
  speakingIdeasHandler,
  selfieIdeasHandler,
  slideshowIdeasHandler,
  carouselIdeasHandler,
  overlayIdeasHandler,
  fastmotionIdeasHandler,
} from "./portal";

// The fourteen text/structured SOPs this endpoint can generate: the seven
// full-script SOPs plus their matching "ideas" variants. Image SOPs
// (green-screen, hook-demo, and their *-ideas) are intentionally excluded
// - they need file uploads / a different surface.
const SOP_HANDLERS: Record<string, (req: any, res: any) => Promise<void> | void> = {
  "podcast-clip": podcastClipHandler,
  "speaking-clip": speakingClipHandler,
  "selfie-clip": selfieClipHandler,
  slideshow: slideshowHandler,
  carousel: carouselHandler,
  overlay: overlayHandler,
  fastmotion: fastmotionHandler,
  "podcast-ideas": podcastIdeasHandler,
  "speaking-ideas": speakingIdeasHandler,
  "selfie-ideas": selfieIdeasHandler,
  "slideshow-ideas": slideshowIdeasHandler,
  "carousel-ideas": carouselIdeasHandler,
  "overlay-ideas": overlayIdeasHandler,
  "fastmotion-ideas": fastmotionIdeasHandler,
};

const VALID_SOPS = Object.keys(SOP_HANDLERS) as ScriptJobType[];

// Immutable, deterministic owner key for an external job. Always keyed
// off `portal_users.id` (which never changes for an email) - NOT clerkId.
// Using clerkId would orphan a job if the buyer signs in (gets a clerkId)
// between submit and poll, since the recomputed key would no longer match
// the stamped row. The `ext:` prefix also keeps external jobs strictly
// isolated from in-portal jobs (those are keyed by the real Clerk id).
function ownerKeyFor(portalUser: { id: number }): string {
  return `ext:${portalUser.id}`;
}

// Minimal Express-response collector. The portal handlers only ever call
// res.status(n).json(payload) (or res.json(payload)); we capture both so
// the caller can forward the status + body.
function makeResCollector() {
  const captured: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  const res: any = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      captured.body = payload;
      return res;
    },
  };
  return { res, captured };
}

export function createScriptWriterApiRoutes(writeAudit: AuditWriter): IRouter {
  const router: IRouter = Router();

  // POST /generate/script
  // Body: { email, sop, input } where `input` is the SOP-specific payload
  // (e.g. { context, tone, influencerId, ... }) that the in-portal page
  // would normally POST. Returns 202 { jobId, sop, ownerKey } on success.
  router.post("/generate/script", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || "").trim();
    const sop = String(body.sop || "").trim();
    const input =
      body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};

    if (!email) {
      await writeAudit({ req, action: "generate.script", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email", message: "email is required" });
      return;
    }
    if (!sop || !(sop in SOP_HANDLERS)) {
      await writeAudit({
        req,
        action: "generate.script",
        targetEmail: email,
        statusCode: 400,
        errorCode: "invalid_sop",
      });
      res.status(400).json({
        error: "invalid_sop",
        message: `sop must be one of: ${VALID_SOPS.join(", ")}`,
      });
      return;
    }

    try {
      const portalUser = await ensurePortalUserByEmail(email);
      const appUserId = await resolveAppUserIdForPortalUser({
        clerkId: portalUser.clerkId,
        email: portalUser.email,
      });
      const ownerKey = ownerKeyFor(portalUser);

      // Synthetic request matching exactly the fields the portal handlers
      // (and resolvePodcastBrain) read: body, clerkId, log, portalUser,
      // appUser. The owner key flows in as clerkId so enqueueScriptJob
      // stamps it on the row for later polling.
      const synthReq: any = {
        body: input,
        clerkId: ownerKey,
        log: logger,
        portalUser,
        appUser: appUserId != null ? { id: appUserId } : null,
      };

      const { res: synthRes, captured } = makeResCollector();
      await SOP_HANDLERS[sop](synthReq, synthRes);

      const statusCode = captured.statusCode || 200;
      const payload = (captured.body || {}) as Record<string, unknown>;

      if (statusCode === 202 && payload.jobId != null) {
        await writeAudit({
          req,
          action: "generate.script",
          targetEmail: email,
          statusCode: 202,
          reason: sop,
        });
        res.status(202).json({ jobId: payload.jobId, sop, ownerKey });
        return;
      }

      // Handler rejected (e.g. no Brain, validation error). Forward the
      // handler's own status + body so the caller sees the real reason.
      await writeAudit({
        req,
        action: "generate.script",
        targetEmail: email,
        statusCode,
        errorCode: "handler_rejected",
        reason: sop,
      });
      res.status(statusCode).json(payload);
      return;
    } catch (err) {
      logger.error({ err, email, sop }, "[external-api] generate.script failed");
      await writeAudit({
        req,
        action: "generate.script",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  // GET /generate/script/jobs/:id?email=...
  // Polls a previously-enqueued job. Ownership is enforced by resolving
  // the same deterministic owner key from the email and filtering on it.
  router.get("/generate/script/jobs/:id", async (req: Request, res: Response) => {
    const email = String(req.query.email || "").trim();
    const id = Number(req.params.id);

    if (!email) {
      await writeAudit({ req, action: "generate.script.poll", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email", message: "email is required" });
      return;
    }
    if (!Number.isFinite(id)) {
      await writeAudit({
        req,
        action: "generate.script.poll",
        targetEmail: email,
        statusCode: 400,
        errorCode: "bad_id",
      });
      res.status(400).json({ error: "bad_id" });
      return;
    }

    try {
      const portalUser = await ensurePortalUserByEmail(email);
      const ownerKey = ownerKeyFor(portalUser);
      const job = await getScriptJob(ownerKey, id);
      if (!job) {
        await writeAudit({
          req,
          action: "generate.script.poll",
          targetEmail: email,
          statusCode: 404,
          errorCode: "not_found",
        });
        res.status(404).json({ error: "not_found" });
        return;
      }
      await writeAudit({ req, action: "generate.script.poll", targetEmail: email, statusCode: 200 });
      res.json({
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          progressPct: job.progressPct,
          stage: job.stage,
          result: job.status === "succeeded" ? job.result : null,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });
      return;
    } catch (err) {
      logger.error({ err, email, id }, "[external-api] generate.script.poll failed");
      await writeAudit({
        req,
        action: "generate.script.poll",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  return router;
}
