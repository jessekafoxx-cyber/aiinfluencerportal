import { db, adResearchBoardItems, adResearchBoardSyncStatus } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { logger } from "./logger";
import { processPendingMediaInBackground } from "./media-downloader";
import { classifyAdUrl } from "./ad-research-url-kind";
import { isUnsupportedExtractionUrl, normalizeSocialUrl } from "./media-downloader-helpers";
import {
  startSyncSession,
  recordSessionEvent,
  updateSessionCounters,
  completeSyncSession,
} from "./sync-session";

// Stable, short, content-derived key for sheet rows that don't have a
// human-authored ID in column A. We hash the ad link so the same row in the
// sheet always upserts to the same DB row, and a row reordering doesn't
// produce duplicates.
function autoRowKeyFromLink(link: string): string {
  const h = createHash("sha1").update(link).digest("hex").slice(0, 10);
  return `auto-${h}`;
}

// Task #403: canonical URL hash used by the dedupe path. md5 matches
// PG's built-in `md5()` byte-for-byte (no pgcrypto required) so the
// JS-side hash and the SQL backfill in 0044_t403_canonical_url_hash.sql
// agree on identity.
function canonicalUrlHashFor(normalizedUrl: string): string {
  return createHash("md5").update(normalizedUrl).digest("hex");
}

const SHEET_ID = "1BCgnCEvO_A1TePotXvD1Wo2JYUsyp56G_wpV5qj834M";
const SHEET_GID = 0;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const FETCH_TIMEOUT_MS = 20_000;
const SYNC_STATUS_ID = 1;

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
      headers: { "User-Agent": "ApexOffersBoardSync/1.0" },
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

export type SyncTrigger = "manual" | "scheduled" | "boot-freshness";

export type SyncOutcome =
  | "full_success"
  | "partial_fetch_continue"
  | "partial_fetch_abort"
  | "upstream_sheet_failure";

export interface SyncResult {
  ok: boolean;
  outcome: SyncOutcome;
  trigger: SyncTrigger;
  totalRows: number;
  rowsUpserted: number;
  rowsHidden: number;
  rowsUnhidden: number;
  // Task #213: operator visibility on partial-fetch handling.
  // `fetched` is the number of valid sheet rows we received in this sync.
  // `expected` is the count of rows previously visible on the board (the
  // baseline the partial-fetch guard compares against). `hiddenPrevented`
  // is how many rows the bulk-hide step would have flagged but did not
  // (only non-zero on `partial_fetch_continue`). `extractionContinued`
  // tells the dashboard whether the downloader was kicked after this run.
  fetched: number;
  expected: number;
  hiddenPrevented: number;
  extractionContinued: boolean;
  partialFetchWarning: boolean;
  error?: string;
}

// Task #213: serialize syncs across the process. We chain instead of
// returning the in-flight promise so a manual Sync Now never silently
// piggybacks on a scheduled sync that may have aborted under the strict
// guard. Each requested trigger runs its own pass with its own outcome.
let syncChain: Promise<SyncResult> | null = null;

export async function syncAdResearchBoard(
  trigger: SyncTrigger = "manual",
): Promise<SyncResult> {
  const prior = syncChain;
  const next = (async () => {
    if (prior) {
      logger.info(
        { trigger },
        "ad-research-board: another sync in flight, queuing this one behind it",
      );
      try {
        await prior;
      } catch {
        /* prior failure does not block our run */
      }
    }
    return runSync(trigger);
  })();
  syncChain = next.finally(() => {
    if (syncChain === next) syncChain = null;
  });
  return next;
}

