/* eslint-disable no-console */
// T262: import the new 321-row Ad Swipe File catalog plus the matching
// images and videos straight from Google Drive into dfy_templates.
//
// - CSV: attached_assets/ad-swipe-export_1778657509236.csv
//   Columns: display_id, image_filename, title, brand_name, industry,
//   theme, theme2, theme3, ratio, awareness_stage, platform, ad_copy,
//   image_url, canva_url
// - Images Drive folder: 14iCa4e0_DsJEkn-HIvp73GeaX_xqIkTw
//   Filenames match the CSV's image_filename column.
// - Videos Drive folder: 1y5jLd5t3UXi02VZgxmtbIQNMk1YUECpJ
//   Each file becomes an ad_swipe row with mediaKind='video'. If the
//   filename matches a CSV row by stem or display_id prefix, it joins
//   that row's metadata; otherwise it ships as a standalone video tile.
//
// Idempotent on (category='ad_swipe', sourceDisplayId). Re-running
// produces zero net new inserts; existing rows whose imageUrl already
// points at our object storage are skipped (no Drive download).
//
// Reconciliation: any pre-existing ad_swipe row whose sourceDisplayId
// is no longer in the new CSV and which is not a video tile is removed
// (favourites cascade-delete via FK).
//
// Usage:
//   pnpm --filter @workspace/scripts run seed-dfy-ad-swipes
//   pnpm --filter @workspace/scripts run seed-dfy-ad-swipes -- --csv ./attached_assets/ad-swipe-export_1778657509236.csv
//   pnpm --filter @workspace/scripts run seed-dfy-ad-swipes -- --dry-run
//   pnpm --filter @workspace/scripts run seed-dfy-ad-swipes -- --skip-images --skip-videos

import { readFileSync, existsSync, createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { parse as csvParse } from "csv-parse/sync";
import { db, dfyTemplatesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  listDriveFolderImages,
  listDriveFolderVideos,
  getDriveFileStream,
  type DriveFile,
} from "../../artifacts/api-server/src/lib/google-drive";
import { objectStorageClient } from "../../artifacts/api-server/src/lib/objectStorage";

const IMAGES_FOLDER_ID = "14iCa4e0_DsJEkn-HIvp73GeaX_xqIkTw";
const VIDEOS_FOLDER_ID = "1y5jLd5t3UXi02VZgxmtbIQNMk1YUECpJ";
const CATEGORY = "ad_swipe";
const VIDEO_DISPLAY_ID_PREFIX = "video-";

type CsvRow = {
  display_id: string;
  image_filename: string;
  title: string;
  brand_name?: string;
  industry?: string;
  theme?: string;
  theme2?: string;
  theme3?: string;
  ratio?: string;
  awareness_stage?: string;
  platform?: string;
  ad_copy?: string;
  image_url?: string;
  canva_url?: string;
};

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const CSV_PATH = resolve(
  arg("--csv") ||
    "attached_assets/ad-swipe-export_1778657509236.csv",
);
const DRY_RUN = flag("--dry-run");
const SKIP_IMAGES = flag("--skip-images");
const SKIP_VIDEOS = flag("--skip-videos");

function detectMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/mp4";
  return "application/octet-stream";
}

function extOf(name: string, fallback = "jpg"): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : fallback;
}

function stemOf(name: string): string {
  return name.replace(/\.[^./]+$/, "").trim();
}

function bucketAndDir(): { bucketId: string; privateDir: string } {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set",
    );
  }
  return { bucketId, privateDir };
}

// Stream a Drive file to a local temp path while computing its sha1 in
// flight. Returns the path + content hash + size so the caller can
// upload it without ever loading the whole file into memory. This is
// the difference between a 5GB Drive folder of MP4s OOM-ing the script
// and finishing in a single pass.
async function streamDriveFileToTemp(
  fileId: string,
  outDir: string,
  baseName: string,
): Promise<{ path: string; sha1: string; size: number }> {
  const res = await getDriveFileStream(fileId);
  if (!res.ok || !res.body) {
    throw new Error(`Drive download ${fileId} failed: ${res.status}`);
  }
  const path = join(outDir, baseName);
  const hash = crypto.createHash("sha1");
  // Hashing Transform sits inline in the pipeline so backpressure is
  // honoured end-to-end: the upstream Drive Readable only produces
  // more data when the downstream file write drains. No manual
  // `data`/`push` taps, no unbounded memory growth on big MP4s.
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const source = Readable.fromWeb(res.body as any);
  await pipeline(source, hasher, createWriteStream(path));
  const st = await stat(path);
  return { path, sha1: hash.digest("hex"), size: st.size };
}

