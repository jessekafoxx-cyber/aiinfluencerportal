import { randomUUID } from "crypto";
import { db, funnelsResearchBoardItems } from "@workspace/db";
import { eq, sql, or, isNull, and, lt, inArray, isNotNull } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";

const MAX_BYTES = 25 * 1024 * 1024;
const PER_FETCH_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const FETCH_CONCURRENCY = 8;
const RETRY_BACKOFF_MINUTES = 15;

function parseGcsPath(fullPath: string): { bucket: string; object: string } {
  const norm = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = norm.slice(1).split("/");
  return { bucket: parts[0], object: parts.slice(1).join("/") };
}

async function uploadToObjectStorage(
  buf: Buffer,
  ext: string,
  contentType: string,
): Promise<string> {
  const objectId = randomUUID();
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const fullPath = `${privateDir.replace(/\/$/, "")}/research-media/${objectId}.${ext}`;
  const { bucket, object } = parseGcsPath(fullPath);
  await objectStorageClient
    .bucket(bucket)
    .file(object)
    .save(buf, { contentType, metadata: { contentType }, resumable: false });
  return `/objects/research-media/${objectId}.${ext}`;
}

function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  // Common forms:
  //  https://drive.google.com/file/d/<ID>/view?usp=...
  //  https://drive.google.com/open?id=<ID>
  //  https://drive.google.com/uc?id=<ID>
  //  https://drive.google.com/thumbnail?id=<ID>
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && /^[a-zA-Z0-9_-]{10,}$/.test(id)) return id;
  } catch {}
  return null;
}

export function driveFileIdFromAny(url: string | null | undefined): string | null {
  if (!url) return null;
  return extractDriveFileId(url);
}

export function driveThumbnailUrl(fileId: string, sizePx = 1200): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${sizePx}`;
}

export function drivePdfDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

interface FetchedImage {
  buf: Buffer;
  ext: string;
  contentType: string;
}

async function fetchPreviewImage(fileId: string): Promise<FetchedImage | null> {
  const candidates = [
    driveThumbnailUrl(fileId, 1600),
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`,
  ];
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PER_FETCH_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
            Accept: "image/*,*/*;q=0.8",
          },
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) continue;
      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/")) continue;
      const ab = await resp.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > MAX_BYTES) continue;
      let ext = "jpg";
      let contentType = "image/jpeg";
      if (ct.includes("png")) { ext = "png"; contentType = "image/png"; }
      else if (ct.includes("webp")) { ext = "webp"; contentType = "image/webp"; }
      else if (ct.includes("gif")) { ext = "gif"; contentType = "image/gif"; }
      else if (ct.includes("jpeg") || ct.includes("jpg")) { ext = "jpg"; contentType = "image/jpeg"; }
      return { buf: Buffer.from(ab), ext, contentType };
    } catch {
      continue;
    }
  }
  return null;
}

interface PendingPreviewRow {
  id: number;
  rowKey: string;
  previewSourceUrl: string;
  attempts: number;
}

