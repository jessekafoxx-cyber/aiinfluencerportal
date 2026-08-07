// ─────────────────────────────────────────────────────────────────────────────
// Slice D - Admin read-only endpoints over the provider telemetry tables.
//
// Mounted at /api/portal/admin/provider-telemetry. All endpoints are
// gated by requireAuth + requireAdmin.
//
// Endpoints:
//   GET /snapshot       - in-mem ring buffer + chains/flags/capabilities
//                         + latest persisted snapshot per provider +
//                         last-hour event count
//   GET /events         - tail of provider_execution_events
//   GET /rollups        - persisted snapshot history
//   GET /recoveries     - tail of provider_recovery_events
//
// All endpoints are READ ONLY. None of these endpoints can change
// orchestration behavior, flip flags, or mutate any provider state.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type IRouter } from "express";
import {
  db,
  providerExecutionEventsTable,
  providerHealthSnapshotsTable,
  providerRecoveryEventsTable,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { providersSnapshot } from "../providers/shared/manager";
import {
  getRecentSnapshots,
  countEventsLastHour,
} from "../lib/provider-telemetry-rollup";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (req.portalUser?.role !== "admin" && !req.appUser?.isSuperAdmin) {
    res.status(403).json({ error: "admin_required" });
    return;
  }
  next();
}

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function parseSince(value: unknown, defaultMs: number): Date {
  const raw = String(value ?? "");
  if (raw) {
    const asDate = new Date(raw);
    if (!Number.isNaN(asDate.getTime())) return asDate;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return new Date(asNum);
  }
  return new Date(Date.now() - defaultMs);
}

// GET /snapshot
// Returns the live in-mem reliability ring + capabilities/chains/flags
// + the most recent persisted snapshot per provider + last-hour event
// count. Single round-trip "is the system healthy" view.
router.get("/snapshot", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const live = providersSnapshot();
    const [persisted, lastHourEventCount] = await Promise.all([
      getRecentSnapshots(undefined, 12),
      countEventsLastHour(),
    ]);
    res.json({
      live,
      persisted,
      lastHourEventCount,
      generatedAt: new Date().toISOString(),
    });
    return;
  } catch (err) {
    res.status(500).json({ error: "snapshot_failed", message: String(err) });
    return;
  }
});

// GET /events?provider=&since=&limit=
// Tail of provider_execution_events, most-recent-first.
router.get("/events", requireAuth, requireAdmin, async (req, res) => {
  try {
    const provider = req.query.provider ? String(req.query.provider) : null;
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const since = parseSince(req.query.since, 24 * 3600_000); // last 24h default

    const filters = [gte(providerExecutionEventsTable.createdAt, since)];
    if (provider) filters.push(eq(providerExecutionEventsTable.provider, provider));

    const rows = await db
      .select()
      .from(providerExecutionEventsTable)
      .where(and(...filters))
      .orderBy(desc(providerExecutionEventsTable.createdAt))
      .limit(limit);

    res.json({ events: rows, count: rows.length, since: since.toISOString() });
    return;
  } catch (err) {
    res.status(500).json({ error: "events_failed", message: String(err) });
    return;
  }
});

// GET /rollups?provider=&hours=
// Returns persisted hourly snapshot rows, most-recent-first.
router.get("/rollups", requireAuth, requireAdmin, async (req, res) => {
  try {
    const provider = req.query.provider ? String(req.query.provider) : undefined;
    const hours = clampInt(req.query.hours, 24, 1, 720);
    const rows = await getRecentSnapshots(provider, hours);
    res.json({ snapshots: rows, count: rows.length });
    return;
  } catch (err) {
    res.status(500).json({ error: "rollups_failed", message: String(err) });
    return;
  }
});

// GET /recoveries?since=&limit=
// Tail of provider_recovery_events.
router.get("/recoveries", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const since = parseSince(req.query.since, 7 * 24 * 3600_000); // last 7d default

    const rows = await db
      .select()
      .from(providerRecoveryEventsTable)
      .where(gte(providerRecoveryEventsTable.createdAt, since))
      .orderBy(desc(providerRecoveryEventsTable.createdAt))
      .limit(limit);

    res.json({ recoveries: rows, count: rows.length, since: since.toISOString() });
    return;
  } catch (err) {
    res.status(500).json({ error: "recoveries_failed", message: String(err) });
    return;
  }
});

export default router;
