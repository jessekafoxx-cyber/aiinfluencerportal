import { pgTable, serial, integer, text, timestamp, boolean, jsonb, bigserial, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Each entry of mediaItems is an additional image / video that belongs to the
// same ad row (used for Instagram and Facebook carousels). The first entry
// duplicates the primary mediaObjectPath so the modal gallery has a complete
// ordered list and the card preview can show the cover.
export type AdResearchBoardMediaItem = {
  kind: "image" | "video";
  objectPath: string;
  contentType: string;
  // Task #186: cached poster image for video slides (extracted from
  // Apify/yt-dlp metadata or generated locally via ffmpeg). Optional and
  // back-compat with rows persisted before the thumbnail pipeline shipped.
  thumbnailObjectPath?: string | null;
  thumbnailContentType?: string | null;
  // 'extraction' = sharp platform poster URL, 'local-poster' = ffmpeg first-
  // frame fallback. Persisted per-slide so the row-level mediaThumbnailSource
  // (mirrored from the cover slide) is accurate even when the cover slide
  // came from ffmpeg but later slides came from extraction.
  thumbnailSource?: "extraction" | "local-poster" | null;
  // Original platform poster URL we tried to fetch. Persisted so a future
  // backfill can re-attempt the high-quality extraction path before falling
  // back to ffmpeg, instead of being stuck at the local-poster source we
  // produced when the platform URL transiently failed.
  thumbnailSourceUrl?: string | null;
};

// Diagnostics about how a row's media was captured. We persist this so the
// portal can surface "captured X of Y slides" badges, the admin tools can
// triage rows that silently downgraded from a carousel to a single item,
// and a future re-run knows which retry path produced the cached files.
export type AdResearchBoardMediaMeta = {
  isCarousel?: boolean;
  expectedSlides?: number;
  capturedSlides?: number;
  // Apify actor (or "yt-dlp" / "direct") that produced the cached files.
  source?: string | null;
  // "primary" | "residential-proxy" | "secondary-actor" | "single-fallback"
  retryStrategy?: string | null;
  // Original Apify __typename for the post (e.g. XDTGraphSidecar).
  typename?: string | null;
  // Task #187: which authenticated cookie jar (if any) was attached to
  // the live extractor that produced this row. "ig-db-jar" / "fb-db-jar"
  // means the admin-managed session was injected; "env" means the
  // legacy YT_DLP_COOKIES_FILE was used; null means the run was
  // anonymous. Powers the ytDlpAuthenticatedRecoveries counter.
  cookieSource?: "ig-db-jar" | "fb-db-jar" | "env" | null;
  // T210: structured extraction outcome metadata. Surfaced on the
  // admin dashboard so an operator can answer "where did this row's
  // media actually come from, and how many escalation hops did it
  // take?" without re-reading the per-row extraction-trace logs.
  // All fields are optional so back-compat with rows persisted
  // before T210 is preserved.
  //
  //   extractorPath        e.g. "yt-dlp", "apify~instagram-post-scraper",
  //                        "apify~facebook-pages-scraper", "share-resolver".
  //   escalationStage      0 = primary path, 1 = first escalation, 2 =
  //                        residential-proxy escalation, etc.
  //   authAttached         true if an authenticated cookie source was
  //                        injected for this row's terminal call.
  //   residentialUsed      true if the residential-proxy escalation path
  //                        was invoked for this row.
  //   finalRecoveryReason  short label of why the row landed in its
  //                        terminal state (e.g. "yt-dlp-success",
  //                        "apify-escalation-recovered", "auth-wall-
  //                        escalated-failed", "permanent-dismiss-dead").
  //   outcomeCategory      coarse bucket for the dashboard pie chart.
  extractorPath?: string | null;
  escalationStage?: number | null;
  authAttached?: boolean | null;
  residentialUsed?: boolean | null;
  finalRecoveryReason?: string | null;
  outcomeCategory?:
    | "ok-primary"
    | "ok-recovered"
    | "auth-failed"
    | "rate-limited"
    | "extractor-failed"
    | "dead-content"
    | "invalid-input"
    | "unsupported-input"
    | "other-failure"
    | null;
};

export const adResearchBoardItems = pgTable(
  "ad_research_board_items",
  {
    id: serial("id").primaryKey(),
    rowKey: text("row_key").notNull().unique(),
    sortIndex: integer("sort_index").notNull(),
    adLink: text("ad_link").notNull(),
    type: text("type"),
    awarenessStage: text("awareness_stage"),
    style: text("style"),
    notes: text("notes"),
    mediaKind: text("media_kind"),
    mediaObjectPath: text("media_object_path"),
    mediaContentType: text("media_content_type"),
    mediaItems: jsonb("media_items").$type<AdResearchBoardMediaItem[]>(),
    // Task #186: cached poster image for the row's primary video (mirrors the
    // cover slide for carousels). Served via /api/storage so video cards on the
    // Ads tab can render <img> instead of a black <video preload="none"> tile.
    mediaThumbnailObjectPath: text("media_thumbnail_object_path"),
    mediaThumbnailContentType: text("media_thumbnail_content_type"),
    // 'extraction' (Apify/yt-dlp metadata thumb) | 'local-poster' (ffmpeg) - lets
    // ops know which path produced the cached thumbnail and run a backfill that
    // skips rows already covered by the higher-quality extraction source.
    mediaThumbnailSource: text("media_thumbnail_source"),
    // Original platform poster URL we tried to fetch (mirrors cover slide).
    // Persisted so the admin backfill can re-attempt extraction first instead
    // of permanently re-running ffmpeg whenever the platform URL was briefly
    // unavailable at original capture time.
    mediaThumbnailSourceUrl: text("media_thumbnail_source_url"),
    mediaMeta: jsonb("media_meta").$type<AdResearchBoardMediaMeta>(),
    mediaStatus: text("media_status"),
    mediaError: text("media_error"),
    mediaAttempts: integer("media_attempts").default(0).notNull(),
    mediaDownloadedAt: timestamp("media_downloaded_at", { withTimezone: true }),
    // Task #187: stamp set whenever an admin reopens this row via the
    // "Requeue auth failures" action. Powers the cohort-based
    // authFailureRecoveryRate metric: of all rows reopened in the last
    // 24h, how many later landed back on `mediaStatus='ok'`?
    mediaReopenedAt: timestamp("media_reopened_at_t187", { withTimezone: true }),
    // Task #200: stamped whenever the T197 dev cohort verification (or
    // any future operator-driven legacy reopen) re-opens a row from a
    // dismissed/failed state. Mirrors mediaReopenedAt but is reserved
    // for the T197 backfill cohort so the dashboard can distinguish a
    // T200 verification reopen from a regular auth-failure requeue.
    reopenedAtT197: timestamp("reopened_at_t197", { withTimezone: true }),
    // True when the row has been permanently dismissed: either the downloader
    // exhausted every retry/fallback (yt-dlp + Apify both gave up) or an admin
    // hit the manual "Skip" action. Dismissed rows are hidden from the user
    // view, the admin "Needs Fixing" list, and the failed counter so the
    // "Retry Failed (N)" badge can actually drop to zero.
    dismissed: boolean("dismissed").default(false).notNull(),
    // Task #134: non-destructive sync. When a row that was once in the Google
    // Sheet stops appearing, we set this flag instead of deleting the row.
    // Hidden rows still own their cached object-storage media and can be
    // unhidden by an admin (or automatically when the sheet row reappears).
    //
    // Task #402: legacy/compat shadow column. The new source lifecycle uses
    // sourcePresent + sourceRemovedAt + libraryVisibility. The sync still
    // mirrors hidden_from_sheet := NOT source_present so legacy reads
    // (admin "Hidden rows" counter, downstream tooling) keep working. New
    // code should read sourcePresent / libraryVisibility instead.
    hiddenFromSheet: boolean("hidden_from_sheet").default(false).notNull(),
    // Task #402 (Durable Media Library): source-lifecycle fields.
    //   sourcePresent          - true while the row appears in the latest
    //                            sheet snapshot; flipped to false by the
    //                            sync's bulk-update step when the rowKey
    //                            isn't seen on a given run.
    //   sourceRemovedAt        - first time sourcePresent flipped to false.
    //                            Preserved across subsequent syncs while
    //                            the row stays missing.
    //   lastSeenInSourceAt     - bumped on every sync where the row is
    //                            present (powers freshness telemetry).
    //   timesSeenInSource      - cumulative counter; powers recurrence /
    //                            "high-frequency ad" trend analysis.
    sourcePresent: boolean("source_present").default(true).notNull(),
    sourceRemovedAt: timestamp("source_removed_at", { withTimezone: true }),
    lastSeenInSourceAt: timestamp("last_seen_in_source_at", { withTimezone: true }),
    timesSeenInSource: integer("times_seen_in_source").default(0).notNull(),
    // Task #402: admin-controlled inventory state.
    //   'visible'  - on the user board if media is durable (default).
    //   'archived' - admin explicitly archived; stays off the user board.
    // Replaces hiddenFromSheet/dismissed as the canonical user-board gate.
    // Source-removed rows with durable media stay 'visible' (durable
    // media library philosophy).
    libraryVisibility: text("library_visibility").default("visible").notNull(),
    // Classification of the ad link computed during sync (instagram-post,
    // instagram-reel, facebook-post, facebook-reel, facebook-share-redirect,
    // direct-image, direct-video, unknown). Lets admins see which download
    // strategy a row will go through without re-running the classifier.
    urlKind: text("url_kind"),
    // Canonical URL after resolving Facebook /share/r|p|v redirect tokens.
    // Cached on the row so retries hand the canonical URL to Apify/yt-dlp
    // instead of re-resolving the share token every time.
    resolvedUrl: text("resolved_url"),
    // Task #137 (next-stage hardening): lease-based durable queue. The worker
    // process that currently owns this row writes its identity here at claim
    // time. A second worker (or the same worker after a restart) refuses to
    // process a row whose `mediaLeaseUntil` is still in the future, so we get
    // safe cross-process recovery without a separate jobs table. The lease is
    // cleared when the row reaches a terminal state (ok/failed/partial).
    mediaLeaseOwner: text("media_lease_owner"),
    mediaLeaseUntil: timestamp("media_lease_until", { withTimezone: true }),
    // Wall-clock timestamp of when the current attempt started (set at claim
    // time). Pairs with `mediaLastProcessingMs` to derive per-row processing
    // duration after a terminal write, even if the writer crashed mid-pass.
    mediaStartedAt: timestamp("media_started_at", { withTimezone: true }),
    // Duration (ms) of the most recent terminal-state attempt. Powers the
    // admin dashboard's avg/p50/p95 processing-time chart without needing a
    // separate metrics table.
    mediaLastProcessingMs: integer("media_last_processing_ms"),
    // Coarse failure tag derived from `mediaError` at persist time
    // (e.g. `apify`, `yt-dlp`, `cdn`, `share`, `timeout`). Lets the admin
    // dashboard group recent failures by root cause class without re-parsing
    // the long error string client-side.
    mediaErrorClass: text("media_error_class"),
    // Task #197: production-hardening. Normalized "what kind of failure
    // is this and how do we recover?" tag. One of:
    //   recoverable-temporary  - upstream blip; retry on a delayed ladder
    //   recoverable-auth       - login wall; refresh-jar + escalation
    //   recoverable-extractor  - extractor drift; alternate-actor escalation
    //   invalid-input          - structurally non-extractable URL; never retry
    //   dead-content           - every strategy exhausted; permanently dismiss
    // Mapped from mediaErrorClass at every persist site so the dashboard
    // can read a single, stable column instead of re-classifying.
    recoveryClass: text("recovery_class_t197"),
    // Task #197: short label for the actionable strategy chosen for the
    // next attempt (e.g. "delayed-retry-10m", "auth-refresh+escalation",
    // "alternate-actor", "permanent-dismiss"). Persisted alongside
    // recoveryClass so the admin board can render the planned next step.
    recoveryStrategy: text("recovery_strategy_t197"),
    // Task #197: scheduled wall-clock time at which the row becomes
    // eligible for re-claim. The periodic processor's SELECT gates on
    // (retry_after_at IS NULL OR retry_after_at <= now()) so retries
    // follow the 10m / 1h / 6h / final ladder instead of hammering
    // providers immediately. Cleared on terminal-ok writes.
    retryAfterAt: timestamp("retry_after_at_t197", { withTimezone: true }),
    // Task #197: canonical raw URL captured at sheet ingest time
    // (BEFORE normalization). `normalizedUrl` is the canonical form fed
    // to every downstream extractor / dedupe / storage path. Persisted
    // separately so an operator can always trace what was originally
    // synced from the sheet vs what we actually attempted to extract.
    rawUrl: text("raw_url_t197"),
    normalizedUrl: text("normalized_url_t197"),
    // Task #137 (scaling pass): job priority. Lower numbers process first.
    //   10 = manual admin refetch (most urgent)
    //   20 = freshly synced new row
    //   50 = standard retry (default)
    //   80 = stuck-lease recovery (least urgent)
    // The candidate-selection ORDER BY uses this so manual refetch never
    // gets starved behind a backlog of stuck retries.
    mediaPriority: integer("media_priority").default(50).notNull(),
    // Task #403: canonical-URL dedupe key. md5() of the normalized URL
    // (lowercased host, link-shim unwrapped, tracking params stripped,
    // platform-specific path canonicalization applied - see
    // `normalizeSocialUrl` in media-downloader-helpers.ts). Computed at
    // sheet-sync time and written alongside `normalizedUrl` so the same
    // ad URL (with or without ?igsh=, mobile host, share redirect, etc.)
    // collapses to a single board row even when sheet operators paste
    // different ID cells for the duplicate posts. The partial unique
    // index `ad_research_board_items_canonical_url_hash_visible_uq`
    // (visible + non-null) enforces the invariant; archived duplicates
    // are intentionally allowed to keep their hash for audit history.
    // Migration: 0044_t403_canonical_url_hash.sql.
    canonicalUrlHash: text("canonical_url_hash"),
    // Task #309: per-row "media outcome changed at" timestamp. Bumped
    // by every media-downloader code path that mutates a media outcome
    // (success / failure / partial / dismiss / retry / lease release
    // with a status change). Deliberately NOT touched by the sheet
    // upsert path so the dashboard's 24h-windowed tiles can clamp by
    // "when did this row's outcome actually change" instead of by
    // `updated_at` (which the sync bumps on every fetched row, dragging
    // pre-reset failure rows back into the fresh window).
    mediaOutcomeChangedAt: timestamp("media_outcome_changed_at_t309", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    queueIdx: index("ad_research_board_items_queue_idx").on(t.dismissed, t.mediaStatus, t.mediaPriority, t.mediaAttempts),
    leaseUntilIdx: index("ad_research_board_items_lease_until_idx").on(t.mediaLeaseUntil),
    leaseOwnerIdx: index("ad_research_board_items_lease_owner_idx").on(t.mediaLeaseOwner),
    statusUpdatedIdx: index("ad_research_board_items_status_updated_idx").on(t.mediaStatus, t.updatedAt),
    downloadedAtIdx: index("ad_research_board_items_downloaded_at_idx").on(t.mediaDownloadedAt),
    // Task #309: index supports the rolling-window dashboard queries
    // in `getQueueHealth()` that clamp by `media_outcome_changed_at`.
    outcomeChangedAtIdx: index("ad_research_board_items_outcome_changed_at_idx_t309").on(t.mediaOutcomeChangedAt),
    // Task #401: partial index narrows the live-health endpoint's
    // current-state COUNT queries to only the rows that can possibly
    // appear in a live bucket. Terminal states (failed_permanent,
    // silent-source, invalid, ok) are excluded by the WHERE clause so
    // the index stays tiny even at 50k+ row scale. Mirrors
    // lib/db/migrations/0040_t401_failed_permanent_status.sql.
    liveStatusIdx: index("ad_research_board_items_live_status_idx")
      .on(t.mediaStatus)
      .where(sql`media_status IN ('pending', 'downloading', 'failed', 'partial')`),
    // Task #402: indexes mirroring 0041_t402_durable_media_library.sql.
    libraryVisibilityIdx: index("ad_research_board_items_library_visibility_idx").on(t.libraryVisibility),
    sourcePresentIdx: index("ad_research_board_items_source_present_idx").on(t.sourcePresent, t.lastSeenInSourceAt),
    // Task #403: partial unique index enforces "one visible row per
    // canonical URL hash". Archived rows are intentionally outside the
    // constraint so historical/audit duplicates can stay addressable.
    // Mirrors lib/db/migrations/0044_t403_canonical_url_hash.sql; the
    // CREATE UNIQUE INDEX statement there is the source of truth (drizzle's
    // partial-index DSL doesn't surface every clause we need for ON CONFLICT).
    canonicalUrlHashVisibleUq: index("ad_research_board_items_canonical_url_hash_visible_uq")
      .on(t.canonicalUrlHash)
      .where(sql`library_visibility = 'visible' AND canonical_url_hash IS NOT NULL`),
  }),
);

export const adResearchBoardSyncStatus = pgTable("ad_research_board_sync_status", {
  id: integer("id").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncOk: boolean("last_sync_ok"),
  lastSyncError: text("last_sync_error"),
  rowsUpserted: integer("rows_upserted"),
  rowsPruned: integer("rows_pruned"),
  totalRows: integer("total_rows"),
  // Task #197: persisted verification benchmark. Single-row table so
  // the latest before/after snapshot lives alongside other singleton
  // sync state. JSON shape matches the route's response body, with a
  // `stage` discriminator: 'before' (POST snapshotted before-state +
  // reopened rows; worker still draining) or 'completed' (a follow-up
  // POST captured the after-state).
  lastVerificationBenchmark: jsonb("last_verification_benchmark_t197"),
  lastVerificationBenchmarkAt: timestamp("last_verification_benchmark_at_t197", { withTimezone: true }),
  // Task #237 (window-only reset): operator-set "fresh start" cutoff
  // for the 24h-windowed Queue Health views (Failure Breakdown, Recent
  // Failures, Processing Latency, throughput, terminalFailures /
  // dismissed24h / retrying tiles, etc.). When set, every query that
  // would otherwise floor at `now() - 24h` is clamped to MAX(now-24h,
  // analyticsWindowCutoff). The underlying rows are NEVER touched -
  // only the rolling-window views start fresh from this timestamp.
  analyticsWindowCutoff: timestamp("analytics_window_cutoff_t237", { withTimezone: true }),
});

// Task #137 (scaling pass): historical queue metrics. The downloader writes
// a snapshot here every QUEUE_METRICS_INTERVAL_MS (5 min default). The
// admin dashboard queries the last 24h to render trend lines for
// throughput, queue depth, error rate, and processing latency. A separate
// table keeps queue-health polling cheap (no expensive group-by-time
// over the items table) and gives history beyond the last-200-row sample
// the live snapshot uses for p50/p95.
export const adResearchBoardQueueMetrics = pgTable(
  "ad_research_board_queue_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    statusPending: integer("status_pending").default(0).notNull(),
    statusDownloading: integer("status_downloading").default(0).notNull(),
    statusOk: integer("status_ok").default(0).notNull(),
    statusFailed: integer("status_failed").default(0).notNull(),
    statusPartial: integer("status_partial").default(0).notNull(),
    stuck: integer("stuck").default(0).notNull(),
    activeLeases: integer("active_leases").default(0).notNull(),
    throughput1h: integer("throughput_1h").default(0).notNull(),
    throughput24h: integer("throughput_24h").default(0).notNull(),
    failures1h: integer("failures_1h").default(0).notNull(),
    avgProcessingMs: integer("avg_processing_ms"),
    p95ProcessingMs: integer("p95_processing_ms"),
    // Task #151: real-outcome snapshot fields. The historical table now
    // captures the operational metrics the dashboard surfaces in its
    // header strip (success %, terminal failures, dismissed) and the
    // operational-bucket counts (auth blocks, rate limits, provider
    // failures) so the trend sparklines can read them directly without
    // re-aggregating items on every poll.
    totalRows: integer("total_rows_t151").default(0).notNull(),
    usableMedia: integer("usable_media_t151").default(0).notNull(),
    successRateBp: integer("success_rate_bp_t151").default(0).notNull(),
    terminalFailures: integer("terminal_failures_t151").default(0).notNull(),
    dismissedTotal: integer("dismissed_total_t151").default(0).notNull(),
    authFailures24h: integer("auth_failures_24h_t151").default(0).notNull(),
    rateLimits24h: integer("rate_limits_24h_t151").default(0).notNull(),
    providerFailures24h: integer("provider_failures_24h_t151").default(0).notNull(),
    retryVolume24h: integer("retry_volume_24h_t151").default(0).notNull(),
    // Task #158: per-provider observability. Cumulative counters
    // captured by the worker between snapshots; recordQueueMetricsSnapshot
    // resets them after each persist so each row reflects the activity
    // in that interval. Powers the dashboard's apify_success / yt-dlp
    // ratio and escalation_recovery_rate chips.
    apifySuccess: integer("apify_success_t158").default(0).notNull(),
    ytdlpSuccess: integer("ytdlp_success_t158").default(0).notNull(),
    escalationCount: integer("escalation_count_t158").default(0).notNull(),
    escalationRecovered: integer("escalation_recovered_t158").default(0).notNull(),
    // Task #187: yt-dlp successes that consumed an authenticated cookie
    // jar (IG admin-managed session OR FB admin-managed session OR
    // legacy YT_DLP_COOKIES_FILE env). Powers the
    // ytDlpAuthenticatedRecoveries dashboard counter so operators can
    // see how often the auth-extraction continuity path saved a row
    // that would otherwise have hit a login wall.
    ytdlpAuthRecoveries: integer("ytdlp_auth_recoveries_t187").default(0).notNull(),
    // Task #189: adaptive IG rate-limit protection. Per-snapshot counters
    // captured by the worker between flushes. `igRateLimitHits` is the
    // number of new `ig-rate-limited` errors observed in the interval;
    // `igCooldownsTriggered` is how many times the pre-batch cooldown
    // gate fired (i.e. processInstagramBatch slept before resolving).
    // Used by the dashboard sparkline so operators can correlate burst
    // 429s with the throttle response.
    igRateLimitHits: integer("ig_rate_limit_hits_t189").default(0).notNull(),
    igCooldownsTriggered: integer("ig_cooldowns_triggered_t189").default(0).notNull(),
    // Task #209: IG cookie continuity counters per 5-min snapshot.
    // `materialize` reflects whether the admin-managed jar resolves
    // into a temp file at all (success) or fails (jar missing,
    // expired, decrypt-failed, empty). `attach` reflects whether the
    // file actually reaches yt-dlp as a readable `--cookies <path>`
    // argument (success) or was unreadable / had to be hard-failed
    // anonymously (fail). Together they isolate whether an IG
    // extraction problem is in storage, decryption, or the spawn
    // path BEFORE the auth-wall escalation wave appears downstream.
    igCookieMaterializeSuccess: integer("ig_cookie_materialize_success_t209").default(0).notNull(),
    igCookieMaterializeFail: integer("ig_cookie_materialize_fail_t209").default(0).notNull(),
    igCookieAttachSuccess: integer("ig_cookie_attach_success_t209").default(0).notNull(),
    igCookieAttachFail: integer("ig_cookie_attach_fail_t209").default(0).notNull(),
    // Task #197: production-hardening counters. Per-snapshot deltas
    // captured by the worker between flushes. Powers the new
    // "Recovery Pipeline" panel on the dashboard so an operator can
    // see the actual triage taking place.
    invalidUrlsBlocked: integer("invalid_urls_blocked_t197").default(0).notNull(),
    deadContentDismissed: integer("dead_content_dismissed_t197").default(0).notNull(),
    delayedRetriesScheduled: integer("delayed_retries_scheduled_t197").default(0).notNull(),
    temporaryRecoveries: integer("temporary_recoveries_t197").default(0).notNull(),
    authRecoveries: integer("auth_recoveries_t197").default(0).notNull(),
    extractorRecoveries: integer("extractor_recoveries_t197").default(0).notNull(),
    avgRecoveryLatencyMs: integer("avg_recovery_latency_ms_t197"),
    // Task #197: per-actor success map captured in this 5-min window.
    // Shape: { "<actor-or-source-label>": <success-count> }. Rolled up
    // across the 24h window in getQueueHealth so the dashboard can
    // show which actor / source label is recovering rows.
    perActorSuccess: jsonb("per_actor_success_t197").$type<Record<string, number>>(),
  },
  (t) => ({
    capturedAtIdx: index("ad_research_board_queue_metrics_captured_at_idx").on(t.capturedAt),
  }),
);
// Task #237: queue-health analytics reset coordination. Single-row
// control table the API process writes to when an admin invokes the
// reset endpoint. The Media Worker process polls this row each
// queue-metrics tick - when `resetRequestedAt` is newer than
// `resetAcknowledgedAt` it zeroes the in-memory provider counters and
// writes back an acknowledgement. Lives outside the metrics table so
// truncating that table never wipes the pending-reset signal.
export const adResearchBoardQueueMetricsControl = pgTable(
  "ad_research_board_queue_metrics_control",
  {
    id: integer("id").primaryKey(),
    resetRequestedAt: timestamp("reset_requested_at_t237", { withTimezone: true }),
    resetAcknowledgedAt: timestamp("reset_acknowledged_at_t237", { withTimezone: true }),
    lastResetActor: text("last_reset_actor_t237"),
    lastResetDryRun: boolean("last_reset_dry_run_t237"),
  },
);

