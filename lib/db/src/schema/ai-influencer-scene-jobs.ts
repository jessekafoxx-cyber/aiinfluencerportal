import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { aiInfluencerJobsTable } from "./ai-influencer-jobs";
import { aiInfluencersTable } from "./influencers";

// ─────────────────────────────────────────────────────────────────────────────
// Slice B — child scene jobs.
//
// Each row owns a single scene generation slot for a parent
// ai_influencer_job. Independent leasing (leased_by + lease_expires_at)
// lets the scene-jobs worker tick claim work without taking a lock on the
// parent row. Independent retry (attempt_count + next_attempt_at) lets
// one wedged scene fail without poisoning siblings or the parent.
//
// Parent's `scenes` jsonb stays populated as a legacy mirror so the
// existing inline finalize gate keeps working for in-flight rollback
// safety; the canonical source of truth for new jobs is this table,
// aggregated by lib/scene-jobs.ts::aggregateForParent.
//
// Status state machine:
//   queued -> generating -> completed
//                       \-> retrying -> generating -> ...
//                       \-> failed (terminal: cap exhausted)
// ─────────────────────────────────────────────────────────────────────────────
export const aiInfluencerSceneJobsTable = pgTable(
  "ai_influencer_scene_jobs",
  {
    id: serial("id").primaryKey(),
    parentJobId: integer("parent_job_id")
      .notNull()
      .references(() => aiInfluencerJobsTable.id, { onDelete: "cascade" }),
    // Set once the parent materializes the influencer record at finalize.
    influencerId: integer("influencer_id").references(() => aiInfluencersTable.id, {
      onDelete: "set null",
    }),
    sceneIndex: integer("scene_index").notNull(),
    // Optional Drive-CMS metadata. Code-first templates leave these null.
    folderName: text("folder_name"),
    referenceFileId: text("reference_file_id"),
    referenceFileName: text("reference_file_name"),
    // Code-first template identifier (preferred for new jobs).
    templateId: text("template_id"),
    label: text("label"),
    // Cached cinematic prompt computed at seed time so worker ticks don't
    // re-derive identity-locking text per attempt.
    prompt: text("prompt"),
    provider: text("provider").notNull().default("gemini"),
    // queued | generating | retrying | completed | failed
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    // Worker lease — opaque worker id + wall-clock expiry. Atomic CAS
    // claim: UPDATE ... WHERE status IN ('queued','retrying') AND
    // (lease_expires_at IS NULL OR lease_expires_at < now()).
    leasedBy: text("leased_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    lastErrorPayload: jsonb("last_error_payload").$type<unknown>(),
    providerJobId: text("provider_job_id"),
    providerPayloadRaw: jsonb("provider_payload_raw").$type<unknown>(),
    webhookPayloadRaw: jsonb("webhook_payload_raw").$type<unknown>(),
    pollPayloadRaw: jsonb("poll_payload_raw").$type<unknown>(),
    generatedAssetUrl: text("generated_asset_url"),
    generatedAssetPath: text("generated_asset_path"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index("ai_influencer_scene_jobs_parent_idx").on(t.parentJobId),
    statusIdx: index("ai_influencer_scene_jobs_status_idx").on(t.status),
    leaseIdx: index("ai_influencer_scene_jobs_lease_idx").on(t.leaseExpiresAt),
    parentSceneUniq: uniqueIndex("ai_influencer_scene_jobs_parent_idx_uniq").on(
      t.parentJobId,
      t.sceneIndex,
    ),
  }),
);

export type AiInfluencerSceneJob = typeof aiInfluencerSceneJobsTable.$inferSelect;
export type NewAiInfluencerSceneJob = typeof aiInfluencerSceneJobsTable.$inferInsert;
