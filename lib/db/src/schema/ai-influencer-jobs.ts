import { pgTable, text, serial, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { aiInfluencersTable } from "./influencers";

// ─────────────────────────────────────────────────────────────────────────────
// ai_influencer_jobs
// One row per "Generate Free Influencer" submission. Tracks the async
// pipeline: Higgsfield base avatar -> Enhancor skin enhancement -> Nano Banana
// scene swaps for ~10 random scenes from the catalog. Final fan-out images
// land in scene_image_urls. The job completes once eta_at has elapsed AND all
// pipeline steps have succeeded; we bias the "feels manual" delay between
// 28 min and 150 min so the buyer perceives human craftsmanship.
// ─────────────────────────────────────────────────────────────────────────────
export const aiInfluencerJobsTable = pgTable(
  "ai_influencer_jobs",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // Linked once we materialize the influencer record (created at completion).
    influencerId: integer("influencer_id").references(() => aiInfluencersTable.id, { onDelete: "set null" }),
    // User-supplied preferences captured by the Generate modal.
    prefs: jsonb("prefs")
      .$type<{
        ageRange: string;
        ethnicity: string;
        gender: string;
        vibe: string;
        notes?: string | null;
        // Character profile inferred at enqueue time and persisted as the
        // canonical brief for every downstream prompt (master portrait,
        // scene placements, vision QA). Stored opaquely as JSON to avoid
        // a cross-package type import; the api-server side reads it via
        // `readOrInferProfile` (lib/influencer-character.ts) which falls
        // back to fresh inference for legacy rows that predate the field.
        characterProfile?: Record<string, unknown>;
      }>()
      .notNull(),
    // Lifecycle: queued -> generating_base -> enhancing -> swapping_scenes -> ready -> failed
    // queued: row exists, worker has not picked it up yet.
    // generating_base: Higgsfield call in flight.
    // enhancing: Enhancor webhook pending.
    // swapping_scenes: scene swaps in progress.
    // ready: all images persisted, eta_at reached, influencer materialized,
    //        notification queued + email sent.
    // failed: terminal; failureReason populated.
    status: text("status").notNull().default("queued"),
    // Step-level progress 0..100, surfaced in the portal status card.
    progress: integer("progress").notNull().default(0),
    // The final base portrait (post-enhancement) and intermediate URLs.
    baseImageUrl: text("base_image_url"),
    enhancedImageUrl: text("enhanced_image_url"),
    // Array of fan-out scenes: [{ url, label }]. Filled as scene swaps complete.
    sceneImageUrls: jsonb("scene_image_urls")
      .$type<Array<{ url: string; label: string }>>()
      .notNull()
      .default([]),
    // Manual-feel delay: do not surface "ready" before this timestamp even if
    // pipeline finishes early. Set on insert to now()+rand(28..150 min).
    etaAt: timestamp("eta_at", { withTimezone: true }).notNull(),
    // Free-tier marker. The first ai_influencer_job per client is free; any
    // subsequent attempt must be gated behind a paid upgrade by the route
    // handler (returns 402).
    isFreeTier: boolean("is_free_tier").notNull().default(true),
    // Webhook bookkeeping for Higgsfield (base avatar) and Enhancor (skin
    // refinement). Stored so a webhook can match the inbound payload back to
    // the right job, and so an admin can replay a stuck job by id.
    higgsfieldJobId: text("higgsfield_job_id"),
    enhancorJobId: text("enhancor_job_id"),
    failureReason: text("failure_reason"),
    // Task #250: normalized error code (e.g. PROVIDER_TIMEOUT, RATE_LIMIT,
    // SCENE_SWAP_FAILURE). Persisted at the call site whenever a provider
    // call fails so the diagnostics endpoint and admin grep have a stable
    // taxonomy instead of free-form `failureReason` strings.
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    // Truncated provider response snippet (first ~500 chars of the body or
    // SDK error). Stored verbatim for admin debugging; never shown to end
    // users.
    lastErrorPayload: jsonb("last_error_payload").$type<unknown>(),
    // Per-scene state machine. One entry per scene picked for the job
    // (typically 10). Drives partial retries: a failed scene retries on
    // its own without restarting earlier stages, and finalize waits for
    // every required scene to reach `completed` (or hit the retry cap).
    scenes: jsonb("scenes")
      .$type<Array<{
        idx: number;
        sceneId: number | null;
        label: string;
        state: "pending" | "processing" | "completed" | "failed";
        attempts: number;
        imageUrl: string | null;
        lastErrorCode: string | null;
        lastErrorAt: string | null;
        // Earliest wall-clock time at which this scene is eligible to
        // be re-attempted. Set on failure to (now + exponential backoff).
        // Null means "ready immediately". Honored by runSceneSwaps and by
        // resumeStuckScenes when picking the per-tick worklist.
        nextAttemptAt: string | null;
        // Task #261 follow-up — per-scene Gemini telemetry. All optional
        // so legacy rows without these fields keep working. Populated
        // by runSceneSwaps after every attempt; the bounded
        // `attemptHistory` ring keeps the last 10 attempts so admins
        // can do drift / latency / retry forensics without flooding
        // the row.
        lastDispatchAt?: string | null;
        lastCompletedAt?: string | null;
        lastGeminiMs?: number | null;
        lastQueueWaitMs?: number | null;
        lastOutputBytes?: number | null;
        lastOutputWidth?: number | null;
        lastOutputHeight?: number | null;
        lastRetryReason?: string | null;
        attemptHistory?: Array<{
          attemptNumber: number;
          dispatchedAt: string;
          completedAt: string | null;
          geminiMs: number | null;
          queueWaitMs: number | null;
          outputBytes: number | null;
          outputWidth: number | null;
          outputHeight: number | null;
          retryReason: string | null;
          ok: boolean;
        }>;
        // ── Cinematic refactor (T002-T007) ────────────────────────────
        // Code-first scene template id. When set, this scene was picked
        // from `lib/influencer-scenes-library` (no Drive image; the
        // master portrait alone is the Gemini input and the placement
        // prompt below describes the new environment). Either templateId
        // OR sceneId is populated for any given scene; legacy rows have
        // only sceneId.
        templateId?: string | null;
        // Cached scene placement prompt (built at seed time so the
        // worker tick does not have to re-derive it per attempt).
        prompt?: string | null;
        // Vision QA result for this scene placement, if scored.
        qa?: {
          identitySimilarity: number;
          realism: number;
          sceneFit: number;
          anatomy: number;
          overall: number;
          verdict: "pass" | "warn" | "reject";
          notes: string;
          retried?: boolean;
        } | null;
        // True when the scene shipped despite a non-passing QA verdict
        // (cap exhausted on QA-driven retries — we keep the best result
        // rather than fail the whole job for one weak placement).
        qaWarning?: boolean;
      }>>()
      .notNull()
      .default([]),
    // Per-stage retry counter map. Bounded by RETRY_CAPS in the pipeline.
    // Keys: higgsfield, enhancor, finalize, email. Scene retries live on
    // the scene entry above.
    retries: jsonb("retries")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    // Bounded ring of recent webhook payloads (most recent last, capped
    // at WEBHOOK_EVENT_HISTORY_LIMIT entries). Used by the diagnostics
    // endpoint and by webhook idempotency checks.
    webhookEvents: jsonb("webhook_events")
      .$type<Array<{
        provider: string;
        receivedAt: string;
        providerJobId: string | null;
        signatureMode: "verified" | "unsigned";
        // True only after the callback was successfully applied to the
        // job state (e.g., onHiggsfieldResult / onEnhancorResult ran
        // without throwing). Idempotency dedupe matches against
        // processed=true entries only, so a malformed first callback
        // does not poison the providerJobId for a later valid retry.
        processed: boolean;
        body: unknown;
      }>>()
      .notNull()
      .default([]),
    // Timestamp of the last status flip. Used together with heartbeatAt
    // to distinguish "actively progressing" from "wedged" so the stuck-job
    // sweeper does not kill jobs that are still doing work.
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    // Bounded counter for finalize attempts. Lets us cap the number of
    // times we try to materialize the influencer + send the email before
    // failing the job.
    finalizeAttempts: integer("finalize_attempts").notNull().default(0),
    // Earliest wall-clock time at which the next stage-level retry is
    // eligible (Higgsfield dispatch, Enhancor dispatch, finalize, email).
    // Set on each failed attempt to (now + exponential backoff capped at
    // 10 minutes). Null means "ready immediately". Gates candidate
    // queries in advanceQueuedJobs and finalizeReadyJobs so retries do
    // not stampede the providers on every 30s worker tick.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // Set once the Resend send succeeds so a re-finalize never fires a
    // duplicate email.
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    // Task #695: super-admin manual intervention from the
    // /admin/influencer-generations console. Populated when an admin
    // marks a wedged job failed OR force-finalizes it for the buyer.
    manuallyDeliveredByClerkId: text("manually_delivered_by_clerk_id"),
    manuallyDeliveredAt: timestamp("manually_delivered_at", { withTimezone: true }),
    // Task #701: dedupe stamp for the #ops Slack "stuck job" alert.
    // Claimed (UPDATE ... WHERE stuck_alert_sent_at IS NULL RETURNING)
    // before the Slack POST so a finalize re-entry on the next tick
    // can never re-fire the same alert.
    stuckAlertSentAt: timestamp("stuck_alert_sent_at", { withTimezone: true }),
    // Dedupe stamp for the "overdue delivery" re-alert sent to the team
    // when a job has sat undelivered past its 24h promise window (external
    // Viktor-delivery model). Claimed (UPDATE ... WHERE overdue_alerted_at
    // IS NULL RETURNING) before the Slack POST so the watchdog can never
    // re-fire the same 24h re-alert on a later tick. Distinct from
    // stuckAlertSentAt, which is the internal-pipeline #ops stuck alert.
    overdueAlertedAt: timestamp("overdue_alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("ai_influencer_jobs_client_idx").on(table.clientId),
    statusEtaIdx: index("ai_influencer_jobs_status_eta_idx").on(table.status, table.etaAt),
    // Task #283 dropped the partial unique index that enforced "1 free
    // per client" - Upsell 2 buyers now get up to 6 free-tier rows. The
    // quota is enforced in the route handler (resolveInfluencerQuota).
  }),
);

