// Pure, side-effect-free helpers for the ad-research-board media downloader.
// Lives in its own file so unit tests (and future callers) can import them
// without dragging the database / object-storage / Apify clients into scope.

export interface MediaUrls {
  videoUrl?: string | null;
  imageUrl?: string | null;
  // Task #186: Apify-provided poster URL for video slides (e.g. IG
  // displayUrl alongside videoUrl, FB thumbnailUrl/previewImage). When
  // present the downloader uploads it as the cached `extraction`
  // thumbnail. Independent of imageUrl because for video posts
  // imageUrl may be unset entirely.
  thumbnailUrl?: string | null;
  // Task #192: alternate CDN candidates for resilient slide recovery.
  // Apify items often expose multiple equivalent URLs for the same
  // media (e.g. IG `displayUrl` + `images[]` + `displayResources[]`,
  // FB `videoUrl` + `video.url` + `videos[]`, plus `*Backup` mirrors).
  // The carousel downloader walks these in order when the primary
  // URL fails, so a single transient CDN 403 / 5xx no longer kills a
  // whole slide. Always populated by the pickers (may be empty); the
  // primary URL itself is NOT included to avoid wasted retries.
  videoCandidates?: string[];
  imageCandidates?: string[];
}

// Diagnostics about a resolved post. expectedSlides is what the source
// platform claims the post contains (e.g. 10 for a sidecar with 10 child
// posts). isCarousel lets the persistence layer know that downgrading to a
// single-item fallback would silently lose slides.
export interface CarouselInfo {
  isCarousel: boolean;
  expectedSlides: number;
  typename?: string | null;
}

export function pickInstagramMedia(item: any): MediaUrls {
  if (!item || typeof item !== "object") return {};
  const videoUrl: string | null =
    (typeof item.videoUrl === "string" && item.videoUrl) ||
    (typeof item.videoUrlBackup === "string" && item.videoUrlBackup) ||
    null;
  let imageUrl: string | null = null;
  if (typeof item.displayUrl === "string" && item.displayUrl) imageUrl = item.displayUrl;
  else if (Array.isArray(item.images) && typeof item.images[0] === "string") imageUrl = item.images[0];
  else if (Array.isArray(item.images) && item.images[0]?.url) imageUrl = item.images[0].url;
  // Task #186: capture an explicit poster URL for video posts so the
  // cached thumbnail pipeline can render <img> over the cached video.
  let thumbnailUrl: string | null = null;
  if (videoUrl) {
    if (typeof item.displayUrl === "string" && item.displayUrl) thumbnailUrl = item.displayUrl;
    else if (typeof item.thumbnailUrl === "string" && item.thumbnailUrl) thumbnailUrl = item.thumbnailUrl;
    else if (typeof item.thumbnail === "string" && item.thumbnail) thumbnailUrl = item.thumbnail;
    else if (Array.isArray(item.images) && typeof item.images[0] === "string") thumbnailUrl = item.images[0];
    else if (Array.isArray(item.images) && item.images[0]?.url) thumbnailUrl = item.images[0].url;
  }
  if (!videoUrl && !imageUrl && Array.isArray(item.childPosts) && item.childPosts.length) {
    return pickInstagramMedia(item.childPosts[0]);
  }
  // Task #192: alternate CDN candidates. IG actor outputs equivalent
  // mirrors at: videoUrlBackup, displayResources[].src (multi-resolution
  // image set), images[] entries beyond images[0], and the displayUrl
  // (when not already chosen as primary). Walked in order on per-slide
  // retry; primary URL is excluded to avoid wasted bandwidth on the
  // exact URL that just failed.
  const videoCandidates = dedupeAndFilter(
    [
      typeof item.videoUrlBackup === "string" ? item.videoUrlBackup : null,
      typeof item.video_url === "string" ? item.video_url : null,
    ],
    videoUrl,
  );
  const imageCandidates = dedupeAndFilter(
    [
      typeof item.displayUrl === "string" ? item.displayUrl : null,
      ...collectImageStringsFromIgImages(item.images),
      ...collectDisplayResources(item.displayResources),
      typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
      typeof item.thumbnail === "string" ? item.thumbnail : null,
    ],
    imageUrl,
  );
  return { videoUrl, imageUrl, thumbnailUrl, videoCandidates, imageCandidates };
}

