// URL classification for ad research board rows. Pure helper — no I/O — so
// the sync can stamp `url_kind` on every row at ingest time and the admin
// can see at a glance which download strategy a row will take.

export type AdResearchUrlKind =
  | "instagram-post"
  | "instagram-reel"
  | "instagram-story"
  | "facebook-post"
  | "facebook-reel"
  | "facebook-video"
  | "facebook-share-redirect"
  | "direct-image"
  | "direct-video"
  | "unknown";

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(?:\?|#|$)/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|m4v)(?:\?|#|$)/i;

function host(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function path(url: string): string {
  try { return new URL(url).pathname.toLowerCase(); } catch { return ""; }
}

export function classifyAdUrl(rawUrl: string): AdResearchUrlKind {
  if (!rawUrl) return "unknown";
  const h = host(rawUrl);
  const p = path(rawUrl);

  // Direct media files — fastest path, just download the bytes.
  if (IMAGE_EXT_RE.test(p)) return "direct-image";
  if (VIDEO_EXT_RE.test(p)) return "direct-video";

  // Instagram.
  if (h === "instagram.com" || h.endsWith(".instagram.com") || h === "instagr.am") {
    if (/\/(reel|reels)\//.test(p)) return "instagram-reel";
    if (/\/stories\//.test(p)) return "instagram-story";
    if (/\/(p|tv)\//.test(p)) return "instagram-post";
    return "instagram-post";
  }

  // Facebook.
  if (h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.com" || h.endsWith(".fb.com") || h === "fb.watch") {
    if (/^\/share\/(?:r|p|v)\//.test(p)) return "facebook-share-redirect";
    if (/\/reel\//.test(p)) return "facebook-reel";
    if (/\/videos\//.test(p) || /\/watch\/?$/.test(p)) return "facebook-video";
    return "facebook-post";
  }

  return "unknown";
}
