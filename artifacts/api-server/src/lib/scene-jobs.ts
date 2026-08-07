// ─────────────────────────────────────────────────────────────────────────────
// Slice B — child scene job orchestration primitives.
//
// One row in ai_influencer_scene_jobs per scene generation slot. This
// module owns the CAS claim/lease primitives, retry accounting, and
// parent-aggregation read so finalize can decide ready vs ready_degraded.
//
// The actual provider call (Gemini Nano Banana + QA gate + upload) is
// NOT duplicated here. Instead, runSceneJobsTick claims a child row and
// delegates to influencer-pipeline.runSceneSwaps with { onlyIdx } so the
// existing single-scene engine (with all its prompt-building, QA, cost
// recording, and dimension sniffing) does the work. After the engine
// returns, this module reads back the inline scenes[idx] state to mirror
// outcome onto the child row.
//
// Why dual-write? Two reasons:
//   1. Slice A's finalize gate already reads the inline scenes[] jsonb;
//      keeping it populated means we don't risk regressing salvage
//      behavior during rollout.
//   2. Some admin tools (regenerateSingleScene) drive runSceneSwaps
//      directly — keeping the engine's persistence story unchanged
//      means those code paths keep working.
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  aiInfluencerJobsTable,
  aiInfluencerSceneJobsTable,
  db,
  type AiInfluencerSceneJob,
} from "@workspace/db";
import { logger } from "./logger";
import {
  INFLUENCER_ERROR_CODES,
  RETRY_CAPS,
  type InfluencerErrorCode,
} from "./influencer-observability";

// Per-scene lease window. Wider than the typical Gemini call (~15-45s
// including QA) but narrow enough that a crashed worker's leases free
// up within a couple of ticks.
export const SCENE_JOB_LEASE_MS = Number(
  process.env.INFLUENCER_SCENE_LEASE_MS ?? 5 * 60_000,
);

// Per-tick claim batch. Bounded so one tick cannot starve other workers.
export const SCENE_JOB_BATCH = Number(
  process.env.INFLUENCER_SCENE_BATCH ?? 4,
);

// Exponential backoff identical to inline path so retry latency is
// predictable across both engines: 30s, 60s, 120s ... capped at 10min.
export function sceneBackoffMs(attemptNumber: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attemptNumber - 1), 600_000);
}

export type SceneJobSeed = {
  sceneIndex: number;
  templateId: string | null;
  label: string;
  prompt: string;
  // Optional Drive-CMS metadata (legacy catalog scenes). Null for code-first.
  folderName?: string | null;
  referenceFileId?: string | null;
  referenceFileName?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Idempotent batch insert. Re-running with the same seeds is a no-op
 * thanks to the (parent_job_id, scene_index) unique index.
 */
export async function seedSceneJobsForParent(
  parentJobId: number,
  seeds: SceneJobSeed[],
): Promise<{ inserted: number }> {
  if (seeds.length === 0) return { inserted: 0 };
  const rows = seeds.map((s) => ({
    parentJobId,
    sceneIndex: s.sceneIndex,
    templateId: s.templateId,
    label: s.label,
    prompt: s.prompt,
    folderName: s.folderName ?? null,
    referenceFileId: s.referenceFileId ?? null,
    referenceFileName: s.referenceFileName ?? null,
    provider: "gemini",
    status: "queued",
    metadata: s.metadata ?? {},
  }));
  const inserted = await db
    .insert(aiInfluencerSceneJobsTable)
    .values(rows)
    .onConflictDoNothing({
      target: [
        aiInfluencerSceneJobsTable.parentJobId,
        aiInfluencerSceneJobsTable.sceneIndex,
      ],
    })
    .returning({ id: aiInfluencerSceneJobsTable.id });
  return { inserted: inserted.length };
}

/**
 * True if Slice B child orchestration is in effect for this parent.
 * Used by the legacy resumeStuckScenes path to bow out gracefully.
 */
export async function hasChildSceneJobs(parentJobId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: aiInfluencerSceneJobsTable.id })
    .from(aiInfluencerSceneJobsTable)
    .where(eq(aiInfluencerSceneJobsTable.parentJobId, parentJobId))
    .limit(1);
  return !!row;
}

