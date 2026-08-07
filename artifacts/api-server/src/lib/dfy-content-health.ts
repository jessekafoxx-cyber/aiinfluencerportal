// Task #498: Boot-time guard that surfaces an empty Done-For-You catalog
// before users see the broken portal tiles. Logs a structured warning per
// gap so deployment logs (and any log-based alerting) catch silent
// regressions like the one in #498 - the missing `dfy_drive_subfolders`
// table caused every 250-scenes sync to fail and the portal to render
// empty grids without anything else complaining.
//
// Non-blocking: a gap never aborts boot. The signal is the warn line.

import { sql } from "drizzle-orm";
import {
  db,
  dfyDriveAssetsTable,
  dfyBridgePagesTable,
  dfyHighlightCoversTable,
  dfyDriveSyncRunsTable,
  dfyAdvertorialPagesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { DRIVE_FOLDERS_TO_SYNC } from "./dfy-drive-assets-importer";

interface SlugCount {
  slug: string;
  total: number;
  active: number;
}

async function activeCountsBySlug(): Promise<SlugCount[]> {
  const rows = await db
    .select({
      slug: dfyDriveAssetsTable.slug,
      total: sql<number>`count(*)::int`,
      active: sql<number>`sum((${dfyDriveAssetsTable.isActive})::int)::int`,
    })
    .from(dfyDriveAssetsTable)
    .groupBy(dfyDriveAssetsTable.slug);
  return rows.map((r) => ({
    slug: r.slug,
    total: Number(r.total ?? 0),
    active: Number(r.active ?? 0),
  }));
}

async function countTable(
  table:
    | typeof dfyBridgePagesTable
    | typeof dfyHighlightCoversTable
    | typeof dfyAdvertorialPagesTable,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table);
  return Number(row?.n ?? 0);
}

async function lastSyncStatusFor(slug: string): Promise<{
  status: string;
  startedAt: Date | null;
  error: string | null;
} | null> {
  const [row] = await db
    .select({
      status: dfyDriveSyncRunsTable.status,
      startedAt: dfyDriveSyncRunsTable.startedAt,
      error: dfyDriveSyncRunsTable.error,
    })
    .from(dfyDriveSyncRunsTable)
    .where(sql`${dfyDriveSyncRunsTable.slug} = ${slug}`)
    .orderBy(sql`${dfyDriveSyncRunsTable.startedAt} desc`)
    .limit(1);
  return row
    ? {
        status: row.status,
        startedAt: row.startedAt ?? null,
        error: row.error ?? null,
      }
    : null;
}

export interface DfySlugSyncStatus {
  slug: string;
  totalAssets: number;
  activeAssets: number;
  lastSyncStatus: string | null;
  lastSyncStartedAt: string | null;
  lastSyncError: string | null;
}

export interface DfyContentHealthReport {
  emptyDriveSlugs: string[];
  failedSyncSlugs: string[];
  bridgePages: number;
  highlightCovers: number;
  advertorialPages: number;
  syncStatusBySlug: DfySlugSyncStatus[];
}

export async function checkDfyContentHealth(): Promise<DfyContentHealthReport> {
  const driveCounts = await activeCountsBySlug();
  const bySlug = new Map(driveCounts.map((c) => [c.slug, c]));

  const emptyDriveSlugs: string[] = [];
  const failedSyncSlugs: string[] = [];
  const syncStatusBySlug: DfySlugSyncStatus[] = [];
  for (const slug of Object.keys(DRIVE_FOLDERS_TO_SYNC)) {
    const c = bySlug.get(slug);
    if (!c || c.active === 0) emptyDriveSlugs.push(slug);
    const last = await lastSyncStatusFor(slug);
    if (last && last.status !== "ok") failedSyncSlugs.push(slug);
    syncStatusBySlug.push({
      slug,
      totalAssets: c?.total ?? 0,
      activeAssets: c?.active ?? 0,
      lastSyncStatus: last?.status ?? null,
      lastSyncStartedAt: last?.startedAt ? last.startedAt.toISOString() : null,
      lastSyncError: last?.error ?? null,
    });
  }

  const [bridgePages, highlightCovers, advertorialPages] = await Promise.all([
    countTable(dfyBridgePagesTable),
    countTable(dfyHighlightCoversTable),
    countTable(dfyAdvertorialPagesTable),
  ]);

  const report: DfyContentHealthReport = {
    emptyDriveSlugs,
    failedSyncSlugs,
    bridgePages,
    highlightCovers,
    advertorialPages,
    syncStatusBySlug,
  };

  if (
    emptyDriveSlugs.length ||
    failedSyncSlugs.length ||
    bridgePages === 0 ||
    highlightCovers === 0 ||
    advertorialPages === 0
  ) {
    logger.warn(
      {
        event: "dfy-content-health-gap",
        ...report,
      },
      `dfy-content-health: gaps detected (emptyDrive=${emptyDriveSlugs.join(",") || "-"}; failedSync=${failedSyncSlugs.join(",") || "-"}; bridge=${bridgePages}; highlight=${highlightCovers}; advertorial=${advertorialPages})`,
    );
    // Task #534: when the bridge-pages catalog has been wiped (whatever
    // caused it - manual SQL, dev DB rollback, future migration) the
    // health probe is the cheapest signal we have. Trigger the same
    // self-heal sheet importer the boot path uses so the portal page
    // recovers automatically instead of staying on the empty state
    // until an admin notices and clicks "Sync from sheet".
    if (bridgePages === 0) {
      void (async () => {
        try {
          const { ensureBridgePagesPopulated } = await import(
            "./dfy-bridge-pages-importer"
          );
          await ensureBridgePagesPopulated("health-check");
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            "dfy-content-health: bridge-pages self-heal trigger failed",
          );
        }
      })();
    }
  } else {
    logger.info(
      { event: "dfy-content-health-ok", ...report },
      "dfy-content-health: ok",
    );
  }

  return report;
}

export async function runDfyContentHealthOnBoot(): Promise<void> {
  try {
    await checkDfyContentHealth();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "dfy-content-health: check failed",
    );
  }
}
