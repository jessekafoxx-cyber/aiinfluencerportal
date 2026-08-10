// T313: DFY Drive folder asset importer.
//
// Walks each configured Drive folder, mirrors the originals + a generated
// thumbnail (~600px wide WebP) into our object storage, and upserts a row
// into `dfy_drive_assets`. Idempotent on (slug, drive_file_id,
// modified_time): unchanged files are skipped, changed files are
// re-uploaded and re-thumbnailed, and files that disappear from Drive
// are soft-deleted (is_active=false) so the listing endpoint can hide
// them without losing the GCS objects.
//
// Boots into the Media Worker process (NOT the API runtime) on a 5-minute
// cadence and on-demand via the admin "Refresh now" button. A row in
// `dfy_drive_sync_runs` with `lease_expires_at` acts as a heartbeat-style
// lease so two worker processes during a rolling restart can't double-sync
// the same slug; if a worker crashes mid-pass the lease simply expires
// and the next tick re-claims it. Per-row writes are idempotent so a
// half-finished run that gets resumed never duplicates assets.

import { createReadStream, createWriteStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  dfyDriveAssetsTable,
  dfyDriveSubfoldersTable,
  dfyDriveSyncRunsTable,
  type DfyDriveSyncRun,
} from "@workspace/db";
import { objectStorageClient } from "./objectStorage";
import {
  listDriveFolderImages,
  listDriveFolderImagesBySubfolder,
  getDriveFileStream,
  type DriveFile,
} from "./google-drive";
import { logger } from "./logger";

// Source-of-truth folder map. Keep in sync with DRIVE_FOLDERS in
// routes/dfy.ts (the route map is the access gate; this map drives the
// background sync). 250-scenes was migrated to a new mirror folder per
// task #313; 100-ai-influencers was repointed to a fresh curated folder
// per task #391 (and the old assets are purged via the one-shot below).
export const DRIVE_FOLDERS_TO_SYNC: Record<string, string> = {
  "100-ai-influencers": "1CEkA2kLGt027zdZLwZ-_Sl7ETB7rgnOh",
  "250-scenes": "1zY3ax8EGG3vdunIE9FmxGkSCLE6sQqtu",
};

// T392: slugs whose Drive folder is organised as immediate child
// subfolders (one per setting). The importer enumerates the subfolders
// and persists each image with its (subfolder_drive_id, subfolder_name)
// so the portal can render a folder grid + drill-in view. Slugs not in
// this set use the existing flat lister.
export const SUBFOLDER_MODE_SLUGS = new Set<string>(["250-scenes"]);

export function isSubfolderModeSlug(slug: string): boolean {
  return SUBFOLDER_MODE_SLUGS.has(slug);
}

// Per-slug minimum interval between AUTOMATIC periodic syncs. The manual
// admin "Refresh now" endpoint always bypasses this and syncs immediately.
// Slugs not listed here fall through to the default tick cadence
// (PERIODIC_INTERVAL_MS). Task #391: 100 AI Influencers only needs to
// sync weekly - the underlying Drive folder rarely changes and the old
// 5-minute cadence was hammering Drive for no benefit.
const PER_SLUG_MIN_INTERVAL_MS: Record<string, number> = {
  "100-ai-influencers": 7 * 24 * 60 * 60 * 1000,
};

// One-shot purge map (task #391). When a slug's folder is repointed to a
// brand-new Drive folder, soft-delete is not enough: the old portraits
// stay in dfy_drive_assets as is_active=false rows and the originals +
// thumbnails linger in object storage. The next sync against the new
// folder runs this purge once (guarded by app_settings) so stale rows
// and GCS objects are removed before the new folder is mirrored.
const ONE_SHOT_PURGE_KEYS: Record<string, string> = {
  "100-ai-influencers": "dfy_drive_purge_100ai_v1",
  "250-scenes": "dfy_drive_purge_250scenes_v1",
};

const OBJECT_KEY_PREFIX = "dfy/drive";
const LEASE_TTL_MS = 10 * 60 * 1000; // 10 min
const THUMB_MAX_WIDTH = 600;
const THUMB_QUALITY = 78;
const PER_FILE_TIMEOUT_MS = 90_000;

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

