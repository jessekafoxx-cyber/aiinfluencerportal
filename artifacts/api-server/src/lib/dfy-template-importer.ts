/* eslint-disable no-console */
// Shared DFY template importer logic. Used by both the one-shot CLI
// (scripts/import-dfy-templates.ts) and the admin "re-import CSV"
// endpoint (POST /api/portal/dfy/templates/import-csv).
//
// Always uploads media to our object storage and writes a
// /api/portal/images/<file> URL into dfy_templates.imageUrl. External
// (e.g. supabase) URLs are NEVER persisted into the DB.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as csvParse } from "csv-parse/sync";
// adm-zip reads the central directory from disk without slurping the
// whole archive into memory, then pulls each entry's bytes on demand.
// No bundled type definitions, so we declare the small surface we use.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no @types/adm-zip in this workspace
import AdmZip from "adm-zip";

type AdmZipEntry = {
  isDirectory: boolean;
  entryName: string;
  getData(): Buffer;
};
type AdmZipInstance = {
  getEntries(): AdmZipEntry[];
};
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { dfyTemplatesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";

// Hard blocklist: (category, sourceDisplayId) pairs the importer will
// permanently refuse to insert or update, even if the source CSV/zip
// still contains them. Use sparingly - this is for templates the
// product owner has decided should never appear in the gallery.
// Companion boot hook ensure-dfy-templates-blocklist.ts deletes any
// existing rows that match these keys.
export const DFY_TEMPLATE_BLOCKLIST: ReadonlyArray<{
  category: string;
  sourceDisplayId: string;
}> = [
  { category: "canva_ad_template", sourceDisplayId: "9" },
];

function isBlocklisted(category: string, did: string): boolean {
  return DFY_TEMPLATE_BLOCKLIST.some(
    (b) => b.category === category && b.sourceDisplayId === did,
  );
}

export type ManifestRow = {
  type: string;
  display_id: string;
  title: string;
  image_filename: string;
  image_url: string;
  zip_file: string;
};

export type CsvRow = {
  display_id: string;
  title: string;
  canva_url: string;
  image_url: string;
  industry: string;
  theme: string;
  ratio: string;
  awareness_stage: string;
  platform: string;
  // Optional landing-page-swipe / advertorial-swipe columns. When
  // present they're persisted on the row and surfaced as the
  // "Preview" (live_url) and "Download" (pdf_url) actions on the
  // tile. Either column may be absent in older CSV exports - the
  // importer treats them as nullable.
  live_url?: string;
  pdf_url?: string;
  // T262: optional new columns shipped with the 321-row Ad Swipe
  // export. Older CSVs that don't have them are still accepted.
  theme2?: string;
  theme3?: string;
  brand_name?: string;
  ad_copy?: string;
  image_filename?: string;
};

export const CATEGORY_ZIPS: Record<string, string[]> = {
  ad_swipe: ["ad_swipe_part"],
  monthly_drop: ["monthly_drop_part"],
  free_template: ["image_free_template_part"],
  // previous_drop has no dedicated zip - shares monthly_drop's pool.
  previous_drop: ["monthly_drop_part"],
  landing_page_swipe: ["landing_pages_part"],
};

export type ImportContext = {
  category: string;
  subCategory: string | null;
  manifestType: string;
  // Either a CSV path on disk, or pre-parsed rows.
  csvPath?: string;
  csvRows?: CsvRow[];
  assetsDir: string;
  // Subset filter on the CSV (used to split landing_page_swipe.csv
  // into Landing Swipe / Advertorial Swipe / Quiz Funnel).
  filter?: (row: CsvRow) => boolean;
  // Allow rewriting the category for the inserted row at upsert
  // time so a single CSV can target multiple categories.
  remapCategory?: (row: CsvRow) => string;
  // Stop after this many rows are processed across the whole run.
  limit?: number;
  // Optional progress logger.
  log?: (msg: string) => void;
};

export type ImportReport = {
  category: string;
  inserted: number;
  updated: number;
  skipped: number;
  missingImage: string[];
  failedDownload: string[];
};

function findLatest(assetsDir: string, prefix: string, ext = ".csv"): string | null {
  const matches = readdirSync(assetsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .sort();
  return matches.length ? join(assetsDir, matches[matches.length - 1]) : null;
}

function findAllZips(assetsDir: string, prefix: string): string[] {
  return readdirSync(assetsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".zip"))
    .map((f) => join(assetsDir, f))
    .sort();
}

export function readCsv<T = Record<string, string>>(path: string): T[] {
  const raw = readFileSync(path);
  return csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as T[];
}

export function parseCsvText<T = Record<string, string>>(text: string): T[] {
  return csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as T[];
}

function detectMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function extFor(name: string, fallback = "jpg"): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/);
  return m ? m[1] : fallback;
}