// Task #134 / Task #402: durable-media-library sync.
//
// The sheet is treated as a DISCOVERY SOURCE for new items, not as the
// authoritative visibility ledger. Once media is successfully extracted
// and stored in GCS, the row becomes part of the permanent research
// library and stays on the user board even if the source row later
// disappears from the sheet.
//
// Per-sync behaviour:
//
//   * Sheet fetch fails → abort the sync entirely. We record the error
//     on the sync-status row but never touch any item row.
//   * Sheet fetch succeeds with rows → for each row:
//       - normalize URL, derive rowKey from the canonical hash
//       - upsert: bump source_present=true, last_seen_in_source_at=now(),
//         times_seen_in_source += 1, clear source_removed_at
//       - if the row is brand-new → media_status='pending', the downloader
//         picks it up
//       - if the row already exists with durable media (ok/partial/
//         silent-source with object path) → DO NOT requeue extraction.
//         The onConflictDoUpdate explicitly never touches media_status,
//         media_object_path, media_attempts, etc. This makes sync fully
//         idempotent and dramatically cuts queue churn / Apify usage.
//   * Rows in the DB whose rowKey is NOT in the current sheet snapshot
//     get source_present=false + source_removed_at=now() (preserved on
//     subsequent runs). library_visibility is NEVER touched here -
//     durable-media rows stay 'visible' on the user board until an
//     admin explicitly archives them.
//   * Sheet fetch succeeds but parses to zero data rows → abort. We
//     refuse to mass-flip the entire board to source_present=false on
//     the suspicion that the sheet just returned an empty CSV.
//
// The hidden_from_sheet column is mirrored from NOT source_present for
// one release as a compat shadow so legacy reads keep working.
async function runSync(trigger: SyncTrigger): Promise<SyncResult> {
  // Task #229: every sync run gets a session row. We start it before
  // any I/O so failure paths (sheet fetch, hide-guard abort, etc.)
  // still produce a closed-out historical row the dashboard can show.
  const sessionId = await startSyncSession({ board: "ad-research", trigger });
  let result: SyncResult = {
    ok: false,
    outcome: "upstream_sheet_failure",
    trigger,
    totalRows: 0,
    rowsUpserted: 0,
    rowsHidden: 0,
    rowsUnhidden: 0,
    fetched: 0,
    expected: 0,
    hiddenPrevented: 0,
    extractionContinued: false,
    partialFetchWarning: false,
  };
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

    // Build the in-sheet set first so we can detect "sheet parsed to zero
    // valid rows" up-front and refuse to mass-hide the entire board on
    // that basis. Real syncs will always have dozens of valid rows.
    type SheetRow = {
      rowKey: string;
      sortIndex: number;
      adLink: string;
      // Task #197: raw vs normalized URL captured at ingest time so the
      // operator can always trace what was synced from the sheet vs what
      // we actually attempted to extract.
      rawUrl: string;
      normalizedUrl: string;
      // Task #403: md5(normalizedUrl). Persisted on every upsert so
      // the partial unique index on `canonical_url_hash` enforces
      // "one visible row per ad URL".
      canonicalUrlHash: string;
      // Task #197: rows whose URL is structurally non-extractable
      // (dashboards, internal hosts, no-path homepages, non-media
      // platforms) are still persisted (so the audit trail survives) but
      // marked as invalid + dismissed BEFORE the queue ever sees them.
      invalidReason: string | null;
      type: string | null;
      awarenessStage: string | null;
      style: string | null;
      notes: string | null;
      urlKind: string;
    };
    const sheetRows: SheetRow[] = [];
    let invalidCount = 0;
    // Task #366: count source rows we silently dropped before they could
    // ever be upserted. Today the only structural drop is "link cell is
    // empty" (no URL = no identity to upsert under). We persist this
    // count on the sync_session so operators can see the gap between
    // the source sheet's row count and the board population.
    let rowsSkippedCount = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const idCell = (r[0] || "").trim();
      const linkCell = (r[1] || "").trim();
      const typeCell = (r[2] || "").trim();
      const awarenessCell = (r[3] || "").trim();
      const styleCell = (r[4] || "").trim();
      const notesCell = (r[5] || "").trim();
      // Task #197: a row with NO link cell at all has no identity in
      // the sheet, so we still skip it. But malformed / non-http /
      // admin / dashboard / internal URLs are now PERSISTED as
      // invalid-input board rows (not silently dropped) so the
      // operator can see exactly which sheet rows the pipeline
      // refused to extract from, with a normalized recovery_class.
      if (!linkCell) {
        rowsSkippedCount += 1;
        continue;
      }
      const isHttp = /^https?:\/\//i.test(linkCell);
      // Task #197: normalize URL at ingest so dedupe / extraction /
      // dashboard all see one canonical identity. Falls back to the raw
      // URL when normalization is a no-op or fails. The auto rowKey is
      // derived from the NORMALIZED url so the same reel posted with
      // and without `?igsh=...` collapses to a single board row.
      // Non-http inputs skip normalization (it requires a parseable URL)
      // and fall straight through to the unsupported-extraction verdict.
      const norm = isHttp ? normalizeSocialUrl(linkCell) : { url: null as string | null };
      const normalizedUrl = norm.url || linkCell;
      const rowKey = idCell || autoRowKeyFromLink(normalizedUrl);
      const canonicalUrlHash = canonicalUrlHashFor(normalizedUrl);
      const verdict = isHttp
        ? isUnsupportedExtractionUrl(normalizedUrl)
        : ({ unsupported: true, reason: "non-http-url" } as const);
      if (verdict.unsupported) invalidCount += 1;
      sheetRows.push({
        rowKey,
        sortIndex: i + 1,
        adLink: linkCell,
        rawUrl: linkCell,
        normalizedUrl,
        canonicalUrlHash,
        invalidReason: verdict.unsupported ? (verdict.reason ?? null) : null,
        type: typeCell || null,
        awarenessStage: awarenessCell || null,
        style: styleCell || null,
        notes: notesCell || null,
        urlKind: isHttp ? classifyAdUrl(linkCell) : "other",
      });
    }
    if (invalidCount > 0) {
      logger.info(
        { invalidCount, totalSheetRows: sheetRows.length },
        "ad-research-board: structurally invalid URLs in sheet (will be dismissed at ingest)",
      );
    }
    // Task #366: surface silently-dropped source rows on the session
    // record + structured log so the gap between the sheet's row count
    // and the board population is observable going forward.
    if (rowsSkippedCount > 0) {
      logger.warn(
        {
          rowsSkipped: rowsSkippedCount,
          totalSheetRows: dataRows.length,
          reason: "empty-link-cell",
        },
        "ad-research-board: source rows skipped (no link cell)",
      );
      await recordSessionEvent(sessionId, {
        kind: "rows_skipped",
        severity: "warn",
        message: `skipped ${rowsSkippedCount} source row(s) with empty link cell`,
        detail: { rowsSkipped: rowsSkippedCount, reason: "empty-link-cell" },
      });
    }

    // Task #366: rowKey collisions are another silent-drop class. When
    // two distinct sheet rows derive the same rowKey (autoRowKey from
    // identical normalized URLs, or operator-edited duplicate id cells)
    // the upsert below overwrites the first with the second. Count the
    // collisions, log them, persist a session event, and roll them
    // into rowsSkipped so the queue-health panel reflects the true gap
    // between the source sheet and the board.
    const seenRowKeys = new Set<string>();
    const collidingKeys: string[] = [];
    for (const row of sheetRows) {
      if (seenRowKeys.has(row.rowKey)) collidingKeys.push(row.rowKey);
      else seenRowKeys.add(row.rowKey);
    }
    if (collidingKeys.length > 0) {
      rowsSkippedCount += collidingKeys.length;
      logger.warn(
        {
          collisions: collidingKeys.length,
          totalSheetRows: dataRows.length,
          sample: collidingKeys.slice(0, 10),
          reason: "rowkey-collision",
        },
        "ad-research-board: source rows collapsed by rowKey collision",
      );
      await recordSessionEvent(sessionId, {
        kind: "rows_skipped",
        severity: "warn",
        message: `collapsed ${collidingKeys.length} source row(s) by rowKey collision`,
        detail: {
          rowsSkipped: collidingKeys.length,
          reason: "rowkey-collision",
          sample: collidingKeys.slice(0, 10),
        },
      });
    }

    // Task #403: dedupe within the current sheet snapshot by canonical
    // URL hash. Same ad pasted twice (with different ID cells, share
    // redirects, or tracking params) collapses to a single board row.
    // Winner is the lowest sortIndex (earliest sheet row); later
    // duplicates are dropped before they can hit the upsert. This
    // counts toward rowsSkipped so the source vs board gap stays
    // observable on the queue-health panel.
    {
      const seenHashes = new Set<string>();
      const dedupedSheetRows: typeof sheetRows = [];
      const droppedHashes: string[] = [];
      for (const row of sheetRows) {
        if (seenHashes.has(row.canonicalUrlHash)) {
          droppedHashes.push(row.canonicalUrlHash);
          continue;
        }
        seenHashes.add(row.canonicalUrlHash);
        dedupedSheetRows.push(row);
      }
      if (droppedHashes.length > 0) {
        rowsSkippedCount += droppedHashes.length;
        logger.warn(
          {
            collisions: droppedHashes.length,
            totalSheetRows: dataRows.length,
            sample: droppedHashes.slice(0, 10),
            reason: "canonical-url-collision",
          },
          "ad-research-board: source rows collapsed by canonical URL hash",
        );
        await recordSessionEvent(sessionId, {
          kind: "rows_skipped",
          severity: "warn",
          message: `collapsed ${droppedHashes.length} source row(s) by canonical URL hash`,
          detail: {
            rowsSkipped: droppedHashes.length,
            reason: "canonical-url-collision",
            sample: droppedHashes.slice(0, 10),
          },
        });
      }
      sheetRows.length = 0;
      for (const row of dedupedSheetRows) sheetRows.push(row);
    }

    if (sheetRows.length === 0) {
      throw new Error(
        `Sheet parsed to zero valid rows (raw rows: ${dataRows.length}); refusing to hide every board row`,
      );
    }

    // Task #134: percentage-drop safety guard. A truncated/partial sheet
    // response can pass the >0 check but still be missing most rows. If
    // this sync would hide more than 30% of the previously-visible board,
    // we abort BEFORE touching anything. This is the second line of defence
    // (the first being "sheet fetch failed -> abort"). 30% is generous on
    // purpose - real day-to-day sheet edits never approach that.
    // T402: the partial-fetch guard compares against "rows currently
    // tracked as source_present=true" (i.e. last sync saw them in the
    // sheet). If this sync would flip >30% of them to source_present=
    // false the run is treated as a suspected partial fetch.
    const previouslyVisibleResult = await db
      .select({ rowKey: adResearchBoardItems.rowKey })
      .from(adResearchBoardItems)
      .where(eq(adResearchBoardItems.sourcePresent, true));
    const previouslyVisibleKeys = new Set(previouslyVisibleResult.map((r) => r.rowKey));
    const seenKeysSet = new Set(sheetRows.map((r) => r.rowKey));
    const wouldHide: string[] = [];
    for (const k of previouslyVisibleKeys) {
      if (!seenKeysSet.has(k)) wouldHide.push(k);
    }
    const HIDE_GUARD_FRACTION = 0.3;
    const tripsHideGuard =
      previouslyVisibleKeys.size > 10 &&
      wouldHide.length / previouslyVisibleKeys.size > HIDE_GUARD_FRACTION;
    // Task #213: split the partial-fetch guard by trigger.
    //   * Scheduled runs keep the strict abort (board integrity).
    //   * Manual Sync Now continues: still upserts every fetched row and
    //     still kicks the downloader, but the bulk-hide step is skipped
    //     so existing visible rows are preserved. Single-row dismiss
    //     paths are unaffected (this only short-circuits the NOT IN
    //     mass update below).
    let suppressBulkHide = false;
    let hiddenPrevented = 0;
    if (tripsHideGuard) {
      if (trigger === "scheduled") {
        throw new Error(
          `Sheet sync would hide ${wouldHide.length}/${previouslyVisibleKeys.size} ` +
            `(>${Math.round(HIDE_GUARD_FRACTION * 100)}%) of the visible board; ` +
            `aborting on suspected partial sheet fetch`,
        );
      }
      suppressBulkHide = true;
      hiddenPrevented = wouldHide.length;
      result.partialFetchWarning = true;
      result.hiddenPrevented = hiddenPrevented;
      logger.warn(
        {
          trigger,
          wouldHide: wouldHide.length,
          previouslyVisible: previouslyVisibleKeys.size,
          fraction: Number((wouldHide.length / previouslyVisibleKeys.size).toFixed(3)),
        },
        "ad-research-board: partial sheet fetch detected on manual sync; " +
          "continuing ingestion + extraction with bulk-hide suppressed",
      );
    }

    // Compute rowsUnhidden BEFORE the upserts so the SyncResult is
    // accurate. T402: a row counts as "unhidden" if it was previously
    // source_present=false but the current sheet contains its rowKey
    // (i.e. it came back into the source).
    const seenKeys = sheetRows.map((r) => r.rowKey);
    const previouslyHiddenRows = await db
      .select({ rowKey: adResearchBoardItems.rowKey })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.sourcePresent, false),
          inArray(adResearchBoardItems.rowKey, seenKeys),
        ),
      );
    const rowsUnhidden = previouslyHiddenRows.length;
    let upserted = 0;
    // Task #403: when the upsert loop resolves a canonical-URL collision
    // by updating an EXISTING visible row (under a different rowKey)
    // instead of inserting under the sheet's incoming rowKey, the
    // winner row's rowKey isn't in `seenKeys`. We accumulate those
    // winner rowKeys here so the bulk-hide phase preserves them rather
    // than immediately flipping them to source_present=false /
    // hiddenFromSheet=true on the very same sync.
    const collisionWinnerRowKeys = new Set<string>();

    // Upsert every sheet row. We deliberately do NOT overwrite mediaStatus
    // for rows that already have downloaded media — onConflictDoUpdate only
    // touches the sheet-derived columns plus the visibility / classification
    // flags. This is the second guarantee that "rows with cached media never
    // disappear".
    for (const row of sheetRows) {
      // Task #197: rows the structural validator rejects are persisted
      // with the dedicated `invalid` mediaStatus + `dismissed=true`
      // immediately so the queue worker never sees them. We still
      // upsert them (rather than skipping) so the sheet -> DB audit
      // trail stays complete and an admin can see exactly why a given
      // row never produced media. The pre-claim SELECT only matches
      // null/pending/failed/downloading, so `invalid` is structurally
      // unselectable; the dismissed flag is the redundant belt.
      const isInvalid = row.invalidReason !== null;

      // Task #403: pre-check for an existing visible row that already
      // owns this canonical URL hash under a DIFFERENT rowKey. This
      // happens when an operator pastes the same ad with a fresh ID
      // cell, or when a legacy row was keyed off the raw URL before
      // the normalize-on-ingest path shipped. Without this guard the
      // insert below would violate the partial unique index on
      // canonical_url_hash. Instead we update the existing row's
      // sheet-derived columns in place (preserving its rowKey and
      // already-cached media) and skip the insert. The
      // sheet -> board identity collapses to one row, satisfying the
      // dedupe contract from T403.
      const [existingByHash] = await db
        .select({
          id: adResearchBoardItems.id,
          rowKey: adResearchBoardItems.rowKey,
        })
        .from(adResearchBoardItems)
        .where(
          and(
            eq(adResearchBoardItems.canonicalUrlHash, row.canonicalUrlHash),
            eq(adResearchBoardItems.libraryVisibility, "visible"),
          ),
        )
        .limit(1);
      if (existingByHash && existingByHash.rowKey !== row.rowKey) {
        await db
          .update(adResearchBoardItems)
          .set({
            sortIndex: row.sortIndex,
            adLink: row.adLink,
            rawUrl: row.rawUrl,
            normalizedUrl: row.normalizedUrl,
            canonicalUrlHash: row.canonicalUrlHash,
            type: row.type,
            awarenessStage: row.awarenessStage,
            style: row.style,
            notes: row.notes,
            urlKind: row.urlKind,
            hiddenFromSheet: false,
            sourcePresent: true,
            sourceRemovedAt: sql`NULL`,
            lastSeenInSourceAt: sql`now()`,
            timesSeenInSource: sql`${adResearchBoardItems.timesSeenInSource} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(adResearchBoardItems.id, existingByHash.id));
        // Preserve the winner row through bulk-hide (its rowKey is not
        // in the sheet snapshot but its identity IS the active sheet
        // row for this canonical URL).
        collisionWinnerRowKeys.add(existingByHash.rowKey);
        // Archive any row that previously occupied the sheet's incoming
        // rowKey - typically when an operator edited a row's URL on the
        // sheet to point at an ad already owned by another board row.
        // The old row's hash now diverges from the sheet's incoming hash
        // and would otherwise stay 'visible' under the same rowKey, so
        // we explicitly archive it. Idempotent for fresh-rowKey collisions
        // (no row matches and the update is a no-op).
        await db
          .update(adResearchBoardItems)
          .set({
            libraryVisibility: "archived",
            sourcePresent: false,
            sourceRemovedAt: sql`COALESCE(${adResearchBoardItems.sourceRemovedAt}, now())`,
            hiddenFromSheet: true,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(adResearchBoardItems.rowKey, row.rowKey),
              eq(adResearchBoardItems.libraryVisibility, "visible"),
              ne(adResearchBoardItems.id, existingByHash.id),
            ),
          );
        upserted++;
        continue;
      }

      await db
        .insert(adResearchBoardItems)
        .values({
          rowKey: row.rowKey,
          sortIndex: row.sortIndex,
          adLink: row.adLink,
          // Task #197: dual-write raw + normalized URL on insert. On
          // update we ONLY touch the columns when the operator-edited
          // sheet cell changed, never overwriting the cached value
          // with a stale empty.
          rawUrl: row.rawUrl,
          normalizedUrl: row.normalizedUrl,
          // Task #403: persisted at insert + maintained on conflict
          // so the partial unique index stays accurate.
          canonicalUrlHash: row.canonicalUrlHash,
          type: row.type,
          awarenessStage: row.awarenessStage,
          style: row.style,
          notes: row.notes,
          urlKind: row.urlKind,
          hiddenFromSheet: false,
          // T402: source-lifecycle tracking. Brand-new rows are present
          // in the sheet right now, never been seen before, count = 1.
          sourcePresent: true,
          sourceRemovedAt: null,
          lastSeenInSourceAt: sql`now()`,
          timesSeenInSource: 1,
          libraryVisibility: "visible",
          // Task #134: explicitly stage every newly ingested row as
          // 'pending' so the downloader picks it up. (onConflictDoUpdate
          // intentionally does NOT touch mediaStatus — existing rows keep
          // their cached ok/partial/failed state.)
          mediaStatus: isInvalid ? "invalid" : "pending",
          ...(isInvalid
            ? (() => {
                // T209: parse-fail → invalid-input; structural rejection → unsupported-input.
                const isParseFail =
                  row.invalidReason === "invalid-url" ||
                  row.invalidReason === "non-http-scheme" ||
                  row.invalidReason === "non-http-url";
                return {
                  dismissed: true,
                  mediaError: `${isParseFail ? "unsupported-url" : "unsupported-input"}: ${row.invalidReason}`,
                  mediaErrorClass: isParseFail ? "unsupported-url" : "unsupported-input",
                  recoveryClass: isParseFail ? "invalid-input" : "unsupported-input",
                  recoveryStrategy: isParseFail ? "permanent-dismiss-invalid" : "permanent-dismiss-unsupported",
                };
              })()
            : {}),
        })
        .onConflictDoUpdate({
          target: adResearchBoardItems.rowKey,
          set: {
            sortIndex: row.sortIndex,
            adLink: row.adLink,
            rawUrl: row.rawUrl,
            normalizedUrl: row.normalizedUrl,
            // Task #403: keep the canonical hash in sync with the
            // current normalized URL on every upsert so an operator
            // editing a row's link cell migrates the dedupe identity
            // alongside the rest of the sheet metadata.
            canonicalUrlHash: row.canonicalUrlHash,
            type: row.type,
            awarenessStage: row.awarenessStage,
            style: row.style,
            notes: row.notes,
            urlKind: row.urlKind,
            // If a previously-hidden rowKey reappears in the sheet, clear
            // the hidden flag so the row pops back into the user view.
            hiddenFromSheet: false,
            // T402: source-lifecycle bump on every upsert. source_present
            // flips back to true, source_removed_at clears, last-seen
            // timestamp advances, and the recurrence counter increments
            // by 1. library_visibility is intentionally NOT touched here:
            // an admin-archived row that reappears in the sheet stays
            // archived until the admin explicitly restores it.
            sourcePresent: true,
            sourceRemovedAt: sql`NULL`,
            lastSeenInSourceAt: sql`now()`,
            timesSeenInSource: sql`${adResearchBoardItems.timesSeenInSource} + 1`,
            updatedAt: sql`now()`,
            // Task #197: deterministically maintain invalid state on
            // conflict. Without this, an existing rowKey that becomes
            // structurally invalid after a sheet edit would not be
            // marked failed/dismissed at ingest, and a previously
            // invalid row that the operator corrected would stay
            // dismissed forever. Only `invalid-input` rows are
            // toggled; we never clobber a real extraction error from
            // the worker (recoveryClass is something else).
            // Task #209: on conflict, the same intake-taxonomy split
            // applies. T209 shapes (fb-photo-php / ig-profile-only)
            // upsert as `unsupported-input`; everything else stays on
            // the legacy `unsupported-url` / `invalid-input` taxonomy.
            // Both shapes are safely cleared when an operator corrects
            // the URL on the sheet (the CASE arm checks for either
            // recoveryClass on the existing row).
            mediaStatus: isInvalid
              ? sql`'invalid'`
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN 'pending' ELSE ${adResearchBoardItems.mediaStatus} END`,
            dismissed: isInvalid
              ? sql`true`
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN false ELSE ${adResearchBoardItems.dismissed} END`,
            mediaError: isInvalid
              ? (row.invalidReason === "invalid-url" || row.invalidReason === "non-http-scheme" || row.invalidReason === "non-http-url"
                  ? `unsupported-url: ${row.invalidReason}`
                  : `unsupported-input: ${row.invalidReason}`)
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN NULL ELSE ${adResearchBoardItems.mediaError} END`,
            mediaErrorClass: isInvalid
              ? (row.invalidReason === "invalid-url" || row.invalidReason === "non-http-scheme" || row.invalidReason === "non-http-url"
                  ? sql`'unsupported-url'`
                  : sql`'unsupported-input'`)
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN NULL ELSE ${adResearchBoardItems.mediaErrorClass} END`,
            recoveryClass: isInvalid
              ? (row.invalidReason === "invalid-url" || row.invalidReason === "non-http-scheme" || row.invalidReason === "non-http-url"
                  ? sql`'invalid-input'`
                  : sql`'unsupported-input'`)
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN NULL ELSE ${adResearchBoardItems.recoveryClass} END`,
            recoveryStrategy: isInvalid
              ? (row.invalidReason === "invalid-url" || row.invalidReason === "non-http-scheme" || row.invalidReason === "non-http-url"
                  ? sql`'permanent-dismiss-invalid'`
                  : sql`'permanent-dismiss-unsupported'`)
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN NULL ELSE ${adResearchBoardItems.recoveryStrategy} END`,
            retryAfterAt: isInvalid
              ? sql`NULL`
              : sql`CASE WHEN ${adResearchBoardItems.recoveryClass} IN ('invalid-input', 'unsupported-input') THEN NULL ELSE ${adResearchBoardItems.retryAfterAt} END`,
          },
        });
      upserted++;
    }

    // Hide rows that disappeared from the sheet. We never delete - the
    // cached object-storage media stays addressable and an admin can
    // unhide the row from the admin panel.
    //
    // Task #213: when the partial-fetch guard tripped on a manual sync
    // we deliberately skip this bulk-hide so a truncated CSV cannot
    // wipe the visible board. The single-row dismiss / unhide admin
    // paths are unaffected.
    // T402: flag source-removed rows. Crucially, this NO LONGER changes
    // library_visibility - rows with durable cached media stay on the
    // user board until an admin explicitly archives them. The hidden_from_sheet
    // mirror is preserved for one release so legacy reads (admin "Hidden
    // rows" counter) keep working. `rowsHidden` is now "rows newly
    // flipped to source_present=false on this sync".
    let rowsHidden = 0;
    if (!suppressBulkHide) {
      // Task #403: union the sheet's incoming rowKeys with the rowKeys
      // of any existing visible rows that absorbed a sheet row via the
      // canonical-URL collision path above. Without this, a winner row
      // (whose own rowKey is not in the sheet snapshot) would be flipped
      // to source_present=false / hidden on the very same sync that just
      // updated it, regressing inventory counts.
      const preserveKeys = Array.from(
        new Set<string>([...seenKeys, ...collisionWinnerRowKeys]),
      );
      const hiddenResult = await db
        .update(adResearchBoardItems)
        .set({
          sourcePresent: false,
          // First flip wins - don't overwrite an earlier removal time.
          sourceRemovedAt: sql`COALESCE(${adResearchBoardItems.sourceRemovedAt}, now())`,
          // Compat shadow: keep hidden_from_sheet in lockstep with
          // (NOT source_present) so any legacy reader still sees the
          // same row population. Removed in a follow-up.
          hiddenFromSheet: true,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(adResearchBoardItems.sourcePresent, true),
            // Drizzle: NOT IN (...). preserveKeys is always non-empty
            // because seenKeys is (guarded above).
            sql`${adResearchBoardItems.rowKey} NOT IN (${sql.join(
              preserveKeys.map((k) => sql`${k}`),
              sql`, `,
            )})`,
          ),
        )
        .returning({ id: adResearchBoardItems.id });
      rowsHidden = hiddenResult.length;
    }

    // rowsUnhidden was already computed before the upserts (see above).
    result = {
      ok: true,
      outcome: suppressBulkHide ? "partial_fetch_continue" : "full_success",
      trigger,
      totalRows: dataRows.length,
      rowsUpserted: upserted,
      rowsHidden,
      rowsUnhidden,
      fetched: sheetRows.length,
      expected: previouslyVisibleKeys.size,
      hiddenPrevented,
      extractionContinued: true,
      partialFetchWarning: suppressBulkHide,
    };

    await db
      .insert(adResearchBoardSyncStatus)
      .values({
        id: SYNC_STATUS_ID,
        lastSyncedAt: new Date(),
        lastSyncOk: true,
        lastSyncError: null,
        rowsUpserted: upserted,
        rowsPruned: rowsHidden,
        totalRows: dataRows.length,
      })
      .onConflictDoUpdate({
        target: adResearchBoardSyncStatus.id,
        set: {
          lastSyncedAt: new Date(),
          lastSyncOk: true,
          lastSyncError: null,
          rowsUpserted: upserted,
          rowsPruned: rowsHidden,
          totalRows: dataRows.length,
        },
      });

    logger.info(result, "ad-research-board: sync complete (non-destructive)");
    // Task #229 follow-up: persist counters/summary now, but DEFER the
    // session's terminal `completed` transition until the media processor
    // pass finishes. This keeps the live session "running" through the
    // extraction phase so per-row provider/auth/escalation counters
    // (incrementLatestRunningSessionCounters) actually land on the row.
    await updateSessionCounters(sessionId, {
      rowsFetched: sheetRows.length,
      rowsProcessed: upserted,
      invalidUrls: invalidCount,
      rowsSkipped: rowsSkippedCount,
    });
    await recordSessionEvent(sessionId, {
      kind: "downloader_kicked",
      message: "media downloader queued",
    });
    processPendingMediaInBackground({
      sessionId,
      sessionSummary: {
        outcome: result.outcome,
        rowsUpserted: upserted,
        rowsHidden,
        rowsUnhidden,
        hiddenPrevented,
        partialFetchWarning: result.partialFetchWarning,
      },
    });
    return result;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    logger.error({ err: errMsg }, "ad-research-board: sync failed (no item rows touched)");
    try {
      await db
        .insert(adResearchBoardSyncStatus)
        .values({
          id: SYNC_STATUS_ID,
          lastSyncedAt: new Date(),
          lastSyncOk: false,
          lastSyncError: errMsg.slice(0, 500),
        })
        .onConflictDoUpdate({
          target: adResearchBoardSyncStatus.id,
          set: {
            lastSyncedAt: new Date(),
            lastSyncOk: false,
            lastSyncError: errMsg.slice(0, 500),
          },
        });
    } catch (statusErr) {
      logger.error({ err: statusErr }, "ad-research-board: failed to record error status");
    }
    // Task #213: classify the failure for the dashboard. Hide-guard
    // aborts only happen on scheduled runs now (manual continues), but
    // we still tag them distinctly so the operator can tell a board-
    // integrity abort from an upstream Google Sheets failure.
    const isHideGuardAbort = /aborting on suspected partial sheet fetch/i.test(errMsg);
    await completeSyncSession(sessionId, {
      status: "failed",
      error: errMsg.slice(0, 500),
      summary: { outcome: isHideGuardAbort ? "partial_fetch_abort" : "upstream_sheet_failure" },
    });
    return {
      ok: false,
      outcome: isHideGuardAbort ? "partial_fetch_abort" : "upstream_sheet_failure",
      trigger,
      totalRows: 0,
      rowsUpserted: 0,
      rowsHidden: 0,
      rowsUnhidden: 0,
      fetched: 0,
      expected: 0,
      hiddenPrevented: 0,
      extractionContinued: false,
      partialFetchWarning: isHideGuardAbort,
      error: errMsg,
    };
  }
}

export async function getAdResearchBoardSyncStatus() {
  const [row] = await db
    .select()
    .from(adResearchBoardSyncStatus)
    .where(eq(adResearchBoardSyncStatus.id, SYNC_STATUS_ID));
  return row || null;
}

function getMsUntilNext330amUTC(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 30, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function scheduleNextDailyAdResearchBoardSync(): void {
  const ms = getMsUntilNext330amUTC();
  logger.info(
    { nextRunIn: `${(ms / 3600000).toFixed(1)}h` },
    "ad-research-board: scheduled next daily sync (3:30am UTC)",
  );
  setTimeout(() => {
    syncAdResearchBoard("scheduled").catch((err) =>
      logger.error({ err }, "ad-research-board: scheduled run failed"),
    );
    scheduleNextDailyAdResearchBoardSync();
  }, ms);
}

const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

// Per-process boot lock. Without this, two near-simultaneous restarts (or
// a restart during a slow sync) could fire two boot syncs in quick
// succession. inFlightSync is the second line of defence; this lock makes
// the boot path itself idempotent for the lifetime of the process.
let bootSyncRan = false;

export async function ensureAdResearchBoardFreshOnBoot(): Promise<void> {
  if (bootSyncRan) {
    logger.info("ad-research-board: boot sync already attempted in this process");
    return;
  }
  bootSyncRan = true;
  try {
    const status = await getAdResearchBoardSyncStatus();
    const last = status?.lastSyncedAt ? new Date(status.lastSyncedAt).getTime() : 0;
    const stale = !last || Date.now() - last > STALE_AFTER_MS;
    if (stale) {
      logger.info({ lastSyncedAt: status?.lastSyncedAt || null }, "ad-research-board: running boot sync (stale or missing)");
      await syncAdResearchBoard("boot-freshness");
    } else {
      logger.info(
        { lastSyncedAt: status?.lastSyncedAt },
        "ad-research-board: boot sync skipped (recent sync exists)",
      );
    }
  } catch (err) {
    logger.error({ err }, "ad-research-board: boot sync check failed");
  }
}

// Admin escape hatch: clear hidden_from_sheet on a single row so it
// reappears in the user view even if it's no longer in the sheet.
export async function unhideAdResearchBoardItem(itemId: number): Promise<{
  ok: boolean; id?: number; error?: string;
}> {
  const updated = await db
    .update(adResearchBoardItems)
    .set({ hiddenFromSheet: false, updatedAt: sql`now()` })
    .where(eq(adResearchBoardItems.id, itemId))
    .returning({ id: adResearchBoardItems.id });
  if (!updated.length) return { ok: false, error: "row not found" };
  return { ok: true, id: updated[0].id };
}
