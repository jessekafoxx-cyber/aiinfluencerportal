import { db, funnelsResearchBoardItems, funnelsResearchBoardSyncStatus } from "@workspace/db";
import { eq, notInArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  driveFileIdFromAny,
  drivePdfDownloadUrl,
  processPendingFunnelsPreviewsInBackground,
} from "./funnels-preview-downloader";
import {
  startSyncSession,
  recordSessionEvent,
  updateSessionCounters,
  completeSyncSession,
  type SyncTrigger as SessionTrigger,
} from "./sync-session";

const SHEET_ID = "1H7SV9iINMB5AtWVi5xDmBsPMchw6MpK_aB7l0o6OF4w";
const SHEET_GID = 0;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const FETCH_TIMEOUT_MS = 20_000;
const SYNC_STATUS_ID = 1;

// Sheet contents are operator-edited but we still treat them as untrusted.
// Only `http` and `https` URLs are persisted/served downstream so a stray
// `javascript:` or `data:` href cannot reach the funnels card UI.
function safeWebUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return trimmed;
    return null;
  } catch {
    return null;
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchSheetCsv(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(CSV_URL, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "ApexOffersFunnelsBoardSync/1.0" },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Sheet CSV fetch failed (${resp.status}): ${body.slice(0, 200)}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

interface SyncResult {
  ok: boolean;
  totalRows: number;
  rowsUpserted: number;
  rowsPruned: number;
  error?: string;
}

let inFlightSync: Promise<SyncResult> | null = null;

export async function syncFunnelsResearchBoard(
  trigger: SessionTrigger = "manual",
): Promise<SyncResult> {
  if (inFlightSync) {
    logger.info("funnels-research-board: sync already in progress, returning shared promise");
    return inFlightSync;
  }
  inFlightSync = runSync(trigger).finally(() => { inFlightSync = null; });
  return inFlightSync;
}

async function runSync(trigger: SessionTrigger): Promise<SyncResult> {
  const sessionId = await startSyncSession({ board: "funnels-research", trigger });
  let result: SyncResult = { ok: false, totalRows: 0, rowsUpserted: 0, rowsPruned: 0 };
  try {
    await recordSessionEvent(sessionId, { kind: "fetch_started", message: "fetching sheet csv" });
    const csv = await fetchSheetCsv();
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new Error("Sheet returned no rows");
    }
    const dataRows = rows.slice(1);
    await recordSessionEvent(sessionId, {
      kind: "fetch_completed",
      message: `fetched ${dataRows.length} sheet rows`,
      detail: { totalRows: dataRows.length },
    });
    await updateSessionCounters(sessionId, { rowsFetched: dataRows.length });
    const seenKeys: string[] = [];
    let upserted = 0;

    // Header detection. The funnels sheet currently has:
    //   ID | LINK | TYPE | PREVIEW | PDF | GREG'S NOTES / THOUGHTS
    // We sniff so any column reorder still works, and we still tolerate the
    // older [ID, LINK, NOTES] or 6-col ad-shape layout.
    const headerRow = (rows[0] || []).map((c) => (c || "").trim().toLowerCase());
    const idxOf = (label: string): number => headerRow.findIndex((h) => h === label);
    const idxId = idxOf("id") >= 0 ? idxOf("id") : 0;
    const idxLink = idxOf("link") >= 0 ? idxOf("link") : 1;
    const idxType = idxOf("type");
    const idxAwareness = idxOf("awareness stage");
    const idxStyle = idxOf("style");
    const idxPreview = idxOf("preview");
    const idxPdf = idxOf("pdf");
    const notesHeaders = ["greg's notes / thoughts", "greg's notes & thoughts", "notes"];
    let idxNotes = -1;
    for (const h of notesHeaders) {
      const j = headerRow.indexOf(h);
      if (j >= 0) { idxNotes = j; break; }
    }
    if (idxNotes < 0) idxNotes = headerRow.length - 1;

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const idCell = (r[idxId] || "").trim();
      const linkCell = (r[idxLink] || "").trim();
      const typeCell = idxType >= 0 ? (r[idxType] || "").trim() : "";
      const awarenessCell = idxAwareness >= 0 ? (r[idxAwareness] || "").trim() : "";
      const styleCell = idxStyle >= 0 ? (r[idxStyle] || "").trim() : "";
      const notesCell = (r[idxNotes] || "").trim();
      const previewCell = idxPreview >= 0 ? (r[idxPreview] || "").trim() : "";
      const pdfCell = idxPdf >= 0 ? (r[idxPdf] || "").trim() : "";
      if (!idCell) continue;
      if (!linkCell || !/^https?:\/\//i.test(linkCell)) continue;

      const rowKey = idCell;
      const sortIndex = i + 1;
      seenKeys.push(rowKey);

      // Existing row so we can detect a previewSourceUrl change and re-queue
      // the preview download accordingly.
      const [existing] = await db
        .select({
          id: funnelsResearchBoardItems.id,
          previewSourceUrl: funnelsResearchBoardItems.previewSourceUrl,
          previewStatus: funnelsResearchBoardItems.previewStatus,
        })
        .from(funnelsResearchBoardItems)
        .where(eq(funnelsResearchBoardItems.rowKey, rowKey));

      const previewSourceUrl = safeWebUrl(previewCell);
      const pdfFileId = driveFileIdFromAny(pdfCell || null);
      // Persist a normalised PDF download URL when we can extract a Drive id;
      // otherwise keep the raw cell so non-Drive URLs still work — but only
      // after http(s) allowlisting so untrusted scheme URLs cannot reach the
      // funnels card UI's <a href>.
      const pdfSourceUrl = pdfFileId
        ? drivePdfDownloadUrl(pdfFileId)
        : safeWebUrl(pdfCell);

      const previewSourceChanged =
        !!previewSourceUrl && previewSourceUrl !== (existing?.previewSourceUrl || null);

      const updateSet: Record<string, unknown> = {
        sortIndex,
        funnelLink: linkCell,
        type: typeCell || null,
        awarenessStage: awarenessCell || null,
        style: styleCell || null,
        notes: notesCell || null,
        previewSourceUrl,
        pdfSourceUrl,
        updatedAt: sql`now()`,
      };
      if (previewSourceChanged) {
        // Re-trigger the preview pipeline for this row when the Drive link
        // changes (or first time it appears).
        updateSet.previewStatus = "pending";
        updateSet.previewError = null;
        updateSet.previewObjectPath = null;
        updateSet.previewContentType = null;
        updateSet.previewAttempts = 0;
        updateSet.previewDownloadedAt = null;
      } else if (!previewSourceUrl) {
        // No preview source: clear any stale preview state.
        updateSet.previewStatus = null;
        updateSet.previewError = null;
        updateSet.previewObjectPath = null;
        updateSet.previewContentType = null;
      }

      await db
        .insert(funnelsResearchBoardItems)
        .values({
          rowKey,
          sortIndex,
          funnelLink: linkCell,
          type: typeCell || null,
          awarenessStage: awarenessCell || null,
          style: styleCell || null,
          notes: notesCell || null,
          previewSourceUrl,
          pdfSourceUrl,
        })
        .onConflictDoUpdate({
          target: funnelsResearchBoardItems.rowKey,
          set: updateSet,
        });
      upserted++;
    }

    let pruned = 0;
    if (seenKeys.length > 0) {
      const del = await db
        .delete(funnelsResearchBoardItems)
        .where(notInArray(funnelsResearchBoardItems.rowKey, seenKeys))
        .returning({ id: funnelsResearchBoardItems.id });
      pruned = del.length;
    } else {
      const del = await db
        .delete(funnelsResearchBoardItems)
        .returning({ id: funnelsResearchBoardItems.id });
      pruned = del.length;
    }

    result = { ok: true, totalRows: dataRows.length, rowsUpserted: upserted, rowsPruned: pruned };

    await db
      .insert(funnelsResearchBoardSyncStatus)
      .values({
        id: SYNC_STATUS_ID,
        lastSyncedAt: new Date(),
        lastSyncOk: true,
        lastSyncError: null,
        rowsUpserted: upserted,
        rowsPruned: pruned,
        totalRows: dataRows.length,
      })
      .onConflictDoUpdate({
        target: funnelsResearchBoardSyncStatus.id,
        set: {
          lastSyncedAt: new Date(),
          lastSyncOk: true,
          lastSyncError: null,
          rowsUpserted: upserted,
          rowsPruned: pruned,
          totalRows: dataRows.length,
        },
      });

    logger.info(result, "funnels-research-board: sync complete");
    await completeSyncSession(sessionId, {
      status: "completed",
      counters: { rowsFetched: dataRows.length, rowsProcessed: upserted },
      summary: { rowsUpserted: upserted, rowsPruned: pruned, totalRows: dataRows.length },
    });
    // Kick the preview downloader for any rows that have a previewSourceUrl
    // but no cached preview yet (or that were re-queued above).
    await recordSessionEvent(sessionId, {
      kind: "downloader_kicked",
      message: "preview downloader queued",
    });
    processPendingFunnelsPreviewsInBackground();
    return result;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    logger.error({ err: errMsg }, "funnels-research-board: sync failed");
    try {
      await db
        .insert(funnelsResearchBoardSyncStatus)
        .values({
          id: SYNC_STATUS_ID,
          lastSyncedAt: new Date(),
          lastSyncOk: false,
          lastSyncError: errMsg.slice(0, 500),
        })
        .onConflictDoUpdate({
          target: funnelsResearchBoardSyncStatus.id,
          set: {
            lastSyncedAt: new Date(),
            lastSyncOk: false,
            lastSyncError: errMsg.slice(0, 500),
          },
        });
    } catch (statusErr) {
      logger.error({ err: statusErr }, "funnels-research-board: failed to record error status");
    }
    await completeSyncSession(sessionId, {
      status: "failed",
      error: errMsg.slice(0, 500),
    });
    return { ok: false, totalRows: 0, rowsUpserted: 0, rowsPruned: 0, error: errMsg };
  }
}

export async function getFunnelsResearchBoardSyncStatus() {
  const [row] = await db
    .select()
    .from(funnelsResearchBoardSyncStatus)
    .where(eq(funnelsResearchBoardSyncStatus.id, SYNC_STATUS_ID));
  return row || null;
}

function getMsUntilNext345amUTC(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 45, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function scheduleNextDailyFunnelsResearchBoardSync(): void {
  const ms = getMsUntilNext345amUTC();
  logger.info(
    { nextRunIn: `${(ms / 3600000).toFixed(1)}h` },
    "funnels-research-board: scheduled next daily sync (3:45am UTC)",
  );
  setTimeout(() => {
    syncFunnelsResearchBoard("scheduled").catch((err) =>
      logger.error({ err }, "funnels-research-board: scheduled run failed"),
    );
    scheduleNextDailyFunnelsResearchBoardSync();
  }, ms);
}

const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export async function ensureFunnelsResearchBoardFreshOnBoot(): Promise<void> {
  try {
    const status = await getFunnelsResearchBoardSyncStatus();
    const last = status?.lastSyncedAt ? new Date(status.lastSyncedAt).getTime() : 0;
    const stale = !last || Date.now() - last > STALE_AFTER_MS;
    if (stale) {
      logger.info({ lastSyncedAt: status?.lastSyncedAt || null }, "funnels-research-board: running boot sync (stale or missing)");
      await syncFunnelsResearchBoard("boot-freshness");
    } else {
      logger.info(
        { lastSyncedAt: status?.lastSyncedAt },
        "funnels-research-board: boot sync skipped (recent sync exists)",
      );
      // Still kick the preview queue in case any rows were left pending from
      // a prior crash mid-download.
      processPendingFunnelsPreviewsInBackground();
    }
  } catch (err) {
    logger.error({ err }, "funnels-research-board: boot sync check failed");
  }
}
