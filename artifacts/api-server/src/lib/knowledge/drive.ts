import { ReplitConnectors } from "@replit/connectors-sdk";
import type { FetchedDoc } from "./youtube";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  parents?: string[];
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Map of mime -> exporter. Files whose mime isn't in here (and isn't a folder)
// are skipped. This is intentionally conservative: text-extractable content
// only. PDFs and Office files would need a parser library — punt on those
// until a user actually asks for them.
const EXPORTERS: Record<string, { kind: "export"; exportMime: string } | { kind: "download" }> = {
  "application/vnd.google-apps.document":     { kind: "export", exportMime: "text/plain" },
  "application/vnd.google-apps.spreadsheet":  { kind: "export", exportMime: "text/csv" },
  "application/vnd.google-apps.presentation": { kind: "export", exportMime: "text/plain" },
  "text/plain":                                { kind: "download" },
  "text/markdown":                             { kind: "download" },
  "text/csv":                                  { kind: "download" },
};

const MAX_DEPTH = 5;

/**
 * Pull text-extractable files from a Google Drive folder, recursing into
 * sub-folders up to MAX_DEPTH. Folder ref can be a raw ID or a folder URL.
 */
export async function fetchDriveFolder(folderRef: string, maxItems: number): Promise<FetchedDoc[]> {
  const folderId = extractFolderId(folderRef);
  if (!folderId) throw new Error(`Could not parse Drive folder ID from "${folderRef}".`);

  const connectors = new ReplitConnectors();
  const limit = Math.max(1, Math.min(maxItems, 500));

  // Walk the folder tree, collecting candidate files until we hit the cap.
  const candidates: { file: DriveFile; pathName: string }[] = [];
  const seenFolders = new Set<string>();
  await walkFolder(connectors, folderId, "", 0, limit, candidates, seenFolders);

  const docs: FetchedDoc[] = [];
  for (const { file, pathName } of candidates.slice(0, limit)) {
    try {
      const text = await extractFileText(connectors, file);
      if (!text || text.length < 80) continue;
      docs.push({
        externalId: file.id,
        title: pathName ? `${pathName} / ${file.name}` : file.name,
        url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        rawText: text,
        publishedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
        metadata: { mimeType: file.mimeType, size: file.size, driveFolderPath: pathName },
      });
    } catch (err) {
      console.error(`[knowledge/drive] Failed to extract ${file.name} (${file.id}):`, err);
    }
  }
  return docs;
}

async function walkFolder(
  connectors: ReplitConnectors,
  folderId: string,
  pathName: string,
  depth: number,
  cap: number,
  out: { file: DriveFile; pathName: string }[],
  seen: Set<string>,
): Promise<void> {
  if (out.length >= cap) return;
  if (seen.has(folderId)) return;
  seen.add(folderId);
  if (depth > MAX_DEPTH) return;

  // Page through all children in this folder. Drive returns at most 1000 per
  // page (we ask for 200), so for folders with thousands of files we MUST
  // follow nextPageToken — otherwise the recursion silently drops everything
  // beyond the first page.
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,parents),nextPageToken",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive list failed (${res.status}): ${body.slice(0, 300) || res.statusText}`);
    }
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    if (data.files?.length) allFiles.push(...data.files);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  // Files first, then recurse into folders.
  for (const f of allFiles) {
    if (out.length >= cap) return;
    if (f.mimeType === FOLDER_MIME) continue;
    if (!(f.mimeType in EXPORTERS)) continue;
    out.push({ file: f, pathName });
  }
  for (const f of allFiles) {
    if (out.length >= cap) return;
    if (f.mimeType !== FOLDER_MIME) continue;
    const sub = pathName ? `${pathName} / ${f.name}` : f.name;
    await walkFolder(connectors, f.id, sub, depth + 1, cap, out, seen);
  }
}

async function extractFileText(connectors: ReplitConnectors, file: DriveFile): Promise<string> {
  const exp = EXPORTERS[file.mimeType];
  if (!exp) return "";
  if (exp.kind === "export") {
    const res = await connectors.proxy(
      "google-drive",
      `/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exp.exportMime)}`,
      { method: "GET" },
    );
    if (!res.ok) throw new Error(`Drive export failed: ${res.status}`);
    return await res.text();
  }
  // download
  const res = await connectors.proxy(
    "google-drive",
    `/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return await res.text();
}

function extractFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  const urlMatch = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const idQuery = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idQuery) return idQuery[1];
  return null;
}