function extOfFilename(name: string, fallback = "jpg"): string {
  const m = (name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : fallback;
}

function originalKey(slug: string, driveFileId: string, ext: string): string {
  const safeExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${OBJECT_KEY_PREFIX}/${slug}/${driveFileId}/original.${safeExt}`;
}

function thumbKey(slug: string, driveFileId: string, version: number): string {
  return `${OBJECT_KEY_PREFIX}/${slug}/${driveFileId}/thumb-v${version}.webp`;
}

function absPath(privateDir: string, key: string): string {
  return `${privateDir}/${key}`;
}

async function uploadLocalFile(
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

async function streamDriveFileTo(filePath: string, driveFileId: string): Promise<number> {
  const upstream = await getDriveFileStream(driveFileId);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Drive fetch failed: HTTP ${upstream.status}`);
  }
  const nodeReadable = Readable.fromWeb(
    upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  await pipeline(nodeReadable, createWriteStream(filePath));
  const s = await stat(filePath);
  return s.size;
}

interface ThumbInfo {
  width: number | null;
  height: number | null;
}

async function generateThumbnail(
  inputPath: string,
  outputPath: string,
): Promise<ThumbInfo> {
  // Lazy import so the api-server bundle keeps boot time low and platforms
  // without sharp can still load the module for non-thumbnail code paths.
  const sharp = (await import("sharp")).default;
  const pipelineSharp = sharp(inputPath, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY });
  const info = await pipelineSharp.toFile(outputPath);
  return { width: info.width ?? null, height: info.height ?? null };
}

interface SyncResult {
  total: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  failed: number;
}

async function tryClaimLease(slug: string): Promise<DfyDriveSyncRun | null> {
  // Mark any stale running lease for this slug as failed first so we don't
  // get stuck behind a crashed worker.
  await db
    .update(dfyDriveSyncRunsTable)
    .set({
      status: "expired",
      finishedAt: new Date(),
      error: "lease expired",
    })
    .where(
      and(
        eq(dfyDriveSyncRunsTable.slug, slug),
        eq(dfyDriveSyncRunsTable.status, "running"),
        sql`${dfyDriveSyncRunsTable.leaseExpiresAt} IS NOT NULL`,
        sql`${dfyDriveSyncRunsTable.leaseExpiresAt} < now()`,
      ),
    );

  // Refuse to start if another worker still holds an active lease.
  const [active] = await db
    .select()
    .from(dfyDriveSyncRunsTable)
    .where(
      and(
        eq(dfyDriveSyncRunsTable.slug, slug),
        eq(dfyDriveSyncRunsTable.status, "running"),
      ),
    )
    .limit(1);
  if (active) return null;

  const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_MS);
  const [run] = await db
    .insert(dfyDriveSyncRunsTable)
    .values({ slug, status: "running", leaseExpiresAt })
    .returning();
  return run ?? null;
}

async function heartbeatLease(runId: number): Promise<void> {
  await db
    .update(dfyDriveSyncRunsTable)
    .set({ leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) })
    .where(eq(dfyDriveSyncRunsTable.id, runId));
}

async function finishLease(
  runId: number,
  status: "ok" | "failed",
  result: SyncResult,
  error: string | null,
): Promise<void> {
  await db
    .update(dfyDriveSyncRunsTable)
    .set({
      status,
      finishedAt: new Date(),
      total: result.total,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      skipped: result.skipped,
      failed: result.failed,
      error,
      leaseExpiresAt: null,
    })
    .where(eq(dfyDriveSyncRunsTable.id, runId));
}

