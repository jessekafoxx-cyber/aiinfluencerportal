// T317: DFY 70K B-Roll bulk importer.
//
// Walks the 18 Drive folders linked from the Room30 portal's
// "70K Viral Video B-Roll" page (Canva packs 9-11 are excluded -
// they stay external), streams every video file from Drive into our
// GCS bucket under `dfy-broll/<public_id>/<sanitized-name>`, and
// records a row in dfy_broll_clips. Idempotent on drive_file_id:
// already-imported files are skipped on re-run, only failures retry.

import { createWriteStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { eq, inArray } from "drizzle-orm";
import { db, dfyBrollClipsTable } from "@workspace/db";
import { objectStorageClient } from "./objectStorage";
import { listDriveFolderVideosRecursive, getDriveFileStream, type DriveFile } from "./google-drive";
import { logger } from "./logger";

// Source-of-truth (pack -> Drive folder id). Mirrors the PACKS array
// in artifacts/room30-portal/src/pages/dfy/b-roll.tsx for the Drive
// entries only. Duplicate folder ids across packs are intentional and
// handled by the importer (one row, multiple pack numbers).
export const BROLL_DRIVE_PACKS: ReadonlyArray<{ pack: number; folderId: string }> = [
  { pack: 1, folderId: "17-rs-4L7DtkVKEl5e5XTmgbDMiUt9f1T" },
  { pack: 2, folderId: "12PJSdiD-iEjst_suZdVLwxwh-xVbUpKT" },
  { pack: 3, folderId: "1VCkYBk8CCHs3-DrZtAbliACMNw9JfDzF" },
  { pack: 4, folderId: "1nGtZ3hySaN_FNxCghtjE-65ENtjMmBeu" },
  { pack: 5, folderId: "1wGL5xovawKRzse_SzAehSMH9UnYt2Yap" },
  { pack: 6, folderId: "1yEMCm-oRth4D7BrObSaBCcIX7L3FD-ru" },
  { pack: 7, folderId: "1yM3OmqmxToXcGsE-OttfU_2jCUOOoFLN" },
  { pack: 8, folderId: "1yM3OmqmxToXcGsE-OttfU_2jCUOOoFLN" },
  { pack: 12, folderId: "12h2S8oNdUP6T9LQ_Q2cKKFNkWxNl74ne" },
  { pack: 13, folderId: "1C4fg9DhLUKccdRiB84b8VBNFyKCZ0ZIg" },
  { pack: 14, folderId: "14e-wpQIfoV2yfesDSzoJ7LKc2esIcbHd" },
  { pack: 15, folderId: "1ebjv6f_zEYUrftkgIZeXF3DT5cvj-9L0" },
  { pack: 16, folderId: "112wBwxWxlAyE20EwnkREE_wNSftknUjZ" },
  { pack: 17, folderId: "13nPjaYBOdl42LzosB3m5pEgGuLDncRZM" },
  { pack: 18, folderId: "14e-wpQIfoV2yfesDSzoJ7LKc2esIcbHd" },
  { pack: 19, folderId: "1Idg7wvP5qQRZdOX4OJyDqssm35dL2kf2" },
  { pack: 20, folderId: "1RDkSmTGbg7NPmltQOQcIvvaoukzy18B_" },
  { pack: 21, folderId: "1guiG-kGfQ_JmDjryh2-jJzmgSOKhCzpX" },
];

const OBJECT_KEY_PREFIX = "dfy-broll";
const PROGRESS_LOG_EVERY = 50;
const DEFAULT_CONCURRENCY = Number(process.env.BROLL_IMPORT_CONCURRENCY) || 4;
const RATE_LIMIT_MAX_RETRIES = 6;

function bucketAndPath(): { bucketId: string; privatePrefix: string } {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set");
  }
  // PRIVATE_OBJECT_DIR is the LOGICAL prefix that includes the bucket name,
  // e.g. "/replit-objstore-xxx/.private". GCS object names must NOT include
  // the bucket portion - strip it so we get just ".private" (matching the
  // convention used elsewhere in objectStorage.ts).
  const trimmed = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const slash = trimmed.indexOf("/");
  if (slash < 0) {
    throw new Error(`PRIVATE_OBJECT_DIR has unexpected shape: ${privateDir}`);
  }
  const privatePrefix = trimmed.slice(slash + 1); // ".private"
  return { bucketId, privatePrefix };
}

