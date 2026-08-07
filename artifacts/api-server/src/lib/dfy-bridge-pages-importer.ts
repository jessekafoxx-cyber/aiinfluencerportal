// T402: Weekly importer for the DFY Bridge Pages catalog.
//
// Pulls Greg's curated bridge-page templates from a Google Sheet and
// upserts them into `dfy_bridge_pages`. Manual rows (source = "manual")
// are never touched - admins keep ownership of anything they entered
// in the portal UI. Sheet rows are upserted by `(source, sourceRowKey)`
// where the row key is the normalised template URL.
//
// Sheet columns (gid=0):
//   Template Name | Preview Link | Template Link | Screenshot Link
// Bonus number is parsed from "Bonus Template N" / "Bonus N" titles.
//
// Schedule: re-runs once a week from the worker entry. Honors the
// BRIDGE_PAGES_SYNC_DISABLED=1 kill switch.

import { db, dfyBridgePagesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";
import { normalizeDriveImageUrl } from "./drive-image-url";

const SHEET_ID = "15zlmOtniwbtvfd6i2Wcikny0D9a5M_ILBcc9PjTbmII";
// Pull every column on the first tab. The sheet only has 4 named
// columns today (Template Name / Preview Link / Template Link /
// Screenshot Link), but A:Z is forward-compatible if Greg adds an
// explicit Description or Bonus column later - the importer maps
// those by header name when they appear.
const SHEET_RANGE = "A:Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BridgePagesImportReport {
  ok: boolean;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
}

// Read every cell from the first tab via the authenticated Google
// Sheets API v4 (`spreadsheets.values.get`). Uses the existing
// google-sheet connector credentials so the sheet's sharing settings
// don't have to allow public/anonymous reads.
async function fetchSheetValues(): Promise<string[][]> {
  const connectors = new ReplitConnectors();
  const resp = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}/values/${encodeURIComponent(SHEET_RANGE)}`,
    { method: "GET" },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Sheets read failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { values?: string[][] };
  return json?.values || [];
}

// Sheet links are admin-edited but treat them as untrusted: only http(s)
// URLs are persisted. A bare "app.gohighlevel.com/..." gets a "https://"
// prefix so the existing <a href> renders as an absolute link.
function normaliseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) {
      s = `https://${s}`;
    } else {
      return null;
    }
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Task #742: Drive URL → direct-image CDN URL normalisation is shared
// with the admin POST/PATCH handlers via `lib/drive-image-url.ts`. We
// reuse the same helper here so sheet-sourced rows benefit from the
// same fix automatically.
const driveImageUrl = (raw: string | null): string | null => normalizeDriveImageUrl(raw);

function parseBonusNumber(title: string): number | null {
  const m = title.match(/bonus(?:\s+template)?\s*#?\s*(\d{1,3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

interface SheetRow {
  title: string;
  description: string | null;
  previewUrl: string;
  templateUrl: string;
  screenshotUrl: string | null;
  bonusNumber: number | null;
  sourceRowKey: string;
}

function rowsFromValues(grid: string[][]): SheetRow[] {
  if (!grid.length) return [];
  // First row is the header (Template Name, Preview Link, Template Link,
  // Screenshot Link, optionally Description and Bonus). Find columns by
  // header name so reordering / new columns added later don't break us.
  const header = grid[0].map((c) => (c || "").trim().toLowerCase());
  const idx = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const titleIdx = idx("template name", "name", "title");
  const previewIdx = idx("preview link", "preview url", "preview");
  const templateIdx = idx("template link", "template url", "download", "download link");
  const screenshotIdx = idx("screenshot link", "screenshot", "image", "image url");
  // Optional columns - mapped explicitly when present so we honour
  // the sheet rather than parsing data out of the title.
  const descIdx = idx("description", "notes", "summary");
  const bonusIdx = idx("bonus number", "bonus", "bonus #", "bonus#");

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] || "").trim() : "");

  const out: SheetRow[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((c) => c && c.trim().length)) continue;
    const title = cell(row, titleIdx);
    const previewUrl = normaliseUrl(cell(row, previewIdx));
    const templateUrl = normaliseUrl(cell(row, templateIdx));
    const screenshotUrl = driveImageUrl(normaliseUrl(cell(row, screenshotIdx)));
    if (!title || !previewUrl) continue;

    // Prefer an explicit Bonus column when the sheet has one. Fall
    // back to parsing "Bonus Template N" out of the title only if no
    // Bonus column exists or the column is blank for this row.
    let bonusNumber: number | null = null;
    if (bonusIdx >= 0) {
      const raw = cell(row, bonusIdx);
      if (raw) {
        const m = raw.match(/(\d{1,3})/);
        if (m) {
          const n = Number(m[1]);
          if (Number.isFinite(n) && n > 0 && n < 1000) bonusNumber = n;
        }
      }
    }
    if (bonusNumber == null) bonusNumber = parseBonusNumber(title);

    const description = descIdx >= 0 ? cell(row, descIdx) || null : null;

    // Use the template URL as the stable key. Falls back to the preview
    // URL if no template link is given (rare, but harmless).
    const sourceRowKey = (templateUrl || previewUrl).toLowerCase();
    if (seen.has(sourceRowKey)) continue;
    seen.add(sourceRowKey);
    out.push({
      title,
      description,
      previewUrl,
      templateUrl: templateUrl || previewUrl,
      screenshotUrl,
      bonusNumber,
      sourceRowKey,
    });
  }
  return out;
}