// Task #192: tiny helpers that keep pickers terse. Pure - exported only
// for the sibling pickers to reuse; not part of the module's public
// surface (no re-export from media-downloader.ts).
function dedupeAndFilter(arr: (string | null | undefined)[], primary: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (primary) seen.add(primary);
  for (const u of arr) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function collectImageStringsFromIgImages(images: any): (string | null)[] {
  if (!Array.isArray(images)) return [];
  const out: (string | null)[] = [];
  for (const img of images) {
    if (typeof img === "string") out.push(img);
    else if (img && typeof img.url === "string") out.push(img.url);
  }
  return out;
}

function collectDisplayResources(resources: any): (string | null)[] {
  if (!Array.isArray(resources)) return [];
  const out: (string | null)[] = [];
  for (const r of resources) {
    if (r && typeof r.src === "string") out.push(r.src);
    else if (r && typeof r.url === "string") out.push(r.url);
  }
  return out;
}

// For Instagram carousels (Sidecar) the parent item has a non-empty
// childPosts[] where each child is its own image / video. Treat
// single-image / single-video posts as a one-element list so callers can
// always iterate uniformly.
export function pickInstagramMediaList(item: any): MediaUrls[] {
  if (!item || typeof item !== "object") return [];
  if (Array.isArray(item.childPosts) && item.childPosts.length) {
    const list: MediaUrls[] = [];
    for (const child of item.childPosts) {
      const m = pickInstagramMedia(child);
      if (m.videoUrl || m.imageUrl) list.push(m);
    }
    if (list.length) return list;
  }
  const single = pickInstagramMedia(item);
  return single.videoUrl || single.imageUrl ? [single] : [];
}

// "Is this a carousel post?" detector. The Apify instagram-scraper marks
// carousels with __typename "GraphSidecar" / "XDTGraphSidecar" or a `type`
// of "Sidecar". Either signal alone is enough — we don't require non-empty
// childPosts because the actor occasionally returns a Sidecar typename with
// childPosts not yet populated, and we still want to flag the row as a
// carousel so the downloader retries with stronger settings instead of
// silently caching the cover image as a "single".
export function detectInstagramCarousel(item: any): CarouselInfo {
  if (!item || typeof item !== "object") {
    return { isCarousel: false, expectedSlides: 0, typename: null };
  }
  const typename: string | null =
    (typeof item.__typename === "string" && item.__typename) ||
    (typeof item.typename === "string" && item.typename) ||
    null;
  const tnLower = (typename || "").toLowerCase();
  const itemType =
    (typeof item.type === "string" && item.type.toLowerCase()) ||
    (typeof item.productType === "string" && item.productType.toLowerCase()) ||
    "";
  const childCount = Array.isArray(item.childPosts) ? item.childPosts.length : 0;
  const isSidecar =
    tnLower.includes("sidecar") ||
    itemType === "sidecar" ||
    childCount > 1;
  if (isSidecar) {
    return {
      isCarousel: true,
      expectedSlides: Math.max(childCount, 2),
      typename,
    };
  }
  return { isCarousel: false, expectedSlides: 1, typename };
}

export function pickFacebookMedia(item: any): MediaUrls {
  if (!item || typeof item !== "object") return {};
  const videoUrl: string | null =
    (typeof item.videoUrl === "string" && item.videoUrl) ||
    (typeof item.video?.url === "string" && item.video.url) ||
    (Array.isArray(item.videos) && typeof item.videos[0] === "string" && item.videos[0]) ||
    (Array.isArray(item.videos) && item.videos[0]?.url) ||
    null;
  const imageUrl: string | null =
    (typeof item.thumbnailUrl === "string" && item.thumbnailUrl) ||
    (typeof item.imageUrl === "string" && item.imageUrl) ||
    (Array.isArray(item.images) && typeof item.images[0] === "string" && item.images[0]) ||
    (Array.isArray(item.images) && item.images[0]?.url) ||
    (Array.isArray(item.media) && item.media[0]?.image?.uri) ||
    null;
  // Task #186: Apify FB scrapers expose poster/preview URLs alongside
  // the playable video. Capture them so the cached thumbnail pipeline
  // can render <img> for video cards on the Ads tab.
  let thumbnailUrl: string | null = null;
  if (videoUrl) {
    if (typeof item.thumbnailUrl === "string" && item.thumbnailUrl) thumbnailUrl = item.thumbnailUrl;
    else if (typeof item.thumbnail === "string" && item.thumbnail) thumbnailUrl = item.thumbnail;
    else if (typeof item.previewImage === "string" && item.previewImage) thumbnailUrl = item.previewImage;
    else if (typeof item.previewImageUrl === "string" && item.previewImageUrl) thumbnailUrl = item.previewImageUrl;
    else if (typeof item.imageUrl === "string" && item.imageUrl) thumbnailUrl = item.imageUrl;
    else if (Array.isArray(item.images) && typeof item.images[0] === "string") thumbnailUrl = item.images[0];
    else if (Array.isArray(item.images) && item.images[0]?.url) thumbnailUrl = item.images[0].url;
    else if (Array.isArray(item.media) && item.media[0]?.image?.uri) thumbnailUrl = item.media[0].image.uri;
  }
  // Task #192: alternate CDN candidates. FB actor outputs equivalent
  // mirrors at: video.url, videos[].url, plus extra entries in
  // images[] / media[].image.uri beyond the one chosen as primary.
  const videoCandidates = dedupeAndFilter(
    [
      typeof item.video?.url === "string" ? item.video.url : null,
      ...collectFbVideoStrings(item.videos),
    ],
    videoUrl,
  );
  const imageCandidates = dedupeAndFilter(
    [
      typeof item.imageUrl === "string" ? item.imageUrl : null,
      typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
      typeof item.previewImage === "string" ? item.previewImage : null,
      typeof item.previewImageUrl === "string" ? item.previewImageUrl : null,
      ...collectImageStringsFromIgImages(item.images),
      ...collectFbMediaImageUris(item.media),
    ],
    imageUrl,
  );
  return { videoUrl, imageUrl, thumbnailUrl, videoCandidates, imageCandidates };
}

function collectFbVideoStrings(videos: any): (string | null)[] {
  if (!Array.isArray(videos)) return [];
  const out: (string | null)[] = [];
  for (const v of videos) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v.url === "string") out.push(v.url);
  }
  return out;
}

function collectFbMediaImageUris(media: any): (string | null)[] {
  if (!Array.isArray(media)) return [];
  const out: (string | null)[] = [];
  for (const m of media) {
    if (m?.image?.uri && typeof m.image.uri === "string") out.push(m.image.uri);
  }
  return out;
}

