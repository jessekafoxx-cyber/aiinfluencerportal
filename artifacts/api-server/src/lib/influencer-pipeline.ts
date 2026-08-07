// ─────────────────────────────────────────────────────────────────────────────
// AI Influencer pipeline.
//
// One file owns the full state machine for /your-influencers free-tier jobs:
//
//   queued
//     → (worker tick) dispatch Higgsfield → generating_base
//   generating_base
//     → (Higgsfield webhook) base image saved → enhancing
//       (Enhancor dispatch fired in same handler)
//   enhancing
//     → (Enhancor webhook) enhanced image saved → swapping_scenes
//       (scene-swap fan-out fired in same handler, Promise.allSettled)
//   swapping_scenes
//     → (worker tick) when scenes done AND eta_at passed → ready
//       (creates aiInfluencers row, persists derived assets, fires
//        portal_notification + Resend email, sets notified_at)
//
// The "manual feel" delay (28-150 min, see route's pickEtaAt) is held by the
// finalize step — even if Higgsfield + Enhancor + 10 scene swaps complete in
// 4 min, we do not flip status to "ready" before eta_at. This keeps the buyer
// experience consistent with the marketing copy ("hand-crafted, 28 min - 2.5
// hours") without leaking server timing.
//
// Drive scene library: ai_influencer_scenes is hydrated by syncDriveScenes()
// from a fixed Drive folder (env INFLUENCER_SCENES_FOLDER_ID, defaults to the
// folder Greg shared). Each scene is downloaded once and pinned to GCS so the
// scene-swap step has a stable URL to reference. New scenes are upserted by
// drive_file_id; removed scenes stay in the table but can be disabled.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { eq, and, sql, lte, isNull, isNotNull, inArray } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencerScenesTable,
  aiInfluencersTable,
  portalNotificationsTable,
  appUsers,
  influencerSettingsTable,
  influencerAnglesTable,
  settingImagesTable,
  providerCostEventsTable,
  type AiInfluencerJob,
  type AiInfluencerScene,
} from "@workspace/db";
import { logger } from "./logger";
import { postInfluencerStuckAlert } from "./influencer-stuck-alert";
import { recordExecutionEvent, recordRecoveryEvent } from "./provider-telemetry";
import { sendEmail } from "./email";
import { objectStorageClient } from "./objectStorage";
import {
  classifyError,
  truncatePayload,
  logStageTransition,
  computeElapsed,
  RETRY_CAPS,
  type InfluencerErrorCode,
} from "./influencer-observability";
import {
  buildCharacterProfile,
  readOrInferProfile,
  type CharacterProfile,
} from "./influencer-character";
import {
  pickScenesForProfile,
  getSceneTemplateById,
  type SceneTemplate,
} from "./influencer-scenes-library";
import {
  seedSceneJobsForParent,
  hasChildSceneJobs,
  claimSceneJobs,
  markSceneJobCompleted,
  markSceneJobFailed,
  releaseExpiredLeases,
  aggregateForParent,
  attachInfluencerIdToChildren,
  SCENE_JOB_BATCH,
  type SceneJobSeed,
} from "./scene-jobs";
import {
  buildMasterIdentityPrompt,
  buildMasterIdentityPromptStrict,
  buildScenePlacementPrompt,
  buildScenePlacementPromptSoftened,
  buildScenePlacementPromptStrict,
  briefIdentityClause,
} from "./influencer-prompts";
import { dnaPromptBlock } from "./influencer-identity-dna";
import { higgsfieldHeaders } from "./higgsfield-auth";
import { selectAngleWardrobes } from "./influencer-wardrobe";
import {
  scoreMasterPortrait,
  scoreScenePlacement,
  scoreWardrobe,
  STRICT_WARDROBE_OVERRIDE,
  COST_CENTS_QA,
  type SceneQA,
} from "./influencer-qa";
// Slice C: provider adapter abstraction. Orchestration calls go through
// ProviderManager.getProvider(id) instead of dispatchHiggsfield/etc directly.
// Adapters delegate back to the dispatch* helpers in this file at call time
// (ESM live bindings), so behavior is identical to the pre-Slice-C path.
import { getProvider } from "../providers/shared/manager";

const DEFAULT_SCENES_FOLDER_ID = "14ID_WABuMmA5bRgQfBnUCSNJc8UUHGZS";
const SCENES_PER_JOB = 10;
const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";
const ENHANCOR_BASE_URL = "https://apireq.enhancor.ai";

const FAST_MODE = process.env.INFLUENCER_JOB_FAST_MODE === "1";

/**
 * Pivot kill-switch: when disabled (default), the onboarding pipeline does
 * NOT auto-render cinematic placement scenes. Instead, after the canonical
 * identity reference is enhanced, the job finalizes directly to a reusable
 * workspace (Main Image / Angles / Settings). Scene orchestration
 * infrastructure (child job table, retries, reconciliation, provider
 * abstraction) is preserved intact for future user-triggered settings
 * generation; we only short-circuit the automatic fan-out path.
 *
 * Set INFLUENCER_SCENE_FANOUT_ENABLED=1 to re-enable the legacy cinematic
 * placement gallery flow.
 */
function cinematicFanoutEnabled(): boolean {
  return process.env.INFLUENCER_SCENE_FANOUT_ENABLED === "1";
}

// SSRF guard for any URL we mirror into our bucket. Only well-known
// provider hosts are allowed; anything else is left as the upstream URL
// (still served to the user if it is publicly reachable, but never
// fetched through our server-side network).
const URL_MIRROR_ALLOWLIST = [
  "higgsfield.ai",
  "platform.higgsfield.ai",
  "enhancor.ai",
  "apireq.enhancor.ai",
  "amazonaws.com",
  "storage.googleapis.com",
  "googleusercontent.com",
  "cloudfront.net",
];

function isAllowedMirrorUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return URL_MIRROR_ALLOWLIST.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Stuck-state recovery thresholds. Jobs stuck waiting on a provider
// webhook past these limits get marked failed so the user is not
// indefinitely waiting and the sidebar/notifications path can fire.
const STUCK_GENERATING_BASE_MS = Number(process.env.INFLUENCER_STUCK_HIGGSFIELD_MS ?? 2 * 60 * 60 * 1000);
const STUCK_ENHANCING_MS = Number(process.env.INFLUENCER_STUCK_ENHANCOR_MS ?? 60 * 60 * 1000);
const STUCK_SWAPPING_MS = Number(process.env.INFLUENCER_STUCK_SWAPPING_MS ?? 60 * 60 * 1000);

// Task #674: hard cap for the "swapping_scenes with zero usable
// scene assets" wedge. If a job reaches finalize this many times
// with sceneImageUrls=[] AND its etaAt is past by at least
// NO_OUTPUT_MAX_AGE_MS, we transition it to status=failed with
// failureReason=scene_swap_no_output instead of looping on
// finalize_attempts until DELIVERY_FAILURE kicks in (which masks
// the real cause).
const SCENE_NO_OUTPUT_FINALIZE_CAP = Number(
  process.env.INFLUENCER_SCENE_NO_OUTPUT_FINALIZE_CAP ?? 3,
);
const SCENE_NO_OUTPUT_MAX_AGE_MS = Number(
  process.env.INFLUENCER_SCENE_NO_OUTPUT_MAX_AGE_MS ?? 30 * 60 * 1000,
);

// Task #674: pure predicate broken out so the regression test can
// assert the "zero usable scenes → fail" decision table without
// having to stand up a real DB / scheduler. Used for the legacy
// inline-scenes finalize gate; the Slice-B child-aggregate gate uses
// shouldFailJobForNoSceneOutputChild below.
export function shouldFailJobForNoSceneOutputChild(input: {
  childCompletedAssetsCount: number;
  childAllTerminal: boolean;
  etaAgeMs: number;
  finalizeAttempts: number;
  finalizeCap?: number;
  maxAgeMs?: number;
}): boolean {
  const finalizeCap = input.finalizeCap ?? SCENE_NO_OUTPUT_FINALIZE_CAP;
  const maxAgeMs = input.maxAgeMs ?? SCENE_NO_OUTPUT_MAX_AGE_MS;
  return (
    input.childAllTerminal &&
    input.childCompletedAssetsCount === 0 &&
    input.etaAgeMs >= maxAgeMs &&
    input.finalizeAttempts >= finalizeCap
  );
}

export function shouldFailJobForNoSceneOutput(input: {
  sceneImageUrlsCount: number;
  sceneStates: Array<{ state: string; attempts: number }>;
  etaAgeMs: number;
  finalizeAttempts: number;
  retryCap?: number;
  finalizeCap?: number;
  maxAgeMs?: number;
}): boolean {
  const retryCap = input.retryCap ?? 5;
  const finalizeCap = input.finalizeCap ?? SCENE_NO_OUTPUT_FINALIZE_CAP;
  const maxAgeMs = input.maxAgeMs ?? SCENE_NO_OUTPUT_MAX_AGE_MS;
  const allInlineDone =
    input.sceneStates.length === 0 ||
    input.sceneStates.every(
      (s) => s.state === "completed" || (s.state === "failed" && s.attempts >= retryCap),
    );
  const noUsableScenes =
    input.sceneImageUrlsCount === 0 &&
    input.sceneStates.every((s) => s.state !== "completed");
  return (
    noUsableScenes &&
    allInlineDone &&
    input.etaAgeMs >= maxAgeMs &&
    input.finalizeAttempts >= finalizeCap
  );
}

// Heartbeat is "no progress signal in this long" rather than "started
// this long ago"; lets us tell wedged jobs from slow-but-progressing
// jobs. Defaults to 20 minutes, well above expected provider latency.
const HEARTBEAT_STALE_MS = Number(process.env.INFLUENCER_HEARTBEAT_STALE_MS ?? 20 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Task #250 - shared helpers for retry, heartbeat, error persistence,
// and structured stage logging. Kept inline so the call sites stay
// readable and we do not have to thread `db` through another module.
// ─────────────────────────────────────────────────────────────────────────────

async function bumpRetry(
  jobId: number,
  key: string,
  opts: { withBackoff?: boolean } = {},
): Promise<number> {
  // Atomically increment retries->>key in jsonb so two concurrent ticks
  // do not race the counter. Returns the new count. When withBackoff is
  // true, also stamps next_attempt_at with an exponential backoff
  // (30s, 60s, 120s, … capped at 10 min) computed from the *new* count
  // so a stage-level retry waits proportionally longer between attempts
  // instead of stampeding the provider every worker tick.
  const [row] = await db
    .update(aiInfluencerJobsTable)
    .set({
      retries: sql`coalesce(${aiInfluencerJobsTable.retries}, '{}'::jsonb)
        || jsonb_build_object(${key}::text,
          coalesce((${aiInfluencerJobsTable.retries}->>${key})::int, 0) + 1)`,
    })
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .returning({ retries: aiInfluencerJobsTable.retries });
  const r = (row?.retries as Record<string, number> | undefined) ?? {};
  const newCount = Number(r[key] ?? 0);
  if (opts.withBackoff && newCount > 0) {
    const backoffMs = Math.min(30_000 * 2 ** (newCount - 1), 600_000);
    await db
      .update(aiInfluencerJobsTable)
      .set({ nextAttemptAt: new Date(Date.now() + backoffMs) })
      .where(eq(aiInfluencerJobsTable.id, jobId));
  }
  return newCount;
}

async function getRetry(jobId: number, key: string): Promise<number> {
  const [row] = await db
    .select({ retries: aiInfluencerJobsTable.retries })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .limit(1);
  const r = (row?.retries as Record<string, number> | undefined) ?? {};
  return Number(r[key] ?? 0);
}

async function touchHeartbeat(jobId: number): Promise<void> {
  await db
    .update(aiInfluencerJobsTable)
    .set({ heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));
}

/** Public wrapper so the webhook route can persist normalized error
 * state on the job row when a callback payload fails validation
 * (missing image URL, etc) without depending on the internal helper. */
export async function persistJobError(
  jobId: number,
  err: { code: InfluencerErrorCode; message: string },
  payload?: unknown,
): Promise<void> {
  await persistError(jobId, err, payload);
}

async function persistError(
  jobId: number,
  err: { code: InfluencerErrorCode; message: string },
  payload?: unknown,
): Promise<void> {
  // The lastErrorPayload column is jsonb typed as `unknown` in the
  // schema, so truncatePayload's `unknown` return is directly assignable
  // - no `as any` escape needed.
  const truncated: unknown = payload === undefined ? null : truncatePayload(payload);
  await db
    .update(aiInfluencerJobsTable)
    .set({
      lastErrorCode: err.code,
      lastErrorMessage: err.message.slice(0, 800),
      lastErrorPayload: truncated,
      heartbeatAt: new Date(),
    })
    .where(eq(aiInfluencerJobsTable.id, jobId));
}

async function failJob(
  jobId: number,
  code: InfluencerErrorCode,
  message: string,
  payload?: unknown,
): Promise<void> {
  const truncated: unknown = payload === undefined ? null : truncatePayload(payload);
  // Gate on terminal status, NOT on completedAt. The finalize path
  // sets completedAt early as the influencer-creation lock; if email
  // delivery later exhausts its retry cap we must still be able to
  // transition the job to failed. Skip only when already terminal
  // (ready or failed) to keep the call idempotent.
  await db
    .update(aiInfluencerJobsTable)
    .set({
      status: "failed",
      failureReason: code,
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 800),
      lastErrorPayload: truncated,
      completedAt: sql`coalesce(${aiInfluencerJobsTable.completedAt}, now())`,
      heartbeatAt: new Date(),
    })
    .where(
      and(
        eq(aiInfluencerJobsTable.id, jobId),
        // Slice A: ready_degraded is also a terminal state — never
        // transition a degraded-but-delivered job back into "failed".
        sql`${aiInfluencerJobsTable.status} not in ('ready','failed','ready_degraded')`,
      ),
    );
  // Task #388: mirror the failure onto the parent ai_influencers row.
  // The influencer is pre-created at job submission time with
  // status='building' and stays that way until finalize promotes it to
  // 'active'. Without this mirror a failed pipeline left the influencer
  // stuck on 'building', which My Influencers renders as "In the queue"
  // forever. Only flip rows that are still 'building' so we never
  // clobber an 'active' influencer (e.g. a salvaged retry that
  // succeeded after a transient failure was recorded). Quota refund is
  // implicit: countActiveInfluencerJobs excludes status='failed' so the
  // user immediately regains the slot.
  try {
    const [jobRow] = await db
      .select({ clientId: aiInfluencerJobsTable.clientId, influencerId: aiInfluencerJobsTable.influencerId })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, jobId))
      .limit(1);
    if (jobRow) {
      if (jobRow.influencerId) {
        await db
          .update(aiInfluencersTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(aiInfluencersTable.id, jobRow.influencerId),
              eq(aiInfluencersTable.status, "building"),
            ),
          );
      } else {
        // Pre-T388 jobs may not have stamped influencerId yet; fall back
        // to the stable autoname lookup so the influencer card still
        // unsticks from 'building'.
        await db
          .update(aiInfluencersTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(aiInfluencersTable.clientId, jobRow.clientId),
              eq(aiInfluencersTable.name, `Influencer ${jobId}`),
              eq(aiInfluencersTable.status, "building"),
            ),
          );
      }
    }
  } catch (err) {
    logger.warn({ err, jobId }, "failJob: failed to mirror status to ai_influencers");
  }
}

