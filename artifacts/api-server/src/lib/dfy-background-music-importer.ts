// T257: DFY Background Reel Music importer.
//
// Walks the two configured Google Drive folders (recursively), streams
// each audio file into our object storage, renders a 30s preview clip
// with ffmpeg, extracts duration/bitrate, and upserts a row in the
// dfy_background_tracks table. Idempotent on (drive_file_id,
// modified_time): unchanged files are skipped, changed files are
// re-uploaded and re-previewed.
//
// Runs as a fire-and-forget background task triggered by the admin
// "Refresh from Drive" button. Job state is held in an in-memory map
// keyed by jobId so the admin UI can poll progress.

import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { eq, isNull, sql } from "drizzle-orm";
import { db, dfyBackgroundTracksTable } from "@workspace/db";
import { objectStorageClient } from "./objectStorage";
import {
  listDriveFolderAudioRecursive,
  getDriveFileStream,
  type DriveFile,
} from "./google-drive";
import { logger } from "./logger";

// Source-of-truth folder list for the importer. Hard-coded so a leaked
// file id can never be turned into an arbitrary Drive proxy.
export const BACKGROUND_MUSIC_DRIVE_FOLDERS: string[] = [
  "16GuMe7NQaCUybM8eWcBFjgzYmQ5jj1DU",
  "1ZZx0c9LPDhScihpTDoT8UbNqnok_ZAQL",
];

const OBJECT_KEY_PREFIX = "dfy/background-music";

export type BackgroundMusicJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed";

export interface BackgroundMusicJob {
  id: string;
  status: BackgroundMusicJobStatus;
  startedAt: number;
  finishedAt: number | null;
  total: number;
  processed: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string | null;
  error: string | null;
}

const jobs = new Map<string, BackgroundMusicJob>();
let activeJobId: string | null = null;

export function getBackgroundMusicJob(id: string): BackgroundMusicJob | null {
  return jobs.get(id) ?? null;
}

export function getActiveBackgroundMusicJobId(): string | null {
  return activeJobId;
}

function newJob(): BackgroundMusicJob {
  return {
    id: randomUUID(),
    status: "pending",
    startedAt: Date.now(),
    finishedAt: null,
    total: 0,
    processed: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    message: null,
    error: null,
  };
}

function pruneOldJobs(): void {
  if (jobs.size <= 20) return;
  const entries = Array.from(jobs.values()).sort((a, b) => a.startedAt - b.startedAt);
  while (entries.length > 20) {
    const e = entries.shift()!;
    jobs.delete(e.id);
  }
}

export function cleanFilenameToTitle(filename: string): string {
  let s = filename || "";
  s = s.replace(/\.[a-z0-9]{2,5}$/i, "");
  s = s.replace(/[_\-]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "Untitled";
  const small = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "with", "for", "by", "at", "vs"]);
  return s
    .split(" ")
    .map((w, i) => {
      if (!w) return w;
      if (w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function bucketAndPath(): { bucketId: string; privateDir: string } {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set",
    );
  }
  return { bucketId, privateDir };
}

function objectKeyForOriginal(driveFileId: string, ext: string): string {
  const safeExt = (ext || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  return `${OBJECT_KEY_PREFIX}/${driveFileId}/original.${safeExt}`;
}

function objectKeyForPreview(driveFileId: string): string {
  return `${OBJECT_KEY_PREFIX}/${driveFileId}/preview.mp3`;
}

// T396: 32-char alphabet excluding ambiguous glyphs (0/O/1/I/L) so
// codes are easy to read off-screen and dictate aloud.
const TRACK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TRACK_CODE_LEN = 6;

function randomTrackCode(): string {
  let suffix = "";
  for (let i = 0; i < TRACK_CODE_LEN; i++) {
    suffix += TRACK_CODE_ALPHABET.charAt(
      Math.floor(Math.random() * TRACK_CODE_ALPHABET.length),
    );
  }
  return `BGM-${suffix}`;
}

// Try a fresh code until the unique index accepts it. With ~31^6 =
// 887M possible suffixes vs O(1000s) of rows, collisions are
// vanishingly rare but we still retry defensively.
async function generateUniqueTrackCode(): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = randomTrackCode();
    const existing = await db
      .select({ id: dfyBackgroundTracksTable.id })
      .from(dfyBackgroundTracksTable)
      .where(eq(dfyBackgroundTracksTable.trackCode, candidate))
      .limit(1);
    if (!existing.length) return candidate;
  }
  throw new Error("Could not allocate a unique BGM track code after 25 tries");
}

