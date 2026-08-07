// ─────────────────────────────────────────────────────────────────────────────
// Task #696 — Admin-only read endpoints over AI Influencer generations.
//
// Mounted at /api/portal/admin/influencer-generations. All endpoints are
// gated by requireAuth + requireInfluencerAdmin (super-admin OR
// ADMIN_EMAILS allow-list), the SAME gate used by the existing per-job
// diagnostics route in `routes/influencer-jobs.ts`.
//
// Endpoints (READ ONLY — no mutations, no UI):
//   GET /              list jobs across all users with filters + keyset
//                      pagination on (created_at, id) descending.
//   GET /stats         total + per-status histogram + freeTier/paidTier
//                      + stuck count (non-terminal rows whose updated_at
//                      is older than 1h). Default window = last 7 days.
//   GET /:id           full job row + owner (portal_users joined via
//                      app_users.clerk_id) + materialized influencer +
//                      angles + settings (+ setting_images) +
//                      ai_influencer_scene_jobs children + parsed
//                      characterProfile from prefs.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencerSceneJobsTable,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
  appUsers,
  portalUsersTable,
  portalNotificationsTable,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  ListAdminInfluencerGenerationsQueryParams,
  GetAdminInfluencerGenerationStatsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireInfluencerAdmin } from "../middlewares/requireInfluencerAdmin";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { postInfluencerStuckAlert } from "../lib/influencer-stuck-alert";

const router: IRouter = Router();

// Super-admin only: this surface mutates buyer-facing state on
// behalf of customers (queue a fresh charge of generation slot,
// flip a job to ready, etc.). Anything broader than `isSuperAdmin`
// would let a portal admin act on accounts that are not theirs.
const requireSuperAdmin = (req: Request, res: Response, next: () => void) => {
  if (!req.appUser?.isSuperAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
};

const KNOWN_STATUSES = [
  "queued",
  "generating_base",
  "enhancing",
  "swapping_scenes",
  "ready",
  "ready_degraded",
  "failed",
] as const;
const TERMINAL_STATES = new Set(["failed", "ready", "ready_degraded"]);
const TERMINAL_STATUSES = new Set(["ready", "ready_degraded", "failed"]);
const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1h
const STUCK_AGE_MS = 60 * 60 * 1000; // 1h since last heartbeat / stage start
const DEFAULT_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_REASON = "manual_cleanup_admin_console";
const MANUAL_DELIVERY_REASON = "manual_delivery_admin_console";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL || "";
  return raw.replace(/\/+$/, "");
}

type PrefsShape = {
  ageRange?: string | null;
  ethnicity?: string | null;
  gender?: string | null;
  vibe?: string | null;
  notes?: string | null;
  facialHair?: string | null;
  hairstyle?: string | null;
  characterProfile?: Record<string, unknown> | null;
};

function readPrefs(raw: unknown): PrefsShape {
  if (!raw || typeof raw !== "object") return {};
  return raw as PrefsShape;
}

function summarisePrefs(raw: unknown) {
  const p = readPrefs(raw);
  return {
    gender: p.gender ?? null,
    ageRange: p.ageRange ?? null,
    ethnicity: p.ethnicity ?? null,
    vibe: p.vibe ?? null,
    notes: p.notes ?? null,
    facialHair: p.facialHair ?? null,
    hairstyle: p.hairstyle ?? null,
  };
}

function isoOrNull(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
}

function fullName(first?: string | null, last?: string | null): string | null {
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined.length ? joined : null;
}

function buildOwner(row: {
  clientId: number;
  appUserEmail: string | null;
  appUserName: string | null;
  appUserIsSuperAdmin: boolean | null;
  portalUserId: number | null;
  portalClerkId: string | null;
  portalEmail: string | null;
  portalFirstName: string | null;
  portalLastName: string | null;
  portalIsActive: boolean | null;
  portalIsAList: boolean | null;
  portalKey: string | null;
  portalCreatedAt: Date | null;
}) {
  return {
    appUserId: row.clientId,
    appUserEmail: row.appUserEmail,
    appUserName: row.appUserName,
    isSuperAdmin: row.appUserIsSuperAdmin ?? false,
    portalUserId: row.portalUserId,
    clerkId: row.portalClerkId,
    email: row.portalEmail,
    firstName: row.portalFirstName,
    lastName: row.portalLastName,
    name: fullName(row.portalFirstName, row.portalLastName),
    isActive: row.portalIsActive,
    isAList: row.portalIsAList,
    portalKey: row.portalKey,
    portalCreatedAt: isoOrNull(row.portalCreatedAt),
  };
}