async function setStage(
  jobId: number,
  fromStatus: AiInfluencerJob["status"],
  toStatus: AiInfluencerJob["status"],
  extra: Partial<typeof aiInfluencerJobsTable.$inferInsert> = {},
): Promise<AiInfluencerJob | null> {
  // Atomic stage transition: only the row matching `fromStatus` flips,
  // so concurrent webhooks / ticks cannot double-advance.
  const now = new Date();
  const [row] = await db
    .update(aiInfluencerJobsTable)
    // Clear next_attempt_at on every successful stage transition: the
    // backoff timer is per-stage (set when *that* stage's retry bumped),
    // so once we move on, a stale timestamp from the previous stage
    // must not block the new stage's candidate gate.
    .set({ status: toStatus, stageStartedAt: now, heartbeatAt: now, nextAttemptAt: null, ...extra })
    .where(and(eq(aiInfluencerJobsTable.id, jobId), eq(aiInfluencerJobsTable.status, fromStatus)))
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public storage helper (mirrors routes/influencers.ts to avoid cross-file
// churn). Uploads a Buffer to the Replit object-storage bucket and returns
// the portal-facing URL served by /api/portal/images/:fileName.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];

export async function uploadPublicImage(
  buffer: Buffer,
  mimeType: string,
  prefix: string,
  hintExt?: string,
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error("object_storage_not_configured");
  }
  const ext = pickExt(mimeType, hintExt);
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

function pickExt(mime: string, hint?: string): string {
  const fromHint = (hint ?? "").toLowerCase().replace(/^\./, "");
  if (ALLOWED_IMAGE_EXTS.includes(fromHint)) return fromHint;
  if (/jpe?g/.test(mime)) return "jpg";
  if (/webp/.test(mime)) return "webp";
  if (/gif/.test(mime)) return "gif";
  return "png";
}

async function fetchAsBase64(
  url: string,
): Promise<{ data: string; mimeType: string }> {
  // Internal /api/portal/images/* URLs resolve through GCS to avoid a HTTP
  // round-trip to ourselves (which would also need auth). External URLs go
  // through fetch.
  const m = url.match(/\/api\/portal\/images\/([^/?#]+)$/);
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (m && bucketId && privateDir) {
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(`${privateDir}/${m[1]}`);
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      data: buf.toString("base64"),
      mimeType: (meta.contentType as string) || "image/png",
    };
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch_failed:${resp.status}`);
  const ab = await resp.arrayBuffer();
  return {
    data: Buffer.from(ab).toString("base64"),
    mimeType: resp.headers.get("content-type") ?? "image/png",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 2 — Drive sync
// ─────────────────────────────────────────────────────────────────────────────

interface DriveImageFile {
  id: string;
  name: string;
  mimeType: string;
}

const DRIVE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function inferGenderHint(name: string): string {
  const n = name.toLowerCase();
  if (/(^|[\s_-])(female|woman|women|girl|she|her)([\s_-]|\.)/.test(n)) return "female";
  if (/(^|[\s_-])(male|man|men|boy|he|him)([\s_-]|\.)/.test(n)) return "male";
  return "any";
}

export interface DriveSyncResult {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
}

/**
 * One-shot pull of every image in the configured Drive folder into
 * ai_influencer_scenes. Idempotent — re-runs only download files we have not
 * seen before (matched by drive_file_id). Returns counts so the admin
 * trigger can surface them.
 */
export async function syncDriveScenes(opts?: { folderId?: string; max?: number }): Promise<DriveSyncResult> {
  const folderId = opts?.folderId ?? process.env.INFLUENCER_SCENES_FOLDER_ID ?? DEFAULT_SCENES_FOLDER_ID;
  const max = Math.max(1, Math.min(opts?.max ?? 500, 1000));
  const connectors = new ReplitConnectors();

  // Page through the folder. The image library can be a few hundred files;
  // we recurse one level for sub-folders that the Drive UI users sometimes
  // create for organising by gender / vibe.
  const files: DriveImageFile[] = [];
  await listImagesRecursive(connectors, folderId, files, max, 0);

  const result: DriveSyncResult = { scanned: files.length, inserted: 0, skipped: 0, errors: 0 };
  if (files.length === 0) return result;

  const existing = await db
    .select({ driveFileId: aiInfluencerScenesTable.driveFileId })
    .from(aiInfluencerScenesTable)
    .where(inArray(aiInfluencerScenesTable.driveFileId, files.map((f) => f.id)));
  const known = new Set(existing.map((r) => r.driveFileId));

  for (const file of files) {
    if (known.has(file.id)) {
      result.skipped++;
      continue;
    }
    try {
      const res = await connectors.proxy(
        "google-drive",
        `/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
        { method: "GET" },
      );
      if (!res.ok) throw new Error(`drive_download_${res.status}`);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      const url = await uploadPublicImage(buf, file.mimeType, "scene-", file.name.split(".").pop());
      // Use returning() so concurrent syncs do not over-count inserts: only
      // the worker that actually wrote the row counts the insert.
      const inserted = await db.insert(aiInfluencerScenesTable).values({
        driveFileId: file.id,
        label: file.name.replace(/\.[a-z0-9]+$/i, ""),
        genderHint: inferGenderHint(file.name),
        gcsUrl: url,
        enabled: true,
      }).onConflictDoNothing({ target: aiInfluencerScenesTable.driveFileId }).returning({ id: aiInfluencerScenesTable.id });
      if (inserted.length > 0) {
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      result.errors++;
      logger.error({ err, fileId: file.id, name: file.name }, "drive scene sync: file failed");
    }
  }
  logger.info(result, "drive scene sync complete");
  return result;
}

async function listImagesRecursive(
  connectors: ReplitConnectors,
  folderId: string,
  out: DriveImageFile[],
  cap: number,
  depth: number,
): Promise<void> {
  if (out.length >= cap) return;
  if (depth > 3) return;
  let pageToken: string | undefined;
  for (let p = 0; p < 50; p++) {
    if (out.length >= cap) return;
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType),nextPageToken",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { files?: Array<DriveImageFile & { mimeType: string }>; nextPageToken?: string };
    for (const f of data.files ?? []) {
      if (out.length >= cap) return;
      if (f.mimeType === "application/vnd.google-apps.folder") {
        await listImagesRecursive(connectors, f.id, out, cap, depth + 1);
      } else if (DRIVE_IMAGE_MIMES.has(f.mimeType)) {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity workspace hydration (Main Image / Angles / Settings).
//
// The pivot away from cinematic scene fan-out left the finalize path without
// a way to populate the workspace UI. These helpers run inside finalizeJob
// after the influencer row is resolved and are fully idempotent so a replay
// after a partial finalize never duplicates rows.
// ─────────────────────────────────────────────────────────────────────────────

const ANGLE_SEED_PRESETS: Array<{ label: string; pose: string }> = [
  { label: "Front", pose: "looking directly into the camera, head perfectly straight, neutral relaxed expression" },
  { label: "Three-quarter Left", pose: "head turned roughly 30 to 45 degrees toward camera-left, eyes following the same direction as the head, neutral expression" },
  { label: "Three-quarter Right", pose: "head turned roughly 30 to 45 degrees toward camera-right, eyes following the same direction as the head, neutral expression" },
  { label: "Left Profile", pose: "strict left profile, head turned 90 degrees to camera-left, eyes looking horizontally to camera-left, only one ear and one side of the face visible" },
  { label: "Right Profile", pose: "strict right profile, head turned 90 degrees to camera-right, eyes looking horizontally to camera-right, only one ear and one side of the face visible" },
  { label: "Back", pose: "back of the head facing camera, person turned away showing the back of the hair and shoulders, no face visible" },
  { label: "Smiling", pose: "looking into the camera with a warm natural smile, slight teeth showing, relaxed eyes" },
  { label: "Neutral", pose: "looking into the camera with a fully neutral, relaxed expression, lips closed, no smile" },
  { label: "Looking Down", pose: "head facing forward but eyes glancing downward, soft contemplative expression" },
  { label: "Looking Away", pose: "head facing roughly forward but eyes glancing off-camera to the side, contemplative expression" },
];

// Per-angle wardrobe selection is now sourced from a vibe-conditioned
// pool (see ./influencer-wardrobe.ts). The selector samples 10 entries
// per influencer from the aesthetic bucket that matches the chosen
// vibe (soft-luxury, bold-creator, athletic-outdoor, cozy-warm,
// editorial-fashion, minimalist-pro), seeded by the influencer's DNA
// hash so two users picking identical dropdowns still get different
// wardrobe executions inside the same aesthetic.
//
// Every pool entry is a torso-covering top so the wardrobe gate in
// geminiComposeWithWardrobeGate continues to pass without relaxation.

function buildAnglePrompt(
  profile: CharacterProfile,
  pose: string,
  wardrobe: { label: string; description: string },
): string {
  const id = `${profile.gender ?? "person"}, ${profile.ageRange ?? "adult"}, ${profile.ethnicity ?? "any ethnicity"}`;
  const dna = dnaPromptBlock(profile.dna);
  return (
    `[OUTFIT_PRESET: ${wardrobe.label}] ` +
    "Generate a clean canonical identity reference photograph of the EXACT SAME PERSON shown in the input image. " +
    "STRICT IDENTITY PRESERVATION (highest priority): keep the exact same face, facial structure, jaw line, " +
    "cheekbones, nose, lips, eye shape, eye colour, eyebrows, hair colour, hair length, hairstyle, hair texture, " +
    "skin tone, skin undertone, skin texture, body proportions, height, build, and apparent age. The subject must " +
    `be unmistakably the same individual (${id}) - no gender drift, no ethnicity drift, no age drift, no facial-feature drift. ` +
    (dna ? `${dna} ` : "") +
    "WARDROBE VARIATION ALLOWED (this is intentional - do NOT copy the shirt from the reference image): " +
    "the shirt color, garment type, neckline shape, fabric texture/material, jacket-or-no-jacket, and formality " +
    "level are all expected to differ from the input image. Treat clothing as a new wardrobe choice for this shot. " +
    `OUTFIT: the subject is wearing ${wardrobe.description}. This is a new wardrobe choice and MUST differ from ` +
    "the input image's clothing - do not copy the shirt, color, or neckline from the reference. The torso, chest, " +
    "shoulders, and collarbone must remain fully covered by the described garment. " +
    "BACKGROUND: keep the same plain off-white / very light neutral studio background as the input image. Do not change the background. " +
    `POSE: ${pose}. ` +
    "FRAMING: head-and-shoulders portrait, centered, eyes roughly on the upper third, plenty of headroom. " +
    "LIGHTING: even, flat, neutral studio lighting matching the input image. No dramatic shadows, no editorial styling. " +
    "OUTPUT: a single passport / casting style identity reference photograph. Square or vertical 4:5 aspect ratio. " +
    "No text, no watermarks, no borders, no letterboxing. Output exactly ONE image."
  );
}

function buildSettingCompositionPrompt(
  profile: CharacterProfile,
  categoryName: string,
): string {
  const id = `${profile.gender ?? "person"}, ${profile.ageRange ?? "adult"}, ${profile.ethnicity ?? "any ethnicity"}`;
  const dna = dnaPromptBlock(profile.dna);
  return (
    "Place the SAME PERSON from the FIRST reference image into the environment / scene shown in the SECOND reference image. " +
    "STRICT IDENTITY PRESERVATION (highest priority): keep the exact same face, facial structure, jaw line, cheekbones, " +
    "nose, lips, eye shape, eye colour, eyebrows, hair colour, hair length, hairstyle, skin tone, skin texture, body " +
    `proportions, height, build, and apparent age as the FIRST reference image. The subject must be unmistakably the same individual (${id}) - ` +
    "no gender drift, no ethnicity drift, no age drift, no facial-feature drift. " +
    (dna ? `${dna} ` : "") +
    "Treat the second image purely as an " +
    `ENVIRONMENT REFERENCE for a "${categoryName}" scene. Do NOT copy the person, face, or body from the second image - ` +
    "only borrow the environment, props, lighting style, framing, and overall composition. " +
    "OUTFIT: choose clothing that fits the environment naturally and matches the styling of the second reference, but " +
    "the person, face, hair, and body must come from the FIRST reference image. " +
    "INTEGRATION: match the lighting direction, colour grade, white balance, depth of field, and perspective of the second " +
    "image so the person looks naturally photographed inside that scene. " +
    "OUTPUT FORMAT: vertical 9:16 aspect ratio, Instagram Reel / TikTok portrait format (1080x1920 or higher). Sharp focus, " +
    "clean detail. The final image must look like a professionally shot 4K vertical photograph. Output exactly ONE image. " +
    "No text, no watermarks, no letterboxing, no borders."
  );
}

const COMPOSE_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(
      (async () => {
        while (cursor < items.length) {
          const i = cursor++;
          try {
            await fn(items[i], i);
          } catch (err) {
            logger.warn({ err, idx: i }, "runWithConcurrency: item failed");
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
}

/**
 * Generate one identity-locked image via Gemini image-edit. Returns the
 * GCS URL of the persisted composited output, or null on failure.
 */
async function geminiComposeOne(
  prompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
  prefix: string,
): Promise<string | null> {
  const submit = await getProvider("gemini").submit({ prompt, inputImages });
  if (submit.error || !submit.raw) {
    logger.warn(
      {
        errMessage: submit.error?.message ?? "no payload",
        errCode: submit.error?.code ?? null,
        errPayload: submit.error?.payload ?? null,
        promptHead: prompt.slice(0, 240),
      },
      "geminiComposeOne: submit failed",
    );
    return null;
  }
  const raw = submit.raw as { b64_json: string; mimeType: string };
  const buf = Buffer.from(raw.b64_json, "base64");
  if (!buf || buf.length < MIN_SCENE_BYTES) {
    logger.warn(
      { bytes: buf?.length ?? 0, promptHead: prompt.slice(0, 240) },
      "geminiComposeOne: output too small",
    );
    return null;
  }
  return uploadPublicImage(buf, raw.mimeType, prefix);
}

/**
 * Generate one image and submit it to the wardrobe gate. On rejection,
 * inject STRICT_WARDROBE_OVERRIDE and regenerate up to MAX_WARDROBE_ATTEMPTS
 * times. Returns the URL of the FIRST output that passes wardrobe
 * validation, or null if every attempt either failed to generate or
 * failed validation. The caller MUST persist only on a non-null return.
 *
 * Logs:
 *   [wardrobe-check]      one per validation pass (pass or fail)
 *   [wardrobe-regenerate] one per regeneration attempt (attempt 2+)
 */
const MAX_WARDROBE_ATTEMPTS = 3;
async function geminiComposeWithWardrobeGate(
  basePrompt: string,
  inputImages: Array<{ data: string; mimeType: string }>,
  prefix: string,
  ctx: { influencerId?: number; jobId?: number; label: string },
): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_WARDROBE_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1 ? basePrompt : `${basePrompt} ${STRICT_WARDROBE_OVERRIDE}`;
    if (attempt > 1) {
      logger.warn(
        { ...ctx, attempt, prefix },
        "[wardrobe-regenerate] retrying with strict wardrobe override",
      );
    }
    const url = await geminiComposeOne(prompt, inputImages, prefix);
    if (!url) {
      logger.warn(
        { ...ctx, attempt },
        "[wardrobe-check] generation returned no image",
      );
      continue;
    }
    const verdict = await scoreWardrobe(url);
    logger.info(
      {
        ...ctx,
        attempt,
        image: url,
        status: verdict.pass ? "pass" : "fail",
        reason: verdict.reason,
        torsoExposure: verdict.torsoSkinRatio,
        shirtlessProbability: verdict.shirtlessProbability,
        exposedChest: verdict.exposedChestPercentage,
        openShirtDepth: verdict.openShirtDepth,
        visibleAbs: verdict.visibleAbs,
        notes: verdict.notes,
      },
      "[wardrobe-check]",
    );
    if (verdict.pass) return url;
  }
  logger.error(
    { ...ctx, max: MAX_WARDROBE_ATTEMPTS },
    "[wardrobe-check] wardrobe gate exhausted attempts - dropping image",
  );
  return null;
}

/**
 * Generate 10 identity-locked angle photographs of the influencer and persist
 * them as influencer_angles rows. Idempotent — skipped entirely if any angle
 * rows already exist for this influencer.
 */
async function composeIdentityAngles(
  influencerId: number,
  characterImageUrl: string,
  profile: CharacterProfile,
): Promise<void> {
  // Cheap pre-check: skip compute if rows already exist. This is racy on
  // concurrent finalize replays, so the authoritative dedup happens below
  // inside an advisory-lock-protected transaction.
  const existing = await db
    .select({ id: influencerAnglesTable.id })
    .from(influencerAnglesTable)
    .where(eq(influencerAnglesTable.influencerId, influencerId))
    .limit(1);
  if (existing.length > 0) return;

  const charInline = await fetchAsBase64(characterImageUrl);
  const results: Array<{ label: string; prompt: string; imageUrl: string; sortOrder: number }> = [];

  // Sample 10 wardrobe entries from the vibe-conditioned pool. Seeded
  // by the influencer's DNA hash so two users picking identical
  // dropdowns get different outfits inside the same aesthetic bucket.
  const wardrobeSelection = selectAngleWardrobes(profile, ANGLE_SEED_PRESETS.length);
  logger.info(
    {
      influencerId,
      vibe: profile.vibe,
      bucket: wardrobeSelection.bucket,
      subLane: wardrobeSelection.subLane,
      subLaneFallback: wardrobeSelection.subLaneFallback,
      wardrobeLabels: wardrobeSelection.entries.map((w) => w.label),
    },
    "[wardrobe-selection] sampled vibe-conditioned wardrobe for angle grid",
  );
  // Surface the full styling-execution fingerprint for this influencer
  // so we can confirm two same-dropdown influencers got visibly
  // different photography / fashion / lighting / camera / cinematic
  // executions (T383 acceptance criterion).
  logger.info(
    {
      influencerId,
      archetype: profile.archetype,
      bucket: wardrobeSelection.bucket,
      subLane: wardrobeSelection.subLane,
      photographyVariantId: profile.photographyVariantId,
      fashionVariantId: profile.fashionVariantId,
      lightingVariantId: profile.lightingVariantId,
      cameraVariantId: profile.cameraVariantId,
      cinematicVariantId: profile.cinematicVariantId,
      cinematicStyle: profile.cinematicStyle,
      facialVariantId: profile.facialVariantId,
      scenePreferenceTags: profile.scenePreferenceTags,
    },
    "[styling-variant] resolved per-influencer styling execution",
  );

  await runWithConcurrency(ANGLE_SEED_PRESETS, COMPOSE_CONCURRENCY, async (preset, i) => {
    const wardrobe = wardrobeSelection.entries[i];
    const prompt = buildAnglePrompt(profile, preset.pose, wardrobe);
    const url = await geminiComposeWithWardrobeGate(
      prompt,
      [charInline],
      "infangle-",
      { influencerId, label: `angle:${preset.label}|${wardrobeSelection.bucket}|${wardrobe.label}` },
    );
    if (url) {
      results.push({ label: preset.label, prompt, imageUrl: url, sortOrder: i });
    } else {
      // No silent fallback: skipping the slot is preferable to silently
      // duplicating the base portrait across all 10 angles, which masked
      // Gemini failures and made the workspace look correct when it
      // wasn't. The user will see a smaller grid + a clear gap that
      // signals "retry needed" instead of 10 identical headshots.
      logger.warn(
        { influencerId, label: preset.label },
        "composeIdentityAngles: gemini returned no image - dropping slot",
      );
    }
  });

  if (results.length === 0) {
    logger.error(
      { influencerId },
      "composeIdentityAngles: ALL 10 angle composites failed - inserting nothing",
    );
    return;
  }
  results.sort((a, b) => a.sortOrder - b.sortOrder);
  // Race-safe dedup: serialize concurrent finalize replays per influencer
  // via a transaction-scoped Postgres advisory lock, then re-check inside
  // the same transaction. Two concurrent calls might both compose (wasted
  // compute) but only one will insert, so the user never sees 20 angles.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(733801, ${influencerId})`);
    const stillEmpty = await tx
      .select({ id: influencerAnglesTable.id })
      .from(influencerAnglesTable)
      .where(eq(influencerAnglesTable.influencerId, influencerId))
      .limit(1);
    if (stillEmpty.length > 0) {
      logger.info(
        { influencerId },
        "composeIdentityAngles: another finalize won the race - skipping insert",
      );
      return;
    }
    await tx.insert(influencerAnglesTable).values(
      results.map((r) => ({
        influencerId,
        label: r.label,
        prompt: r.prompt,
        imageUrl: r.imageUrl,
        sortOrder: r.sortOrder,
      })),
    );
  });
}

interface DriveFolderEntry {
  id: string;
  name: string;
}

async function listDriveSubfolders(
  connectors: ReplitConnectors,
  parentFolderId: string,
): Promise<DriveFolderEntry[]> {
  const out: DriveFolderEntry[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < 10; p++) {
    const params = new URLSearchParams({
      q: `'${parentFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: "files(id,name),nextPageToken",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { files?: DriveFolderEntry[]; nextPageToken?: string };
    for (const f of data.files ?? []) out.push({ id: f.id, name: f.name });
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function listDriveImagesInFolder(
  connectors: ReplitConnectors,
  folderId: string,
): Promise<DriveImageFile[]> {
  const out: DriveImageFile[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < 5; p++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType),nextPageToken",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { files?: Array<DriveImageFile & { mimeType: string }>; nextPageToken?: string };
    for (const f of data.files ?? []) {
      if (DRIVE_IMAGE_MIMES.has(f.mimeType)) out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * Best-effort: enumerate all subfolders under INFLUENCER_SETTINGS_PARENT_FOLDER_ID,
 * pick 2 random images per category, mirror them into GCS, and persist as
 * influencer_settings + setting_images for the workspace UI.
 *
 * Idempotent: if the influencer already has any settings rows, this is a no-op
 * so finalize replays never duplicate categories. If the env var is unset or
 * the Drive call fails, we log + continue — the user still gets Main Image
 * and Angles.
 */
async function composeIdentitySettings(
  influencerId: number,
  characterImageUrl: string,
  profile: CharacterProfile,
): Promise<void> {
  const parentFolderId =
    process.env.INFLUENCER_SETTINGS_PARENT_FOLDER_ID ||
    process.env.INFLUENCER_SETTINGS_DRIVE_FOLDER_ID;
  if (!parentFolderId) {
    logger.info({ influencerId }, "settings compose: parent folder env var unset, skipping");
    return;
  }
  // Race-safe: serialize concurrent finalize replays per influencer using
  // a session-scoped Postgres advisory lock. If another worker already
  // holds the lock for this influencer, skip — it will produce the rows.
  // We do NOT short-circuit when rows already exist: the inner loop is
  // per-category aware (skip categories already at TARGET, repair the
  // rest) so that worker restarts mid-compose are recoverable on the
  // next finalize replay.
  const lockResult = await db.execute(
    sql<{ pg_try_advisory_lock: boolean }>`SELECT pg_try_advisory_lock(733802, ${influencerId}) AS pg_try_advisory_lock`,
  );
  const acquired = Boolean(
    (lockResult as unknown as { rows?: Array<{ pg_try_advisory_lock: boolean }> }).rows?.[0]
      ?.pg_try_advisory_lock,
  );
  if (!acquired) {
    logger.info(
      { influencerId },
      "composeIdentitySettings: another finalize holds the lock - skipping",
    );
    return;
  }
  try {
    await composeIdentitySettingsInner(influencerId, characterImageUrl, profile);
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(733802, ${influencerId})`);
  }
}

async function composeIdentitySettingsInner(
  influencerId: number,
  characterImageUrl: string,
  profile: CharacterProfile,
): Promise<void> {
  const parentFolderId =
    process.env.INFLUENCER_SETTINGS_PARENT_FOLDER_ID ||
    process.env.INFLUENCER_SETTINGS_DRIVE_FOLDER_ID;
  if (!parentFolderId) return;
  const connectors = new ReplitConnectors();
  const subfolders = await listDriveSubfolders(connectors, parentFolderId);
  if (subfolders.length === 0) {
    logger.warn({ influencerId, parentFolderId }, "settings compose: no subfolders found");
    return;
  }
  logger.info(
    { influencerId, parentFolderId, categoryCount: subfolders.length },
    "settings compose: enumerated Drive categories, starting per-category compositing",
  );

  const charInline = await fetchAsBase64(characterImageUrl);

  // Build the full per-category × per-reference task list, then fan out
  // with bounded concurrency. Each task composes the SAME influencer into
  // the Drive scene reference (Drive image is environment guidance only,
  // never the final output).
  // Stream per-category: download both refs, run their composites with
  // 2-way internal concurrency, persist immediately, then drop bytes
  // before moving to the next category. This keeps peak memory bounded
  // (~2 inline images + 2 outputs at a time) and saves partial progress
  // if the process dies mid-fan-out (already-persisted categories
  // survive; idempotency check skips them on the next replay).
  const TARGET_PER_CATEGORY = 2;
  const MAX_CATEGORY_CYCLES = 3;

  for (const [sIdx, folder] of subfolders.entries()) {
    // Skip categories that already have EXACTLY TARGET rows persisted from
    // a prior (interrupted) compose pass. This makes the pipeline replay-
    // safe: if the worker died mid-loop, the next finalize replay only
    // reprocesses categories that are missing or partial.
    const existingForFolder = await db
      .select({ id: settingImagesTable.id })
      .from(settingImagesTable)
      .innerJoin(
        influencerSettingsTable,
        eq(settingImagesTable.settingId, influencerSettingsTable.id),
      )
      .where(
        and(
          eq(influencerSettingsTable.influencerId, influencerId),
          eq(influencerSettingsTable.name, folder.name),
        ),
      );
    if (existingForFolder.length === TARGET_PER_CATEGORY) {
      logger.info(
        { influencerId, folder: folder.name, persisted: existingForFolder.length },
        "settings compose: category already complete, skipping",
      );
      continue;
    }
    if (existingForFolder.length > 0 && existingForFolder.length !== TARGET_PER_CATEGORY) {
      // Partial state from an interrupted prior run. Wipe so this loop
      // can rebuild the category cleanly. ON DELETE CASCADE removes
      // the orphan setting_images rows.
      await db
        .delete(influencerSettingsTable)
        .where(
          and(
            eq(influencerSettingsTable.influencerId, influencerId),
            eq(influencerSettingsTable.name, folder.name),
          ),
        );
      logger.info(
        { influencerId, folder: folder.name, prior: existingForFolder.length },
        "settings compose: cleared partial category before rebuild",
      );
    }

    let images: Awaited<ReturnType<typeof listDriveImagesInFolder>>;
    try {
      images = await listDriveImagesInFolder(connectors, folder.id);
    } catch (err) {
      logger.warn({ err, influencerId, folder: folder.name }, "settings compose: folder list failed");
      continue;
    }
    if (images.length === 0) continue;
    // Shuffle ALL available images and walk the list until we have
    // TARGET_PER_CATEGORY successful composites. Previously we picked
    // exactly 2 upfront and gave up if either the Drive download or
    // Gemini composite failed - which left some categories with only
    // 1 image. Iterating the full pool with a per-attempt download +
    // compose ensures we always hit the target when enough source
    // images exist.
    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const basePrompt = buildSettingCompositionPrompt(profile, folder.name);
    // When the Drive pool is smaller than TARGET_PER_CATEGORY (e.g. only
    // 1 reference image in the folder), we end up calling Gemini twice
    // with the SAME source pair. Diffusion outputs can come back nearly
    // identical or hit safety/dedup-style rejections. Vary the framing
    // hint per attempt so each call yields a meaningfully different
    // composite of the same underlying setting.
    const VARIATION_HINTS = [
      "FRAMING VARIATION: medium-wide shot, eye-level, environment clearly visible around the subject.",
      "FRAMING VARIATION: tighter half-body crop, slight three-quarter angle, subject anchored slightly off-center.",
      "FRAMING VARIATION: full upper-body composition, candid posture, environment visible in soft background.",
      "FRAMING VARIATION: closer portrait crop, subtle camera angle change, environment recognisable behind the subject.",
      "FRAMING VARIATION: side-of-room composition, subject positioned off-center with leading lines of the environment.",
      "FRAMING VARIATION: relaxed seated or leaning posture, environment clearly readable, soft natural depth of field.",
    ];
    // OUTER CATEGORY RETRY: re-run the compose+persist pipeline up to
    // MAX_CATEGORY_CYCLES times until the persisted setting has EXACTLY
    // TARGET_PER_CATEGORY rows in setting_images. Between cycles we delete
    // any partial persistence so the next attempt starts clean.
    let categoryCycle = 0;
    let categoryFinalCount = 0;
    while (categoryCycle < MAX_CATEGORY_CYCLES && categoryFinalCount !== TARGET_PER_CATEGORY) {
      categoryCycle += 1;

      // Clean up any partial persistence from a prior cycle so we never
      // accumulate orphan setting_images rows. ON DELETE CASCADE cleans
      // setting_images automatically.
      if (categoryCycle > 1) {
        await db
          .delete(influencerSettingsTable)
          .where(
            and(
              eq(influencerSettingsTable.influencerId, influencerId),
              eq(influencerSettingsTable.name, folder.name),
            ),
          );
        logger.info(
          { category: folder.name, influencerId, cycle: categoryCycle },
          "[settings-category-retry]",
        );
      }

      const successful: Array<{ refIndex: number; imageUrl: string }> = [];
      const MAX_ATTEMPTS = Math.max(TARGET_PER_CATEGORY * 6, shuffled.length * 3);
      let attempted = 0;
      while (successful.length < TARGET_PER_CATEGORY && attempted < MAX_ATTEMPTS) {
        const img = shuffled[attempted % shuffled.length];
        if (!img) break;
        attempted += 1;
        let refInline: { data: string; mimeType: string } | null = null;
        try {
          const res = await connectors.proxy(
            "google-drive",
            `/drive/v3/files/${encodeURIComponent(img.id)}?alt=media`,
            { method: "GET" },
          );
          if (!res.ok) {
            logger.warn(
              { influencerId, fileId: img.id, status: res.status },
              "settings compose: drive download failed",
            );
          } else {
            const ab = await res.arrayBuffer();
            refInline = { data: Buffer.from(ab).toString("base64"), mimeType: img.mimeType };
          }
        } catch (err) {
          logger.warn(
            { err, influencerId, fileId: img.id, folder: folder.name },
            "settings compose: drive download threw",
          );
        }
        if (!refInline) continue;
        const variation = VARIATION_HINTS[(attempted - 1 + categoryCycle) % VARIATION_HINTS.length];
        const prompt = `${basePrompt} ${variation}`;
        const url = await geminiComposeWithWardrobeGate(
          prompt,
          [charInline, refInline],
          "infsetting-",
          { influencerId, label: `setting:${folder.name}` },
        );
        if (url) {
          successful.push({ refIndex: successful.length, imageUrl: url });
        } else {
          logger.warn(
            { influencerId, folder: folder.name, fileId: img.id },
            "settings compose: gemini returned no image - retrying with another reference",
          );
        }
      }
      logger.info(
        {
          influencerId,
          folder: folder.name,
          succeeded: successful.length,
          attempted,
          available: shuffled.length,
          max: MAX_ATTEMPTS,
          cycle: categoryCycle,
        },
        "settings compose: category attempts complete",
      );

      // HARD PAD to exactly TARGET. If Gemini failed every attempt this
      // cycle, we fall back to the master portrait. If we got at least one
      // composite, we re-use it to fill remaining slots. The UI must
      // always render TARGET_PER_CATEGORY cells.
      const padSource =
        successful.length > 0 ? successful[successful.length - 1].imageUrl : characterImageUrl;
      while (successful.length < TARGET_PER_CATEGORY) {
        successful.push({ refIndex: successful.length, imageUrl: padSource });
      }

      // Atomic per-category persist with row-count verification. If the
      // post-insert count does not equal TARGET_PER_CATEGORY the txn
      // rolls back and the outer cycle retries.
      try {
        await db.transaction(async (tx) => {
          const [setting] = await tx
            .insert(influencerSettingsTable)
            .values({
              influencerId,
              name: folder.name,
              description: `Identity-locked compositions for ${folder.name}.`,
              sortOrder: sIdx,
            })
            .returning();
          if (!setting) throw new Error("influencer_settings insert returned no row");
          successful.sort((a, b) => a.refIndex - b.refIndex);

          // Insert each setting_images row individually so a single bad
          // value cannot silently truncate the whole batch. Each insert
          // returns the row, which we count to confirm persistence.
          let inserted = 0;
          for (let i = 0; i < successful.length; i += 1) {
            const img = successful[i];
            const rows = await tx
              .insert(settingImagesTable)
              .values({
                settingId: setting.id,
                imageUrl: img.imageUrl,
                label: `${folder.name} ${i + 1}`,
                sortOrder: i,
              })
              .returning({ id: settingImagesTable.id });
            inserted += rows.length;
          }

          // Re-read the row count from the DB to catch any silent loss.
          const verifyRows = await tx
            .select({ id: settingImagesTable.id })
            .from(settingImagesTable)
            .where(eq(settingImagesTable.settingId, setting.id));
          if (verifyRows.length !== TARGET_PER_CATEGORY) {
            throw new Error(
              `setting_images post-insert verification failed: expected ${TARGET_PER_CATEGORY}, got ${verifyRows.length} (per-row inserted=${inserted})`,
            );
          }
        });
      } catch (err) {
        logger.warn(
          { err, influencerId, folder: folder.name, cycle: categoryCycle },
          "settings compose: category persist failed",
        );
      }

      // Final independent read to drive the outer retry decision. We
      // count rows for the freshly-inserted setting (by name) so this
      // is robust against the txn having rolled back.
      const finalRows = await db
        .select({ id: settingImagesTable.id })
        .from(settingImagesTable)
        .innerJoin(
          influencerSettingsTable,
          eq(settingImagesTable.settingId, influencerSettingsTable.id),
        )
        .where(
          and(
            eq(influencerSettingsTable.influencerId, influencerId),
            eq(influencerSettingsTable.name, folder.name),
          ),
        );
      categoryFinalCount = finalRows.length;
      logger.info(
        {
          category: folder.name,
          influencerId,
          generated: categoryFinalCount,
          required: TARGET_PER_CATEGORY,
          cycle: categoryCycle,
          status: categoryFinalCount === TARGET_PER_CATEGORY ? "complete" : "incomplete",
        },
        "[settings-category-check]",
      );
    }

    if (categoryFinalCount !== TARGET_PER_CATEGORY) {
      // Should be impossible: the padding step guarantees TARGET items
      // and the verification txn would have rolled back on mismatch,
      // triggering another cycle. If we somehow exit the cycles loop
      // with the wrong count, log a finalize block so it is visible.
      logger.error(
        {
          reason: "category_incomplete",
          category: folder.name,
          generated: categoryFinalCount,
          required: TARGET_PER_CATEGORY,
          influencerId,
        },
        "[settings-finalize-blocked]",
      );
    } else {
      logger.info(
        { influencerId, folder: folder.name, persisted: categoryFinalCount },
        "settings compose: category persisted",
      );
    }
  }
}

export async function hydrateIdentityWorkspace(
  influencerId: number,
  baseAvatar: string,
  prefs?: AiInfluencerJob["prefs"],
): Promise<void> {
  // Step 1: ensure the influencer row carries the canonical Main Image.
  // Only update when avatar_url is still null so a manual upload by the user
  // is never clobbered by a finalize replay.
  await db
    .update(aiInfluencersTable)
    .set({ avatarUrl: baseAvatar, status: "active" })
    .where(and(eq(aiInfluencersTable.id, influencerId), isNull(aiInfluencersTable.avatarUrl)));
  // Always flip status to active even if avatarUrl was already set.
  await db
    .update(aiInfluencersTable)
    .set({ status: "active" })
    .where(and(eq(aiInfluencersTable.id, influencerId), eq(aiInfluencersTable.status, "building")));

  // Resolve the character profile so identity-lock prompts can include
  // demographic anchors. Falls back to a minimal profile if prefs are
  // missing (e.g. a pre-character-profile-era job).
  const profile = prefs
    ? readOrInferProfile(prefs)
    : readOrInferProfile({ ageRange: "", ethnicity: "", gender: "", vibe: "" });

  // Steps 2 + 3 run concurrently — each is internally bounded.
  // We AWAIT both fully (no fire-and-forget). If either throws we let
  // it propagate so finalize can decide whether to flip status to
  // ready/ready_degraded or keep the job at swapping_scenes for replay.
  const results = await Promise.allSettled([
    composeIdentityAngles(influencerId, baseAvatar, profile),
    composeIdentitySettings(influencerId, baseAvatar, profile),
  ]);
  for (const r of results) {
    if (r.status === "rejected") {
      logger.warn({ err: r.reason, influencerId }, "hydrate workspace: step rejected");
    }
  }

  // FINALIZE GATE: refuse to mark this influencer fully hydrated unless
  // every Drive-driven setting category has EXACTLY TARGET_PER_CATEGORY
  // setting_images rows. Throwing here keeps finalize from flipping
  // status to ready/ready_degraded; the next finalize replay re-enters
  // composeIdentitySettings, which is now per-category-aware and will
  // only repair the missing/partial categories.
  const TARGET_PER_CATEGORY_GATE = 2;
  const parentFolderId =
    process.env.INFLUENCER_SETTINGS_PARENT_FOLDER_ID ||
    process.env.INFLUENCER_SETTINGS_DRIVE_FOLDER_ID;
  if (parentFolderId) {
    const connectors = new ReplitConnectors();
    let expectedFolders: { id: string; name: string }[] = [];
    try {
      expectedFolders = await listDriveSubfolders(connectors, parentFolderId);
    } catch (err) {
      logger.warn({ err, influencerId }, "hydrate workspace: drive subfolder listing failed");
    }
    if (expectedFolders.length > 0) {
      const counts = await db
        .select({
          name: influencerSettingsTable.name,
          c: sql<number>`count(${settingImagesTable.id})::int`,
        })
        .from(influencerSettingsTable)
        .leftJoin(settingImagesTable, eq(settingImagesTable.settingId, influencerSettingsTable.id))
        .where(eq(influencerSettingsTable.influencerId, influencerId))
        .groupBy(influencerSettingsTable.name);
      const countByName = new Map(counts.map((r) => [r.name, r.c]));
      const incomplete = expectedFolders
        .map((f) => ({ name: f.name, c: countByName.get(f.name) ?? 0 }))
        .filter((row) => row.c !== TARGET_PER_CATEGORY_GATE);
      if (incomplete.length > 0) {
        logger.error(
          {
            influencerId,
            expected: expectedFolders.length,
            incomplete: incomplete.map((r) => `${r.name}=${r.c}`),
          },
          "[settings-finalize-blocked] hydrate gate failed: incomplete categories",
        );
        throw new Error(
          `settings hydrate incomplete: ${incomplete.length}/${expectedFolders.length} categories not at TARGET=${TARGET_PER_CATEGORY_GATE}`,
        );
      }
    }
  }
}

async function pickRandomScenes(genderPref: string, n: number): Promise<AiInfluencerScene[]> {
  // Prefer scenes whose gender hint matches; fall back to "any" to fill the
  // batch. Use Postgres ORDER BY random() — the scene table tops out at a
  // few hundred rows so the cost is irrelevant.
  const matched = await db
    .select()
    .from(aiInfluencerScenesTable)
    .where(
      and(
        eq(aiInfluencerScenesTable.enabled, true),
        inArray(aiInfluencerScenesTable.genderHint, [mapGenderToHint(genderPref), "any"]),
      ),
    )
    .orderBy(sql`random()`)
    .limit(n);
  if (matched.length >= n) return matched;
  // Top up with any other enabled scenes if we still came up short.
  const rest = await db
    .select()
    .from(aiInfluencerScenesTable)
    .where(eq(aiInfluencerScenesTable.enabled, true))
    .orderBy(sql`random()`)
    .limit(n - matched.length);
  // Avoid duplicates between matched and rest.
  const seen = new Set(matched.map((m) => m.id));
  return [...matched, ...rest.filter((r) => !seen.has(r.id))].slice(0, n);
}

function mapGenderToHint(g: string): string {
  if (g === "female") return "female";
  if (g === "male") return "male";
  return "any";
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 3 — Provider clients (Higgsfield / Enhancor / Gemini scene swap)
// ─────────────────────────────────────────────────────────────────────────────

function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // REPLIT_DOMAINS is comma-separated; first one is the canonical host.
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}`;
  return "";
}

// Auth header builder lives in `./higgsfield-auth.ts` so manual
// scripts (smoke:influencer-base, etc.) can reuse the same scheme
// without duplicating the dual-key / single-key fallback logic.

// Cinematic refactor: master-portrait prompt now derives from the
// inferred CharacterProfile (lib/influencer-character + prompts).
// Legacy `buildAvatarPrompt(prefs)` removed; callers route through
// `buildMasterIdentityPrompt(profile)` instead. `readOrInferProfile`
// transparently re-infers for legacy rows that predate the
// `prefs.characterProfile` field.

/**
 * Dispatch the base avatar generation. Higgsfield will POST the result image
 * to our /api/portal/influencer-jobs/higgsfield-webhook with the external_ref
 * we send here. Returns the provider job id (for traceability).
 */
export async function dispatchHiggsfield(
  jobId: number,
  prefs: AiInfluencerJob["prefs"],
  opts: { strict?: boolean; qaNotes?: string | null } = {},
): Promise<{ providerJobId: string | null; error?: { code: InfluencerErrorCode; message: string; payload?: unknown } }> {
  const headers = higgsfieldHeaders();
  const base = publicBaseUrl();
  if (!headers) {
    return { providerJobId: null, error: { code: "CONFIG_MISSING", message: "HIGGSFIELD_KEY_ID/SECRET (or HIGGSFIELD_API_KEY) not configured" } };
  }
  if (!base) {
    return { providerJobId: null, error: { code: "CONFIG_MISSING", message: "PUBLIC_URL/REPLIT_DOMAINS missing — Higgsfield webhook would be unreachable" } };
  }
  // Higgsfield's actual text-to-image API uses /v1/text2image/{model}
  // with body { params: {...} } and an optional ?hf_webhook=<url>
  // query parameter (Task #288 - the legacy /v1/text-to-image path
  // returns 404 "Model not found" against current accounts). Soul is
  // the production text-to-image model; nano-banana on this platform
  // is image-edit and requires input_images.
  const webhookUrl = `${base}/api/portal/influencer-jobs/higgsfield-webhook?infjob=${jobId}`;
  // Cinematic refactor: master prompt now derives from the inferred
  // CharacterProfile (lib/influencer-character → prompts). Falls back
  // to fresh inference for legacy rows without `characterProfile`.
  const profile = readOrInferProfile(prefs);
  const prompt = opts.strict
    ? buildMasterIdentityPromptStrict(profile, opts.qaNotes ?? null)
    : buildMasterIdentityPrompt(profile);
  // Higgsfield's body validator treats `webhook.secret` as a required
  // string when the `webhook` object is present (task #388: every new
  // dispatch failed with HTTP 422 `body.webhook.secret: Field required`
  // because we always sent the `webhook` field with an empty-string
  // secret when HIGGSFIELD_WEBHOOK_SECRET was unset). Only attach the
  // `webhook` object when we actually have a secret to send; otherwise
  // rely on the `?hf_webhook=` query parameter alone, which is the
  // path Higgsfield's docs document for unsigned webhooks.
  const webhookSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET;
  const body: Record<string, unknown> = {
    params: {
      prompt,
      width_and_height: "1536x1536",
      quality: "1080p",
      batch_size: 1,
    },
  };
  if (webhookSecret) {
    body.webhook = { url: webhookUrl, secret: webhookSecret };
  }
  try {
    const res = await fetch(
      `${HIGGSFIELD_BASE_URL}/v1/text2image/soul?hf_webhook=${encodeURIComponent(webhookUrl)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const cls = classifyError({ status: res.status, responseText: text });
      logger.error({ jobId, status: res.status, code: cls.code, text: text.slice(0, 300) }, "Higgsfield dispatch failed");
      return { providerJobId: null, error: { ...cls, payload: { status: res.status, body: text.slice(0, 500) } } };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; request_id?: string };
    const providerJobId = json.request_id ?? json.id ?? null;
    if (!providerJobId) {
      return { providerJobId: null, error: { code: "INVALID_RESPONSE", message: "Higgsfield response missing request_id", payload: json } };
    }
    // Task #261 follow-up — record provider cost on every dispatched
    // call (success). Failures are recorded in the catch path so we
    // never miss a billable attempt.
    void recordInfluencerCost({
      jobId,
      provider: "higgsfield",
      costInCents: COST_CENTS_HIGGSFIELD,
      metadata: { providerJobId, ok: true },
    });
    return { providerJobId };
  } catch (err) {
    const cls = classifyError({ err });
    logger.error({ err, jobId, code: cls.code }, "Higgsfield dispatch threw");
    void recordInfluencerCost({
      jobId,
      provider: "higgsfield",
      costInCents: COST_CENTS_HIGGSFIELD,
      metadata: { ok: false, code: cls.code },
    });
    return { providerJobId: null, error: { ...cls, payload: String(err).slice(0, 500) } };
  }
}

/**
 * Gemini base-portrait fallback. Used when Higgsfield is unreachable,
 * misconfigured, or its job-set never produces a usable result and we
 * have exhausted the retry budget. Generates the master portrait
 * synchronously via gemini-3-pro-image-preview, mirrors it into our
 * bucket, and returns the public URL. Intentionally cheap and
 * synchronous so the pipeline can keep advancing without depending on
 * a second async webhook/poll loop.
 */
export async function dispatchGeminiBaseFallback(
  jobId: number,
  prefs: AiInfluencerJob["prefs"],
): Promise<{ url: string | null; error?: { code: InfluencerErrorCode; message: string; payload?: unknown } }> {
  if (!process.env.GEMINI_API_KEY) {
    return { url: null, error: { code: "CONFIG_MISSING", message: "GEMINI_API_KEY not configured for base-portrait fallback" } };
  }
  try {
    const profile = readOrInferProfile(prefs);
    const prompt = buildMasterIdentityPrompt(profile);
    const wrapped = `Generate a single, photorealistic, high-resolution portrait photograph of an AI influencer using the following structured prompt. Output exactly one image.\n\n${prompt}`;
    // Lazy dynamic import mirrors the routes/influencers.ts pattern
    // and matches how the gemini lib is bundled by esbuild.
    const mod = await import("@workspace/integrations-gemini-ai/image" as any);
    const generateProImage = mod.generateProImage as (opts: { prompt: string }) => Promise<{ b64_json: string; mimeType: string }>;
    const out = await generateProImage({ prompt: wrapped });
    const buf = Buffer.from(out.b64_json, "base64");
    const url = await uploadPublicImage(buf, out.mimeType, "infbase-");
    void recordInfluencerCost({
      jobId,
      provider: "gemini-base-fallback" as any,
      costInCents: COST_CENTS_GEMINI_SCENE,
      metadata: { ok: true, fallback: "higgsfield_to_gemini" },
    });
    logger.warn({ jobId, url }, "gemini base-portrait fallback succeeded");
    return { url };
  } catch (err) {
    const cls = classifyError({ err });
    logger.error({ err, jobId, code: cls.code }, "gemini base-portrait fallback threw");
    void recordInfluencerCost({
      jobId,
      provider: "gemini-base-fallback" as any,
      costInCents: COST_CENTS_GEMINI_SCENE,
      metadata: { ok: false, code: cls.code, fallback: "higgsfield_to_gemini" },
    });
    return { url: null, error: { ...cls, payload: String(err).slice(0, 500) } };
  }
}

/**
 * Hand the base portrait off to Enhancor's realistic-skin queue. Returns the
 * Enhancor job id; the result lands on /enhancor-webhook below. Falls back
 * to an inline pass-through (skin enhancement skipped) if the API key is
 * missing so dev environments can still complete the pipeline.
 */
export async function dispatchEnhancor(
  jobId: number,
  baseImageUrl: string,
): Promise<{ providerJobId: string | null; error?: { code: InfluencerErrorCode; message: string; payload?: unknown } }> {
  const apiKey = process.env.ENHANCOR_API_KEY;
  const base = publicBaseUrl();
  if (!apiKey || !base) {
    return { providerJobId: null, error: { code: "CONFIG_MISSING", message: `Enhancor not configured (hasKey=${!!apiKey}, hasBase=${!!base})` } };
  }
  const absBase = baseImageUrl.startsWith("http") ? baseImageUrl : `${base}${baseImageUrl}`;
  try {
    const res = await fetch(`${ENHANCOR_BASE_URL}/api/realistic-skin/v1/queue`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        img_url: absBase,
        webhookUrl: buildEnhancorWebhookUrl(base, jobId),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const cls = classifyError({ status: res.status, responseText: text });
      logger.error({ jobId, status: res.status, code: cls.code, text: text.slice(0, 300) }, "Enhancor dispatch failed");
      return { providerJobId: null, error: { ...cls, payload: { status: res.status, body: text.slice(0, 500) } } };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; jobId?: string; job_id?: string };
    const id = json.id ?? json.jobId ?? json.job_id ?? null;
    if (!id) {
      return { providerJobId: null, error: { code: "INVALID_RESPONSE", message: "Enhancor response missing job id", payload: json } };
    }
    void recordInfluencerCost({
      jobId,
      provider: "enhancor",
      costInCents: COST_CENTS_ENHANCOR,
      metadata: { providerJobId: id, ok: true },
    });
    return { providerJobId: id };
  } catch (err) {
    const cls = classifyError({ err });
    logger.error({ err, jobId, code: cls.code }, "Enhancor dispatch threw");
    void recordInfluencerCost({
      jobId,
      provider: "enhancor",
      costInCents: COST_CENTS_ENHANCOR,
      metadata: { ok: false, code: cls.code },
    });
    return { providerJobId: null, error: { ...cls, payload: String(err).slice(0, 500) } };
  }
}

// Lazy-loaded so the gemini lib's composite build does not block this file.
async function getGenerateProImage() {
  const mod = await import("@workspace/integrations-gemini-ai/image" as any);
  return mod.generateProImage as (opts: {
    prompt: string;
    inputImages?: { data: string; mimeType: string }[];
  }) => Promise<{ b64_json: string; mimeType: string }>;
}

// Task #250: identity-preservation hardened prompt. Every clause below
// is intentional - the previous version (which mentioned "outfit") was
// allowing the model to swap clothing in some scenes. The new prompt
// pins down face/hair/skin/body proportions/eye shape/facial structure,
// explicitly forbids gender + ethnicity drift, and locks the outfit to
// what the source scene already has on (so a beach scene stays a beach
// outfit, an office scene stays an office outfit) without inventing
// new clothing.
// Task #442 - profile-aware legacy scene-swap prompt. The previous
// constant string had no access to the user-pinned brief (apparent age,
// gender, ethnicity, facial hair, hairstyle), so legacy Drive-scene
// swaps could drift on every axis we just locked down in the master
// portrait. This builder front-loads briefIdentityClause so the same
// brief travels with every legacy scene swap. The non-identity guidance
// is identical to the previous string.
function buildLegacySceneSwapPrompt(profile: CharacterProfile): string {
  return [
    "Place the SAME PERSON from the first reference image into the scene from the second reference image.",
    briefIdentityClause(profile),
    "STRICT IDENTITY PRESERVATION (highest priority): keep the exact same face, facial structure, jaw line, cheekbones, nose, lips, eye shape, eye colour, eyebrows, hair colour, hair length, hairstyle, facial hair, skin tone, skin texture, body proportions, height, build, and apparent age as the first reference image. The output MUST be unmistakably the same individual - no gender drift, no ethnicity drift, no age drift, no weight or body-type drift, no facial-feature drift, no facial-hair drift.",
    "OUTFIT: keep the outfit, clothing, accessories, and styling exactly as they appear in the second reference scene image - do NOT invent new clothing, do NOT change the outfit from the source scene.",
    "INTEGRATION: match the lighting direction, colour grade, white balance, depth of field, and perspective of the second image so the person looks naturally photographed inside that scene.",
    "OUTPUT FORMAT: vertical 9:16 aspect ratio, Instagram Reel / TikTok portrait format (1080x1920 or higher). If the source scene image is low resolution, blurry, or noisy, upscale and reconstruct it to a crisp, ultra high-resolution photograph - sharp focus, clean detail in skin, hair, fabric, and background. The final image must look like a professionally shot 4K vertical photograph suitable for posting directly to Instagram Reels. Output exactly ONE image. No text, no watermarks, no letterboxing, no black bars, no borders.",
  ].join(" ");
}

// Minimum decoded image size we accept from a scene swap. Anything
// smaller is almost always a moderation block, an empty PNG, or a
// thumbnail and we re-queue the scene instead of shipping it.
const MIN_SCENE_BYTES = 8 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Task #261 follow-up — provider cost tracking + per-scene Gemini telemetry.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-call provider cost in cents. Env-tunable so ops can adjust as
 *  Higgsfield / Enhancor / Gemini pricing moves. Defaults are
 *  illustrative; real invoicing reconciliation lives elsewhere. */
const COST_CENTS_HIGGSFIELD = Number(process.env.INFLUENCER_COST_HIGGSFIELD_CENTS ?? 5);
const COST_CENTS_ENHANCOR = Number(process.env.INFLUENCER_COST_ENHANCOR_CENTS ?? 2);
const COST_CENTS_GEMINI_SCENE = Number(process.env.INFLUENCER_COST_GEMINI_SCENE_CENTS ?? 1);

/** Cap the per-scene attempt-history ring so a flap loop cannot bloat
 *  the row indefinitely. Most-recent-last; older entries are dropped. */
const SCENE_ATTEMPT_HISTORY_LIMIT = 10;

/** Insert a provider-cost row tagged with the influencer job id under
 *  the existing `provider_cost_events` table. Cost is recorded on
 *  every dispatched call (success or failure) because providers
 *  generally bill on attempt, not on outcome. Best-effort: a write
 *  failure logs and is swallowed so cost telemetry never breaks the
 *  pipeline. */
async function recordInfluencerCost(opts: {
  jobId: number;
  provider: "higgsfield" | "enhancor" | "gemini" | "openai-qa";
  costInCents: number;
  units?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!Number.isFinite(opts.costInCents) || opts.costInCents <= 0) return;
  try {
    await db.insert(providerCostEventsTable).values({
      providerSlug: opts.provider,
      externalRef: `infjob:${opts.jobId}`,
      costInCents: Math.round(opts.costInCents),
      units: opts.units ?? 1,
      metadata: { jobId: opts.jobId, ...(opts.metadata ?? {}) },
    });
  } catch (err) {
    logger.warn(
      { err, jobId: opts.jobId, provider: opts.provider },
      "recordInfluencerCost failed (non-fatal)",
    );
  }
}

/** Cheap dimension sniff. Reads PNG/JPEG headers without pulling a new
 *  npm dependency. Returns nulls for unrecognized formats. */
function sniffImageDimensions(buf: Buffer): { width: number | null; height: number | null } {
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  }
  return { width: null, height: null };
}

/** Append-and-cap helper for the scene attempt history ring. */
function pushAttempt(
  prior: NonNullable<SceneState["attemptHistory"]> | undefined,
  next: NonNullable<SceneState["attemptHistory"]>[number],
): NonNullable<SceneState["attemptHistory"]> {
  const prev = Array.isArray(prior) ? prior : [];
  const merged = [...prev, next];
  return merged.length > SCENE_ATTEMPT_HISTORY_LIMIT
    ? merged.slice(merged.length - SCENE_ATTEMPT_HISTORY_LIMIT)
    : merged;
}

// Per-scene state entry on the job row. Mirrors the schema's
// `scenes` jsonb column.
type SceneState = AiInfluencerJob["scenes"][number];

/**
 * Run the 10 scene swaps via Gemini Nano Banana, with per-scene state
 * tracking on the job row. Each scene is independently retried up to
 * RETRY_CAPS.scene times; the concurrency cap stays at 3.
 *
 * The function is idempotent: it only re-attempts scenes whose state is
 * `pending` or `failed` (with attempts < cap). Already-completed scenes
 * are left alone, which is what makes a worker-restart-mid-fanout safe.
 *
 * Heartbeat is touched after every scene write so the stuck-job sweeper
 * can tell a slow-but-progressing 10-scene fan-out from a wedged job.
 */
async function runSceneSwaps(
  jobId: number,
  characterImageUrl: string,
  opts: { onlyIdx?: number } = {},
): Promise<{ completed: number; failed: number }> {
  const generateProImage = await getGenerateProImage();
  const charInline = await fetchAsBase64(characterImageUrl);

  const job = await loadJob(jobId);
  if (!job) return { completed: 0, failed: 0 };
  const scenes = (job.scenes ?? []) as SceneState[];
  if (scenes.length === 0) return { completed: 0, failed: 0 };

  // Cached character profile for scene-QA + strict-prompt retries.
  const profile = readOrInferProfile(job.prefs);

  // Index the scene catalog rows we need by id so we can fetch the
  // gcsUrl + label in one query. (Legacy path; new code-first scenes
  // have sceneId=null and use a cached prompt + master-only input.)
  const sceneIds = scenes.map((s) => s.sceneId).filter((x): x is number => typeof x === "number");
  const catalog = sceneIds.length
    ? await db
        .select()
        .from(aiInfluencerScenesTable)
        .where(inArray(aiInfluencerScenesTable.id, sceneIds))
    : [];
  const catalogById = new Map(catalog.map((c) => [c.id, c] as const));

  // Pick scenes that still need work. A scene is "pending" or "failed
  // but under the retry cap". Already-`processing` scenes from a
  // previous tick are also re-attempted because we cannot tell whether
  // the previous worker actually crashed mid-call.
  //
  // Task #261 follow-up — when `opts.onlyIdx` is provided (manual
  // partial regeneration), restrict the worklist to that single scene
  // and bypass the backoff window. The caller (regenerateSingleScene)
  // has already reset the scene to pending+attempts=0, so the
  // eligibility predicate still passes; the onlyIdx filter just keeps
  // us from also re-attempting other failed scenes that happen to
  // share this tick.
  const nowMs = Date.now();
  const todo = scenes
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s, i }) =>
        s.state !== "completed" &&
        (s.state !== "failed" || s.attempts < RETRY_CAPS.scene + 1) &&
        (opts.onlyIdx === undefined || i === opts.onlyIdx) &&
        // Honor exponential backoff (skipped for manual regen).
        (opts.onlyIdx !== undefined ||
          !s.nextAttemptAt ||
          Date.parse(s.nextAttemptAt) <= nowMs),
    );

  const CONCURRENCY = 3;
  let cursor = 0;
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (cursor < todo.length) {
      const idx = cursor++;
      const { s: prev, i } = todo[idx];
      // Resolve the scene "source" — either a code-first template
      // (preferred) with a cached cinematic prompt, or a legacy
      // catalog row with a Drive image reference. Exactly one is
      // populated; both missing is terminal.
      const tpl: SceneTemplate | null = prev.templateId
        ? getSceneTemplateById(prev.templateId)
        : null;
      const sceneRow = !tpl && prev.sceneId ? catalogById.get(prev.sceneId) ?? null : null;
      if (!tpl && !sceneRow) {
        // Source vanished (admin disabled the scene mid-flight, or the
        // seed picked a stale id, or templateId no longer exists in
        // the code library). Terminal for *this* scene — bump attempts
        // past the eligibility predicate so the finalize gate fails
        // the job with PARTIAL_BATCH_FAILURE instead of granting a
        // wasted extra retry.
        await writeSceneState(jobId, i, {
          ...prev,
          state: "failed",
          attempts: Math.max(prev.attempts + 1, RETRY_CAPS.scene + 1),
          lastErrorCode: "INVALID_RESPONSE",
          lastErrorAt: new Date().toISOString(),
          nextAttemptAt: null,
        });
        failed++;
        continue;
      }
      // Telemetry — measure dispatch / completion timestamps and queue
      // wait (delta from the prior attempt's completion). All optional
      // on the SceneState shape so legacy rows keep working.
      const dispatchedAtIso = new Date().toISOString();
      const dispatchedAtMs = Date.now();
      const queueWaitMs =
        prev.lastCompletedAt !== undefined && prev.lastCompletedAt !== null
          ? Math.max(0, dispatchedAtMs - Date.parse(prev.lastCompletedAt))
          : null;
      const newAttempts = prev.attempts + 1;

      // Mark processing so an admin diagnostics read sees activity, and
      // bump attempts up front so a crash after this point still counts.
      // Clear nextAttemptAt because we are doing the attempt now.
      await writeSceneState(jobId, i, {
        ...prev,
        state: "processing",
        attempts: newAttempts,
        nextAttemptAt: null,
        lastDispatchAt: dispatchedAtIso,
      });
      try {
        // Build inputs based on scene source type. Code-first templates
        // pass only the master portrait + a cached cinematic prompt;
        // legacy catalog rows pass [character, scene] like before.
        const scenePrompt = tpl
          ? prev.prompt ?? buildScenePlacementPrompt(profile, tpl)
          : buildLegacySceneSwapPrompt(profile);
        const inputImages = tpl
          ? [charInline]
          : [charInline, await fetchAsBase64(sceneRow!.gcsUrl)];
        // Slice C: scene-swap routes through ProviderManager. Adapter
        // returns NormalizedResult; we re-throw on error so the existing
        // catch-block (RETRY_CAPS.scene, backoff, persistError) keeps
        // owning recovery semantics.
        logger.info(
          {
            pipeline: "influencer",
            stage: "scene_swap",
            phase: "dispatch",
            jobId,
            sceneIdx: i,
            templateId: prev.templateId ?? null,
            sceneId: prev.sceneId ?? null,
            attemptNumber: newAttempts,
            promptLen: scenePrompt.length,
            inputImageCount: inputImages.length,
          },
          "scene-swap dispatch → gemini",
        );
        const sceneSubmit = await getProvider("gemini").submit({
          prompt: scenePrompt,
          inputImages,
        });
        if (sceneSubmit.error || !sceneSubmit.raw) {
          const e: Error & {
            __code?: InfluencerErrorCode;
            __terminal?: boolean;
            candidateCount?: number | null;
            finishReason?: string | null;
            blockReason?: string | null;
            partKinds?: string[] | null;
            textSnippet?: string | null;
            safetyRatings?: unknown;
            promptFeedback?: unknown;
          } = new Error(
            sceneSubmit.error?.message ?? "gemini submit returned no payload",
          );
          if (sceneSubmit.error) {
            e.__code = sceneSubmit.error.code;
            // Task #690: surface the adapter's terminal verdict so the
            // catch block below can stop burning retries on policy
            // blocks (SAFETY_BLOCK / RECITATION_BLOCK) that will keep
            // refusing for the same input.
            e.__terminal = sceneSubmit.error.terminal === true;
          }
          // Task #674/#690: surface the structured gemini no-image
          // diagnostics that adapter.buildError stashed on
          // NormalizedError.payload so runSceneSwaps' catch block can
          // log finishReason/blockReason/partKinds/textSnippet AND
          // safetyRatings/promptFeedback from the actual provider
          // response instead of guessing.
          const p = sceneSubmit.error?.payload as
            | {
                candidateCount?: number | null;
                finishReason?: string | null;
                blockReason?: string | null;
                partKinds?: string[] | null;
                textSnippet?: string | null;
                safetyRatings?: unknown;
                promptFeedback?: unknown;
              }
            | undefined;
          if (p) {
            e.candidateCount = p.candidateCount ?? null;
            e.finishReason = p.finishReason ?? null;
            e.blockReason = p.blockReason ?? null;
            e.partKinds = p.partKinds ?? null;
            e.textSnippet = p.textSnippet ?? null;
            e.safetyRatings = p.safetyRatings ?? null;
            e.promptFeedback = p.promptFeedback ?? null;
          }
          throw e;
        }
        let result = sceneSubmit.raw as { b64_json: string; mimeType: string };
        let buf = Buffer.from(result.b64_json, "base64");
        const completedAtMs = Date.now();
        const completedAtIso = new Date(completedAtMs).toISOString();
        const geminiMs = completedAtMs - dispatchedAtMs;
        logger.info(
          {
            pipeline: "influencer",
            stage: "scene_swap",
            phase: "response",
            jobId,
            sceneIdx: i,
            templateId: prev.templateId ?? null,
            attemptNumber: newAttempts,
            geminiMs,
            outputBytes: buf?.length ?? 0,
            mimeType: result?.mimeType ?? null,
            candidateCount: 1,
            providerStatus: "ok",
            decision: "accepted",
            ok: true,
          },
          "scene-swap gemini response accepted",
        );
        // Sanity check: empty / under-sized output is treated as a
        // moderation block or empty payload, not a success. Caller will
        // re-queue this scene on the next tick if attempts remain.
        if (!buf || buf.length < MIN_SCENE_BYTES) {
          throw Object.assign(new Error("scene output too small or empty"), {
            __code: "EMPTY_OUTPUT" as InfluencerErrorCode,
            __geminiMs: geminiMs,
            __outputBytes: buf?.length ?? 0,
          });
        }
        let dims = sniffImageDimensions(buf);
        let url = await uploadPublicImage(buf, result.mimeType, "infscene-");
        void recordInfluencerCost({
          jobId,
          provider: "gemini",
          costInCents: COST_CENTS_GEMINI_SCENE,
          metadata: {
            sceneIdx: i,
            sceneId: prev.sceneId,
            templateId: prev.templateId ?? null,
            attemptNumber: newAttempts,
            geminiMs,
            outputBytes: buf.length,
            ok: true,
          },
        });

        // ── Scene placement QA gate (T006) ─────────────────────────
        // GPT-4o vision compares the generated scene to the master
        // portrait. On a "reject" verdict we get exactly one inline
        // retry with a tightened identity-preservation prompt
        // (templated scenes only — legacy Drive scenes don't carry
        // the strict variant). If the retry still rejects, ship the
        // best output and tag qaWarning=true so the finalize gate
        // doesn't mark the whole job failed for a single weak frame.
        let qa: SceneQA | null = null;
        let qaWarning = false;
        if (tpl) {
          qa = await scoreScenePlacement(url, characterImageUrl, profile, tpl);
          void recordInfluencerCost({
            jobId,
            provider: "openai-qa",
            costInCents: COST_CENTS_QA,
            metadata: {
              stage: "scene_placement",
              sceneIdx: i,
              templateId: prev.templateId,
              verdict: qa.verdict,
              overall: qa.overall,
            },
          });
          if (qa.verdict === "reject") {
            try {
              const strictPrompt = buildScenePlacementPromptStrict(profile, tpl, qa.notes);
              // Slice C: QA strict retry also routes through ProviderManager.
              const retrySubmit = await getProvider("gemini").submit({
                prompt: strictPrompt,
                inputImages: [charInline],
              });
              if (retrySubmit.error || !retrySubmit.raw) {
                throw new Error(
                  retrySubmit.error?.message ?? "gemini QA-retry submit returned no payload",
                );
              }
              const retryResult = retrySubmit.raw as {
                b64_json: string;
                mimeType: string;
              };
              const retryBuf = Buffer.from(retryResult.b64_json, "base64");
              if (retryBuf && retryBuf.length >= MIN_SCENE_BYTES) {
                const retryUrl = await uploadPublicImage(retryBuf, retryResult.mimeType, "infscene-");
                const retryQa = await scoreScenePlacement(retryUrl, characterImageUrl, profile, tpl);
                void recordInfluencerCost({
                  jobId,
                  provider: "gemini",
                  costInCents: COST_CENTS_GEMINI_SCENE,
                  metadata: { sceneIdx: i, templateId: prev.templateId, qaRetry: true, ok: true },
                });
                void recordInfluencerCost({
                  jobId,
                  provider: "openai-qa",
                  costInCents: COST_CENTS_QA,
                  metadata: { stage: "scene_placement_retry", sceneIdx: i, verdict: retryQa.verdict, overall: retryQa.overall },
                });
                // Keep the retry only if its overall score actually
                // improved; otherwise stick with the first attempt.
                if (retryQa.overall > qa.overall) {
                  result = retryResult;
                  buf = retryBuf;
                  dims = sniffImageDimensions(retryBuf);
                  url = retryUrl;
                  qa = { ...retryQa, retried: true };
                } else {
                  qa = { ...qa, retried: true };
                }
              }
            } catch (retryErr) {
              logger.warn({ retryErr, jobId, sceneIdx: i }, "scene QA strict retry failed (non-fatal)");
              qa = { ...qa, retried: true };
            }
            if (qa && qa.verdict !== "pass") qaWarning = true;
          }
          if (qaWarning) {
            logger.warn(
              {
                pipeline: "influencer",
                stage: "scene_swap",
                phase: "qa",
                jobId,
                sceneIdx: i,
                templateId: prev.templateId ?? null,
                attemptNumber: newAttempts,
                code: "SCENE_SWAP_QA_REJECTED" satisfies InfluencerErrorCode,
                qaOverall: qa?.overall ?? null,
                shipped: true,
              },
              "scene-swap shipped with QA warning (qaWarning=true)",
            );
          }
        }

        await writeSceneState(jobId, i, {
          ...prev,
          state: "completed",
          attempts: newAttempts,
          imageUrl: url,
          lastErrorCode: null,
          lastErrorAt: null,
          nextAttemptAt: null,
          lastDispatchAt: dispatchedAtIso,
          lastCompletedAt: completedAtIso,
          lastGeminiMs: geminiMs,
          lastQueueWaitMs: queueWaitMs,
          lastOutputBytes: buf.length,
          lastOutputWidth: dims.width,
          lastOutputHeight: dims.height,
          lastRetryReason: null,
          qa: qa ?? null,
          qaWarning,
          // Task #674: persist QA-reject classification on the scene
          // row so /api/portal/influencer-jobs/:id triage can tell
          // "shipped with QA warning" apart from a clean pass without
          // re-running the QA verifier.
          ...(qaWarning
            ? {
                lastErrorCode:
                  "SCENE_SWAP_QA_REJECTED" satisfies InfluencerErrorCode,
                lastErrorAt: completedAtIso,
              }
            : {}),
          attemptHistory: pushAttempt(prev.attemptHistory, {
            attemptNumber: newAttempts,
            dispatchedAt: dispatchedAtIso,
            completedAt: completedAtIso,
            geminiMs,
            queueWaitMs,
            outputBytes: buf.length,
            outputWidth: dims.width,
            outputHeight: dims.height,
            retryReason: null,
            ok: true,
          }),
        });
        completed++;
        await touchHeartbeat(jobId);
      } catch (err: unknown) {
        const e = err as {
          __code?: string;
          __terminal?: boolean;
          __geminiMs?: number;
          __outputBytes?: number;
          message?: string;
          // Task #674/#690: structured fields stamped by the upgraded
          // generateProImage when Gemini returns no inlineData part.
          candidateCount?: number;
          finishReason?: string | null;
          blockReason?: string | null;
          partKinds?: string[];
          textSnippet?: string | null;
          safetyRatings?: unknown;
          promptFeedback?: unknown;
        } | null;
        const cls =
          // Task #674/#690: honor the adapter-classified code first
          // for every differentiated failure mode. buildError() in
          // providers/gemini/adapter.ts already classified the upstream
          // throw and attached the canonical code to e.__code. If we
          // re-run classifyError here we'd lose that signal whenever
          // the rethrown Error's message no longer matches the
          // original regex (e.g. "no payload" wrappers).
          e?.__code === "EMPTY_OUTPUT"
            ? { code: "EMPTY_OUTPUT" as InfluencerErrorCode, message: String(e.message ?? "empty") }
            : e?.__code === "INVALID_RESPONSE"
              ? { code: "INVALID_RESPONSE" as InfluencerErrorCode, message: String(e.message ?? "invalid response") }
              : e?.__code === "PROVIDER_TIMEOUT"
                ? { code: "PROVIDER_TIMEOUT" as InfluencerErrorCode, message: String(e.message ?? "provider timeout") }
                : e?.__code === "SAFETY_BLOCK"
                  ? { code: "SAFETY_BLOCK" as InfluencerErrorCode, message: String(e.message ?? "safety block") }
                  : e?.__code === "RECITATION_BLOCK"
                    ? { code: "RECITATION_BLOCK" as InfluencerErrorCode, message: String(e.message ?? "recitation block") }
                    : e?.__code === "NO_IMAGE_IN_RESPONSE"
                      ? { code: "NO_IMAGE_IN_RESPONSE" as InfluencerErrorCode, message: String(e.message ?? "no image in response") }
                      : classifyError({ err });
        // Task #674/#690: differentiate scene-swap failure modes so
        // the taxonomy is actionable. Terminal policy blocks
        // (SAFETY_BLOCK / RECITATION_BLOCK) and text-only refusals
        // (NO_IMAGE_IN_RESPONSE) come pre-classified from the adapter
        // (Task #690 — generateProImage now stamps a structured `kind`
        // discriminator); we just route them to their SCENE_SWAP_*
        // siblings here. Anything classifyError can't peg falls
        // through to the legacy EMPTY/FAILURE buckets.
        const rawMsg = String(e?.message ?? cls.message ?? "");
        const looksEmpty =
          cls.code === "EMPTY_OUTPUT" ||
          /no image data in response|empty provider output|no payload/i.test(rawMsg);
        const code: InfluencerErrorCode =
          cls.code === "SAFETY_BLOCK"
            ? "SCENE_SWAP_SAFETY_BLOCK"
            : cls.code === "RECITATION_BLOCK"
              ? "SCENE_SWAP_RECITATION_BLOCK"
              : cls.code === "NO_IMAGE_IN_RESPONSE"
                ? "SCENE_SWAP_NO_IMAGE_IN_RESPONSE"
                : looksEmpty
                  ? "SCENE_SWAP_EMPTY_RESPONSE"
                  : cls.code === "PROVIDER_TIMEOUT"
                    ? "SCENE_SWAP_TIMEOUT"
                    : cls.code === "INVALID_RESPONSE"
                      ? "SCENE_SWAP_INVALID_RESPONSE"
                      : cls.code === "UNKNOWN"
                        ? "SCENE_SWAP_FAILURE"
                        : cls.code;
        // Task #690: terminal classification short-circuits retries.
        // SAFETY_BLOCK / RECITATION_BLOCK are policy decisions — the
        // model will keep refusing identical input. The adapter sets
        // `terminal=true` via failureRetryability(MODERATION_BLOCK),
        // we honor it here so the worker stops burning the retry
        // budget. PARTIAL_BATCH_FAILURE finalize gate will then route
        // the whole job to scene_swap_no_output cleanly.
        //
        // NO_IMAGE_IN_RESPONSE policy: Gemini returned a candidate
        // without inlineData and without a terminal SAFETY/RECITATION
        // signal. This is a "soft refusal" — the model probably balked
        // at some phrasing in the prompt. We retry exactly once with a
        // softened prompt variant (buildScenePlacementPromptSoftened,
        // which strips the long negative tails and realism guardrail),
        // then mark terminal if it happens again. We detect recurrence
        // by checking whether the scene's lastErrorCode was already
        // SCENE_SWAP_NO_IMAGE_IN_RESPONSE before this attempt.
        const isRecurringNoImage =
          code === "SCENE_SWAP_NO_IMAGE_IN_RESPONSE" &&
          prev.lastErrorCode === "SCENE_SWAP_NO_IMAGE_IN_RESPONSE";
        const isFirstNoImage =
          code === "SCENE_SWAP_NO_IMAGE_IN_RESPONSE" && !isRecurringNoImage;
        const isTerminal =
          e?.__terminal === true ||
          code === "SCENE_SWAP_SAFETY_BLOCK" ||
          code === "SCENE_SWAP_RECITATION_BLOCK" ||
          isRecurringNoImage;
        const willRetry = !isTerminal && newAttempts < RETRY_CAPS.scene + 1;
        // On a first NO_IMAGE failure for a templated scene, swap the
        // cached prompt to the softened variant so the next attempt
        // (worker tick reads `prev.prompt ?? buildScenePlacementPrompt`)
        // uses it. No-op for legacy Drive-sourced scenes (no `tpl`).
        const nextPrompt =
          isFirstNoImage && tpl && willRetry
            ? buildScenePlacementPromptSoftened(profile, tpl)
            : prev.prompt;
        // Exponential backoff: 30s, 60s, 120s, … capped at 10 minutes.
        // Stored on the scene so the worker tick can decide when this
        // scene is re-eligible. Cleared on success / on the next attempt.
        const backoffMs = Math.min(30_000 * 2 ** (newAttempts - 1), 600_000);
        const nextAttemptAt = willRetry
          ? new Date(Date.now() + backoffMs).toISOString()
          : null;
        const completedAtMs = Date.now();
        const completedAtIso = new Date(completedAtMs).toISOString();
        const geminiMs =
          typeof e?.__geminiMs === "number" ? e.__geminiMs : completedAtMs - dispatchedAtMs;
        const outputBytes = typeof e?.__outputBytes === "number" ? e.__outputBytes : null;
        await writeSceneState(jobId, i, {
          ...prev,
          // Task #690: on a first NO_IMAGE retry for a templated scene,
          // swap the cached prompt to the softened variant so the next
          // worker tick uses it (worker reads `prev.prompt ??
          // buildScenePlacementPrompt` at the top of the attempt).
          prompt: nextPrompt,
          state: willRetry ? "pending" : "failed",
          attempts: newAttempts,
          lastErrorCode: code,
          lastErrorAt: completedAtIso,
          nextAttemptAt,
          lastDispatchAt: dispatchedAtIso,
          lastCompletedAt: completedAtIso,
          lastGeminiMs: geminiMs,
          lastQueueWaitMs: queueWaitMs,
          lastOutputBytes: outputBytes,
          lastRetryReason: code,
          attemptHistory: pushAttempt(prev.attemptHistory, {
            attemptNumber: newAttempts,
            dispatchedAt: dispatchedAtIso,
            completedAt: completedAtIso,
            geminiMs,
            queueWaitMs,
            outputBytes,
            outputWidth: null,
            outputHeight: null,
            retryReason: code,
            ok: false,
          }),
        });
        void recordInfluencerCost({
          jobId,
          provider: "gemini",
          costInCents: COST_CENTS_GEMINI_SCENE,
          metadata: {
            sceneIdx: i,
            sceneId: prev.sceneId,
            attemptNumber: newAttempts,
            geminiMs,
            ok: false,
            code,
          },
        });
        if (!willRetry) failed++;
        // Task #674: mirror the SCENE_SWAP_* taxonomy to the job
        // row's last_error_code so admin tooling / the cleanup script
        // / the portal `GET /influencer-jobs/:id` summary all see the
        // most recent swap failure mode without having to scan
        // scene_states. The status stays whatever finalize transitions
        // it to (failed at cap, otherwise unchanged).
        await persistError(
          jobId,
          { code, message: cls.message },
          {
            stage: "scene_swap",
            sceneIdx: i,
            sceneId: prev.sceneId ?? null,
            attemptNumber: newAttempts,
            providerErrorCode: cls.code,
            candidateCount: e?.candidateCount ?? null,
            finishReason: e?.finishReason ?? null,
            blockReason: e?.blockReason ?? null,
            partKinds: e?.partKinds ?? null,
            textSnippet: e?.textSnippet ?? null,
            // Task #690: full Gemini diagnostic surface so the
            // operator can tell which HARM_CATEGORY tripped the block
            // (or that promptFeedback was empty, which itself rules
            // out a prompt-level block) without reading server logs.
            safetyRatings: e?.safetyRatings ?? null,
            promptFeedback: e?.promptFeedback ?? null,
            softenedPromptApplied: isFirstNoImage && tpl && willRetry,
            terminalAfterRetry: isRecurringNoImage,
          },
        );
        logger.warn(
          {
            pipeline: "influencer",
            stage: "scene_swap",
            phase: "response",
            jobId,
            sceneIdx: i,
            sceneId: prev.sceneId,
            templateId: prev.templateId ?? null,
            attemptNumber: newAttempts,
            code,
            providerErrorCode: cls.code,
            message: cls.message,
            // Provider response forensics from generateProImage when
            // candidate had no inlineData (Task #674).
            candidateCount: e?.candidateCount ?? null,
            finishReason: e?.finishReason ?? null,
            blockReason: e?.blockReason ?? null,
            partKinds: e?.partKinds ?? null,
            textSnippet: e?.textSnippet ?? null,
            safetyRatings: e?.safetyRatings ?? null,
            promptFeedback: e?.promptFeedback ?? null,
            softenedPromptApplied: isFirstNoImage && tpl && willRetry,
            terminalAfterRetry: isRecurringNoImage,
            geminiMs,
            outputBytes,
            decision: willRetry ? "retry" : "rejected",
            willRetry,
          },
          "scene-swap gemini response rejected",
        );
        await touchHeartbeat(jobId);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()));

  // Mirror the completed scenes back into the legacy sceneImageUrls
  // array so the existing UI / serializer keeps working without any
  // frontend churn.
  const fresh = await loadJob(jobId);
  const completedNow = ((fresh?.scenes ?? []) as SceneState[])
    .filter((s) => s.state === "completed" && s.imageUrl)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => ({ url: s.imageUrl as string, label: s.label }));
  await db
    .update(aiInfluencerJobsTable)
    .set({ sceneImageUrls: completedNow, heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));

  return { completed, failed };
}