export type AiInfluencerJob = typeof aiInfluencerJobsTable.$inferSelect;
export type InsertAiInfluencerJob = typeof aiInfluencerJobsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// ai_influencer_scenes
// Catalog of ~100 background scene photos synced from the Drive folder. A new
// influencer job picks 10 at random (filtered by gender hint when present)
// and runs character-swap on each via Nano Banana / Gemini.
// ─────────────────────────────────────────────────────────────────────────────
export const aiInfluencerScenesTable = pgTable(
  "ai_influencer_scenes",
  {
    id: serial("id").primaryKey(),
    // Stable origin id. For Drive-synced scenes this is the Drive file id;
    // for admin-zip uploads we synthesize `upload:<sha256>` so re-uploading
    // the same byte sequence is idempotent. Nullable kept off to preserve
    // the original Drive UNIQUE constraint - admin uploads always supply
    // their synthesized id.
    driveFileId: text("drive_file_id").notNull().unique(),
    label: text("label"),
    // Optional gender hint inferred from filename or folder. "any" matches both.
    genderHint: text("gender_hint").notNull().default("any"),
    // Public URL inside our object storage bucket so the worker can pass it
    // to Gemini as an inline_data input.
    gcsUrl: text("gcs_url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // Where this row came from. "drive" for syncDriveScenes() and "admin-zip"
    // for the admin bulk uploader. Lets us list / filter / re-import per
    // source without colliding.
    source: text("source").notNull().default("drive"),
    // Folder name from the uploaded zip (e.g. "Interview & Panel"). Used by
    // the admin console to group the scene library and by the pipeline to
    // bias picks by category when needed. Nullable for legacy Drive rows.
    category: text("category"),
    // Original filename inside the zip (before we rename to a UUID for GCS).
    // Lets the admin tell two near-identical scenes apart in the list.
    originalFilename: text("original_filename"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    enabledGenderIdx: index("ai_influencer_scenes_enabled_gender_idx").on(table.enabled, table.genderHint),
    sourceCategoryIdx: index("ai_influencer_scenes_source_category_idx").on(table.source, table.category),
  }),
);

export type AiInfluencerScene = typeof aiInfluencerScenesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// portal_notifications
// In-portal toast queue. Polled every ~60s by the portal layout. Distinct
// from email_logs (Resend) so we can show a notification without depending
// on inbox delivery, and so admins can replay events from the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export const portalNotificationsTable = pgTable(
  "portal_notifications",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    // e.g. "influencer_ready"
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Free-form context (e.g. { jobId, influencerId }).
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // Optional deep-link the toast can route to.
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientUnreadIdx: index("portal_notifications_client_unread_idx").on(table.clientId, table.readAt),
  }),
);

export type PortalNotification = typeof portalNotificationsTable.$inferSelect;
export type InsertPortalNotification = typeof portalNotificationsTable.$inferInsert;