// Task #155: authenticated scraping. Single active cookie jar per
// platform is enough today, but the schema is shaped so a rotator can
// pick the most-recent non-expired non-deleted jar without a migration.
// Cookie BYTES are stored in object storage under an admin-only prefix;
// only the path + metadata live here so a DB dump never leaks cookies.
export const authCookieJars = pgTable(
  "auth_cookie_jars",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").notNull(), // 'ig' | 'fb'
    objectPath: text("object_path").notNull(),
    uploadedBy: text("uploaded_by"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    // 'active' | 'degraded' | 'expired'
    status: text("status").default("active").notNull(),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    platformActiveIdx: index("auth_cookie_jars_platform_active_idx").on(t.platform, t.deletedAt, t.uploadedAt),
  }),
);

// Task #155: per-platform auth-health record updated by the periodic
// probe. Single row per platform keeps the dashboard read trivial; the
// row is upserted on every probe so admins see fresh `lastProbeAt`
// within ~6h of any state change.
export const authHealth = pgTable("auth_health", {
  platform: text("platform").primaryKey(), // 'ig' | 'fb'
  // 'ok' | 'degraded' | 'expired' | 'unknown'
  status: text("status").default("unknown").notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastErrorClass: text("last_error_class"),
  lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
  probeUrl: text("probe_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Suppress "unused" for sql import retained for parity with peer schemas.
void sql;