function extOfFilename(name: string, fallback = "mp3"): string {
  const m = (name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : fallback;
}

interface AudioMetadata {
  durationSeconds: number | null;
  bitrateBps: number | null;
}

// Probe duration and bitrate via ffprobe in one call. Best-effort:
// either field may come back null on failure.
async function ffprobeAudio(filePath: string): Promise<AudioMetadata> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration,bit_rate",
        "-of", "default=noprint_wrappers=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    const killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* noop */ } }, 15_000);
    proc.once("close", () => {
      clearTimeout(killTimer);
      let durationSeconds: number | null = null;
      let bitrateBps: number | null = null;
      for (const line of out.split(/\r?\n/)) {
        const [k, v] = line.split("=");
        if (!k || !v) continue;
        if (k.trim() === "duration") {
          const n = parseFloat(v.trim());
          if (Number.isFinite(n) && n > 0) durationSeconds = Math.round(n);
        } else if (k.trim() === "bit_rate") {
          const n = parseInt(v.trim(), 10);
          if (Number.isFinite(n) && n > 0) bitrateBps = n;
        }
      }
      resolve({ durationSeconds, bitrateBps });
    });
    proc.once("error", () => { clearTimeout(killTimer); resolve({ durationSeconds: null, bitrateBps: null }); });
  });
}

// Render a 30s 96kbps mp3 preview from the original audio file. Starts
// 10s in (or the midpoint if the file is shorter than 30s) so the
// preview lands on the body of the track rather than fade-in silence.
async function generatePreview(
  inputPath: string,
  outputPath: string,
  fullDurationSec: number | null,
): Promise<void> {
  let startSec = 10;
  if (fullDurationSec != null && fullDurationSec < 30) {
    startSec = Math.max(0, Math.floor(fullDurationSec / 2) - 1);
  } else if (fullDurationSec != null && fullDurationSec - 30 < startSec) {
    startSec = Math.max(0, fullDurationSec - 30);
  }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel", "error",
        "-ss", String(startSec),
        "-t", "30",
        "-i", inputPath,
        "-vn",
        "-acodec", "libmp3lame",
        "-b:a", "96k",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* noop */ } }, 60_000);
    proc.once("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg preview exit ${code}: ${stderr.slice(0, 200)}`));
    });
    proc.once("error", (err) => { clearTimeout(killTimer); reject(err); });
  });
}

