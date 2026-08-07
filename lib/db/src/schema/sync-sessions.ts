import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Task #229: per-run record of a research-board sync. One row is
// created when syncAdResearchBoard / syncFunnelsResearchBoard begins,
// then the same row is updated as counters tick and as the run
// transitions to completed / failed. The Live tab on the dashboards
// reads the most-recent session for each board; the Historical tab
// reads the trailing window.
//
// `board` is the discriminator ("ad-research" | "funnels-research").
// All counter columns are nullable-default-zero so partial updates
// during a long-running sync are cheap.
export const syncSessions = pgTable(
  "sync_sessions",
  {
    id: serial("id").primaryKey(),
    board: text("board").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    buildSha: text("build_sha"),
    workerPid: text("worker_pid"),
    workerId: text("worker_id"),
    error: text("error"),
    rowsFetched: integer("rows_fetched").notNull().default(0),
    rowsProcessed: integer("rows_processed").notNull().default(0),
    successfulExtractions: integer("successful_extractions").notNull().default(0),
    authFailures: integer("auth_failures").notNull().default(0),
    retries: integer("retries").notNull().default(0),
    escalations: integer("escalations").notNull().default(0),
    recoveries: integer("recoveries").notNull().default(0),
    invalidUrls: integer("invalid_urls").notNull().default(0),
    deadContent: integer("dead_content").notNull().default(0),
    // Task #366: source rows the sync silently dropped before they could
    // ever be upserted into ad_research_board_items - currently only
    // sheet rows whose link cell is empty (no URL = no row identity).
    // Surfaced on the /items endpoint so the operator can see the gap
    // between the source sheet's row count and the board population.
    rowsSkipped: integer("rows_skipped").notNull().default(0),
    extractionRateBp: integer("extraction_rate_bp").notNull().default(0),
    throughputPerMin: integer("throughput_per_min").notNull().default(0),
    queueDepth: integer("queue_depth").notNull().default(0),
    summary: jsonb("summary"),
  },
  (t) => ({
    byBoardStartedIdx: index("sync_sessions_board_started_idx").on(t.board, t.startedAt),
    byStatusIdx: index("sync_sessions_status_idx").on(t.status),
  }),
);

export type SyncSessionRow = typeof syncSessions.$inferSelect;

// Append-only timeline of significant moments inside a sync session.
// Examples: "fetch_started", "fetch_completed", "upsert_completed",
// "downloader_kicked", "auth_failure", "escalation", "recovery",
// "completed", "failed".
export const syncSessionEvents = pgTable(
  "sync_session_events",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"),
    message: text("message"),
    detail: jsonb("detail"),
  },
  (t) => ({
    bySessionIdx: index("sync_session_events_session_idx").on(t.sessionId, t.occurredAt),
  }),
);

export type SyncSessionEventRow = typeof syncSessionEvents.$inferSelect;