// Hash-named upload so re-running with the same image is a no-op
// (overwriting the same object with identical bytes).
async function uploadBuffer(buf: Buffer, ext: string, mime: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set",
    );
  }
  const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 24);
  const fileName = `dfy-${hash}.${ext}`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    await file.save(buf, {
      contentType: mime,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
  }
  return `/api/portal/images/${fileName}`;
}

async function downloadFromExternal(
  url: string,
  log?: (msg: string) => void,
): Promise<{ buf: Buffer; mime: string; ext: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log?.(`[fetch] ${res.status} for ${url}`);
      return null;
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const ext = extFor(url, "jpg");
    const mime = res.headers.get("content-type") || detectMime(url);
    return { buf, mime, ext };
  } catch (e: any) {
    log?.(`[fetch] failed for ${url}: ${e?.message}`);
    return null;
  }
}

export async function runImport(ctx: ImportContext): Promise<ImportReport> {
  const log = ctx.log ?? ((msg) => console.log(msg));
  const report: ImportReport = {
    category: ctx.category,
    inserted: 0,
    updated: 0,
    skipped: 0,
    missingImage: [],
    failedDownload: [],
  };

  let rows: CsvRow[];
  if (ctx.csvRows) {
    rows = ctx.csvRows;
  } else if (ctx.csvPath) {
    if (!existsSync(ctx.csvPath)) {
      log(`[import] CSV missing for ${ctx.category}: ${ctx.csvPath}`);
      return report;
    }
    rows = readCsv<CsvRow>(ctx.csvPath);
  } else {
    log(`[import] no CSV source for ${ctx.category}`);
    return report;
  }
  const filtered = ctx.filter ? rows.filter(ctx.filter) : rows;

  // Manifest is per-type. Build a quick lookup keyed on display_id.
  // Source assets are timestamped (image-manifest_<ts>.csv) so we
  // pick the latest, falling back to a literal `image-manifest.csv`
  // if a non-timestamped copy exists.
  const manifestPath =
    findLatest(ctx.assetsDir, "image-manifest") ||
    join(ctx.assetsDir, "image-manifest.csv");
  const manifest: ManifestRow[] = existsSync(manifestPath)
    ? (readCsv<ManifestRow>(manifestPath) as ManifestRow[]).filter(
        (m) => m.type === ctx.manifestType,
      )
    : [];
  if (!manifest.length) {
    log(
      `[import] ${ctx.category}: no manifest rows for type=${ctx.manifestType} (manifest=${manifestPath})`,
    );
  }
  const manifestById = new Map<string, ManifestRow>();
  for (const m of manifest) manifestById.set(m.display_id, m);

  // Pre-load already-imported rows for this category so we can skip
  // any whose image is already on our object storage. Lets us safely
  // resume after an OOM mid-batch without re-uploading 1700 files.
  const existing = await db
    .select({
      sourceDisplayId: dfyTemplatesTable.sourceDisplayId,
      imageUrl: dfyTemplatesTable.imageUrl,
    })
    .from(dfyTemplatesTable)
    .where(eq(dfyTemplatesTable.category, ctx.category));
  const alreadyImported = new Set<string>();
  for (const e of existing) {
    if (
      e.sourceDisplayId &&
      e.imageUrl &&
      e.imageUrl.startsWith("/api/portal/images/")
    ) {
      alreadyImported.add(e.sourceDisplayId);
    }
  }
  if (alreadyImported.size) {
    log(
      `[import] ${ctx.category}: skipping ${alreadyImported.size} rows already on object storage`,
    );
  }

  type Row = { idx: number; row: CsvRow; fileName: string; done: boolean };
  const byDisplayId = new Map<string, Row>();
  for (const [idx, row] of filtered.entries()) {
    const did = row.display_id?.trim();
    if (!did || !row.title) {
      report.skipped += 1;
      continue;
    }
    if (alreadyImported.has(did)) {
      // Image is already on object storage so we don't need to
      // re-upload, but the CSV may still carry updated metadata
      // (title, canva_url, live_url, pdf_url, industry, ...). Apply a
      // metadata-only patch so re-imports actually backfill the new
      // columns instead of silently no-op'ing.
      await updateMetadataOnly(ctx, row, report).catch((err: any) => {
        log(`[import] ${ctx.category}#${did} metadata update failed: ${err?.message}`);
      });
      byDisplayId.set(did, { idx, row, fileName: "", done: true });
      continue;
    }
    const manifestRow = manifestById.get(did);
    const fileName = manifestRow?.image_filename || "";
    byDisplayId.set(did, { idx, row, fileName, done: false });
  }

  // Reverse lookup: image_filename -> display_id (for matching against
  // a zip's contents on the fly).
  const fileToDisplayId = new Map<string, string>();
  for (const [did, r] of byDisplayId) {
    if (r.fileName) fileToDisplayId.set(r.fileName, did);
  }

  const limit = ctx.limit ?? Number.POSITIVE_INFINITY;
  let processed = 0;
  const limitReached = () => processed >= limit;

  const zipPaths: string[] = [];
  for (const prefix of CATEGORY_ZIPS[ctx.manifestType] || []) {
    for (const p of findAllZips(ctx.assetsDir, prefix)) zipPaths.push(p);
  }

  for (const zipPath of zipPaths) {
    if (limitReached()) break;
    let zip: AdmZipInstance | null;
    try {
      zip = new AdmZip(zipPath) as AdmZipInstance;
    } catch (err: any) {
      log(`[zip] failed to open ${zipPath}: ${err?.message}`);
      continue;
    }
    const entries: AdmZipEntry[] = zip.getEntries();
    for (const entry of entries) {
      if (limitReached()) break;
      if (entry.isDirectory) continue;
      const base = basename(entry.entryName);
      const did = fileToDisplayId.get(base);
      if (!did) continue;
      const r = byDisplayId.get(did);
      if (!r || r.done) continue;
      try {
        const fileBuf: Buffer = entry.getData();
        const ext = extFor(base, "jpg");
        const mime = detectMime(base);
        const imageUrl = await uploadBuffer(fileBuf, ext, mime);
        const mediaKind: "image" | "video" = base.toLowerCase().endsWith(".mp4")
          ? "video"
          : "image";
        await upsertRow(ctx, r.row, r.idx, imageUrl, mediaKind, report);
        r.done = true;
        processed += 1;
        if (processed % 100 === 0) {
          log(`[import] ${ctx.category}: ${processed}/${filtered.length}`);
        }
      } catch (err: any) {
        log(`[import] ${ctx.category}#${did} failed: ${err?.message}`);
        report.skipped += 1;
      }
    }
    // Drop the AdmZip handle so its central-directory buffer is GC'd.
    zip = null;
    if (typeof globalThis.gc === "function") {
      try {
        (globalThis.gc as () => void)();
      } catch {
        /* ignore */
      }
    }
  }

  // External-download fallback for any row that wasn't covered by a
  // zip (notably VSL swipes have no zip at all). The downloaded bytes
  // are immediately uploaded to object storage; the external URL is
  // never persisted into the DB.
  for (const r of byDisplayId.values()) {
    if (limitReached()) break;
    if (r.done) continue;
    if (r.fileName) {
      report.missingImage.push(`${ctx.category}#${r.row.display_id} (${r.fileName})`);
    }
    if (!r.row.image_url) {
      report.skipped += 1;
      continue;
    }
    const downloaded = await downloadFromExternal(r.row.image_url, log);
    if (!downloaded) {
      report.failedDownload.push(`${ctx.category}#${r.row.display_id}`);
      report.skipped += 1;
      continue;
    }
    const imageUrl = await uploadBuffer(downloaded.buf, downloaded.ext, downloaded.mime);
    const mediaKind: "image" | "video" = downloaded.mime.startsWith("video/")
      ? "video"
      : "image";
    await upsertRow(ctx, r.row, r.idx, imageUrl, mediaKind, report);
    r.done = true;
    processed += 1;
    if (processed % 50 === 0) {
      log(`[import] ${ctx.category}: ${processed}/${filtered.length} (downloads)`);
    }
  }

  return report;
}

