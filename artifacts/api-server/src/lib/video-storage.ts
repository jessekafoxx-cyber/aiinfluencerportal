/**
 * Object-storage helpers for the AI Video Studio (Task #828).
 *
 * Reuses the existing GCS bucket + the public `/api/portal/images/:fileName`
 * serving route (which streams any stored object by its contentType, so it
 * works for mp4 + thumbnails as well as images). No local uploads dir.
 */

import crypto from "crypto";
import { objectStorageClient } from "./objectStorage";

function bucketConfig(): { bucketId: string; privateDir: string } {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error("object_storage_not_configured");
  }
  return { bucketId, privateDir };
}

async function saveWithRetry(
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const { bucketId } = bucketConfig();
  const file = objectStorageClient.bucket(bucketId).file(objectPath);
  const opts = {
    contentType,
    metadata: { cacheControl: "public, max-age=31536000" },
  };
  try {
    await file.save(buffer, opts);
  } catch (err: any) {
    const status = err?.code ?? err?.response?.status;
    const errno = err?.errno ?? err?.cause?.code;
    const transient =
      (typeof status === "number" && status >= 500) ||
      errno === "ECONNRESET" ||
      errno === "ECONNREFUSED" ||
      errno === "ETIMEDOUT" ||
      errno === "EAI_AGAIN";
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 750 + Math.floor(Math.random() * 500)));
    await file.save(buffer, opts);
  }
}

/** Persist a buffer to GCS and return its public `/api/portal/images/...` path. */
export async function uploadVideoBuffer(
  buffer: Buffer,
  contentType: string,
  ext: string,
  prefix = "video.",
): Promise<string> {
  const { privateDir } = bucketConfig();
  const fileName = `${prefix}${crypto.randomUUID()}.${ext}`;
  await saveWithRetry(`${privateDir}/${fileName}`, buffer, contentType);
  return `/api/portal/images/${fileName}`;
}

/**
 * Download a remote URL (HeyGen / Remotion output) and store it in GCS.
 * Returns the public path. `fallbackExt`/`fallbackContentType` are used when
 * the response omits a usable content-type.
 */
export async function downloadRemoteToStorage(
  remoteUrl: string,
  opts: {
    prefix?: string;
    fallbackExt: string;
    fallbackContentType: string;
  },
): Promise<string> {
  const resp = await fetch(remoteUrl, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) {
    throw new Error(`remote_download_failed:${resp.status}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const contentType = resp.headers.get("content-type") || opts.fallbackContentType;
  let ext = opts.fallbackExt;
  if (contentType.includes("mp4")) ext = "mp4";
  else if (contentType.includes("webm")) ext = "webm";
  else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
  else if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("gif")) ext = "gif";
  return uploadVideoBuffer(buffer, contentType, ext, opts.prefix);
}

/**
 * Resolve a portal image URL to its raw bytes. Handles the internal
 * `/api/portal/images/<file>` convention by reading the GCS object directly,
 * and falls back to an HTTP fetch for any external URL.
 */
export async function downloadSourceImageBytes(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const m = url.match(/\/api\/portal\/images\/([^/?#]+)$/);
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (m && bucketId && privateDir) {
    const fileName = m[1];
    const file = objectStorageClient.bucket(bucketId).file(`${privateDir}/${fileName}`);
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      buffer: buf,
      contentType: (meta.contentType as string) || "image/png",
    };
  }
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`source_image_fetch_failed:${resp.status}`);
  const ab = await resp.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    contentType: resp.headers.get("content-type") || "image/png",
  };
}

/** Stable content hash for caching HeyGen talking-photo uploads. */
export function hashImageBytes(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Best-effort delete of a stored object given its public path. */
export async function deleteStoredObject(publicPath: string): Promise<void> {
  const m = publicPath.match(/\/api\/portal\/images\/([^/?#]+)$/);
  if (!m) return;
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) return;
  const file = objectStorageClient.bucket(bucketId).file(`${privateDir}/${m[1]}`);
  await file.delete({ ignoreNotFound: true });
}
