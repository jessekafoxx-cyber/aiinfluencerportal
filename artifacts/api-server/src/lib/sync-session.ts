import { db, syncSessions, syncSessionEvents } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

// Task #229: lightweight wrapper around the sync_sessions table that
// the ad-research and funnels-research sync libraries hook into. We
// keep the API tiny on purpose - the sync code calls startSession()
// once at the top, recordEvent() at the interesting moments, and
// completeSession() at the bottom; all counter fields can be folded
// in via the optional `counters` payloads.

export type SyncBoard = "ad-research" | "funnels-research";
export type SyncTrigger = "manual" | "scheduled" | "boot-freshness";
export type SyncStatus = "running" | "completed" | "failed";

export interface SessionCounters {
  rowsFetched?: number;
  rowsProcessed?: number;
  successfulExtractions?: number;
  authFailures?: number;
  retries?: number;
  escalations?: number;
  recoveries?: number;
  invalidUrls?: number;
  deadContent?: number;
  rowsSkipped?: number;
  extractionRateBp?: number;
  throughputPerMin?: number;
  queueDepth?: number;
}

export interface StartSessionInput {
  board: SyncBoard;
  trigger: SyncTrigger;
}

function buildSha(): string | null {
  return process.env.BUILD_SHA || null;
}

async function workerLabel(): Promise<{ pid: string; id: string | null }> {
  let workerId: string | null = null;
  try {
    const { getWorkerId } = await import("./media-downloader");
    workerId = getWorkerId();
  } catch {
    /* ignore - api-server boot path doesn't need a worker id */
  }
  return { pid: String(process.pid), id: workerId };
}

export async function startSyncSession(input: StartSessionInput): Promise<number> {
  const { pid, id } = await workerLabel();
  const [row] = await db
    .insert(syncSessions)
    .values({
      board: input.board,
      trigger: input.trigger,
      status: "running",
      buildSha: buildSha(),
      workerPid: pid,
      workerId: id,
    })
    .returning({ id: syncSessions.id });
  await recordSessionEvent(row.id, {
    kind: "session_started",
    severity: "info",
    message: `${input.board} sync started (${input.trigger})`,
    detail: { trigger: input.trigger, buildSha: buildSha(), workerId: id, pid },
  });
  return row.id;
}

export async function recordSessionEvent(
  sessionId: number,
  event: {
    kind: string;
    severity?: "info" | "warn" | "error";
    message?: string | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await db.insert(syncSessionEvents).values({
      sessionId,
      kind: event.kind,
      severity: event.severity || "info",
      message: event.message ?? null,
      detail: event.detail ?? null,
    });
  } catch (err) {
    logger.warn({ err, sessionId, kind: event.kind }, "sync-session: failed to record event");
  }
}

export async function updateSessionCounters(
  sessionId: number,
  counters: SessionCounters,
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (counters.rowsFetched != null) set.rowsFetched = counters.rowsFetched;
  if (counters.rowsProcessed != null) set.rowsProcessed = counters.rowsProcessed;
  if (counters.successfulExtractions != null) set.successfulExtractions = counters.successfulExtractions;
  if (counters.authFailures != null) set.authFailures = counters.authFailures;
  if (counters.retries != null) set.retries = counters.retries;
  if (counters.escalations != null) set.escalations = counters.escalations;
  if (counters.recoveries != null) set.recoveries = counters.recoveries;
  if (counters.invalidUrls != null) set.invalidUrls = counters.invalidUrls;
  if (counters.deadContent != null) set.deadContent = counters.deadContent;
  // Task #366: persist source-row-skipped count so /items can surface it.
  if (counters.rowsSkipped != null) set.rowsSkipped = counters.rowsSkipped;
  if (counters.extractionRateBp != null) set.extractionRateBp = counters.extractionRateBp;
  if (counters.throughputPerMin != null) set.throughputPerMin = counters.throughputPerMin;
  if (counters.queueDepth != null) set.queueDepth = counters.queueDepth;
  if (Object.keys(set).length === 0) return;
  try {
    await db.update(syncSessions).set(set).where(eq(syncSessions.id, sessionId));
  } catch (err) {
    logger.warn({ err, sessionId }, "sync-session: failed to update counters");
  }
}

