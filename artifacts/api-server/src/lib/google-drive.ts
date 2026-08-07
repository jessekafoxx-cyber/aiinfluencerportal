import { ReplitConnectors } from "@replit/connectors-sdk";

// Singleton connectors client for the Replit-managed Google Drive
// connection (see integrations skill). Tokens are refreshed automatically.
const connectors = new ReplitConnectors();

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  thumbnailLink: string | null;
  imageMediaMetadata?: { width?: number; height?: number } | null;
  modifiedTime?: string | null;
};

type CacheEntry = { at: number; files: DriveFile[] };
const FOLDER_CACHE = new Map<string, CacheEntry>();
const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearDriveFolderCache(folderId?: string) {
  if (folderId) FOLDER_CACHE.delete(folderId);
  else FOLDER_CACHE.clear();
}

async function callDrive(path: string): Promise<Response> {
  const res = await connectors.proxy("google-drive", path, { method: "GET" });
  return res as unknown as Response;
}

// List image files in a Drive folder. Cached for FOLDER_CACHE_TTL_MS so
// repeat hits are fast; pass `force` to bypass.
export async function listDriveFolderImages(
  folderId: string,
  opts: { force?: boolean } = {},
): Promise<DriveFile[]> {
  const now = Date.now();
  if (!opts.force) {
    const hit = FOLDER_CACHE.get(folderId);
    if (hit && now - hit.at < FOLDER_CACHE_TTL_MS) return hit.files;
  }

  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  // Hard cap so a malformed folder can't loop forever.
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, thumbnailLink, modifiedTime, imageMediaMetadata(width,height))",
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await callDrive(`/drive/v3/files?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };
    if (data.files?.length) files.push(...data.files);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  FOLDER_CACHE.set(folderId, { at: now, files });
  return files;
}

// T392: list every image under a Drive folder, recursing into nested
// subfolders. Returns a flat array. Mirrors listDriveFolderAudioRecursive
// but filters by `image/` mime type, and includes `modifiedTime` so the
// importer's (slug, drive_file_id, modified_time) idempotency check works.
async function listDriveFolderImagesRecursive(
  rootFolderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder')`,
        fields:
          "nextPageToken, files(id, name, mimeType, size, thumbnailLink, modifiedTime, imageMediaMetadata(width,height))",
        pageSize: "1000",
        orderBy: "name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await callDrive(`/drive/v3/files?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      for (const f of data.files || []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          queue.push(f.id);
        } else {
          out.push(f);
        }
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  }
  return out;
}

// Stream a Drive file's bytes back to the caller. Returns the upstream
// fetch Response (caller is responsible for piping body + setting headers).
export async function getDriveFileStream(fileId: string): Promise<Response> {
  const res = await callDrive(
    `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  return res;
}

// T262: list video files in a Drive folder. Same shape and pagination
// caps as listDriveFolderImages; mimeType filter targets video/* so
// non-video files in the folder are ignored.
export async function listDriveFolderVideos(
  folderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, thumbnailLink, modifiedTime)",
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await callDrive(`/drive/v3/files?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };
    if (data.files?.length) out.push(...data.files);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

// T257: list every audio file under a Drive folder, recursing into
// subfolders. Returns a flat array of files. No internal cache (the
// background-music importer manages its own cadence).
export async function listDriveFolderAudioRecursive(
  rootFolderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'audio/' or mimeType = 'application/vnd.google-apps.folder')`,
        fields:
          "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
        pageSize: "1000",
        orderBy: "name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await callDrive(`/drive/v3/files?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      for (const f of data.files || []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          queue.push(f.id);
        } else {
          out.push(f);
        }
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  }
  return out;
}

// T317: list every video file under a Drive folder, recursing into
// subfolders. Returns a flat array. Mirrors listDriveFolderAudioRecursive
// but filters by `video/` mime type.
export async function listDriveFolderVideosRecursive(
  rootFolderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const queue: string[] = [rootFolderId];
  const visited = new Set<string>();
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    let pageToken: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')`,
        fields:
          "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
        pageSize: "1000",
        orderBy: "name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await callDrive(`/drive/v3/files?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      for (const f of data.files || []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          queue.push(f.id);
        } else {
          out.push(f);
        }
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  }
  return out;
}

export type DriveSubfolderListing = {
  id: string;
  name: string;
  files: DriveFile[];
};

// T392: list immediate child subfolders of a Drive folder, and for each
// one list every image inside it. Used by subfolder-mode DFY slugs (e.g.
// 250-scenes) so the portal can render a folder grid + drill-in view
// that mirrors the Drive structure. New subfolders/images appear here
// automatically on the next sync; renamed/removed ones disappear.
export async function listDriveFolderImagesBySubfolder(
  rootFolderId: string,
): Promise<DriveSubfolderListing[]> {
  // 1. Enumerate the root's immediate subfolders.
  const subfolders: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      q: `'${rootFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken, files(id, name)",
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await callDrive(`/drive/v3/files?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive subfolder list failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      files?: { id: string; name: string }[];
      nextPageToken?: string;
    };
    for (const f of data.files || []) subfolders.push({ id: f.id, name: f.name });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  // 2. For each subfolder, recursively list every image inside it
  // (including images in nested folders). Each top-level setting folder
  // is the unit the portal renders, so nested images are still
  // attributed to their parent setting folder's id/name.
  const out: DriveSubfolderListing[] = [];
  for (const sub of subfolders) {
    const files = await listDriveFolderImagesRecursive(sub.id);
    out.push({ id: sub.id, name: sub.name, files });
  }
  return out;
}

// Fetch metadata for a single file (used so the proxy can set the correct
// filename + content-type on download responses).
export async function getDriveFileMeta(fileId: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    fields: "id, name, mimeType, size",
    supportsAllDrives: "true",
  });
  const res = await callDrive(
    `/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as DriveFile;
}