// Replace a single entry in the per-job scenes array atomically. Uses
// jsonb_set so concurrent writes to other indices do not clobber each
// other within the same row update.
async function writeSceneState(jobId: number, idx: number, next: SceneState): Promise<void> {
  await db
    .update(aiInfluencerJobsTable)
    .set({
      scenes: sql`jsonb_set(coalesce(${aiInfluencerJobsTable.scenes}, '[]'::jsonb), ${"{" + idx + "}"}, ${JSON.stringify(next)}::jsonb, true)`,
    })
    .where(eq(aiInfluencerJobsTable.id, jobId));
}

// ─────────────────────────────────────────────────────────────────────────────
// State machine — called by the worker tick + by webhooks
// ─────────────────────────────────────────────────────────────────────────────

async function loadJob(jobId: number): Promise<AiInfluencerJob | null> {
  const [row] = await db.select().from(aiInfluencerJobsTable).where(eq(aiInfluencerJobsTable.id, jobId)).limit(1);
  return row ?? null;
}

/**
 * Task #261 follow-up — partial scene regeneration.
 *
 * Reset a single scene back to `pending` (clearing attempts, error
 * fields, and backoff window) and immediately re-run *only* that
 * scene through Gemini using the existing enhanced (or base) avatar
 * image. Other scenes' state is left untouched.
 *
 * Pre-conditions:
 *   - Job must exist.
 *   - Character image (enhancedImageUrl, falling back to baseImageUrl)
 *     must already be available — i.e. Higgsfield + Enhancor have
 *     already run at least once. Without it, there is nothing to
 *     swap into the scene.
 *   - Scene index must exist on the job.
 *
 * Returns the updated scene state on success so the caller can
 * surface immediate feedback to the operator. If the regeneration
 * is still in flight by the time we return (Gemini call completed
 * but writeback in progress) the caller can poll the job row.
 */