// Allow https:// absolute URLs or relative `/api/portal/images/...`
// paths. Reject `javascript:`, `data:`, `vbscript:`, file:, http:, etc.
// to neutralise click-triggered XSS / phishing via admin- or
// CSV-supplied URLs that we render directly into <a href>.
export function sanitizeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("/api/portal/images/")) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return u.toString();
  } catch {
    /* fallthrough */
  }
  return null;
}

// Metadata-only patch for rows that are already in the DB with their
// image already on object storage. Lets re-imports backfill new
// columns (live_url / pdf_url / canva_url / industry / ...) without
// re-uploading binary assets.
async function updateMetadataOnly(
  ctx: ImportContext,
  row: CsvRow,
  report: ImportReport,
) {
  const did = row.display_id?.trim();
  if (!did) return;
  const targetCategory = ctx.remapCategory ? ctx.remapCategory(row) : ctx.category;
  if (isBlocklisted(targetCategory, did)) {
    report.skipped += 1;
    return;
  }
  await db
    .update(dfyTemplatesTable)
    .set({
      title: row.title.trim(),
      canvaUrl: sanitizeExternalUrl(row.canva_url),
      liveUrl: sanitizeExternalUrl(row.live_url),
      pdfUrl: sanitizeExternalUrl(row.pdf_url),
      industry: row.industry?.trim() || null,
      awarenessStage: row.awareness_stage?.trim() || null,
      ratio: row.ratio?.trim() || null,
      theme: row.theme?.trim() || null,
      platform: row.platform?.trim() || null,
      subCategory: ctx.subCategory,
      isActive: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dfyTemplatesTable.category, targetCategory),
        eq(dfyTemplatesTable.sourceDisplayId, did),
      ),
    );
  report.updated += 1;
}

