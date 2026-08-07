// Task #708: External API — Influencer management endpoints.
//
// Mounted into externalApiRouter (which already validates x-api-key
// via requireExternalApiKey). Lets the partner agent (Viktor) walk
// the full influencer lifecycle so the internal Higgsfield/Enhancor
// pipeline can stay disabled while a human runs generation off-platform.

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  portalUsersTable,
  appUsers,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
  aiInfluencerJobsTable,
  portalNotificationsTable,
} from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage";
import { ensurePortalUserByEmail } from "./external-api";
import { validateCustomName, withDisplayName } from "./influencers";

const ALLOWED_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];

function pickExt(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "png";
}

async function uploadBase64Image(
  b64: string,
  mimeType: string,
  prefix = "",
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error("object_storage_not_configured");
  }
  const ext = pickExt(mimeType);
  if (!ALLOWED_EXTS.includes(ext)) {
    throw new Error("unsupported_image_type");
  }
  const buffer = Buffer.from(b64, "base64");
  const fileName = `${prefix}${crypto.randomUUID()}.${ext}`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    contentType: mimeType,
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  return `/api/portal/images/${fileName}`;
}

async function findPortalUserByEmail(email: string) {
  const lower = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, lower))
    .limit(1);
  return user ?? null;
}

// ai_influencers.client_id FKs to app_users.id (clientsTable is just an
// alias for appUsers). portal_users.id and app_users.id have independent
// serial sequences (same Task #362 drift gotcha documented in
// influencer-jobs.ts) so any influencer write keyed off portal_users.id
// silently violates the FK for any account whose ids don't coincide. We
// only resolve, never create - the buyer's app_users row is provisioned
// by Clerk on first sign-in and we won't have a clerkId here.
async function findAppUserByEmail(email: string) {
  const lower = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, lower))
    .limit(1);
  return user ?? null;
}

// Resolve an app_users.id to its email. Used by the forJobId path
// of POST /influencers to surface the buyer's email for downstream
// portal_users ensure + audit context. Authoritative because
// ai_influencer_jobs.client_id is FK-constrained to app_users.id.
async function emailForAppUserId(appUserId: number): Promise<string | null> {
  const [a] = await db
    .select({ email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, appUserId))
    .limit(1);
  return a?.email ? a.email.trim().toLowerCase() : null;
}

export type AuditWriter = (opts: {
  req: Request;
  action: string;
  targetEmail?: string;
  statusCode: number;
  errorCode?: string;
  errorMessage?: string;
  requestBody?: unknown;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string;
}) => Promise<void>;

