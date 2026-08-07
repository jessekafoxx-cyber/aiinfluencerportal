// T441: Weekly importer for the DFY Advertorial Pages catalog.
//
// Pulls Greg's curated advertorial-page templates from a Google Sheet
// and upserts them into `dfy_advertorial_pages`. Manual rows
// (source = "manual") are never touched - admins keep ownership of
// anything they entered in the portal UI. Sheet rows are upserted by
// `(source, sourceRowKey)` where the row key is the install URL (or
// the preview URL if no install URL is present).
//
// Mirrors the bridge-pages importer flow: schedule a weekly re-run
// from the worker entry, plus an admin-only on-demand sync. Honors the
// ADVERTORIAL_PAGES_SYNC_DISABLED=1 kill switch.

import { db, dfyAdvertorialPagesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const SHEET_ID = "19dOO8XigbAKr9UFNxLA_dDIYDf3ijdY5iXT_fUsGRAw";
const SHEET_RANGE = "A:Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdvertorialPagesImportReport {
  ok: boolean;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
  errorKind?: "no-connection" | "auth" | "other";
}

export interface AdvertorialPagesSyncStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastReport: AdvertorialPagesImportReport | null;
  lastError: string | null;
  lastErrorKind: "no-connection" | "auth" | "other" | null;
  inFlight: boolean;
  weeklyScheduled: boolean;
  nextScheduledAt: string | null;
}

const status: AdvertorialPagesSyncStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastReport: null,
  lastError: null,
  lastErrorKind: null,
  inFlight: false,
  weeklyScheduled: false,
  nextScheduledAt: null,
};

export function getAdvertorialPagesSyncStatus(): AdvertorialPagesSyncStatus {
  return { ...status };
}

function classifyError(msg: string): "no-connection" | "auth" | "other" {
  const m = msg.toLowerCase();
  if (m.includes("no connection found") || m.includes("connector:")) return "no-connection";
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden")) return "auth";
  return "other";
}

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