async function processOneFile(
  slug: string,
  file: DriveFile,
  bucketId: string,
  privateDir: string,
  result: SyncResult,
  subfolder: { id: string; name: string } | null,
): Promise<void> {
  const driveFileId = file.id;
  const driveModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;

  const existing = await db
    .select()
    .from(dfyDriveAssetsTable)
    .where(
      and(
        eq(dfyDriveAssetsTable.slug, slug),
        eq(dfyDriveAssetsTable.driveFileId, driveFileId),
      ),
    )
    .limit(1);

  if (existing.length) {
    const cur = existing[0];
    const sameMtime =
      cur.driveModifiedTime != null &&
      driveModifiedTime != null &&
      cur.driveModifiedTime.getTime() === driveModifiedTime.getTime();
    const sameSubfolder =
      (cur.subfolderDriveId ?? null) === (subfolder?.id ?? null) &&
      (cur.subfolderName ?? null) === (subfolder?.name ?? null);
    if (
      sameMtime &&
      sameSubfolder &&
      cur.thumbObjectKey &&
      cur.originalObjectKey &&
      cur.isActive
    ) {
      // Refresh syncedAt so soft-delete sweeper knows we just saw this file.
      await db
        .update(dfyDriveAssetsTable)
        .set({ syncedAt: new Date() })
        .where(eq(dfyDriveAssetsTable.id, cur.id));
      result.skipped += 1;
      return;
    }
    // Subfolder changed (or file was soft-deleted by the migration) but
    // the bytes are unchanged: just rewire metadata, no re-upload needed.
    if (
      sameMtime &&
      cur.thumbObjectKey &&
      cur.originalObjectKey
    ) {
      await db
        .update(dfyDriveAssetsTable)
        .set({
          name: file.name,
          subfolderDriveId: subfolder?.id ?? null,
          subfolderName: subfolder?.name ?? null,
          isActive: true,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dfyDriveAssetsTable.id, cur.id));
      result.updated += 1;
      return;
    }
  }

  const tmp = await mkdtemp(join(tmpdir(), "dfy-drive-"));
  try {
    const ext = extOfFilename(file.name, "jpg");
    const localOriginal = join(tmp, `original.${ext}`);
    const localThumb = join(tmp, `thumb.webp`);

    const fileSize = await streamDriveFileTo(localOriginal, driveFileId);
    const thumbInfo = await generateThumbnail(localOriginal, localThumb);

    const origKey = originalKey(slug, driveFileId, ext);
    // Bump thumb version when the source file changed so cached CDN copies
    // (under the immutable cache header) are invalidated by URL change.
    const thumbVersion = driveModifiedTime ? driveModifiedTime.getTime() : 1;
    const tKey = thumbKey(slug, driveFileId, thumbVersion);
    const mime = file.mimeType || `image/${ext}`;

    await uploadLocalFile(bucketId, absPath(privateDir, origKey), localOriginal, mime);
    await uploadLocalFile(bucketId, absPath(privateDir, tKey), localThumb, "image/webp");

    const sortKey = (file.name || "").toLowerCase();
    const width = file.imageMediaMetadata?.width ?? thumbInfo.width ?? null;
    const height = file.imageMediaMetadata?.height ?? thumbInfo.height ?? null;

    if (existing.length) {
      const cur = existing[0];
      await db
        .update(dfyDriveAssetsTable)
        .set({
          name: file.name,
          mimeType: mime,
          width,
          height,
          fileSize,
          originalObjectKey: origKey,
          thumbObjectKey: tKey,
          driveModifiedTime,
          syncedAt: new Date(),
          isActive: true,
          sortKey,
          subfolderDriveId: subfolder?.id ?? null,
          subfolderName: subfolder?.name ?? null,
          updatedAt: new Date(),
        })
        .where(eq(dfyDriveAssetsTable.id, cur.id));
      result.updated += 1;
    } else {
      await db.insert(dfyDriveAssetsTable).values({
        slug,
        driveFileId,
        name: file.name,
        mimeType: mime,
        width,
        height,
        fileSize,
        originalObjectKey: origKey,
        thumbObjectKey: tKey,
        driveModifiedTime,
        syncedAt: new Date(),
        isActive: true,
        sortKey,
        subfolderDriveId: subfolder?.id ?? null,
        subfolderName: subfolder?.name ?? null,
      });
      result.added += 1;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function maybeRunOneShotPurge(slug: string): Promise<void> {
  const settingsKey = ONE_SHOT_PURGE_KEYS[slug];
  if (!settingsKey) return;
  const [setting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, settingsKey))
    .limit(1);
  if (setting?.value === "done") return;

  let bucketId: string;
  let privateDir: string;
  try {
    ({ bucketId, privateDir } = bucketAndPath());
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), slug, settingsKey },
      "dfy-drive purge skipped: object storage not configured",
    );
    return;
  }

  const rows = await db
    .select({
      id: dfyDriveAssetsTable.id,
      originalObjectKey: dfyDriveAssetsTable.originalObjectKey,
      thumbObjectKey: dfyDriveAssetsTable.thumbObjectKey,
    })
    .from(dfyDriveAssetsTable)
    .where(eq(dfyDriveAssetsTable.slug, slug));

  logger.info(
    { event: "dfy-drive-purge-start", slug, settingsKey, rowCount: rows.length },
    "dfy-drive one-shot purge starting",
  );

  const bucket = objectStorageClient.bucket(bucketId);
  let deletedObjects = 0;
  let failedObjects = 0;
  for (const row of rows) {
    for (const key of [row.originalObjectKey, row.thumbObjectKey]) {
      if (!key) continue;
      try {
        await bucket.file(absPath(privateDir, key)).delete({ ignoreNotFound: true });
        deletedObjects += 1;
      } catch (err) {
        failedObjects += 1;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), slug, key },
          "dfy-drive purge: failed to delete object",
        );
      }
    }
  }

  await db.delete(dfyDriveAssetsTable).where(eq(dfyDriveAssetsTable.slug, slug));

  await db
    .insert(appSettingsTable)
    .values({ key: settingsKey, value: "done" })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: "done", updatedAt: new Date() },
    });

  logger.info(
    {
      event: "dfy-drive-purge-done",
      slug,
      settingsKey,
      rowsDeleted: rows.length,
      deletedObjects,
      failedObjects,
    },
    "dfy-drive one-shot purge complete",
  );
}

