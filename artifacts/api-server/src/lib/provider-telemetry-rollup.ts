// ─────────────────────────────────────────────────────────────────────────────
// Slice D - Hourly provider telemetry rollup.
//
// Walks `provider_execution_events` for the most recently completed
// hour without a snapshot row per provider, aggregates the events,
// inserts a row into `provider_health_snapshots`. Idempotent: the
// unique (provider, window_start) index makes a re-run a no-op.
//
// Runs in the Media Worker (NOT the API process). Self-rearming
// setTimeout so a slow tick cannot pile up overlapping passes.
// Honors AUTOMATION_WORKERS_DISABLED=1.
// ─────────────────────────────────────────────────────────────────────────────

import {
  db,
  providerExecutionEventsTable,
  providerHealthSnapshotsTable,
  type InsertProviderHealthSnapshot,
} from "@workspace/db";
import { and, eq, gte, lt, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  aggregateExecutionEvents,
  type EventForAggregation,
} from "./provider-telemetry";

const PROVIDERS = ["higgsfield", "enhancor", "gemini"] as const;

// Truncate a Date down to the start of its UTC hour. Window boundaries
// are always hour-aligned so two workers computing the "last hour"
// converge on the same window_start value.
function startOfHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

export interface RollupResult {
  provider: string;
  windowStart: Date;
  windowEnd: Date;
  inserted: boolean;
  sampleSize: number;
  reason?: string;
}

export async function runProviderHealthRollup(): Promise<RollupResult[]> {
  const out: RollupResult[] = [];
  // The most recently completed hour is the one starting two hours ago
  // through one hour ago; we use "previous full hour" so we never
  // aggregate a partially-elapsed window. Walk back up to 6 hours so
  // a worker that was down for a while catches up without flooding.
  const nowHour = startOfHour(new Date());
  for (let hoursBack = 1; hoursBack <= 6; hoursBack++) {
    const windowEnd = new Date(nowHour.getTime() - (hoursBack - 1) * 3600_000);
    const windowStart = new Date(windowEnd.getTime() - 3600_000);
    for (const provider of PROVIDERS) {
      try {
        const result = await rollupOne(provider, windowStart, windowEnd);
        out.push(result);
      } catch (err) {
        logger.warn(
          { err, provider, windowStart },
          "provider-telemetry-rollup: rollupOne failed (swallowed)",
        );
        out.push({
          provider,
          windowStart,
          windowEnd,
          inserted: false,
          sampleSize: 0,
          reason: "rollup_failed",
        });
      }
    }
  }
  return out;
}

async function rollupOne(
  provider: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<RollupResult> {
  // Already rolled up?
  const existing = await db
    .select({ id: providerHealthSnapshotsTable.id })
    .from(providerHealthSnapshotsTable)
    .where(
      and(
        eq(providerHealthSnapshotsTable.provider, provider),
        eq(providerHealthSnapshotsTable.windowStart, windowStart),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { provider, windowStart, windowEnd, inserted: false, sampleSize: 0, reason: "already_rolled_up" };
  }
  const events = await db
    .select({
      success: providerExecutionEventsTable.success,
      degraded: providerExecutionEventsTable.degraded,
      webhookUsed: providerExecutionEventsTable.webhookUsed,
      pollUsed: providerExecutionEventsTable.pollUsed,
      latencyMs: providerExecutionEventsTable.latencyMs,
      errorClass: providerExecutionEventsTable.errorClass,
      operation: providerExecutionEventsTable.operation,
    })
    .from(providerExecutionEventsTable)
    .where(
      and(
        eq(providerExecutionEventsTable.provider, provider),
        gte(providerExecutionEventsTable.createdAt, windowStart),
        lt(providerExecutionEventsTable.createdAt, windowEnd),
      ),
    );
  // Skip empty windows entirely so we do not pollute the snapshots
  // table with all-zero rows for hours when no calls happened.
  if (events.length === 0) {
    return { provider, windowStart, windowEnd, inserted: false, sampleSize: 0, reason: "no_events" };
  }
  const agg = aggregateExecutionEvents(events as EventForAggregation[]);
  const row: InsertProviderHealthSnapshot = {
    provider,
    windowStart,
    windowEnd,
    sampleSize: agg.sampleSize,
    successRate: agg.successRate,
    avgLatencyMs: agg.avgLatencyMs,
    p50LatencyMs: agg.p50LatencyMs,
    p95LatencyMs: agg.p95LatencyMs,
    p99LatencyMs: agg.p99LatencyMs,
    timeoutRate: agg.timeoutRate,
    emptyOutputRate: agg.emptyOutputRate,
    webhookFailureRate: agg.webhookFailureRate,
    degradedRate: agg.degradedRate,
    breakdown: agg.breakdown as unknown as Record<string, unknown>,
  };
  // ON CONFLICT DO NOTHING handles the rare race where two workers
  // compute the same window simultaneously between the SELECT above
  // and the INSERT below. The unique index on (provider, window_start)
  // is the source of truth.
  await db
    .insert(providerHealthSnapshotsTable)
    .values(row)
    .onConflictDoNothing({
      target: [
        providerHealthSnapshotsTable.provider,
        providerHealthSnapshotsTable.windowStart,
      ],
    });
  return { provider, windowStart, windowEnd, inserted: true, sampleSize: agg.sampleSize };
}

let timer: NodeJS.Timeout | null = null;

export function startProviderTelemetryRollup(): void {
  if (timer) return;
  if (process.env.AUTOMATION_WORKERS_DISABLED === "1") {
    logger.warn(
      "AUTOMATION_WORKERS_DISABLED=1 - skipping provider-telemetry-rollup",
    );
    return;
  }
  const intervalMs = Number(process.env.PROVIDER_TELEMETRY_ROLLUP_MS ?? 3600_000);
  const tick = async () => {
    try {
      const results = await runProviderHealthRollup();
      const inserted = results.filter((r) => r.inserted).length;
      if (inserted > 0) {
        logger.info(
          { inserted, total: results.length },
          "provider-telemetry-rollup: tick complete",
        );
      }
    } catch (err) {
      logger.error({ err }, "provider-telemetry-rollup: tick failed");
    }
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  // Warm up after 60s so the rest of the worker boot finishes first.
  timer = setTimeout(tick, 60_000);
  timer.unref?.();
  logger.info({ intervalMs }, "provider-telemetry-rollup started");
}

export function stopProviderTelemetryRollup(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

// Read helper used by the admin endpoint - returns the latest N
// snapshots per provider, ordered most-recent-first.
export async function getRecentSnapshots(
  provider?: string,
  limit = 24,
): Promise<unknown[]> {
  const baseQuery = db
    .select()
    .from(providerHealthSnapshotsTable)
    .orderBy(desc(providerHealthSnapshotsTable.windowStart))
    .limit(Math.min(Math.max(limit, 1), 500));
  if (!provider) {
    return baseQuery;
  }
  return db
    .select()
    .from(providerHealthSnapshotsTable)
    .where(eq(providerHealthSnapshotsTable.provider, provider))
    .orderBy(desc(providerHealthSnapshotsTable.windowStart))
    .limit(Math.min(Math.max(limit, 1), 500));
}

// COUNT helper for the snapshot-default endpoint.
export async function countEventsLastHour(): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(providerExecutionEventsTable)
    .where(
      gte(providerExecutionEventsTable.createdAt, new Date(Date.now() - 3600_000)),
    );
  return rows[0]?.c ?? 0;
}