export async function regenerateSingleScene(
  jobId: number,
  sceneIdx: number,
): Promise<
  | { ok: true; scene: SceneState }
  | { ok: false; reason: "job_not_found" | "no_character_image" | "scene_not_found" }
> {
  const job = await loadJob(jobId);
  if (!job) return { ok: false, reason: "job_not_found" };
  const characterUrl = job.enhancedImageUrl ?? job.baseImageUrl;
  if (!characterUrl) return { ok: false, reason: "no_character_image" };
  const scenes = (job.scenes ?? []) as SceneState[];
  const scene = scenes.find((s) => s.idx === sceneIdx);
  if (!scene) return { ok: false, reason: "scene_not_found" };

  // Reset just this one scene. We deliberately do NOT touch
  // sceneImageUrls here — runSceneSwaps mirrors the completed scenes
  // back into that array at the end of its run, so the legacy view
  // stays consistent.
  const reset: SceneState = {
    ...scene,
    state: "pending",
    attempts: 0,
    imageUrl: null,
    lastErrorCode: null,
    lastErrorAt: null,
    nextAttemptAt: null,
    lastRetryReason: "manual_regenerate",
  };
  await writeSceneState(jobId, sceneIdx, reset);

  // Drive immediately so the caller (admin endpoint) does not wait
  // for the next worker tick. onlyIdx scopes the worklist to just
  // this scene so other failed scenes are not also re-attempted as
  // a side-effect.
  await runSceneSwaps(jobId, characterUrl, { onlyIdx: sceneIdx });

  const after = await loadJob(jobId);
  const updated = ((after?.scenes ?? []) as SceneState[]).find((s) => s.idx === sceneIdx);
  return { ok: true, scene: updated ?? reset };
}

