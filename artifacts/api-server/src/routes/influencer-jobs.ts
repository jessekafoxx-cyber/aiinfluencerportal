import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencersTable,
  portalNotificationsTable,
  portalUsersTable,
  type AiInfluencerJob,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireInfluencerAdmin } from "../middlewares/requireInfluencerAdmin";
import { logger } from "../lib/logger";
import { recordExecutionEvent, recordRecoveryEvent } from "../lib/provider-telemetry";
import {
  syncDriveScenes,
  onHiggsfieldResult,
  onEnhancorResult,
  persistJobError,
  regenerateSingleScene,
  getJobCostBreakdown,
} from "../lib/influencer-pipeline";
import { applyDnaSampledStyle, buildCharacterProfile } from "../lib/influencer-character";
import { ensureUniqueIdentityDna } from "../lib/influencer-identity-dna";
import { extractIdentityTraits } from "../lib/influencer-notes-extractor";
import { computePurchaseEntitlements } from "./portal";
import {
  isLivePipelineEnabled,
  failingProviders,
  getProviderAuthSnapshot,
  refreshProviderAuth,
} from "../lib/influencer-provider-preflight";
import { notifyViktor, isInternalInfluencerPipelineEnabled } from "../lib/viktor-slack";
import { notifyMondayNewInfluencerJob } from "../lib/monday";
import {
  appendWebhookEvent,
  truncatePayload,
  WEBHOOK_EVENT_HISTORY_LIMIT,
  logStageTransition,
} from "../lib/influencer-observability";
// Slice C: provider adapter abstraction. Webhook routes additively call
// adapter.normalizeWebhook(req.body) so the normalized contract is
// available alongside the existing inline parsing. Existing parsing
// stays the source of truth - normalized assetUrls[0] is appended only
// as a fallback - so behavior is identical to the pre-Slice-C path.
import { getProvider } from "../providers/shared/manager";

// ─────────────────────────────────────────────────────────────────────────────
// Task #250 - webhook idempotency helper. Each webhook payload is keyed
// by (provider, providerJobId or external_ref, content hash) and that key
// is checked against the per-job ring buffer before we re-run the
// pipeline transition. Returns true if we have already processed this
// exact callback within the last WEBHOOK_EVENT_HISTORY_LIMIT events.
// ─────────────────────────────────────────────────────────────────────────────
// Primary idempotency key is (provider, providerJobId). Provider redeliveries
// of the same job carry the same provider job id even when the body shifts
// slightly (e.g. retries with updated timestamps), so we treat any prior
// event for the same (provider, providerJobId) as a duplicate. Falls back
// to body-hash matching only when the provider did not include a job id.
type WebhookEventRow = {
  provider: string;
  receivedAt: string;
  providerJobId: string | null;
  signatureMode: "verified" | "unsigned";
  processed: boolean;
  body: unknown;
};

// Idempotency keys ONLY on events that were successfully processed
// (processed=true). This prevents a malformed first callback (missing
// image URL, etc) from poisoning the providerJobId — a later valid
// redelivery with the same id is still allowed through. Falls back to
// body-hash matching when the provider did not include a job id.
async function isDuplicateWebhook(
  jobId: number,
  provider: string,
  providerJobId: string | null,
  bodyHash: string,
): Promise<boolean> {
  const [row] = await db
    .select({ webhookEvents: aiInfluencerJobsTable.webhookEvents })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .limit(1);
  const events = (row?.webhookEvents ?? []) as WebhookEventRow[];
  const processed = events.filter((e) => e.processed);
  if (providerJobId) {
    return processed.some((e) => e.provider === provider && e.providerJobId === providerJobId);
  }
  return processed.some((e) => e.provider === provider && JSON.stringify(e.body) === bodyHash);
}

type WebhookEventInput = {
  provider: string;
  receivedAt: string;
  providerJobId: string | null;
  signatureMode: "verified" | "unsigned";
  processed: boolean;
  body: unknown;
};

async function recordWebhookEvent(jobId: number, next: WebhookEventInput): Promise<void> {
  const [row] = await db
    .select({ webhookEvents: aiInfluencerJobsTable.webhookEvents })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .limit(1);
  const events = (row?.webhookEvents ?? []) as WebhookEventRow[];
  const updated = appendWebhookEvent(events, { ...next, body: truncatePayload(next.body) }, WEBHOOK_EVENT_HISTORY_LIMIT);
  await db
    .update(aiInfluencerJobsTable)
    .set({ webhookEvents: updated, heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));
}

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Free-tier policy: every client gets one free AI influencer job. Any
// additional job must be gated behind a paid add-on (returned as HTTP 402 so
// the frontend can prompt the upgrade flow). Counts both completed and in-
// flight jobs so the user can not race two free jobs through the queue.
// ─────────────────────────────────────────────────────────────────────────────
// Task #283: count successful / in-flight free-tier jobs for this client.
// "Failed" jobs do not consume quota - matches the spirit of the original
// `clientHasUsedFreeTier` check (which let users retry after a failed
// build).
async function countActiveInfluencerJobs(clientId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.clientId, clientId),
        eq(aiInfluencerJobsTable.isFreeTier, true),
        sql`${aiInfluencerJobsTable.status} <> 'failed'`,
      ),
    );
  return row?.c ?? 0;
}

// Task #283: resolve the user's total influencer-build cap. Reads the
// shared entitlement aggregator so the API and the UI stay aligned.
// Total cap = 1 free build + bonusInfluencerQuota (5 when upsell2Paid).
//
// Task #362 fix: aiInfluencerJobs.clientId references app_users.id, but
// computePurchaseEntitlements / upsell2InfluencerUnlockSeen live on the
// separate portal_users table. Those two tables have independent id
// sequences and they only coincide for users created in the exact same
// order. Looking up portal_users by app_users.id silently loaded the
// wrong account (or no row at all) for every user whose ids drifted,
// which is why a buyer with upsell2_paid=true still saw "0 of 1" and
// the cap-reached banner. We now resolve the portal user by clerkId so
// entitlements always come from the right account.
async function resolveInfluencerQuota(
  clientId: number,
  clerkId: string | undefined | null,
): Promise<{ used: number; total: number; bonusUnlocked: boolean; unlockSeen: boolean }> {
  const [user] = clerkId
    ? await db
        .select()
        .from(portalUsersTable)
        .where(eq(portalUsersTable.clerkId, clerkId))
        .limit(1)
    : [undefined];
  const entitlements = await computePurchaseEntitlements(user);
  const bonus = entitlements.bonusInfluencerQuota ?? 0;
  const total = 1 + bonus;
  const used = await countActiveInfluencerJobs(clientId);
  return {
    used,
    total,
    bonusUnlocked: bonus > 0,
    unlockSeen: !!user?.upsell2InfluencerUnlockSeen,
  };
}