async function processPreviewRow(row: PendingPreviewRow): Promise<void> {
  const fileId = extractDriveFileId(row.previewSourceUrl);
  if (!fileId) {
    await db
      .update(funnelsResearchBoardItems)
      .set({
        previewStatus: "failed",
        previewError: "could not extract drive file id",
        previewAttempts: row.attempts + 1,
        previewDownloadedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(funnelsResearchBoardItems.id, row.id));
    return;
  }
  try {
    await db
      .update(funnelsResearchBoardItems)
      .set({ previewStatus: "pending", previewError: null })
      .where(eq(funnelsResearchBoardItems.id, row.id));
    const fetched = await fetchPreviewImage(fileId);
    if (!fetched) {
      await db
        .update(funnelsResearchBoardItems)
        .set({
          previewStatus: "failed",
          previewError: "drive thumbnail fetch failed",
          previewAttempts: row.attempts + 1,
          previewDownloadedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(funnelsResearchBoardItems.id, row.id));
      logger.warn({ rowKey: row.rowKey, fileId }, "funnels-preview: fetch failed");
      return;
    }
    const objectPath = await uploadToObjectStorage(
      fetched.buf,
      fetched.ext,
      fetched.contentType,
    );
    await db
      .update(funnelsResearchBoardItems)
      .set({
        previewStatus: "ok",
        previewObjectPath: objectPath,
        previewContentType: fetched.contentType,
        previewError: null,
        previewAttempts: row.attempts + 1,
        previewDownloadedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(funnelsResearchBoardItems.id, row.id));
    logger.info(
      { rowKey: row.rowKey, bytes: fetched.buf.length },
      "funnels-preview: ok",
    );
  } catch (err: any) {
    await db
      .update(funnelsResearchBoardItems)
      .set({
        previewStatus: "failed",
        previewError: (err?.message || String(err)).slice(0, 300),
        previewAttempts: row.attempts + 1,
        previewDownloadedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(funnelsResearchBoardItems.id, row.id));
    logger.error({ err, rowKey: row.rowKey }, "funnels-preview: row crashed");
  }
}

let inFlightProcessor: Promise<void> | null = null;

export function processPendingFunnelsPreviewsInBackground(): void {
  if (inFlightProcessor) {
    logger.info("funnels-preview: processor already running");
    return;
  }
  inFlightProcessor = processPendingFunnelsPreviews()
    .catch((err) => logger.error({ err }, "funnels-preview: processor crashed"))
    .finally(() => { inFlightProcessor = null; });
}

async function processPendingFunnelsPreviews(): Promise<void> {
  const cutoff = new Date(Date.now() - RETRY_BACKOFF_MINUTES * 60 * 1000);
  const pending = await db
    .select({
      id: funnelsResearchBoardItems.id,
      rowKey: funnelsResearchBoardItems.rowKey,
      previewSourceUrl: funnelsResearchBoardItems.previewSourceUrl,
      attempts: funnelsResearchBoardItems.previewAttempts,
    })
    .from(funnelsResearchBoardItems)
    .where(
      and(
        isNotNull(funnelsResearchBoardItems.previewSourceUrl),
        or(
          isNull(funnelsResearchBoardItems.previewStatus),
          eq(funnelsResearchBoardItems.previewStatus, "pending"),
          and(
            eq(funnelsResearchBoardItems.previewStatus, "failed"),
            lt(funnelsResearchBoardItems.previewAttempts, MAX_ATTEMPTS),
            or(
              isNull(funnelsResearchBoardItems.previewDownloadedAt),
              lt(funnelsResearchBoardItems.previewDownloadedAt, cutoff),
            ),
          ),
        ),
      ),
    );

  if (pending.length === 0) {
    logger.info("funnels-preview: nothing to process");
    return;
  }
  logger.info({ count: pending.length }, "funnels-preview: processing queue");

  // Mark pending up-front in one query to avoid races.
  await db
    .update(funnelsResearchBoardItems)
    .set({ previewStatus: "pending", previewError: null })
    .where(inArray(funnelsResearchBoardItems.id, pending.map((p) => p.id)));

  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= pending.length) return;
      const row = pending[idx];
      if (!row.previewSourceUrl) continue;
      await processPreviewRow({
        id: row.id,
        rowKey: row.rowKey,
        previewSourceUrl: row.previewSourceUrl,
        attempts: row.attempts,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, pending.length) }, () => worker()),
  );
  logger.info("funnels-preview: queue drained");
}

export async function refetchFunnelsPreviewForRow(itemId: number): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({
      id: funnelsResearchBoardItems.id,
      rowKey: funnelsResearchBoardItems.rowKey,
      previewSourceUrl: funnelsResearchBoardItems.previewSourceUrl,
      attempts: funnelsResearchBoardItems.previewAttempts,
    })
    .from(funnelsResearchBoardItems)
    .where(eq(funnelsResearchBoardItems.id, itemId));
  if (!row) return { ok: false, error: "row not found" };
  if (!row.previewSourceUrl) return { ok: false, error: "no preview source url for row" };
  await processPreviewRow({
    id: row.id,
    rowKey: row.rowKey,
    previewSourceUrl: row.previewSourceUrl,
    attempts: row.attempts,
  });
  const [after] = await db
    .select({ status: funnelsResearchBoardItems.previewStatus, error: funnelsResearchBoardItems.previewError })
    .from(funnelsResearchBoardItems)
    .where(eq(funnelsResearchBoardItems.id, itemId));
  return { ok: after?.status === "ok", error: after?.error || undefined };
}