/**
 * Atomic CAS claim. Returns up to `batch` rows that were either queued
 * or whose previous lease expired. The leased_by stamp is the worker
 * id; lease_expires_at = now() + SCENE_JOB_LEASE_MS.
 *
 * The returned rows are safe to process — concurrent workers cannot
 * claim the same row because the WHERE clause checks the lease window
 * inside the UPDATE itself.
 */
export async function claimSceneJobs(
  workerId: string,
  batch: number = SCENE_JOB_BATCH,
): Promise<AiInfluencerSceneJob[]> {
  // Two-step CAS using a CTE: pick eligible candidates with FOR UPDATE
  // SKIP LOCKED so concurrent claimers don't queue on the same rows,
  // then UPDATE only those ids. Returns the freshly-leased rows.
  const leaseExpiresAt = new Date(Date.now() + SCENE_JOB_LEASE_MS);
  const stageStartedAt = new Date();
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM ai_influencer_scene_jobs
       WHERE status IN ('queued', 'retrying')
         AND (lease_expires_at IS NULL OR lease_expires_at < now())
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY id ASC
       LIMIT ${batch}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE ai_influencer_scene_jobs AS s
       SET status = 'generating',
           leased_by = ${workerId},
           lease_expires_at = ${leaseExpiresAt},
           stage_started_at = COALESCE(s.stage_started_at, ${stageStartedAt}),
           updated_at = now()
      FROM candidates
     WHERE s.id = candidates.id
    RETURNING s.*
  `);
  // drizzle's execute returns { rows } for raw queries.
  type RawRow = Record<string, unknown>;
  const rows = (result as { rows: RawRow[] }).rows ?? [];
  return rows.map(rawRowToSceneJob);
}

/** Extend the lease window mid-call. Callers should invoke this every
 * minute or so during long Gemini calls so the sweeper does not
 * reclaim a still-live lease. */
export async function extendLease(
  sceneJobId: number,
  workerId: string,
  leaseMs: number = SCENE_JOB_LEASE_MS,
): Promise<boolean> {
  const newExpiry = new Date(Date.now() + leaseMs);
  const updated = await db
    .update(aiInfluencerSceneJobsTable)
    .set({ leaseExpiresAt: newExpiry, updatedAt: new Date() })
    .where(
      and(
        eq(aiInfluencerSceneJobsTable.id, sceneJobId),
        eq(aiInfluencerSceneJobsTable.leasedBy, workerId),
      ),
    )
    .returning({ id: aiInfluencerSceneJobsTable.id });
  return updated.length > 0;
}

export async function markSceneJobCompleted(
  sceneJobId: number,
  fields: {
    generatedAssetUrl: string;
    providerJobId?: string | null;
    providerPayloadRaw?: unknown;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(aiInfluencerSceneJobsTable)
    .set({
      status: "completed",
      progress: 100,
      generatedAssetUrl: fields.generatedAssetUrl,
      providerJobId: fields.providerJobId ?? null,
      providerPayloadRaw: fields.providerPayloadRaw ?? null,
      metadata: fields.metadata ?? undefined,
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorPayload: null,
      leasedBy: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(eq(aiInfluencerSceneJobsTable.id, sceneJobId));
}

export async function markSceneJobFailed(
  sceneJobId: number,
  err: { code: InfluencerErrorCode; message: string; payload?: unknown },
  opts: { isFinal: boolean },
): Promise<void> {
  // Bump attempt_count atomically; status flips to 'retrying' if cap
  // not yet hit, or 'failed' if the caller declares this terminal.
  const next = opts.isFinal ? "failed" : "retrying";
  // We compute backoff from the post-increment attempt count.
  const [row] = await db
    .select({ attemptCount: aiInfluencerSceneJobsTable.attemptCount })
    .from(aiInfluencerSceneJobsTable)
    .where(eq(aiInfluencerSceneJobsTable.id, sceneJobId))
    .limit(1);
  const newAttempts = (row?.attemptCount ?? 0) + 1;
  const nextAttemptAt = opts.isFinal ? null : new Date(Date.now() + sceneBackoffMs(newAttempts));
  await db
    .update(aiInfluencerSceneJobsTable)
    .set({
      status: next,
      attemptCount: newAttempts,
      retryCount: opts.isFinal ? row?.attemptCount ?? 0 : newAttempts,
      lastErrorCode: err.code,
      lastErrorMessage: err.message,
      lastErrorPayload: err.payload ?? null,
      nextAttemptAt,
      failedAt: opts.isFinal ? new Date() : null,
      // Release the lease so the next tick (or another worker) can
      // pick this row up again after the backoff window.
      leasedBy: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(aiInfluencerSceneJobsTable.id, sceneJobId));
}

/**
 * Sweeper: release leases past their expiry so a crashed worker's
 * claims do not wedge a child row. Called from the worker tick.
 */
export async function releaseExpiredLeases(): Promise<number> {
  const result = await db
    .update(aiInfluencerSceneJobsTable)
    .set({
      leasedBy: null,
      leaseExpiresAt: null,
      // Flip to 'retrying' so the eligibility predicate picks it up
      // on the next claim.
      status: "retrying",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiInfluencerSceneJobsTable.status, "generating"),
        sql`${aiInfluencerSceneJobsTable.leaseExpiresAt} IS NOT NULL`,
        lt(aiInfluencerSceneJobsTable.leaseExpiresAt, new Date()),
      ),
    )
    .returning({ id: aiInfluencerSceneJobsTable.id });
  if (result.length > 0) {
    logger.warn(
      { count: result.length, ids: result.map((r) => r.id) },
      "scene-jobs: released expired leases",
    );
  }
  return result.length;
}

export type SceneAggregate = {
  total: number;
  completed: number;
  failed: number;
  retrying: number;
  queued: number;
  generating: number;
  // Asset urls in scene_index order, ready to mirror into parent's
  // sceneImageUrls jsonb at finalize time.
  completedAssets: Array<{ url: string; label: string; sceneIndex: number }>;
  // Indices that exhausted RETRY_CAPS.scene — used to compose
  // PARTIAL_BATCH_FAILURE forensics.
  failedIndices: number[];
  // True when no row is queued/generating/retrying (under cap with
  // future backoff still counts as "still working"). Finalize gate.
  allTerminal: boolean;
  // True when any row hit cap-exhaustion. Triggers ready_degraded.
  anyFailedHard: boolean;
};

/**
 * Read all child rows for a parent and produce the aggregate the
 * finalize gate cares about. This replaces the inline scenes[] reduce
 * for parents that have child rows seeded.
 */
export async function aggregateForParent(parentJobId: number): Promise<SceneAggregate> {
  const rows = await db
    .select()
    .from(aiInfluencerSceneJobsTable)
    .where(eq(aiInfluencerSceneJobsTable.parentJobId, parentJobId))
    .orderBy(aiInfluencerSceneJobsTable.sceneIndex);
  const agg: SceneAggregate = {
    total: rows.length,
    completed: 0,
    failed: 0,
    retrying: 0,
    queued: 0,
    generating: 0,
    completedAssets: [],
    failedIndices: [],
    allTerminal: true,
    anyFailedHard: false,
  };
  for (const r of rows) {
    switch (r.status) {
      case "completed":
        agg.completed++;
        if (r.generatedAssetUrl) {
          agg.completedAssets.push({
            url: r.generatedAssetUrl,
            label: r.label ?? `Scene ${r.sceneIndex + 1}`,
            sceneIndex: r.sceneIndex,
          });
        }
        break;
      case "failed":
        agg.failed++;
        agg.failedIndices.push(r.sceneIndex);
        agg.anyFailedHard = true;
        break;
      case "retrying":
        agg.retrying++;
        // Retrying counts as still-working only if the row is under cap.
        if (r.attemptCount < RETRY_CAPS.scene + 1) agg.allTerminal = false;
        else {
          // Out-of-cap "retrying" rows are treated as failed-hard so
          // finalize doesn't wait forever for a row that will never
          // be re-attempted. Defensive — releaseExpiredLeases can
          // leave a row in retrying state.
          agg.anyFailedHard = true;
          agg.failedIndices.push(r.sceneIndex);
        }
        break;
      case "queued":
        agg.queued++;
        agg.allTerminal = false;
        break;
      case "generating":
        agg.generating++;
        agg.allTerminal = false;
        break;
      default:
        // Unknown status — be conservative and treat as still-working.
        agg.allTerminal = false;
    }
  }
  agg.completedAssets.sort((a, b) => a.sceneIndex - b.sceneIndex);
  return agg;
}

/**
 * For child rows where the parent has produced a finalized influencer
 * record, stamp the influencer_id onto every child row so per-scene
 * forensic queries can join through.
 */
export async function attachInfluencerIdToChildren(
  parentJobId: number,
  influencerId: number,
): Promise<void> {
  await db
    .update(aiInfluencerSceneJobsTable)
    .set({ influencerId, updatedAt: new Date() })
    .where(
      and(
        eq(aiInfluencerSceneJobsTable.parentJobId, parentJobId),
        isNull(aiInfluencerSceneJobsTable.influencerId),
      ),
    );
}

/** Read a single child row by id. Used by the worker tick. */
export async function loadSceneJob(id: number): Promise<AiInfluencerSceneJob | null> {
  const [row] = await db
    .select()
    .from(aiInfluencerSceneJobsTable)
    .where(eq(aiInfluencerSceneJobsTable.id, id))
    .limit(1);
  return row ?? null;
}

/** Read all child rows for a parent. Useful for admin diagnostics. */
export async function listSceneJobsForParent(
  parentJobId: number,
): Promise<AiInfluencerSceneJob[]> {
  return db
    .select()
    .from(aiInfluencerSceneJobsTable)
    .where(eq(aiInfluencerSceneJobsTable.parentJobId, parentJobId))
    .orderBy(aiInfluencerSceneJobsTable.sceneIndex);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function rawRowToSceneJob(r: Record<string, unknown>): AiInfluencerSceneJob {
  // db.execute(sql\`...\`) returns snake_case columns; drizzle's typed
  // select would camelCase them. Map manually so the rest of the
  // codebase sees the canonical drizzle shape.
  return {
    id: Number(r.id),
    parentJobId: Number(r.parent_job_id),
    influencerId: r.influencer_id == null ? null : Number(r.influencer_id),
    sceneIndex: Number(r.scene_index),
    folderName: (r.folder_name as string | null) ?? null,
    referenceFileId: (r.reference_file_id as string | null) ?? null,
    referenceFileName: (r.reference_file_name as string | null) ?? null,
    templateId: (r.template_id as string | null) ?? null,
    label: (r.label as string | null) ?? null,
    prompt: (r.prompt as string | null) ?? null,
    provider: String(r.provider ?? "gemini"),
    status: String(r.status ?? "queued"),
    progress: Number(r.progress ?? 0),
    attemptCount: Number(r.attempt_count ?? 0),
    retryCount: Number(r.retry_count ?? 0),
    leasedBy: (r.leased_by as string | null) ?? null,
    leaseExpiresAt: r.lease_expires_at ? new Date(r.lease_expires_at as string) : null,
    stageStartedAt: r.stage_started_at ? new Date(r.stage_started_at as string) : null,
    nextAttemptAt: r.next_attempt_at ? new Date(r.next_attempt_at as string) : null,
    completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
    failedAt: r.failed_at ? new Date(r.failed_at as string) : null,
    lastErrorCode: (r.last_error_code as string | null) ?? null,
    lastErrorMessage: (r.last_error_message as string | null) ?? null,
    lastErrorPayload: r.last_error_payload ?? null,
    providerJobId: (r.provider_job_id as string | null) ?? null,
    providerPayloadRaw: r.provider_payload_raw ?? null,
    webhookPayloadRaw: r.webhook_payload_raw ?? null,
    pollPayloadRaw: r.poll_payload_raw ?? null,
    generatedAssetUrl: (r.generated_asset_url as string | null) ?? null,
    generatedAssetPath: (r.generated_asset_path as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

// Re-export the canonical error codes so worker callers don't need a
// second import.
export { INFLUENCER_ERROR_CODES, RETRY_CAPS };