let inFlight: Promise<BridgePagesImportReport> | null = null;

export async function syncBridgePagesFromSheet(): Promise<BridgePagesImportReport> {
  if (process.env["BRIDGE_PAGES_SYNC_DISABLED"] === "1") {
    logger.info("bridge-pages-sync: skipped (BRIDGE_PAGES_SYNC_DISABLED=1)");
    return { ok: true, totalRows: 0, inserted: 0, updated: 0, skipped: 0 };
  }
  if (inFlight) return inFlight;
  inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run(): Promise<BridgePagesImportReport> {
  const report: BridgePagesImportReport = {
    ok: false, totalRows: 0, inserted: 0, updated: 0, skipped: 0,
  };
  try {
    const values = await fetchSheetValues();
    const rows = rowsFromValues(values);
    report.totalRows = rows.length;
    if (!rows.length) {
      logger.warn("bridge-pages-sync: sheet returned 0 usable rows");
      report.ok = true;
      return report;
    }

    // Pre-load existing sheet-sourced rows so we know which ones to
    // update vs insert. We never touch source = "manual" rows.
    const existing = await db
      .select({
        id: dfyBridgePagesTable.id,
        sourceRowKey: dfyBridgePagesTable.sourceRowKey,
        title: dfyBridgePagesTable.title,
        url: dfyBridgePagesTable.url,
        previewImageUrl: dfyBridgePagesTable.previewImageUrl,
        downloadUrl: dfyBridgePagesTable.downloadUrl,
        bonusNumber: dfyBridgePagesTable.bonusNumber,
        sortOrder: dfyBridgePagesTable.sortOrder,
        description: dfyBridgePagesTable.description,
      })
      .from(dfyBridgePagesTable)
      .where(eq(dfyBridgePagesTable.source, "sheet"));
    const byKey = new Map<string, typeof existing[number]>();
    for (const e of existing) {
      if (e.sourceRowKey) byKey.set(e.sourceRowKey, e);
    }

    let pos = 0;
    for (const row of rows) {
      pos += 1;
      const cur = byKey.get(row.sourceRowKey);
      if (cur) {
        const patch: Partial<typeof dfyBridgePagesTable.$inferInsert> & {
          updatedAt: Date;
        } = { updatedAt: new Date() };
        let changed = false;
        if (cur.title !== row.title) { patch.title = row.title; changed = true; }
        if (cur.url !== row.previewUrl) { patch.url = row.previewUrl; changed = true; }
        if (cur.downloadUrl !== row.templateUrl) { patch.downloadUrl = row.templateUrl; changed = true; }
        if ((cur.previewImageUrl || null) !== (row.screenshotUrl || null)) {
          patch.previewImageUrl = row.screenshotUrl;
          changed = true;
        }
        if ((cur.bonusNumber ?? null) !== (row.bonusNumber ?? null)) {
          patch.bonusNumber = row.bonusNumber;
          changed = true;
        }
        // Only overwrite description from the sheet when the sheet
        // actually carries a Description column for this row. Treat a
        // null row.description as "sheet has nothing to say" and leave
        // any existing value alone, so admins can hand-author copy in
        // the portal without it being clobbered every week.
        if (row.description != null && (cur.description || null) !== row.description) {
          patch.description = row.description;
          changed = true;
        }
        if (!changed) {
          report.skipped += 1;
          continue;
        }
        await db
          .update(dfyBridgePagesTable)
          .set(patch)
          .where(
            and(
              eq(dfyBridgePagesTable.source, "sheet"),
              eq(dfyBridgePagesTable.sourceRowKey, row.sourceRowKey),
            ),
          );
        report.updated += 1;
      } else {
        // Drop onConflictDoNothing + use returning() so the report
        // counts only reflect rows we actually wrote. A unique-key
        // collision under a race shows up as skipped, not inserted.
        const inserted = await db
          .insert(dfyBridgePagesTable)
          .values({
            title: row.title,
            description: row.description,
            url: row.previewUrl,
            previewImageUrl: row.screenshotUrl,
            downloadUrl: row.templateUrl,
            sortOrder: row.bonusNumber ?? pos,
            bonusNumber: row.bonusNumber,
            source: "sheet",
            sourceRowKey: row.sourceRowKey,
          })
          .returning({ id: dfyBridgePagesTable.id });
        if (inserted.length > 0) report.inserted += 1;
        else report.skipped += 1;
      }
    }

    report.ok = true;
    logger.info(
      {
        event: "bridge-pages-sync-done",
        totalRows: report.totalRows,
        inserted: report.inserted,
        updated: report.updated,
        skipped: report.skipped,
      },
      `bridge-pages-sync: ok (in=${report.inserted} up=${report.updated} skip=${report.skipped})`,
    );
    return report;
  } catch (err: any) {
    report.error = err?.message || String(err);
    logger.error({ err: report.error }, "bridge-pages-sync: failed");
    return report;
  }
}

let bootRan = false;
export async function ensureBridgePagesImportedOnBoot(): Promise<void> {
  if (bootRan) return;
  bootRan = true;
  await ensureBridgePagesPopulated("boot");
}

// Task #534: Self-heal entry point. Triggers a fresh sheet sync whenever
// the dfy_bridge_pages catalog is completely empty (sheet + manual = 0)
// OR when only sheet-tagged rows exist but the sheet count is zero (the
// original "first deploy seeding" case kept for backwards compat).
//
// Replaces the old "only seed if zero sheet rows once per process"
// behavior: if some out-of-band wipe (manual `DELETE`, dev DB reset,
// cascading drop) emptied the table after boot, the next call here will
// rehydrate it instead of leaving the portal Bridge Pages tab on the
// "No bridge page templates yet" empty state until an admin clicks
// Sync. Honors the BRIDGE_PAGES_SYNC_DISABLED=1 kill switch.
export async function ensureBridgePagesPopulated(
  reason: "boot" | "health-check" | "on-demand",
): Promise<BridgePagesImportReport | null> {
  if (process.env["BRIDGE_PAGES_SYNC_DISABLED"] === "1") {
    logger.info(
      { reason },
      "bridge-pages-sync: ensureBridgePagesPopulated skipped (BRIDGE_PAGES_SYNC_DISABLED=1)",
    );
    return null;
  }
  try {
    const [{ total = 0, sheetTotal = 0 } = {} as { total: number; sheetTotal: number }] =
      (await db
        .select({
          total: sql<number>`count(*)::int`,
          sheetTotal: sql<number>`count(*) filter (where ${dfyBridgePagesTable.source} = 'sheet')::int`,
        })
        .from(dfyBridgePagesTable)) as Array<{ total: number; sheetTotal: number }>;
    if (total > 0 && sheetTotal > 0) {
      logger.info(
        { reason, total, sheetTotal },
        "bridge-pages-sync: catalog already populated, skipping re-import",
      );
      return null;
    }
    const detail = total === 0 ? "catalog empty" : "no sheet rows present";
    logger.warn(
      { reason, total, sheetTotal, event: "bridge-pages-self-heal-trigger" },
      `bridge-pages-sync: ${detail} (total=${total} sheet=${sheetTotal}), running re-import`,
    );
    return await syncBridgePagesFromSheet();
  } catch (err) {
    logger.error({ err, reason }, "bridge-pages-sync: ensureBridgePagesPopulated failed");
    return null;
  }
}

export function scheduleNextWeeklyBridgePagesSync(): void {
  if (process.env["BRIDGE_PAGES_SYNC_DISABLED"] === "1") {
    logger.info("bridge-pages-sync: weekly schedule disabled (BRIDGE_PAGES_SYNC_DISABLED=1)");
    return;
  }
  logger.info(
    { nextRunIn: `${(WEEK_MS / 3600000).toFixed(0)}h` },
    "bridge-pages-sync: scheduled next weekly sync",
  );
  setTimeout(() => {
    syncBridgePagesFromSheet().catch((err) =>
      logger.error({ err }, "bridge-pages-sync: scheduled run failed"),
    );
    scheduleNextWeeklyBridgePagesSync();
  }, WEEK_MS);
}