// Facebook carousel posts can come back as `attachments[]`, `subattachments[]`
// or just an `images[]`. Extract every distinct slide we can find.
export function pickFacebookMediaList(item: any): MediaUrls[] {
  if (!item || typeof item !== "object") return [];
  const list: MediaUrls[] = [];
  const seen = new Set<string>();
  const push = (m: MediaUrls) => {
    const key = (m.videoUrl || m.imageUrl || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(m);
  };
  const candidates: any[] = [];
  if (Array.isArray(item.attachments)) candidates.push(...item.attachments);
  if (Array.isArray(item.subattachments)) candidates.push(...item.subattachments);
  if (Array.isArray(item.media)) candidates.push(...item.media);
  for (const c of candidates) {
    const inner = c?.media || c;
    const m = pickFacebookMedia(inner);
    push(m);
  }
  if (Array.isArray(item.images)) {
    for (const img of item.images) {
      if (typeof img === "string") push({ videoUrl: null, imageUrl: img });
      else if (img && typeof img.url === "string") push({ videoUrl: null, imageUrl: img.url });
    }
  }
  if (list.length) return list;
  const single = pickFacebookMedia(item);
  return single.videoUrl || single.imageUrl ? [single] : [];
}

// "Is this a Facebook carousel?" Detector mirrors the IG one but uses the
// distinct-attachment count from `pickFacebookMediaList` since FB doesn't
// expose a clean __typename signal. If we see >1 distinct media, treat the
// row as a carousel so partial results don't silently downgrade.
export function detectFacebookCarousel(item: any): CarouselInfo {
  if (!item || typeof item !== "object") {
    return { isCarousel: false, expectedSlides: 0, typename: null };
  }
  const slides = pickFacebookMediaList(item);
  const attachmentsCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
  const subattachmentsCount = Array.isArray(item.subattachments) ? item.subattachments.length : 0;
  const reportedCount = Math.max(attachmentsCount, subattachmentsCount, slides.length);
  const isCarousel = reportedCount > 1;
  return {
    isCarousel,
    expectedSlides: isCarousel ? reportedCount : slides.length || 1,
    typename: isCarousel ? "facebook-attachments" : null,
  };
}

// Task #151: real-outcome error taxonomy. Lives here (not in
// media-downloader.ts) so unit tests can import it without dragging
// the DB / object-storage / Apify clients into scope.
//
// Order matters: most-specific patterns match first. The previous
// classifier collapsed the dominant Instagram login-wall message into
// "other" - we now separate auth blocks, rate limits, quota
// exhaustion, dead media, and provider failures so the dashboard can
// surface real operational health instead of just queue mechanics.
// Task #193: pure detector for yt-dlp partial-resume corruption
// signatures. Used by the download wrapper to decide whether a one-
// shot retry (with workdir pre-clean and no resume / no Range
// chunking) is worth attempting before giving up. Includes:
//   - HTTP 416 Range Not Satisfiable
//   - "unable to resume" / "cannot resume"
//   - "byte range" / "Range header" mismatches
//   - "ContentTooShort" / "premature end" / "got fewer bytes"
//   - .part / partial file corruption strings
// Pure; no I/O. Safe to import everywhere helpers ship.
export function isPartialResumeError(message: string | null | undefined): boolean {
  if (!message) return false;
  const s = String(message).toLowerCase();
  return (
    s.includes("http error 416") ||
    s.includes("http 416") ||
    s.includes("416 requested range") ||
    s.includes("requested range not satisfiable") ||
    s.includes("unable to resume") ||
    s.includes("cannot resume") ||
    s.includes("contenttooshort") ||
    s.includes("got fewer bytes") ||
    s.includes("premature end") ||
    s.includes("the downloaded file is empty") ||
    (s.includes("byte range") && s.includes("invalid")) ||
    (s.includes(".part") && (s.includes("corrupt") || s.includes("invalid")))
  );
}

// Task #196: classes the queue treats as "transient — try again later".
// Used by the periodic processor's delayed-retry branch to give these
// rows a longer cooldown than the default RETRY_BACKOFF_MINUTES before
// re-claiming, since immediate retries on these classes burn an
// attempt for the same upstream condition that needs minutes to clear.
export const TRANSIENT_RETRY_CLASSES = new Set<string>([
  "extractor-stale",
  "anti-bot",
  "ig-rate-limited",
]);

// Task #196: classes that should trigger the secondary Apify escalation
// pipeline even though they aren't auth-wall failures. yt-dlp can return
// "no video formats found" / "unable to extract data" on IG reels and
// FB videos when its extractor has drifted from the platform - the
// residential-proxy Apify actors carry an authenticated session and
// often recover those rows. Kept separate from the auth-wall set so the
// dashboard can attribute escalations to the right cause.
export const EXTRACTOR_STALE_CLASSES_FOR_ESCALATION = new Set<string>([
  "extractor-stale",
]);

// Task #196: structurally non-extractable URLs that should never reach
// yt-dlp / Apify. Returns { unsupported: true, reason } for:
//   - non-http(s) schemes
//   - localhost / private-IP / loopback hosts (internal links)
//   - reel.farm and other internal dashboards / aggregators
//   - malformed URLs that cannot be parsed
//   - bare hostnames with no path (".com" with nothing after - dashboard
//     home pages, not media pages)
// Pure detector; no I/O. The caller marks the row failed with class
// `unsupported-url` and dismisses immediately so the queue does not
// burn extractor attempts on a deterministic dead-end.
export interface UnsupportedUrlVerdict {
  unsupported: boolean;
  reason?:
    | "invalid-url"
    | "non-http-scheme"
    | "internal-host"
    | "internal-aggregator"
    | "no-path"
    | "non-media-host"
    | "internal-path"
    | "fb-photo-php"
    | "ig-profile-only";
}
const INTERNAL_AGGREGATOR_HOSTS = new Set<string>([
  "reel.farm",
  "www.reel.farm",
]);
const INTERNAL_HOST_SUFFIXES = [
  ".dashboard",
  ".local",
  ".internal",
  ".lan",
  ".localhost",
];
const INTERNAL_HOST_PREFIXES = [
  "dashboard.",
  "admin.",
  "internal.",
  "localhost.",
];
const PRIVATE_IP_RE = /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.|::1$|fe80:|fc00:|fd)/i;
export function isUnsupportedExtractionUrl(rawUrl: string | null | undefined): UnsupportedUrlVerdict {
  if (!rawUrl || typeof rawUrl !== "string") return { unsupported: true, reason: "invalid-url" };
  const trimmed = rawUrl.trim();
  if (!trimmed) return { unsupported: true, reason: "invalid-url" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { unsupported: true, reason: "invalid-url" };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { unsupported: true, reason: "non-http-scheme" };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return { unsupported: true, reason: "invalid-url" };
  if (host === "localhost" || PRIVATE_IP_RE.test(host)) {
    return { unsupported: true, reason: "internal-host" };
  }
  for (const suffix of INTERNAL_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return { unsupported: true, reason: "internal-host" };
  }
  for (const prefix of INTERNAL_HOST_PREFIXES) {
    if (host.startsWith(prefix)) return { unsupported: true, reason: "internal-host" };
  }
  if (INTERNAL_AGGREGATOR_HOSTS.has(host)) {
    return { unsupported: true, reason: "internal-aggregator" };
  }
  // Task #197: explicit non-media platforms that admins occasionally
  // paste into the sheet by mistake (Notion docs, Google Docs/Sheets,
  // Slack/Discord threads, dashboards). These never contain extractable
  // media and would otherwise burn an Apify slot before failing.
  const NON_MEDIA_HOSTS = [
    "notion.so", "www.notion.so", "notion.site",
    "docs.google.com", "drive.google.com", "sheets.google.com",
    "airtable.com",
    "slack.com", "app.slack.com",
    "discord.com", "discord.gg",
    "trello.com", "asana.com", "monday.com",
    "linear.app",
    "loom.com",
    "github.com",
  ];
  for (const h of NON_MEDIA_HOSTS) {
    if (host === h || host.endsWith("." + h)) {
      return { unsupported: true, reason: "non-media-host" };
    }
  }
  // Bare host with no path is almost always a dashboard / homepage, not
  // a media post; yt-dlp would either fail extraction or scrape unrelated
  // content. The path "/" alone is treated the same.
  const path = parsed.pathname || "/";
  if (path === "" || path === "/") {
    return { unsupported: true, reason: "no-path" };
  }
  // Task #197: dashboard/admin/internal path segments. A URL like
  // https://example.com/admin/posts/123 is structurally valid but
  // never serves public media; reject so the queue's pre-claim filter
  // never feeds it to the extractor.
  const lowerPath = path.toLowerCase();
  if (
    lowerPath.startsWith("/admin/") || lowerPath === "/admin" ||
    lowerPath.startsWith("/dashboard/") || lowerPath === "/dashboard" ||
    lowerPath.startsWith("/internal/") || lowerPath === "/internal" ||
    lowerPath.startsWith("/api/") || lowerPath === "/api"
  ) {
    return { unsupported: true, reason: "internal-path" };
  }
  // Task #209: Facebook photo.php pages render a JPG behind login and
  // never resolve to extractable video media. yt-dlp / Apify both burn
  // a slot before returning fb-auth-wall on these. Reject at intake.
  const isFb =
    host === "facebook.com" || host.endsWith(".facebook.com") ||
    host === "fb.com" || host.endsWith(".fb.com") || host === "fb.watch";
  if (isFb && (lowerPath === "/photo.php" || lowerPath.startsWith("/photo.php"))) {
    return { unsupported: true, reason: "fb-photo-php" };
  }
  // Task #209: Instagram profile-only URLs (no /p, /reel, /reels, /tv,
  // or /stories segment) have no extractable post identity. Without an
  // anchor the IG actor returns an empty dataset and yt-dlp returns
  // ig-login-required; reject at intake so the queue is not poisoned.
  const isIg =
    host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am";
  if (isIg) {
    const IG_POST_SEGMENT_RE = /^\/(?:p|reel|reels|tv|stories)\/[^/]+/i;
    if (!IG_POST_SEGMENT_RE.test(lowerPath)) {
      return { unsupported: true, reason: "ig-profile-only" };
    }
  }
  return { unsupported: false };
}

// Task #197: normalized recovery class derived from a mediaErrorClass
// string. Maps the rich classifyError() taxonomy onto a stable, small
// set of operator-actionable buckets so the dashboard and the
// retry-scheduler can both read a single column instead of repeating
// classification logic. Keep in lockstep with classifyError().
// Task #200: hoisted from media-downloader.ts so off-runtime tooling
// (e.g. scripts/src/reclassify-ad-research.ts) can source the same
// retry-cap constant the worker uses, instead of hardcoding it. The
// worker still imports this constant by name from this module so the
// runtime + tooling stay in lockstep.
export const MAX_ATTEMPTS = 4;

export type RecoveryClass =
  | "recoverable-temporary"
  | "recoverable-auth"
  | "recoverable-extractor"
  | "invalid-input"
  | "dead-content"
  // Task #209: terminal class for URLs the queue's pre-claim filter
  // refuses to feed to the extractor at all - currently FB photo.php
  // pages and IG profile-only URLs (no /p, /reel, /tv, /stories anchor).
  // Distinct from `invalid-input` (parse-fail / non-http) and from
  // `dead-content` (post used to exist, owner deleted) so the
  // dashboard can show "we deliberately blocked this shape" without
  // implying a transient or recoverable failure.
  | "unsupported-input"
  // T370: terminal class for ads whose source video has no audio on
  // EITHER the primary extractor (yt-dlp) or the residential Apify
  // escalation. Distinct from `dead-content` (post deleted) and
  // `recoverable-extractor` (extractor drift) so the dashboard can
  // surface "this ad is genuinely silent" without implying a bug.
  // Persisted alongside `mediaStatus='silent-source'`.
  | "silent-source"
  // Task #209: dedicated recovery class for the IG hard-fail path
  // (anonymous yt-dlp blocked because the admin-managed cookie jar is
  // missing, unreadable, or its flag would not be passed). Persisted
  // distinctly from `recoverable-auth` so an operator can tell on the
  // dashboard whether the auth wall is "session expired" (cookies
  // present but rejected by the platform) vs "we never had cookies"
  // (admin needs to re-paste the jar). The wrapper still escalates
  // such a row straight to Apify residential.
  | "auth-misconfigured";

// T209: pure helper extracted from runYtDlpDownload's IG hard-fail
// short-circuit so the spawn-suppression behavior is testable.
export type IgPreSpawnGuardCookies =
  | { path?: string | null; source?: string | null }
  | null
  | undefined;
export type IgPreSpawnGuardOutcome =
  | { hardFail: null; fileReadable: true }
  | { hardFail: "no-cookies" | "unreadable" | "no-flag"; fileReadable: false };
export async function evaluateIgPreSpawnGuard(
  cookies: IgPreSpawnGuardCookies,
  accessReadable: (path: string) => Promise<boolean>,
): Promise<IgPreSpawnGuardOutcome> {
  if (!cookies) return { hardFail: "no-cookies", fileReadable: false };
  if (!cookies.path) return { hardFail: "no-flag", fileReadable: false };
  let ok = false;
  try { ok = await accessReadable(cookies.path); } catch { ok = false; }
  if (!ok) return { hardFail: "unreadable", fileReadable: false };
  return { hardFail: null, fileReadable: true };
}
export function igHardFailErrorString(outcome: "no-cookies" | "unreadable" | "no-flag"): string {
  return `ig-auth-misconfigured: ${outcome} - IG yt-dlp invocation blocked; recovery_class_t197=auth-misconfigured`;
}

export function deriveRecoveryClass(errorClass: string | null | undefined): RecoveryClass {
  const k = (errorClass || "").toLowerCase();
  // T209: structural intake-rejections → unsupported-input;
  // bare parse failures keep the legacy invalid-input mapping.
  if (
    k === "unsupported-input" ||
    k === "fb-photo-php" ||
    k === "ig-profile-only" ||
    k === "internal-host" ||
    k === "internal-aggregator" ||
    k === "non-media-host" ||
    k === "no-path" ||
    k === "internal-path"
  ) return "unsupported-input";
  if (k === "unsupported-url" || k === "invalid-url" || k === "non-http-scheme") return "invalid-input";
  if (k === "dead-media" || k === "private-content") return "dead-content";
  // T370: silent-source is terminal; never retry. (`no-audio-track` is
  // NOT terminal - it's a single-extractor signal that triggers
  // residential escalation upstream, so it stays on the temporary
  // ladder when seen here at all.)
  if (k === "silent-source") return "silent-source";
  // Task #209: dedicated bucket for anonymous IG hard-fail; distinct
  // from `recoverable-auth` (cookies were attached but the platform
  // rejected the session) so the dashboard can split the two on the
  // Recovery Pipeline panel.
  if (k === "auth-misconfigured") return "auth-misconfigured";
  if (
    k === "ig-login-required" ||
    k === "fb-auth-wall" ||
    k === "cookie-expired" ||
    k === "auth-wall-escalated-failed" ||
    k === "auth"
  ) return "recoverable-auth";
  if (k === "extractor-stale" || k === "share-resolution-failed") return "recoverable-extractor";
  // Task #197: strict normalization - any unrecognized or empty errorClass
  // collapses to `recoverable-temporary` so the row still flows through the
  // delayed-retry ladder. The taxonomy is intentionally closed to five
  // operator-actionable buckets; an "unknown" sentinel would let failed
  // rows drift outside the dashboard's visibility.
  return "recoverable-temporary";
}

// Task #197: delayed-retry ladder. Given a row's NEW attempts count
// after this failure (1, 2, 3, 4...) and the recovery class, return
// the wall-clock time the row becomes eligible for re-claim, plus a
// short strategy label persisted alongside it.
//
// Default ladder: 10m -> 1h -> 6h -> permanent dismiss at MAX_ATTEMPTS.
// Auth failures override to a slightly longer first-step (30m) since
// the typical fix is admin cookie refresh and a 10m re-attempt would
// just hit the same auth wall.
export interface RetrySchedule {
  retryAfterAt: Date | null;
  recoveryStrategy: string;
  exhausted: boolean;
}
const ATTEMPT_LADDER_MS: number[] = [
  10 * 60 * 1000,        // attempt 1 -> +10m
  60 * 60 * 1000,        // attempt 2 -> +1h
  6 * 60 * 60 * 1000,    // attempt 3 -> +6h
];
const AUTH_LADDER_MS: number[] = [
  30 * 60 * 1000,        // attempt 1 -> +30m (cookie-refresh window)
  2 * 60 * 60 * 1000,    // attempt 2 -> +2h
  6 * 60 * 60 * 1000,    // attempt 3 -> +6h
];
export function computeRetrySchedule(
  recoveryClass: RecoveryClass,
  newAttempts: number,
  maxAttempts: number,
  now: number = Date.now(),
): RetrySchedule {
  if (recoveryClass === "invalid-input") {
    return { retryAfterAt: null, recoveryStrategy: "permanent-dismiss-invalid", exhausted: true };
  }
  if (recoveryClass === "dead-content") {
    return { retryAfterAt: null, recoveryStrategy: "permanent-dismiss-dead", exhausted: true };
  }
  // T370: silent-source rows skip the retry ladder entirely. The audio
  // gate has already escalated through every extractor; further
  // attempts will keep producing the same silent file.
  if (recoveryClass === "silent-source") {
    return { retryAfterAt: null, recoveryStrategy: "permanent-dismiss-silent", exhausted: true };
  }
  // Task #209: intake-rejected shapes are terminal on the first sight.
  // Treated as a no-retry permanent-dismiss so the queue does not
  // re-feed FB photo.php / IG profile-only URLs into the extractor.
  if (recoveryClass === "unsupported-input") {
    return { retryAfterAt: null, recoveryStrategy: "permanent-dismiss-unsupported", exhausted: true };
  }
  if (newAttempts >= maxAttempts) {
    return { retryAfterAt: null, recoveryStrategy: "permanent-dismiss-exhausted", exhausted: true };
  }
  // Task #209: `auth-misconfigured` rows have already been escalated
  // straight to Apify residential by the wrapper at this point; the
  // retry ladder treats them on the slower auth cadence (the typical
  // fix is admin cookie re-paste, not a quick re-attempt).
  const ladder = (recoveryClass === "recoverable-auth" || recoveryClass === "auth-misconfigured")
    ? AUTH_LADDER_MS
    : ATTEMPT_LADDER_MS;
  const idx = Math.max(0, Math.min(ladder.length - 1, newAttempts - 1));
  const delay = ladder[idx];
  const at = new Date(now + delay);
  let strategy: string;
  const minutes = Math.round(delay / 60000);
  const label = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
  if (recoveryClass === "recoverable-auth") strategy = `auth-refresh+escalation@${label}`;
  else if (recoveryClass === "auth-misconfigured") strategy = `auth-misconfigured-fix+escalation@${label}`;
  else if (recoveryClass === "recoverable-extractor") strategy = `alternate-actor@${label}`;
  else strategy = `delayed-retry@${label}`;
  return { retryAfterAt: at, recoveryStrategy: strategy, exhausted: false };
}

export function classifyError(message: string | null | undefined): string {
  const s = (message || "").toLowerCase();
  if (!s) return "unknown";

  // Task #196: structurally invalid / out-of-scope URLs. Persisted by
  // the queue's pre-extraction filter so the operator sees a single
  // dedicated bucket instead of a mix of yt-dlp and Apify failures for
  // the same root cause (URL never should have reached the extractor).
  if (s.startsWith("unsupported-url") || s.includes("unsupported-url:")) return "unsupported-url";

  // Task #209: intake-rejection signatures emitted by the queue's
  // pre-claim filter for URL shapes that are well-formed HTTP(S) but
  // structurally cannot serve extractable media (FB photo.php pages,
  // IG profile-only URLs without a /p|/reel|/tv|/stories anchor).
  // Routed to the new `unsupported-input` recovery class so the
  // dashboard surfaces them as deliberately-blocked rather than a
  // transient extractor failure.
  if (s.includes("unsupported-input") || s.includes("fb-photo-php") || s.includes("ig-profile-only")) {
    return "unsupported-input";
  }

  // Task #155: yt-dlp / IG / FB messages that mean "the cookies you gave
  // me used to be valid but no longer are". The dashboard surfaces this
  // distinct from `ig-login-required` / `fb-auth-wall` (no-cookies-at-all)
  // so admins know the fix is "re-upload cookies.txt" rather than "upload
  // cookies.txt for the first time".
  if (
    s.includes("cookies are no longer valid") ||
    s.includes("cookies have expired") ||
    s.includes("sign in to confirm") ||
    s.includes("sign in to confirm your age") ||
    s.includes("login expired") ||
    (s.includes("session") && s.includes("expired")) ||
    s.includes("re-authenticate") ||
    s.includes("please log in again")
  ) return "cookie-expired";

  // Task #158: yt-dlp hit an auth wall AND the Apify residential-proxy
  // escalation also failed. This is a distinct, terminal class so the
  // dashboard can separate "yt-dlp blocked, recovered via apify" (no
  // user-visible error) from "both providers failed - investigate".
  if (s.includes("auth-wall-escalated-failed")) return "auth-wall-escalated-failed";

  // T370: terminal classifier for ads whose source video has no audio
  // track on either yt-dlp or the residential Apify escalation. The
  // wrapper at runYtDlpWithAuthWallEscalation tags the final error
  // with the `silent-source:` prefix only after both providers have
  // been exhausted; the bare `no-audio-track` from a single extractor
  // attempt is kept distinct so it still triggers escalation.
  if (s.startsWith("silent-source") || s.includes("silent-source:")) return "silent-source";
  if (s === "no-audio-track" || s.includes("no-audio-track")) return "no-audio-track";

  // Task #209: hard-fail signal emitted by runYtDlpDownload when an IG
  // URL would otherwise be invoked anonymously. The wrapper escalates
  // immediately to Apify residential proxy instead of burning the
  // yt-dlp call against a guaranteed login wall.
  if (s.includes("ig-auth-misconfigured") || s.includes("auth-misconfigured")) {
    return "auth-misconfigured";
  }

  if (s.includes("[instagram]") || s.includes("instagram:")) {
    if (s.includes("http error 429") || s.includes("too many requests")) return "ig-rate-limited";
    if (
      s.includes("login required") ||
      s.includes("logged-in") ||
      s.includes("requested content is not available") ||
      s.includes("empty media response")
    ) return "ig-login-required";
  }
  if (s.includes("login required") && (s.includes("instagram") || s.includes("ig:"))) return "ig-login-required";

  if (s.includes("share-url-locked") || s.includes("share-locked") || s.startsWith("share:")) return "share-resolution-failed";
  if (s.includes("only available for registered users")) return "fb-auth-wall";
  if (
    (s.includes("facebook") || s.includes("[facebook]") || s.includes("fb:")) &&
    (s.includes("login") || s.includes("logged-in") || s.includes("registered users"))
  ) return "fb-auth-wall";

  if (
    s.includes("apify-quota") ||
    s.includes("monthly usage limit") ||
    s.includes("memory limit") ||
    s.includes("usage hard limit") ||
    s.includes("plan limit") ||
    s.includes("http 402")
  ) return "quota-exceeded";

  if (
    s.includes("http error 416") ||
    s.includes("http 416") ||
    s.includes("416 requested range") ||
    s.includes("requested range not satisfiable")
  ) return "http-416";
  // Task #193: yt-dlp partial-resume corruption signatures that the
  // outer download wrapper treats as a one-shot retry trigger AFTER
  // pre-cleaning the workdir. These are NOT terminal: they typically
  // mean a previous segment download died mid-stream and the byte
  // ranges no longer line up with what the CDN will serve. With
  // --no-continue + --http-chunk-size 0 + a fresh workdir, a re-spawn
  // almost always succeeds.
  if (s.includes("http error 429") || s.includes("too many requests") || s.includes("http 429")) return "ig-rate-limited";

  if (
    s.includes("removed by") ||
    s.includes("video is no longer available") ||
    s.includes("content isn't available") ||
    s.includes("content is no longer available") ||
    s.includes("page may have been removed") ||
    s.includes("has been deleted")
  ) return "dead-media";

  if (s.includes("apify-batch-timeout") || s.includes("cdn-fetch-timeout")) return "timeout";
  if (s.includes("timeout") || s.includes("aborted") || s.includes("timed out")) return "timeout";

  // Task #196: private-account / private-content. yt-dlp surfaces these
  // for IG/FB rows whose owner has flipped the account to private after
  // the post was originally indexed - distinct from a broken session
  // (cookie-expired / login-required) so the dashboard can show "owner
  // privated this content" without flapping the cookie jar.
  if (
    s.includes("this account is private") ||
    s.includes("private account") ||
    s.includes("private profile") ||
    s.includes("this video is private") ||
    s.includes("post is private")
  ) return "private-content";

  // Task #196: anti-bot / challenge / captcha walls. These are not
  // login-required (cookies are fine) and not rate-limit (no 429 in
  // the body) - the platform wants a human-completed challenge before
  // serving the post. Treated as transient by the delayed-retry pass
  // because they typically clear on their own after a short cooldown.
  if (
    s.includes("challenge_required") ||
    s.includes("checkpoint_required") ||
    s.includes("captcha") ||
    s.includes("please wait a few minutes before you try again") ||
    s.includes("suspicious activity") ||
    s.includes("automated behavior")
  ) return "anti-bot";

  // Task #196: extractor-stale. yt-dlp's extractor for the platform has
  // drifted from the live page shape (no video formats found / unable
  // to extract data). Distinct from yt-dlp-failure so the queue can
  // (a) escalate to the secondary Apify actor pipeline and (b) apply
  // the longer transient-cooldown before re-attempting.
  if (
    s.includes("no video formats found") ||
    s.includes("no video could be found") ||
    s.includes("unable to extract data") ||
    s.includes("unable to extract video data") ||
    s.includes("unable to extract initial data") ||
    s.includes("unable to extract sharedData") ||
    s.includes("extractor returned no data") ||
    s.includes("requested format is not available")
  ) return "extractor-stale";

  if (s.startsWith("apify:") || s.includes("apify:")) return "apify";
  if (s.startsWith("cdn:") || s.includes("cdn:")) return "cdn";
  if (s.includes("yt-dlp") || s.includes("ytdlp") || s.includes("error: [") || s.includes("error: ")) return "yt-dlp-failure";

  if (s.includes("not available") || s.includes("unavailable")) return "unavailable-content";

  if (s.includes("carousel:")) return "carousel";
  if (s.includes("not found") || s.includes("404")) return "dead-media";
  if (s.includes("forbidden") || s.includes("403")) return "fb-auth-wall";
  if (s.includes("login")) return "ig-login-required";
  return "other";
}

// T210: hard-vs-soft auth signal classifier. The auth-health probe and
// any code site that might flip a saved jar to `expired` MUST gate on
// this so a transient extractor blip (timeout, empty dataset, actor
// failure) never destroys a still-valid admin-managed session. Hard
// signals are the small set of outcomes that have a >90% probability
// of meaning "this jar will not authenticate again":
//
//   cookie-expired                - extractor said the cookies expired
//   ig-login-required             - IG returned a login wall
//   fb-auth-wall                  - FB returned an auth wall
//   apify-unauthorized            - Apify rejected our APIFY_TOKEN
//   auth-wall-escalated-failed    - both yt-dlp and the residential
//                                   proxy escalation hit an auth wall
//
// Everything else (timeout, actor-error, empty payloads, rate limits,
// extractor-stale, anti-bot, dead-media) is a SOFT signal: the auth
// health record can still be downgraded to `degraded` for visibility
// but the underlying jar must NOT be flipped to `expired`.
const HARD_AUTH_SIGNAL_CLASSES = new Set<string>([
  "cookie-expired",
  "ig-login-required",
  "fb-auth-wall",
  "apify-unauthorized",
  "auth-wall-escalated-failed",
]);
export function isHardAuthSignal(
  errorClass: string | null | undefined,
): boolean {
  if (!errorClass) return false;
  return HARD_AUTH_SIGNAL_CLASSES.has(errorClass.toLowerCase());
}

// Task #181: shared Apify-quota detector. The IG/FB session probes and
// every production FB Apify wrapper used to treat any HTTP 401/403 (or
// any actor failure with the right substrings) as proof that the saved
// cookie jar had been auth-blocked at the IG/FB edge, and would
// auto-flip the jar to `expired`. That mis-attributes Apify *account*
// failures - in particular `platform-feature-disabled` /
// `monthly usage hard limit exceeded` - which come back as HTTP 403 with
// a clear quota body even though the cookies are perfectly valid. Use
// this helper to guard every auto-expire branch so a quota outage on
// the Apify account never silently expires a healthy session jar.
export function isApifyQuotaError(
  status: number | null | undefined,
  body: string | null | undefined,
): boolean {
  const s = (body || "").toLowerCase();
  if (
    s.includes("platform-feature-disabled") ||
    s.includes("monthly usage limit") ||
    s.includes("monthly usage hard limit") ||
    s.includes("usage hard limit") ||
    s.includes("memory limit") ||
    s.includes("plan limit") ||
    s.includes("apify-quota") ||
    s.includes("quota exceeded") ||
    s.includes("hard limit exceeded")
  ) return true;
  if (status === 402) return true;
  return false;
}

// Task #181: in-process "recent quota signal" tracker. The empty-dataset
// auto-expiry branches (FB/IG probe + production media-downloader) do
// not have an HTTP body to inspect - by the time we see zero items,
// Apify has already returned a 200 SUCCEEDED. If a quota response was
// observed within the last few minutes, treat the empty dataset as a
// likely quota side-effect and skip the auto-expire so a healthy jar
// is not wrongly flipped to expired. Real auth failures still flip
// the jar via the explicit login_required / 401/403 branches that
// fire before this guard.
let lastApifyQuotaAtMs = 0;
export function noteApifyQuotaSignal(now: number = Date.now()): void {
  lastApifyQuotaAtMs = now;
}
export function wasApifyQuotaRecent(
  windowMs: number = 30 * 60_000,
  now: number = Date.now(),
): boolean {
  return lastApifyQuotaAtMs > 0 && now - lastApifyQuotaAtMs <= windowMs;
}
// Test-only reset.
export function _resetApifyQuotaSignalForTests(): void {
  lastApifyQuotaAtMs = 0;
}

// Task #181: classify a non-OK Apify HTTP response so the FB/IG session
// probes (and the production Apify wrappers that mirror them) can make
// the correct call about whether to auto-expire the saved cookie jar.
// Quota is checked first because Apify returns its account quota / hard
// limit failures as HTTP 403 with a `platform-feature-disabled` body -
// the same status code as a real auth wall - and the previous code path
// would wrongly flip the jar to `expired` on quota.
//
// Returns:
//   "quota" - Apify account-level quota / hard limit (do NOT auto-expire)
//   "auth"  - real platform auth-wall (login_required, checkpoint, 401/403
//             with no quota signal, "only available for registered users")
//   "other" - any other non-OK response (transient Apify error, OOM, etc.)
export type ApifyHttpFailureKind = "quota" | "auth" | "other";
export function classifyApifyHttpFailure(
  status: number | null | undefined,
  body: string | null | undefined,
): ApifyHttpFailureKind {
  if (isApifyQuotaError(status, body)) return "quota";
  const lower = (body || "").toLowerCase();
  if (
    status === 401 || status === 403
    || lower.includes("login required") || lower.includes("login_required")
    || lower.includes("checkpoint")
    || lower.includes("only available for registered")
    || lower.includes("session expired") || lower.includes("session_expired")
  ) return "auth";
  return "other";
}

// Task #190: canonicalize Instagram and Facebook URLs before any
// extraction path (Apify, yt-dlp, escalation, share resolution).
// Pure helper - no I/O - so it is safe to call defensively at every
// boundary. Idempotent: feeding a normalized URL back in returns the
// same string with no `changes`. Goal is to reduce
// share-resolution-failed and "unsupported URL" failures caused by
// mobile / share / tracking URL variants.
export interface NormalizeSocialUrlResult {
  url: string;
  normalized: boolean;
  changes: string[];
}

const URL_NOISE_PARAMS = new Set([
  // Instagram share / story tokens
  "igsh",
  "igshid",
  // Facebook click + tracking tokens
  "fbclid",
  "mibextid",
  "_rdr",
  "_ft_",
  // Facebook stack-trace-ish tokens (truncated paths via __cft__/__tn__)
  "__cft__",
  "__tn__",
  "__xts__",
  // Notification + comment deep-links - not part of the canonical post
  "comment_id",
  "reply_comment_id",
  "notif_id",
  "notif_t",
  // Generic tracking junk
  "ref",
  "ref_src",
  "ref_url",
  "rdc",
  "rdr",
  "source",
  "h",
  "sfns",
  "pn_ref",
]);

function isLinkShimHost(h: string): boolean {
  return (
    h === "l.instagram.com" ||
    h === "l.facebook.com" ||
    h === "lm.facebook.com"
  );
}

export function normalizeSocialUrl(rawUrl: string | null | undefined): NormalizeSocialUrlResult {
  const input = (rawUrl ?? "").trim();
  if (!input) return { url: "", normalized: false, changes: [] };

  let working = input;
  const changes: string[] = [];

  // 1. Unwrap link-shim wrappers
  // (l.instagram.com/?u=<encoded>, l.facebook.com/l.php?u=<encoded>).
  // These carry the real destination in the `u` query param.
  try {
    const shim = new URL(working);
    if (isLinkShimHost(shim.hostname.toLowerCase()) && shim.searchParams.has("u")) {
      const inner = shim.searchParams.get("u");
      if (inner) {
        try {
          new URL(inner);
          working = inner;
          changes.push("unwrap-link-shim");
        } catch {
          /* not a valid inner URL - leave outer alone */
        }
      }
    }
  } catch {
    return { url: input, normalized: false, changes: [] };
  }

  let u: URL;
  try {
    u = new URL(working);
  } catch {
    return { url: input, normalized: false, changes: [] };
  }

  // 2. Lowercase host
  const origHost = u.hostname;
  u.hostname = u.hostname.toLowerCase();
  if (u.hostname !== origHost) changes.push("lowercase-host");

  // 3. Host aliases - collapse to canonical hostnames so downstream
  // classifiers and extractors don't have to special-case each variant.
  // Note: m.facebook.com is intentionally PRESERVED here because the
  // share resolver explicitly retries against m.facebook.com; rewriting
  // it away would defeat that fallback. fb.watch is also preserved
  // (it's a short-link host that yt-dlp / the resolver follow).
  if (u.hostname === "instagr.am") {
    u.hostname = "www.instagram.com";
    changes.push("host-alias-instagram");
  }
  if (u.hostname === "fb.com" || u.hostname.endsWith(".fb.com")) {
    u.hostname = "www.facebook.com";
    changes.push("host-alias-facebook");
  }
  if (u.hostname === "web.facebook.com") {
    u.hostname = "www.facebook.com";
    changes.push("host-alias-facebook");
  }

  // 4. Strip noise + tracking params
  const toDelete: string[] = [];
  for (const key of Array.from(u.searchParams.keys())) {
    const k = key.toLowerCase();
    if (URL_NOISE_PARAMS.has(k) || k.startsWith("utm_") || k.startsWith("__cft__") || k.startsWith("__tn__")) {
      toDelete.push(key);
    }
  }
  if (toDelete.length) {
    for (const k of toDelete) u.searchParams.delete(k);
    changes.push(`strip-${toDelete.length}-tracking-params`);
  }

  // 5. Pathname canonicalization for Instagram / Facebook
  const isIg = u.hostname === "instagram.com" || u.hostname.endsWith(".instagram.com");
  const isFb = u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com");
  if (isIg || isFb) {
    // /reels/<id> -> /reel/<id> (canonical singular form that both
    // Apify actors and yt-dlp parse most reliably).
    const newPath = u.pathname.replace(/^\/reels\//i, "/reel/");
    if (newPath !== u.pathname) {
      u.pathname = newPath;
      changes.push("reels-to-reel");
    }
  }

  // Task #197: TikTok canonicalization. Aliases (vm.tiktok.com,
  // vt.tiktok.com short links, m.tiktok.com mobile) all collapse to
  // www.tiktok.com so yt-dlp + downstream dedupe see one identity.
  // /embed/v2/<id> and /embed/<id> are rewritten to the canonical
  // /@user/video/<id> shape when possible (best-effort - if the URL
  // doesn't carry the user handle we leave the path alone).
  const isTt = u.hostname === "tiktok.com" || u.hostname.endsWith(".tiktok.com");
  if (isTt) {
    if (u.hostname === "m.tiktok.com" || u.hostname === "tiktok.com") {
      u.hostname = "www.tiktok.com";
      changes.push("host-alias-tiktok");
    }
    // /embed/<id> -> /video/<id> path canonical form for the main host
    // (vm./vt. short links resolved by yt-dlp at fetch time).
    const ttEmbed = u.pathname.match(/^\/embed(?:\/v2)?\/(\d+)\/?$/i);
    if (ttEmbed) {
      u.pathname = `/video/${ttEmbed[1]}`;
      changes.push("tiktok-embed-canonical");
    }
  }

  // Task #197: YouTube canonicalization. Collapse host aliases
  // (m.youtube.com, music.youtube.com, youtu.be short links) to the
  // canonical www.youtube.com/watch?v=<id> form. yt-dlp accepts every
  // variant but downstream dedupe + caching benefit from one identity.
  const isYt = (
    u.hostname === "youtube.com" ||
    u.hostname.endsWith(".youtube.com") ||
    u.hostname === "youtu.be"
  );
  if (isYt) {
    if (u.hostname === "youtu.be") {
      // youtu.be/<id>?t=... -> www.youtube.com/watch?v=<id>
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (id) {
        u.hostname = "www.youtube.com";
        u.pathname = "/watch";
        u.searchParams.set("v", id);
        changes.push("youtu.be-to-watch");
      }
    } else {
      if (u.hostname === "m.youtube.com" || u.hostname === "youtube.com" || u.hostname === "music.youtube.com") {
        u.hostname = "www.youtube.com";
        changes.push("host-alias-youtube");
      }
      // /shorts/<id> -> /watch?v=<id> so the canonical form is one
      // shape (yt-dlp handles both, but our dedupe key benefits).
      const shorts = u.pathname.match(/^\/shorts\/([A-Za-z0-9_\-]+)\/?$/);
      if (shorts) {
        u.pathname = "/watch";
        u.searchParams.set("v", shorts[1]);
        changes.push("youtube-shorts-to-watch");
      }
    }
  }

  // 6. Drop fragment - never used by extractors
  if (u.hash) {
    u.hash = "";
    changes.push("drop-fragment");
  }

  // 7. Trim trailing slash (except root) so otherwise-identical URLs
  // hash to the same identity downstream.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
    changes.push("trim-trailing-slash");
  }

  const finalUrl = u.toString();
  return {
    url: finalUrl,
    normalized: finalUrl !== input,
    changes,
  };
}

// Task #191: multi-stage auth-wall escalation. Each escalation stage
// runs an Apify actor (primary, secondary, or rotated-session retry).
// When a stage fails to recover the row we want to know WHY so the
// next stage's strategy can react and the persisted error string is
// actionable. Pure helper - no I/O - keyed off the actor's items
// payload and apifyRunSyncBatch's null/empty contract:
//   apifyRunSyncBatch returns null when the HTTP call itself failed
//     (4xx/5xx, network error, quota gate) -> "actor-error"
//   returns [] when the actor ran but the dataset was empty
//     -> "empty-dataset"
//   returns items containing { error: "login_required" / "checkpoint" /
//     "only available for registered users" } -> "auth-rejected"
//   returns items containing { error: /unsupported|invalid url/ }
//     -> "unsupported-url"
//   returns items but our pickers extract no media URL -> "no-media"
// "timeout" is detected by the stage runner from ApifyBatchTimeoutError
// (not visible in items). Returns null when items DO yield media so
// the runner can short-circuit success.
export type EscalationFailureReason =
  | "empty-dataset"
  | "timeout"
  | "unsupported-url"
  | "no-media"
  | "auth-rejected"
  | "actor-error";

const AUTH_REJECTED_MARKERS = [
  "login_required",
  "login required",
  "checkpoint",
  "only available for registered",
  "session expired",
  "session_expired",
  "please log in",
  "please login",
];
const UNSUPPORTED_URL_RE = /unsupported|invalid url|not\s+a\s+valid\s+url|url\s+is\s+invalid|url\s+not\s+supported/i;

export function classifyApifyEscalationItems(items: any[] | null): EscalationFailureReason {
  if (items === null) return "actor-error";
  if (items.length === 0) return "empty-dataset";
  // Items present but none yielded media (caller already verified this
  // before invoking the classifier). Decide between auth-rejected,
  // unsupported-url, or generic no-media by sniffing item payloads.
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const errStr = typeof (it as any).error === "string" ? (it as any).error : "";
    if (errStr && UNSUPPORTED_URL_RE.test(errStr)) return "unsupported-url";
    // Stringify once for the auth marker scan so we catch nested
    // { errorMessage }, { reason }, etc. Bound payload size to avoid
    // worst-case blow-up on a giant items array.
    let blob = "";
    try { blob = JSON.stringify(it).slice(0, 4000).toLowerCase(); } catch { /* ignore */ }
    if (blob && AUTH_REJECTED_MARKERS.some((m) => blob.includes(m))) {
      return "auth-rejected";
    }
  }
  return "no-media";
}