async function upsertRow(
  ctx: ImportContext,
  row: CsvRow,
  idx: number,
  imageUrl: string,
  mediaKind: "image" | "video",
  report: ImportReport,
) {
  // Defence in depth: refuse to ever persist a non-owned URL even if a
  // caller bypasses the upload step somehow.
  if (!imageUrl.startsWith("/api/portal/images/")) {
    report.skipped += 1;
    return;
  }
  const did = row.display_id.trim();
  const targetCategory = ctx.remapCategory ? ctx.remapCategory(row) : ctx.category;
  if (isBlocklisted(targetCategory, did)) {
    report.skipped += 1;
    return;
  }
  const values = {
    category: targetCategory,
    subCategory: ctx.subCategory,
    sourceDisplayId: did,
    title: row.title.trim(),
    imageUrl,
    mediaKind,
    canvaUrl: sanitizeExternalUrl(row.canva_url),
    liveUrl: sanitizeExternalUrl(row.live_url),
    pdfUrl: sanitizeExternalUrl(row.pdf_url),
    industry: row.industry?.trim() || null,
    awarenessStage: row.awareness_stage?.trim() || null,
    ratio: row.ratio?.trim() || null,
    theme: row.theme?.trim() || null,
    // T262: optional new fields. Falsy values map to null so the row
    // stays consistent across re-imports of older CSVs that omit them.
    theme2: row.theme2?.trim() || null,
    theme3: row.theme3?.trim() || null,
    brandName: row.brand_name?.trim() || null,
    adCopy: row.ad_copy ?? null,
    platform: row.platform?.trim() || null,
    sortOrder: idx,
    isActive: true,
    updatedAt: new Date(),
  };
  const result = await db
    .insert(dfyTemplatesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [dfyTemplatesTable.category, dfyTemplatesTable.sourceDisplayId],
      set: {
        title: values.title,
        imageUrl: values.imageUrl,
        mediaKind: values.mediaKind,
        canvaUrl: values.canvaUrl,
        liveUrl: values.liveUrl,
        pdfUrl: values.pdfUrl,
        industry: values.industry,
        awarenessStage: values.awarenessStage,
        ratio: values.ratio,
        theme: values.theme,
        theme2: values.theme2,
        theme3: values.theme3,
        brandName: values.brandName,
        adCopy: values.adCopy,
        platform: values.platform,
        subCategory: values.subCategory,
        sortOrder: values.sortOrder,
        isActive: true,
        updatedAt: values.updatedAt,
      },
    })
    .returning({ id: dfyTemplatesTable.id });
  if (result.length) report.inserted += 1;
  else report.updated += 1;
}