// Atomic increment helper - lets the media-downloader best-effort fold
// counters into the *latest running session* for a board without
// stomping a concurrent counter update.
export async function incrementLatestRunningSessionCounters(
  board: SyncBoard,
  delta: SessionCounters,
): Promise<void> {
  try {
    const [row] = await db
      .select({ id: syncSessions.id })
      .from(syncSessions)
      .where(and(eq(syncSessions.board, board), eq(syncSessions.status, "running")))
      .orderBy(desc(syncSessions.startedAt))
      .limit(1);
    if (!row) return;
    const set: Record<string, unknown> = {};
    if (delta.successfulExtractions) set.successfulExtractions = sql`${syncSessions.successfulExtractions} + ${delta.successfulExtractions}`;
    if (delta.authFailures) set.authFailures = sql`${syncSessions.authFailures} + ${delta.authFailures}`;
    if (delta.retries) set.retries = sql`${syncSessions.retries} + ${delta.retries}`;
    if (delta.escalations) set.escalations = sql`${syncSessions.escalations} + ${delta.escalations}`;
    if (delta.recoveries) set.recoveries = sql`${syncSessions.recoveries} + ${delta.recoveries}`;
    if (delta.deadContent) set.deadContent = sql`${syncSessions.deadContent} + ${delta.deadContent}`;
    if (delta.invalidUrls) set.invalidUrls = sql`${syncSessions.invalidUrls} + ${delta.invalidUrls}`;
    if (Object.keys(set).length === 0) return;
    await db.update(syncSessions).set(set).where(eq(syncSessions.id, row.id));
  } catch (err) {
    logger.warn({ err, board }, "sync-session: failed to increment counters");
  }
}

export async function completeSyncSession(
  sessionId: number,
  finalState: {
    status: "completed" | "failed";
    error?: string | null;
    counters?: SessionCounters;
    summary?: Record<string, unknown> | null;
  },
): Promise<void> {
  const set: Record<string, unknown> = {
    status: finalState.status,
    completedAt: new Date(),
  };
  if (finalState.error !== undefined) set.error = finalState.error;
  if (finalState.summary !== undefined) set.summary = finalState.summary;
  const c = finalState.counters || {};
  if (c.rowsFetched != null) set.rowsFetched = c.rowsFetched;
  if (c.rowsProcessed != null) set.rowsProcessed = c.rowsProcessed;
  if (c.successfulExtractions != null) set.successfulExtractions = c.successfulExtractions;
  if (c.authFailures != null) set.authFailures = c.authFailures;
  if (c.retries != null) set.retries = c.retries;
  if (c.escalations != null) set.escalations = c.escalations;
  if (c.recoveries != null) set.recoveries = c.recoveries;
  if (c.invalidUrls != null) set.invalidUrls = c.invalidUrls;
  if (c.deadContent != null) set.deadContent = c.deadContent;
  // Task #366: persist source-row-skipped count on session completion too.
  if (c.rowsSkipped != null) set.rowsSkipped = c.rowsSkipped;
  if (c.extractionRateBp != null) set.extractionRateBp = c.extractionRateBp;
  if (c.throughputPerMin != null) set.throughputPerMin = c.throughputPerMin;
  if (c.queueDepth != null) set.queueDepth = c.queueDepth;
  try {
    await db.update(syncSessions).set(set).where(eq(syncSessions.id, sessionId));
  } catch (err) {
    logger.warn({ err, sessionId }, "sync-session: failed to mark session complete");
  }
  await recordSessionEvent(sessionId, {
    kind: finalState.status === "completed" ? "session_completed" : "session_failed",
    severity: finalState.status === "completed" ? "info" : "error",
    message: finalState.error || (finalState.status === "completed" ? "sync ok" : "sync failed"),
    detail: finalState.summary ?? null,
  });
}

// Live read for the dashboard. Returns the most-recent session for the
// given board (running or completed/failed within the lookback window),
// plus the trailing event timeline so the UI can render the live feed.
export async function getLiveSyncSession(
  board: SyncBoard,
  opts?: { eventLimit?: number },
): Promise<{
  session: typeof syncSessions.$inferSelect | null;
  events: Array<typeof syncSessionEvents.$inferSelect>;
}> {
  const [session] = await db
    .select()
    .from(syncSessions)
    .where(eq(syncSessions.board, board))
    .orderBy(desc(syncSessions.startedAt))
    .limit(1);
  if (!session) return { session: null, events: [] };
  const eventLimit = opts?.eventLimit ?? 50;
  const events = await db
    .select()
    .from(syncSessionEvents)
    .where(eq(syncSessionEvents.sessionId, session.id))
    .orderBy(desc(syncSessionEvents.occurredAt))
    .limit(eventLimit);
  return { session, events: events.reverse() };
}

export async function getHistoricalSyncSessions(
  board: SyncBoard,
  opts?: { sinceMs?: number; limit?: number },
): Promise<Array<typeof syncSessions.$inferSelect>> {
  const limit = opts?.limit ?? 50;
  const sinceMs = opts?.sinceMs ?? 7 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(syncSessions)
    .where(and(eq(syncSessions.board, board), gte(syncSessions.startedAt, since)))
    .orderBy(desc(syncSessions.startedAt))
    .limit(limit);
}