// Task #151: derive a coarse platform tag from a URL. Used by the
// queue-health endpoint so admins can see provider distribution at a
// glance without parsing the URL on the client.
export function derivePlatform(url: string | null | undefined): "ig" | "fb" | "yt" | "other" {
  const u = (url || "").toLowerCase();
  if (!u) return "other";
  if (u.includes("instagram.com") || u.includes("ig.me") || u.includes("cdninstagram")) return "ig";
  if (
    u.includes("facebook.com") ||
    u.includes("fb.com") ||
    u.includes("fb.watch") ||
    u.includes("fbcdn")
  ) return "fb";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "yt";
  return "other";
}

// Task #151: operational buckets used by the dashboard header strip.
// Each error class maps to exactly one bucket so the AUTH BLOCKED /
// RATE LIMITED / TERMINAL FAILURES counters always sum to the total
// failure count without double-counting.
export type OperationalBucket =
  | "auth"
  | "rate-limit"
  | "quota"
  | "unavailable"
  | "dead"
  | "unsupported"
  | "retryable";
export function operationalBucket(klass: string | null | undefined): OperationalBucket {
  switch (klass) {
    case "ig-login-required":
    case "fb-auth-wall":
    case "cookie-expired":
    case "auth-wall-escalated-failed":
    case "auth":
      return "auth";
    case "ig-rate-limited":
    case "anti-bot":
      return "rate-limit";
    case "quota-exceeded":
    case "apify-quota-exceeded": // legacy alias - retained until historical rows age out
      return "quota";
    case "unavailable-content":
    case "private-content":
      return "unavailable";
    case "dead-media":
    case "http-416":
    case "not-found":
      return "dead";
    case "unsupported-url":
      return "unsupported";
    default:
      return "retryable";
  }
}