// Stream a local file straight into the GCS object instead of reading
// the whole thing into memory.
async function uploadFile(
  bucketId: string,
  objectKeyAbs: string,
  bodyPath: string,
  contentType: string,
): Promise<void> {
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectKeyAbs);
  const writeStream = file.createWriteStream({
    contentType,
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  await pipeline(createReadStream(bodyPath), writeStream);
}

// Stream the Drive download body straight to disk. Returns the bytes
// written. Avoids buffering the whole file in memory.
async function streamDriveFileTo(filePath: string, driveFileId: string): Promise<number> {
  const upstream = await getDriveFileStream(driveFileId);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Drive fetch failed: HTTP ${upstream.status}`);
  }
  // Node fetch's body is a web ReadableStream; convert to a Node Readable.
  const nodeReadable = Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeReadable, createWriteStream(filePath));
  const s = await stat(filePath);
  return s.size;
}

function absPath(privateDir: string, key: string): string {
  return `${privateDir}/${key}`;
}

async function processOneFile(
  job: BackgroundMusicJob,
  file: DriveFile,
  bucketId: string,
  privateDir: string,
): Promise<void> {
  const driveFileId = file.id;
  const driveModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;

  const existing = await db
    .select()
    .from(dfyBackgroundTracksTable)
    .where(eq(dfyBackgroundTracksTable.driveFileId, driveFileId))
    .limit(1);

  if (existing.length) {
    const cur = existing[0];
    const sameMtime =
      cur.driveModifiedTime != null &&
      driveModifiedTime != null &&
      cur.driveModifiedTime.getTime() === driveModifiedTime.getTime();
    if (sameMtime && cur.previewObjectKey) {
      job.skipped += 1;
      return;
    }
  }

  const tmp = await mkdtemp(join(tmpdir(), "dfy-bgm-"));
  try {
    const ext = extOfFilename(file.name, "mp3");
    const localOriginal = join(tmp, `original.${ext}`);
    const localPreview = join(tmp, `preview.mp3`);

    const fileSize = await streamDriveFileTo(localOriginal, driveFileId);
    const { durationSeconds, bitrateBps } = await ffprobeAudio(localOriginal);
    await generatePreview(localOriginal, localPreview, durationSeconds);

    const originalKey = objectKeyForOriginal(driveFileId, ext);
    const previewKey = objectKeyForPreview(driveFileId);
    const mime = file.mimeType || `audio/${ext}`;

    await uploadFile(bucketId, absPath(privateDir, originalKey), localOriginal, mime);
    await uploadFile(bucketId, absPath(privateDir, previewKey), localPreview, "audio/mpeg");

    if (existing.length) {
      const cur = existing[0];
      // display_title is intentionally not overwritten on update so
      // that admin renames stick across re-imports.
      await db
        .update(dfyBackgroundTracksTable)
        .set({
          driveModifiedTime,
          originalFilename: file.name,
          mimeType: mime,
          fileSize,
          durationSeconds,
          bitrateBps,
          originalObjectKey: originalKey,
          previewObjectKey: previewKey,
          updatedAt: new Date(),
        })
        .where(eq(dfyBackgroundTracksTable.id, cur.id));
      job.updated += 1;
    } else {
      const trackCode = await generateUniqueTrackCode();
      await db.insert(dfyBackgroundTracksTable).values({
        driveFileId,
        driveModifiedTime,
        displayTitle: cleanFilenameToTitle(file.name),
        originalFilename: file.name,
        mimeType: mime,
        fileSize,
        durationSeconds,
        bitrateBps,
        originalObjectKey: originalKey,
        previewObjectKey: previewKey,
        trackCode,
      });
      job.added += 1;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function runJob(job: BackgroundMusicJob): Promise<void> {
  job.status = "running";
  try {
    const { bucketId, privateDir } = bucketAndPath();
    job.message = "Listing Google Drive folders...";
    const files: DriveFile[] = [];
    const seen = new Set<string>();
    for (const folderId of BACKGROUND_MUSIC_DRIVE_FOLDERS) {
      const list = await listDriveFolderAudioRecursive(folderId);
      for (const f of list) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        files.push(f);
      }
    }
    job.total = files.length;
    job.message = `Importing ${files.length} tracks...`;
    logger.info({ event: "bgm-import-start", jobId: job.id, total: files.length }, "bgm import start");

    for (const file of files) {
      try {
        await processOneFile(job, file, bucketId, privateDir);
      } catch (err: unknown) {
        job.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          { event: "bgm-import-file-failed", driveFileId: file.id, err: message },
          "bgm import file failed",
        );
      } finally {
        job.processed += 1;
      }
    }

    job.status = "done";
    job.message = `Done. Added ${job.added}, updated ${job.updated}, skipped ${job.skipped}, failed ${job.failed}.`;
    logger.info(
      {
        event: "bgm-import-done",
        jobId: job.id,
        added: job.added,
        updated: job.updated,
        skipped: job.skipped,
        failed: job.failed,
      },
      "bgm import done",
    );
  } catch (err: unknown) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    logger.error({ event: "bgm-import-failed", jobId: job.id, err: job.error }, "bgm import failed");
  } finally {
    job.finishedAt = Date.now();
    if (activeJobId === job.id) activeJobId = null;
  }
}

export function startBackgroundMusicImport(): BackgroundMusicJob {
  if (activeJobId) {
    const cur = jobs.get(activeJobId);
    if (cur && cur.status !== "done" && cur.status !== "failed") {
      return cur;
    }
  }
  const job = newJob();
  jobs.set(job.id, job);
  activeJobId = job.id;
  pruneOldJobs();
  void runJob(job).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "bgm runJob threw");
  });
  return job;
}

// Used by the streaming endpoints to find the absolute object path for
// a track's preview / original file.
export function previewObjectAbsPath(privateDir: string, key: string): string {
  return absPath(privateDir, key);
}

// Boot hook: ensure the dfy_background_tracks table is populated from
// the configured Drive folders. The full Drive walk takes ~3h for the
// production folders, but the importer is idempotent on
// (drive_file_id, modified_time) so already-imported tracks are
// skipped almost for free. We always kick off a run on worker boot
// when no other job is active; once the table reaches the configured
// expected minimum (BGM_BOOT_IMPORT_THRESHOLD, default 2000) we stop
// auto-running so subsequent restarts don't re-walk Drive on every
// reboot. Admins can still trigger a manual refresh from the UI to
// pick up new uploads. Never throws.
//
// Threshold default is set above the known source corpus (~1867 files
// in the configured Drive folders) so a mid-run restart cannot leave
// us "almost done" and stop auto-resuming. Override via
// BGM_BOOT_IMPORT_THRESHOLD env var if the corpus grows substantially.
const BOOT_IMPORT_THRESHOLD = (() => {
  const raw = process.env["BGM_BOOT_IMPORT_THRESHOLD"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 2000;
})();

// T396: defensive backfill for any rows that still lack a track_code
// (e.g. a runtime starts before migration 0040 has been applied).
// Cheap on every boot - one indexed scan + at most one UPDATE per
// row that's missing a code, which only happens during the one-time
// catch-up window. Never throws.
export async function ensureBackgroundTrackCodesBackfilled(): Promise<void> {
  try {
    const missing = await db
      .select({ id: dfyBackgroundTracksTable.id })
      .from(dfyBackgroundTracksTable)
      .where(isNull(dfyBackgroundTracksTable.trackCode));
    if (!missing.length) return;
    let assigned = 0;
    for (const row of missing) {
      const code = await generateUniqueTrackCode();
      await db
        .update(dfyBackgroundTracksTable)
        .set({ trackCode: code })
        .where(eq(dfyBackgroundTracksTable.id, row.id));
      assigned += 1;
    }
    logger.info(
      { event: "bgm-track-code-backfill", assigned },
      "backfilled BGM track codes",
    );
  } catch (err) {
    logger.error(
      {
        event: "bgm-track-code-backfill-failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "ensureBackgroundTrackCodesBackfilled failed",
    );
  }
}

export async function ensureBackgroundMusicImportedOnBoot(): Promise<void> {
  try {
    await ensureBackgroundTrackCodesBackfilled();
    if (activeJobId) return;
    const rows = await db
      .select({ id: dfyBackgroundTracksTable.id })
      .from(dfyBackgroundTracksTable);
    if (rows.length >= BOOT_IMPORT_THRESHOLD) return;
    const job = startBackgroundMusicImport();
    logger.info(
      {
        event: "bgm-auto-import-started",
        jobId: job.id,
        existingRows: rows.length,
        threshold: BOOT_IMPORT_THRESHOLD,
      },
      "auto-started background music import on worker boot",
    );
  } catch (err) {
    logger.error(
      { event: "bgm-auto-import-boot-failed", err: err instanceof Error ? err.message : String(err) },
      "ensureBackgroundMusicImportedOnBoot failed",
    );
  }
}