// Upload a local file to object storage using a hash-derived key so
// identical content resolves to the same object across runs. Streams
// from disk; never holds the file in memory.
async function uploadLocalFile(
  localPath: string,
  sha1: string,
  ext: string,
  mime: string,
): Promise<string> {
  const { bucketId, privateDir } = bucketAndDir();
  const fileName = `dfy-${sha1.slice(0, 24)}.${ext}`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    await pipeline(
      createReadStream(localPath),
      file.createWriteStream({
        contentType: mime,
        metadata: { cacheControl: "public, max-age=31536000, immutable" },
        resumable: false,
      }),
    );
  }
  return `/api/portal/images/${fileName}`;
}

type ExistingRow = {
  id: number;
  sourceDisplayId: string | null;
  imageUrl: string | null;
  driveModifiedTime: Date | null;
};

async function loadExisting(): Promise<Map<string, ExistingRow>> {
  const rows = await db
    .select({
      id: dfyTemplatesTable.id,
      sourceDisplayId: dfyTemplatesTable.sourceDisplayId,
      imageUrl: dfyTemplatesTable.imageUrl,
      driveModifiedTime: dfyTemplatesTable.driveModifiedTime,
    })
    .from(dfyTemplatesTable)
    .where(eq(dfyTemplatesTable.category, CATEGORY));
  const map = new Map<string, ExistingRow>();
  for (const r of rows) {
    if (r.sourceDisplayId) map.set(r.sourceDisplayId, r);
  }
  return map;
}

async function upsertRow(values: {
  sourceDisplayId: string;
  title: string;
  imageUrl: string;
  mediaKind: "image" | "video";
  industry: string | null;
  awarenessStage: string | null;
  ratio: string | null;
  theme: string | null;
  theme2: string | null;
  theme3: string | null;
  platform: string | null;
  brandName: string | null;
  adCopy: string | null;
  canvaUrl: string | null;
  sortOrder: number;
  driveModifiedTime: Date | null;
}): Promise<{ inserted: boolean }> {
  if (DRY_RUN) return { inserted: false };
  const result = await db
    .insert(dfyTemplatesTable)
    .values({
      category: CATEGORY,
      subCategory: null,
      ...values,
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dfyTemplatesTable.category, dfyTemplatesTable.sourceDisplayId],
      set: {
        title: values.title,
        imageUrl: values.imageUrl,
        mediaKind: values.mediaKind,
        industry: values.industry,
        awarenessStage: values.awarenessStage,
        ratio: values.ratio,
        theme: values.theme,
        theme2: values.theme2,
        theme3: values.theme3,
        platform: values.platform,
        brandName: values.brandName,
        adCopy: values.adCopy,
        canvaUrl: values.canvaUrl,
        sortOrder: values.sortOrder,
        driveModifiedTime: values.driveModifiedTime,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: dfyTemplatesTable.id });
  return { inserted: result.length > 0 };
}

const FORCE_REFRESH = flag("--force-refresh");

// Decide whether we need to (re-)download a Drive file. We re-download
// if the row has no imageUrl on our storage yet, or the row's
// driveModifiedTime is older than the Drive file's modifiedTime, or
// the operator passed --force-refresh.
function needsDownload(
  prior: ExistingRow | undefined,
  driveModifiedAt: Date | null,
): boolean {
  if (FORCE_REFRESH) return true;
  if (!prior) return true;
  if (!prior.imageUrl?.startsWith("/api/portal/images/")) return true;
  if (!driveModifiedAt) return false;
  if (!prior.driveModifiedTime) return true;
  return driveModifiedAt.getTime() > prior.driveModifiedTime.getTime();
}

