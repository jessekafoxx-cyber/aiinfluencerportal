// Weekly importer for the DFY 5+ Sales Funnel Templates gallery.
//
// Pulls Greg's curated funnel templates from a Google Sheet and upserts
// them into `dfy_templates` (category = 'funnel_template'). Sheet rows
// are tracked via `sourceDisplayId = 'sheet:<rowKey>'` and only those
// rows are ever updated/deleted by this importer - admin-created rows
// (manually added in the portal UI, with a different sourceDisplayId)
// are left alone.
//
// Sheet columns (auto-detected by header name, first tab):
//   Template Name | Preview Link | Template Link | Screenshot Link
// Mapped onto dfy_templates as:
//   title       <- Template Name
//   live_url    <- Preview Link        (renders as "Open live page")
//   canva_url   <- Template Link       (renders as "Use template" for
//                                        funnel_template category)
//   image_url   <- Screenshot Link     (gallery thumbnail; Drive view
//                                        URLs are normalised to a public
//                                        /thumbnail?id=... endpoint)
//
// Schedule: re-runs once a week from the worker entry. Honors the
// FUNNEL_TEMPLATES_SYNC_DISABLED=1 kill switch.

import { db, dfyTemplatesTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { createHash } from "node:crypto";
import { logger } from "./logger";

const SHEET_ID = "1xQy-sD0ef664dOi7-TFqO0mQMrkvfM8x8rDGUReriJ4";
const SHEET_RANGE = "A:Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORY = "funnel_template";
const SOURCE_PREFIX = "sheet:";

export interface FunnelTemplatesImportReport {
  ok: boolean;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
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

interface SheetRow {
  title: string;
  previewUrl: string;
  templateUrl: string;
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
  const titleIdx = idx("template name", "name", "title", "funnel name");
  const previewIdx = idx("preview link", "preview url", "preview", "live link", "live url");
  const templateIdx = idx("template link", "template url", "clone link", "clone url", "share link", "download", "download link");
  const screenshotIdx = idx("screenshot link", "screenshot", "image", "image url", "thumbnail", "thumbnail url");

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

    // Use a short, stable hash of the template URL (or preview URL as
    // fallback) as the row key so the persisted `sheet:<key>` value
    // always fits inside `dfy_templates.source_display_id` (varchar 64).
    // Lowercased before hashing so URL casing differences collapse to
    // the same row, mirroring the bridge-pages dedupe behaviour.
    const sourceRowKey = createHash("sha256")
      .update((templateUrl || previewUrl).toLowerCase())
      .digest("hex")
      .slice(0, 32);
    if (seen.has(sourceRowKey)) continue;
    seen.add(sourceRowKey);
    out.push({
      title,
      previewUrl,
      templateUrl: templateUrl || previewUrl,
      screenshotUrl,
      sourceRowKey,
    });
  }
  return out;
}

let inFlight: Promise<FunnelTemplatesImportReport> | null = null;

export async function syncFunnelTemplatesFromSheet(): Promise<FunnelTemplatesImportReport> {
  if (process.env["FUNNEL_TEMPLATES_SYNC_DISABLED"] === "1") {
    logger.info("funnel-templates-sync: skipped (FUNNEL_TEMPLATES_SYNC_DISABLED=1)");
    return { ok: true, totalRows: 0, inserted: 0, updated: 0, skipped: 0 };
  }
  if (inFlight) return inFlight;
  inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run(): Promise<FunnelTemplatesImportReport> {
  const report: FunnelTemplatesImportReport = {
    ok: false, totalRows: 0, inserted: 0, updated: 0, skipped: 0,
  };
  try {
    const values = await fetchSheetValues();
    const rows = rowsFromValues(values);
    report.totalRows = rows.length;
    if (!rows.length) {
      logger.warn("funnel-templates-sync: sheet returned 0 usable rows");
      report.ok = true;
      return report;
    }

    // Pre-load existing sheet-sourced rows so we know which to update
    // vs insert. Manual rows (sourceDisplayId not starting with
    // "sheet:") are never touched.
    const existing = await db
      .select({
        id: dfyTemplatesTable.id,
        sourceDisplayId: dfyTemplatesTable.sourceDisplayId,
        title: dfyTemplatesTable.title,
        liveUrl: dfyTemplatesTable.liveUrl,
        canvaUrl: dfyTemplatesTable.canvaUrl,
        imageUrl: dfyTemplatesTable.imageUrl,
        sortOrder: dfyTemplatesTable.sortOrder,
      })
      .from(dfyTemplatesTable)
      .where(
        and(
          eq(dfyTemplatesTable.category, CATEGORY),
          like(dfyTemplatesTable.sourceDisplayId, `${SOURCE_PREFIX}%`),
        ),
      );
    const byKey = new Map<string, typeof existing[number]>();
    for (const e of existing) {
      if (e.sourceDisplayId && e.sourceDisplayId.startsWith(SOURCE_PREFIX)) {
        byKey.set(e.sourceDisplayId.slice(SOURCE_PREFIX.length), e);
      }
    }

    let pos = 0;
    for (const row of rows) {
      pos += 1;
      const sourceDisplayId = `${SOURCE_PREFIX}${row.sourceRowKey}`;
      const cur = byKey.get(row.sourceRowKey);
      if (cur) {
        const patch: Partial<typeof dfyTemplatesTable.$inferInsert> & {
          updatedAt: Date;
        } = { updatedAt: new Date() };
        let changed = false;
        if (cur.title !== row.title) { patch.title = row.title; changed = true; }
        if ((cur.liveUrl || null) !== row.previewUrl) { patch.liveUrl = row.previewUrl; changed = true; }
        if ((cur.canvaUrl || null) !== row.templateUrl) { patch.canvaUrl = row.templateUrl; changed = true; }
        if ((cur.imageUrl || null) !== (row.screenshotUrl || null)) {
          patch.imageUrl = row.screenshotUrl;
          changed = true;
        }
        if (cur.sortOrder !== pos) { patch.sortOrder = pos; changed = true; }
        if (!changed) {
          report.skipped += 1;
          continue;
        }
        await db
          .update(dfyTemplatesTable)
          .set(patch)
          .where(
            and(
              eq(dfyTemplatesTable.category, CATEGORY),
              eq(dfyTemplatesTable.sourceDisplayId, sourceDisplayId),
            ),
          );
        report.updated += 1;
      } else {
        const inserted = await db
          .insert(dfyTemplatesTable)
          .values({
            category: CATEGORY,
            sourceDisplayId,
            title: row.title,
            imageUrl: row.screenshotUrl,
            mediaKind: "image",
            canvaUrl: row.templateUrl,
            liveUrl: row.previewUrl,
            sortOrder: pos,
            isActive: true,
          })
          .onConflictDoNothing({
            target: [dfyTemplatesTable.category, dfyTemplatesTable.sourceDisplayId],
          })
          .returning({ id: dfyTemplatesTable.id });
        if (inserted.length > 0) report.inserted += 1;
        else report.skipped += 1;
      }
    }

    report.ok = true;
    logger.info(
      {
        event: "funnel-templates-sync-done",
        totalRows: report.totalRows,
        inserted: report.inserted,
        updated: report.updated,
        skipped: report.skipped,
      },
      `funnel-templates-sync: ok (in=${report.inserted} up=${report.updated} skip=${report.skipped})`,
    );
    return report;
  } catch (err: any) {
    report.error = err?.message || String(err);
    logger.error({ err: report.error }, "funnel-templates-sync: failed");
    return report;
  }
}

let bootRan = false;
export async function ensureFunnelTemplatesImportedOnBoot(): Promise<void> {
  if (bootRan) return;
  bootRan = true;
  if (process.env["FUNNEL_TEMPLATES_SYNC_DISABLED"] === "1") return;
  try {
    const [existing] = await db
      .select({ id: dfyTemplatesTable.id })
      .from(dfyTemplatesTable)
      .where(
        and(
          eq(dfyTemplatesTable.category, CATEGORY),
          like(dfyTemplatesTable.sourceDisplayId, `${SOURCE_PREFIX}%`),
        ),
      )
      .limit(1);
    if (existing) {
      logger.info("funnel-templates-sync: boot import skipped (sheet rows already present)");
      return;
    }
    logger.info("funnel-templates-sync: running boot import (no sheet rows yet)");
    await syncFunnelTemplatesFromSheet();
  } catch (err) {
    logger.error({ err }, "funnel-templates-sync: boot import failed");
  }
}

export function scheduleNextWeeklyFunnelTemplatesSync(): void {
  if (process.env["FUNNEL_TEMPLATES_SYNC_DISABLED"] === "1") {
    logger.info("funnel-templates-sync: weekly schedule disabled (FUNNEL_TEMPLATES_SYNC_DISABLED=1)");
    return;
  }
  logger.info(
    { nextRunIn: `${(WEEK_MS / 3600000).toFixed(0)}h` },
    "funnel-templates-sync: scheduled next weekly sync",
  );
  setTimeout(() => {
    syncFunnelTemplatesFromSheet().catch((err) =>
      logger.error({ err }, "funnel-templates-sync: scheduled run failed"),
    );
    scheduleNextWeeklyFunnelTemplatesSync();
  }, WEEK_MS);
}