// "Manual feel" delay: 28-150 minutes from job creation. In dev, an env knob
// short-circuits this to 60 seconds so we can exercise the full UX in one
// sitting.
// Dev/testing mode: shortened user-visible ETA so the finalize promotion gate
// (which refuses to flip a job to "ready" before etaAt) doesn't block the UI
// Restored DFY queue UX: 28-180 minute manual-feel window. The pipeline
// may finish earlier internally; the etaAt gate holds the visible
// "ready" state until the queue timer elapses. Set
// INFLUENCER_JOB_MARKETING_ETA=0 to collapse the window (60-180s) for
// pipeline integration tests; default is the production marketing range.
const COLLAPSE_ETA = process.env.INFLUENCER_JOB_MARKETING_ETA === "0";
const ETA_MIN_SECONDS = COLLAPSE_ETA ? 60 : 28 * 60;
const ETA_MAX_SECONDS = COLLAPSE_ETA ? 180 : 180 * 60;

function pickEtaAt(): Date {
  const range = ETA_MAX_SECONDS - ETA_MIN_SECONDS;
  const offsetSec = ETA_MIN_SECONDS + Math.floor(Math.random() * range);
  return new Date(Date.now() + offsetSec * 1000);
}

const PREF_GENDER_VALUES = ["female", "male", "non_binary"] as const;
const PREF_AGE_VALUES = ["18-24", "25-32", "33-40", "41-50", "51-65"] as const;
const PREF_ETHNICITY_VALUES = [
  "white",
  "black",
  "east_asian",
  "south_asian",
  "hispanic_latino",
  "middle_eastern",
  "mixed",
] as const;

// Task #442 - explicit facial-hair and hairstyle pins. Both are
// optional; the DNA sampler picks an age- and gender-appropriate value
// when the user leaves them blank. Centralized here so the values match
// the dropdown on the Generate modal and so unknown values get coerced
// to null instead of crashing the schema (backward compatible with
// existing callers that omit the fields entirely).
const PREF_FACIAL_HAIR_VALUES = [
  "clean shaven",
  "light stubble",
  "moderate stubble",
  "beard-stubble",
  "short groomed beard",
  "medium full beard",
  "thick full beard",
  "goatee",
  "mustache only",
] as const;
const PREF_HAIRSTYLE_VALUES = [
  "short tapered",
  "medium textured crop",
  "side-swept medium",
  "tousled medium",
  "slicked-back short",
  "modern fringe",
  "buzz cut",
  "loose curls medium",
  "long shoulder-length",
  "high-volume quiff",
  "textured pompadour",
  "messy fringe",
  "curtain fringe medium",
  "undercut with longer top",
  "low fade with textured top",
  "comb-over with side part",
  "man bun shoulder-length",
  "loose waves medium",
  "long straight",
  "long loose waves",
  "medium soft layers",
  "medium straight bob",
  "long beach waves",
  "shoulder-length blunt cut",
  "long ponytail",
  "medium textured lob",
  "natural curls long",
  "natural curls medium",
  "shoulder-length layered",
] as const;