export async function syncDriveFolderForSlug(slug: string): Promise<{
  ok: boolean;
  reason?: string;
  result?: SyncResult;
}> {
  const folderId = DRIVE_FOLDERS_TO_SYNC[slug];
  if (!folderId) return { ok: false, reason: "unknown slug" };

  // Task #391: one-shot purge runs (at most once per settings key) before
  // the lease is claimed so the in-flight sync sees a clean slate. Any
  // failure here is logged but does not block the sync — worst case the
  // next run retries because the settings flag was never flipped.
  try {
    await maybeRunOneShotPurge(slug);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), slug },
      "dfy-drive one-shot purge failed; continuing sync",
    );
  }

  const run = await tryClaimLease(slug);
  if (!run) return { ok: false, reason: "another sync in progress" };

  const result: SyncResult = {
    total: 0,
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
  let error: string | null = null;
  try {
    const { bucketId, privateDir } = bucketAndPath();
    // T392: subfolder-mode slugs walk the immediate child subfolders of the
    // root and tag each file with the subfolder it came from. Flat-mode
    // slugs keep the original behaviour.
    type WorkItem = { file: DriveFile; subfolder: { id: string; name: string } | null };
    const work: WorkItem[] = [];
    if (isSubfolderModeSlug(slug)) {
      const subfolderListings = await listDriveFolderImagesBySubfolder(folderId);
      const discoveredSubfolders = subfolderListings.map((sf) => ({
        id: sf.id,
        name: sf.name,
      }));
      for (const sf of subfolderListings) {
        for (const file of sf.files) {
          work.push({ file, subfolder: { id: sf.id, name: sf.name } });
        }
      }
      // T392: reconcile the persisted subfolder catalog so even empty
      // subfolders show up as folder cards on the index. Insert/refresh
      // every discovered subfolder, then mark anything not seen this run
      // inactive so removed/renamed Drive folders disappear from the UI.
      const now = new Date();
      for (const sf of discoveredSubfolders) {
        await db
          .insert(dfyDriveSubfoldersTable)
          .values({
            slug,
            driveSubfolderId: sf.id,
            name: sf.name,
            isActive: true,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: [
              dfyDriveSubfoldersTable.slug,
              dfyDriveSubfoldersTable.driveSubfolderId,
            ],
            set: {
              name: sf.name,
              isActive: true,
              lastSeenAt: now,
              updatedAt: now,
            },
          });
      }
      const seenSubfolderIds = discoveredSubfolders.map((sf) => sf.id);
      const deactivateConds = [
        eq(dfyDriveSubfoldersTable.slug, slug),
        eq(dfyDriveSubfoldersTable.isActive, true),
      ];
      if (seenSubfolderIds.length) {
        deactivateConds.push(
          sql`${dfyDriveSubfoldersTable.driveSubfolderId} NOT IN (${sql.join(
            seenSubfolderIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      }
      await db
        .update(dfyDriveSubfoldersTable)
        .set({ isActive: false, updatedAt: now })
        .where(and(...deactivateConds));
    } else {
      const files = await listDriveFolderImages(folderId, { force: true });
      for (const file of files) work.push({ file, subfolder: null });
    }
    result.total = work.length;
    logger.info(
      {
        event: "dfy-drive-sync-start",
        slug,
        runId: run.id,
        total: work.length,
        subfolderMode: isSubfolderModeSlug(slug),
      },
      "dfy drive sync start",
    );

    let sinceHeartbeat = 0;
    const seenIds = new Set<string>();
    for (const { file, subfolder } of work) {
      seenIds.add(file.id);
      try {
        await withTimeout(
          processOneFile(slug, file, bucketId, privateDir, result, subfolder),
          PER_FILE_TIMEOUT_MS,
          `processOneFile(${file.id})`,
        );
      } catch (err: unknown) {
        result.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          { event: "dfy-drive-sync-file-failed", slug, driveFileId: file.id, err: message },
          "dfy drive sync file failed",
        );
      }
      sinceHeartbeat += 1;
      if (sinceHeartbeat >= 25) {
        sinceHeartbeat = 0;
        try {
          await heartbeatLease(run.id);
        } catch {
          // best-effort
        }
      }
    }

    // Soft-delete rows that no longer appear in the live folder listing.
    const allRows = await db
      .select({ id: dfyDriveAssetsTable.id, driveFileId: dfyDriveAssetsTable.driveFileId })
      .from(dfyDriveAssetsTable)
      .where(eq(dfyDriveAssetsTable.slug, slug));
    const stale = allRows.filter((r) => !seenIds.has(r.driveFileId)).map((r) => r.id);
    if (stale.length) {
      await db
        .update(dfyDriveAssetsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(dfyDriveAssetsTable.slug, slug),
            inArray(dfyDriveAssetsTable.id, stale),
          ),
        );
      result.removed = stale.length;
    }

    await finishLease(run.id, "ok", result, null);
    logger.info(
      { event: "dfy-drive-sync-done", slug, runId: run.id, ...result },
      "dfy drive sync done",
    );
    return { ok: true, result };
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
    await finishLease(run.id, "failed", result, error).catch(() => {});
    logger.error(
      { event: "dfy-drive-sync-failed", slug, runId: run.id, err: error },
      "dfy drive sync failed",
    );
    return { ok: false, reason: error, result };
  }
}

export async function getLatestSyncRun(slug: string): Promise<DfyDriveSyncRun | null> {
  const [row] = await db
    .select()
    .from(dfyDriveSyncRunsTable)
    .where(eq(dfyDriveSyncRunsTable.slug, slug))
    .orderBy(desc(dfyDriveSyncRunsTable.startedAt))
    .limit(1);
  return row ?? null;
}

export async function getLatestSuccessfulSyncRun(
  slug: string,
): Promise<DfyDriveSyncRun | null> {
  const [row] = await db
    .select()
    .from(dfyDriveSyncRunsTable)
    .where(
      and(
        eq(dfyDriveSyncRunsTable.slug, slug),
        eq(dfyDriveSyncRunsTable.status, "ok"),
      ),
    )
    .orderBy(desc(dfyDriveSyncRunsTable.finishedAt))
    .limit(1);
  return row ?? null;
}

// ───── Periodic worker ──────────────────────────────────────────────────────

// T392: weekly cadence by default. The user reorganises the source Drive
// folders manually a few times a year, not constantly, so a 5-minute tick
// was wasted work. The admin "Refresh now" button still triggers an
// immediate full sync. Override with DFY_DRIVE_SYNC_INTERVAL_MS for tuning.
const PERIODIC_INTERVAL_MS = (() => {
  const raw = process.env["DFY_DRIVE_SYNC_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 30_000 ? n : 7 * 24 * 60 * 60 * 1000;
})();

let periodicTimer: NodeJS.Timeout | null = null;
let runningTick = false;

async function runOneTick(): Promise<void> {
  if (runningTick) return;
  runningTick = true;
  try {
    for (const slug of Object.keys(DRIVE_FOLDERS_TO_SYNC)) {
      try {
        // Task #391: per-slug minimum interval gate. Skip the automatic
        // sync if the slug last completed inside its configured window.
        // The admin "Refresh now" endpoint calls triggerImmediateSync
        // directly and bypasses this check, so manual re-syncs always
        // run on demand.
        const minMs = PER_SLUG_MIN_INTERVAL_MS[slug];
        if (minMs) {
          const last = await getLatestSuccessfulSyncRun(slug);
          const finishedAt = last?.finishedAt;
          if (finishedAt && Date.now() - finishedAt.getTime() < minMs) {
            continue;
          }
        }
        await syncDriveFolderForSlug(slug);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), slug },
          "dfy-drive periodic tick: slug failed",
        );
      }
    }
  } finally {
    runningTick = false;
  }
}

export function startDfyDriveAssetsPeriodicSync(): void {
  if (periodicTimer) return;
  // First tick is fired ~30s after boot so we don't race other boot work.
  setTimeout(() => {
    void runOneTick();
  }, 30_000).unref?.();
  periodicTimer = setInterval(() => {
    void runOneTick();
  }, PERIODIC_INTERVAL_MS);
  periodicTimer.unref?.();
  logger.info(
    { event: "dfy-drive-periodic-started", intervalMs: PERIODIC_INTERVAL_MS },
    "dfy-drive periodic sync started",
  );
}

// On-demand entry point used by the admin "Refresh now" endpoint. Returns
// once the sync completes (or immediately if another sync is in flight,
// in which case the caller can poll the latest run).
export async function triggerImmediateSync(slug: string): Promise<{
  ok: boolean;
  reason?: string;
  result?: SyncResult;
}> {
  return syncDriveFolderForSlug(slug);
}