function encodeCursor(createdAt: Date, id: number): string {
  return `${createdAt.toISOString()}_${id}`;
}

function decodeCursor(raw: string | undefined): { createdAt: Date; id: number } | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf("_");
  if (idx <= 0) return null;
  const tsRaw = raw.slice(0, idx);
  const idRaw = raw.slice(idx + 1);
  const id = Number.parseInt(idRaw, 10);
  const ts = new Date(tsRaw);
  if (!Number.isFinite(id) || Number.isNaN(ts.getTime())) return null;
  return { createdAt: ts, id };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /  list with filters + keyset pagination on (createdAt desc, id desc)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", requireAuth, requireInfluencerAdmin, async (req: Request, res: Response) => {
  const parsed = ListAdminInfluencerGenerationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_query", details: parsed.error.flatten() });
    return;
  }
  const q = parsed.data;
  const cursor = decodeCursor(q.cursor);
  try {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(aiInfluencerJobsTable.status, q.status));
    if (q.isFreeTier === "true") conds.push(eq(aiInfluencerJobsTable.isFreeTier, true));
    if (q.isFreeTier === "false") conds.push(eq(aiInfluencerJobsTable.isFreeTier, false));
    if (q.hasInfluencer === "true") conds.push(isNotNull(aiInfluencerJobsTable.influencerId));
    if (q.hasInfluencer === "false") conds.push(isNull(aiInfluencerJobsTable.influencerId));
    if (q.createdAfter) {
      conds.push(sql`${aiInfluencerJobsTable.createdAt} >= ${q.createdAfter}`);
    }
    if (q.createdBefore) {
      conds.push(sql`${aiInfluencerJobsTable.createdAt} < ${q.createdBefore}`);
    }
    if (q.email) {
      const pattern = `%${q.email.toLowerCase()}%`;
      const emailOr = or(ilike(appUsers.email, pattern), ilike(portalUsersTable.email, pattern));
      if (emailOr) conds.push(emailOr);
    }
    if (cursor) {
      conds.push(
        sql`(${aiInfluencerJobsTable.createdAt}, ${aiInfluencerJobsTable.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const rows = await db
      .select({
        id: aiInfluencerJobsTable.id,
        clientId: aiInfluencerJobsTable.clientId,
        influencerId: aiInfluencerJobsTable.influencerId,
        status: aiInfluencerJobsTable.status,
        progress: aiInfluencerJobsTable.progress,
        isFreeTier: aiInfluencerJobsTable.isFreeTier,
        etaAt: aiInfluencerJobsTable.etaAt,
        createdAt: aiInfluencerJobsTable.createdAt,
        updatedAt: aiInfluencerJobsTable.updatedAt,
        stageStartedAt: aiInfluencerJobsTable.stageStartedAt,
        heartbeatAt: aiInfluencerJobsTable.heartbeatAt,
        completedAt: aiInfluencerJobsTable.completedAt,
        finalizeAttempts: aiInfluencerJobsTable.finalizeAttempts,
        failureReason: aiInfluencerJobsTable.failureReason,
        lastErrorCode: aiInfluencerJobsTable.lastErrorCode,
        prefs: aiInfluencerJobsTable.prefs,
        appUserEmail: appUsers.email,
        appUserName: appUsers.name,
        appUserIsSuperAdmin: appUsers.isSuperAdmin,
        portalUserId: portalUsersTable.id,
        portalClerkId: portalUsersTable.clerkId,
        portalEmail: portalUsersTable.email,
        portalFirstName: portalUsersTable.firstName,
        portalLastName: portalUsersTable.lastName,
        portalIsActive: portalUsersTable.isActive,
        portalIsAList: portalUsersTable.isAList,
        portalKey: portalUsersTable.portalKey,
        portalCreatedAt: portalUsersTable.createdAt,
        influencerName: aiInfluencersTable.name,
        influencerStatus: aiInfluencersTable.status,
        influencerAvatarUrl: aiInfluencersTable.avatarUrl,
        influencerUpdatedAt: aiInfluencersTable.updatedAt,
      })
      .from(aiInfluencerJobsTable)
      .leftJoin(appUsers, eq(appUsers.id, aiInfluencerJobsTable.clientId))
      .leftJoin(portalUsersTable, eq(portalUsersTable.clerkId, appUsers.clerkId))
      .leftJoin(aiInfluencersTable, eq(aiInfluencersTable.id, aiInfluencerJobsTable.influencerId))
      .where(where)
      .orderBy(desc(aiInfluencerJobsTable.createdAt), desc(aiInfluencerJobsTable.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    req.log.info(
      {
        adminUserId: req.appUser?.id,
        count: page.length,
        filters: {
          status: q.status,
          email: q.email,
          isFreeTier: q.isFreeTier,
          hasInfluencer: q.hasInfluencer,
          createdAfter: q.createdAfter,
          createdBefore: q.createdBefore,
        },
      },
      "admin-influencer-generations: list",
    );

    res.json({
      jobs: page.map((r) => {
        const base = {
          id: r.id,
          clientId: r.clientId,
          influencerId: r.influencerId,
          status: r.status,
          progress: r.progress,
          isFreeTier: r.isFreeTier,
          etaAt: r.etaAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          stageStartedAt: isoOrNull(r.stageStartedAt),
          heartbeatAt: isoOrNull(r.heartbeatAt),
          completedAt: isoOrNull(r.completedAt),
          finalizeAttempts: r.finalizeAttempts,
          failureReason: r.failureReason,
          lastErrorCode: r.lastErrorCode,
          prefs: summarisePrefs(r.prefs),
          owner: buildOwner(r),
        };
        if (r.influencerId && r.influencerName) {
          return {
            ...base,
            influencer: {
              id: r.influencerId,
              name: r.influencerName,
              status: r.influencerStatus ?? "unknown",
              avatarUrl: r.influencerAvatarUrl,
              updatedAt: (r.influencerUpdatedAt ?? r.updatedAt).toISOString(),
            },
          };
        }
        return base;
      }),
      nextCursor,
      hasMore,
    });
    return;
  } catch (err) {
    req.log.error({ err }, "admin-influencer-generations: list failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /stats — counts by status + total + freeTier/paidTier + stuck.
// Default window = last 7 days; pass ?since=<iso> to override.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stats", requireAuth, requireInfluencerAdmin, async (req: Request, res: Response) => {
  const parsed = GetAdminInfluencerGenerationStatsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_query", details: parsed.error.flatten() });
    return;
  }
  const since = parsed.data.since ?? new Date(Date.now() - DEFAULT_STATS_WINDOW_MS);
  try {
    const sinceCond = sql`${aiInfluencerJobsTable.createdAt} >= ${since}`;

    const [byStatusRows, totalsRow, stuckRow] = await Promise.all([
      db
        .select({
          status: aiInfluencerJobsTable.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(aiInfluencerJobsTable)
        .where(sinceCond)
        .groupBy(aiInfluencerJobsTable.status),
      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          freeTier: sql<number>`COUNT(*) FILTER (WHERE ${aiInfluencerJobsTable.isFreeTier} = true)::int`,
          paidTier: sql<number>`COUNT(*) FILTER (WHERE ${aiInfluencerJobsTable.isFreeTier} = false)::int`,
        })
        .from(aiInfluencerJobsTable)
        .where(sinceCond),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(aiInfluencerJobsTable)
        .where(
          and(
            sinceCond,
            sql`${aiInfluencerJobsTable.status} NOT IN ('ready', 'ready_degraded', 'failed')`,
            sql`${aiInfluencerJobsTable.updatedAt} < now() - interval '1 hour'`,
          ),
        ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of KNOWN_STATUSES) byStatus[s] = 0;
    for (const row of byStatusRows) byStatus[row.status] = row.count;

    res.json({
      total: totalsRow[0]?.total ?? 0,
      stuck: stuckRow[0]?.count ?? 0,
      stuckThresholdMs: STUCK_THRESHOLD_MS,
      freeTier: totalsRow[0]?.freeTier ?? 0,
      paidTier: totalsRow[0]?.paidTier ?? 0,
      since: since.toISOString(),
      byStatus,
      generatedAt: new Date().toISOString(),
    });
    return;
  } catch (err) {
    req.log.error({ err }, "admin-influencer-generations: stats failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id — full job + owner + influencer + angles + settings + sceneJobs
// + parsed characterProfile from prefs.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, requireInfluencerAdmin, async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
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
      return;
    }

    const [ownerRow] = await db
      .select({
        clientId: aiInfluencerJobsTable.clientId,
        appUserEmail: appUsers.email,
        appUserName: appUsers.name,
        appUserIsSuperAdmin: appUsers.isSuperAdmin,
        portalUserId: portalUsersTable.id,
        portalClerkId: portalUsersTable.clerkId,
        portalEmail: portalUsersTable.email,
        portalFirstName: portalUsersTable.firstName,
        portalLastName: portalUsersTable.lastName,
        portalIsActive: portalUsersTable.isActive,
        portalIsAList: portalUsersTable.isAList,
        portalKey: portalUsersTable.portalKey,
        portalCreatedAt: portalUsersTable.createdAt,
      })
      .from(aiInfluencerJobsTable)
      .leftJoin(appUsers, eq(appUsers.id, aiInfluencerJobsTable.clientId))
      .leftJoin(portalUsersTable, eq(portalUsersTable.clerkId, appUsers.clerkId))
      .where(eq(aiInfluencerJobsTable.id, job.id))
      .limit(1);

    let influencer: (typeof aiInfluencersTable.$inferSelect) | null = null;
    let angles: Array<typeof influencerAnglesTable.$inferSelect> = [];
    let settings: Array<
      typeof influencerSettingsTable.$inferSelect & {
        images: Array<typeof settingImagesTable.$inferSelect>;
      }
    > = [];
    if (job.influencerId != null) {
      const [inf] = await db
        .select()
        .from(aiInfluencersTable)
        .where(eq(aiInfluencersTable.id, job.influencerId))
        .limit(1);
      influencer = inf ?? null;
      if (influencer) {
        angles = await db
          .select()
          .from(influencerAnglesTable)
          .where(eq(influencerAnglesTable.influencerId, influencer.id))
          .orderBy(asc(influencerAnglesTable.sortOrder), asc(influencerAnglesTable.id));
        const settingRows = await db
          .select()
          .from(influencerSettingsTable)
          .where(eq(influencerSettingsTable.influencerId, influencer.id))
          .orderBy(asc(influencerSettingsTable.sortOrder), asc(influencerSettingsTable.id));
        const settingIds = settingRows.map((s) => s.id);
        const imageRows = settingIds.length
          ? await db
              .select()
              .from(settingImagesTable)
              .where(inArray(settingImagesTable.settingId, settingIds))
              .orderBy(asc(settingImagesTable.sortOrder), asc(settingImagesTable.id))
          : [];
        settings = settingRows.map((s) => ({
          ...s,
          images: imageRows.filter((img) => img.settingId === s.id),
        }));
      }
    }

    const sceneJobs = await db
      .select()
      .from(aiInfluencerSceneJobsTable)
      .where(eq(aiInfluencerSceneJobsTable.parentJobId, job.id))
      .orderBy(asc(aiInfluencerSceneJobsTable.sceneIndex), asc(aiInfluencerSceneJobsTable.id));

    const now = Date.now();
    const updatedAt = new Date(job.updatedAt).getTime();
    const stuck = !TERMINAL_STATUSES.has(job.status) && now - updatedAt > STUCK_THRESHOLD_MS;
    const totalElapsedMs = now - new Date(job.createdAt).getTime();
    const stageElapsedMs = job.stageStartedAt ? now - new Date(job.stageStartedAt).getTime() : null;
    const heartbeatAgeMs = job.heartbeatAt ? now - new Date(job.heartbeatAt).getTime() : null;
    const prefs = readPrefs(job.prefs);

    req.log.info({ adminUserId: req.appUser?.id, jobId: job.id }, "admin-influencer-generations: detail");

    res.json({
      job: {
        // Every column on ai_influencer_jobs, serialized.
        id: job.id,
        clientId: job.clientId,
        influencerId: job.influencerId,
        status: job.status,
        progress: job.progress,
        isFreeTier: job.isFreeTier,
        etaAt: job.etaAt.toISOString(),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        stageStartedAt: isoOrNull(job.stageStartedAt),
        heartbeatAt: isoOrNull(job.heartbeatAt),
        completedAt: isoOrNull(job.completedAt),
        notifiedAt: isoOrNull(job.notifiedAt),
        emailSentAt: isoOrNull(job.emailSentAt),
        nextAttemptAt: isoOrNull(job.nextAttemptAt),
        finalizeAttempts: job.finalizeAttempts,
        higgsfieldJobId: job.higgsfieldJobId,
        enhancorJobId: job.enhancorJobId,
        failureReason: job.failureReason,
        lastErrorCode: job.lastErrorCode,
        lastErrorMessage: job.lastErrorMessage,
        lastErrorPayload: job.lastErrorPayload,
        baseImageUrl: job.baseImageUrl,
        enhancedImageUrl: job.enhancedImageUrl,
        sceneImageUrls: job.sceneImageUrls ?? [],
        scenes: job.scenes ?? [],
        retries: job.retries ?? {},
        webhookEvents: job.webhookEvents ?? [],
        prefs,
        characterProfile: prefs.characterProfile ?? null,
        timing: { totalElapsedMs, stageElapsedMs, heartbeatAgeMs, stuck, stuckThresholdMs: STUCK_THRESHOLD_MS },
      },
      owner: ownerRow ? buildOwner(ownerRow) : null,
      influencer: influencer
        ? {
            ...influencer,
            createdAt: influencer.createdAt.toISOString(),
            updatedAt: influencer.updatedAt.toISOString(),
          }
        : null,
      angles: angles.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      settings: settings.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        images: s.images.map((img) => ({
          ...img,
          createdAt: img.createdAt.toISOString(),
        })),
      })),
      sceneJobs: sceneJobs.map((sj) => ({
        ...sj,
        leaseExpiresAt: isoOrNull(sj.leaseExpiresAt),
        stageStartedAt: isoOrNull(sj.stageStartedAt),
        nextAttemptAt: isoOrNull(sj.nextAttemptAt),
        completedAt: isoOrNull(sj.completedAt),
        failedAt: isoOrNull(sj.failedAt),
      })),
    });
    return;
  } catch (err) {
    req.log.error({ err, jobId: id }, "admin-influencer-generations: detail failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/retry — fresh job, reuses the existing influencer row.
// Stamps the PRIOR job's manually_delivered_* audit fields so we have
// an actor + timestamp on the source row that was retried.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/retry", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const [priorJob] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);

    if (!priorJob) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Admin override: retry is allowed from any state. If the source
    // job is still running we first flag it as superseded so the
    // finalize loop stops waking it up; the new job carries the
    // buyer's slot forward.
    if (!TERMINAL_STATES.has(priorJob.status)) {
      await db
        .update(aiInfluencerJobsTable)
        .set({
          status: "failed",
          failureReason: "admin_retry_supersede",
          lastErrorCode: "DELIVERY_FAILURE",
          lastErrorMessage: `Admin queued a retry from /admin/influencer-generations (was ${priorJob.status}).`,
          completedAt: priorJob.completedAt ?? new Date(),
          heartbeatAt: new Date(),
        })
        .where(eq(aiInfluencerJobsTable.id, id));
    }
    let influencerId = priorJob.influencerId;
    if (influencerId) {
      await db
        .update(aiInfluencersTable)
        .set({ status: "building" })
        .where(eq(aiInfluencersTable.id, influencerId));
    } else {
      const [inf] = await db
        .insert(aiInfluencersTable)
        .values({
          clientId: priorJob.clientId,
          name: `Influencer ${Date.now()}`,
          niche: null,
          gender: priorJob.prefs.gender ?? null,
          ageRange: priorJob.prefs.ageRange ?? null,
          status: "building",
        })
        .returning({ id: aiInfluencersTable.id });
      influencerId = inf?.id ?? null;
    }

    const min = 28 * 60 * 1000;
    const max = 60 * 60 * 1000;
    const etaAt = new Date(Date.now() + Math.floor(min + Math.random() * (max - min)));

    const [row] = await db
      .insert(aiInfluencerJobsTable)
      .values({
        clientId: priorJob.clientId,
        prefs: priorJob.prefs,
        etaAt,
        isFreeTier: priorJob.isFreeTier,
        status: "queued",
        progress: 0,
        influencerId,
      })
      .returning();

    // Audit: stamp the PRIOR job (the row that was acted on) with
    // the admin actor + timestamp. The new job inherits the
    // influencer slot but has no admin author of its own.
    await db
      .update(aiInfluencerJobsTable)
      .set({
        manuallyDeliveredAt: new Date(),
        manuallyDeliveredByClerkId: req.userId ?? null,
      })
      .where(eq(aiInfluencerJobsTable.id, id));

    logger.info(
      {
        task: 695,
        route: "admin-influencer-generations.retry",
        priorJobId: id,
        newJobId: row.id,
        influencerId,
        adminClerkId: req.userId,
      },
      "admin retried influencer generation",
    );

    // Task #708: ping Viktor on admin-driven retries too.
    const { notifyViktor } = await import("../lib/viktor-slack");
    void notifyViktor({ jobId: row.id, reason: "admin_retry" });
    const { notifyMondayNewInfluencerJob } = await import("../lib/monday");
    void notifyMondayNewInfluencerJob({ jobId: row.id });

    res.status(201).json({ ok: true, newJobId: row.id, influencerId });
  } catch (err) {
    req.log.error({ err, id }, "admin-influencer-generations: retry failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/mark-failed
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/mark-failed", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
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
      return;
    }
    if (TERMINAL_STATES.has(job.status)) {
      res.json({ ok: true, alreadyTerminal: true, status: job.status });
      return;
    }
    const sceneCount = Array.isArray(job.sceneImageUrls) ? job.sceneImageUrls.length : 0;

    const [updatedJob] = await db
      .update(aiInfluencerJobsTable)
      .set({
        status: "failed",
        failureReason: CLEANUP_REASON,
        lastErrorCode: "DELIVERY_FAILURE",
        lastErrorMessage: `Admin marked failed from /admin/influencer-generations (was ${job.status}, ${sceneCount} scenes, ${job.finalizeAttempts} finalize attempts).`,
        heartbeatAt: new Date(),
        completedAt: job.completedAt ?? new Date(),
        manuallyDeliveredAt: new Date(),
        manuallyDeliveredByClerkId: req.userId ?? null,
      })
      .where(eq(aiInfluencerJobsTable.id, id))
      .returning();

    logger.info(
      {
        task: 695,
        route: "admin-influencer-generations.mark-failed",
        jobId: id,
        fromStatus: job.status,
        adminClerkId: req.userId,
      },
      "admin marked influencer generation as failed",
    );

    // Task #701: notify #ops that an admin hand-failed a stuck job.
    // Emitter swallows its own errors so a flaky webhook can never
    // bubble back into the response.
    await postInfluencerStuckAlert({
      jobId: id,
      clientId: job.clientId,
      source: "admin_mark_failed",
      failureReason: CLEANUP_REASON,
      finalizeAttempts: job.finalizeAttempts,
      etaAgeMs: job.etaAt ? Date.now() - new Date(job.etaAt).getTime() : null,
      totalElapsedMs: Date.now() - new Date(job.createdAt).getTime(),
      extra: {
        fromStatus: job.status,
        sceneCount,
        adminClerkId: req.userId ?? null,
        adminEmail: req.appUser?.email ?? null,
      },
    });

    res.json({ ok: true, jobId: id, status: "failed" });
  } catch (err) {
    req.log.error({ err, id }, "admin-influencer-generations: mark-failed failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/manual-deliver
//   { coverImageUrl: string, scenes?: [{ url: string, label?: string }] }
//
// Hand-finalises the job from admin-supplied URLs. Writes / updates
// the ai_influencers row (avatar = coverImageUrl, status = active),
// upserts a default "Front" influencer_angles row, replaces the
// "Admin Delivered" influencer_settings row + its setting_images
// children, flips the job to ready with sceneImageUrls populated,
// sends the buyer the ready notification + Resend email, and stamps
// the audit trail. Idempotent: re-running for an already-ready job
// short-circuits.
// ─────────────────────────────────────────────────────────────────────────────
const manualDeliverBody = z.object({
  coverImageUrl: z.string().url(),
  scenes: z
    .array(
      z.object({
        url: z.string().url(),
        label: z.string().trim().max(120).optional(),
      }),
    )
    .max(10)
    .optional()
    .default([]),
});

router.post("/:id/manual-deliver", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }

  const parsed = manualDeliverBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const { coverImageUrl, scenes } = parsed.data;

  try {
    const [job] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (job.status === "ready" || job.status === "ready_degraded") {
      res.json({ ok: true, alreadyDelivered: true, status: job.status });
      return;
    }
    // Manual deliver is allowed from any non-ready state, including
    // failed - support sometimes needs to recover a failed row by
    // hand-pasting the assets that did get generated.
    const wasFailed = job.status === "failed";

    // Resolve / create the ai_influencers row.
    let influencerId = job.influencerId;
    if (influencerId) {
      await db
        .update(aiInfluencersTable)
        .set({ status: "active", avatarUrl: coverImageUrl })
        .where(eq(aiInfluencersTable.id, influencerId));
    } else {
      const [inf] = await db
        .insert(aiInfluencersTable)
        .values({
          clientId: job.clientId,
          name: `Influencer ${Date.now()}`,
          niche: null,
          gender: job.prefs.gender ?? null,
          ageRange: job.prefs.ageRange ?? null,
          avatarUrl: coverImageUrl,
          status: "active",
        })
        .returning({ id: aiInfluencersTable.id });
      influencerId = inf?.id ?? null;
      if (!influencerId) {
        res.status(500).json({ error: "influencer_create_failed" });
        return;
      }
    }

    // Populate influencer_angles (a single "Front" angle backed by
    // the cover image) if none exist. Front-of-body angle is the
    // canonical reference image the rest of the workspace renders.
    const [existingAngle] = await db
      .select({ id: influencerAnglesTable.id })
      .from(influencerAnglesTable)
      .where(eq(influencerAnglesTable.influencerId, influencerId))
      .limit(1);
    if (!existingAngle) {
      await db.insert(influencerAnglesTable).values({
        influencerId,
        label: "Front",
        imageUrl: coverImageUrl,
        prompt: null,
        sortOrder: 0,
      });
    }

    // Replace any prior "Admin Delivered" setting + its images
    // with what the admin just pasted. Other setting categories
    // (if hydrate ran earlier) are left intact.
    const adminSettingName = "Admin Delivered";
    const priorSetting = await db
      .select({ id: influencerSettingsTable.id })
      .from(influencerSettingsTable)
      .where(
        and(
          eq(influencerSettingsTable.influencerId, influencerId),
          eq(influencerSettingsTable.name, adminSettingName),
        ),
      );
    for (const s of priorSetting) {
      await db.delete(settingImagesTable).where(eq(settingImagesTable.settingId, s.id));
      await db.delete(influencerSettingsTable).where(eq(influencerSettingsTable.id, s.id));
    }
    const sceneEntries: Array<{ url: string; label: string }> = [];
    if (scenes.length > 0) {
      const [setting] = await db
        .insert(influencerSettingsTable)
        .values({
          influencerId,
          name: adminSettingName,
          description: `Manually delivered by admin (${req.appUser?.email ?? "unknown"}).`,
          sortOrder: 999,
        })
        .returning({ id: influencerSettingsTable.id });
      if (setting) {
        let i = 0;
        for (const sc of scenes) {
          await db.insert(settingImagesTable).values({
            settingId: setting.id,
            imageUrl: sc.url,
            label: sc.label ?? `Scene ${i + 1}`,
            prompt: null,
            sortOrder: i,
          });
          sceneEntries.push({ url: sc.url, label: sc.label ?? `Scene ${i + 1}` });
          i++;
        }
      }
    }

    // Insert portal notification idempotently (claim notifiedAt).
    let notified = false;
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(aiInfluencerJobsTable)
        .set({ notifiedAt: new Date() })
        .where(and(eq(aiInfluencerJobsTable.id, id), isNull(aiInfluencerJobsTable.notifiedAt)))
        .returning({ id: aiInfluencerJobsTable.id });
      if (claimed.length === 0) return;
      notified = true;
      const href = `/influencer/${influencerId}`;
      await tx.insert(portalNotificationsTable).values({
        clientId: job.clientId,
        type: "influencer_ready",
        title: "Your AI influencer is ready",
        body: "Our team finished building your AI influencer. Tap to open the workspace.",
        payload: { jobId: id, influencerId, reason: MANUAL_DELIVERY_REASON },
        href,
      });
    });

    // Flip the job to ready with the admin-supplied artifact URLs.
    await db
      .update(aiInfluencerJobsTable)
      .set({
        status: "ready",
        progress: 100,
        influencerId,
        baseImageUrl: job.baseImageUrl ?? coverImageUrl,
        enhancedImageUrl: job.enhancedImageUrl ?? coverImageUrl,
        sceneImageUrls: sceneEntries.length > 0 ? sceneEntries : (job.sceneImageUrls ?? []),
        completedAt: job.completedAt ?? new Date(),
        heartbeatAt: new Date(),
        failureReason: MANUAL_DELIVERY_REASON,
        lastErrorCode: null,
        lastErrorMessage: null,
        manuallyDeliveredAt: new Date(),
        manuallyDeliveredByClerkId: req.userId ?? null,
      })
      .where(eq(aiInfluencerJobsTable.id, id));

    // Send the ready email idempotently (skip if already sent).
    let emailStatus: "sent" | "failed" | "skipped-already-sent" | "skipped-no-email" =
      "skipped-no-email";
    const [user] = await db
      .select({ email: appUsers.email, name: appUsers.name })
      .from(appUsers)
      .where(eq(appUsers.id, job.clientId))
      .limit(1);
    if (job.emailSentAt) {
      emailStatus = "skipped-already-sent";
    } else if (user?.email) {
      const firstName = user.name?.trim().split(/\s+/)[0];
      const greeting = firstName ? `Hi ${firstName},` : "Hi,";
      const base = publicBaseUrl();
      const ctaUrl = base
        ? `${base}/members/influencer/${influencerId}`
        : `/influencer/${influencerId}`;
      const text = [
        greeting,
        "",
        "Your AI influencer is ready inside AI Influencer Portfolio.",
        "Our team finished the portrait and placed your influencer into real-world scenes you can use as launch content.",
        "",
        `Open the workspace here: ${ctaUrl}`,
        "",
        "- The AI Influencer Portfolio team",
      ].join("\n");
      const html = `
        <p>${escapeHtml(greeting)}</p>
        <p>Your AI influencer is ready inside AI Influencer Portfolio.</p>
        <p>Our team finished the portrait and placed your influencer into real-world scenes you can use as launch content.</p>
        <p style="margin:24px 0;">
          <a href="${escapeHtml(
            ctaUrl,
          )}" style="display:inline-block;background:#C9A44C;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;font-size:13px;">
            Open The Workspace
          </a>
        </p>
        <p style="color:#999;font-size:13px;">- The AI Influencer Portfolio team</p>
      `;
      const sent = await sendEmail({
        userId: job.clientId,
        email: user.email,
        subject: "Your AI influencer is ready",
        body: text,
        bodyHtml: html,
        templateType: "influencer_ready",
        metadata: { jobId: id, influencerId, reason: MANUAL_DELIVERY_REASON },
      });
      if (sent.status === "sent") {
        await db
          .update(aiInfluencerJobsTable)
          .set({ emailSentAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, id));
        emailStatus = "sent";
      } else {
        emailStatus = "failed";
      }
    }

    logger.info(
      {
        task: 695,
        route: "admin-influencer-generations.manual-deliver",
        jobId: id,
        influencerId,
        sceneCount: sceneEntries.length,
        fromStatus: job.status,
        wasFailed,
        notified,
        emailStatus,
        adminClerkId: req.userId,
        adminEmail: req.appUser?.email,
      },
      "admin manual-delivered influencer generation",
    );

    res.json({
      ok: true,
      jobId: id,
      status: "ready",
      influencerId,
      sceneCount: sceneEntries.length,
      notified,
      emailStatus,
    });
  } catch (err) {
    req.log.error({ err, id }, "admin-influencer-generations: manual-deliver");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