export function createInfluencerApiRoutes(writeAudit: AuditWriter): IRouter {
  const router: IRouter = Router();

  // GET /influencer-jobs?status=queued&limit=50
  router.get("/influencer-jobs", async (req: Request, res: Response) => {
    const status = String(req.query.status || "queued").trim();
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    try {
      const jobs = await db
        .select({
          id: aiInfluencerJobsTable.id,
          clientId: aiInfluencerJobsTable.clientId,
          status: aiInfluencerJobsTable.status,
          prefs: aiInfluencerJobsTable.prefs,
          influencerId: aiInfluencerJobsTable.influencerId,
          isFreeTier: aiInfluencerJobsTable.isFreeTier,
          etaAt: aiInfluencerJobsTable.etaAt,
          createdAt: aiInfluencerJobsTable.createdAt,
        })
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.status, status))
        .orderBy(aiInfluencerJobsTable.createdAt)
        .limit(limit);

      const clientIds = [...new Set(jobs.map((j) => j.clientId))];
      const users = clientIds.length > 0
        ? await db
            .select({ id: portalUsersTable.id, email: portalUsersTable.email })
            .from(portalUsersTable)
            .where(inArray(portalUsersTable.id, clientIds))
        : [];
      const emailMap = new Map(users.map((u) => [u.id, u.email]));
      const enriched = jobs.map((j) => ({ ...j, email: emailMap.get(j.clientId) ?? null }));
      res.json({ jobs: enriched, count: enriched.length });
      await writeAudit({ req, action: "influencer-jobs.list", statusCode: 200 });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer-jobs list failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer-jobs.list",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // GET /influencer-jobs/:id
  router.get("/influencer-jobs/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencer-jobs.get", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    try {
      const [job] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, id))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencer-jobs.get", statusCode: 404, errorCode: "not_found" });
        return;
      }
      const [user] = await db
        .select({ id: portalUsersTable.id, email: portalUsersTable.email })
        .from(portalUsersTable)
        .where(eq(portalUsersTable.id, job.clientId))
        .limit(1);
      // Task #725: expose the persisted master reference image so Viktor
      // (or any future partner pipeline) renders every scene and angle
      // against the SAME face. enhancedImageUrl (Enhancor output) wins
      // when present; otherwise fall back to baseImageUrl (Higgsfield
      // master). Both are GCS-mirrored public URLs.
      const referenceImageUrl = job.enhancedImageUrl ?? job.baseImageUrl ?? null;
      res.json({
        job: {
          id: job.id,
          clientId: job.clientId,
          email: user?.email ?? null,
          status: job.status,
          prefs: job.prefs,
          influencerId: job.influencerId,
          isFreeTier: job.isFreeTier,
          etaAt: job.etaAt,
          progress: job.progress,
          createdAt: job.createdAt,
          referenceImageUrl,
          baseImageUrl: job.baseImageUrl ?? null,
          enhancedImageUrl: job.enhancedImageUrl ?? null,
        },
      });
      await writeAudit({ req, action: "influencer-jobs.get", statusCode: 200, targetEmail: user?.email });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer-jobs get failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer-jobs.get",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencer-jobs/:id/claim
  router.post("/influencer-jobs/:id/claim", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencer-jobs.claim", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    try {
      const [job] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, id))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencer-jobs.claim", statusCode: 404, errorCode: "not_found" });
        return;
      }
      if (job.status !== "queued") {
        res.status(409).json({
          error: "not_claimable",
          message: `Job is in status "${job.status}", expected "queued".`,
        });
        await writeAudit({
          req,
          action: "influencer-jobs.claim",
          statusCode: 409,
          errorCode: "not_claimable",
          beforeState: { status: job.status },
        });
        return;
      }
      const [updated] = await db
        .update(aiInfluencerJobsTable)
        .set({
          status: "generating_base",
          stageStartedAt: new Date(),
          heartbeatAt: new Date(),
        })
        .where(
          and(
            eq(aiInfluencerJobsTable.id, id),
            eq(aiInfluencerJobsTable.status, "queued"),
          ),
        )
        .returning();
      if (!updated) {
        res.status(409).json({ error: "claim_race", message: "Another worker claimed it first." });
        await writeAudit({ req, action: "influencer-jobs.claim", statusCode: 409, errorCode: "claim_race" });
        return;
      }
      res.json({ job: { id: updated.id, status: updated.status } });
      await writeAudit({
        req,
        action: "influencer-jobs.claim",
        statusCode: 200,
        afterState: { jobId: updated.id, status: updated.status },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer-jobs claim failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer-jobs.claim",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencer-jobs/:id/complete
  const completeJobBody = z.object({
    influencerId: z.number(),
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencer-jobs/:id/complete", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencer-jobs.complete", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = completeJobBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({
        req,
        action: "influencer-jobs.complete",
        statusCode: 400,
        errorCode: "bad_body",
        requestBody: req.body,
      });
      return;
    }
    try {
      const [job] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, id))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencer-jobs.complete", statusCode: 404, errorCode: "not_found" });
        return;
      }

      // Existence check only. The whole external-api-influencers router
      // is mounted behind requireExternalApiKey (see routes/external-api.ts),
      // so every request here is the trusted admin/Viktor API key - it is
      // allowed to complete any job regardless of which buyer currently
      // owns the influencer row. The prior cross-buyer ownership guard
      // (job.clientId === influencer.clientId) was blocking ~23 stuck
      // customer jobs whose influencers were minted under a different
      // clientId by the admin pipeline; the buyer-facing /complete path
      // does not exist outside this admin router, so dropping the check
      // here cannot expose end users to cross-account writes.
      const [influencer] = await db
        .select({ id: aiInfluencersTable.id, clientId: aiInfluencersTable.clientId })
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, parsed.data.influencerId))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "influencer_not_found" });
        await writeAudit({
          req,
          action: "influencer-jobs.complete",
          statusCode: 404,
          errorCode: "influencer_not_found",
        });
        return;
      }

      // Transactional: status flip, influencer activation, and the
      // ready notification land atomically so we never end up in
      // "ready job + no notification" (or vice versa).
      const updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(aiInfluencerJobsTable)
          .set({
            status: "ready",
            influencerId: parsed.data.influencerId,
            progress: 100,
            completedAt: new Date(),
            notifiedAt: new Date(),
          })
          .where(eq(aiInfluencerJobsTable.id, id))
          .returning();
        await tx
          .update(aiInfluencersTable)
          .set({ status: "active" })
          .where(eq(aiInfluencersTable.id, parsed.data.influencerId));
        // Match the legacy ready notification contract exactly so the
        // buyer's portal toast / inbox row is identical to the
        // in-process pipeline + manual-deliver paths
        // (lib/influencer-pipeline.ts + routes/admin-influencer-generations.ts).
        const href = parsed.data.influencerId
          ? `/influencer/${parsed.data.influencerId}`
          : "/your-influencers";
        await tx.insert(portalNotificationsTable).values({
          clientId: job.clientId,
          type: "influencer_ready",
          title: "Your AI influencer is ready",
          body: "Our team finished building your AI influencer. Tap to open the workspace.",
          payload: { jobId: id, influencerId: parsed.data.influencerId },
          href,
        });
        return u;
      });

      res.json({
        job: { id: updated!.id, status: updated!.status, influencerId: updated!.influencerId },
      });
      await writeAudit({
        req,
        action: "influencer-jobs.complete",
        statusCode: 200,
        reason: parsed.data.reason,
        beforeState: { status: job.status },
        afterState: { jobId: id, influencerId: parsed.data.influencerId, status: "ready" },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer-jobs complete failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer-jobs.complete",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason: parsed.data.reason,
      });
    }
  });

  // PATCH /influencer/:id/name
  // Admin (support agent) rename. Same validation as the buyer-facing
  // PATCH /api/influencers/:id/name route but no ownership check (the
  // x-api-key gate is the auth boundary). Writes the `custom_name`
  // column so the auto-name dedupe index keeps working and every
  // existing UI surfaces the new name without code changes.
  const adminRenameBody = z.object({
    name: z.string(),
    reason: z.string().min(1).max(500),
  });
  router.patch("/influencer/:id/name", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencer.rename", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = adminRenameBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({
        req,
        action: "influencer.rename",
        statusCode: 400,
        errorCode: "bad_body",
        requestBody: req.body,
      });
      return;
    }
    const validation = validateCustomName(parsed.data.name);
    if (!validation.ok) {
      res.status(400).json({ error: validation.code });
      await writeAudit({
        req,
        action: "influencer.rename",
        statusCode: 400,
        errorCode: validation.code,
        requestBody: req.body,
        reason: parsed.data.reason,
      });
      return;
    }
    try {
      const [existing] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({
          req,
          action: "influencer.rename",
          statusCode: 404,
          errorCode: "not_found",
          requestBody: req.body,
          reason: parsed.data.reason,
        });
        return;
      }
      const previousName = existing.customName?.trim()
        ? existing.customName
        : existing.name;
      const buyerEmail = await emailForAppUserId(existing.clientId);
      const [row] = await db
        .update(aiInfluencersTable)
        .set({ customName: validation.value })
        .where(eq(aiInfluencersTable.id, id))
        .returning();
      res.json({
        id: row.id,
        customName: row.customName,
        previousName,
        influencer: withDisplayName(row),
      });
      await writeAudit({
        req,
        action: "influencer.rename",
        targetEmail: buyerEmail ?? undefined,
        statusCode: 200,
        requestBody: req.body,
        beforeState: { customName: existing.customName, name: existing.name },
        afterState: { customName: row.customName, name: row.name },
        reason: parsed.data.reason,
      });
    } catch (err) {
      req.log.error({ err, id }, "[external-api] influencer rename failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer.rename",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        requestBody: req.body,
        reason: parsed.data.reason,
      });
    }
  });

  // GET /influencers?email=...
  router.get("/influencers", async (req: Request, res: Response) => {
    const email = String(req.query.email || "").trim();
    if (!email) {
      res.status(400).json({ error: "missing_email" });
      await writeAudit({ req, action: "influencers.list", statusCode: 400, errorCode: "missing_email" });
      return;
    }
    try {
      const user = await findAppUserByEmail(email);
      if (!user) {
        res.json({ influencers: [], found: false });
        await writeAudit({ req, action: "influencers.list", targetEmail: email, statusCode: 200 });
        return;
      }
      const rows = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.clientId, user.id))
        .orderBy(desc(aiInfluencersTable.createdAt));
      res.json({ influencers: rows, found: true });
      await writeAudit({ req, action: "influencers.list", targetEmail: email, statusCode: 200 });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencers list failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.list",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencers
  //
  // `forJobId` is the preferred way to call this endpoint: it pins the
  // resulting influencer to the same buyer as the job, regardless of
  // what `email` resolves to. This avoids the cross-buyer hazard
  // documented on the /complete handler (the legacy portal_users.id
  // vs app_users.id drift). When `forJobId` is supplied we resolve
  // the buyer's email from the job's clientId via emailForClientId()
  // (app_users first, then portal_users fallback), then look up the
  // canonical app_users row for that email. The body's `email` is
  // still accepted for back-compat but is overridden by the job's
  // resolved email when both are supplied.
  const createInfluencerBody = z.object({
    email: z.string().email().optional(),
    forJobId: z.number().int().positive().optional(),
    name: z.string().min(1).max(100),
    gender: z.string().optional(),
    ageRange: z.string().optional(),
    niche: z.string().optional(),
    reason: z.string().min(1).max(500).optional(),
  }).refine((d) => Boolean(d.email || d.forJobId), {
    message: "Either `email` or `forJobId` must be supplied.",
    path: ["email"],
  });
  router.post("/influencers", async (req: Request, res: Response) => {
    const parsed = createInfluencerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({
        req,
        action: "influencers.create",
        statusCode: 400,
        errorCode: "bad_body",
        requestBody: req.body,
      });
      return;
    }
    const { email: bodyEmail, forJobId, name, gender, ageRange, niche, reason } = parsed.data;
    let email = bodyEmail ?? "";
    try {
      // forJobId path: the job is the source of truth for the buyer.
      // ai_influencer_jobs.client_id is FK-constrained to app_users.id
      // so we trust it directly - no email-roundtrip ambiguity. We
      // still resolve the email purely so ensurePortalUserByEmail()
      // below can keep the portal_users row in sync and the audit
      // captures a human-readable target.
      let pinnedAppUserId: number | null = null;
      if (forJobId) {
        const [job] = await db
          .select({ id: aiInfluencerJobsTable.id, clientId: aiInfluencerJobsTable.clientId })
          .from(aiInfluencerJobsTable)
          .where(eq(aiInfluencerJobsTable.id, forJobId))
          .limit(1);
        if (!job) {
          res.status(404).json({ error: "job_not_found", message: `No ai_influencer_jobs row with id=${forJobId}.` });
          await writeAudit({
            req,
            action: "influencers.create",
            statusCode: 404,
            errorCode: "job_not_found",
            requestBody: req.body,
          });
          return;
        }
        const resolved = await emailForAppUserId(job.clientId);
        if (!resolved) {
          // Should be unreachable while the FK is enforced - kept as
          // a defensive 500 since a missing email means the canonical
          // identity row is gone and we cannot safely continue.
          res.status(500).json({ error: "job_buyer_email_missing", message: `Job ${forJobId} has client_id=${job.clientId} in app_users but no email column set.` });
          await writeAudit({
            req,
            action: "influencers.create",
            statusCode: 500,
            errorCode: "job_buyer_email_missing",
            requestBody: req.body,
          });
          return;
        }
        email = resolved;
        pinnedAppUserId = job.clientId;
      }
      if (!email) {
        // Zod refine() guarantees this is unreachable, but guard
        // explicitly so a future refactor that drops the refine()
        // doesn't silently coerce to "".
        res.status(400).json({ error: "missing_email" });
        await writeAudit({
          req,
          action: "influencers.create",
          statusCode: 400,
          errorCode: "missing_email",
          requestBody: req.body,
        });
        return;
      }
      // Ensure a portal_users row exists (so any downstream portal UX
      // works) but resolve the FK target from app_users, since
      // ai_influencers.client_id references app_users.id, not
      // portal_users.id. See findAppUserByEmail() comment.
      await ensurePortalUserByEmail(email);
      // forJobId path already pinned the authoritative app_users.id
      // from the job's FK-constrained column; skip the email lookup
      // (which is non-unique by DB constraint and could resolve to a
      // different app_users row in the email-collision case).
      let clientId: number;
      if (pinnedAppUserId !== null) {
        clientId = pinnedAppUserId;
      } else {
        const user = await findAppUserByEmail(email);
        if (!user) {
          res.status(404).json({ error: "user_not_found", message: "No app_users row for email. Buyer must sign in via Clerk at least once before an influencer can be created." });
          await writeAudit({
            req,
            action: "influencers.create",
            targetEmail: email,
            statusCode: 404,
            errorCode: "user_not_found",
            requestBody: req.body,
          });
          return;
        }
        clientId = user.id;
      }
      const [row] = await db
        .insert(aiInfluencersTable)
        .values({
          clientId,
          name,
          gender: gender ?? null,
          ageRange: ageRange ?? null,
          niche: niche ?? null,
          status: "active",
        })
        .returning();
      res.status(201).json({ influencer: row });
      await writeAudit({
        req,
        action: "influencers.create",
        targetEmail: email,
        statusCode: 201,
        reason,
        afterState: { influencerId: row.id, clientId, forJobId: forJobId ?? null },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer create failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.create",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason,
      });
    }
  });

  // POST /influencers/:id/main-image
  const mainImageBody = z.object({
    image: z.string().min(1),
    mimeType: z.string().default("image/png"),
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencers/:id/main-image", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.main-image.upload", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = mainImageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.main-image.upload", statusCode: 400, errorCode: "bad_body" });
      return;
    }
    try {
      const [influencer] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencers.main-image.upload", statusCode: 404, errorCode: "not_found" });
        return;
      }
      const url = await uploadBase64Image(parsed.data.image, parsed.data.mimeType, "inf-main-");
      const [updated] = await db
        .update(aiInfluencersTable)
        .set({ avatarUrl: url })
        .where(eq(aiInfluencersTable.id, id))
        .returning();
      res.json({ influencer: updated });
      await writeAudit({
        req,
        action: "influencers.main-image.upload",
        statusCode: 200,
        reason: parsed.data.reason,
        afterState: { influencerId: id, avatarUrl: url },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer main-image upload failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.main-image.upload",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason: parsed.data.reason,
      });
    }
  });

  // POST /influencers/:id/angles/batch
  const angleItem = z.object({
    image: z.string().min(1),
    mimeType: z.string().default("image/png"),
    label: z.string().optional(),
  });
  const anglesBatchBody = z.object({
    angles: z.array(angleItem).min(1).max(20),
    reason: z.string().min(1).max(500).optional(),
    // Bug-fix (Darren Nicholl, influencer 10): on retry deliveries Viktor's
    // pipeline used to append a fresh 10-angle batch on top of the prior
    // batch, so influencers built more than once ended up with 30/40/90
    // angles. Set replace=true on every retry delivery to wipe prior
    // angles for this influencer before inserting. Default false stays
    // backwards-compatible with the first-delivery path.
    replace: z.boolean().optional().default(false),
  });
  router.post("/influencers/:id/angles/batch", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.angles.upload", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = anglesBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.angles.upload", statusCode: 400, errorCode: "bad_body" });
      return;
    }
    try {
      const [influencer] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencers.angles.upload", statusCode: 404, errorCode: "not_found" });
        return;
      }
      // Upload every image BEFORE we touch the DB so an upload failure
      // never leaves the influencer with a destructive delete and no
      // replacement rows. Each successful upload is paired with its
      // payload so the transactional swap below is a single decision.
      const uploads: Array<{ label: string | null; url: string }> = [];
      for (const item of parsed.data.angles) {
        const url = await uploadBase64Image(item.image, item.mimeType, "inf-angle-");
        uploads.push({ label: item.label ?? null, url });
      }
      // Race-safe swap: a transaction-scoped advisory lock (same namespace
      // as composeIdentityAngles in lib/influencer-pipeline.ts) serializes
      // concurrent Viktor calls for the same influencer, so two
      // simultaneous replace=true posts can never both wipe-and-insert.
      const { inserted, replacedCount } = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(733801, ${id})`);
        let replaced = 0;
        if (parsed.data.replace) {
          const deleted = await tx
            .delete(influencerAnglesTable)
            .where(eq(influencerAnglesTable.influencerId, id))
            .returning({ id: influencerAnglesTable.id });
          replaced = deleted.length;
        }
        const [{ maxOrder }] = await tx
          .select({
            maxOrder: sql<number>`coalesce(max(${influencerAnglesTable.sortOrder}), -1)::int`,
          })
          .from(influencerAnglesTable)
          .where(eq(influencerAnglesTable.influencerId, id));
        let nextOrder = (maxOrder ?? -1) + 1;
        const rows: Array<{ id: number }> = [];
        for (const u of uploads) {
          const [row] = await tx
            .insert(influencerAnglesTable)
            .values({
              influencerId: id,
              label: u.label,
              imageUrl: u.url,
              prompt: null,
              sortOrder: nextOrder++,
            })
            .returning();
          rows.push(row);
        }
        return { inserted: rows, replacedCount: replaced };
      });
      res.status(201).json({ angles: inserted, count: inserted.length, replaced: replacedCount });
      await writeAudit({
        req,
        action: "influencers.angles.upload",
        statusCode: 201,
        reason: parsed.data.reason,
        afterState: { influencerId: id, count: inserted.length, replaced: replacedCount },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer angles batch failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.angles.upload",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason: parsed.data.reason,
      });
    }
  });

  // POST /influencers/:id/settings
  const createSettingBody = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(400).optional(),
    // Bug-fix (Darren Nicholl, influencer 10): when set to true, wipes every
    // prior influencer_settings row for this influencer (cascading
    // setting_images via FK) before creating the new category. Use on the
    // FIRST settings POST of a retry delivery to clear prior batches in
    // one shot; subsequent settings POSTs in the same delivery should
    // leave this false so they accumulate normally.
    replacePriorSettings: z.boolean().optional().default(false),
  });
  router.post("/influencers/:id/settings", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.settings.create", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = createSettingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.settings.create", statusCode: 400, errorCode: "bad_body" });
      return;
    }
    try {
      const [influencer] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencers.settings.create", statusCode: 404, errorCode: "not_found" });
        return;
      }
      // Race-safe: serialize concurrent Viktor replace+create-first-setting
      // posts for the same influencer behind the same advisory namespace
      // composeIdentitySettings uses (733802).
      const { row, replacedSettings } = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(733802, ${id})`);
        let replaced = 0;
        if (parsed.data.replacePriorSettings) {
          const priorIds = await tx
            .select({ id: influencerSettingsTable.id })
            .from(influencerSettingsTable)
            .where(eq(influencerSettingsTable.influencerId, id));
          if (priorIds.length > 0) {
            await tx.delete(settingImagesTable).where(
              inArray(
                settingImagesTable.settingId,
                priorIds.map((r) => r.id),
              ),
            );
            await tx
              .delete(influencerSettingsTable)
              .where(eq(influencerSettingsTable.influencerId, id));
            replaced = priorIds.length;
          }
        }
        const [{ maxOrder }] = await tx
          .select({
            maxOrder: sql<number>`coalesce(max(${influencerSettingsTable.sortOrder}), -1)::int`,
          })
          .from(influencerSettingsTable)
          .where(eq(influencerSettingsTable.influencerId, id));
        const [r] = await tx
          .insert(influencerSettingsTable)
          .values({
            influencerId: id,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            sortOrder: (maxOrder ?? -1) + 1,
          })
          .returning();
        return { row: r, replacedSettings: replaced };
      });
      res.status(201).json({ setting: { ...row, images: [] }, replaced: replacedSettings });
      await writeAudit({
        req,
        action: "influencers.settings.create",
        statusCode: 201,
        afterState: { influencerId: id, settingId: row.id, replaced: replacedSettings },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer setting create failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.settings.create",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencers/:id/settings/:settingId/images
  const settingImageItem = z.object({
    image: z.string().min(1),
    mimeType: z.string().default("image/png"),
    label: z.string().optional(),
  });
  const settingImagesBody = z.object({
    images: z.array(settingImageItem).min(1).max(20),
    reason: z.string().min(1).max(500).optional(),
    // Bug-fix (Darren Nicholl, influencer 10): set replace=true to wipe
    // every prior setting_images row for this setting_id before inserting.
    // Default false stays backwards-compatible with the first-delivery path.
    replace: z.boolean().optional().default(false),
  });
  router.post(
    "/influencers/:id/settings/:settingId/images",
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      const settingId = Number(req.params.settingId);
      if (!Number.isFinite(id) || !Number.isFinite(settingId)) {
        res.status(400).json({ error: "bad_id" });
        await writeAudit({
          req,
          action: "influencers.setting-images.upload",
          statusCode: 400,
          errorCode: "bad_id",
        });
        return;
      }
      const parsed = settingImagesBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
        await writeAudit({
          req,
          action: "influencers.setting-images.upload",
          statusCode: 400,
          errorCode: "bad_body",
        });
        return;
      }
      try {
        const [influencer] = await db
          .select()
          .from(aiInfluencersTable)
          .where(eq(aiInfluencersTable.id, id))
          .limit(1);
        if (!influencer) {
          res.status(404).json({ error: "not_found" });
          await writeAudit({
            req,
            action: "influencers.setting-images.upload",
            statusCode: 404,
            errorCode: "not_found",
          });
          return;
        }
        const [setting] = await db
          .select()
          .from(influencerSettingsTable)
          .where(
            and(
              eq(influencerSettingsTable.id, settingId),
              eq(influencerSettingsTable.influencerId, id),
            ),
          )
          .limit(1);
        if (!setting) {
          res.status(404).json({ error: "setting_not_found" });
          await writeAudit({
            req,
            action: "influencers.setting-images.upload",
            statusCode: 404,
            errorCode: "setting_not_found",
          });
          return;
        }
        // Upload first; never leave the setting empty mid-swap on a
        // mid-flight upload failure.
        const uploads: Array<{ label: string | null; url: string }> = [];
        for (const item of parsed.data.images) {
          const url = await uploadBase64Image(item.image, item.mimeType, "inf-setimg-");
          uploads.push({ label: item.label ?? null, url });
        }
        // Race-safe per-setting swap. New advisory namespace (733803)
        // keyed on settingId so it can run alongside the per-influencer
        // angles/settings locks without blocking sibling settings.
        const { inserted, replacedImages } = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(733803, ${settingId})`);
          let replaced = 0;
          if (parsed.data.replace) {
            const deleted = await tx
              .delete(settingImagesTable)
              .where(eq(settingImagesTable.settingId, settingId))
              .returning({ id: settingImagesTable.id });
            replaced = deleted.length;
          }
          const [{ maxOrder }] = await tx
            .select({
              maxOrder: sql<number>`coalesce(max(${settingImagesTable.sortOrder}), -1)::int`,
            })
            .from(settingImagesTable)
            .where(eq(settingImagesTable.settingId, settingId));
          let nextOrder = (maxOrder ?? -1) + 1;
          const rows: Array<{ id: number }> = [];
          for (const u of uploads) {
            const [row] = await tx
              .insert(settingImagesTable)
              .values({
                settingId,
                imageUrl: u.url,
                label: u.label,
                prompt: null,
                sortOrder: nextOrder++,
              })
              .returning();
            rows.push(row);
          }
          return { inserted: rows, replacedImages: replaced };
        });
        res.status(201).json({ images: inserted, count: inserted.length, replaced: replacedImages });
        await writeAudit({
          req,
          action: "influencers.setting-images.upload",
          statusCode: 201,
          reason: parsed.data.reason,
          afterState: { influencerId: id, settingId, count: inserted.length, replaced: replacedImages },
        });
      } catch (err) {
        req.log.error({ err }, "[external-api] setting images upload failed");
        res.status(500).json({ error: "internal_error" });
        await writeAudit({
          req,
          action: "influencers.setting-images.upload",
          statusCode: 500,
          errorCode: "internal_error",
          errorMessage: String((err as Error)?.message ?? err),
          reason: parsed.data.reason,
        });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // Viktor (CS automation) endpoints — diagnose / cleanup / create
  // influencer jobs without needing manual prod script runs.
  //
  // These six endpoints are siblings of the existing lifecycle routes
  // above. They live here (rather than a new file) because they share
  // the same auth (requireExternalApiKey), audit writer, and table
  // imports. All mutating endpoints default `dry_run: true` and require
  // an explicit `dry_run: false` to commit.
  //
  // Route-ordering note: `/influencers/lookup` and `/influencers/create-job`
  // are literal paths and MUST be registered before the bare
  // `GET /influencers/:id` handler below, otherwise Express would route
  // `GET /influencers/lookup` to `:id` with id=NaN and 400 on bad_id.
  // ──────────────────────────────────────────────────────────────────────

  // GET /influencers/lookup?email=...
  // Diagnostic shape: every ai_influencers row owned by the buyer + per
  // row summary counts (angles, settings, setting_images) + the buyer's
  // ai_influencer_jobs list. Lets Viktor see "what does this user's
  // influencer page actually look like right now" before deciding to
  // cleanup vs retry vs create-job.
  router.get("/influencers/lookup", async (req: Request, res: Response) => {
    const email = String(req.query.email || "").trim();
    if (!email) {
      res.status(400).json({ error: "missing_email", message: "email query parameter is required" });
      await writeAudit({ req, action: "influencers.lookup", statusCode: 400, errorCode: "missing_email" });
      return;
    }
    try {
      const user = await findAppUserByEmail(email);
      if (!user) {
        res.status(404).json({ error: "user_not_found", email: email.toLowerCase() });
        await writeAudit({ req, action: "influencers.lookup", targetEmail: email, statusCode: 404, errorCode: "user_not_found" });
        return;
      }
      const influencers = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.clientId, user.id))
        .orderBy(desc(aiInfluencersTable.createdAt));

      const influencerIds = influencers.map((i) => i.id);

      // Counts per influencer. Single query each, grouped client-side
      // (drizzle doesn't expose `groupBy` ergonomically across all the
      // legacy schemas we touch, and the row count here is tiny).
      const angles = influencerIds.length > 0
        ? await db
            .select({ id: influencerAnglesTable.id, influencerId: influencerAnglesTable.influencerId })
            .from(influencerAnglesTable)
            .where(inArray(influencerAnglesTable.influencerId, influencerIds))
        : [];
      const settings = influencerIds.length > 0
        ? await db
            .select({ id: influencerSettingsTable.id, influencerId: influencerSettingsTable.influencerId })
            .from(influencerSettingsTable)
            .where(inArray(influencerSettingsTable.influencerId, influencerIds))
        : [];
      const settingIds = settings.map((s) => s.id);
      const settingImages = settingIds.length > 0
        ? await db
            .select({ id: settingImagesTable.id, settingId: settingImagesTable.settingId })
            .from(settingImagesTable)
            .where(inArray(settingImagesTable.settingId, settingIds))
        : [];

      const anglesByInfluencer = new Map<number, number>();
      for (const a of angles) anglesByInfluencer.set(a.influencerId, (anglesByInfluencer.get(a.influencerId) ?? 0) + 1);
      const settingsByInfluencer = new Map<number, number>();
      const settingIdToInfluencer = new Map<number, number>();
      for (const s of settings) {
        settingsByInfluencer.set(s.influencerId, (settingsByInfluencer.get(s.influencerId) ?? 0) + 1);
        settingIdToInfluencer.set(s.id, s.influencerId);
      }
      const imagesByInfluencer = new Map<number, number>();
      for (const img of settingImages) {
        const infId = settingIdToInfluencer.get(img.settingId);
        if (infId != null) imagesByInfluencer.set(infId, (imagesByInfluencer.get(infId) ?? 0) + 1);
      }

      const jobs = await db
        .select({
          id: aiInfluencerJobsTable.id,
          status: aiInfluencerJobsTable.status,
          prefs: aiInfluencerJobsTable.prefs,
          influencerId: aiInfluencerJobsTable.influencerId,
          etaAt: aiInfluencerJobsTable.etaAt,
          failureReason: aiInfluencerJobsTable.failureReason,
          lastErrorCode: aiInfluencerJobsTable.lastErrorCode,
          createdAt: aiInfluencerJobsTable.createdAt,
        })
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.clientId, user.id))
        .orderBy(desc(aiInfluencerJobsTable.createdAt));

      res.json({
        email: email.toLowerCase(),
        appUserId: user.id,
        influencers: influencers.map((inf) => ({
          ...inf,
          anglesCount: anglesByInfluencer.get(inf.id) ?? 0,
          settingsCount: settingsByInfluencer.get(inf.id) ?? 0,
          settingImagesCount: imagesByInfluencer.get(inf.id) ?? 0,
        })),
        jobs,
      });
      await writeAudit({ req, action: "influencers.lookup", targetEmail: email, statusCode: 200 });
    } catch (err) {
      req.log.error({ err, email }, "[external-api] influencers.lookup failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.lookup",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencers/create-job
  // Manually queue a fresh influencer + job for a buyer. 409 if the
  // buyer already has any non-failed job (avoid duplicates - if they
  // want a retry, use /influencers/:id/retry-job).
  const createJobBody = z.object({
    email: z.string().email(),
    prefs: z.object({
      gender: z.string().min(1),
      age_range: z.string().min(1),
      ethnicity: z.string().min(1),
      vibe: z.string().min(1),
      notes: z.string().optional().nullable(),
    }),
    dry_run: z.boolean().optional().default(true),
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencers/create-job", async (req: Request, res: Response) => {
    const parsed = createJobBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.create-job", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
      return;
    }
    const { email, prefs, dry_run, reason } = parsed.data;
    try {
      const user = await findAppUserByEmail(email);
      if (!user) {
        res.status(404).json({ error: "user_not_found", message: `No app_users row for ${email}. Buyer must sign in via Clerk at least once.` });
        await writeAudit({ req, action: "influencers.create-job", targetEmail: email, statusCode: 404, errorCode: "user_not_found", requestBody: req.body });
        return;
      }

      // 409 if any non-failed job already exists for this buyer. Failed
      // jobs are allowed to coexist - that's the whole point of the
      // "create-job after cleanup of a stuck failure" flow.
      const existingJobs = await db
        .select({ id: aiInfluencerJobsTable.id, status: aiInfluencerJobsTable.status, createdAt: aiInfluencerJobsTable.createdAt })
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.clientId, user.id))
        .orderBy(desc(aiInfluencerJobsTable.createdAt));
      const blocking = existingJobs.filter((j) => j.status !== "failed");
      if (blocking.length > 0) {
        res.status(409).json({
          error: "active_job_exists",
          message: `User already has ${blocking.length} non-failed job(s). Resolve them (cleanup / mark failed / wait for ready) before creating another.`,
          jobs: blocking,
        });
        await writeAudit({
          req,
          action: "influencers.create-job",
          targetEmail: email,
          statusCode: 409,
          errorCode: "active_job_exists",
          requestBody: req.body,
          beforeState: { activeJobIds: blocking.map((j) => j.id) },
        });
        return;
      }

      const etaAt = new Date(Date.now() + 45 * 60 * 1000);
      const dbPrefs = {
        gender: prefs.gender,
        ageRange: prefs.age_range,
        ethnicity: prefs.ethnicity,
        vibe: prefs.vibe,
        notes: prefs.notes ?? null,
      };

      if (dry_run) {
        // eslint-disable-next-line no-console
        console.log("[external-api] influencers.create-job DRY-RUN", {
          email: email.toLowerCase(),
          clientId: user.id,
          dbPrefs,
          etaAt,
          reason: reason ?? null,
        });
        res.json({
          dry_run: true,
          would_create: { email: email.toLowerCase(), appUserId: user.id, prefs: dbPrefs, etaAt },
        });
        await writeAudit({
          req,
          action: "influencers.create-job",
          targetEmail: email,
          statusCode: 200,
          reason,
          requestBody: req.body,
          afterState: { dryRun: true, wouldCreate: { appUserId: user.id, etaAt } },
        });
        return;
      }

      // Materialize influencer + job in one transaction so we never end
      // up with an orphaned influencer row if the job insert blows up.
      // The post-insert rename ("Influencer <jobId>") matches the
      // convention the in-process worker uses so the same ON CONFLICT
      // lookup picks it up if INFLUENCER_INTERNAL_PIPELINE_ENABLED is
      // ever flipped back on.
      const created = await db.transaction(async (tx) => {
        const [influencer] = await tx
          .insert(aiInfluencersTable)
          .values({
            clientId: user.id,
            name: "Influencer pending",
            gender: prefs.gender,
            ageRange: prefs.age_range,
            niche: prefs.vibe,
            status: "building",
          })
          .returning();
        const [job] = await tx
          .insert(aiInfluencerJobsTable)
          .values({
            clientId: user.id,
            influencerId: influencer.id,
            prefs: dbPrefs,
            status: "queued",
            etaAt,
          })
          .returning();
        const [renamed] = await tx
          .update(aiInfluencersTable)
          .set({ name: `Influencer ${job.id}` })
          .where(eq(aiInfluencersTable.id, influencer.id))
          .returning();
        return { influencer: renamed ?? influencer, job };
      });

      // eslint-disable-next-line no-console
      console.log("[external-api] influencers.create-job APPLY", {
        email: email.toLowerCase(),
        appUserId: user.id,
        influencerId: created.influencer.id,
        jobId: created.job.id,
        reason: reason ?? null,
      });

      res.status(201).json({
        influencer_id: created.influencer.id,
        job_id: created.job.id,
        admin_url: `/members/admin/influencer-generations?jobId=${created.job.id}`,
      });
      await writeAudit({
        req,
        action: "influencers.create-job",
        targetEmail: email,
        statusCode: 201,
        reason,
        requestBody: req.body,
        afterState: { influencerId: created.influencer.id, jobId: created.job.id },
      });
    } catch (err) {
      req.log.error({ err, email }, "[external-api] influencers.create-job failed");
      res.status(500).json({ error: "internal_error", message: String((err as Error)?.message ?? err) });
      await writeAudit({
        req,
        action: "influencers.create-job",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason,
      });
    }
  });

  // POST /influencers/:id/cleanup
  // Delete duplicate/junk angles + settings (and their setting_images
  // children) for an influencer. Two modes:
  //
  //   keep_first_batch: find the earliest created_at across angles,
  //     keep every angle within 60s of it; same logic applied
  //     independently for settings. Useful when the worker double-fired
  //     and produced two near-identical batches a few minutes apart.
  //
  //   keep_ids: keep only the explicitly listed angle ids and setting
  //     ids; delete everything else. The caller is responsible for the
  //     allow-list.
  //
  // Always: delete order is setting_images -> settings -> angles
  // (respect FKs even though the cascade would handle settings ->
  // setting_images, we want explicit counts in the audit). Single
  // transaction. Refuses if it would leave the influencer with zero
  // angles or zero settings.
  const cleanupBody = z.object({
    mode: z.enum(["keep_first_batch", "keep_ids"]),
    keep_angle_ids: z.array(z.number().int().positive()).optional(),
    keep_setting_ids: z.array(z.number().int().positive()).optional(),
    dry_run: z.boolean().optional().default(true),
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencers/:id/cleanup", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = cleanupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
      return;
    }
    const { mode, keep_angle_ids, keep_setting_ids, dry_run, reason } = parsed.data;
    if (mode === "keep_ids" && (!keep_angle_ids?.length || !keep_setting_ids?.length)) {
      res.status(400).json({ error: "bad_body", message: "keep_ids mode requires non-empty keep_angle_ids AND keep_setting_ids arrays." });
      await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
      return;
    }
    try {
      const [influencer] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencers.cleanup", statusCode: 404, errorCode: "not_found" });
        return;
      }

      const angles = await db
        .select({ id: influencerAnglesTable.id, createdAt: influencerAnglesTable.createdAt })
        .from(influencerAnglesTable)
        .where(eq(influencerAnglesTable.influencerId, id))
        .orderBy(influencerAnglesTable.createdAt, influencerAnglesTable.id);
      const settings = await db
        .select({ id: influencerSettingsTable.id, createdAt: influencerSettingsTable.createdAt })
        .from(influencerSettingsTable)
        .where(eq(influencerSettingsTable.influencerId, id))
        .orderBy(influencerSettingsTable.createdAt, influencerSettingsTable.id);

      let keepAngleIds: Set<number>;
      let keepSettingIds: Set<number>;
      if (mode === "keep_first_batch") {
        // 60-second window from the earliest row in each table.
        const WINDOW_MS = 60 * 1000;
        const angleAnchor = angles[0]?.createdAt?.getTime();
        keepAngleIds = new Set(
          angleAnchor != null
            ? angles.filter((a) => Math.abs(a.createdAt.getTime() - angleAnchor) <= WINDOW_MS).map((a) => a.id)
            : [],
        );
        const settingAnchor = settings[0]?.createdAt?.getTime();
        keepSettingIds = new Set(
          settingAnchor != null
            ? settings.filter((s) => Math.abs(s.createdAt.getTime() - settingAnchor) <= WINDOW_MS).map((s) => s.id)
            : [],
        );
      } else {
        keepAngleIds = new Set(keep_angle_ids!);
        keepSettingIds = new Set(keep_setting_ids!);
        // Validate every requested id actually belongs to this influencer.
        const validAngleIds = new Set(angles.map((a) => a.id));
        const validSettingIds = new Set(settings.map((s) => s.id));
        const badAngles = [...keepAngleIds].filter((aid) => !validAngleIds.has(aid));
        const badSettings = [...keepSettingIds].filter((sid) => !validSettingIds.has(sid));
        if (badAngles.length > 0 || badSettings.length > 0) {
          res.status(400).json({
            error: "bad_keep_ids",
            message: "Some keep_* ids do not belong to this influencer.",
            badAngles,
            badSettings,
          });
          await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "bad_keep_ids", requestBody: req.body });
          return;
        }
      }

      const deleteAngleIds = angles.filter((a) => !keepAngleIds.has(a.id)).map((a) => a.id);
      const deleteSettingIds = settings.filter((s) => !keepSettingIds.has(s.id)).map((s) => s.id);

      // Safety: never leave the influencer with zero angles or zero
      // settings - that would brick the buyer's workspace.
      if (keepAngleIds.size === 0 && angles.length > 0) {
        res.status(400).json({ error: "would_delete_all_angles", message: "Refusing - would leave influencer with 0 angles." });
        await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "would_delete_all_angles", requestBody: req.body });
        return;
      }
      if (keepSettingIds.size === 0 && settings.length > 0) {
        res.status(400).json({ error: "would_delete_all_settings", message: "Refusing - would leave influencer with 0 settings." });
        await writeAudit({ req, action: "influencers.cleanup", statusCode: 400, errorCode: "would_delete_all_settings", requestBody: req.body });
        return;
      }

      // Image count is the count of setting_images attached to the
      // settings we're about to drop. Computed once so the dry-run
      // response is honest about cascade impact.
      const imagesToDelete = deleteSettingIds.length > 0
        ? await db
            .select({ id: settingImagesTable.id })
            .from(settingImagesTable)
            .where(inArray(settingImagesTable.settingId, deleteSettingIds))
        : [];

      const beforeCounts = {
        angles: angles.length,
        settings: settings.length,
        // setting_images count for ALL of this influencer's settings,
        // not just the ones being deleted. Lets the caller see how
        // many remain post-cleanup.
        setting_images: settings.length > 0
          ? (await db
              .select({ id: settingImagesTable.id })
              .from(settingImagesTable)
              .where(inArray(settingImagesTable.settingId, settings.map((s) => s.id)))).length
          : 0,
      };

      const plan = {
        mode,
        kept: { angle_ids: [...keepAngleIds], setting_ids: [...keepSettingIds] },
        deleted_counts: {
          angles: deleteAngleIds.length,
          settings: deleteSettingIds.length,
          setting_images: imagesToDelete.length,
        },
        before_counts: beforeCounts,
        after_counts: {
          angles: keepAngleIds.size,
          settings: keepSettingIds.size,
          setting_images: beforeCounts.setting_images - imagesToDelete.length,
        },
      };

      if (dry_run) {
        // eslint-disable-next-line no-console
        console.log("[external-api] influencers.cleanup DRY-RUN", { influencerId: id, plan, reason: reason ?? null });
        res.json({ dry_run: true, ...plan });
        await writeAudit({
          req,
          action: "influencers.cleanup",
          statusCode: 200,
          reason,
          requestBody: req.body,
          beforeState: beforeCounts,
          afterState: { dryRun: true, plan },
        });
        return;
      }

      // Single transaction. setting_images -> settings -> angles in
      // dependency order even though FK cascades would handle the
      // children automatically - explicit deletes give us a real row
      // count to audit.
      await db.transaction(async (tx) => {
        if (deleteSettingIds.length > 0) {
          await tx
            .delete(settingImagesTable)
            .where(inArray(settingImagesTable.settingId, deleteSettingIds));
          await tx
            .delete(influencerSettingsTable)
            .where(inArray(influencerSettingsTable.id, deleteSettingIds));
        }
        if (deleteAngleIds.length > 0) {
          await tx
            .delete(influencerAnglesTable)
            .where(inArray(influencerAnglesTable.id, deleteAngleIds));
        }
      });

      // eslint-disable-next-line no-console
      console.log("[external-api] influencers.cleanup APPLY", { influencerId: id, plan, reason: reason ?? null });
      res.json({ dry_run: false, ...plan });
      await writeAudit({
        req,
        action: "influencers.cleanup",
        statusCode: 200,
        reason,
        requestBody: req.body,
        beforeState: beforeCounts,
        afterState: plan,
      });
    } catch (err) {
      req.log.error({ err, influencerId: id }, "[external-api] influencers.cleanup failed");
      res.status(500).json({ error: "internal_error", message: String((err as Error)?.message ?? err) });
      await writeAudit({
        req,
        action: "influencers.cleanup",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason,
      });
    }
  });

  // GET /influencers/:id/angles
  router.get("/influencers/:id/angles", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.angles.list", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    try {
      const rows = await db
        .select()
        .from(influencerAnglesTable)
        .where(eq(influencerAnglesTable.influencerId, id))
        .orderBy(influencerAnglesTable.sortOrder, influencerAnglesTable.id);
      res.json({ influencerId: id, angles: rows, count: rows.length });
      await writeAudit({ req, action: "influencers.angles.list", statusCode: 200 });
    } catch (err) {
      req.log.error({ err, influencerId: id }, "[external-api] influencers.angles.list failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.angles.list",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // GET /influencers/:id/settings
  router.get("/influencers/:id/settings", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.settings.list", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    try {
      const settings = await db
        .select()
        .from(influencerSettingsTable)
        .where(eq(influencerSettingsTable.influencerId, id))
        .orderBy(influencerSettingsTable.sortOrder, influencerSettingsTable.id);
      const images = settings.length > 0
        ? await db
            .select()
            .from(settingImagesTable)
            .where(inArray(settingImagesTable.settingId, settings.map((s) => s.id)))
            .orderBy(settingImagesTable.sortOrder, settingImagesTable.id)
        : [];
      const withImages = settings.map((s) => ({
        ...s,
        images: images.filter((img) => img.settingId === s.id),
      }));
      res.json({ influencerId: id, settings: withImages, count: settings.length });
      await writeAudit({ req, action: "influencers.settings.list", statusCode: 200 });
    } catch (err) {
      req.log.error({ err, influencerId: id }, "[external-api] influencers.settings.list failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.settings.list",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencers/:id/retry-job
  // Re-queue a failed or stuck generation job. The job MUST belong to
  // this influencer (job.influencerId === :id) - otherwise we'd let a
  // caller stomp on an unrelated buyer's work. Refuses to retry a
  // `ready` job (already delivered).
  const retryJobBody = z.object({
    job_id: z.number().int().positive(),
    dry_run: z.boolean().optional().default(true),
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencers/:id/retry-job", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.retry-job", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = retryJobBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({ req, action: "influencers.retry-job", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
      return;
    }
    const { job_id, dry_run, reason } = parsed.data;
    try {
      const [job] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, job_id))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "job_not_found" });
        await writeAudit({ req, action: "influencers.retry-job", statusCode: 404, errorCode: "job_not_found", requestBody: req.body });
        return;
      }
      if (job.influencerId !== id) {
        res.status(409).json({
          error: "job_influencer_mismatch",
          message: `Job ${job_id} belongs to influencer ${job.influencerId ?? "<null>"}, not ${id}.`,
        });
        await writeAudit({
          req,
          action: "influencers.retry-job",
          statusCode: 409,
          errorCode: "job_influencer_mismatch",
          requestBody: req.body,
          beforeState: { jobId: job_id, jobInfluencerId: job.influencerId, requestedInfluencerId: id },
        });
        return;
      }
      if (job.status === "ready") {
        res.status(409).json({ error: "already_ready", message: "Job is already delivered (status=ready). Refusing to retry." });
        await writeAudit({
          req,
          action: "influencers.retry-job",
          statusCode: 409,
          errorCode: "already_ready",
          requestBody: req.body,
          beforeState: { status: job.status },
        });
        return;
      }

      const etaAt = new Date(Date.now() + 45 * 60 * 1000);

      if (dry_run) {
        // eslint-disable-next-line no-console
        console.log("[external-api] influencers.retry-job DRY-RUN", { jobId: job_id, influencerId: id, currentStatus: job.status, etaAt, reason: reason ?? null });
        res.json({
          dry_run: true,
          job_id,
          current_status: job.status,
          would_set: { status: "queued", etaAt },
        });
        await writeAudit({
          req,
          action: "influencers.retry-job",
          statusCode: 200,
          reason,
          requestBody: req.body,
          beforeState: { status: job.status, etaAt: job.etaAt },
          afterState: { dryRun: true, wouldSet: { status: "queued", etaAt } },
        });
        return;
      }

      const [updated] = await db
        .update(aiInfluencerJobsTable)
        .set({
          status: "queued",
          etaAt,
          failureReason: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          finalizeAttempts: 0,
          stuckAlertSentAt: null,
          stageStartedAt: null,
          heartbeatAt: null,
        })
        .where(eq(aiInfluencerJobsTable.id, job_id))
        .returning();

      // eslint-disable-next-line no-console
      console.log("[external-api] influencers.retry-job APPLY", { jobId: job_id, influencerId: id, previousStatus: job.status, reason: reason ?? null });
      res.json({ job_id, new_status: updated.status });
      await writeAudit({
        req,
        action: "influencers.retry-job",
        statusCode: 200,
        reason,
        requestBody: req.body,
        beforeState: { status: job.status, etaAt: job.etaAt, failureReason: job.failureReason, lastErrorCode: job.lastErrorCode },
        afterState: { status: updated.status, etaAt: updated.etaAt },
      });
    } catch (err) {
      req.log.error({ err, jobId: job_id, influencerId: id }, "[external-api] influencers.retry-job failed");
      res.status(500).json({ error: "internal_error", message: String((err as Error)?.message ?? err) });
      await writeAudit({
        req,
        action: "influencers.retry-job",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
        reason,
      });
    }
  });

  // GET /influencers/:id
  router.get("/influencers/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencers.get", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    try {
      const [influencer] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, id))
        .limit(1);
      if (!influencer) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencers.get", statusCode: 404, errorCode: "not_found" });
        return;
      }
      const angles = await db
        .select()
        .from(influencerAnglesTable)
        .where(eq(influencerAnglesTable.influencerId, id))
        .orderBy(influencerAnglesTable.sortOrder, influencerAnglesTable.id);
      const settings = await db
        .select()
        .from(influencerSettingsTable)
        .where(eq(influencerSettingsTable.influencerId, id))
        .orderBy(influencerSettingsTable.sortOrder, influencerSettingsTable.id);
      let images: Array<typeof settingImagesTable.$inferSelect> = [];
      if (settings.length > 0) {
        images = await db
          .select()
          .from(settingImagesTable)
          .where(inArray(settingImagesTable.settingId, settings.map((s) => s.id)))
          .orderBy(settingImagesTable.sortOrder, settingImagesTable.id);
      }
      const settingsWithImages = settings.map((s) => ({
        ...s,
        images: images.filter((img) => img.settingId === s.id),
      }));
      res.json({ influencer, angles, settings: settingsWithImages });
      await writeAudit({ req, action: "influencers.get", statusCode: 200 });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer get failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencers.get",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  // POST /influencer-jobs/:id/reset
  //
  // Resets a non-terminal-success job back to `queued` so the Replit
  // pipeline poller can re-claim it. Intended for the admin "retry stuck
  // job" workflow when a generation run died mid-flight (worker crash,
  // partial scene swap, OpenAI moderation block) and the job is parked in
  // `failed` or an intermediate `*ing_*` state. Clears the failure
  // metadata + finalize backoff counters + stuck-alert dedupe so a fresh
  // attempt starts cleanly and re-alerts on #ops if it gets stuck again.
  //
  // Refuses to reset `ready` (already delivered) so support can't
  // accidentally re-run a successful job and clobber the buyer's assets.
  // `sceneImageUrls` is intentionally LEFT IN PLACE: the new run may
  // reuse any usable per-scene output from the previous attempt, and the
  // pipeline already idempotently overwrites duplicates.
  const resetJobBody = z.object({
    reason: z.string().min(1).max(500).optional(),
  });
  router.post("/influencer-jobs/:id/reset", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      await writeAudit({ req, action: "influencer-jobs.reset", statusCode: 400, errorCode: "bad_id" });
      return;
    }
    const parsed = resetJobBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
      await writeAudit({
        req,
        action: "influencer-jobs.reset",
        statusCode: 400,
        errorCode: "bad_body",
      });
      return;
    }
    try {
      const [job] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, id))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "not_found" });
        await writeAudit({ req, action: "influencer-jobs.reset", statusCode: 404, errorCode: "not_found" });
        return;
      }
      if (job.status === "ready") {
        res.status(409).json({
          error: "not_resettable",
          message: "Job is already in status \"ready\" (delivered to buyer). Refusing to reset.",
        });
        await writeAudit({
          req,
          action: "influencer-jobs.reset",
          statusCode: 409,
          errorCode: "not_resettable",
          beforeState: { status: job.status },
        });
        return;
      }
      if (job.status === "queued") {
        // No-op idempotent return so retries don't 409 themselves.
        res.json({ job: { id: job.id, status: job.status }, noop: true });
        await writeAudit({
          req,
          action: "influencer-jobs.reset",
          statusCode: 200,
          beforeState: { status: job.status },
          afterState: { status: job.status, noop: true },
        });
        return;
      }
      const [updated] = await db
        .update(aiInfluencerJobsTable)
        .set({
          status: "queued",
          failureReason: null,
          lastErrorCode: null,
          finalizeAttempts: 0,
          stuckAlertSentAt: null,
          stageStartedAt: null,
          heartbeatAt: null,
        })
        .where(eq(aiInfluencerJobsTable.id, id))
        .returning();
      if (!updated) {
        res.status(500).json({ error: "update_failed" });
        await writeAudit({
          req,
          action: "influencer-jobs.reset",
          statusCode: 500,
          errorCode: "update_failed",
        });
        return;
      }
      res.json({ job: { id: updated.id, status: updated.status } });
      await writeAudit({
        req,
        action: "influencer-jobs.reset",
        statusCode: 200,
        beforeState: { status: job.status, failureReason: job.failureReason, lastErrorCode: job.lastErrorCode, finalizeAttempts: job.finalizeAttempts },
        afterState: { status: updated.status, reason: parsed.data.reason ?? null },
      });
    } catch (err) {
      req.log.error({ err }, "[external-api] influencer-jobs reset failed");
      res.status(500).json({ error: "internal_error" });
      await writeAudit({
        req,
        action: "influencer-jobs.reset",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: String((err as Error)?.message ?? err),
      });
    }
  });

  return router;
}