/** Task #261 follow-up — sum recorded provider cost events for a job. */
export async function getJobCostBreakdown(jobId: number): Promise<{
  jobId: number;
  totalCents: number;
  byProvider: Record<string, { costCents: number; calls: number }>;
}> {
  const rows = await db
    .select({
      providerSlug: providerCostEventsTable.providerSlug,
      costInCents: providerCostEventsTable.costInCents,
    })
    .from(providerCostEventsTable)
    .where(eq(providerCostEventsTable.externalRef, `infjob:${jobId}`));
  const byProvider: Record<string, { costCents: number; calls: number }> = {};
  let totalCents = 0;
  for (const r of rows) {
    const slug = r.providerSlug;
    const c = Number(r.costInCents) || 0;
    if (!byProvider[slug]) byProvider[slug] = { costCents: 0, calls: 0 };
    byProvider[slug].costCents += c;
    byProvider[slug].calls += 1;
    totalCents += c;
  }
  return { jobId, totalCents, byProvider };
}

/** Global concurrency cap on simultaneous in-flight influencer jobs.
 *  Per task spec (Task #261): no more than 3 jobs may sit in any of
 *  the active pipeline stages (generating_base / enhancing /
 *  swapping_scenes) at once, separate from the per-scene fan-out cap
 *  which already lives in `runSceneSwaps()`. Env-tunable for ops. */
export const INFLUENCER_GLOBAL_CONCURRENCY = Math.max(
  1,
  Number(process.env.INFLUENCER_MAX_INFLIGHT ?? 3),
);

/** Worker tick: dispatch Higgsfield for newly queued jobs. */
export async function advanceQueuedJobs(): Promise<void> {
  // Task #261: enforce a global hard cap of
  // INFLUENCER_GLOBAL_CONCURRENCY simultaneous in-flight jobs across
  // ALL worker processes/ticks. The cap is enforced inside a single
  // SQL transaction guarded by a Postgres transaction-scoped advisory
  // lock so two concurrent claimers serialize on the lock and the
  // second one re-reads the inflight count after the first commits —
  // making oversubscription impossible. SKIP LOCKED on the inner row
  // SELECT prevents claiming rows another transaction is mid-update.
  const ADVISORY_KEY = 0x494e464c; // "INFL"
  const claimedRows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_KEY})`);
    const inflightRows = await tx.execute(sql`
      SELECT count(*)::int AS inflight
      FROM ai_influencer_jobs
      WHERE status IN ('generating_base','enhancing','swapping_scenes')
    `);
    const inflightArr = (inflightRows as unknown as {
      rows?: Array<{ inflight: number }>;
    }).rows ?? (inflightRows as unknown as Array<{ inflight: number }>);
    const inflight = Number(inflightArr?.[0]?.inflight ?? 0);
    const slots = Math.max(0, INFLUENCER_GLOBAL_CONCURRENCY - inflight);
    if (slots === 0) return [] as AiInfluencerJob[];
    const now = new Date();
    const updated = await tx.execute(sql`
      UPDATE ai_influencer_jobs
      SET status = 'generating_base',
          progress = 15,
          stage_started_at = ${now},
          heartbeat_at = ${now},
          next_attempt_at = NULL
      WHERE id IN (
        SELECT id FROM ai_influencer_jobs
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY id ASC
        LIMIT ${slots}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return (
      (updated as unknown as { rows?: AiInfluencerJob[] }).rows ??
      (updated as unknown as AiInfluencerJob[])
    );
  });
  for (const job of claimedRows) {
    try {
      // Slice C: route through ProviderManager so the orchestration
      // layer is provider-agnostic. Adapter delegates to dispatchHiggsfield
      // internally so behavior is identical.
      const submitRes = await getProvider("higgsfield").submit({
        jobId: job.id,
        prefs: job.prefs,
      });
      const providerJobId = submitRes.providerJobId;
      const error = submitRes.error
        ? {
            code: submitRes.error.code,
            message: submitRes.error.message,
            payload: submitRes.error.payload,
          }
        : undefined;
      if (providerJobId) {
        await db
          .update(aiInfluencerJobsTable)
          .set({ higgsfieldJobId: providerJobId, progress: 25, heartbeatAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, job.id));
        logStageTransition({
          jobId: job.id,
          clientId: job.clientId,
          fromStage: "queued",
          toStage: "generating_base",
          provider: "higgsfield",
          providerJobId,
          ...computeElapsed({ ...job, stageStartedAt: new Date() }),
        });
      } else {
        // Bounded retry: bump the higgsfield retry counter; if we have
        // exhausted attempts, fail the job so the user is unblocked
        // instead of looping forever.
        const attempts = await bumpRetry(job.id, "higgsfield", { withBackoff: true });
        await persistError(job.id, error ?? { code: "UNKNOWN", message: "dispatch returned no id" }, error?.payload);
        if (attempts >= RETRY_CAPS.higgsfield) {
          // Higgsfield retry budget exhausted - try Gemini base
          // portrait as a final fallback before failing the job.
          const fb = await dispatchGeminiBaseFallback(job.id, job.prefs);
          recordRecoveryEvent({
            jobId: job.id,
            recoveryKind: "gemini_base_fallback",
            fromProvider: "higgsfield",
            toProvider: "gemini",
            stage: "base_fallback",
            reason: `higgsfield dispatch retry cap (${attempts}) exhausted`,
            success: !!fb.url,
            metadata: { trigger: "advanceQueuedJobs.dispatch.no_id" },
          });
          if (fb.url) {
            await onHiggsfieldResult(job.id, fb.url);
            continue;
          }
          await failJob(
            job.id,
            error?.code ?? "UNKNOWN",
            `Higgsfield dispatch failed after ${attempts} attempts and Gemini fallback also failed: ${fb.error?.message ?? error?.message ?? "unknown"}`,
            error?.payload,
          );
          logStageTransition({
            jobId: job.id,
            clientId: job.clientId,
            fromStage: "generating_base",
            toStage: "failed",
            provider: "higgsfield",
            retryCount: attempts,
            errorCode: error?.code ?? "UNKNOWN",
            errorMessage: error?.message ?? "dispatch failed",
          });
        } else {
          await db
            .update(aiInfluencerJobsTable)
            .set({ status: "queued", progress: 0, heartbeatAt: new Date() })
            .where(eq(aiInfluencerJobsTable.id, job.id));
          logStageTransition({
            jobId: job.id,
            clientId: job.clientId,
            fromStage: "generating_base",
            toStage: "queued",
            provider: "higgsfield",
            retryCount: attempts,
            errorCode: error?.code ?? "UNKNOWN",
            errorMessage: error?.message ?? "dispatch failed (will retry)",
          });
        }
      }
    } catch (err) {
      const cls = classifyError({ err });
      const attempts = await bumpRetry(job.id, "higgsfield", { withBackoff: true });
      await persistError(job.id, cls, String(err).slice(0, 500));
      logger.error({ err, jobId: job.id, code: cls.code, attempts }, "advanceQueuedJobs: dispatch threw");
      if (attempts >= RETRY_CAPS.higgsfield) {
        const fb = await dispatchGeminiBaseFallback(job.id, job.prefs);
        recordRecoveryEvent({
          jobId: job.id,
          recoveryKind: "gemini_base_fallback",
          fromProvider: "higgsfield",
          toProvider: "gemini",
          stage: "base_fallback",
          reason: `higgsfield dispatch threw; cap reached (${attempts})`,
          success: !!fb.url,
          metadata: { trigger: "advanceQueuedJobs.dispatch.threw" },
        });
        if (fb.url) {
          await onHiggsfieldResult(job.id, fb.url);
          continue;
        }
        await failJob(job.id, cls.code, `Higgsfield threw and Gemini fallback failed: ${fb.error?.message ?? cls.message}`, String(err).slice(0, 500));
      } else {
        await db
          .update(aiInfluencerJobsTable)
          .set({ status: "queued", progress: 0, heartbeatAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, job.id));
      }
    }
  }
}

/**
 * Worker tick: poll Higgsfield for any job stuck in `generating_base`
 * past POLL_HIGGSFIELD_AFTER_MS. Higgsfield's outbound webhooks have
 * proven unreliable on this platform (callbacks never arrive even
 * though the job-set completes within ~30-60s), so we self-poll
 * `GET /v1/job-sets/{id}` and feed the result through the same
 * `onHiggsfieldResult` path the webhook would use. Idempotent: the
 * stage-gate inside `onHiggsfieldResult` ignores the second arrival
 * if the webhook does eventually fire.
 */
