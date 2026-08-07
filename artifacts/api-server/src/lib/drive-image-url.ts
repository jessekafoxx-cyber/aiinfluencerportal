// Task #742: normalise Google Drive share URLs into directly-loadable
// image URLs.
//
// Greg pastes Drive share URLs into the "Preview image URL" field on
// the DFY Bridge Pages admin form (and into the screenshot column of
// the curated Google Sheet). Drive's `/file/d/<id>/view` endpoint
// returns an HTML viewer page, not the image bytes, so an `<img src>`
// pointing at it renders as a broken-image icon. We rewrite any Drive
// URL into a hot-linkable image URL on the `lh3.googleusercontent.com`
// CDN so the existing `<img>` tag just works.
//
// Supported input shapes:
//   * https://drive.google.com/file/d/<FILE_ID>/view?usp=sharing
//   * https://drive.google.com/file/d/<FILE_ID>/preview
//   * https://drive.google.com/open?id=<FILE_ID>
//   * https://drive.google.com/uc?id=<FILE_ID>
//   * https://drive.google.com/uc?export=view&id=<FILE_ID>
//   * https://drive.google.com/thumbnail?id=<FILE_ID>&sz=...
//
// Anything that is not a Drive URL, or any Drive URL we cannot parse a
// file id out of, is returned unchanged.

const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "www.drive.google.com",
  "docs.google.com",
]);

const FILE_ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

export function extractDriveFileId(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;
  // /file/d/<id>/...
  const m = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m && FILE_ID_RE.test(m[1])) return m[1];
  // ?id=<id> (also covers /open?id=, /uc?id=, /thumbnail?id=)
  const idParam = url.searchParams.get("id");
  if (idParam && FILE_ID_RE.test(idParam)) return idParam;
  return null;
}

export function normalizeDriveImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return raw ?? null;
  const s = String(raw);
  const id = extractDriveFileId(s);
  if (!id) return s;
  return `https://lh3.googleusercontent.com/d/${id}=s2048`;
}

// Task #742 follow-up: legacy bridge-page rows store the GHL preview /
// download URLs without an `https://` prefix (e.g. `app.gohighlevel.com/...`).
// When an `<a href>` lacks a scheme the browser treats it as a relative
// path and lands on the portal's own 404. Prepend `https://` when the
// value looks like a bare host+path. Anything that already has a scheme,
// or that doesn't look like a URL at all, is returned unchanged.
export function ensureAbsoluteUrl(raw: string | null | undefined): string | null {
  if (raw == null) return raw ?? null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$|\?|#)/i.test(s)) return `https://${s}`;
  return s;
}

export function isGoogleDriveUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(String(raw).trim());
    return DRIVE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