const generateBody = z.object({
  ageRange: z.enum(PREF_AGE_VALUES),
  ethnicity: z.enum(PREF_ETHNICITY_VALUES),
  gender: z.enum(PREF_GENDER_VALUES),
  vibe: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(800).optional().nullable(),
  facialHair: z.enum(PREF_FACIAL_HAIR_VALUES).optional().nullable(),
  hairstyle: z.enum(PREF_HAIRSTYLE_VALUES).optional().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/influencer-jobs
// Submit the Generate modal. Returns the queued job (status=queued).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }

  const parsed = generateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "bad_body",
      code: "validation_failed",
      message: "Please fill in every required field on the Generate form (vibe, age range, ethnicity, gender) and try again.",
      issues: parsed.error.issues,
    }); return;
  }

  // Task #261: live-pipeline gate. Refuse to enqueue a new run if any
  // upstream provider is failing the auth preflight. We trigger a
  // refresh on miss so the very first request after a key rotation
  // does not have to wait for the next preflight tick.
  // Task #708: skip the preflight entirely when the internal pipeline
  // is OFF - Viktor runs generation off-platform so Higgsfield /
  // Enhancor auth state is irrelevant to whether we can queue a job.
  if (isInternalInfluencerPipelineEnabled() && !isLivePipelineEnabled()) {
    if (!getProviderAuthSnapshot()) {
      await refreshProviderAuth();
    }
    if (!isLivePipelineEnabled()) {
      const failing = failingProviders();
      const snap = getProviderAuthSnapshot();
      req.log.warn(
        { failing, snap },
        "influencer-jobs: refused enqueue - provider auth preflight not green",
      );
      res.status(503).json({
        error: "provider_auth_failed",
        code: "upstream_unavailable",
        failingProviders: failing,
        message:
          "Our AI generation service is temporarily unavailable. Please try again in a few minutes; if it keeps failing, contact support.",
        providerAuth: snap,
      }); return;
    }
  }

  // Task #283: quota-aware gate. Free tier = 1, Upsell 2 buyers = 6.
  const quota = await resolveInfluencerQuota(userId, req.userId);
  if (quota.used >= quota.total) {
    res.status(402).json({
      error: "quota_exceeded",
      code: "entitlement_exhausted",
      used: quota.used,
      total: quota.total,
      bonusUnlocked: quota.bonusUnlocked,
      message: quota.bonusUnlocked
        ? `You have used all ${quota.total} of your AI influencer generations.`
        : "Your free AI influencer has already been generated. Upgrade to create more.",
    }); return;
  }

  try {
    const etaAt = pickEtaAt();
    // Cinematic refactor (T002): infer + persist the canonical
    // CharacterProfile at enqueue time so every downstream prompt
    // (master portrait, scene placements, vision QA) reads the same
    // brief instead of re-deriving it from raw prefs each call.
    // Smart-extract identity callouts from the free-text "Anything else?"
    // notes field. When the user did NOT pin a facialHair / hairstyle
    // dropdown but typed something like "slight beard" or "quiff
    // hairstyle" into notes, fold the extracted canonical value into
    // basePrefs BEFORE the DNA sampler runs. This way the DNA's
    // beardStyle / hairStyle get pinned the same as if the user had
    // chosen the dropdown, and every downstream prompt + QA scoring
    // sees the same value. Dropdown picks always win the merge.
    const pinnedFacialHair = parsed.data.facialHair ?? null;
    const pinnedHairstyle = parsed.data.hairstyle ?? null;
    const notesValue = parsed.data.notes ?? null;
    const extractedFromNotes = extractIdentityTraits(notesValue);
    const basePrefs = {
      ageRange: parsed.data.ageRange,
      ethnicity: parsed.data.ethnicity,
      gender: parsed.data.gender,
      vibe: parsed.data.vibe,
      notes: notesValue,
      // Task #442 - persist user-pinned facial hair / hairstyle so every
      // downstream prompt (master portrait, scene placements, QA) reads
      // them off prefs.characterProfile instead of re-deriving from the
      // demographic envelope.
      facialHair: pinnedFacialHair ?? extractedFromNotes?.facialHair ?? null,
      hairstyle: pinnedHairstyle ?? extractedFromNotes?.hairstyle ?? null,
    };
    // Generate randomized identity DNA constrained by the demographic
    // envelope, with anti-collision verification against this client's
    // recent influencers. Two users picking identical dropdowns get
    // distinct people because DNA randomizes within each envelope. We
    // also forward ageRange / facialHair / hairstyle so the sampler can
    // (1) suppress weathered descriptors on young briefs and (2) lock
    // the DNA's beardStyle / hairStyle to the user's pin when present.
    const dna = await ensureUniqueIdentityDna(userId, {
      gender: basePrefs.gender as "male" | "female" | "non_binary",
      ethnicity: basePrefs.ethnicity,
      ageRange: basePrefs.ageRange,
      facialHair: basePrefs.facialHair,
      hairstyle: basePrefs.hairstyle,
    });
    // Build the base profile, attach the DNA, then re-derive the
    // DNA-sampled styling variants (sub-lane, photo/fashion/lighting/
    // camera/cinematic/facial variant ids, scene-tag subset) so the
    // persisted brief is keyed off the DNA hash. This is what makes
    // two users picking identical dropdowns get visibly different
    // styling executions (T383).
    const baseProfile = { ...buildCharacterProfile(basePrefs), dna };
    const characterProfile = applyDnaSampledStyle(baseProfile, null) as unknown as Record<string, unknown>;
    // Task #721: DB-level guard against the cap race. Two concurrent
    // POSTs at 5/6 can both read used=5 from the application-level
    // resolveInfluencerQuota() above and race past the gate, producing
    // used > total. Re-check the count inside a transaction protected
    // by a per-client advisory lock so only one inserter at a time can
    // pass the gate for the same buyer. Lock is held for the
    // transaction (xact) and released on commit/rollback.
    const insertResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`influencer-jobs:${userId}`}))`,
      );
      const [countRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(aiInfluencerJobsTable)
        .where(
          and(
            eq(aiInfluencerJobsTable.clientId, userId),
            eq(aiInfluencerJobsTable.isFreeTier, true),
            sql`${aiInfluencerJobsTable.status} <> 'failed'`,
          ),
        );
      const usedNow = countRow?.c ?? 0;
      if (usedNow >= quota.total) {
        return { kind: "quota_exceeded" as const, used: usedNow };
      }
      const [inserted] = await tx
        .insert(aiInfluencerJobsTable)
        .values({
          clientId: userId,
          prefs: { ...basePrefs, characterProfile },
          etaAt,
          isFreeTier: true,
          status: "queued",
          progress: 0,
        })
        .returning();
      return { kind: "created" as const, row: inserted };
    });

    if (insertResult.kind === "quota_exceeded") {
      res.status(402).json({
        error: "quota_exceeded",
        used: insertResult.used,
        total: quota.total,
        bonusUnlocked: quota.bonusUnlocked,
        message: quota.bonusUnlocked
          ? `You have used all ${quota.total} of your AI influencer generations.`
          : "Your free AI influencer has already been generated. Upgrade to create more.",
      });
      return;
    }
    const row = insertResult.row;

    // T354 follow-up: persist the influencer entity at job creation time so
    // the frontend can redirect the user straight into the cinematic
    // workspace at /influencer/:id while the pipeline is still rendering.
    // Uses the same `Influencer ${jobId}` naming convention the finalize
    // path keys off, so the worker's existing ON CONFLICT lookup picks up
    // this row instead of inserting a duplicate.
    let influencerId: number | null = null;
    try {
      const inserted = await db.execute<{ id: number }>(sql`
        insert into ${aiInfluencersTable}
          (client_id, name, gender, age_range, status)
        values (
          ${userId},
          ${`Influencer ${row.id}`},
          ${basePrefs.gender ?? null},
          ${basePrefs.ageRange ?? null},
          'building'
        )
        on conflict (client_id, name) where name like 'Influencer %'
        do nothing
        returning id
      `);
      influencerId = (inserted.rows ?? inserted)[0]?.id ?? null;
      if (!influencerId) {
        const [existing] = await db
          .select({ id: aiInfluencersTable.id })
          .from(aiInfluencersTable)
          .where(
            and(
              eq(aiInfluencersTable.clientId, userId),
              eq(aiInfluencersTable.name, `Influencer ${row.id}`),
            ),
          )
          .limit(1);
        influencerId = existing?.id ?? null;
      }
      if (influencerId) {
        await db
          .update(aiInfluencerJobsTable)
          .set({ influencerId })
          .where(eq(aiInfluencerJobsTable.id, row.id));
      }
    } catch (err) {
      // Non-fatal: the finalize path will create the influencer if this
      // best-effort upfront insert fails. The user will just land on
      // /your-influencers instead of the workspace.
      req.log.warn({ err, jobId: row.id }, "influencer-jobs: upfront influencer insert failed");
    }

    req.log.info({ jobId: row.id, influencerId, etaAt }, "influencer-jobs: queued");
    // Task #708: Slack-notify Viktor so he can pick up the job via the
    // external API. Fire-and-forget; never blocks the buyer response.
    void notifyViktor({ jobId: row.id, reason: "new" });
    void notifyMondayNewInfluencerJob({ jobId: row.id });
    res.status(201).json({ job: { ...serializeJob(row), influencerId } }); return;
  } catch (err: unknown) {
    req.log.error({ err }, "influencer-jobs: create failed");
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: "internal_error",
      code: "internal_error",
      message: `We could not queue your AI influencer build. ${message}. Please try again in a minute; if it keeps failing, contact support.`,
    }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/influencer-jobs/retry
// Task #388: dedicated retry path for a failed influencer build. Unlike
// the regular POST /influencer-jobs, this REUSES the existing
// ai_influencers row instead of creating a new "Influencer N" row.
// Behavior:
//   - 404 if the influencer does not exist or is not owned by caller
//   - 409 if the influencer is not in status='failed' (active or
//     building rows must not be re-dispatched)
//   - Copies prefs from the most recent job for that influencer (or
//     falls back to caller-supplied prefs if none can be found)
//   - Inserts a fresh ai_influencer_jobs row with influencerId
//     pre-stamped so the pipeline finalize path reuses the same
//     influencer row
//   - Flips ai_influencers.status back to 'building'
// Quota is NOT double-charged: countActiveInfluencerJobs excludes
// status='failed', so the failed slot already returned to the user.
// We still run the quota gate so an at-cap user cannot exceed it via
// retry.
// ─────────────────────────────────────────────────────────────────────────────
const retryBody = z.object({
  influencerId: z.number().int().positive(),
});

router.post("/retry", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const parsed = retryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues }); return;
  }
  const influencerId = parsed.data.influencerId;

  try {
    // Ownership check up front so we return the right error code.
    const [inf] = await db
      .select()
      .from(aiInfluencersTable)
      .where(
        and(
          eq(aiInfluencersTable.id, influencerId),
          eq(aiInfluencersTable.clientId, userId),
        ),
      )
      .limit(1);
    if (!inf) { res.status(404).json({ error: "not_found" }); return; }
    if (inf.status !== "failed") {
      res.status(409).json({ error: "not_failed", status: inf.status }); return;
    }

    // Provider preflight gate (same as POST /). Task #708: skipped
    // when the internal pipeline is OFF.
    if (isInternalInfluencerPipelineEnabled() && !isLivePipelineEnabled()) {
      if (!getProviderAuthSnapshot()) await refreshProviderAuth();
      if (!isLivePipelineEnabled()) {
        const failing = failingProviders();
        res.status(503).json({
          error: "provider_auth_failed",
          code: "upstream_unavailable",
          failingProviders: failing,
          message:
            "Our AI generation service is temporarily unavailable. Please try again in a few minutes; if it keeps failing, contact support.",
          providerAuth: getProviderAuthSnapshot(),
        }); return;
      }
    }

    // Quota gate (failed jobs already don't count, but enforce ceiling).
    const quota = await resolveInfluencerQuota(userId, req.userId);
    if (quota.used >= quota.total) {
      res.status(402).json({
        error: "quota_exceeded",
        used: quota.used,
        total: quota.total,
        bonusUnlocked: quota.bonusUnlocked,
      }); return;
    }

    // Recover the most recent prefs for this influencer.
    const [priorJob] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(
        and(
          eq(aiInfluencerJobsTable.influencerId, influencerId),
          eq(aiInfluencerJobsTable.clientId, userId),
        ),
      )
      .orderBy(desc(aiInfluencerJobsTable.id))
      .limit(1);
    if (!priorJob) {
      res.status(409).json({ error: "no_prior_job_to_copy_prefs_from" }); return;
    }

    // Atomic transition: only one concurrent retry can flip
    // 'failed' -> 'building'. The second request sees zero rows and
    // bails out with 409 instead of double-enqueueing a job.
    const flipped = await db
      .update(aiInfluencersTable)
      .set({ status: "building" })
      .where(
        and(
          eq(aiInfluencersTable.id, influencerId),
          eq(aiInfluencersTable.clientId, userId),
          eq(aiInfluencersTable.status, "failed"),
        ),
      )
      .returning({ id: aiInfluencersTable.id });
    if (flipped.length === 0) {
      res.status(409).json({ error: "not_failed" }); return;
    }

    const etaAt = pickEtaAt();
    let row;
    try {
      [row] = await db
        .insert(aiInfluencerJobsTable)
        .values({
          clientId: userId,
          prefs: priorJob.prefs,
          etaAt,
          isFreeTier: priorJob.isFreeTier,
          status: "queued",
          progress: 0,
          influencerId,
        })
        .returning();
    } catch (err) {
      // If the job insert blows up, roll the influencer back so the
      // user can retry again instead of being wedged at 'building'.
      await db
        .update(aiInfluencersTable)
        .set({ status: "failed" })
        .where(eq(aiInfluencersTable.id, influencerId));
      throw err;
    }

    req.log.info(
      { jobId: row.id, influencerId, priorJobId: priorJob.id },
      "influencer-jobs: retry queued (reusing existing influencer row)",
    );
    void notifyViktor({ jobId: row.id, reason: "retry" });
    void notifyMondayNewInfluencerJob({ jobId: row.id });
    res.status(201).json({ job: { ...serializeJob(row), influencerId } }); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: retry failed");
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: "internal_error",
      code: "internal_error",
      message: `We could not retry this AI influencer build. ${message}. Please try again in a minute; if it keeps failing, contact support.`,
    }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/influencer-jobs/quota
// Task #283: returns { used, total, bonusUnlocked, unlockSeen } so the My
// Influencers page can render the quota indicator and decide whether to
// show the one-time unlock popup without recomputing entitlement state.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/quota", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const quota = await resolveInfluencerQuota(userId, req.userId);
    res.json(quota); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: quota failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/influencer-jobs/unlock-seen
// Task #283: marks the Upsell 2 bonus-influencer celebratory popup as
// seen for this user. Idempotent. Persisted server-side (not localStorage)
// so the popup follows the user across devices and only ever fires once.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/unlock-seen", requireAuth, async (req: Request, res: Response) => {
  // Task #362: identity-mapping fix. We previously updated portal_users
  // by req.appUser.id, but app_users and portal_users have independent
  // id sequences - drifted users had unlock-seen written to the wrong
  // row (or none). Resolve by clerkId, mirroring resolveInfluencerQuota.
  const clerkId = req.userId;
  if (!clerkId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    await db
      .update(portalUsersTable)
      .set({ upsell2InfluencerUnlockSeen: true, updatedAt: new Date() })
      .where(eq(portalUsersTable.clerkId, clerkId));
    res.json({ ok: true }); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: unlock-seen failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/influencer-jobs
// List the caller's jobs newest-first.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const rows = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.clientId, userId))
      .orderBy(desc(aiInfluencerJobsTable.id));
    res.json({ jobs: rows.map(serializeJob) }); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: list failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/influencer-jobs/:id
// Single job for the status card poller. Owner-scoped.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const [row] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(
        and(
          eq(aiInfluencerJobsTable.id, id),
          eq(aiInfluencerJobsTable.clientId, userId),
        ),
      )
      .limit(1);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    // Task #674: extend single-job payload with per-scene attempt
    // history + last provider response codes so admin diagnostics can
    // see exactly why scene-swap wedged without scraping logs. We do
    // NOT add it to the bulk list response — only this owner-scoped
    // single-job endpoint — to keep the list cheap.
    const sceneStates = (row.scenes ?? []) as Array<{
      idx: number;
      sceneId?: number | null;
      templateId?: string | null;
      state: string;
      attempts: number;
      lastErrorCode?: string | null;
      lastErrorAt?: string | null;
      lastDispatchAt?: string | null;
      lastCompletedAt?: string | null;
      lastGeminiMs?: number | null;
      lastOutputBytes?: number | null;
      lastRetryReason?: string | null;
      qaWarning?: boolean;
      imageUrl?: string | null;
      attemptHistory?: Array<{
        attemptNumber: number;
        dispatchedAt?: string | null;
        completedAt?: string | null;
        geminiMs?: number | null;
        outputBytes?: number | null;
        retryReason?: string | null;
        ok?: boolean;
      }> | null;
    }>;
    const scenes = sceneStates.map((s) => ({
      idx: s.idx,
      sceneId: s.sceneId ?? null,
      templateId: s.templateId ?? null,
      state: s.state,
      attempts: s.attempts,
      lastErrorCode: s.lastErrorCode ?? null,
      lastErrorAt: s.lastErrorAt ?? null,
      lastDispatchAt: s.lastDispatchAt ?? null,
      lastCompletedAt: s.lastCompletedAt ?? null,
      lastGeminiMs: s.lastGeminiMs ?? null,
      lastOutputBytes: s.lastOutputBytes ?? null,
      lastRetryReason: s.lastRetryReason ?? null,
      qaWarning: s.qaWarning ?? false,
      imageUrl: s.imageUrl ?? null,
      attemptHistory: s.attemptHistory ?? [],
    }));
    res.json({
      job: {
        ...serializeJob(row),
        scenes,
        lastErrorMessage: row.lastErrorMessage ?? null,
        retries: row.retries ?? null,
      },
    }); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: get failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: trigger a Drive sync of the scene catalog. Gated to admin emails
// (same allow-list as other admin tooling). Safe to re-run; only new files
// are downloaded.
// ─────────────────────────────────────────────────────────────────────────────
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: fast-forward an in-flight job to "ready" by clearing the eta_at
// hold and triggering finalize. Only finalizes if the pipeline already
// produced a portrait — otherwise returns 409 so the admin knows to wait
// for at least the base portrait. Mounted under /:id so the frontend
// "Skip wait" button on the active job card can call it directly.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/admin/skip-wait", requireAuth, async (req: Request, res: Response) => {
  const email = (req.appUser?.email ?? "").toLowerCase();
  const isSuper = !!req.appUser?.isSuperAdmin;
  if (!isSuper && !ADMIN_EMAILS.has(email)) {
    res.status(403).json({ error: "forbidden" }); return;
  }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const [row] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    if (row.status === "ready" || row.status === "ready_degraded" || row.status === "failed") {
      res.json({ ok: true, status: row.status, alreadyDone: true }); return;
    }
    // The pipeline must have at least produced a base portrait before we
    // can finalize. If we are still waiting on Higgsfield/Enhancor, return
    // 409 so the admin sees an explicit "too early" signal instead of a
    // silent no-op.
    if (!row.baseImageUrl && !row.enhancedImageUrl) {
      res.status(409).json({
        error: "not_ready_to_finalize",
        message:
          "The base portrait has not arrived yet. Wait for the pipeline to reach 'swapping_scenes' before skipping the wait.",
        status: row.status,
      }); return;
    }
    // Pull eta_at into the past so the next finalize tick promotes the job.
    await db
      .update(aiInfluencerJobsTable)
      .set({ etaAt: new Date(Date.now() - 1000) })
      .where(eq(aiInfluencerJobsTable.id, id));
    // Also kick the finalize loop right now so the admin doesn't have to
    // wait for the next worker tick. finalizeReadyJobs is idempotent and
    // owner-agnostic — safe to invoke from a request handler.
    const { finalizeReadyJobs } = await import("../lib/influencer-pipeline");
    await finalizeReadyJobs();
    const [after] = await db
      .select({ status: aiInfluencerJobsTable.status })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);
    res.json({ ok: true, status: after?.status ?? row.status }); return;
  } catch (err) {
    req.log.error({ err }, "influencer-jobs: skip-wait failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #261 follow-up — partial scene regeneration.
// POST /api/portal/influencer-jobs/:id/scenes/:idx/regenerate
// Owner OR admin can re-run a single scene through Gemini without
// disturbing other scenes. Requires the job to already have a base /
// enhanced portrait (otherwise there is nothing to swap into the
// scene). Bypasses the free-tier preflight gate because it does not
// re-dispatch Higgsfield/Enhancor.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/scenes/:idx/regenerate",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    const idx = Number.parseInt(String(req.params.idx ?? ""), 10);
    if (!Number.isFinite(id) || !Number.isFinite(idx) || idx < 0) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    try {
      const [row] = await db
        .select()
        .from(aiInfluencerJobsTable)
        .where(eq(aiInfluencerJobsTable.id, id))
        .limit(1);
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      const email = (req.appUser?.email ?? "").toLowerCase();
      const isAdmin = !!req.appUser?.isSuperAdmin || ADMIN_EMAILS.has(email);
      if (!isAdmin && row.clientId !== userId) {
        res.status(403).json({ error: "forbidden" }); return;
      }
      const result = await regenerateSingleScene(id, idx);
      if (!result.ok) {
        const status =
          result.reason === "job_not_found" || result.reason === "scene_not_found" ? 404 : 409;
        res.status(status).json({ error: result.reason }); return;
      }
      res.json({ ok: true, scene: result.scene }); return;
    } catch (err) {
      req.log.error({ err, jobId: id, sceneIdx: idx }, "influencer-jobs: scene regenerate failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task #261 follow-up — per-job cost breakdown.
// GET /api/portal/influencer-jobs/:id/cost
// Owner OR admin. Sums provider_cost_events recorded against this
// job (Higgsfield, Enhancor, Gemini per-scene attempts).
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/cost", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const [row] = await db
      .select({ clientId: aiInfluencerJobsTable.clientId })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }
    const email = (req.appUser?.email ?? "").toLowerCase();
    const isAdmin = !!req.appUser?.isSuperAdmin || ADMIN_EMAILS.has(email);
    if (!isAdmin && row.clientId !== userId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const breakdown = await getJobCostBreakdown(id);
    res.json(breakdown); return;
  } catch (err) {
    req.log.error({ err, jobId: id }, "influencer-jobs: cost breakdown failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

router.post("/admin/sync-scenes", requireAuth, async (req: Request, res: Response) => {
  const email = (req.appUser?.email ?? "").toLowerCase();
  if (!ADMIN_EMAILS.has(email)) { res.status(403).json({ error: "forbidden" }); return; }
  try {
    const result = await syncDriveScenes();
    res.json({ ok: true, result }); return;
  } catch (err) {
    req.log.error({ err }, "sync-scenes failed");
    res.status(500).json({ error: "sync_failed", message: (err as Error).message }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Higgsfield webhook for influencer jobs. Routed off external_ref prefix
// "infjob:<id>" so it can not collide with the existing onboarding webhook
// (which uses a numeric profile id as external_ref).
//
// Auth model mirrors the onboarding webhook: HMAC verification when
// HIGGSFIELD_WEBHOOK_SECRET is set; in dev we accept unsigned requests
// with a loud warning. In production, unsigned is hard-rejected.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// Returns the signature mode so the webhook handler can persist
// `verified` vs `unsigned` on the event ring buffer (admin diagnostics
// surface this so an operator can see whether each callback was
// signature-verified or accepted unsigned).
//
// HIGGSFIELD_WEBHOOK_SECRET is OPTIONAL (Higgsfield does not currently
// publish a documented signed-webhook contract). Behavior:
//   - secret SET → verify signature (sha256 HMAC over raw body) or a
//     shared-secret header; reject mismatches.
//   - secret UNSET → accept the callback unsigned, log every header
//     and the raw body so an operator can replay the exact callback
//     from the logs, and continue processing normally. Stamp
//     `signatureMode: "unsigned"` on the ring buffer.
// The verification path is preserved end-to-end so when Higgsfield
// ships signed webhooks in the future, simply setting the env var
// flips this back to strict mode without code changes.
function verifyHiggsfieldSignature(req: Request): { ok: boolean; mode: "verified" | "unsigned" } {
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  if (!secret) {
    // Mask common secret-bearing headers so an accidental prod-tail
    // does not leak a token if the upstream ever starts sending one.
    const safeHeaders: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      const val = Array.isArray(v) ? v.join(", ") : v ?? null;
      if (val == null) {
        safeHeaders[key] = null;
        continue;
      }
      if (
        key === "x-higgsfield-secret" ||
        key === "authorization" ||
        key === "cookie" ||
        key === "proxy-authorization"
      ) {
        safeHeaders[key] = `<set len:${val.length}>`;
      } else {
        safeHeaders[key] = val;
      }
    }
    const rawBody: Buffer | null = req.rawBody ?? null;
    logger.info(
      {
        path: req.path,
        method: req.method,
        rawBodyLength: rawBody?.length ?? null,
        rawBody: rawBody ? rawBody.toString("utf8") : null,
        body: req.body,
        headers: safeHeaders,
      },
      "Higgsfield webhook accepted unsigned (HIGGSFIELD_WEBHOOK_SECRET not set; signed-webhook contract not published by provider)",
    );
    return { ok: true, mode: "unsigned" };
  }
  const sig = req.header("x-higgsfield-signature");
  const shared = req.header("x-higgsfield-secret");
  const raw: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
  if (sig) {
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(sig.replace(/^sha256=/, ""), "hex");
      const ok = a.length === b.length && timingSafeEqual(a, b);
      if (ok) return { ok, mode: "verified" };
    } catch {}
  }
  if (shared) {
    const a = Buffer.from(secret);
    const b = Buffer.from(shared);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, mode: "verified" };
    }
  }
  // Higgsfield's callback contract echoes back the `secret` we sent in the
  // dispatch body's `webhook.secret` field, inside the callback body itself
  // (sometimes at body.secret, sometimes at body.webhook.secret). Accept
  // either as proof-of-origin.
  const body = (req.body ?? {}) as { secret?: unknown; webhook?: { secret?: unknown } };
  const bodySecret =
    typeof body.secret === "string"
      ? body.secret
      : typeof body.webhook?.secret === "string"
        ? body.webhook!.secret
        : null;
  if (bodySecret) {
    const a = Buffer.from(secret);
    const b = Buffer.from(bodySecret);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, mode: "verified" };
    }
  }
  // Last resort: in development we accept the callback unsigned and log
  // every header + body so an operator can confirm Higgsfield's exact
  // contract and tighten the verifier accordingly. Production stays strict.
  if (process.env.NODE_ENV !== "production") {
    logger.warn(
      {
        path: req.path,
        method: req.method,
        rawBodyLength: req.rawBody?.length ?? null,
        rawBody: req.rawBody?.toString("utf8") ?? null,
        body: req.body,
        headerKeys: Object.keys(req.headers),
      },
      "Higgsfield webhook accepted unsigned (dev fallback) - tighten verifier once contract is confirmed",
    );
    return { ok: true, mode: "unsigned" };
  }
  return { ok: false, mode: "verified" };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

router.post("/higgsfield-webhook", async (req: Request, res: Response) => {
  const verify = verifyHiggsfieldSignature(req);
  if (!verify.ok) {
    res.status(401).json({ error: "invalid_signature" }); return;
  }
  const body = (req.body ?? {}) as {
    external_ref?: string;
    externalRef?: string;
    images?: Array<{ url?: string }>;
    imageUrl?: string;
    image_url?: string;
  };
  // Job correlation: prefer the ?infjob=<id> query param we set on the
  // webhook URL at dispatch time (Task #288 — the current Higgsfield
  // text2image API does not echo a custom external_ref). Fall back to
  // the legacy "infjob:<id>" external_ref for any in-flight callbacks
  // queued by the previous code path.
  const rawInfjob = req.query.infjob;
  const infjobStr = Array.isArray(rawInfjob) ? String(rawInfjob[0] ?? "") : String(rawInfjob ?? "");
  const externalRef = String(body.external_ref ?? body.externalRef ?? "");
  let jobId: number;
  if (infjobStr) {
    jobId = Number(infjobStr);
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "bad_infjob" }); return; }
  } else if (externalRef.startsWith("infjob:")) {
    jobId = Number(externalRef.slice("infjob:".length));
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "bad_external_ref" }); return; }
  } else {
    res.status(404).json({ error: "wrong_handler" }); return;
  }
  // Slice C: route the raw webhook body through the higgsfield adapter
  // for the normalized contract. Existing inline extraction below still
  // wins as the source of truth - normalized.assetUrls[0] is a fallback.
  const normalizedHf = getProvider("higgsfield").normalizeWebhook(req.body);
  const imageUrl =
    body.images?.[0]?.url ??
    body.imageUrl ??
    body.image_url ??
    normalizedHf.assetUrls[0] ??
    null;
  // Higgsfield's text2image API returns the job id as `request_id`;
  // older responses used `id`. Prefer `request_id` to match what the
  // dispatcher persisted as the providerJobId (Task #288).
  const providerJobId =
    (body as { request_id?: string; id?: string }).request_id ??
    (body as { id?: string }).id ??
    null;

  // Idempotency: if we already processed this exact payload (same
  // provider job id + body content) for this job within the last
  // WEBHOOK_EVENT_HISTORY_LIMIT events, return 200 without re-running
  // the pipeline transition. Higgsfield retries are common.
  const bodyHash = JSON.stringify(truncatePayload(req.body));
  if (await isDuplicateWebhook(jobId, "higgsfield", providerJobId, bodyHash)) {
    req.log.info({ jobId, providerJobId }, "higgsfield-webhook: duplicate, ignoring");
    recordExecutionEvent({
      provider: "higgsfield",
      operation: "webhook",
      stage: "base_generation",
      jobId,
      providerJobId,
      success: true,
      webhookUsed: true,
      metadata: { duplicate: true },
    });
    res.json({ ok: true, duplicate: true }); return;
  }

  if (!imageUrl) {
    req.log.warn({ jobId, providerJobId }, "Higgsfield webhook: no image url in payload");
    // Persist normalized error on the job row so diagnostics + admin
    // grep see a real reason instead of a silent 200.
    await persistJobError(
      jobId,
      { code: "EMPTY_OUTPUT", message: "Higgsfield webhook missing image url" },
      truncatePayload(req.body),
    );
    logStageTransition(
      {
        jobId,
        toStage: "generating_base",
        provider: "higgsfield",
        providerJobId,
        errorCode: "EMPTY_OUTPUT",
        errorMessage: "webhook missing image url",
      },
      req.log,
    );
    // Record the event for diagnostics, marked NOT processed so a
    // subsequent valid redelivery with the same providerJobId can still
    // be applied (idempotency matches processed=true only).
    await recordWebhookEvent(jobId, {
      provider: "higgsfield",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode: verify.mode,
      processed: false,
      body: req.body,
    });
    recordExecutionEvent({
      provider: "higgsfield",
      operation: "webhook",
      stage: "base_generation",
      jobId,
      providerJobId,
      success: false,
      webhookUsed: true,
      errorClass: "EMPTY_OUTPUT",
      errorCode: "EMPTY_OUTPUT",
      errorMessage: "webhook missing image url",
    });
    res.json({ ok: true }); return;
  }
  try {
    await onHiggsfieldResult(jobId, imageUrl, providerJobId ?? undefined);
    await recordWebhookEvent(jobId, {
      provider: "higgsfield",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode: verify.mode,
      processed: true,
      body: req.body,
    });
    recordExecutionEvent({
      provider: "higgsfield",
      operation: "webhook",
      stage: "base_generation",
      jobId,
      providerJobId,
      success: true,
      webhookUsed: true,
    });
    res.json({ ok: true }); return;
  } catch (err) {
    req.log.error({ err, jobId }, "higgsfield-webhook handler failed");
    await recordWebhookEvent(jobId, {
      provider: "higgsfield",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode: verify.mode,
      processed: false,
      body: req.body,
    });
    recordExecutionEvent({
      provider: "higgsfield",
      operation: "webhook",
      stage: "base_generation",
      jobId,
      providerJobId,
      success: false,
      webhookUsed: true,
      errorClass: "TRANSIENT",
      errorMessage: String(err).slice(0, 500),
    });
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Enhancor webhook. Enhancor's queue API supports a per-call webhookUrl
// (we set ?infjob=<id>), so the job id rides along on the query string and
// we do not need a separate signature scheme here (the URL itself is the
// only thing tying a callback to a job).
//
// Defense in depth: we still require ENHANCOR_WEBHOOK_SECRET to match an
// optional `x-enhancor-secret` header when set, so the operator can lock
// the endpoint down once Enhancor exposes a signing scheme.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/enhancor-webhook", async (req: Request, res: Response) => {
  const expected = process.env.ENHANCOR_WEBHOOK_SECRET;
  if (expected) {
    // Enhancor cannot set custom headers on its callback, so the secret
    // rides as a query param (`?s=...`). We accept either the query param
    // or the legacy `x-enhancor-secret` header for forward compatibility.
    const rawS = req.query.s;
    const fromQuery = Array.isArray(rawS) ? String(rawS[0] ?? "") : String(rawS ?? "");
    const fromHeader = req.header("x-enhancor-secret") ?? "";
    const got = fromQuery || fromHeader;
    if (!got || !timingSafeEqualStr(got, expected)) {
      res.status(401).json({ error: "invalid_secret" }); return;
    }
  } else if (process.env.NODE_ENV === "production") {
    logger.error("Enhancor webhook REJECTED in production — ENHANCOR_WEBHOOK_SECRET missing");
    res.status(401).json({ error: "webhook_secret_required" }); return;
  } else {
    // Dev-mode unsigned acceptance: log full body so the dev can replay.
    logger.warn(
      { path: req.path, query: req.query, bodyPreview: truncatePayload(req.body, 1000) },
      "Enhancor webhook accepted WITHOUT secret (dev mode)",
    );
  }
  const signatureMode: "verified" | "unsigned" = expected ? "verified" : "unsigned";
  const raw = req.query.infjob;
  const jobIdRaw = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
  const jobId = Number(jobIdRaw);
  if (!Number.isFinite(jobId)) { res.status(400).json({ error: "bad_infjob" }); return; }
  const body = (req.body ?? {}) as {
    output_url?: string;
    outputUrl?: string;
    image_url?: string;
    imageUrl?: string;
    url?: string;
    result?: { url?: string };
    id?: string;
    jobId?: string;
    job_id?: string;
  };
  // Slice C: normalize via the enhancor adapter. Existing extraction
  // wins; normalized.assetUrls[0] is appended as the final fallback.
  const normalizedEn = getProvider("enhancor").normalizeWebhook(req.body);
  const url =
    body.output_url ??
    body.outputUrl ??
    body.image_url ??
    body.imageUrl ??
    body.url ??
    body.result?.url ??
    normalizedEn.assetUrls[0] ??
    null;
  const providerJobId = body.id ?? body.jobId ?? body.job_id ?? null;

  const bodyHash = JSON.stringify(truncatePayload(req.body));
  if (await isDuplicateWebhook(jobId, "enhancor", providerJobId, bodyHash)) {
    req.log.info({ jobId, providerJobId }, "enhancor-webhook: duplicate, ignoring");
    recordExecutionEvent({
      provider: "enhancor",
      operation: "webhook",
      stage: "enhancement",
      jobId,
      providerJobId,
      success: true,
      webhookUsed: true,
      metadata: { duplicate: true },
    });
    res.json({ ok: true, duplicate: true }); return;
  }

  if (!url) {
    // Slice A: Enhancor is an OPTIONAL stage. An empty/malformed payload
    // must NOT stall the job at 95% forever. Persist the diagnostic for
    // forensics, then advance the pipeline using the base portrait as
    // the "enhanced" image. The job will land in ready_degraded at
    // finalize time so the user gets a usable influencer + we keep the
    // Enhancor incident visible in admin diagnostics.
    req.log.warn({ jobId, providerJobId }, "Enhancor webhook: no image url, degrading to base portrait");
    await persistJobError(
      jobId,
      { code: "ENHANCOR_DEGRADED", message: "Enhancor webhook missing image url; using base portrait as enhanced" },
      truncatePayload(req.body),
    );
    await recordWebhookEvent(jobId, {
      provider: "enhancor",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode,
      processed: false,
      body: req.body,
    });
    // Look up base portrait. If we have one, advance through onEnhancorResult
    // using base-as-enhanced. If not, leave the job in enhancing for the
    // stuck-recovery path (markStuckFailed) to handle.
    const [job] = await db
      .select({ baseImageUrl: aiInfluencerJobsTable.baseImageUrl, status: aiInfluencerJobsTable.status })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, jobId))
      .limit(1);
    if (!job?.baseImageUrl || job.status !== "enhancing") {
      logStageTransition(
        { jobId, toStage: "enhancing", provider: "enhancor", providerJobId, errorCode: "ENHANCOR_DEGRADED", errorMessage: "no base portrait available; awaiting stuck recovery" },
        req.log,
      );
      recordExecutionEvent({
        provider: "enhancor",
        operation: "webhook",
        stage: "enhancement",
        jobId,
        providerJobId,
        success: false,
        degraded: true,
        webhookUsed: true,
        errorClass: "EMPTY_OUTPUT",
        errorCode: "ENHANCOR_DEGRADED",
        errorMessage: "no base portrait; awaiting stuck recovery",
      });
      res.json({ ok: true, degraded: true, advanced: false }); return;
    }
    try {
      await onEnhancorResult(jobId, job.baseImageUrl, providerJobId ?? undefined);
      recordExecutionEvent({
        provider: "enhancor",
        operation: "webhook",
        stage: "enhancement",
        jobId,
        providerJobId,
        success: true,
        degraded: true,
        webhookUsed: true,
        errorClass: "EMPTY_OUTPUT",
        errorCode: "ENHANCOR_DEGRADED",
        errorMessage: "advanced with base portrait as enhanced",
      });
      recordRecoveryEvent({
        jobId,
        recoveryKind: "enhancor_degraded_passthrough",
        fromProvider: "enhancor",
        toProvider: "enhancor",
        stage: "enhancement",
        reason: "Enhancor webhook missing image url; using base portrait",
        success: true,
      });
      logStageTransition(
        { jobId, toStage: "swapping_scenes", provider: "enhancor", providerJobId, errorCode: "ENHANCOR_DEGRADED", errorMessage: "advanced with base portrait as enhanced" },
        req.log,
      );
      res.json({ ok: true, degraded: true, advanced: true }); return;
    } catch (err) {
      req.log.error({ err, jobId }, "Enhancor degrade-to-base advance failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  }
  try {
    await onEnhancorResult(jobId, url, providerJobId ?? undefined);
    await recordWebhookEvent(jobId, {
      provider: "enhancor",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode,
      processed: true,
      body: req.body,
    });
    res.json({ ok: true }); return;
  } catch (err) {
    req.log.error({ err, jobId }, "enhancor-webhook handler failed");
    await recordWebhookEvent(jobId, {
      provider: "enhancor",
      receivedAt: new Date().toISOString(),
      providerJobId,
      signatureMode,
      processed: false,
      body: req.body,
    });
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/influencer-jobs/:id/admin/diagnostics
// Returns the full pipeline state for one job: status, stage, retry
// counters, per-scene state, last error, recent webhook events, and
// elapsed times. Used by an operator to debug a wedged job without
// needing direct DB access. Admin-gated (super-admin or ADMIN_EMAILS).
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/admin/diagnostics", requireAuth, requireInfluencerAdmin, async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const [row] = await db
      .select()
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, id))
      .limit(1);
    if (!row) { res.status(404).json({ error: "not_found" }); return; }

    const now = Date.now();
    const totalElapsedMs = now - new Date(row.createdAt).getTime();
    const stageElapsedMs = row.stageStartedAt ? now - new Date(row.stageStartedAt).getTime() : null;
    const heartbeatAgeMs = row.heartbeatAt ? now - new Date(row.heartbeatAt).getTime() : null;

    res.json({
      jobId: row.id,
      clientId: row.clientId,
      status: row.status,
      progress: row.progress,
      isFreeTier: row.isFreeTier,
      etaAt: row.etaAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      stageStartedAt: row.stageStartedAt?.toISOString() ?? null,
      heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      notifiedAt: row.notifiedAt?.toISOString() ?? null,
      emailSentAt: row.emailSentAt?.toISOString() ?? null,
      timing: { totalElapsedMs, stageElapsedMs, heartbeatAgeMs },
      providerIds: {
        higgsfield: row.higgsfieldJobId,
        enhancor: row.enhancorJobId,
      },
      retries: row.retries ?? {},
      finalizeAttempts: row.finalizeAttempts,
      lastError: row.lastErrorCode
        ? {
            code: row.lastErrorCode,
            message: row.lastErrorMessage,
            payload: row.lastErrorPayload,
          }
        : null,
      failureReason: row.failureReason,
      assets: {
        baseImageUrl: row.baseImageUrl,
        enhancedImageUrl: row.enhancedImageUrl,
        sceneImageUrls: row.sceneImageUrls,
      },
      scenes: row.scenes ?? [],
      webhookEvents: row.webhookEvents ?? [],
      influencerId: row.influencerId,
      prefs: row.prefs,
    }); return;
  } catch (err) {
    req.log.error({ err }, "diagnostics failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// Cinematic refactor (T008): premium staged progress. Derived from
// the existing status / progress / scenes columns - no schema change.
// Sub-stages map naturally to the existing lifecycle:
//   queued            → "Crafting your character profile"
//   generating_base   → "Generating master portrait" or "Reviewing portrait quality"
//   enhancing         → "Enhancing realism"
//   swapping_scenes   → "Selecting lifestyle scenes" or "Rendering [Scene Name]"
//   ready             → "Done"
//   failed            → "Pipeline failed"
function deriveStage(row: AiInfluencerJob): { stageLabel: string; stageDetail: string | null } {
  switch (row.status) {
    case "queued":
      return { stageLabel: "Crafting your character profile", stageDetail: null };
    case "generating_base": {
      // Progress >= 25 means the master portrait callback ran and we
      // are inside the QA gate / re-dispatch loop.
      if (row.progress >= 25) {
        return { stageLabel: "Reviewing portrait quality", stageDetail: "Vision QA pass on the master portrait." };
      }
      return { stageLabel: "Generating master portrait", stageDetail: "Higgsfield is rendering the cinematic portrait." };
    }
    case "enhancing":
      return { stageLabel: "Enhancing realism", stageDetail: "Detail and skin-texture enhancement in progress." };
    case "swapping_scenes": {
      const scenes = row.scenes ?? [];
      if (scenes.length === 0) {
        return { stageLabel: "Selecting lifestyle scenes", stageDetail: "Picking cinematic placements for your archetype." };
      }
      const total = scenes.length;
      const done = scenes.filter((s) => s.state === "completed").length;
      const inFlight = scenes.find((s) => s.state === "processing");
      const detail = inFlight
        ? `Rendering ${inFlight.label} (${done + 1} of ${total}).`
        : `${done} of ${total} scenes complete.`;
      return { stageLabel: "Rendering lifestyle scenes", stageDetail: detail };
    }
    case "ready":
      return { stageLabel: "Done", stageDetail: "Your influencer is ready." };
    case "failed":
      return { stageLabel: "Pipeline failed", stageDetail: row.failureReason ?? row.lastErrorCode ?? null };
    default:
      return { stageLabel: row.status, stageDetail: null };
  }
}

function serializeJob(row: AiInfluencerJob) {
  // The portal does not need server-only columns like enhancorJobId.
  // We expose lastErrorCode (normalized taxonomy) so the status card
  // can show a stable code for failed jobs without leaking provider
  // payloads or stack traces.
  const { stageLabel, stageDetail } = deriveStage(row);
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    stageLabel,
    stageDetail,
    prefs: row.prefs,
    baseImageUrl: row.baseImageUrl,
    enhancedImageUrl: row.enhancedImageUrl,
    sceneImageUrls: row.sceneImageUrls,
    etaAt: row.etaAt.toISOString(),
    isFreeTier: row.isFreeTier,
    failureReason: row.failureReason,
    lastErrorCode: row.lastErrorCode,
    completedAt: row.completedAt?.toISOString() ?? null,
    influencerId: row.influencerId,
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Notifications router (mounted separately as /api/portal/notifications).
// Lives in this file so the influencer feature stays self-contained for
// slice 1 - we can extract once a second notification source is added.
// ─────────────────────────────────────────────────────────────────────────────
export const notificationsRouter: IRouter = Router();

notificationsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const rows = await db
      .select()
      .from(portalNotificationsTable)
      .where(
        and(
          eq(portalNotificationsTable.clientId, userId),
          isNull(portalNotificationsTable.readAt),
        ),
      )
      .orderBy(desc(portalNotificationsTable.id))
      .limit(20);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        payload: n.payload,
        href: n.href,
        createdAt: n.createdAt.toISOString(),
      })),
    }); return;
  } catch (err) {
    req.log.error({ err }, "notifications: list failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

notificationsRouter.post("/:id/read", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    await db
      .update(portalNotificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(portalNotificationsTable.id, id),
          eq(portalNotificationsTable.clientId, userId),
        ),
      );
    res.json({ ok: true }); return;
  } catch (err) {
    logger.error({ err }, "notifications: mark-read failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

notificationsRouter.post("/read-all", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    await db
      .update(portalNotificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(portalNotificationsTable.clientId, userId),
          isNull(portalNotificationsTable.readAt),
        ),
      );
    res.json({ ok: true }); return;
  } catch (err) {
    logger.error({ err }, "notifications: read-all failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});