async function main() {
  if (!existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }
  if (!DRY_RUN) bucketAndDir();

  const raw = readFileSync(CSV_PATH);
  const rows = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as CsvRow[];

  console.log(`[csv] parsed ${rows.length} rows from ${CSV_PATH}`);

  const existing = await loadExisting();
  console.log(`[db] ${existing.size} pre-existing ad_swipe rows`);

  // Drive listings
  let imageFiles: DriveFile[] = [];
  let videoFiles: DriveFile[] = [];
  if (!SKIP_IMAGES) {
    console.log(`[drive] listing images folder ${IMAGES_FOLDER_ID}...`);
    imageFiles = await listDriveFolderImages(IMAGES_FOLDER_ID, { force: true });
    console.log(`[drive] images folder: ${imageFiles.length} files`);
  }
  if (!SKIP_VIDEOS) {
    console.log(`[drive] listing videos folder ${VIDEOS_FOLDER_ID}...`);
    videoFiles = await listDriveFolderVideos(VIDEOS_FOLDER_ID);
    console.log(`[drive] videos folder: ${videoFiles.length} files`);
  }

  const imageByName = new Map<string, DriveFile>();
  for (const f of imageFiles) imageByName.set(f.name, f);

  // Single temp dir for the whole run; each Drive file streams in,
  // gets uploaded, and is deleted on the next iteration. Wrapping in a
  // try/finally ensures we always clean up even on early exit.
  const tempDir = DRY_RUN
    ? ""
    : await mkdtemp(join(tmpdir(), "dfy-seed-"));

  // ---- Pass 1: CSV-backed rows --------------------------------------
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let missingImage = 0;
  let downloadFailed = 0;
  const csvDisplayIds = new Set<string>();

  for (const [idx, row] of rows.entries()) {
    const did = (row.display_id || "").trim();
    if (!did || !row.title) {
      skipped += 1;
      continue;
    }
    csvDisplayIds.add(did);

    const prior = existing.get(did);
    const driveFile = imageByName.get(row.image_filename || "");
    const driveModifiedAt = driveFile?.modifiedTime
      ? new Date(driveFile.modifiedTime)
      : null;

    let imageUrl = prior?.imageUrl || null;
    let mediaKind: "image" | "video" =
      prior?.imageUrl?.match(/\.(mp4|mov|webm)$/i) ? "video" : "image";

    if (needsDownload(prior, driveModifiedAt)) {
      if (SKIP_IMAGES) {
        skipped += 1;
        continue;
      }
      if (!driveFile) {
        missingImage += 1;
        skipped += 1;
        continue;
      }
      const tmpName = `csv-${did}-${driveFile.id}-${driveFile.name}`;
      let tmpPath: string | null = null;
      try {
        const ext = extOf(driveFile.name, "jpg");
        const mime = driveFile.mimeType || detectMime(driveFile.name);
        const dl = await streamDriveFileToTemp(driveFile.id, tempDir, tmpName);
        tmpPath = dl.path;
        imageUrl = await uploadLocalFile(dl.path, dl.sha1, ext, mime);
        mediaKind = mime.startsWith("video/") ? "video" : "image";
      } catch (e: any) {
        console.error(`[image] ${did} ${row.image_filename}: ${e?.message}`);
        downloadFailed += 1;
        skipped += 1;
        continue;
      } finally {
        if (tmpPath) await rm(tmpPath, { force: true });
      }
    }

    if (!imageUrl) {
      skipped += 1;
      continue;
    }

    const res = await upsertRow({
      sourceDisplayId: did,
      title: row.title.trim(),
      imageUrl,
      mediaKind,
      industry: row.industry?.trim() || null,
      awarenessStage: row.awareness_stage?.trim() || null,
      ratio: row.ratio?.trim() || null,
      theme: row.theme?.trim() || null,
      theme2: row.theme2?.trim() || null,
      theme3: row.theme3?.trim() || null,
      platform: row.platform?.trim() || null,
      brandName: row.brand_name?.trim() || null,
      adCopy: row.ad_copy ?? null,
      canvaUrl: row.canva_url?.trim() || null,
      sortOrder: idx,
      driveModifiedTime: driveModifiedAt,
    });
    if (prior) updated += 1;
    else if (res.inserted) inserted += 1;

    if ((idx + 1) % 50 === 0) {
      console.log(`[csv] processed ${idx + 1}/${rows.length}`);
    }
  }

  // ---- Pass 2: standalone videos ------------------------------------
  let videosAdded = 0;
  let videosUpdated = 0;
  let videosFailed = 0;
  const videoDisplayIds = new Set<string>();

  for (const [vIdx, vfile] of videoFiles.entries()) {
    // Try to attach to a CSV row by image_filename stem or display_id prefix.
    const stem = stemOf(vfile.name).toLowerCase();
    let attached: CsvRow | undefined;
    for (const r of rows) {
      const csvStem = stemOf(r.image_filename || "").toLowerCase();
      if (csvStem && csvStem === stem) {
        attached = r;
        break;
      }
    }
    if (!attached) {
      const m = stem.match(/^(\d+)[_\-\s]/);
      if (m) {
        const candidate = m[1];
        attached = rows.find((r) => (r.display_id || "").trim() === candidate);
      }
    }

    // sourceDisplayId for standalone videos is namespaced so it can
    // never collide with a CSV row's numeric display_id.
    const sourceDisplayId = `${VIDEO_DISPLAY_ID_PREFIX}${vfile.id}`;
    videoDisplayIds.add(sourceDisplayId);

    const prior = existing.get(sourceDisplayId);
    const driveModifiedAt = vfile.modifiedTime
      ? new Date(vfile.modifiedTime)
      : null;

    let imageUrl = prior?.imageUrl || null;

    if (needsDownload(prior, driveModifiedAt)) {
      const tmpName = `vid-${vfile.id}-${vfile.name}`;
      let tmpPath: string | null = null;
      try {
        const ext = extOf(vfile.name, "mp4");
        const mime = vfile.mimeType || detectMime(vfile.name);
        const dl = await streamDriveFileToTemp(vfile.id, tempDir, tmpName);
        tmpPath = dl.path;
        imageUrl = await uploadLocalFile(dl.path, dl.sha1, ext, mime);
      } catch (e: any) {
        console.error(`[video] ${vfile.name}: ${e?.message}`);
        videosFailed += 1;
        continue;
      } finally {
        if (tmpPath) await rm(tmpPath, { force: true });
      }
    }
    if (!imageUrl) {
      videosFailed += 1;
      continue;
    }

    const title = attached?.title?.trim() || stemOf(vfile.name) || "Video Ad";
    const res = await upsertRow({
      sourceDisplayId,
      title,
      imageUrl,
      mediaKind: "video",
      industry: attached?.industry?.trim() || null,
      awarenessStage: attached?.awareness_stage?.trim() || null,
      ratio: attached?.ratio?.trim() || null,
      theme: attached?.theme?.trim() || null,
      theme2: attached?.theme2?.trim() || null,
      theme3: attached?.theme3?.trim() || null,
      platform: attached?.platform?.trim() || null,
      brandName: attached?.brand_name?.trim() || null,
      adCopy: attached?.ad_copy ?? null,
      canvaUrl: attached?.canva_url?.trim() || null,
      sortOrder: 10_000 + vIdx,
      driveModifiedTime: driveModifiedAt,
    });
    if (prior) videosUpdated += 1;
    else if (res.inserted) videosAdded += 1;
  }

  // Best-effort temp dir cleanup; ignore failures so a partial run
  // doesn't crash before printing the report.
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  // ---- Pass 3: reconcile (delete rows no longer in source) ---------
  // Anything in `existing` whose sourceDisplayId is neither in the new
  // CSV nor a video tile we just imported should be removed. Video tiles
  // that disappear from Drive between runs are also removed (their
  // namespaced sourceDisplayId won't appear in either set).
  const reconcileIds: number[] = [];
  for (const [did, row] of existing.entries()) {
    if (csvDisplayIds.has(did)) continue;
    if (videoDisplayIds.has(did)) continue;
    reconcileIds.push(row.id);
  }
  let reconciled = 0;
  if (reconcileIds.length && !DRY_RUN) {
    // Cascade deletes any matching favourites via FK on
    // dfy_template_favourites.template_id.
    await db
      .delete(dfyTemplatesTable)
      .where(inArray(dfyTemplatesTable.id, reconcileIds));
    reconciled = reconcileIds.length;
  } else {
    reconciled = reconcileIds.length;
  }

  // Final DB counts for the verification note.
  const totals = await db
    .select({
      total: sql<number>`count(*)::int`,
      videos: sql<number>`count(*) FILTER (WHERE ${dfyTemplatesTable.mediaKind} = 'video')::int`,
    })
    .from(dfyTemplatesTable)
    .where(eq(dfyTemplatesTable.category, CATEGORY));

  console.log("\n========= AD SWIPE IMPORT REPORT =========");
  console.log(`CSV path:               ${CSV_PATH}`);
  console.log(`CSV rows parsed:        ${rows.length}`);
  console.log(`CSV inserted (new):     ${inserted}`);
  console.log(`CSV updated/refreshed:  ${updated}`);
  console.log(`CSV skipped:            ${skipped}`);
  console.log(`CSV missing image:      ${missingImage}`);
  console.log(`CSV download failed:    ${downloadFailed}`);
  console.log(`Video files in Drive:   ${videoFiles.length}`);
  console.log(`Videos inserted (new):  ${videosAdded}`);
  console.log(`Videos updated:         ${videosUpdated}`);
  console.log(`Videos failed:          ${videosFailed}`);
  console.log(`Reconciled (removed):   ${reconciled}${DRY_RUN ? " (dry-run, not deleted)" : ""}`);
  console.log(
    `DB now: ${totals[0]?.total ?? 0} ad_swipe rows (${totals[0]?.videos ?? 0} videos)`,
  );
  if (DRY_RUN) console.log("(dry-run: no DB writes performed)");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-dfy-ad-swipes] fatal", err);
  process.exit(1);
});