// Task #151 (post-review v4): pure helper for the success-rate
// rollup so the scope invariant ("denominator covers the full
// board population, including all-time dismissed failures; 24h
// signals stay separate") is regression-tested without a DB.
export interface OutcomeRollupInput {
  statusOk: number;
  statusPartial: number;
  statusFailed: number;
  dismissedWithFailureAllTime: number;
  dismissedWithFailure24h: number;
  terminalLive24h: number;
  retrying: number;
  buckets: Record<OperationalBucket, number>;
  providerFailures?: number;
}
export interface OutcomeRollup {
  totalProcessed: number;
  usableMedia: number;
  successRateBp: number;
  terminalFailures: number;
  dismissedTotal: number;
  retrying: number;
  authBlocked: number;
  rateLimited: number;
  providerFailures: number;
  buckets: Record<OperationalBucket, number>;
}
export function computeOutcomeRollup(i: OutcomeRollupInput): OutcomeRollup {
  const usableMedia = i.statusOk + i.statusPartial;
  const failedTotal = i.statusFailed + i.dismissedWithFailureAllTime;
  const totalProcessed = usableMedia + failedTotal;
  const successRateBp = totalProcessed > 0
    ? Math.round((usableMedia / totalProcessed) * 10000)
    : 0;
  return {
    totalProcessed,
    usableMedia,
    successRateBp,
    terminalFailures: i.terminalLive24h + i.dismissedWithFailure24h,
    dismissedTotal: i.dismissedWithFailure24h,
    retrying: i.retrying,
    authBlocked: i.buckets.auth,
    rateLimited: i.buckets["rate-limit"],
    providerFailures: i.providerFailures ?? (i.buckets.retryable + i.buckets.quota),
    buckets: i.buckets,
  };
}