function driveImageUrl(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/) || raw.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) {
    return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600`;
  }
  return raw;
}

function parseTemplateNumber(raw: string, title: string): number | null {
  const tryParse = (s: string): number | null => {
    const m = s.match(/(\d{1,4})/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
  };
  if (raw) {
    const n = tryParse(raw);
    if (n != null) return n;
  }
  const tm = title.match(/template\s*#?\s*(\d{1,4})/i);
  if (tm) {
    const n = Number(tm[1]);
    if (Number.isFinite(n) && n > 0 && n < 10000) return n;
  }
  return null;
}

interface SheetRow {
  title: string;
  description: string | null;
  templateNumber: number | null;
  previewUrl: string;
  installUrl: string | null;
  screenshotUrl: string | null;
  sourceRowKey: string;
}

function rowsFromValues(grid: string[][]): SheetRow[] {
  if (!grid.length) return [];
  const header = grid[0].map((c) => (c || "").trim().toLowerCase());
  const idx = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const titleIdx = idx("template name", "name", "title", "advertorial");
  const numberIdx = idx("template number", "template #", "template#", "number", "#");
  const previewIdx = idx("preview link", "preview url", "preview", "live link", "live url");
  const installIdx = idx(
    "install link", "install url", "install template", "one-click install",
    "one click install", "template link", "template url", "import link", "import url",
    "share link",
  );
  const screenshotIdx = idx(
    "screenshot link", "screenshot", "image", "image url", "mockup", "thumbnail",
  );
  const descIdx = idx("description", "notes", "summary");

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] || "").trim() : "");

  // If the headers don't carry the expected names, try a positional
  // fallback: A=number/title, B=preview, C=install, D=screenshot.
  const positional = titleIdx < 0 && previewIdx < 0;

  const out: SheetRow[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((c) => c && c.trim().length)) continue;

    let previewUrl: string | null;
    let installUrl: string | null;

    if (positional) {
      previewUrl = normaliseUrl((row[1] || "").trim());
      installUrl = normaliseUrl((row[2] || "").trim());
    } else {
      previewUrl = normaliseUrl(cell(row, previewIdx));
      installUrl = normaliseUrl(cell(row, installIdx));
    }

    if (!previewUrl) continue;

    // Use the install URL as the stable key, falling back to preview URL.
    const sourceRowKey = (installUrl || previewUrl).toLowerCase();
    if (seen.has(sourceRowKey)) continue;
    seen.add(sourceRowKey);

    // Task #539: number cards by sheet row order, ignoring the Name column.
    const templateNumber = out.length + 1;
    out.push({
      title: `Template ${templateNumber}`,
      description: null,
      templateNumber,
      previewUrl,
      installUrl,
      screenshotUrl: null,
      sourceRowKey,
    });
  }
  return out;
}

let inFlight: Promise<AdvertorialPagesImportReport> | null = null;

export async function syncAdvertorialPagesFromSheet(): Promise<AdvertorialPagesImportReport> {
  if (process.env["ADVERTORIAL_PAGES_SYNC_DISABLED"] === "1") {
    logger.info("advertorial-pages-sync: skipped (ADVERTORIAL_PAGES_SYNC_DISABLED=1)");
    return { ok: true, totalRows: 0, inserted: 0, updated: 0, skipped: 0 };
  }
  if (inFlight) return inFlight;
  status.inFlight = true;
  status.lastAttemptAt = new Date().toISOString();
  inFlight = run().finally(() => {
    inFlight = null;
    status.inFlight = false;
  });
  return inFlight;
}

async function run(): Promise<AdvertorialPagesImportReport> {
  const report: AdvertorialPagesImportReport = {
    ok: false, totalRows: 0, inserted: 0, updated: 0, skipped: 0,
  };
  try {
    const values = await fetchSheetValues();
    const rows = rowsFromValues(values);
    report.totalRows = rows.length;
    if (!rows.length) {
      logger.warn("advertorial-pages-sync: sheet returned 0 usable rows");
      report.ok = true;
      return report;
    }

    const existing = await db
      .select({
        id: dfyAdvertorialPagesTable.id,
        sourceRowKey: dfyAdvertorialPagesTable.sourceRowKey,
        title: dfyAdvertorialPagesTable.title,
        previewUrl: dfyAdvertorialPagesTable.previewUrl,
        installUrl: dfyAdvertorialPagesTable.installUrl,
        previewImageUrl: dfyAdvertorialPagesTable.previewImageUrl,
        templateNumber: dfyAdvertorialPagesTable.templateNumber,
        sortOrder: dfyAdvertorialPagesTable.sortOrder,
        description: dfyAdvertorialPagesTable.description,
      })
      .from(dfyAdvertorialPagesTable)
      .where(eq(dfyAdvertorialPagesTable.source, "sheet"));
    const byKey = new Map<string, typeof existing[number]>();
    for (const e of existing) {
      if (e.sourceRowKey) byKey.set(e.sourceRowKey, e);
    }

    let pos = 0;
    for (const row of rows) {
      pos += 1;
      const cur = byKey.get(row.sourceRowKey);
      if (cur) {
        const patch: Partial<typeof dfyAdvertorialPagesTable.$inferInsert> & {
          updatedAt: Date;
        } = { updatedAt: new Date() };
        let changed = false;
        if (cur.title !== row.title) { patch.title = row.title; changed = true; }
        if (cur.previewUrl !== row.previewUrl) { patch.previewUrl = row.previewUrl; changed = true; }
        if ((cur.installUrl || null) !== (row.installUrl || null)) {
          patch.installUrl = row.installUrl;
          changed = true;
        }
        if ((cur.previewImageUrl || null) !== (row.screenshotUrl || null)) {
          patch.previewImageUrl = row.screenshotUrl;
          changed = true;
        }
        if ((cur.templateNumber ?? null) !== (row.templateNumber ?? null)) {
          patch.templateNumber = row.templateNumber;
          changed = true;
        }
        if (row.description != null && (cur.description || null) !== row.description) {
          patch.description = row.description;
          changed = true;
        }
        if (!changed) {
          report.skipped += 1;
          continue;
        }
        await db
          .update(dfyAdvertorialPagesTable)
          .set(patch)
          .where(
            and(
              eq(dfyAdvertorialPagesTable.source, "sheet"),
              eq(dfyAdvertorialPagesTable.sourceRowKey, row.sourceRowKey),
            ),
          );
        report.updated += 1;
      } else {
        const inserted = await db
          .insert(dfyAdvertorialPagesTable)
          .values({
            title: row.title,
            description: row.description,
            templateNumber: row.templateNumber,
            previewUrl: row.previewUrl,
            installUrl: row.installUrl,
            previewImageUrl: row.screenshotUrl,
            sortOrder: row.templateNumber ?? pos,
            source: "sheet",
            sourceRowKey: row.sourceRowKey,
          })
          .returning({ id: dfyAdvertorialPagesTable.id });
        if (inserted.length > 0) report.inserted += 1;
        else report.skipped += 1;
      }
    }

    report.ok = true;
    logger.info(
      {
        event: "advertorial-pages-sync-done",
        totalRows: report.totalRows,
        inserted: report.inserted,
        updated: report.updated,
        skipped: report.skipped,
      },
      `advertorial-pages-sync: ok (in=${report.inserted} up=${report.updated} skip=${report.skipped})`,
    );
    status.lastSuccessAt = new Date().toISOString();
    status.lastReport = { ...report };
    status.lastError = null;
    status.lastErrorKind = null;
    return report;
  } catch (err: any) {
    const msg = err?.message || String(err);
    report.error = msg;
    report.errorKind = classifyError(msg);
    status.lastReport = { ...report };
    status.lastError = msg;
    status.lastErrorKind = report.errorKind;
    if (report.errorKind === "no-connection") {
      logger.warn(
        { err: msg },
        "advertorial-pages-sync: skipped (google-sheet connector not configured)",
      );
    } else {
      logger.error({ err: msg, errorKind: report.errorKind }, "advertorial-pages-sync: failed");
    }
    return report;
  }
}

let bootRan = false;
export async function ensureAdvertorialPagesImportedOnBoot(): Promise<void> {
  if (bootRan) return;
  bootRan = true;
  if (process.env["ADVERTORIAL_PAGES_SYNC_DISABLED"] === "1") return;
  try {
    const [existing] = await db
      .select({ id: dfyAdvertorialPagesTable.id })
      .from(dfyAdvertorialPagesTable)
      .where(eq(dfyAdvertorialPagesTable.source, "sheet"))
      .limit(1);
    if (existing) {
      logger.info("advertorial-pages-sync: boot import skipped (sheet rows already present)");
      return;
    }
    logger.info("advertorial-pages-sync: running boot import (no sheet rows yet)");
    await syncAdvertorialPagesFromSheet();
  } catch (err) {
    logger.error({ err }, "advertorial-pages-sync: boot import failed");
  }
}

export function scheduleNextWeeklyAdvertorialPagesSync(): void {
  if (process.env["ADVERTORIAL_PAGES_SYNC_DISABLED"] === "1") {
    logger.info("advertorial-pages-sync: weekly schedule disabled (ADVERTORIAL_PAGES_SYNC_DISABLED=1)");
    status.weeklyScheduled = false;
    status.nextScheduledAt = null;
    return;
  }
  status.weeklyScheduled = true;
  status.nextScheduledAt = new Date(Date.now() + WEEK_MS).toISOString();
  logger.info(
    { nextRunIn: `${(WEEK_MS / 3600000).toFixed(0)}h`, nextScheduledAt: status.nextScheduledAt },
    "advertorial-pages-sync: scheduled next weekly sync",
  );
  setTimeout(() => {
    syncAdvertorialPagesFromSheet().catch((err) =>
      logger.error({ err }, "advertorial-pages-sync: scheduled run failed"),
    );
    scheduleNextWeeklyAdvertorialPagesSync();
  }, WEEK_MS);
}
