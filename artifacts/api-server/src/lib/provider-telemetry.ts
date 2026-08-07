// ─────────────────────────────────────────────────────────────────────────────
// Slice D - Provider Reliability Telemetry recorder + pure aggregator.
//
// Persistent, append-only DB-backed audit trail of every provider call
// attempt. Lives ALONGSIDE the in-memory ring buffer in
// providers/shared/reliability.ts (which stays for fast snapshotting in
// the same process); this module persists for forensics + historical
// rollups + cross-restart visibility.
//
// Strict rules:
//   - All recorder calls are fire-and-forget and never throw. A DB
//     hiccup must never fail or slow a provider request.
//   - This module is additive only. Nothing in here is wired into
//     orchestration decisions in this slice.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db,
  providerExecutionEventsTable,
  providerRecoveryEventsTable,
  type InsertProviderExecutionEvent,
  type InsertProviderRecoveryEvent,
  type ProviderExecutionEvent,
} from "@workspace/db";
import { logger } from "./logger";

export interface RecordExecutionEventInput {
  provider: string;
  operation: "submit" | "webhook" | "poll" | "recovery" | "preflight";
  stage?: string | null;
  jobId?: number | null;
  sceneJobId?: number | null;
  providerJobId?: string | null;
  success: boolean;
  degraded?: boolean;
  webhookUsed?: boolean;
  pollUsed?: boolean;
  latencyMs?: number | null;
  outputBytes?: number | null;
  errorClass?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  workerId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordRecoveryEventInput {
  jobId: number;
  recoveryKind:
    | "gemini_base_fallback"
    | "enhancor_degraded_passthrough"
    | "hf_poll_to_gemini_fallback"
    | "stuck_generating_base_reclaim"
    | "stuck_enhancing_reclaim";
  fromProvider?: string | null;
  toProvider?: string | null;
  stage?: string | null;
  reason?: string | null;
  success: boolean;
  delayMs?: number | null;
  metadata?: Record<string, unknown>;
}

// Trim long error strings before persisting so no single bad call can
// blow up a row.
function trim(s: string | null | undefined, max = 1000): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function recordExecutionEvent(input: RecordExecutionEventInput): void {
  // Fire-and-forget: do not return the promise so callers cannot
  // accidentally await it and block their happy path.
  void persistExecutionEvent(input).catch((err) => {
    // Logging failure is the loudest we ever get. We DO NOT rethrow.
    try {
      logger.warn(
        { err, provider: input.provider, operation: input.operation },
        "provider-telemetry: recordExecutionEvent persistence failed (swallowed)",
      );
    } catch {
      /* truly silent */
    }
  });
}

async function persistExecutionEvent(input: RecordExecutionEventInput): Promise<void> {
  const row: InsertProviderExecutionEvent = {
    provider: input.provider,
    operation: input.operation,
    stage: input.stage ?? null,
    jobId: input.jobId ?? null,
    sceneJobId: input.sceneJobId ?? null,
    providerJobId: input.providerJobId ?? null,
    success: input.success,
    degraded: input.degraded ?? false,
    webhookUsed: input.webhookUsed ?? false,
    pollUsed: input.pollUsed ?? false,
    latencyMs: input.latencyMs ?? null,
    outputBytes: input.outputBytes ?? null,
    errorClass: input.errorClass ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: trim(input.errorMessage),
    workerId: input.workerId ?? null,
    metadata: input.metadata ?? {},
  };
  await db.insert(providerExecutionEventsTable).values(row);
}

export function recordRecoveryEvent(input: RecordRecoveryEventInput): void {
  void persistRecoveryEvent(input).catch((err) => {
    try {
      logger.warn(
        { err, jobId: input.jobId, recoveryKind: input.recoveryKind },
        "provider-telemetry: recordRecoveryEvent persistence failed (swallowed)",
      );
    } catch {
      /* silent */
    }
  });
}

async function persistRecoveryEvent(input: RecordRecoveryEventInput): Promise<void> {
  const row: InsertProviderRecoveryEvent = {
    jobId: input.jobId,
    recoveryKind: input.recoveryKind,
    fromProvider: input.fromProvider ?? null,
    toProvider: input.toProvider ?? null,
    stage: input.stage ?? null,
    reason: trim(input.reason),
    success: input.success,
    delayMs: input.delayMs ?? null,
    metadata: input.metadata ?? {},
  };
  await db.insert(providerRecoveryEventsTable).values(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregator (no DB). Used by the rollup scheduler to turn a
// batch of execution events into a snapshot row, and by the probe to
// validate the math without touching Postgres.
// ─────────────────────────────────────────────────────────────────────────────

// Linear-interpolated percentile over a SORTED-ASCENDING numeric
// array. Returns null for an empty input. p must be in [0,1].
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[sorted.length - 1]!;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export interface AggregatedSnapshot {
  sampleSize: number;
  successRate: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  timeoutRate: number;
  emptyOutputRate: number;
  webhookFailureRate: number;
  degradedRate: number;
  breakdown: {
    byErrorClass: Record<string, number>;
    byOperation: Record<string, number>;
    successCount: number;
    failureCount: number;
    degradedCount: number;
    webhookCount: number;
    pollCount: number;
  };
}

export type EventForAggregation = Pick<
  ProviderExecutionEvent,
  | "success"
  | "degraded"
  | "webhookUsed"
  | "pollUsed"
  | "latencyMs"
  | "errorClass"
  | "operation"
>;

export function aggregateExecutionEvents(
  events: EventForAggregation[],
): AggregatedSnapshot {
  const n = events.length;
  if (n === 0) {
    return {
      sampleSize: 0,
      successRate: 0,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      p99LatencyMs: null,
      timeoutRate: 0,
      emptyOutputRate: 0,
      webhookFailureRate: 0,
      degradedRate: 0,
      breakdown: {
        byErrorClass: {},
        byOperation: {},
        successCount: 0,
        failureCount: 0,
        degradedCount: 0,
        webhookCount: 0,
        pollCount: 0,
      },
    };
  }
  const latencies: number[] = [];
  const byErrorClass: Record<string, number> = {};
  const byOperation: Record<string, number> = {};
  let successCount = 0;
  let degradedCount = 0;
  let webhookCount = 0;
  let pollCount = 0;
  let timeoutCount = 0;
  let emptyOutputCount = 0;
  let webhookMissingCount = 0;
  for (const ev of events) {
    if (ev.success) successCount++;
    if (ev.degraded) degradedCount++;
    if (ev.webhookUsed) webhookCount++;
    if (ev.pollUsed) pollCount++;
    if (typeof ev.latencyMs === "number") latencies.push(ev.latencyMs);
    if (ev.errorClass) {
      byErrorClass[ev.errorClass] = (byErrorClass[ev.errorClass] ?? 0) + 1;
      if (ev.errorClass === "TIMEOUT") timeoutCount++;
      if (ev.errorClass === "EMPTY_OUTPUT") emptyOutputCount++;
      if (ev.errorClass === "WEBHOOK_MISSING") webhookMissingCount++;
    }
    byOperation[ev.operation] = (byOperation[ev.operation] ?? 0) + 1;
  }
  latencies.sort((a, b) => a - b);
  const avg =
    latencies.length > 0
      ? latencies.reduce((s, x) => s + x, 0) / latencies.length
      : null;
  const failureCount = n - successCount;
  return {
    sampleSize: n,
    successRate: successCount / n,
    avgLatencyMs: avg !== null ? Math.round(avg) : null,
    p50LatencyMs: roundOrNull(percentile(latencies, 0.5)),
    p95LatencyMs: roundOrNull(percentile(latencies, 0.95)),
    p99LatencyMs: roundOrNull(percentile(latencies, 0.99)),
    timeoutRate: timeoutCount / n,
    emptyOutputRate: emptyOutputCount / n,
    webhookFailureRate: webhookMissingCount / n,
    degradedRate: degradedCount / n,
    breakdown: {
      byErrorClass,
      byOperation,
      successCount,
      failureCount,
      degradedCount,
      webhookCount,
      pollCount,
    },
  };
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}