function newPublicId(): string {
  // 16 hex chars (~64 bits) is plenty for collision avoidance across
  // 70K files and matches the unique constraint width comfortably.
  return randomBytes(8).toString("hex");
}

function sanitizeFilename(name: string): string {
  const cleaned = (name || "video").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return cleaned || "video";
}

async function uploadStreamingToGcs(
  bucketId: string,
  objectKeyAbs: string,
  bodyPath: string,
  contentType: string,
  expectedSize: number,
): Promise<void> {
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectKeyAbs);
  const writeStream = file.createWriteStream({
    contentType,
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  const { createReadStream } = await import("fs");
  await pipeline(createReadStream(bodyPath), writeStream);

  // Re-fetch object metadata from GCS and verify the byte count
  // matches what we just streamed up. Catches truncated uploads /
  // resumable mismatches that the write-stream pipeline alone won't.
  const [meta] = await file.getMetadata();
  const actual = Number(meta.size);
  if (!Number.isFinite(actual) || actual !== expectedSize) {
    // Best-effort cleanup so the next run treats this as missing and
    // re-imports it, rather than serving a half-uploaded object.
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new Error(
      `GCS post-upload size mismatch: expected ${expectedSize} bytes, got ${actual}`,
    );
  }
}

async function streamDriveFileTo(filePath: string, driveFileId: string): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const upstream = await getDriveFileStream(driveFileId);
      if (!upstream.ok || !upstream.body) {
        const status = upstream.status;
        // Retry on rate-limit (429) and transient 5xx with exponential backoff + jitter.
        if ((status === 429 || (status >= 500 && status < 600)) && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delay = Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Drive fetch failed: HTTP ${status}`);
      }
      const nodeReadable = Readable.fromWeb(
        upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      await pipeline(nodeReadable, createWriteStream(filePath));
      const s = await stat(filePath);
      return s.size;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on transient network failures (terminated connections, ECONNRESET, etc.).
      if (
        attempt < RATE_LIMIT_MAX_RETRIES &&
        /terminated|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(msg)
      ) {
        const delay = Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface BrollImportRunReport {
  perPackDiscovered: Record<number, number>;
  uniqueDiscovered: number;
  imported: number;
  skipped: number;
  failed: number;
  // Total bytes uploaded to GCS during this run (excludes already-imported
  // skips). Required by the task's done criteria summary.
  bytesUploaded: number;
  failures: Array<{ driveFileId: string; reason: string }>;
}

export async function runBrollImport(opts: { limit?: number } = {}): Promise<BrollImportRunReport> {
  const { bucketId, privatePrefix } = bucketAndPath();

  // Step 1: enumerate every video file across all packs, deduping by
  // drive file id and remembering every pack each file appeared in.
  logger.info({ event: "broll-import-list-start" }, "broll import: listing drive folders");
  const perPackDiscovered: Record<number, number> = {};
  const byDriveId = new Map<string, { file: DriveFile; packs: Set<number> }>();
  for (const { pack, folderId } of BROLL_DRIVE_PACKS) {
    let files: DriveFile[];
    try {
      files = await listDriveFolderVideosRecursive(folderId);
    } catch (err) {
      // Hard fail: silently skipping a folder would leave the corpus
      // incomplete and the importer would still report "done". The
      // task contract requires every video file inside the 18 folders.
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: "broll-import-list-failed", pack, folderId, err: reason },
        "broll list failed - aborting run",
      );
      throw new Error(
        `Drive listing failed for pack ${pack} (folder ${folderId}): ${reason}`,
      );
    }
    perPackDiscovered[pack] = files.length;
    for (const f of files) {
      const cur = byDriveId.get(f.id);
      if (cur) cur.packs.add(pack);
      else byDriveId.set(f.id, { file: f, packs: new Set([pack]) });
    }
    logger.info(
      { event: "broll-import-pack-listed", pack, folderId, count: files.length, uniqueSoFar: byDriveId.size },
      `broll: pack ${pack} -> ${files.length} videos`,
    );
  }

  const allFiles = Array.from(byDriveId.values());
  const sliced = opts.limit && opts.limit > 0 ? allFiles.slice(0, opts.limit) : allFiles;
  logger.info(
    { event: "broll-import-discovered", unique: allFiles.length, processing: sliced.length },
    `broll: ${allFiles.length} unique files discovered (${sliced.length} will be processed)`,
  );

  // Step 2: load already-imported drive ids in chunks so we can skip
  // them without re-fetching from Drive.
  const driveIds = sliced.map((s) => s.file.id);
  const importedSet = new Set<string>();
  const CHUNK = 1000;
  for (let i = 0; i < driveIds.length; i += CHUNK) {
    const chunk = driveIds.slice(i, i + CHUNK);
    const rows = await db
      .select({ driveFileId: dfyBrollClipsTable.driveFileId, status: dfyBrollClipsTable.status })
      .from(dfyBrollClipsTable)
      .where(inArray(dfyBrollClipsTable.driveFileId, chunk));
    for (const r of rows) {
      if (r.status === "imported") importedSet.add(r.driveFileId);
    }
  }
  logger.info(
    { event: "broll-import-resume", alreadyImported: importedSet.size, toProcess: sliced.length - importedSet.size },
    `broll: ${importedSet.size} already imported, ${sliced.length - importedSet.size} to process`,
  );

  const report: BrollImportRunReport = {
    perPackDiscovered,
    uniqueDiscovered: allFiles.length,
    imported: 0,
    skipped: importedSet.size,
    failed: 0,
    bytesUploaded: 0,
    failures: [],
  };

  // Filter out already-imported files up-front so the worker pool only
  // sees real work; keeps the progress counter honest.
  const work = sliced.filter((s) => !importedSet.has(s.file.id));
  let processed = 0;
  const concurrency = Math.max(1, DEFAULT_CONCURRENCY);
  let cursor = 0;
  const t0 = Date.now();

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= work.length) return;
      const { file, packs } = work[idx];
      try {
        const bytes = await processOne(file, packs, bucketId, privatePrefix);
        // processOne returns 0 when a concurrent run already imported the
        // same drive_file_id between our resume snapshot and this call;
        // count those as skips so the summary stays accurate.
        if (bytes > 0) {
          report.imported += 1;
          report.bytesUploaded += bytes;
        } else {
          report.skipped += 1;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.failed += 1;
        report.failures.push({ driveFileId: file.id, reason });
        try {
          await db
            .insert(dfyBrollClipsTable)
            .values({
              publicId: newPublicId(),
              driveFileId: file.id,
              originalFilename: file.name,
              mimeType: file.mimeType || "video/mp4",
              fileSize: null,
              objectKey: "",
              playbackUrl: "",
              packNumbers: Array.from(packs).sort((a, b) => a - b),
              status: "failed",
              errorMessage: reason.slice(0, 500),
            })
            .onConflictDoUpdate({
              target: dfyBrollClipsTable.driveFileId,
              set: { status: "failed", errorMessage: reason.slice(0, 500), updatedAt: new Date() },
              setWhere: eq(dfyBrollClipsTable.status, "failed"),
            });
        } catch (writeErr) {
          logger.warn(
            { event: "broll-import-fail-row-write-failed", driveFileId: file.id, err: writeErr instanceof Error ? writeErr.message : String(writeErr) },
            "broll: failed to record failure row",
          );
        }
        logger.warn(
          { event: "broll-import-file-failed", driveFileId: file.id, name: file.name, err: reason },
          `broll: file failed ${file.id}`,
        );
      }

      processed += 1;
      if (processed % PROGRESS_LOG_EVERY === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = processed / elapsed;
        const eta = rate > 0 ? Math.round((work.length - processed) / rate) : 0;
        logger.info(
          {
            event: "broll-import-progress",
            processed,
            total: work.length,
            imported: report.imported,
            skipped: report.skipped,
            failed: report.failed,
            ratePerSec: Number(rate.toFixed(2)),
            etaSec: eta,
          },
          `broll: ${processed}/${work.length} processed (imp=${report.imported} skip=${report.skipped} fail=${report.failed}) ${rate.toFixed(2)}/s eta=${eta}s`,
        );
      }
    }
  }

  logger.info(
    { event: "broll-import-pool-start", concurrency, work: work.length },
    `broll: launching ${concurrency} workers for ${work.length} files`,
  );
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Final summary report - written to logs per the task spec.
  logger.info(
    {
      event: "broll-import-summary",
      perPackDiscovered: report.perPackDiscovered,
      uniqueDiscovered: report.uniqueDiscovered,
      imported: report.imported,
      skipped: report.skipped,
      failed: report.failed,
      bytesUploaded: report.bytesUploaded,
      failureSample: report.failures.slice(0, 20),
    },
    `broll import done (imported=${report.imported} bytes=${report.bytesUploaded})`,
  );

  return report;
}

async function processOne(
  file: DriveFile,
  packs: Set<number>,
  bucketId: string,
  privatePrefix: string,
): Promise<number> {
  // Re-check inside the loop in case a concurrent run inserted a row.
  const existing = await db
    .select({ id: dfyBrollClipsTable.id, status: dfyBrollClipsTable.status })
    .from(dfyBrollClipsTable)
    .where(eq(dfyBrollClipsTable.driveFileId, file.id))
    .limit(1);
  if (existing.length && existing[0].status === "imported") return 0;

  const publicId = newPublicId();
  const safeName = sanitizeFilename(file.name);
  const objectKey = `${OBJECT_KEY_PREFIX}/${publicId}/${safeName}`;
  const mime = file.mimeType || "video/mp4";
  const playbackUrl = `/api/portal/dfy/broll/${publicId}/play`;

  const tmp = await mkdtemp(join(tmpdir(), "dfy-broll-"));
  try {
    const localPath = join(tmp, safeName);
    const fileSize = await streamDriveFileTo(localPath, file.id);
    if (file.size && Number(file.size) !== fileSize) {
      logger.warn(
        { event: "broll-import-size-mismatch", driveFileId: file.id, expected: file.size, actual: fileSize },
        "broll: drive-reported size differs from downloaded bytes",
      );
    }
    // GCS object name is `<privatePrefix>/<objectKey>` e.g. `.private/dfy-broll/<id>/<name>`.
    // The bucket is identified separately via bucketId; the object name must
    // NOT include the bucket portion of PRIVATE_OBJECT_DIR.
    await uploadStreamingToGcs(bucketId, `${privatePrefix}/${objectKey}`, localPath, mime, fileSize);

    const packNumbers = Array.from(packs).sort((a, b) => a - b);
    // Conflict-safe upsert keyed on drive_file_id. If a concurrent
    // run already imported the same file we leave its row untouched
    // (DO UPDATE only fires when the existing row is still 'failed'),
    // so two workers can race without corrupting state. We use
    // RETURNING + post-check to tell the caller whether THIS call
    // actually moved the row to imported, so the worker doesn't
    // double-count when a parallel worker won the race.
    const written = await db
      .insert(dfyBrollClipsTable)
      .values({
        publicId,
        driveFileId: file.id,
        originalFilename: file.name,
        mimeType: mime,
        fileSize,
        objectKey,
        playbackUrl,
        packNumbers,
        status: "imported",
      })
      .onConflictDoUpdate({
        target: dfyBrollClipsTable.driveFileId,
        set: {
          publicId,
          originalFilename: file.name,
          mimeType: mime,
          fileSize,
          objectKey,
          playbackUrl,
          packNumbers,
          status: "imported",
          errorMessage: null,
          updatedAt: new Date(),
        },
        setWhere: eq(dfyBrollClipsTable.status, "failed"),
      })
      .returning({ publicId: dfyBrollClipsTable.publicId });
    // No rows returned => the row already existed in 'imported' status
    // (our setWhere blocked the UPDATE). The other worker did the
    // upload; treat this call as a skip.
    if (written.length === 0) return 0;
    return fileSize;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