// Convenience helper for the one-shot CLI: discover the matching CSV
// in `assetsDir` and run the importer for `category`.
export async function runImportForCategory(
  category: string,
  opts: { assetsDir: string; limit?: number; log?: (msg: string) => void },
): Promise<ImportReport[]> {
  const reports: ImportReport[] = [];
  const adSwipeCsv = findLatest(opts.assetsDir, "templates-ad_swipe");
  const monthlyCsv = findLatest(opts.assetsDir, "templates-monthly_drop");
  const freeCsv = findLatest(opts.assetsDir, "templates-free_template");
  const previousCsv = findLatest(opts.assetsDir, "templates-previous_drop");
  const landingCsv = findLatest(opts.assetsDir, "templates-landing_page_swipe");

  const wants = (n: string) => category === "all" || category === n;

  if (adSwipeCsv && wants("ad_swipe")) {
    reports.push(
      await runImport({
        category: "ad_swipe",
        subCategory: null,
        manifestType: "ad_swipe",
        csvPath: adSwipeCsv,
        assetsDir: opts.assetsDir,
        limit: opts.limit,
        log: opts.log,
      }),
    );
  }
  if (monthlyCsv && wants("monthly_drop")) {
    reports.push(
      await runImport({
        category: "canva_ad_template",
        subCategory: "monthly_drop",
        manifestType: "monthly_drop",
        csvPath: monthlyCsv,
        assetsDir: opts.assetsDir,
        limit: opts.limit,
        log: opts.log,
      }),
    );
  }
  if (freeCsv && wants("free_template")) {
    reports.push(
      await runImport({
        category: "canva_ad_template",
        subCategory: "free_template",
        manifestType: "free_template",
        csvPath: freeCsv,
        assetsDir: opts.assetsDir,
        limit: opts.limit,
        log: opts.log,
      }),
    );
  }
  if (previousCsv && wants("previous_drop")) {
    reports.push(
      await runImport({
        category: "canva_ad_template",
        subCategory: "previous_drop",
        manifestType: "previous_drop",
        csvPath: previousCsv,
        assetsDir: opts.assetsDir,
        limit: opts.limit,
        log: opts.log,
      }),
    );
  }
  if (landingCsv) {
    const landingFilter = (r: CsvRow) => /^Landing Swipe/i.test(r.title || "");
    const advertorialFilter = (r: CsvRow) => /^Advertorial Swipe/i.test(r.title || "");
    const quizFilter = (r: CsvRow) => /^Quiz Funnel/i.test(r.title || "");
    if (wants("landing_page_swipe")) {
      reports.push(
        await runImport({
          category: "landing_page_swipe",
          subCategory: null,
          manifestType: "landing_page_swipe",
          csvPath: landingCsv,
          assetsDir: opts.assetsDir,
          filter: landingFilter,
          limit: opts.limit,
          log: opts.log,
        }),
      );
    }
    if (wants("advertorial_swipe")) {
      reports.push(
        await runImport({
          category: "advertorial_swipe",
          subCategory: null,
          manifestType: "landing_page_swipe",
          csvPath: landingCsv,
          assetsDir: opts.assetsDir,
          filter: advertorialFilter,
          limit: opts.limit,
          log: opts.log,
        }),
      );
    }
    if (wants("funnel_template")) {
      reports.push(
        await runImport({
          category: "funnel_template",
          subCategory: null,
          manifestType: "landing_page_swipe",
          csvPath: landingCsv,
          assetsDir: opts.assetsDir,
          filter: quizFilter,
          limit: opts.limit,
          log: opts.log,
        }),
      );
    }
  }
  return reports;
}

// Map admin-pasted CSVs to the importer context. Used by the admin
// re-import endpoint.
export function manifestTypeForCategory(category: string, subCategory: string | null): string {
  if (category === "canva_ad_template") {
    if (subCategory === "monthly_drop") return "monthly_drop";
    if (subCategory === "free_template") return "free_template";
    if (subCategory === "previous_drop") return "previous_drop";
    return "monthly_drop";
  }
  if (category === "advertorial_swipe" || category === "funnel_template") {
    return "landing_page_swipe";
  }
  return category;
}