const POLL_HIGGSFIELD_AFTER_MS = Number(
  process.env.INFLUENCER_HIGGSFIELD_POLL_AFTER_MS ?? 45_000,
);
// If a Higgsfield job stays in `generating_base` for this long without
// returning a usable image (provider polling shows non-completed or
// completed-but-no-url), fall back to Gemini so the user is not stuck.
const HIGGSFIELD_FALLBACK_AFTER_MS = Number(
  process.env.INFLUENCER_HIGGSFIELD_FALLBACK_AFTER_MS ?? 5 * 60_000,
);
export async function pollHiggsfieldStuckJobs(): Promise<void> {
  const headers = higgsfieldHeaders();
  if (!headers) return;
  const cutoff = new Date(Date.now() - POLL_HIGGSFIELD_AFTER_MS);
  const stuck = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "generating_base"),
        isNotNull(aiInfluencerJobsTable.higgsfieldJobId),
        lte(aiInfluencerJobsTable.stageStartedAt, cutoff),
      ),
    )
    .limit(10);
  for (const job of stuck) {
    const setId = job.higgsfieldJobId;
    if (!setId) continue;
    try {
      const res = await fetch(`${HIGGSFIELD_BASE_URL}/v1/job-sets/${setId}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        logger.warn({ jobId: job.id, setId, status: res.status }, "higgsfield-poll: non-ok");
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as {
        jobs?: Array<{
          id?: string;
          status?: string;
          results?: { raw?: { url?: string }; min?: { url?: string }; original?: { url?: string } };
        }>;
      };
      const inner = json.jobs?.[0];
      const status = inner?.status;
      const ageMs = Date.now() - new Date(job.stageStartedAt ?? job.createdAt ?? Date.now()).getTime();
      if (status !== "completed") {
        if (ageMs >= HIGGSFIELD_FALLBACK_AFTER_MS) {
          logger.warn({ jobId: job.id, setId, status, ageMs }, "higgsfield-poll: stuck past fallback threshold, trying Gemini");
          const fb = await dispatchGeminiBaseFallback(job.id, job.prefs);
          recordRecoveryEvent({
            jobId: job.id,
            recoveryKind: "hf_poll_to_gemini_fallback",
            fromProvider: "higgsfield",
            toProvider: "gemini",
            stage: "base_fallback",
            reason: `higgsfield-poll stuck past fallback threshold (status=${status})`,
            success: !!fb.url,
            delayMs: ageMs,
            metadata: { trigger: "pollHiggsfieldStuckJobs.in_flight", setId },
          });
          if (fb.url) await onHiggsfieldResult(job.id, fb.url);
          else logger.warn({ jobId: job.id, fbErr: fb.error }, "higgsfield-poll: Gemini fallback also failed");
        } else {
          logger.info({ jobId: job.id, setId, status }, "higgsfield-poll: still in flight");
          recordExecutionEvent({
            provider: "higgsfield",
            operation: "poll",
            stage: "base_generation",
            jobId: job.id,
            providerJobId: setId,
            success: true,
            pollUsed: true,
            metadata: { inFlight: true, ageMs },
          });
        }
        continue;
      }
      const url =
        inner?.results?.raw?.url ??
        inner?.results?.original?.url ??
        inner?.results?.min?.url ??
        null;
      if (!url) {
        logger.warn({ jobId: job.id, setId }, "higgsfield-poll: completed but no result url, trying Gemini fallback");
        const fb = await dispatchGeminiBaseFallback(job.id, job.prefs);
        recordRecoveryEvent({
          jobId: job.id,
          recoveryKind: "hf_poll_to_gemini_fallback",
          fromProvider: "higgsfield",
          toProvider: "gemini",
          stage: "base_fallback",
          reason: "higgsfield-poll completed but missing result url",
          success: !!fb.url,
          delayMs: ageMs,
          metadata: { trigger: "pollHiggsfieldStuckJobs.no_url", setId },
        });
        if (fb.url) await onHiggsfieldResult(job.id, fb.url);
        else logger.warn({ jobId: job.id, fbErr: fb.error }, "higgsfield-poll: Gemini fallback also failed");
        continue;
      }
      logger.info({ jobId: job.id, setId, url }, "higgsfield-poll: completed, applying result");
      recordExecutionEvent({
        provider: "higgsfield",
        operation: "poll",
        stage: "base_generation",
        jobId: job.id,
        providerJobId: setId,
        success: true,
        pollUsed: true,
        metadata: { recoveredViaPoll: true, ageMs },
      });
      await onHiggsfieldResult(job.id, url, setId);
    } catch (err) {
      logger.warn({ err, jobId: job.id, setId }, "higgsfield-poll: fetch threw");
      recordExecutionEvent({
        provider: "higgsfield",
        operation: "poll",
        stage: "base_generation",
        jobId: job.id,
        providerJobId: setId,
        success: false,
        pollUsed: true,
        errorClass: "TRANSIENT",
        errorMessage: String(err).slice(0, 500),
      });
    }
  }
}

/** Higgsfield webhook callback — base portrait is ready. Stage-gated:
 * only processes when the job is in `generating_base`, so a duplicate
 * callback (or one for an already-finalized job) is a no-op. The provider
 * job id, when stored, must match what we dispatched. */
export async function onHiggsfieldResult(
  jobId: number,
  baseImageUrl: string,
  providerJobId?: string,
): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) {
    logger.warn({ jobId }, "Higgsfield callback: unknown job");
    return;
  }
  if (job.status !== "generating_base") {
    logger.info({ jobId, status: job.status }, "Higgsfield callback ignored (wrong stage)");
    return;
  }
  if (providerJobId && job.higgsfieldJobId && job.higgsfieldJobId !== providerJobId) {
    logger.warn({ jobId, expected: job.higgsfieldJobId, got: providerJobId }, "Higgsfield callback: provider id mismatch");
    return;
  }

  // Mirror the external image into our bucket FIRST so we can run the
  // QA gate against a stable URL (and so the QA verdict can decide
  // whether to retry Higgsfield before we commit the stage transition).
  let storedUrl = baseImageUrl;
  if (isAllowedMirrorUrl(baseImageUrl)) {
    try {
      const resp = await fetch(baseImageUrl);
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        const mime = resp.headers.get("content-type") ?? "image/png";
        storedUrl = await uploadPublicImage(Buffer.from(ab), mime, "infbase-");
      }
    } catch (err) {
      logger.warn({ err, jobId }, "could not mirror Higgsfield image; will pass upstream URL onward");
    }
  } else {
    logger.warn({ jobId, host: safeHost(baseImageUrl) }, "Higgsfield image host not in mirror allowlist; using upstream URL");
  }

  // ── Master portrait QA gate (T006) ───────────────────────────────
  // GPT-4o vision scores the portrait. If the verdict is "reject" and
  // we have not exhausted the QA-driven retry cap (2), re-dispatch
  // Higgsfield with the strict prompt variant; otherwise proceed to
  // Enhancor with whatever we have so the user is never blocked
  // indefinitely on the QA gate.
  const profile = readOrInferProfile(job.prefs);
  const masterQa = await scoreMasterPortrait(storedUrl, profile);
  void recordInfluencerCost({
    jobId,
    provider: "openai-qa",
    costInCents: COST_CENTS_QA,
    metadata: { stage: "master_portrait", verdict: masterQa.verdict, overall: masterQa.overall },
  });
  logger.info(
    { jobId, verdict: masterQa.verdict, overall: masterQa.overall, realism: masterQa.realism, anatomy: masterQa.anatomy },
    "master portrait QA scored",
  );

  // ── Master portrait WARDROBE gate ────────────────────────────────
  // Hard, deterministic post-generation check: shirtless / open-shirt /
  // exposed-torso / fitness-physique outputs are rejected and Higgsfield
  // is re-dispatched with the strict identity prompt. Caps at the same
  // master_qa retry budget so we never block the user indefinitely.
  const wardrobeVerdict = await scoreWardrobe(storedUrl);
  logger.info(
    {
      jobId,
      image: storedUrl,
      status: wardrobeVerdict.pass ? "pass" : "fail",
      reason: wardrobeVerdict.reason,
      torsoExposure: wardrobeVerdict.torsoSkinRatio,
      shirtlessProbability: wardrobeVerdict.shirtlessProbability,
      exposedChest: wardrobeVerdict.exposedChestPercentage,
      openShirtDepth: wardrobeVerdict.openShirtDepth,
      visibleAbs: wardrobeVerdict.visibleAbs,
      notes: wardrobeVerdict.notes,
      stage: "master_portrait",
    },
    "[wardrobe-check]",
  );
  if (!wardrobeVerdict.pass) {
    const wardrobeAttempts = await getRetry(jobId, "master_qa");
    const MASTER_QA_MAX = 2;
    if (wardrobeAttempts < MASTER_QA_MAX) {
      logger.warn(
        { jobId, attempt: wardrobeAttempts + 1, reason: wardrobeVerdict.reason },
        "[wardrobe-regenerate] re-dispatching Higgsfield with strict prompt",
      );
      await bumpRetry(jobId, "master_qa");
      await db
        .update(aiInfluencerJobsTable)
        .set({
          higgsfieldJobId: null,
          baseImageUrl: storedUrl,
          progress: 20,
          heartbeatAt: new Date(),
          stageStartedAt: new Date(),
          lastErrorCode: "WARDROBE_REJECT",
          lastErrorMessage: `Wardrobe gate rejected (${wardrobeVerdict.reason}); retrying with strict prompt`,
        })
        .where(eq(aiInfluencerJobsTable.id, jobId));
      const retryRes = await getProvider("higgsfield").submit({
        jobId,
        prefs: job.prefs,
        strict: true,
        qaNotes: `WARDROBE: ${wardrobeVerdict.reason}. ${wardrobeVerdict.notes}`,
      });
      if (retryRes.providerJobId) {
        await db
          .update(aiInfluencerJobsTable)
          .set({ higgsfieldJobId: retryRes.providerJobId, progress: 25, heartbeatAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, jobId));
        return; // wait for the new webhook
      }
      // Task #442 - strict re-dispatch failed to queue. Previously we
      // shipped the wardrobe-rejected master and let scene swaps bake
      // in the bad wardrobe. Fail-closed instead so the user can
      // re-queue rather than receive a poisoned reel.
      logger.warn(
        { jobId, retryErr: retryRes.error },
        "[wardrobe-regenerate] strict re-dispatch failed; failing job hard before scene swaps",
      );
      await failJob(
        jobId,
        "WARDROBE_REJECT",
        `Master wardrobe was rejected and the strict re-dispatch could not be queued ` +
          `(${retryRes.error?.code ?? "unknown"}: ${retryRes.error?.message ?? "n/a"}). ` +
          `Refusing to build scenes on a rejected master.`,
        { wardrobeVerdict, retryErr: retryRes.error ?? null },
      );
      return;
    } else {
      // Cap reached. Hard-fail instead of proceeding with a known-bad
      // wardrobe (same rationale as the master-QA cap below).
      logger.warn(
        { jobId, wardrobeAttempts },
        "[wardrobe-check] master wardrobe reject cap reached; failing job hard before scene swaps",
      );
      await failJob(
        jobId,
        "WARDROBE_REJECT",
        `Master wardrobe was rejected after ${wardrobeAttempts} attempts ` +
          `(${wardrobeVerdict.reason}). Refusing to build scenes on a rejected master.`,
        { wardrobeVerdict, wardrobeAttempts },
      );
      return;
    }
  }

  if (masterQa.verdict === "reject") {
    const qaAttempts = await getRetry(jobId, "master_qa");
    const MASTER_QA_MAX = 2;
    if (qaAttempts < MASTER_QA_MAX) {
      // Re-dispatch with the strict prompt variant. Stay in
      // generating_base; clear higgsfieldJobId so the next webhook is
      // matched against the new dispatch.
      await bumpRetry(jobId, "master_qa");
      await db
        .update(aiInfluencerJobsTable)
        .set({
          higgsfieldJobId: null,
          baseImageUrl: storedUrl,
          progress: 20,
          heartbeatAt: new Date(),
          stageStartedAt: new Date(),
          lastErrorCode: "QA_REJECT",
          lastErrorMessage: `Master QA rejected (overall=${masterQa.overall}); retrying with strict prompt`,
        })
        .where(eq(aiInfluencerJobsTable.id, jobId));
      // Slice C: ProviderManager routes the strict re-dispatch.
      const retryRes = await getProvider("higgsfield").submit({
        jobId,
        prefs: job.prefs,
        strict: true,
        qaNotes: masterQa.notes,
      });
      const retryId = retryRes.providerJobId;
      const retryErr = retryRes.error
        ? {
            code: retryRes.error.code,
            message: retryRes.error.message,
            payload: retryRes.error.payload,
          }
        : undefined;
      if (retryId) {
        await db
          .update(aiInfluencerJobsTable)
          .set({ higgsfieldJobId: retryId, progress: 25, heartbeatAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, jobId));
        logger.info({ jobId, qaAttempts: qaAttempts + 1, retryId }, "master QA reject — re-dispatched Higgsfield with strict prompt");
        return; // wait for the new webhook
      }
      // Task #442 - strict re-dispatch failed to queue. Hard-fail
      // instead of proceeding with a QA-rejected master.
      logger.warn(
        { jobId, retryErr },
        "master QA strict re-dispatch failed; failing job hard before scene swaps",
      );
      await failJob(
        jobId,
        "QA_REJECT",
        `Master portrait failed identity QA and the strict re-dispatch could not be queued ` +
          `(${retryErr?.code ?? "unknown"}: ${retryErr?.message ?? "n/a"}). ` +
          `Refusing to build scenes on a rejected master.`,
        { masterQa, retryErr: retryErr ?? null },
      );
      return;
    } else {
      // Task #442 - master QA reject cap is now a hard fail. Previously
      // we shipped the rejected image and let scene swaps propagate the
      // drift; the user reported (and we agree) that downstream scenes
      // baked in the wrong face / age / hairstyle / facial-hair, and
      // there is no way for scene-swap QA to recover from a poisoned
      // master. Fail fast so the user can re-queue with a tightened
      // brief instead of getting a full reel built on the wrong person.
      logger.warn(
        { jobId, qaAttempts, masterQa: { overall: masterQa.overall, notes: masterQa.notes } },
        "master QA reject cap reached; failing job hard before scene swaps",
      );
      await failJob(
        jobId,
        "QA_REJECT",
        `Master portrait failed identity QA after ${qaAttempts} attempts (overall=${masterQa.overall}). ` +
          `Refusing to build scenes on a rejected master. QA notes: ${masterQa.notes ?? "n/a"}.`,
        { masterQa, qaAttempts },
      );
      return;
    }
  }

  // Atomic stage transition via setStage so stageStartedAt + heartbeatAt
  // both get refreshed (stuck-detection and stage-elapsed logs read those
  // columns, and a stale value would either cause premature timeout or
  // misleading observability).
  // Task #725: face-reference freeze. Never overwrite a persisted
  // baseImageUrl once it exists - a stray late callback from a
  // re-dispatched provider job would otherwise swap out the master
  // portrait mid-build and produce "two different faces" in the same
  // delivery. The first writer wins.
  const existingBase = job.baseImageUrl;
  const baseToPersist = existingBase ?? storedUrl;
  if (existingBase && existingBase !== storedUrl) {
    logger.warn(
      { jobId, existingBase, attemptedUrl: storedUrl },
      "Higgsfield callback tried to overwrite frozen baseImageUrl - keeping original",
    );
  }
  const claimed = await setStage(jobId, "generating_base", "enhancing", {
    progress: 50,
    baseImageUrl: baseToPersist,
  });
  if (!claimed) return; // lost the race

  await db
    .update(aiInfluencerJobsTable)
    .set({ baseImageUrl: baseToPersist, heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));

  logStageTransition({
    jobId,
    clientId: job.clientId,
    fromStage: "generating_base",
    toStage: "enhancing",
    provider: "higgsfield",
    providerJobId: providerJobId ?? job.higgsfieldJobId ?? null,
    notes: { masterQa: { overall: masterQa.overall, verdict: masterQa.verdict } },
    ...computeElapsed(job),
  });

  // Slice C: enhancement stage now goes through ProviderManager.
  const enhancorRes = await getProvider("enhancor").submit({
    jobId,
    baseImageUrl: storedUrl,
  });
  const enhancorJobId = enhancorRes.providerJobId;
  const enhancorError = enhancorRes.error
    ? {
        code: enhancorRes.error.code,
        message: enhancorRes.error.message,
        payload: enhancorRes.error.payload,
      }
    : undefined;
  if (enhancorJobId) {
    await db
      .update(aiInfluencerJobsTable)
      .set({ enhancorJobId, progress: 60, heartbeatAt: new Date() })
      .where(eq(aiInfluencerJobsTable.id, jobId));
  } else {
    // Bounded retry on Enhancor: if we have not exhausted, fall back to
    // the unenhanced portrait (skin step skipped) so the user still
    // gets a deliverable. Persist the error for diagnostics either way.
    if (enhancorError) await persistError(jobId, enhancorError, enhancorError.payload);
    const attempts = await bumpRetry(jobId, "enhancor", { withBackoff: true });
    logger.warn({ jobId, attempts, code: enhancorError?.code }, "Enhancor unavailable; using base portrait for scene swaps");
    await onEnhancorResult(jobId, storedUrl);
  }
}

/** Enhancor webhook callback — refined portrait is ready. Stage-gated to
 * `enhancing` so duplicate / spoofed callbacks for jobs in another stage
 * are dropped. Provider job id verified when present. */
export async function onEnhancorResult(
  jobId: number,
  enhancedImageUrl: string,
  providerJobId?: string,
): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;
  if (job.status !== "enhancing") {
    logger.info({ jobId, status: job.status }, "Enhancor callback ignored (wrong stage)");
    return;
  }
  if (providerJobId && job.enhancorJobId && job.enhancorJobId !== providerJobId) {
    logger.warn({ jobId, expected: job.enhancorJobId, got: providerJobId }, "Enhancor callback: provider id mismatch");
    return;
  }

  // Atomic claim the swapping_scenes stage via setStage so stageStartedAt
  // + heartbeatAt both refresh (concurrent callbacks cannot both fan out
  // 10 Gemini calls because only the first transition wins).
  const claimed = await setStage(jobId, "enhancing", "swapping_scenes", { progress: 70 });
  if (!claimed) return;

  let storedUrl = enhancedImageUrl;
  if (enhancedImageUrl.startsWith("/api/portal/images/")) {
    storedUrl = enhancedImageUrl;
  } else if (isAllowedMirrorUrl(enhancedImageUrl)) {
    try {
      const resp = await fetch(enhancedImageUrl);
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        const mime = resp.headers.get("content-type") ?? "image/png";
        storedUrl = await uploadPublicImage(Buffer.from(ab), mime, "infenh-");
      }
    } catch (err) {
      logger.warn({ err, jobId }, "could not mirror Enhancor image; using upstream URL");
    }
  } else {
    logger.warn({ jobId, host: safeHost(enhancedImageUrl) }, "Enhancor image host not in mirror allowlist; using upstream URL");
  }

  // Task #725: face-reference freeze. Once Enhancor has produced the
  // refined portrait we never overwrite it - any subsequent callback
  // for the same job (re-dispatch, stale webhook redelivery) must read
  // the persisted URL, not replace it.
  const existingEnhanced = job.enhancedImageUrl;
  const enhancedToPersist = existingEnhanced ?? storedUrl;
  if (existingEnhanced && existingEnhanced !== storedUrl) {
    logger.warn(
      { jobId, existingEnhanced, attemptedUrl: storedUrl },
      "Enhancor callback tried to overwrite frozen enhancedImageUrl - keeping original",
    );
  }
  storedUrl = enhancedToPersist;
  await db
    .update(aiInfluencerJobsTable)
    .set({ enhancedImageUrl: enhancedToPersist, heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));

  logStageTransition({
    jobId,
    clientId: job.clientId,
    fromStage: "enhancing",
    toStage: "swapping_scenes",
    provider: "enhancor",
    providerJobId: providerJobId ?? job.enhancorJobId ?? null,
    ...computeElapsed(job),
  });

  if (!cinematicFanoutEnabled()) {
    // Skip cinematic scene fan-out entirely. The portrait is done -
    // the job is internally "ready" - but we deliberately HONOR the
    // original randomized etaAt window (28-180 min) so the queue card
    // counts all the way down to zero before flipping to "Ready".
    // finalizeReadyJobs gates on etaAt <= now, so it will promote the
    // job to status='ready' on its next tick once the window elapses.
    // We only stamp progress + heartbeat here; etaAt is left untouched.
    await db
      .update(aiInfluencerJobsTable)
      .set({ progress: 95, heartbeatAt: new Date() })
      .where(eq(aiInfluencerJobsTable.id, jobId));
    return;
  }

  void runScenesAndStore(jobId, storedUrl, job.prefs.gender).catch((err) =>
    logger.error({ err, jobId }, "runScenesAndStore failed"),
  );
}

function maybeMirror(_u: string): boolean { return true; }
function safeHost(u: string): string { try { return new URL(u).hostname; } catch { return "?"; } }

/** Build the per-job Enhancor callback URL. The webhook secret rides along
 * as a query param (`s=...`) because Enhancor's queue API does not let us
 * configure custom request headers — it just POSTs to whatever URL we hand
 * it. Putting the secret in the URL still gives us the same guarantee
 * (only Enhancor knows the URL) and lets the route reject forged calls. */
export function buildEnhancorWebhookUrl(base: string, jobId: number): string {
  const secret = process.env.ENHANCOR_WEBHOOK_SECRET;
  const qs = new URLSearchParams({ infjob: String(jobId) });
  if (secret) qs.set("s", secret);
  return `${base}/api/portal/influencer-jobs/enhancor-webhook?${qs.toString()}`;
}

async function runScenesAndStore(jobId: number, characterUrl: string, _gender: string): Promise<void> {
  // Seed per-scene state on the job (idempotent: only seed if empty so a
  // worker restart mid-fanout reuses the existing entries instead of
  // resetting attempt counters).
  const job = await loadJob(jobId);
  if (!job) return;
  let scenesState = (job.scenes ?? []) as SceneState[];
  if (scenesState.length === 0) {
    // Cinematic refactor (T004): code-first scene template selection
    // driven by the inferred CharacterProfile. Each picked template
    // carries its own cached cinematic prompt; the worker passes the
    // master portrait alone as the Gemini input (no Drive scene image).
    const profile = readOrInferProfile(job.prefs);
    const picked = pickScenesForProfile(profile, SCENES_PER_JOB);
    if (picked.length === 0) {
      logger.warn({ jobId }, "scene template library returned 0 picks — finalizing without scene swaps");
      await db
        .update(aiInfluencerJobsTable)
        .set({ progress: 95, heartbeatAt: new Date() })
        .where(eq(aiInfluencerJobsTable.id, jobId));
      return;
    }
    scenesState = picked.map((tpl, i) => ({
      idx: i,
      sceneId: null,
      templateId: tpl.id,
      label: tpl.label,
      prompt: buildScenePlacementPrompt(profile, tpl),
      state: "pending" as const,
      attempts: 0,
      imageUrl: null,
      lastErrorCode: null,
      lastErrorAt: null,
      nextAttemptAt: null,
    }));
    await db
      .update(aiInfluencerJobsTable)
      .set({ scenes: scenesState, heartbeatAt: new Date() })
      .where(eq(aiInfluencerJobsTable.id, jobId));
  }

  // Slice B: seed child scene-job rows. Idempotent (unique on
  // (parent_job_id, scene_index)) so a re-entry of runScenesAndStore
  // (e.g. resumeStuckScenes safety net) does not duplicate work.
  // The dedicated worker tick (runSceneJobsTick) now owns dispatch:
  // we no longer call runSceneSwaps inline here. The inline scenes[]
  // jsonb above stays seeded as a legacy mirror so finalize's
  // existing gate keeps working as a fallback for in-flight rollback
  // safety; the canonical source of truth is the child table.
  const seeds: SceneJobSeed[] = scenesState.map((s) => ({
    sceneIndex: s.idx,
    templateId: s.templateId ? String(s.templateId) : null,
    label: s.label,
    prompt: s.prompt ?? "",
    metadata: { sceneId: s.sceneId, seededFrom: "runScenesAndStore" },
  }));
  const seedRes = await seedSceneJobsForParent(jobId, seeds);
  await db
    .update(aiInfluencerJobsTable)
    .set({ progress: Math.max(job.progress, 75), heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, jobId));

  logStageTransition({
    jobId,
    clientId: job.clientId,
    fromStage: "swapping_scenes",
    toStage: "swapping_scenes",
    provider: "gemini",
    sceneCount: scenesState.length,
    notes: { childRowsInserted: seedRes.inserted, sliceB: true },
    ...computeElapsed(job),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 3.5 — Scene-resume worker pass.
//
// runScenesAndStore() is normally fired from the Enhancor webhook handler
// as a fire-and-forget Promise. If the worker crashes mid fan-out, or a
// per-scene failure backs off into the future, nothing else re-invokes
// the loop. resumeStuckScenes() is the worker-tick safety net that
// re-drives fan-out for any swapping_scenes job whose `scenes` array
// still has non-terminal entries that are now eligible to run again.
//
// Per-job claim is a heartbeat CAS: only re-fire when the job's
// heartbeatAt is older than RESUME_FANOUT_LOCK_MS (so two ticks within
// the lock window cannot both spawn a fan-out). Updating heartbeatAt
// inside runSceneSwaps keeps the lock alive while real work is happening.
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_FANOUT_LOCK_MS = Number(
  process.env.INFLUENCER_RESUME_FANOUT_LOCK_MS ?? 60_000,
);

export async function resumeStuckScenes(): Promise<void> {
  const lockCutoff = new Date(Date.now() - RESUME_FANOUT_LOCK_MS);
  const candidates = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "swapping_scenes"),
        isNull(aiInfluencerJobsTable.completedAt),
        lte(
          sql`coalesce(${aiInfluencerJobsTable.heartbeatAt}, ${aiInfluencerJobsTable.createdAt})`,
          lockCutoff,
        ),
      ),
    )
    .limit(20);
  const nowMs = Date.now();
  for (const job of candidates) {
    const sceneStates = (job.scenes ?? []) as SceneState[];
    if (sceneStates.length === 0) continue;
    const eligible = sceneStates.some(
      (s) =>
        s.state !== "completed" &&
        (s.state !== "failed" || s.attempts < RETRY_CAPS.scene + 1) &&
        (!s.nextAttemptAt || Date.parse(s.nextAttemptAt) <= nowMs),
    );
    if (!eligible) continue;
    // Slice B: if this parent already has child scene-job rows seeded,
    // the dedicated worker tick (runSceneJobsTick) owns dispatch.
    // Bowing out here prevents the legacy inline fan-out from
    // racing the new orchestration on the same scenes.
    if (await hasChildSceneJobs(job.id)) continue;
    const characterUrl = job.enhancedImageUrl ?? job.baseImageUrl;
    if (!characterUrl) continue;
    // Heartbeat CAS — only one tick wins the lock for this job.
    const claimed = await db
      .update(aiInfluencerJobsTable)
      .set({ heartbeatAt: new Date() })
      .where(
        and(
          eq(aiInfluencerJobsTable.id, job.id),
          lte(
            sql`coalesce(${aiInfluencerJobsTable.heartbeatAt}, ${aiInfluencerJobsTable.createdAt})`,
            lockCutoff,
          ),
        ),
      )
      .returning({ id: aiInfluencerJobsTable.id });
    if (claimed.length === 0) continue;
    logger.info(
      { jobId: job.id, sceneCount: sceneStates.length },
      "resumeStuckScenes: re-driving scene fan-out",
    );
    if (!cinematicFanoutEnabled()) {
      // Do not re-drive cinematic fan-out, and do NOT pull etaAt
      // forward - we want the queue card to honor the full
      // randomized window. The finalize tick will pick this job up
      // naturally once etaAt elapses.
      await db
        .update(aiInfluencerJobsTable)
        .set({ heartbeatAt: new Date() })
        .where(eq(aiInfluencerJobsTable.id, job.id));
      continue;
    }
    void runScenesAndStore(job.id, characterUrl, job.prefs.gender).catch((err) =>
      logger.error({ err, jobId: job.id }, "resumeStuckScenes: runScenesAndStore failed"),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE 4 — Finalize: notification + email
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worker tick: any job whose pipeline is done AND eta_at has passed gets
 * promoted to ready. Atomic claim via completedAt prevents double-finalize
 * across concurrent worker processes. Stuck-state recovery promotes jobs
 * waiting too long on a provider webhook into "failed" so the UI doesn't
 * spin forever.
 */
export async function finalizeReadyJobs(): Promise<void> {
  const now = new Date();

  // Recover jobs stuck on Higgsfield/Enhancor webhooks past the threshold.
  await markStuckFailed("generating_base", STUCK_GENERATING_BASE_MS, "higgsfield_timeout");
  await markStuckFailed("enhancing", STUCK_ENHANCING_MS, "enhancor_timeout");
  // Swapping_scenes can also wedge if the fire-and-forget Promise crashes
  // during a process restart. Recover by finalizing with whatever we have.
  await rescueStuckSwapping(STUCK_SWAPPING_MS);
  // Task #695: terminal-no-output fast-fail.
  //
  // The old wedge path: a job whose every child scene-job lands in
  // status='failed' (zero usable assets) was still gated on
  // etaAt <= now AND finalizeAttempts >= cap AND
  // etaAgeMs >= 30 min. Because etaAt is biased between 28 and 150
  // minutes from creation, a job that genuinely failed scene-swap
  // within the first few minutes sat wedged in `swapping_scenes`
  // for 2 to 3+ hours before the cap path tripped. From the buyer's
  // perspective the job said "In the queue" indefinitely and the
  // free-tier counter was held against them.
  //
  // There is no possible recovery once every child scene-job is
  // terminal-failed with zero output - waiting cannot create assets
  // that do not exist. So we fast-fail immediately, ignoring etaAt
  // and the finalize backoff cap. Mirrors the cleanup-influencer-job
  // CLI's failure reason ("scene_swap_no_output") so admin diagnostics
  // and the failed-job email use the same taxonomy.
  await failTerminalNoOutputJobs();

  const candidates = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "swapping_scenes"),
        lte(aiInfluencerJobsTable.etaAt, now),
        // Mutually exclusive with the stalledFinalize replay loop below:
        // first-attempt finalize candidates are jobs that have NOT yet
        // claimed completedAt. Replay candidates (completedAt IS NOT NULL)
        // are handled separately so the same job is not processed twice
        // in a single tick (which would double-bump finalize_attempts and
        // accelerate finalize/email retry-cap exhaustion).
        isNull(aiInfluencerJobsTable.completedAt),
        // Backoff gate: a finalize attempt that bumps the retry counter
        // also stamps next_attempt_at; the next tick must wait until
        // that elapses before re-trying.
        sql`(${aiInfluencerJobsTable.nextAttemptAt} IS NULL OR ${aiInfluencerJobsTable.nextAttemptAt} <= now())`,
      ),
    )
    .limit(20);

  for (const job of candidates) {
    // Per-scene completion gate (replaces the legacy sceneImageUrls-length
    // heuristic). Done-criteria: a job delivers an influencer + the full
    // required scene set. So:
    //   - catalog empty (FAST_MODE / dev): degrade gracefully (nothing to wait for).
    //   - any scene still pending/running (or failed-under-cap with backoff
    //     pending): let the fan-out progress — wait for the next tick.
    //   - any scene failed-after-cap: do NOT finalize a partial set; mark
    //     the job failed with PARTIAL_BATCH_FAILURE so the user is
    //     unblocked instead of receiving a deliverable that is missing
    //     scene slots.
    //   - all scenes completed: proceed to finalize.
    const sceneStates = (job.scenes ?? []) as SceneState[];
    // Slice B: child-row aggregation is the canonical gate for new jobs.
    // If the parent has child scene-job rows, defer to that aggregate;
    // otherwise fall through to the legacy inline-scenes gate so
    // pre-Slice-B in-flight jobs keep finalizing through the existing
    // path.
    const childAgg = await aggregateForParent(job.id);
    if (childAgg.total > 0) {
      if (!childAgg.allTerminal) continue; // wait next tick — child workers still busy
      // Task #674: Slice-B child aggregate path. If every child scene
      // is terminal AND zero of them landed a usable asset, the cap
      // guard must run here too — otherwise the job would skip
      // straight into finalizeJob() with sceneImageUrls=[] and the
      // user receives a broken deliverable instead of a clear
      // scene_swap_no_output failure.
      const childEtaAgeMs = job.etaAt
        ? Date.now() - new Date(job.etaAt).getTime()
        : 0;
      const childFinalizeAttempts = await getRetry(job.id, "finalize");
      if (
        shouldFailJobForNoSceneOutputChild({
          childCompletedAssetsCount: childAgg.completedAssets.length,
          childAllTerminal: childAgg.allTerminal,
          etaAgeMs: childEtaAgeMs,
          finalizeAttempts: childFinalizeAttempts,
        })
      ) {
        const finalizeAttempts = childFinalizeAttempts;
        logger.warn(
          {
            pipeline: "influencer",
            stage: "finalize",
            jobId: job.id,
            finalizeAttempts,
            cap: SCENE_NO_OUTPUT_FINALIZE_CAP,
            etaAgeMs: childEtaAgeMs,
            sliceB: true,
            childTotal: childAgg.total,
            failedIdx: childAgg.failedIndices,
          },
          "scene_swap_no_output cap reached (sliceB) → failing job",
        );
        await failJob(
          job.id,
          "SCENE_SWAP_NO_OUTPUT",
          `Scene swap produced zero usable assets after ${finalizeAttempts} finalize attempts (sliceB=child, failedIdx=${childAgg.failedIndices.join(",")}, etaAgeMs=${childEtaAgeMs})`,
          {
            finalizeAttempts,
            etaAgeMs: childEtaAgeMs,
            failedIdx: childAgg.failedIndices,
            sliceB: true,
            failureReason: "scene_swap_no_output",
          },
        );
        await db
          .update(aiInfluencerJobsTable)
          .set({ failureReason: "scene_swap_no_output" })
          .where(eq(aiInfluencerJobsTable.id, job.id));
        logStageTransition({
          jobId: job.id,
          clientId: job.clientId,
          fromStage: "swapping_scenes",
          toStage: "failed",
          retryCount: finalizeAttempts,
          errorCode: "SCENE_SWAP_NO_OUTPUT",
          errorMessage: "scene swap produced zero usable assets (sliceB)",
          notes: {
            etaAgeMs: childEtaAgeMs,
            failedIdx: childAgg.failedIndices,
            sliceB: true,
          },
        });
        await postInfluencerStuckAlert({
          jobId: job.id,
          clientId: job.clientId,
          source: "cap_sliceB",
          failureReason: "scene_swap_no_output",
          finalizeAttempts,
          etaAgeMs: childEtaAgeMs,
          totalElapsedMs: Date.now() - new Date(job.createdAt).getTime(),
          failedIdx: childAgg.failedIndices,
          extra: { sliceB: true, childTotal: childAgg.total },
        });
        continue;
      }
      // Task #674: slice-B child wait gate. If zero usable assets but
      // cap/age not yet reached, NEVER finalize - wait for more child
      // jobs to terminate or for the cap+age gate above to trigger.
      // CRITICAL: bumpRetry("finalize") so the cap is actually
      // reachable on subsequent ticks; getRetry() is read-only, so a
      // pure `continue` would let the counter stay at 0 forever and
      // recreate the indefinite-wedge bug the cap was meant to fix.
      if (
        childAgg.allTerminal &&
        childAgg.completedAssets.length === 0
      ) {
        const bumped = await bumpRetry(job.id, "finalize", { withBackoff: true });
        logger.info(
          {
            pipeline: "influencer",
            stage: "finalize",
            phase: "gate",
            jobId: job.id,
            finalizeAttempts: bumped,
            cap: SCENE_NO_OUTPUT_FINALIZE_CAP,
            etaAgeMs: childEtaAgeMs,
            maxAgeMs: SCENE_NO_OUTPUT_MAX_AGE_MS,
            sliceB: true,
            childTotal: childAgg.total,
            failedIdx: childAgg.failedIndices,
            decision: "wait",
          },
          "finalize blocked (sliceB): zero usable scenes, cap/age not yet reached; finalize counter bumped",
        );
        continue;
      }
      // Mirror canonical scene assets into parent.sceneImageUrls so
      // packaging + email rendering keep working unchanged.
      await db
        .update(aiInfluencerJobsTable)
        .set({
          sceneImageUrls: childAgg.completedAssets.map((a) => ({
            url: a.url,
            label: a.label,
          })),
          heartbeatAt: new Date(),
        })
        .where(eq(aiInfluencerJobsTable.id, job.id));
      if (childAgg.anyFailedHard) {
        await persistJobError(
          job.id,
          {
            code: "PARTIAL_BATCH_FAILURE",
            message: `Scene retry cap exhausted on ${childAgg.failedIndices.length} of ${childAgg.total} scenes (idx=${childAgg.failedIndices.join(",")}, sliceB=child); proceeding to ready_degraded with ${childAgg.completed} usable assets`,
          },
          {
            failedIdx: childAgg.failedIndices,
            completedIdx: childAgg.completedAssets.map((a) => a.sceneIndex),
            sliceB: true,
          },
        );
      }
      try {
        await finalizeJob(job);
      } catch (err) {
        logger.error({ err, jobId: job.id }, "finalizeJob (sliceB) failed");
        await persistThrownFinalizeError(job.id, err, "finalize");
      }
      continue;
    }

    if (sceneStates.length === 0 && !FAST_MODE) {
      const sceneCount = await countEnabledScenes();
      if (sceneCount > 0) continue; // catalog non-empty but fan-out hasn't seeded yet
    }
    // Task #674: scene_swap_no_output guard. If we are about to
    // finalize a job whose canonical scene asset list is empty AND
    // its inline scene states all failed-after-cap (or were never
    // seeded) AND etaAt has been in the past for SCENE_NO_OUTPUT_MAX_AGE_MS,
    // we cap the finalize_attempts at SCENE_NO_OUTPUT_FINALIZE_CAP and
    // route the job to status=failed with failureReason=scene_swap_no_output.
    // This unblocks the user with a specific code instead of letting
    // finalize loop until DELIVERY_FAILURE masks the real cause.
    {
      const assetsSoFar = (job.sceneImageUrls ?? []) as Array<unknown>;
      const allInlineDone =
        sceneStates.length === 0 ||
        sceneStates.every(
          (s) => s.state === "completed" || (s.state === "failed" && s.attempts >= RETRY_CAPS.scene),
        );
      const noUsableScenes =
        assetsSoFar.length === 0 &&
        sceneStates.every((s) => s.state !== "completed");
      const etaAgeMs = job.etaAt ? Date.now() - new Date(job.etaAt).getTime() : 0;
      if (noUsableScenes && allInlineDone) {
        const finalizeAttempts = await getRetry(job.id, "finalize");
        if (
          etaAgeMs >= SCENE_NO_OUTPUT_MAX_AGE_MS &&
          finalizeAttempts >= SCENE_NO_OUTPUT_FINALIZE_CAP
        ) {
          const failedIdx = sceneStates
            .filter((s) => s.state === "failed")
            .map((s) => s.idx);
          const lastErr =
            sceneStates.find((s) => s.lastErrorCode)?.lastErrorCode ?? null;
          logger.warn(
            {
              pipeline: "influencer",
              stage: "finalize",
              jobId: job.id,
              finalizeAttempts,
              cap: SCENE_NO_OUTPUT_FINALIZE_CAP,
              etaAgeMs,
              sceneStatesLen: sceneStates.length,
              failedIdx,
              lastSceneErr: lastErr,
            },
            "scene_swap_no_output cap reached → failing job",
          );
          await failJob(
            job.id,
            "SCENE_SWAP_NO_OUTPUT",
            `Scene swap produced zero usable assets after ${finalizeAttempts} finalize attempts (lastSceneErr=${lastErr ?? "none"}, etaAgeMs=${etaAgeMs})`,
            {
              finalizeAttempts,
              etaAgeMs,
              failedIdx,
              lastSceneErr: lastErr,
              failureReason: "scene_swap_no_output",
            },
          );
          await db
            .update(aiInfluencerJobsTable)
            .set({ failureReason: "scene_swap_no_output" })
            .where(eq(aiInfluencerJobsTable.id, job.id));
          logStageTransition({
            jobId: job.id,
            clientId: job.clientId,
            fromStage: "swapping_scenes",
            toStage: "failed",
            retryCount: finalizeAttempts,
            errorCode: "SCENE_SWAP_NO_OUTPUT",
            errorMessage: "scene swap produced zero usable assets",
            notes: { etaAgeMs, failedIdx, lastSceneErr: lastErr },
          });
          await postInfluencerStuckAlert({
            jobId: job.id,
            clientId: job.clientId,
            source: "cap_inline",
            failureReason: "scene_swap_no_output",
            finalizeAttempts,
            etaAgeMs,
            totalElapsedMs: Date.now() - new Date(job.createdAt).getTime(),
            failedIdx,
            extra: { lastSceneErr: lastErr },
          });
          continue;
        }
        // Task #674: zero usable scenes but cap/age not yet reached.
        // NEVER finalize with an empty asset list - that's the exact
        // wedge we're fixing. Bump the finalize retry counter so the
        // cap is actually reachable on subsequent ticks (getRetry is
        // read-only; a bare `continue` would keep the counter at 0
        // forever and recreate the indefinite wedge).
        const bumped = await bumpRetry(job.id, "finalize", {
          withBackoff: true,
        });
        logger.info(
          {
            pipeline: "influencer",
            stage: "finalize",
            phase: "gate",
            jobId: job.id,
            finalizeAttempts: bumped,
            cap: SCENE_NO_OUTPUT_FINALIZE_CAP,
            etaAgeMs,
            maxAgeMs: SCENE_NO_OUTPUT_MAX_AGE_MS,
            sceneStatesLen: sceneStates.length,
            assetsSoFar: assetsSoFar.length,
            decision: "wait",
          },
          "finalize blocked: zero usable scenes, cap/age not yet reached; finalize counter bumped",
        );
        continue;
      }
    }
    if (sceneStates.length > 0) {
      const failedAfterCap = sceneStates.filter(
        (s) => s.state === "failed" && s.attempts >= RETRY_CAPS.scene,
      );
      const completed = sceneStates.filter((s) => s.state === "completed");
      const stillWorking = sceneStates.some(
        (s) => s.state !== "completed" && !(s.state === "failed" && s.attempts >= RETRY_CAPS.scene),
      );
      if (stillWorking) continue; // pending/running/retrying — let fan-out progress
      if (failedAfterCap.length > 0) {
        // Slice A: scene swaps are independently optional. Some failed
        // hard, but if we already have a base portrait the influencer
        // is salvageable. Persist the forensic record and fall through
        // to finalize so the user gets a `ready_degraded` deliverable
        // with whatever scenes did complete (could be 0).
        const failedIdx = failedAfterCap.map((s) => s.idx).join(",");
        const lastErr =
          failedAfterCap.find((s) => s.lastErrorCode)?.lastErrorCode ?? "SCENE_SWAP_FAILURE";
        await persistJobError(
          job.id,
          {
            code: "PARTIAL_BATCH_FAILURE",
            message: `Scene retry cap exhausted on ${failedAfterCap.length} of ${sceneStates.length} scenes (idx=${failedIdx}, lastSceneErr=${lastErr}); proceeding to ready_degraded with ${completed.length} usable assets`,
          },
          { failedIdx: failedAfterCap.map((s) => s.idx), completedIdx: completed.map((s) => s.idx), lastErr },
        );
        // Fall through: finalize will pick up degraded marker and use ready_degraded.
      }
    }
    try {
      await finalizeJob(job);
    } catch (err) {
      logger.error({ err, jobId: job.id }, "finalizeJob failed");
      await persistThrownFinalizeError(job.id, err, "finalize");
    }
  }

  // Replay-safety: a job whose finalize claimed completedAt but did not
  // reach status=ready (notification or email failed mid-flight) gets
  // re-driven here. The completedAt lock prevents double-creation of the
  // influencer/scenes; sendReadyNotification + email are independently
  // idempotent.
  const stalledFinalize = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "swapping_scenes"),
        sql`${aiInfluencerJobsTable.completedAt} IS NOT NULL`,
        // Same backoff gate as the first-attempt loop. A finalize that
        // failed at the notification/email step bumps next_attempt_at
        // so the replay does not stampede on every 30s tick.
        sql`(${aiInfluencerJobsTable.nextAttemptAt} IS NULL OR ${aiInfluencerJobsTable.nextAttemptAt} <= now())`,
      ),
    )
    .limit(20);
  for (const job of stalledFinalize) {
    try {
      await finalizeJob(job);
    } catch (err) {
      logger.error({ err, jobId: job.id }, "finalizeJob (replay) failed");
      await persistThrownFinalizeError(job.id, err, "finalize-replay");
    }
  }
}

// Round-9 follow-up: any thrown exception that escapes finalizeJob /
// sendReadyNotification (DB transient, GCS upload throw, mailer
// crash, unexpected runtime error) is caught at the worker loop and
// must leave a normalized footprint on `ai_influencer_jobs` so admin
// diagnostics + `/api/healthz`-adjacent observability surface the
// failure instead of silently re-attempting on the next 30s tick.
//
// We DO NOT call `failJob` here unconditionally — finalize is meant
// to be replay-safe and most thrown exceptions are recoverable. We
// stamp the normalized error fields + bump retries-with-backoff so:
//   - admin diagnostics shows the latest exception text/code
//   - the next finalize attempt is gated by next_attempt_at backoff
//   - if the per-stage cap (RETRY_CAPS.finalize) is exceeded, we
//     transition the job to status=failed with DELIVERY_FAILURE so
//     the user is unblocked.
async function persistThrownFinalizeError(
  jobId: number,
  err: unknown,
  context: "finalize" | "finalize-replay",
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;
  const code: InfluencerErrorCode = "DELIVERY_FAILURE";
  try {
    const attempts = await bumpRetry(jobId, "finalize_thrown", { withBackoff: true });
    await db
      .update(aiInfluencerJobsTable)
      .set({
        lastErrorCode: code,
        lastErrorMessage: `[${context}] ${message}`.slice(0, 1000),
        lastErrorPayload: { context, message, stack: stack?.slice(0, 4000) ?? null, attempts },
        heartbeatAt: new Date(),
      })
      .where(eq(aiInfluencerJobsTable.id, jobId));
    if (attempts >= RETRY_CAPS.finalize) {
      await failJob(
        jobId,
        code,
        `Finalize/delivery exceeded retry cap (${RETRY_CAPS.finalize}) — last error: ${message}`,
        { context, message, attempts },
      );
    }
  } catch (persistErr) {
    // Last-ditch — if even the error-persistence path throws, log
    // loud so an operator sees it on the next refresh_all_logs.
    logger.error(
      { err: persistErr, originalErr: err, jobId, context },
      "persistThrownFinalizeError: failed to persist normalized error",
    );
  }
}

// Task #695: scan every swapping_scenes job for the terminal-no-output
// shape (every child scene-job in 'failed', zero completed assets) and
// fail them immediately. This bypasses the etaAt and finalize-cap
// gates because no amount of waiting can recover a job whose every
// child is terminal-failed.
async function failTerminalNoOutputJobs(): Promise<void> {
  const candidates = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "swapping_scenes"),
        isNull(aiInfluencerJobsTable.completedAt),
      ),
    )
    .limit(50);
  for (const job of candidates) {
    const agg = await aggregateForParent(job.id);
    // Require child-row aggregation (Slice B). Pre-Slice-B inline-only
    // jobs continue through the existing inline finalize gate.
    if (agg.total === 0) continue;
    if (!agg.allTerminal) continue;
    if (agg.completedAssets.length > 0) continue;
    // Every child is terminal AND zero usable assets. failedIndices
    // covers the failed children; allTerminal + zero completed means
    // every child must in fact be in 'failed' state.
    const finalizeAttempts = await getRetry(job.id, "finalize");
    const etaAgeMs = job.etaAt
      ? Date.now() - new Date(job.etaAt).getTime()
      : 0;
    logger.warn(
      {
        pipeline: "influencer",
        stage: "finalize",
        phase: "fast_fail",
        jobId: job.id,
        finalizeAttempts,
        etaAgeMs,
        childTotal: agg.total,
        failedIdx: agg.failedIndices,
        task: 695,
      },
      "scene_swap_no_output fast-fail (every child terminal-failed, zero output) - failing job without waiting for etaAt or cap",
    );
    await failJob(
      job.id,
      "SCENE_SWAP_NO_OUTPUT",
      `Scene swap produced zero usable assets - every child scene-job terminal-failed (failedIdx=${agg.failedIndices.join(",")}, etaAgeMs=${etaAgeMs}, finalizeAttempts=${finalizeAttempts}, fastFail=true)`,
      {
        finalizeAttempts,
        etaAgeMs,
        failedIdx: agg.failedIndices,
        sliceB: true,
        failureReason: "scene_swap_no_output",
        fastFail: true,
      },
    );
    await db
      .update(aiInfluencerJobsTable)
      .set({ failureReason: "scene_swap_no_output" })
      .where(eq(aiInfluencerJobsTable.id, job.id));
    logStageTransition({
      jobId: job.id,
      clientId: job.clientId,
      fromStage: "swapping_scenes",
      toStage: "failed",
      retryCount: finalizeAttempts,
      errorCode: "SCENE_SWAP_NO_OUTPUT",
      errorMessage: "scene swap produced zero usable assets (fast-fail)",
      notes: {
        etaAgeMs,
        failedIdx: agg.failedIndices,
        sliceB: true,
        fastFail: true,
        task: 695,
      },
    });
    await postInfluencerStuckAlert({
      jobId: job.id,
      clientId: job.clientId,
      source: "fast_fail",
      failureReason: "scene_swap_no_output",
      finalizeAttempts,
      etaAgeMs,
      totalElapsedMs: Date.now() - new Date(job.createdAt).getTime(),
      failedIdx: agg.failedIndices,
      extra: { childTotal: agg.total, fastFail: true },
    });
  }
}

async function countEnabledScenes(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiInfluencerScenesTable)
    .where(eq(aiInfluencerScenesTable.enabled, true));
  return row?.c ?? 0;
}

async function markStuckFailed(stage: "generating_base" | "enhancing", maxAgeMs: number, reason: string): Promise<void> {
  // Heartbeat-aware: a job only counts as stuck if BOTH it has been in
  // the stage longer than the absolute timeout AND its heartbeat has
  // not been touched within HEARTBEAT_STALE_MS. This stops us from
  // killing a job that is slow but still making progress (e.g. provider
  // queue backlog). Falls back to createdAt for legacy rows where
  // stageStartedAt is NULL.
  //
  // Stuck-recovery semantics: ONE safe retry per stage before failing.
  // First time we see a job stuck, we requeue it back to its dispatch
  // entrypoint (queued for generating_base, generating_base for
  // enhancing) so the next worker tick re-fires the provider call.
  // Only the SECOND time (stuck retry counter exhausted) do we mark
  // the job failed. This prevents transient provider/webhook outages
  // from killing jobs that would have succeeded on a re-dispatch.
  const ageCutoff = new Date(Date.now() - maxAgeMs);
  const heartbeatCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const stuck = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, stage),
        lte(
          sql`coalesce(${aiInfluencerJobsTable.stageStartedAt}, ${aiInfluencerJobsTable.createdAt})`,
          ageCutoff,
        ),
        lte(
          sql`coalesce(${aiInfluencerJobsTable.heartbeatAt}, ${aiInfluencerJobsTable.createdAt})`,
          heartbeatCutoff,
        ),
      ),
    )
    .limit(20);
  for (const job of stuck) {
    const stuckKey = `stuck_${stage}`;
    const stuckAttempts = await bumpRetry(job.id, stuckKey);
    if (stuckAttempts === 1) {
      // First time stuck: requeue to a stage that will re-dispatch.
      const requeueTo: AiInfluencerJob["status"] =
        stage === "generating_base" ? "queued" : "generating_base";
      const requeued = await setStage(job.id, stage, requeueTo, {
        progress: requeueTo === "queued" ? 0 : 25,
      });
      logger.warn(
        { jobId: job.id, stage, reason, stuckAttempts, requeueTo },
        "stuck influencer job requeued for one safe retry",
      );
      logStageTransition({
        jobId: job.id,
        clientId: job.clientId,
        fromStage: stage,
        toStage: requeueTo,
        retryCount: stuckAttempts,
        errorCode: "PROVIDER_TIMEOUT",
        errorMessage: `${reason}: webhook never arrived (one-safe-retry)`,
        notes: { requeued: !!requeued },
      });
      continue;
    }
    // Second time (cap reached): give up.
    await failJob(
      job.id,
      "PROVIDER_TIMEOUT",
      `Provider webhook never arrived (stage=${stage}, threshold=${maxAgeMs}ms, stuckAttempts=${stuckAttempts})`,
      null,
    );
    recordRecoveryEvent({
      jobId: job.id,
      recoveryKind:
        stage === "generating_base"
          ? "stuck_generating_base_reclaim"
          : "stuck_enhancing_reclaim",
      fromProvider: stage === "generating_base" ? "higgsfield" : "enhancor",
      stage,
      reason: `${reason}: webhook never arrived (stuckAttempts=${stuckAttempts})`,
      success: false,
      delayMs: maxAgeMs,
    });
    logger.warn({ jobId: job.id, stage, reason, stuckAttempts }, "stuck influencer job failed after one-safe-retry");
    logStageTransition({
      jobId: job.id,
      clientId: job.clientId,
      fromStage: stage,
      toStage: "failed",
      retryCount: stuckAttempts,
      errorCode: "PROVIDER_TIMEOUT",
      errorMessage: `${reason}: webhook never arrived`,
    });
  }
}

async function rescueStuckSwapping(maxAgeMs: number): Promise<void> {
  // Bounded recovery for jobs stuck in swapping_scenes (worker crashed
  // mid-fan-out, scene queue wedged, etc). NEVER bypasses the finalize
  // gates. ETA + all-scenes-terminal are still required for finalize;
  // if those gates are not met after the stuck threshold we apply the
  // same one-safe-retry semantics as other stages and ultimately fail
  // with PROVIDER_TIMEOUT instead of marking ready with partial output.
  const ageCutoff = new Date(Date.now() - maxAgeMs);
  const heartbeatCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const candidates = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.status, "swapping_scenes"),
        lte(
          sql`coalesce(${aiInfluencerJobsTable.stageStartedAt}, ${aiInfluencerJobsTable.createdAt})`,
          ageCutoff,
        ),
        lte(
          sql`coalesce(${aiInfluencerJobsTable.heartbeatAt}, ${aiInfluencerJobsTable.createdAt})`,
          heartbeatCutoff,
        ),
        isNull(aiInfluencerJobsTable.completedAt),
      ),
    )
    .limit(20);
  const now = new Date();
  for (const job of candidates) {
    const sceneStates = (job.scenes ?? []) as SceneState[];
    const allCompleted =
      sceneStates.length > 0 && sceneStates.every((s) => s.state === "completed");
    const anyFailedAfterCap = sceneStates.some(
      (s) => s.state === "failed" && s.attempts >= RETRY_CAPS.scene,
    );
    const etaElapsed = job.etaAt ? job.etaAt <= now : false;
    if (allCompleted && etaElapsed) {
      // Gates satisfied — let finalizeReadyJobs' main loop handle it on
      // the next tick (it re-checks the same gates and runs finalize).
      continue;
    }
    if (anyFailedAfterCap) {
      // Don't keep re-driving fan-out for a job that already has a
      // terminal-failed scene; the main loop's PARTIAL_BATCH_FAILURE
      // gate will mark the job failed on the next tick. Skip stuck
      // recovery so we don't bump stuck_swapping_scenes uselessly.
      continue;
    }
    // Genuinely stuck: bump a stuck counter, re-drive fan-out once,
    // then fail on the second hit. The re-drive uses runScenesAndStore
    // with the existing enhancedImage so it picks up exactly the
    // pending/failed-under-cap scenes (idempotent — completed scenes
    // are skipped, attempts counters carry over).
    const stuckAttempts = await bumpRetry(job.id, "stuck_swapping_scenes");
    if (stuckAttempts === 1) {
      await touchHeartbeat(job.id);
      const characterUrl = job.enhancedImageUrl ?? job.baseImageUrl;
      if (characterUrl) {
        if (!cinematicFanoutEnabled()) {
          // Do not re-drive cinematic fan-out for stuck jobs. Leave
          // etaAt alone so the queue countdown stays honest; the
          // finalize tick promotes the job once the original window
          // elapses with whatever portrait we have.
          await db
            .update(aiInfluencerJobsTable)
            .set({ heartbeatAt: new Date() })
            .where(eq(aiInfluencerJobsTable.id, job.id));
        } else {
          void runScenesAndStore(job.id, characterUrl, job.prefs.gender).catch((err) =>
            logger.error({ err, jobId: job.id }, "rescueStuckSwapping: runScenesAndStore failed"),
          );
        }
      }
      logger.warn(
        { jobId: job.id, stage: "swapping_scenes", stuckAttempts, redriven: !!characterUrl },
        "stuck swapping_scenes job re-driven for one safe retry",
      );
      logStageTransition({
        jobId: job.id,
        clientId: job.clientId,
        fromStage: "swapping_scenes",
        toStage: "swapping_scenes",
        retryCount: stuckAttempts,
        errorCode: "PROVIDER_TIMEOUT",
        errorMessage: "scene fan-out wedged: nudged for one safe retry",
      });
      continue;
    }
    await failJob(
      job.id,
      "PROVIDER_TIMEOUT",
      `Scene fan-out wedged (threshold=${maxAgeMs}ms, stuckAttempts=${stuckAttempts})`,
      null,
    );
    logStageTransition({
      jobId: job.id,
      clientId: job.clientId,
      fromStage: "swapping_scenes",
      toStage: "failed",
      retryCount: stuckAttempts,
      errorCode: "PROVIDER_TIMEOUT",
      errorMessage: "scene fan-out wedged after one safe retry",
    });
  }
}

async function finalizeJob(job: AiInfluencerJob): Promise<void> {
  // Re-load so we see any state written by a previous (partially-completed)
  // finalize attempt: completedAt, influencerId, emailSentAt.
  const fresh = (await loadJob(job.id)) ?? job;
  const baseAvatar = fresh.enhancedImageUrl ?? fresh.baseImageUrl;
  if (!baseAvatar) {
    // No portrait at all — the pipeline never produced output. Mark failed
    // so the user is unblocked instead of left spinning.
    await failJob(fresh.id, "EMPTY_OUTPUT", "Pipeline produced no portrait", null);
    return;
  }

  // Bounded finalize attempts. If we keep failing finalize, eventually
  // mark the job failed instead of looping forever (which would also
  // keep retrying the email send and burn Resend quota). withBackoff
  // stamps next_attempt_at so the candidate gates above pace retries.
  const attempts = await bumpRetry(fresh.id, "finalize", { withBackoff: true });
  await db
    .update(aiInfluencerJobsTable)
    .set({ finalizeAttempts: sql`${aiInfluencerJobsTable.finalizeAttempts} + 1`, heartbeatAt: new Date() })
    .where(eq(aiInfluencerJobsTable.id, fresh.id));
  if (attempts > RETRY_CAPS.finalize) {
    await failJob(fresh.id, "DELIVERY_FAILURE", `Finalize exhausted (${attempts} attempts)`);
    return;
  }

  // Step 1 (idempotent): persist the influencer + scenes. The completedAt
  // column doubles as the influencer-creation lock — only the first
  // attempt that flips it from NULL inserts the influencer row. Subsequent
  // attempts (replay after a notification/email failure) reuse the
  // existing influencer by stable lookup name.
  const claimed = await db
    .update(aiInfluencerJobsTable)
    .set({ completedAt: new Date(), heartbeatAt: new Date() })
    .where(and(eq(aiInfluencerJobsTable.id, fresh.id), isNull(aiInfluencerJobsTable.completedAt)))
    .returning({ id: aiInfluencerJobsTable.id });

  let influencerId = fresh.influencerId;
  // Best-effort: even when the influencer was pre-created at job creation
  // time (status='building', avatar_url=null), make sure we still resolve
  // its id so the workspace hydration step below can populate Main Image,
  // Angles, and Settings.
  if (!influencerId) {
    const existing = await db
      .select({ id: aiInfluencersTable.id })
      .from(aiInfluencersTable)
      .where(
        and(
          eq(aiInfluencersTable.clientId, fresh.clientId),
          eq(aiInfluencersTable.name, `Influencer ${fresh.id}`),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      influencerId = existing[0].id;
    } else {
      // No existing influencer. Attempt creation regardless of whether
      // we won the completedAt claim on this attempt: a previous attempt
      // may have set completedAt then crashed before insert, and we
      // must still create the influencer or status will never reach
      // ready. Influencer creation is wrapped in a transaction so a
      // crash mid-insert rolls back the influencer + scenes pair.
      influencerId = await db.transaction(async (tx) => {
        // Insert-on-conflict against the unique partial index
        // ai_influencers_client_autoname_uq (client_id, name) to make
        // concurrent finalize replays duplicate-safe. If another worker
        // inserted first, returning() yields no row and we re-select.
        // Raw SQL so ON CONFLICT can target the partial unique index
        // ai_influencers_client_autoname_uq, whose WHERE predicate must
        // be repeated here for postgres to match the index.
        const insertedRows = await tx.execute<{
          id: number;
          client_id: number;
          name: string;
        }>(sql`
          insert into ${aiInfluencersTable}
            (client_id, name, gender, age_range, avatar_url, status)
          values (
            ${fresh.clientId},
            ${`Influencer ${fresh.id}`},
            ${fresh.prefs.gender ?? null},
            ${fresh.prefs.ageRange ?? null},
            ${baseAvatar},
            'active'
          )
          on conflict (client_id, name) where name like 'Influencer %'
          do nothing
          returning id
        `);
        const insertedId = (insertedRows.rows ?? insertedRows)[0]?.id as number | undefined;
        let influencer: { id: number } | undefined = insertedId
          ? { id: insertedId }
          : undefined;
        if (!influencer) {
          const [existing] = await tx
            .select()
            .from(aiInfluencersTable)
            .where(
              and(
                eq(aiInfluencersTable.clientId, fresh.clientId),
                eq(aiInfluencersTable.name, `Influencer ${fresh.id}`),
              ),
            )
            .limit(1);
          influencer = existing;
          // Lost the race — the other worker is responsible for the
          // settings + scene images insert. Skip ours to avoid duplicates.
          return influencer?.id ?? null;
        }
        if ((fresh.sceneImageUrls?.length ?? 0) > 0) {
          const [setting] = await tx
            .insert(influencerSettingsTable)
            .values({
              influencerId: influencer.id,
              name: "Scenes",
              description: "Generated by the free AI influencer pipeline.",
              sortOrder: 0,
            })
            .returning();
          if (setting) {
            await tx.insert(settingImagesTable).values(
              fresh.sceneImageUrls.map((s, i) => ({
                settingId: setting.id,
                imageUrl: s.url,
                label: s.label,
                sortOrder: i,
              })),
            );
          }
        }
        return influencer.id;
      });
      // Stamp influencerId on the job so future replays short-circuit
      // the lookup. We do NOT flip status to ready here — that happens
      // only after notification + email succeed below.
      if (influencerId) {
        await db
          .update(aiInfluencerJobsTable)
          .set({ influencerId, heartbeatAt: new Date() })
          .where(eq(aiInfluencerJobsTable.id, fresh.id));
      }
    }
  }

  // Identity workspace hydration: now that we have a stable influencerId
  // (whether pre-created at job creation time or freshly inserted above),
  // populate Main Image, Angles, and Settings. Idempotent — safe on replay.
  if (influencerId) {
    try {
      await hydrateIdentityWorkspace(influencerId, baseAvatar, fresh.prefs);
    } catch (err) {
      // HARD GATE: hydrate threw because angles/settings are incomplete
      // (or compose threw). Do NOT proceed to flip status. Return so the
      // job stays at swapping_scenes and the next finalize replay re-runs
      // hydrate, which is now per-category-aware and only repairs the
      // missing categories.
      logger.warn(
        { err, jobId: fresh.id, influencerId },
        "finalizeJob: hydrate gate failed - leaving job at swapping_scenes for replay",
      );
      return;
    }
  }

  // Step 2 (idempotent): notification + email. Both are gated on their
  // own dedicated columns (notifiedAt, emailSentAt) so a partial failure
  // can be replayed without duplicating either.
  const jobForNotify: AiInfluencerJob = { ...fresh, influencerId: influencerId ?? null };
  const delivery = await sendReadyNotification(jobForNotify);

  // Step 3: only flip status to "ready" once delivery is durable. If the
  // user has no email configured, "delivered" means notification-only.
  // If email is required and the cap is hit without success, mark the
  // job failed with DELIVERY_FAILURE so the user is not left in a
  // half-finalized state.
  if (delivery.emailDurable) {
    // Slice A: degradation detection.
    // The pipeline's success boundary is the base portrait. Any salvageable
    // path that delivered a usable influencer is success. We mark the job
    // ready_degraded (terminal, NOT failed) when any of these hold:
    //   - Enhancor was skipped (enhanced URL falls back to base)
    //   - any scene exhausted its retry cap (failed-after-cap)
    //   - a known forensic marker is on the job (EMPTY_OUTPUT etc) and
    //     we are still finalizing — meaning we salvaged past it
    //   - the asset count is short of the catalog target
    const sceneStates = (fresh.scenes ?? []) as SceneState[];
    const anySceneFailedHard = sceneStates.some(
      (s) => s.state === "failed" && s.attempts >= RETRY_CAPS.scene,
    );
    const enhancingSkipped =
      !!fresh.enhancedImageUrl &&
      !!fresh.baseImageUrl &&
      fresh.enhancedImageUrl === fresh.baseImageUrl;
    const carriesEnhancorIncident =
      fresh.lastErrorCode === "EMPTY_OUTPUT" ||
      fresh.lastErrorCode === "ENHANCOR_DEGRADED";
    const degraded = anySceneFailedHard || enhancingSkipped || carriesEnhancorIncident;
    const terminalStatus: AiInfluencerJob["status"] = degraded ? "ready_degraded" : "ready";
    const flipped = await setStage(fresh.id, "swapping_scenes", terminalStatus, {
      progress: 100,
      influencerId: influencerId ?? null,
    });
    logStageTransition({
      jobId: fresh.id,
      clientId: fresh.clientId,
      fromStage: "swapping_scenes",
      toStage: terminalStatus,
      assetCount: fresh.sceneImageUrls?.length ?? 0,
      ...computeElapsed(fresh),
      notes: {
        influencerId,
        finalizeAttempts: attempts,
        flipped: !!flipped,
        degraded,
        anySceneFailedHard,
        enhancingSkipped,
        carriesEnhancorIncident,
      },
    });
  } else if (delivery.emailExhausted) {
    await failJob(
      fresh.id,
      "DELIVERY_FAILURE",
      `Email send exhausted after ${RETRY_CAPS.email} attempts (${delivery.lastEmailError ?? "unknown"})`,
      null,
    );
  } else {
    // Email failed but cap not hit — leave the job in swapping_scenes
    // with completedAt + influencerId persisted; the stalledFinalize
    // replay loop in finalizeReadyJobs will retry the email next tick.
    logger.warn(
      { jobId: fresh.id, finalizeAttempts: attempts, lastEmailError: delivery.lastEmailError },
      "finalizeJob: deferring status=ready until email send succeeds",
    );
  }
}

type DeliveryResult = {
  // True when the delivery is durable: either email was sent successfully,
  // or the user has no email configured (notification-only is the contract).
  emailDurable: boolean;
  // True when the email retry cap is hit without success — caller should
  // mark the job DELIVERY_FAILURE.
  emailExhausted: boolean;
  lastEmailError?: string | null;
};

async function sendReadyNotification(job: AiInfluencerJob): Promise<DeliveryResult> {
  // Atomic notify claim wrapped in a transaction: if the
  // portal_notifications insert fails, the notifiedAt write rolls back
  // too, so a replay can re-attempt and the user is never silently
  // skipped. Outside-tx, the unique-by-(jobId, type) effect comes from
  // the notifiedAt column gating the claim.
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(aiInfluencerJobsTable)
      .set({ notifiedAt: new Date() })
      .where(and(eq(aiInfluencerJobsTable.id, job.id), isNull(aiInfluencerJobsTable.notifiedAt)))
      .returning({ id: aiInfluencerJobsTable.id });
    if (claimed.length === 0) return; // already notified on a prior attempt
    const href = job.influencerId ? `/influencer/${job.influencerId}` : "/your-influencers";
    await tx.insert(portalNotificationsTable).values({
      clientId: job.clientId,
      type: "influencer_ready",
      title: "Your AI influencer is ready",
      body: "Our team finished building your AI influencer. Tap to open the workspace.",
      payload: { jobId: job.id, influencerId: job.influencerId },
      href,
    });
  });

  // Email gate: re-load the row so we see emailSentAt set by a previous
  // attempt (the in-memory `job` snapshot would still show null).
  const fresh = await loadJob(job.id);
  if (fresh?.emailSentAt) return { emailDurable: true, emailExhausted: false };
  const emailAttempts = await getRetry(job.id, "email");
  if (emailAttempts >= RETRY_CAPS.email) {
    logger.warn({ jobId: job.id, emailAttempts }, "email retry cap hit; not sending");
    return { emailDurable: false, emailExhausted: true, lastEmailError: fresh?.lastErrorMessage ?? null };
  }

  const href = (fresh?.influencerId ?? job.influencerId)
    ? `/influencer/${fresh?.influencerId ?? job.influencerId}`
    : "/your-influencers";

  // Look up the buyer email so the Resend message can land in their inbox.
  const [user] = await db
    .select({ email: appUsers.email, name: appUsers.name })
    .from(appUsers)
    .where(eq(appUsers.id, job.clientId))
    .limit(1);

  // No-email contract: if the user has no email on file, the in-app
  // notification is the entire delivery, so we report durable.
  if (!user?.email) {
    return { emailDurable: true, emailExhausted: false };
  }

  const base = publicBaseUrl();
  const ctaUrl = base ? `${base}/members${href}` : href;
  const firstName = user.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const text = [
    greeting,
    "",
    "Your AI influencer is ready inside your members portal.",
    "Our team finished the portrait, refined the skin, and placed your influencer into 10 real-world scenes you can use as launch content.",
    "",
    `Open the workspace here: ${ctaUrl}`,
    "",
    "- The AI Influencer Portfolio team",
  ].join("\n");

  const newEmailAttempts = await bumpRetry(job.id, "email", { withBackoff: true });
  const sent = await sendEmail({
    userId: job.clientId,
    email: user.email,
    subject: "Your AI influencer is ready",
    body: text,
    bodyHtml: `
      <p>${escapeHtml(greeting)}</p>
      <p>Your AI influencer is ready inside your members portal.</p>
      <p>Our team finished the portrait, refined the skin, and placed your influencer into 10 real-world scenes you can use as launch content.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#C9A44C;color:#000;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;font-size:13px;">
          Open The Workspace
        </a>
      </p>
      <p style="color:#999;font-size:13px;">- The AI Influencer Portfolio team</p>
    `,
    templateType: "influencer_ready",
    metadata: { jobId: job.id, influencerId: fresh?.influencerId ?? job.influencerId },
  });
  // Stamp emailSentAt only on a successful send; this is what makes
  // the email gate idempotent across replays. The caller (finalizeJob)
  // uses emailDurable to decide whether to flip status to "ready".
  if (sent.status === "sent") {
    await db
      .update(aiInfluencerJobsTable)
      .set({ emailSentAt: new Date() })
      .where(eq(aiInfluencerJobsTable.id, job.id));
    return { emailDurable: true, emailExhausted: false };
  }
  await persistError(
    job.id,
    { code: "DELIVERY_FAILURE", message: sent.error ?? "email send failed" },
    { messageId: sent.messageId, status: sent.status },
  );
  return {
    emailDurable: false,
    emailExhausted: newEmailAttempts >= RETRY_CAPS.email,
    lastEmailError: sent.error ?? "email send failed",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE B — Child scene-job worker tick.
//
// Replaces the inline runScenesAndStore -> runSceneSwaps fan-out for jobs
// that have child rows in ai_influencer_scene_jobs. Each tick:
//
//   1. releaseExpiredLeases()       — sweeper for crashed-worker leases.
//   2. claimSceneJobs(workerId, N)  — atomic CAS UPDATE that flips up to
//                                     N eligible (queued/retrying with
//                                     elapsed backoff) rows into
//                                     'generating' under our lease.
//   3. for each claim: invoke the existing single-scene engine via
//      runSceneSwaps(parent.id, characterUrl, { onlyIdx }), then read
//      back the inline scenes[idx] outcome and mirror it onto the
//      child row (completed | retrying | failed-after-cap).
//
// Why delegate to runSceneSwaps instead of duplicating the engine?
// runSceneSwaps already owns prompt building, the QA gate (T006),
// strict-prompt retry, dimension sniffing, cost recording, and dual
// upload — all of which we want to KEEP unchanged. The child row is
// the orchestration / leasing / forensics layer; the engine stays
// the work layer. This is the salvage-first, "incremental evolution
// not a rewrite" posture from the spec.
// ─────────────────────────────────────────────────────────────────────────────

const SCENE_TICK_MAX_FAILS_BEFORE_TERMINAL = RETRY_CAPS.scene + 1;

export async function runSceneJobsTick(workerId: string): Promise<{
  released: number;
  claimed: number;
  completed: number;
  failed: number;
}> {
  const released = await releaseExpiredLeases();
  const claims = await claimSceneJobs(workerId, SCENE_JOB_BATCH);
  let completed = 0;
  let failed = 0;
  if (claims.length === 0) return { released, claimed: 0, completed, failed };

  // Group by parent so we only loadJob() once per parent in this batch.
  const byParent = new Map<number, typeof claims>();
  for (const c of claims) {
    const arr = byParent.get(c.parentJobId) ?? [];
    arr.push(c);
    byParent.set(c.parentJobId, arr);
  }

  for (const [parentJobId, rows] of byParent) {
    const parent = await loadJob(parentJobId);
    if (!parent) {
      // Parent vanished (cascade-deleted). Mark these terminal so the
      // sweeper does not keep claiming them.
      for (const r of rows) {
        await markSceneJobFailed(
          r.id,
          { code: "CONFIG_MISSING", message: "parent job not found" },
          { isFinal: true },
        );
        failed++;
      }
      continue;
    }
    if (parent.status !== "swapping_scenes") {
      // Parent already moved on (failed or finalized). Treat unfinished
      // children as terminal to unblock aggregation.
      for (const r of rows) {
        await markSceneJobFailed(
          r.id,
          {
            code: "CONFIG_MISSING",
            message: `parent in stage=${parent.status}, dropping scene work`,
          },
          { isFinal: true },
        );
        failed++;
      }
      continue;
    }
    const characterUrl = parent.enhancedImageUrl ?? parent.baseImageUrl;
    if (!characterUrl) {
      for (const r of rows) {
        await markSceneJobFailed(
          r.id,
          { code: "CONFIG_MISSING", message: "no character image on parent" },
          { isFinal: true },
        );
        failed++;
      }
      continue;
    }

    for (const row of rows) {
      const sceneIdx = row.sceneIndex;
      try {
        // Delegate the actual scene generation (prompt + Gemini + QA +
        // upload + cost recording + dim sniffing) to the existing
        // single-scene engine. It writes the outcome onto the parent's
        // inline scenes[idx]; we read that back to decide the child
        // row's terminal state.
        await runSceneSwaps(parent.id, characterUrl, { onlyIdx: sceneIdx });
        const refreshed = await loadJob(parent.id);
        const inline = ((refreshed?.scenes ?? []) as SceneState[])[sceneIdx];
        if (inline?.state === "completed" && inline.imageUrl) {
          await markSceneJobCompleted(row.id, {
            generatedAssetUrl: inline.imageUrl,
            metadata: {
              attempts: inline.attempts,
              qaWarning: inline.qaWarning ?? false,
              lastGeminiMs: inline.lastGeminiMs ?? null,
              lastOutputBytes: inline.lastOutputBytes ?? null,
            },
          });
          completed++;
          await touchHeartbeat(parent.id);
        } else if (
          inline?.state === "failed" &&
          inline.attempts >= SCENE_TICK_MAX_FAILS_BEFORE_TERMINAL
        ) {
          // Inline engine ran out of inline retries. Terminal on the
          // child row so finalize aggregation can proceed.
          await markSceneJobFailed(
            row.id,
            {
              code: (inline.lastErrorCode as InfluencerErrorCode) ?? "SCENE_SWAP_FAILURE",
              message: `scene retry cap exhausted (inline attempts=${inline.attempts})`,
              payload: truncatePayload({ inline }),
            },
            { isFinal: true },
          );
          failed++;
          await touchHeartbeat(parent.id);
        } else {
          // Engine reported a failure but not yet terminal. Bump the
          // child attempt counter; isFinal=true once we've burned the
          // child-side retry budget too. Lease released; backoff
          // applied so the next tick honors it.
          const willBeFinal =
            row.attemptCount + 1 >= SCENE_TICK_MAX_FAILS_BEFORE_TERMINAL;
          await markSceneJobFailed(
            row.id,
            {
              code: (inline?.lastErrorCode as InfluencerErrorCode) ?? "SCENE_SWAP_FAILURE",
              message: inline?.lastRetryReason ?? "scene attempt did not complete",
              payload: truncatePayload({ inline: inline ?? null }),
            },
            { isFinal: willBeFinal },
          );
          if (willBeFinal) failed++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const willBeFinal =
          row.attemptCount + 1 >= SCENE_TICK_MAX_FAILS_BEFORE_TERMINAL;
        logger.error(
          { err, parentJobId, sceneIdx, sceneJobId: row.id, willBeFinal },
          "runSceneJobsTick: scene engine threw",
        );
        await markSceneJobFailed(
          row.id,
          {
            code: "SCENE_SWAP_FAILURE",
            message,
            payload: truncatePayload({ thrown: message }),
          },
          { isFinal: willBeFinal },
        );
        if (willBeFinal) failed++;
      }
    }
  }
  return { released, claimed: claims.length, completed, failed };
}

// Re-export so admin/diagnostics callers can attach the influencer id
// onto child rows once the parent finalize materializes the influencer.
export { attachInfluencerIdToChildren };
