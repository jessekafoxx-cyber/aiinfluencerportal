import { spawn } from "child_process";
import { mkdtemp, readFile, readdir, rm, access, writeFile } from "fs/promises";
import { constants as fsConstants } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import {
  db,
  adResearchBoardItems,
  adResearchBoardQueueMetrics,
  adResearchBoardQueueMetricsControl,
  adResearchBoardSyncStatus,
  type AdResearchBoardMediaItem,
  type AdResearchBoardMediaMeta,
} from "@workspace/db";
import { eq, sql, or, isNull, and, lt, gt, gte, inArray, notInArray, count, desc, asc, isNotNull, ne } from "drizzle-orm";
import { hostname } from "os";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";
import {
  pickInstagramMedia as _pickInstagramMedia,
  pickInstagramMediaList as _pickInstagramMediaList,
  detectInstagramCarousel as _detectInstagramCarousel,
  pickFacebookMediaList as _pickFacebookMediaList,
  detectFacebookCarousel as _detectFacebookCarousel,
  classifyError as _classifyError,
  derivePlatform as _derivePlatform,
  operationalBucket as _operationalBucket,
  normalizeSocialUrl as _normalizeSocialUrl,
  classifyApifyEscalationItems as _classifyApifyEscalationItems,
  isPartialResumeError,
  isUnsupportedExtractionUrl,
  evaluateIgPreSpawnGuard,
  igHardFailErrorString,
  TRANSIENT_RETRY_CLASSES,
  EXTRACTOR_STALE_CLASSES_FOR_ESCALATION,
  type MediaUrls,
  type CarouselInfo,
  type OperationalBucket,
  type NormalizeSocialUrlResult,
  type EscalationFailureReason,
  computeOutcomeRollup,
} from "./media-downloader-helpers";
import { classifyAdUrl } from "./ad-research-url-kind";

// Returns true when the URL classification is one we know is video-bearing
// (reels, FB videos, direct .mp4/.mov files). Used to refuse silently
// downgrading a video row to a still image when an Apify actor returns
// `imageUrl` only (typically the post thumbnail). When true and the
// resolved slide has no `videoUrl`, callers must fall through to yt-dlp
// instead of caching the thumbnail as the row's media.
function urlKindIsVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  const k = classifyAdUrl(url);
  return k === "instagram-reel"
    || k === "facebook-reel"
    || k === "facebook-video"
    || k === "direct-video";
}

// Re-export so existing call-sites and tests can keep importing from
// `./media-downloader`. The implementations live in the side-effect-free
// helpers module so unit tests can pull them in without dragging the DB,
// object-storage, and Apify clients into scope.
export const pickInstagramMedia = _pickInstagramMedia;
export const pickInstagramMediaList = _pickInstagramMediaList;
export const detectInstagramCarousel = _detectInstagramCarousel;
export const pickFacebookMediaList = _pickFacebookMediaList;
export const detectFacebookCarousel = _detectFacebookCarousel;
export const classifyError = _classifyError;
export const derivePlatform = _derivePlatform;
export const operationalBucket = _operationalBucket;
export const normalizeSocialUrl = _normalizeSocialUrl;
export const classifyApifyEscalationItems = _classifyApifyEscalationItems;
export type { MediaUrls, CarouselInfo, OperationalBucket, NormalizeSocialUrlResult, EscalationFailureReason };

// Task #190: shared internal wrapper that normalizes a URL and emits a
// single structured `event: "url-normalized"` log line ONLY when the
// canonicalization actually changed something. Idempotent: subsequent
// calls on the already-normalized URL no-op silently, so wiring this
// at every extraction boundary (Apify / yt-dlp / share-resolver /
// escalation) produces at most one log per raw URL.
function normalizeAndLog(
  rawUrl: string,
  ctx: { strategy?: string; rowKey?: string | null; adLink?: string | null },
): string {
  const r = _normalizeSocialUrl(rawUrl);
  if (r.normalized) {
    logger.info(
      {
        event: "url-normalized",
        rawUrl,
        normalizedUrl: r.url,
        changes: r.changes,
        strategy: ctx.strategy,
        rowKey: ctx.rowKey ?? null,
        adLink: ctx.adLink ?? null,
      },
      "media-downloader: url normalized before extraction",
    );
  }
  return r.url || rawUrl;
}

const MAX_BYTES = 80 * 1024 * 1024;
// Task #137: tightened from 90s → 60s. yt-dlp legitimately needs time on
// large videos but 90s was too generous; a stuck process shouldn't block
// a worker for a minute and a half. The hard kill still happens via
// SIGKILL inside runYtDlp so this is a real bound.
const PER_DOWNLOAD_TIMEOUT_MS = 60_000;
// Task #137: per-CDN-fetch (image / cached video) timeout. Tightened from
// the old hard-coded 60s in fetchMediaUrlAsBuffer so a slow CDN can't
// stall a worker for a full minute. AbortError on this signal is
// surfaced through `cdn-fetch-timeout` so admins can grep for it.
const CDN_FETCH_TIMEOUT_MS = 45_000;
// Maximum number of times we will retry a media download before marking
// the row as permanently dismissed. Exported so other modules (e.g. the
// portal requeue route) can mirror this exact cap without redefining a
// magic number that could drift out of sync.
// Task #200: import + re-export the canonical constant from helpers
// so internal references keep their local binding (a bare
// `export { ... } from` re-export is *not* a local binding) and
// outside importers (`import { MAX_ATTEMPTS } from "./media-downloader"`)
// continue to resolve. The source-of-truth lives next to
// computeRetrySchedule, which is the only place that should ever
// change the cap.
import { MAX_ATTEMPTS } from "./media-downloader-helpers";
export { MAX_ATTEMPTS } from "./media-downloader-helpers";
// Per-chunk download worker concurrency. Each worker holds a DB connection
// briefly when persisting results, so we keep this low to leave headroom in
// the pool for live user requests (lessons, sidebar `me` query, etc).
const FETCH_CONCURRENCY = 3;
const APIFY_BATCH_SIZE = 25;
const RETRY_BACKOFF_MINUTES = 15;
// Task #196: longer cooldown for transient-class failures (extractor-stale,
// anti-bot, ig-rate-limited). The default 15-min window burns retry slots
// on the same upstream condition that needs minutes (sometimes longer) to
// clear. Failed rows in TRANSIENT_RETRY_CLASSES wait this many minutes
// before the periodic processor re-claims them, while non-transient
// failures keep the existing cadence so a one-off CDN 5xx still recovers
// fast. Tunable via env so an operator can dial recovery latency without
// a redeploy.
const TRANSIENT_RETRY_BACKOFF_MIN = (() => {
  const raw = process.env["AD_RESEARCH_TRANSIENT_RETRY_MIN"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= RETRY_BACKOFF_MINUTES ? Math.floor(n) : 30;
})();
// Task #137 (next-stage hardening): lease-based durable queue. Each row a
// worker is currently processing has a lease_until timestamp set this far
// into the future at claim time. The heartbeat extends the lease while the
// row is still being worked on. If the worker process dies (SIGTERM
// during deploy, OOM, segfault), the lease expires within LEASE_TTL_MS
// and the row becomes claimable by the next pass without waiting for the
// 15-min RETRY_BACKOFF_MINUTES window. This is the durable-queue layer:
// no separate jobs table, no migration risk, just defense-in-depth on
// top of the existing in-memory `inFlightProcessor` lock so the system
// stays correct even if there are ever multiple API server replicas.
const LEASE_TTL_MS = 120_000;
const LEASE_HEARTBEAT_MS = 45_000;
// Task #137 (scaling pass): backpressure ceiling on a single pass. Without
// it, a sync that injects 500 fresh rows would trigger one giant pass that
// hammers Apify (and the DB pool) for tens of minutes. With it, each pass
// claims at most this many rows; remaining work is picked up by the next
// pass on the periodic timer or by the ensure-on-sync trigger. Tunable via
// env so an operator can throttle further during incidents without a
// redeploy.
const MAX_CANDIDATES_PER_PASS = (() => {
  const raw = process.env["AD_RESEARCH_QUEUE_BATCH_LIMIT"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
})();
// Periodic processor cadence. The sync trigger and the ensure-on-boot
// hook both fire processPendingMediaInBackground, but the periodic loop
// catches anything that slipped (lease expiries, retry-backoff windows
// elapsing, etc.) so the queue never silently stalls between syncs.
// Jitter prevents two processes (e.g. during a deploy overlap) from
// stampeding the DB on the exact same wall-clock tick.
const PROCESSOR_INTERVAL_MS = (() => {
  const raw = process.env["AD_RESEARCH_QUEUE_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 30_000 ? Math.floor(n) : 5 * 60 * 1000;
})();
const PROCESSOR_INTERVAL_JITTER_MS = 30_000;
// Metrics-snapshot cadence. Each tick writes one row to
// ad_research_board_queue_metrics so the dashboard can render trend
// charts without re-aggregating raw items on every poll.
const QUEUE_METRICS_INTERVAL_MS = (() => {
  const raw = process.env["AD_RESEARCH_METRICS_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : 5 * 60 * 1000;
})();
// Metrics retention. We keep ~14 days at 5-min cadence (= ~4032 rows) so
// the dashboard's 24h trend still has headroom and the table can't grow
// unbounded. Recorder prunes anything older after each insert.
const QUEUE_METRICS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Task #237: Postgres advisory lock key shared between the Media Worker's
// queue-metrics snapshot writer and the admin reset endpoint. Holding
// this lock across "drain counters + INSERT + retention prune" on the
// worker side and across "UPDATE provider-mix columns + raise signal"
// on the API side guarantees a snapshot row's provider-mix columns
// cannot race a reset under split runtimes. Stable magic bigint - do
// not change without coordinating with both callers.
export const QUEUE_METRICS_LOCK_KEY = 4237237237n;
// Task #194: how long to wait without a fresh queue_metrics snapshot
// before we declare the worker process dead in the admin dashboard.
// The worker writes a snapshot every QUEUE_METRICS_INTERVAL_MS (5min
// by default) so this threshold MUST be larger than that interval -
// otherwise a single missed tick (e.g. transient DB hiccup) would
// false-positive. Default 5min PLUS one extra interval of headroom.
export const WORKER_STALE_THRESHOLD_SEC = (() => {
  const raw = process.env["AD_RESEARCH_WORKER_STALE_THRESHOLD_SEC"];
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 60) return Math.floor(n);
  return Math.floor((QUEUE_METRICS_INTERVAL_MS / 1000) * 2);
})();
// Stable per-process worker identity. Written to mediaLeaseOwner so the
// queue-health dashboard can show which worker holds which row, and so
// crash recovery only re-claims rows whose owner is provably gone (lease
// expired) rather than blindly stealing rows from a healthy peer.
const WORKER_ID = `${hostname()}:${process.pid}:${Date.now().toString(36)}`;
export function getWorkerId(): string { return WORKER_ID; }
// Task #151: real-outcome error taxonomy (classifyError),
// derivePlatform, operationalBucket and OperationalBucket all live in
// `media-downloader-helpers.ts` and are re-exported at the top of this
// file. Implementations were moved out so unit tests can import them
// without dragging the DB / Apify / object-storage clients into scope.
// Hard cap on slides we cache for one carousel. Real Instagram carousels max
// at 10, Facebook attachments at ~10. We allow 12 for safety headroom.
const MAX_CAROUSEL_SLIDES = 12;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv"]);

function contentTypeFor(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "mov") return "video/quicktime";
  return "application/octet-stream";
}

function isLikelyImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    return /\.(jpe?g|png|webp|gif)(\?|$)/.test(p);
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isInstagramUrl(url: string): boolean {
  const h = hostOf(url);
  return h === "instagram.com" || h.endsWith(".instagram.com") || h === "instagr.am";
}

function isFacebookUrl(url: string): boolean {
  const h = hostOf(url);
  return (
    h === "facebook.com" ||
    h.endsWith(".facebook.com") ||
    h === "fb.com" ||
    h.endsWith(".fb.com") ||
    h === "fb.watch"
  );
}

function isFacebookShareUrl(url: string): boolean {
  if (!isFacebookUrl(url)) return false;
  try {
    const u = new URL(url);
    return /^\/share\/(?:r|p|v)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

// Facebook /share/r, /share/p, /share/v URLs are share-redirect tokens. Apify's
// facebook-posts-scraper and yt-dlp can't parse them directly. We pre-resolve
// the redirect (with a desktop UA, falling back to a mobile UA against
// m.facebook.com when desktop bounces us at the login wall) to find the
// canonical /reel/<id> or /<page>/posts/<id> URL, and feed that to the
// downstream resolvers. If we can only ever land on /login/ we return null
// so callers know there is no point retrying yt-dlp on this row.
const FB_SHARE_RESOLVE_TIMEOUT_MS = 10_000;

// Task #137: Apify batch timed out. Thrown by apifyRunSyncBatch on
// AbortError so callers (processInstagramBatch / processFacebookBatch)
// can fail every row in the batch as `apify-batch-timeout` instead of
// silently leaving them stuck in `downloading`.
class ApifyBatchTimeoutError extends Error {
  actor: string;
  constructor(actor: string) {
    super(`apify batch timeout: ${actor}`);
    this.name = "ApifyBatchTimeoutError";
    this.actor = actor;
  }
}

// Task #137: bounded LRU so a long-running process can't slowly leak
// memory by accumulating share-resolution results forever. ~1000 entries
// is plenty (the entire board has only a few hundred share-redirect rows
// in practice). Map preserves insertion order so we evict the oldest entry
// once we exceed the cap.
class BoundedMap<K, V> {
  private cap: number;
  private map = new Map<K, V>();
  constructor(cap: number) { this.cap = cap; }
  has(k: K): boolean { return this.map.has(k); }
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    // touch: move to most-recently-used position
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.cap) {
      const first = this.map.keys().next().value as K | undefined;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  get size() { return this.map.size; }
}
const FB_RESOLVE_CACHE_CAP = 1000;
const fbResolveCache = new BoundedMap<string, string | null>(FB_RESOLVE_CACHE_CAP);
const FB_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const FB_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

function isFacebookLoginWallUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!isFacebookUrl(url)) return false;
    const p = u.pathname.toLowerCase();
    return (
      p === "/login" ||
      p === "/login/" ||
      p.startsWith("/login/") ||
      p === "/login.php" ||
      p.startsWith("/checkpoint") ||
      p.startsWith("/privacy") ||
      p.startsWith("/policies/")
    );
  } catch {
    return false;
  }
}

function rewriteToMobileFacebook(url: string): string | null {
  try {
    const u = new URL(url);
    if (!isFacebookUrl(url)) return null;
    if (u.hostname.toLowerCase().startsWith("m.")) return url;
    u.hostname = "m.facebook.com";
    return u.toString();
  } catch {
    return null;
  }
}

// Task #187: cached FB Cookie header for the share-resolver. The active
// admin-managed FB jar is decrypted server-side, parsed from Netscape,
// and folded into a single `name=value; ...` string suitable for HTTP
// requests. Cached for 60s and identity-keyed by jarId+uploadedAt so any
// new upload / clear / markExpired forces a refresh on the next call.
// Worker-only - the API process keeps cookieResolverMode at "env-only"
// and so never builds this header. Cookie BYTES never appear in logs.
interface FbShareCookieCacheEntry {
  jarId: number;
  uploadedAtMs: number;
  header: string;
  expiresAt: number;
}
let fbShareCookieCache: FbShareCookieCacheEntry | null = null;
const FB_SHARE_COOKIE_TTL_MS = 60_000;
function netscapeToCookieHeader(text: string): string {
  const pairs: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let row = raw;
    if (line.startsWith("#")) {
      if (line.toLowerCase().startsWith("#httponly_")) {
        row = raw.replace(/^#HttpOnly_/i, "");
      } else continue;
    }
    const fields = row.split("\t");
    if (fields.length < 7) continue;
    const name = fields[5];
    const value = fields.slice(6).join("\t");
    if (!name || !value) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join("; ");
}
async function getFbShareCookieHeader(): Promise<string | null> {
  if (cookieResolverMode !== "db-and-env") return null;
  try {
    const auth = await import("./auth-cookies");
    // Task #187 (review fix): identity-aware cache. Probe the cheap
    // (id + uploadedAt) tuple on every call so a fresh upload, clear,
    // or markExpired flips us to the new jar on the *next* request,
    // never up to TTL_MS later. We only re-decrypt when the identity
    // tuple changed (or when there is no cached entry yet). The TTL
    // is kept as a safety net to bound stale data when DB probes fail.
    const identity = await auth.getActiveJarIdentity("fb");
    if (!identity) {
      fbShareCookieCache = null;
      return null;
    }
    const now = Date.now();
    if (
      fbShareCookieCache &&
      fbShareCookieCache.jarId === identity.jarId &&
      fbShareCookieCache.uploadedAtMs === identity.uploadedAtMs &&
      fbShareCookieCache.expiresAt > now
    ) {
      return fbShareCookieCache.header || null;
    }
    const active = await auth.readActiveJarPlaintext("fb");
    if (!active) {
      fbShareCookieCache = null;
      return null;
    }
    const header = netscapeToCookieHeader(active.text);
    fbShareCookieCache = {
      jarId: active.jarId,
      uploadedAtMs: active.uploadedAtMs,
      header,
      expiresAt: now + FB_SHARE_COOKIE_TTL_MS,
    };
    return header || null;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "fb-share-resolve: failed to load FB jar for Cookie header",
    );
    return null;
  }
}

async function fetchFollowingRedirects(
  url: string,
  ua: string,
): Promise<{ finalUrl: string; html: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FB_SHARE_RESOLVE_TIMEOUT_MS);
  try {
    // Task #187: when the worker has an admin-managed FB session, fold
    // it into the Cookie header so the share resolver follows
    // /share/<id> redirects authenticated and lands on the canonical
    // post URL instead of bouncing to /login.
    const cookieHeader = isFacebookUrl(url) ? await getFbShareCookieHeader() : null;
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    const finalUrl = resp.url || url;
    const html = await resp.text().catch(() => "");
    return { finalUrl, html };
  } catch (err: any) {
    logger.warn({ url, err: err?.message || String(err) }, "fb-share-resolve: fetch failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractCanonicalFromHtml(html: string): string | null {
  if (!html) return null;
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    null;
  return canonical || null;
}

// Returns the canonical Facebook URL, or null if every resolution path lands
// on a login wall or never escapes /share/. Returning null lets the caller
// short-circuit straight to dismissal instead of feeding yt-dlp a URL it
// will deterministically fail on (and burn a retry attempt doing it).
async function resolveFacebookShareUrl(
  rawUrl: string,
  ctx?: { rowKey?: string | null; adLink?: string | null; strategy?: string },
): Promise<string | null> {
  // Task #190: canonicalize before share resolution so igsh / fbclid /
  // utm tracking params and host aliases never reach the resolver fetch.
  rawUrl = normalizeAndLog(rawUrl, {
    strategy: ctx?.strategy ?? "fb-share-resolve",
    rowKey: ctx?.rowKey,
    adLink: ctx?.adLink,
  });
  if (!isFacebookShareUrl(rawUrl)) return rawUrl;
  if (fbResolveCache.has(rawUrl)) return fbResolveCache.get(rawUrl) ?? null;

  const tryResolve = async (
    startUrl: string,
    ua: string,
  ): Promise<string | null> => {
    const resp = await fetchFollowingRedirects(startUrl, ua);
    if (!resp) return null;
    let candidate = resp.finalUrl;
    // If we landed on the login wall the final URL is useless; check the
    // body for a canonical og:url (FB sometimes embeds it even on the wall).
    if (isFacebookLoginWallUrl(candidate)) {
      const canonical = extractCanonicalFromHtml(resp.html);
      if (canonical && !isFacebookLoginWallUrl(canonical)) candidate = canonical;
      else return null;
    }
    // Still on /share/?  Try to extract the canonical URL from the HTML.
    try {
      if (/\/share\/(?:r|p|v)\//i.test(new URL(candidate).pathname)) {
        const canonical = extractCanonicalFromHtml(resp.html);
        if (canonical && !isFacebookLoginWallUrl(canonical)) candidate = canonical;
      }
    } catch {
      /* ignore */
    }
    if (isFacebookLoginWallUrl(candidate)) return null;
    return candidate;
  };

  // 1. Desktop UA against the original URL.
  let resolved = await tryResolve(rawUrl, FB_DESKTOP_UA);

  // 2. Mobile UA against m.facebook.com — bypasses some login interstitials.
  if (!resolved) {
    const mobileUrl = rewriteToMobileFacebook(rawUrl);
    if (mobileUrl) resolved = await tryResolve(mobileUrl, FB_MOBILE_UA);
  }

  // Reject any "canonical" that is itself a login wall.
  if (resolved && isFacebookLoginWallUrl(resolved)) resolved = null;

  fbResolveCache.set(rawUrl, resolved);
  if (!resolved) {
    // Task #137: row-scoped structured log so the dead-end is grep-able
    // by rowKey/adLink and we can correlate "share URL only resolves to
    // login wall" persisted errors back to the resolver attempt.
    logger.warn(
      {
        rowKey: ctx?.rowKey ?? null,
        adLink: ctx?.adLink ?? null,
        strategy: ctx?.strategy ?? "fb-share-resolve",
        url: rawUrl,
      },
      "fb-share-resolve: every path led to login wall",
    );
  }
  return resolved;
}

async function runYtDlp(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    const t = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stderr, stdout });
    });
    proc.on("error", (err) => {
      clearTimeout(t);
      resolve({ code: -1, stderr: String(err?.message || err), stdout });
    });
  });
}

// Task #196: cached yt-dlp runtime probe. Spawns `yt-dlp --version` once
// per process (refreshed every 6h) so the worker boot log + queue-health
// dashboard can answer "what version is the extractor binary running?"
// without burning a fork on every request. Best-effort latest-version
// lookup against PyPI is fire-and-forget with a short timeout; if PyPI
// is unreachable we still surface the local version. Stale-by-design:
// we never auto-upgrade in-process - the operator runs `pip install -U
// yt-dlp` between deploys; the dashboard just makes drift visible.
export interface YtDlpRuntimeInfo {
  current: string | null;
  latest: string | null;
  outdated: boolean | null;
  checkedAt: string;
  error?: string;
}
let ytDlpRuntimeCache: { info: YtDlpRuntimeInfo; expiresAt: number } | null = null;
const YT_DLP_PROBE_TTL_MS = 6 * 60 * 60 * 1000;
async function spawnYtDlpVersion(): Promise<string | null> {
  try {
    const r = await runYtDlp(["--version"], 5000);
    if (r.code !== 0) return null;
    const v = r.stdout.trim().split(/\s+/)[0] ?? null;
    return v && /^\d/.test(v) ? v : null;
  } catch {
    return null;
  }
}
async function fetchLatestYtDlpVersion(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://pypi.org/pypi/yt-dlp/json", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json() as { info?: { version?: string } };
    return typeof j?.info?.version === "string" ? j.info.version : null;
  } catch {
    return null;
  }
}
export async function getYtDlpRuntimeInfo(opts?: { force?: boolean }): Promise<YtDlpRuntimeInfo> {
  const now = Date.now();
  if (!opts?.force && ytDlpRuntimeCache && ytDlpRuntimeCache.expiresAt > now) {
    return ytDlpRuntimeCache.info;
  }
  const [current, latest] = await Promise.all([spawnYtDlpVersion(), fetchLatestYtDlpVersion()]);
  // Normalize for comparison: yt-dlp --version reports zero-padded
  // date components (e.g. "2026.03.17") while PyPI publishes the
  // canonical PEP 440 form ("2026.3.17"). Strip leading zeros from
  // each dotted segment so the two compare equal when they are.
  const stripLeadingZeros = (v: string | null) =>
    v ? v.split(".").map((s) => s.replace(/^0+(?=\d)/, "")).join(".") : null;
  const info: YtDlpRuntimeInfo = {
    current,
    latest,
    outdated:
      current && latest ? stripLeadingZeros(current) !== stripLeadingZeros(latest) : null,
    checkedAt: new Date().toISOString(),
    ...(current ? {} : { error: "yt-dlp --version failed (binary missing or non-zero exit)" }),
  };
  ytDlpRuntimeCache = { info, expiresAt: now + YT_DLP_PROBE_TTL_MS };
  return info;
}
// Task #196: one-shot boot probe that logs the result for forensic logs.
// Safe to call from the worker entrypoint - never throws, never blocks
// pipeline start (the await is bounded by the 5s + 4s timeouts above).
export async function probeYtDlpRuntimeAtBoot(): Promise<void> {
  try {
    const info = await getYtDlpRuntimeInfo({ force: true });
    if (!info.current) {
      logger.error(
        { ytDlpVersion: null, latest: info.latest, error: info.error },
        "media-downloader: yt-dlp binary not found or unresponsive on boot",
      );
      return;
    }
    if (info.outdated) {
      logger.warn(
        { ytDlpVersion: info.current, latest: info.latest },
        "media-downloader: yt-dlp is behind latest published version (consider upgrading)",
      );
    } else {
      logger.info(
        { ytDlpVersion: info.current, latest: info.latest, outdated: info.outdated },
        "media-downloader: yt-dlp runtime probed at boot",
      );
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: yt-dlp boot probe failed (non-fatal)",
    );
  }
}

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

// Task #186: separate prefix for cached video poster thumbnails so an admin
// listing of `research-media/thumbnails/` shows only the cheap-to-rebuild
// images and the storage proxy keeps serving them without auth (the prefix
// stays under `research-media/`).
async function uploadThumbnailToObjectStorage(
  buf: Buffer,
  ext: string,
  contentType: string,
): Promise<string> {
  const objectId = randomUUID();
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const fullPath = `${privateDir.replace(/\/$/, "")}/research-media/thumbnails/${objectId}.${ext}`;
  const { bucket, object } = parseGcsPath(fullPath);
  await objectStorageClient
    .bucket(bucket)
    .file(object)
    .save(buf, { contentType, metadata: { contentType }, resumable: false });
  return `/objects/research-media/thumbnails/${objectId}.${ext}`;
}

// Task #186: best-effort fetch of a poster URL from the original platform
// (IG displayUrl, FB thumbnailUrl, yt-dlp --write-thumbnail). Returns null
// on any failure - the caller falls back to a locally-generated ffmpeg
// poster so a missing or 403'd CDN thumbnail never blocks the row.
async function fetchThumbnailBuffer(
  url: string,
): Promise<{ buf: Buffer; ext: string; contentType: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
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
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const ab = await resp.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > 10 * 1024 * 1024) return null;
    let ext = "jpg";
    let contentType = "image/jpeg";
    if (ct.includes("png")) { ext = "png"; contentType = "image/png"; }
    else if (ct.includes("webp")) { ext = "webp"; contentType = "image/webp"; }
    else if (ct.includes("gif")) { ext = "gif"; contentType = "image/gif"; }
    else if (ct.includes("jpeg") || ct.includes("jpg")) { ext = "jpg"; contentType = "image/jpeg"; }
    return { buf: Buffer.from(ab), ext, contentType };
  } catch {
    return null;
  }
}

// Probe a video file with ffprobe and return true iff it has at least
// one audio stream. Used by the yt-dlp / CDN download paths and by the
// `backfillVideosMissingAudio` admin job to guarantee that every cached
// video the user sees on the ad-research board has audio. Best-effort:
// on probe failure we return `null` so callers can decide whether to
// trust the file or retry.
//
// T370: parameterized so the bounded-retry wrapper can pass longer
// timeouts and bigger probe windows on the second attempt without
// duplicating the spawn boilerplate.
async function videoFileHasAudioTrack(
  videoPath: string,
  opts?: { timeoutMs?: number; deepScan?: boolean },
): Promise<boolean | null> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  try {
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const args = ["-v", "error"];
        if (opts?.deepScan) {
          // Bigger probe window: some encoded reels interleave the
          // audio packet much later than ffprobe's default 5MB / 5s
          // window. Bumping both makes the second attempt forgiving.
          args.push("-analyzeduration", "100M", "-probesize", "100M");
        }
        args.push(
          "-select_streams", "a",
          "-show_entries", "stream=codec_type",
          "-of", "csv=p=0",
          videoPath,
        );
        const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => { stdout += d.toString(); });
        proc.stderr.on("data", (d) => { stderr += d.toString(); });
        const killTimer = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
        }, timeoutMs);
        proc.once("close", (code) => {
          clearTimeout(killTimer);
          resolve({ code, stdout, stderr });
        });
        proc.once("error", () => {
          clearTimeout(killTimer);
          resolve({ code: -1, stdout, stderr });
        });
      },
    );
    if (r.code !== 0) {
      logger.warn(
        { code: r.code, err: r.stderr.slice(0, 200), videoPath, deepScan: !!opts?.deepScan },
        "media-downloader: ffprobe audio check failed",
      );
      return null;
    }
    return r.stdout.trim().includes("audio");
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), videoPath },
      "media-downloader: ffprobe audio check threw",
    );
    return null;
  }
}

// T370: bounded-retry wrapper for the live download paths. ffprobe
// returning `null` (probe blip / timeout) used to be treated as
// "trust the file" - that let silent-source videos slip into the
// cache when ffprobe just took too long. We now retry ONCE with a
// longer timeout + bigger probe window, and on the second `null`
// we treat it as `false` so the caller escalates to the next
// extractor strategy. Backfill keeps the bare `videoFileHasAudioTrack`
// (trust-on-null) since it's working against already-cached rows.
async function videoFileHasAudioTrackWithRetry(
  videoPath: string,
): Promise<boolean> {
  const first = await videoFileHasAudioTrack(videoPath);
  if (first === true) return true;
  if (first === false) return false;
  // Probe was indeterminate; retry once with deeper scan and a longer
  // kill timer before declaring the file silent.
  const second = await videoFileHasAudioTrack(videoPath, {
    timeoutMs: 25_000,
    deepScan: true,
  });
  if (second === true) return true;
  if (second === false) return false;
  logger.warn(
    { videoPath },
    "media-downloader: ffprobe audio check indeterminate after retry; treating as no-audio so caller can escalate",
  );
  return false;
}

// Buffer-input variant. Writes to a tempfile and runs the file-based
// probe; cleans up afterward. Used by the CDN download path which never
// persists the video to disk during normal operation.
//
// T370: returns a boolean (not boolean|null). Internally uses the
// retry wrapper so a probe blip doesn't silently let a no-audio video
// into the cache.
async function videoBufferHasAudioTrackWithRetry(
  buf: Buffer,
  ext: string,
): Promise<boolean> {
  let workdir: string | null = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), "audio-probe-"));
    const localPath = join(workdir, `media.${ext || "mp4"}`);
    await writeFile(localPath, buf);
    return await videoFileHasAudioTrackWithRetry(localPath);
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), ext },
      "media-downloader: buffer audio probe threw; treating as no-audio so caller can escalate",
    );
    return false;
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
  }
}

// Task #186: ffmpeg fallback. Reads the cached video file at `videoPath`
// and writes a JPEG poster from the first ~1 second so card grids render
// a real frame instead of a black <video preload="none"> tile. Bounded
// by a tight timeout so a corrupt video can't stall the worker.
async function generatePosterFromVideoFile(
  videoPath: string,
): Promise<{ buf: Buffer; ext: string; contentType: string } | null> {
  const outPath = `${videoPath}.poster.jpg`;
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "ffmpeg",
        [
          "-y",
          "-loglevel", "error",
          "-ss", "0.5",
          "-i", videoPath,
          "-frames:v", "1",
          "-q:v", "3",
          "-vf", "scale=720:-2:flags=fast_bilinear",
          outPath,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      const killTimer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 15_000);
      proc.once("close", (code) => {
        clearTimeout(killTimer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 200)}`));
      });
      proc.once("error", (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
    });
    const buf = await readFile(outPath);
    if (buf.length === 0) return null;
    return { buf, ext: "jpg", contentType: "image/jpeg" };
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), videoPath },
      "media-downloader: ffmpeg poster generation failed",
    );
    return null;
  } finally {
    try { await rm(outPath, { force: true }); } catch {}
  }
}

// Task #186: ffmpeg poster fallback that operates on an in-memory video
// buffer (used by `downloadMediaFromCdn` which never persists the video
// to disk). Writes the buffer to a tempfile, runs the file-based poster
// helper, and cleans up.
async function generatePosterFromVideoBuffer(
  buf: Buffer,
  ext: string,
): Promise<{ buf: Buffer; ext: string; contentType: string } | null> {
  let workdir: string | null = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), "poster-"));
    const inPath = join(workdir, `media.${ext || "mp4"}`);
    await writeFile(inPath, buf);
    return await generatePosterFromVideoFile(inPath);
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: ffmpeg poster (buffer) failed",
    );
    return null;
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
  }
}

interface DownloadResult {
  ok: boolean;
  kind?: "video" | "image";
  objectPath?: string;
  contentType?: string;
  bytes?: number;
  error?: string;
  // Task #158: when set, callers persist this as `meta.source` instead of
  // their hard-coded "yt-dlp" string. Used by the auth-wall escalation
  // wrapper to mark a row as having actually been served by the Apify
  // residential-proxy fallback so provider metrics attribute correctly.
  effectiveSource?: string;
  // Task #187: which authenticated cookie source the live extractor
  // consumed - "ig-db-jar" / "fb-db-jar" when the worker materialized
  // the admin-managed session, "env" when the legacy YT_DLP_COOKIES_FILE
  // env var was used, or omitted when the run was anonymous. Mirrored
  // into AdResearchBoardMediaMeta.cookieSource by persistResult so the
  // ytdlpAuthenticatedRecoveries dashboard counter has provenance.
  cookieSource?: "ig-db-jar" | "fb-db-jar" | "env" | null;
  // Task #186: cached poster image for video downloads. Persisted into
  // `media_thumbnail_*` columns by persistResult/persistMultiResult/
  // persistPartialResult so the Ads tab grid can render <img> over the
  // cached video instead of a black <video preload="none"> tile.
  thumbnailObjectPath?: string;
  thumbnailContentType?: string;
  thumbnailSource?: "extraction" | "local-poster";
  // Task #186: original platform thumbnail URL we attempted (extraction
  // path only). Persisted so the admin backfill can re-try extraction
  // even after a row was first cached with the local-poster fallback.
  thumbnailSourceUrl?: string | null;
}

// MediaUrls and CarouselInfo are imported above from
// `./media-downloader-helpers` and re-exported. Keeping them in the helpers
// module lets unit tests load the pure detectors without dragging the DB,
// object-storage, and Apify clients into scope.

// Result of resolving a post URL via Apify: the per-slide CDN URLs to fetch
// plus diagnostics about what the source claimed the post was. The
// downloader uses `carousel.expectedSlides` to decide whether a partial
// success counts as failure (carousel) or success (single image / video).
interface ResolvedSource {
  slides: MediaUrls[];
  carousel: CarouselInfo;
  source?: string | null;
}

// Minimal shape of the JSON input we send to Apify run-sync. Different
// actors take different fields, so this is a loose union of the keys we
// actually populate (IG primary uses `directUrls`, FB primary uses
// `startUrls`). Modeled explicitly to avoid `any` casts.
interface ApifyActorInput {
  directUrls?: string[];
  startUrls?: { url: string }[];
  resultsType?: string;
  resultsLimit?: number;
  addParentData?: boolean;
  proxyConfiguration?: {
    useApifyProxy: boolean;
    apifyProxyGroups?: string[];
    apifyProxySession?: string;
  };
}

// Task #137: tightened from 5min → 2min. A 5-minute hang silently held
// every row in the batch in mediaStatus='downloading' the entire time;
// 2 minutes is the longest a healthy actor pass should ever take for one
// chunk. AbortError on this signal now throws ApifyBatchTimeoutError so
// callers can fail every row in the chunk as `apify-batch-timeout`.
const APIFY_BATCH_TIMEOUT_MS = 2 * 60 * 1000;

async function apifyRunSyncBatch(
  actorPath: string,
  input: unknown,
  memoryMb = 2048,
  timeoutSeconds = 240,
): Promise<any[] | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    logger.warn({ actor: actorPath, strategy: "apify" }, "apify: APIFY_TOKEN not set");
    return null;
  }
  // Task #169: inject admin-managed Instagram session cookies into the
  // actor input when this run targets an IG actor. Loader is cached so
  // a sweep over many rows produces at most one log line per cache window.
  let finalInput: unknown = input;
  let igCookiesAttached = false;
  let igActorCall = false;
  let igMod: typeof import("./instagram-session-cookies") | null = null;
  try {
    igMod = await import("./instagram-session-cookies");
    if (igMod.isInstagramActor(actorPath)) {
      igActorCall = true;
      const before = (input ?? {}) as Record<string, unknown>;
      const after = await igMod.withInstagramSessionCookies(actorPath, before);
      finalInput = after;
      igCookiesAttached = (after as any)?.loginCookies !== undefined;
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), actor: actorPath },
      "apify: failed to attach IG session cookies; proceeding anonymously",
    );
  }
  // Task #178: same shape, FB. Mirrors the IG block: detect an FB
  // actor by path, inject the admin-managed cookies jar (cached), then
  // remember whether cookies were actually attached so an auth-blocked
  // response can mark the saved session expired.
  let fbCookiesAttached = false;
  let fbActorCall = false;
  let fbMod: typeof import("./facebook-cookies") | null = null;
  try {
    fbMod = await import("./facebook-cookies");
    if (fbMod.isFacebookActor(actorPath)) {
      fbActorCall = true;
      const before = (finalInput ?? {}) as Record<string, unknown>;
      const tracked = await fbMod.withFacebookSessionCookiesTracked(actorPath, before);
      finalInput = tracked.input;
      fbCookiesAttached = tracked.attached;
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), actor: actorPath },
      "apify: failed to attach FB session cookies; proceeding anonymously",
    );
  }
  const url =
    `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}` +
    `&timeout=${timeoutSeconds}` +
    `&memory=${memoryMb}`;
  // T210: per-host token-bucket pacing. IG / FB Apify actor calls are
  // gated through awaitPaceSlot so a burst of rows in one worker tick
  // never fires back-to-back against the same platform host. Defaults
  // are 1 IG call per ~10s and 1 FB call per ~6s; configurable via
  // T210_IG_MIN_INTERVAL_MS / T210_FB_MIN_INTERVAL_MS env vars.
  try {
    const { awaitPaceSlot } = await import("./per-host-pacing");
    await awaitPaceSlot(igActorCall ? "ig" : fbActorCall ? "fb" : null);
  } catch { /* best-effort */ }
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, APIFY_BATCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalInput),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn(
        {
          mediaError: "apify:",
          actor: actorPath,
          strategy: "apify",
          status: resp.status,
          body: body.slice(0, 200),
        },
        "apify: actor batch run failed",
      );
      // Task #181: never auto-expire the saved cookie jar on Apify
      // account quota / hard-limit failures - those come back as HTTP
      // 403 with a `platform-feature-disabled` body even though the
      // cookies are still valid. Note the quota signal so the
      // empty-dataset auto-expire branch below can defer too.
      const helpers = await import("./media-downloader-helpers");
      const isQuota = helpers.isApifyQuotaError(resp.status, body);
      if (isQuota) helpers.noteApifyQuotaSignal();
      // Task #169 / Task #194: if cookies were sent and Apify reports
      // an auth-shaped signal, route through the threshold-based
      // recordAuthSignal so a single transient failure no longer flips
      // the jar to expired. The classifier maps HTTP status + body to a
      // weighted IgAuthSignalKind; rate-limit signals carry zero weight.
      if (igActorCall && igCookiesAttached && igMod && !isQuota) {
        const kind = igMod.classifyIgAuthSignal(resp.status, body);
        if (kind) {
          await igMod
            .recordAuthSignal({
              kind,
              reason: `Apify HTTP ${resp.status}: ${body.slice(0, 120).toLowerCase()}`,
            })
            .catch(() => {});
        }
      }
      // Task #178: same auto-expire policy for FB.
      if (fbActorCall && fbCookiesAttached && fbMod && !isQuota) {
        const lower = body.toLowerCase();
        if (
          lower.includes("login required")
          || lower.includes("login_required")
          || lower.includes("checkpoint")
          || lower.includes("only available for registered")
          || lower.includes("session expired")
          || lower.includes("session_expired")
          || resp.status === 401
          || resp.status === 403
        ) {
          await fbMod.markFbSessionExpired(`Apify HTTP ${resp.status}: ${lower.slice(0, 120)}`).catch(() => {});
        }
      }
      return null;
    }
    const data = await resp.json();
    if (Array.isArray(data)) {
      // Task #181: defer empty-dataset auto-expire when a recent Apify
      // quota signal was observed - the empty result is far more
      // likely a quota side-effect than a real auth wall, and the
      // saved jar is still valid.
      const helpers2 = await import("./media-downloader-helpers");
      const recentQuota = helpers2.wasApifyQuotaRecent();
      // Task #169 / Task #194: empty IG dataset despite cookies CAN
      // mean an auth-block at the IG edge, but it is also a common
      // anti-bot/transient outcome. Record it as a low-weight
      // empty-payload signal; the threshold gate flips the jar only
      // after the signal recurs enough to cross the confidence bar.
      if (igActorCall && igCookiesAttached && igMod && data.length === 0 && !recentQuota) {
        await igMod
          .recordAuthSignal({
            kind: "empty-payload",
            reason: "Apify returned empty dataset for IG actor",
          })
          .catch(() => {});
      }
      // Task #194: a non-empty IG dataset proves the saved session is
      // still healthy right now. Clear the rolling signal history so
      // accumulated stale signals can't trip the threshold the next
      // time a single transient failure occurs.
      if (igActorCall && igCookiesAttached && igMod && data.length > 0) {
        await igMod.recordAuthSuccess().catch(() => {});
      }
      // Task #178 / T210: an empty FB actor dataset USED to be treated
      // as a confirmed auth wall and would auto-expire the FB jar.
      // T210 reclassifies this as a SOFT signal: empty payloads are
      // also produced by extractor staleness, post deletion, and
      // upstream Apify hiccups, so flipping the jar on this signal
      // alone was the dominant cause of healthy FB sessions getting
      // wrongly marked expired. Record an anomaly for dashboard
      // visibility but leave the jar status untouched. Hard auth
      // signals (login_required, checkpoint, 401/403) above still
      // flip the jar via the explicit branch.
      if (fbActorCall && fbCookiesAttached && fbMod && data.length === 0 && !recentQuota) {
        try {
          const { noteProbeAnomaly } = await import("./probe-anomaly-counter");
          noteProbeAnomaly("fb", "apify-empty-dataset");
        } catch { /* best-effort */ }
      }
      return data;
    }
    return null;
  } catch (err: any) {
    if (timedOut) {
      // Task #137: surface batch timeout as a typed error so callers can
      // fail every row in the chunk as `apify-batch-timeout` rather than
      // letting them sit in `downloading` forever.
      logger.warn(
        {
          mediaError: "apify:batch-timeout",
          actor: actorPath,
          strategy: "apify",
          timeoutMs: APIFY_BATCH_TIMEOUT_MS,
        },
        "apify: batch timed out",
      );
      throw new ApifyBatchTimeoutError(actorPath);
    }
    logger.warn(
      {
        mediaError: "apify:",
        actor: actorPath,
        strategy: "apify",
        err: err?.message || String(err),
      },
      "apify: batch request error",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Apify items don't always echo back the exact input URL, so we match by the
// canonical shortcode / video id embedded in the URL.
// Exported (T158) so the auth-health probe can look up its dry-run URL in
// the resolver's Map<urlIdentity, ResolvedSource> response.
export function urlIdentity(url: string): string | null {
  try {
    const u = new URL(url);
    if (isInstagramUrl(url)) {
      const m = u.pathname.match(/\/(?:p|reel|tv)\/([^/?#]+)/i);
      if (m) return `ig:${m[1].toLowerCase()}`;
    }
    if (isFacebookUrl(url)) {
      const path = u.pathname.toLowerCase();
      const reel = path.match(/\/reel\/(\d+)/);
      if (reel) return `fb:reel:${reel[1]}`;
      const share = path.match(/\/share\/(?:r|v|p)\/([^/?#]+)/);
      if (share) return `fb:share:${share[1]}`;
      const videos = path.match(/\/videos\/(\d+)/);
      if (videos) return `fb:videos:${videos[1]}`;
      const watchV = u.searchParams.get("v");
      if (watchV) return `fb:watch:${watchV}`;
      return `fb:url:${u.pathname}`;
    }
    return null;
  } catch {
    return null;
  }
}

function instagramShortcodeFromItem(item: any): string | null {
  if (!item || typeof item !== "object") return null;
  if (typeof item.shortCode === "string") return item.shortCode.toLowerCase();
  if (typeof item.shortcode === "string") return item.shortcode.toLowerCase();
  if (typeof item.url === "string") return urlIdentity(item.url)?.replace(/^ig:/, "") || null;
  if (typeof item.inputUrl === "string") return urlIdentity(item.inputUrl)?.replace(/^ig:/, "") || null;
  return null;
}

function facebookIdentityFromItem(item: any): string | null {
  if (!item || typeof item !== "object") return null;
  if (typeof item.url === "string") return urlIdentity(item.url);
  if (typeof item.inputUrl === "string") return urlIdentity(item.inputUrl);
  if (typeof item.postUrl === "string") return urlIdentity(item.postUrl);
  return null;
}

const INSTAGRAM_PRIMARY_ACTOR = "apify~instagram-scraper";
const INSTAGRAM_SECONDARY_ACTOR = "apify~instagram-post-scraper";

// Task #158: Apify-first authenticated extraction. Per-provider counters
// the worker increments as media is processed; recordQueueMetricsSnapshot
// reads the cumulative-since-last-snapshot deltas, persists them to the
// queue_metrics table, and resets to zero. The admin dashboard reads the
// running counters via getQueueHealth so operators see this-interval
// activity (apify_success vs ytdlp_success vs escalation recovery)
// without waiting for the next 5-min snapshot to land.
interface ProviderCounters {
  apifySuccess: number;
  ytdlpSuccess: number;
  escalationCount: number;
  escalationRecovered: number;
  // Task #187: yt-dlp successes that consumed an authenticated cookie
  // jar (IG admin session, FB admin session, or env cookies file).
  // Drained into queue_metrics.ytdlpAuthRecoveries each interval and
  // surfaced on the dashboard as ytDlpAuthenticatedRecoveries.
  ytdlpAuthRecoveries: number;
  // Task #189: adaptive IG rate-limit protection. `igRateLimitHits` is
  // bumped once per row that lands in `ig-rate-limited` so the snapshot
  // row reports per-interval 429 volume rather than relying on the
  // rolling 24h DB scan. `igCooldownsTriggered` is bumped once per
  // pre-batch cooldown sleep so the dashboard can plot how often the
  // throttle gate actually fired.
  igRateLimitHits: number;
  igCooldownsTriggered: number;
  // Task #209: IG cookie continuity counters. Drained per snapshot so
  // the dashboard can show whether the admin-managed IG session is
  // (a) materializing into a temp cookie file at all
  // (igCookieMaterializeSuccess / Fail) and (b) actually being passed
  // to yt-dlp as `--cookies <readable file>`
  // (igCookieAttachSuccess / Fail). A spike in either Fail counter
  // is the canonical operator signal that the IG jar has rotted /
  // expired / mis-decrypted, BEFORE the auth-wall escalation wave
  // shows up in apifyEscalationRecoveries.
  igCookieMaterializeSuccess: number;
  igCookieMaterializeFail: number;
  igCookieAttachSuccess: number;
  igCookieAttachFail: number;
  // Task #197: production-hardening recovery counters. Per-snapshot
  // deltas surfaced on the dashboard's Recovery Pipeline panel so an
  // operator can see triage decisions in real time. All increment in
  // `persistResult`'s failure branch (single source of truth) or in
  // the queue's pre-claim filter (`invalidUrlsBlocked`).
  invalidUrlsBlocked: number;
  deadContentDismissed: number;
  delayedRetriesScheduled: number;
  temporaryRecoveries: number;
  authRecoveries: number;
  extractorRecoveries: number;
  // Recovery latency: cumulative ms from first failure to first ok
  // outcome. We track sum + sample count so the snapshot can compute
  // an interval average. Each successful row that previously failed
  // contributes its (downloadedAt - mediaStartedAt) span.
  recoveryLatencyMsSum: number;
  recoveryLatencySamples: number;
  // Per-actor success counters. Keyed by raw `meta.source` string so
  // the dashboard can show which actor in the multi-actor escalation
  // pool is actually carrying the load.
  perActorSuccess: Record<string, number>;
}
const providerCounters: ProviderCounters = {
  apifySuccess: 0,
  ytdlpSuccess: 0,
  escalationCount: 0,
  escalationRecovered: 0,
  ytdlpAuthRecoveries: 0,
  igRateLimitHits: 0,
  igCooldownsTriggered: 0,
  igCookieMaterializeSuccess: 0,
  igCookieMaterializeFail: 0,
  igCookieAttachSuccess: 0,
  igCookieAttachFail: 0,
  invalidUrlsBlocked: 0,
  deadContentDismissed: 0,
  delayedRetriesScheduled: 0,
  temporaryRecoveries: 0,
  authRecoveries: 0,
  extractorRecoveries: 0,
  recoveryLatencyMsSum: 0,
  recoveryLatencySamples: 0,
  perActorSuccess: {},
};
export function getProviderCountersSnapshot(): ProviderCounters {
  return { ...providerCounters, perActorSuccess: { ...providerCounters.perActorSuccess } };
}
// Task #237: zero every in-memory provider aggregate without tearing
// down the worker. Called by the worker when it observes a pending
// reset signal in the control table (after an admin invokes the
// queue-health reset endpoint). Mirrors `snapshotAndResetProviderCounters`
// but does not return the prior snapshot - the caller has already
// committed to discarding it.
export function resetProviderCounters(): void {
  providerCounters.apifySuccess = 0;
  providerCounters.ytdlpSuccess = 0;
  providerCounters.escalationCount = 0;
  providerCounters.escalationRecovered = 0;
  providerCounters.ytdlpAuthRecoveries = 0;
  providerCounters.igRateLimitHits = 0;
  providerCounters.igCooldownsTriggered = 0;
  providerCounters.igCookieMaterializeSuccess = 0;
  providerCounters.igCookieMaterializeFail = 0;
  providerCounters.igCookieAttachSuccess = 0;
  providerCounters.igCookieAttachFail = 0;
  providerCounters.invalidUrlsBlocked = 0;
  providerCounters.deadContentDismissed = 0;
  providerCounters.delayedRetriesScheduled = 0;
  providerCounters.temporaryRecoveries = 0;
  providerCounters.authRecoveries = 0;
  providerCounters.extractorRecoveries = 0;
  providerCounters.recoveryLatencyMsSum = 0;
  providerCounters.recoveryLatencySamples = 0;
  providerCounters.perActorSuccess = {};
}
function snapshotAndResetProviderCounters(): ProviderCounters {
  const snap = { ...providerCounters, perActorSuccess: { ...providerCounters.perActorSuccess } };
  providerCounters.apifySuccess = 0;
  providerCounters.ytdlpSuccess = 0;
  providerCounters.escalationCount = 0;
  providerCounters.escalationRecovered = 0;
  providerCounters.ytdlpAuthRecoveries = 0;
  providerCounters.igRateLimitHits = 0;
  providerCounters.igCooldownsTriggered = 0;
  providerCounters.igCookieMaterializeSuccess = 0;
  providerCounters.igCookieMaterializeFail = 0;
  providerCounters.igCookieAttachSuccess = 0;
  providerCounters.igCookieAttachFail = 0;
  providerCounters.invalidUrlsBlocked = 0;
  providerCounters.deadContentDismissed = 0;
  providerCounters.delayedRetriesScheduled = 0;
  providerCounters.temporaryRecoveries = 0;
  providerCounters.authRecoveries = 0;
  providerCounters.extractorRecoveries = 0;
  providerCounters.recoveryLatencyMsSum = 0;
  providerCounters.recoveryLatencySamples = 0;
  providerCounters.perActorSuccess = {};
  return snap;
}

// Task #229 follow-up: best-effort fan-out of provider-counter increments
// into the latest running ad-research sync_session row so the LIVE
// dashboard reflects real extraction activity (not just sheet ingest).
// All extraction work in this file targets adResearchBoardItems, so the
// board is hard-coded. The sync-session helper itself is a no-op when no
// running session exists (between syncs), and swallows DB errors.
function bumpAdResearchLiveSession(delta: {
  successfulExtractions?: number;
  authFailures?: number;
  retries?: number;
  escalations?: number;
  recoveries?: number;
  invalidUrls?: number;
  deadContent?: number;
}): void {
  void import("./sync-session")
    .then((m) => m.incrementLatestRunningSessionCounters("ad-research", delta))
    .catch(() => {
      /* swallow: live counters are best-effort */
    });
}
// T159: Pure source-string classifier so the per-provider counters can
// be regression-tested without spinning up the worker. Every persist
// call site MUST pass a `meta.source` that maps to one of these
// buckets; unknown / generic strings fall through to "fallback" and
// are logged at warn so a future call site that drops attribution
// gets caught immediately rather than silently inflating apifySuccess.
//
// Source-string contract:
//   "apify-escalation"               -> apify-escalation (apifySuccess + escalationRecovered)
//   contains "yt-dlp" / "ytdlp"      -> ytdlp           (ytdlpSuccess)
//   contains "apify" / known actors  -> apify           (apifySuccess)
//   "direct" / "cdn-direct" /
//     "share-resolver"               -> apify           (primary-path direct CDN hit)
//   anything else (incl. "", null)   -> fallback        (warn, no counter bump)
export type PersistSourceBucket =
  | "apify"
  | "apify-escalation"
  | "ytdlp"
  | "fallback";
const APIFY_KNOWN_PREFIXES = ["apify~", "presetshubham~"];
const APIFY_PRIMARY_PATH_ALIASES = new Set(["direct", "cdn-direct", "share-resolver"]);
export function classifyPersistSource(source: string | null | undefined): PersistSourceBucket {
  const s = (source || "").toLowerCase().trim();
  if (!s) return "fallback";
  if (s.includes("apify-escalation")) return "apify-escalation";
  if (s.includes("yt-dlp") || s.includes("ytdlp")) return "ytdlp";
  if (s.includes("apify")) return "apify";
  if (APIFY_KNOWN_PREFIXES.some((p) => s.startsWith(p))) return "apify";
  if (APIFY_PRIMARY_PATH_ALIASES.has(s)) return "apify";
  return "fallback";
}
// Centralized success bookkeeping, called by every persist path. This
// is the SINGLE source of truth for apifySuccess / ytdlpSuccess /
// escalationRecovered — the escalation wrapper only bumps the
// `escalationCount` attempt counter and does NOT touch success counters
// itself, so this function never double-counts.
function recordPersistSuccess(meta?: AdResearchBoardMediaMeta | null): void {
  const raw = meta?.source ?? null;
  const bucket = classifyPersistSource(raw);
  // Task #197: per-actor success counter. Trims the source string to a
  // bounded label so a misbehaving actor that returns a long prose
  // string in `meta.source` cannot blow up the per-actor map.
  if (raw) {
    const key = raw.toLowerCase().slice(0, 80);
    providerCounters.perActorSuccess[key] = (providerCounters.perActorSuccess[key] || 0) + 1;
  }
  // Task #187: per-row authenticated-recovery counter. Bumps once per
  // ytdlp success that consumed a non-null cookie source so the
  // dashboard can show how many rows the auth-extraction continuity
  // path actually saved this interval.
  const cookieSource = meta?.cookieSource ?? null;
  switch (bucket) {
    case "apify-escalation":
      providerCounters.apifySuccess += 1;
      providerCounters.escalationRecovered += 1;
      bumpAdResearchLiveSession({ successfulExtractions: 1 });
      return;
    case "ytdlp":
      providerCounters.ytdlpSuccess += 1;
      if (cookieSource) providerCounters.ytdlpAuthRecoveries += 1;
      bumpAdResearchLiveSession({ successfulExtractions: 1 });
      return;
    case "apify":
      providerCounters.apifySuccess += 1;
      bumpAdResearchLiveSession({ successfulExtractions: 1 });
      return;
    case "fallback":
      // T159: drop a warn breadcrumb rather than silently bumping any
      // counter. The Provider Mix strip stays honest, and any future
      // persist call site that hard-codes a source string the
      // classifier doesn't recognise (the exact regression class T158
      // shipped with) shows up in logs immediately.
      logger.warn(
        { mediaError: "persist:source-unclassified", source: raw },
        "media-downloader: persist source string did not map to a provider counter (see classifyPersistSource)",
      );
      return;
  }
}

// Task #158: classes that warrant an Apify residential-proxy escalation
// when yt-dlp fails. cookie-expired is included because the cookies-based
// fallback used to recover those is now gone - Apify (which carries an
// authenticated session server-side) is the only remaining auth-bypass.
// Generic "auth" is included so any login/auth-required signal that
// classifyError didn't bucket into a platform-specific class still gets
// one escalation chance before terminal failure.
const AUTH_WALL_CLASSES_FOR_ESCALATION = new Set([
  "ig-login-required",
  "fb-auth-wall",
  "ig-rate-limited",
  "cookie-expired",
  "auth",
  // Task #209: hard-fail emitted when an IG URL would have been invoked
  // anonymously by yt-dlp. Treated as an auth-wall class so the existing
  // escalation wrapper routes the row straight to Apify residential
  // proxy (the only remaining auth-bypass) instead of burning a yt-dlp
  // call against a guaranteed login wall.
  "auth-misconfigured",
]);
function isAuthWallEscalateable(klass: string): boolean {
  return AUTH_WALL_CLASSES_FOR_ESCALATION.has(klass);
}
// Task #196: extractor-stale (no video formats found / unable to extract
// data) also triggers the residential-proxy Apify escalation chain.
// Kept distinct from auth-wall classes so the dashboard counters can
// attribute the recovery to "extractor drift" vs "session blocked".
function isExtractorStaleEscalateable(klass: string): boolean {
  return EXTRACTOR_STALE_CLASSES_FOR_ESCALATION.has(klass);
}

// Task #158: run the Apify primary resolver for the URL through a
// residential-proxy session and return the first slide as a downloaded
// CDN result. Used as the escalation step when yt-dlp returns an
// auth-wall error class. Does not handle carousels by design — the
// escalation path exists to recover single-item rows that yt-dlp could
// not pull; carousel rows already exhaust Apify before yt-dlp is ever
// invoked. Returns a ok-shaped DownloadResult on success or a failure
// with the apify-side error string for the auth-wall-escalated-failed
// classifier to wrap.
// T159: exported so auth-health-probe can include the escalation
// pathway in its three-stage check (reachability + extraction +
// escalation). The probe wraps a single, low-cost run; production
// callers still go through runYtDlpWithAuthWallEscalation which owns
// the escalation attempt counter.
export async function escalateAuthWallToApify(
  url: string,
  ctx: { rowKey?: string | null; adLink?: string | null; strategy: string },
): Promise<DownloadResult> {
  // Task #190: canonicalize before the residential-proxy apify run so the
  // escalation actor sees the canonical reel/post URL and the auth-health
  // probe pathway gets identical normalization.
  url = normalizeAndLog(url, ctx);
  const platform = isInstagramUrl(url) ? "ig" : isFacebookUrl(url) ? "fb" : null;
  if (!platform) {
    return { ok: false, error: "auth-wall-escalation: non-ig/fb URL has no apify path" };
  }
  // Task #209: structured trace at the IG escalation entry. Lets an
  // operator follow a row through resolve -> materialize -> attach ->
  // escalate using a single grep on `ig-extract-attach`. Apify
  // residential-proxy authentication is server-side (Apify's session
  // pool, not our cookie jar), so `authenticated=true`,
  // `cookieSource="apify-residential"`, and `cookieFlagPresent=false`
  // (no cookie file is passed - residential session is the auth).
  if (platform === "ig") {
    logger.info(
      {
        event: "ig-extract-attach",
        phase: "escalate",
        url,
        normalizedUrl: url,
        path: null,
        cookieSource: "apify-residential",
        cookieFlagPresent: false,
        cookieFileReadable: false,
        authenticated: true,
        strategy: ctx.strategy,
        rowKey: ctx.rowKey,
        adLink: ctx.adLink,
      },
      "ig-extract-attach: escalating IG to Apify residential",
    );
  }
  logger.warn(
    {
      mediaError: "auth-wall-escalation",
      url,
      platform,
      strategy: ctx.strategy,
      rowKey: ctx.rowKey,
      adLink: ctx.adLink,
    },
    "media-downloader: escalating auth-wall to Apify residential proxy",
  );
  // Task #191: multi-stage escalation. Each stage runs a distinct
  // actor/strategy/proxy-session combination so the row gets several
  // independent recovery chances before we give up. Stage results are
  // classified into the EscalationFailureReason buckets so the final
  // error string and the structured logs name exactly which mode each
  // attempt failed in (empty-dataset, timeout, unsupported-url,
  // no-media, auth-rejected, actor-error). A unique session id per
  // stage forces Apify to allocate a fresh residential exit IP so a
  // sticky-IP block on stage 1 cannot poison stage 2 or 3.
  const sessionRoot = `escalate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const stages: EscalationStageDef[] = platform === "ig"
    ? [
        { name: "ig-primary-residential", run: () => runIgEscalationPrimary(url, `${sessionRoot}-1`, 4096) },
        { name: "ig-secondary-actor",     run: () => runIgEscalationSecondary(url, `${sessionRoot}-2`) },
        { name: "ig-primary-rotated",     run: () => runIgEscalationPrimary(url, `${sessionRoot}-3`, 8192) },
      ]
    : [
        { name: "fb-primary-residential", run: () => runFbEscalationPrimary(url, `${sessionRoot}-1`, 4096) },
        { name: "fb-primary-rotated",     run: () => runFbEscalationPrimary(url, `${sessionRoot}-2`, 8192) },
        { name: "fb-primary-fresh",       run: () => runFbEscalationPrimary(url, `${sessionRoot}-3`, 4096) },
      ];
  const attempts: { stage: string; reason: EscalationFailureReason; detail?: string }[] = [];
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];
    const outcome = await runEscalationStage(stage.name, stage.run, ctx);
    if (outcome.ok) {
      if (i > 0) {
        logger.info(
          {
            event: "escalation-fallback-recovered",
            stage: stage.name,
            stageIndex: i + 1,
            previousAttempts: attempts,
            url,
            platform,
            rowKey: ctx.rowKey,
            adLink: ctx.adLink,
          },
          "media-downloader: auth-wall escalation recovered via fallback stage",
        );
      }
      return outcome.result;
    }
    attempts.push({
      stage: stage.name,
      reason: outcome.reason,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    });
    logger.warn(
      {
        event: "escalation-stage-failed",
        stage: stage.name,
        stageIndex: i + 1,
        reason: outcome.reason,
        detail: outcome.detail,
        actor: outcome.actor,
        url,
        platform,
        rowKey: ctx.rowKey,
        adLink: ctx.adLink,
      },
      "media-downloader: escalation stage failed",
    );
    // Task #191: short-circuit on unsupported-url - rotating actor or
    // session won't fix a structurally invalid URL; downstream stages
    // would just burn quota for the same answer.
    if (outcome.reason === "unsupported-url") break;
  }
  // Surface every stage's classification so the persisted error string
  // tells the operator exactly which fallback tier still failed.
  const summary = attempts.map((a) => `${a.stage}=${a.reason}`).join(" | ");
  return { ok: false, error: `auth-wall-escalation: ${summary}` };
}

// Task #191: per-stage escalation runner. Wraps a stage callable that
// returns either a ResolvedSource + raw items, then validates the
// result before declaring success. Validation is what turns "actor
// returned a row" into "actor returned a row WITH a downloadable media
// URL" - the previous escalation classified empty-media slides as a
// generic failure; now they're tagged "no-media" so the dashboard
// distinguishes them from "empty-dataset" (actor ran but found
// nothing) and "auth-rejected" (login wall hit even with residential).
interface EscalationStageDef {
  name: string;
  run: () => Promise<EscalationStageRunOutput>;
}
interface EscalationStageRunOutput {
  actor: string;
  items: any[] | null;
  resolved: ResolvedSource | null;
}
type EscalationStageOutcome =
  | { ok: true; stage: string; actor: string; result: DownloadResult }
  | { ok: false; stage: string; actor: string; reason: EscalationFailureReason; detail?: string };

async function runEscalationStage(
  stage: string,
  run: () => Promise<EscalationStageRunOutput>,
  ctx: { rowKey?: string | null; adLink?: string | null; strategy: string },
): Promise<EscalationStageOutcome> {
  let actorTag = "unknown";
  try {
    const { actor, items, resolved } = await run();
    actorTag = actor;
    // Result validation: actor may have returned items but no usable
    // media URL. Treat as no-media so the next stage runs.
    if (resolved && resolved.slides.length) {
      const first = resolved.slides[0];
      // When the URL is a known video kind (reel/video) but Apify only
      // returned imageUrl (typically the post thumbnail), refuse to cache
      // the still as the row's media. Treat as no-media so the next stage
      // (or yt-dlp) gets a chance to fetch the actual video.
      const wantsVideo = urlKindIsVideo(ctx.adLink);
      const target = first.videoUrl || (wantsVideo ? null : first.imageUrl);
      if (target) {
        const dl = await downloadMediaFromCdn(
          target,
          first.videoUrl ? "video" : "image",
          { thumbnailUrl: first.thumbnailUrl ?? null },
        );
        if (dl.ok) return { ok: true, stage, actor, result: dl };
        return {
          ok: false,
          stage,
          actor,
          reason: "no-media",
          detail: `cdn-download-failed: ${(dl.error || "").slice(0, 100)}`,
        };
      }
      if (wantsVideo && !first.videoUrl && first.imageUrl) {
        return {
          ok: false,
          stage,
          actor,
          reason: "no-media",
          detail: "video-url-resolved-image-only",
        };
      }
    }
    const reason = _classifyApifyEscalationItems(items);
    return { ok: false, stage, actor, reason };
  } catch (err: any) {
    if (err instanceof ApifyBatchTimeoutError) {
      return {
        ok: false,
        stage,
        actor: err.actor || actorTag,
        reason: "timeout",
        detail: (err.message || "").slice(0, 120),
      };
    }
    return {
      ok: false,
      stage,
      actor: actorTag,
      reason: "actor-error",
      detail: (err?.message || String(err)).slice(0, 120),
    };
  }
}

// Task #191: stage 1 + stage 3 IG runner. Calls the primary IG actor
// directly (instead of going through batchResolveInstagram) so the
// caller can inspect raw items for classification and inject a
// per-stage proxy session id for fresh-IP rotation.
async function runIgEscalationPrimary(
  url: string,
  sessionId: string,
  memoryMb: number,
): Promise<EscalationStageRunOutput> {
  const input: ApifyActorInput = {
    directUrls: [url],
    resultsType: "details",
    resultsLimit: 1,
    addParentData: false,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
      apifyProxySession: sessionId,
    },
  };
  const items = await apifyRunSyncBatch(INSTAGRAM_PRIMARY_ACTOR, input, memoryMb, 180);
  if (!items || !items.length) {
    return { actor: INSTAGRAM_PRIMARY_ACTOR, items, resolved: null };
  }
  for (const item of items) {
    const list = pickInstagramMediaList(item);
    if (list.length) {
      return {
        actor: INSTAGRAM_PRIMARY_ACTOR,
        items,
        resolved: { slides: list, carousel: detectInstagramCarousel(item), source: `${INSTAGRAM_PRIMARY_ACTOR}@residential` },
      };
    }
  }
  return { actor: INSTAGRAM_PRIMARY_ACTOR, items, resolved: null };
}

// Task #191: stage 2 IG runner. Tries a different actor family. We
// pick `apify~instagram-post-scraper` for posts and the dedicated reel
// downloader for reels; the actor that's a structural mismatch for the
// URL would just return empty, so we route by URL shape.
async function runIgEscalationSecondary(
  url: string,
  sessionId: string,
): Promise<EscalationStageRunOutput> {
  const isReel = /\/reel\//i.test(url);
  if (isReel) {
    const reelActor = "presetshubham~instagram-reel-downloader";
    // Task #195: actor input contract change. Live verification on
    // 2026-05-11 showed the actor now rejects {urls,startUrls,url} with
    // HTTP 400 invalid-input "Field input.reelLinks is required". Send
    // the canonical {reelLinks:[url]} shape so the escalation stage 2
    // path can actually invoke the actor.
    const payload = {
      reelLinks: [url],
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxySession: sessionId,
      },
    };
    logger.info(
      {
        event: "ig-escalation-secondary-invoke",
        actor: reelActor,
        url,
        sessionId,
        payloadShape: Object.keys(payload),
        reelLinksCount: payload.reelLinks.length,
      },
      "media-downloader: invoking ig-secondary-actor (presetshubham reel-downloader)",
    );
    const items = await apifyRunSyncBatch(reelActor, payload, 1024, 120);
    if (!items || !items.length) {
      logger.warn(
        {
          event: "ig-escalation-secondary-empty",
          actor: reelActor,
          url,
          itemCount: 0,
        },
        "media-downloader: ig-secondary-actor returned no items",
      );
      return { actor: reelActor, items, resolved: null };
    }
    // tryInstagramReelDownloader's parser expects to walk each item;
    // we delegate by re-running its picker logic inline so we keep
    // raw items for classification.
    const slides = await extractReelDownloaderSlides(items);
    logger.info(
      {
        event: "ig-escalation-secondary-result",
        actor: reelActor,
        url,
        itemCount: items.length,
        slideCount: slides.length,
        ok: slides.length > 0,
      },
      "media-downloader: ig-secondary-actor extraction result",
    );
    if (slides.length) {
      return {
        actor: reelActor,
        items,
        resolved: { slides, carousel: { isCarousel: false, expectedSlides: slides.length }, source: reelActor },
      };
    }
    return { actor: reelActor, items, resolved: null };
  }
  const items = await apifyRunSyncBatch(
    INSTAGRAM_SECONDARY_ACTOR,
    {
      directUrls: [url],
      startUrls: [{ url }],
      urls: [url],
      resultsLimit: 1,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxySession: sessionId,
      },
    },
    2048,
    180,
  );
  if (!items || !items.length) return { actor: INSTAGRAM_SECONDARY_ACTOR, items, resolved: null };
  for (const item of items) {
    const list = pickInstagramMediaList(item);
    if (list.length) {
      return {
        actor: INSTAGRAM_SECONDARY_ACTOR,
        items,
        resolved: { slides: list, carousel: detectInstagramCarousel(item), source: INSTAGRAM_SECONDARY_ACTOR },
      };
    }
  }
  return { actor: INSTAGRAM_SECONDARY_ACTOR, items, resolved: null };
}

// Task #191: minimal extractor for the reel downloader actor's output
// shape (mirrors tryInstagramReelDownloader's picker, without its
// dual-shape input retry). Kept local so the stage runner has full
// visibility into the raw items array for classification.
async function extractReelDownloaderSlides(items: any[]): Promise<MediaUrls[]> {
  const out: MediaUrls[] = [];
  const seen = new Set<string>();
  const pickStr = (v: any): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  const push = (m: MediaUrls) => {
    const key = (m.videoUrl || m.imageUrl || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item: any = raw;
    const videoUrl =
      pickStr(item.videoUrl) ||
      pickStr(item.video_url) ||
      pickStr(item.video) ||
      pickStr(item.downloadUrl) ||
      pickStr(item.download_url) ||
      pickStr(item.mediaUrl) ||
      pickStr(item.media_url) ||
      pickStr(item.url && item.type === "video" ? item.url : null);
    const imageUrl =
      pickStr(item.thumbnail) ||
      pickStr(item.thumbnailUrl) ||
      pickStr(item.thumbnail_url) ||
      pickStr(item.imageUrl) ||
      pickStr(item.image_url) ||
      pickStr(item.displayUrl) ||
      pickStr(item.coverUrl) ||
      null;
    if (videoUrl || imageUrl) push({ videoUrl, imageUrl });
  }
  return out;
}

// Task #191: FB stages. FB has no widely-deployed alternate actor in
// our pipeline, so the three stages all run the primary actor with
// distinct proxy sessions and (on stage 2) a memory bump. Distinct
// session ids force a new residential exit IP each stage so a
// sticky-IP wall on stage 1 cannot poison stages 2 or 3. URL is also
// pre-resolved through resolveFacebookShareUrl so /share/ links land
// on the canonical /reel or /posts variant before the actor sees it.
async function runFbEscalationPrimary(
  url: string,
  sessionId: string,
  memoryMb: number,
): Promise<EscalationStageRunOutput> {
  const resolved = (await resolveFacebookShareUrl(url, { adLink: url, strategy: "fb-escalation-prefetch" })) ?? url;
  const input: ApifyActorInput = {
    startUrls: [{ url: resolved }],
    resultsLimit: 1,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
      apifyProxySession: sessionId,
    },
  };
  const items = await apifyRunSyncBatch(FACEBOOK_PRIMARY_ACTOR, input, memoryMb, 180);
  if (!items || !items.length) {
    return { actor: FACEBOOK_PRIMARY_ACTOR, items, resolved: null };
  }
  for (const item of items) {
    const list = pickFacebookMediaList(item);
    if (list.length) {
      return {
        actor: FACEBOOK_PRIMARY_ACTOR,
        items,
        resolved: { slides: list, carousel: detectFacebookCarousel(item), source: `${FACEBOOK_PRIMARY_ACTOR}@residential` },
      };
    }
  }
  return { actor: FACEBOOK_PRIMARY_ACTOR, items, resolved: null };
}

// Task #158: yt-dlp wrapper that escalates auth-wall failures to Apify.
// Single shared call site so every yt-dlp invocation gets identical
// observability + escalation behaviour. Returns a DownloadResult whose
// ok-branch may have come from EITHER yt-dlp or the Apify escalation;
// the success counters are updated correctly either way.
async function runYtDlpWithAuthWallEscalation(
  url: string,
  ctx: { rowKey?: string | null; adLink?: string | null; strategy: string },
): Promise<DownloadResult> {
  // Task #190: canonicalize before yt-dlp + escalation so the binary and
  // the apify fallback both see the same canonical URL (no igsh/fbclid,
  // no /reels/ vs /reel/ split, no host aliases).
  url = normalizeAndLog(url, ctx);
  // NOTE: counter bookkeeping for success cases lives in
  // recordPersistSuccess (single source of truth, classifies on the
  // meta.source string that actually gets persisted). This wrapper only
  // owns the escalation ATTEMPT counter and tags successful escalations
  // with effectiveSource="apify-escalation" so the persist path can
  // route them away from the call site's hard-coded "yt-dlp" source.
  const yt = await runYtDlpDownload(url, ctx);
  if (yt.ok) return yt;
  const klass = classifyError(yt.error);
  // Task #196: trigger escalation for both auth-wall classes AND
  // extractor-stale classes (no video formats found / unable to extract).
  // The residential-proxy Apify actor recovers both pathways.
  const isAuthEscalation = isAuthWallEscalateable(klass);
  const isStaleEscalation = !isAuthEscalation && isExtractorStaleEscalateable(klass);
  // T370: a yt-dlp result of `no-audio-track` (audio gate rejected the
  // merged file) is now an escalation trigger - the residential Apify
  // actor sometimes resolves a different rendition that does carry an
  // audio stream. If that fails too, we tag the final error as
  // `silent-source` so persistResult can mark the row terminally
  // silent (visible to admins/users with a badge, not retried).
  const isSilentEscalation = !isAuthEscalation && !isStaleEscalation && klass === "no-audio-track";
  if (!isAuthEscalation && !isStaleEscalation && !isSilentEscalation) return yt;
  providerCounters.escalationCount += 1;
  bumpAdResearchLiveSession({ escalations: 1 });
  const escalated = await escalateAuthWallToApify(url, ctx);
  if (escalated.ok) {
    logger.info(
      {
        url,
        originalClass: klass,
        strategy: ctx.strategy,
        rowKey: ctx.rowKey,
        trigger: isAuthEscalation ? "auth-wall" : isStaleEscalation ? "extractor-stale" : "no-audio-track",
      },
      "media-downloader: yt-dlp escalation recovered via Apify",
    );
    return { ...escalated, effectiveSource: "apify-escalation" };
  }
  // T370: silent-source termination is intentionally narrow. We only
  // tag the row as `silent-source` when BOTH yt-dlp AND the residential
  // Apify escalation explicitly returned `no-audio-track`. A network /
  // auth / extractor failure on the Apify leg is NOT proof of silence -
  // those rows fall through to the standard escalated-failed path so
  // the retry ladder gets a chance to recover them.
  const escalatedKlass = classifyError(escalated.error);
  if (isSilentEscalation && escalatedKlass === "no-audio-track") {
    return {
      ok: false,
      error: `silent-source: yt-dlp[no-audio-track] + apify[no-audio-track]: ${(escalated.error || "").slice(0, 240)}`,
    };
  }
  // Both providers failed - mark with the dedicated terminal class so
  // the dashboard can distinguish "yt-dlp blocked, recovered" from
  // "both blocked, investigate". The auth-wall-escalated-failed prefix
  // is preserved for both trigger types so existing classifier branches
  // and dashboard counters keep working.
  return {
    ok: false,
    error: `auth-wall-escalated-failed: yt-dlp[${klass}]: ${(yt.error || "").slice(0, 160)} | apify: ${(escalated.error || "").slice(0, 240)}`,
  };
}

export async function batchResolveInstagram(
  urls: string[],
  opts?: { residentialProxy?: boolean; memoryMb?: number },
): Promise<Map<string, ResolvedSource>> {
  const out = new Map<string, ResolvedSource>();
  if (urls.length === 0) return out;
  // Task #209: structured trace on the Apify-only IG batch path. No
  // cookie file is passed - the actor authenticates server-side via
  // its own session pool (residential proxy when opts.residentialProxy
  // is set). Emitted once per batch with the URL list size so an
  // operator can correlate `apify-call` lines with the materialize /
  // attach lines that fired earlier in the worker tick for the same
  // rowKeys.
  for (const u of urls) {
    logger.info(
      {
        event: "ig-extract-attach",
        phase: "apify-call",
        actor: INSTAGRAM_PRIMARY_ACTOR,
        url: u,
        normalizedUrl: u,
        path: null,
        cookieSource: opts?.residentialProxy ? "apify-residential" : "apify-default",
        cookieFlagPresent: false,
        cookieFileReadable: false,
        authenticated: true,
        strategy: opts?.residentialProxy ? "ig-batch-residential" : "ig-batch",
        batchSize: urls.length,
      },
      "ig-extract-attach: ig batch apify call",
    );
  }
  // Task #190: canonicalize every URL before the Apify actor sees it.
  // igsh / utm tokens cause IG actor mismatches, /reels/<id> vs
  // /reel/<id> produces empty result rows, and instagr.am isn't
  // accepted at all by the Apify scraper. Idempotent.
  urls = urls.map((u) =>
    normalizeAndLog(u, { strategy: opts?.residentialProxy ? "ig-batch-residential" : "ig-batch", adLink: u }),
  );
  const input: ApifyActorInput = {
    directUrls: urls,
    resultsType: "details",
    resultsLimit: urls.length,
    addParentData: false,
  };
  if (opts?.residentialProxy) {
    input.proxyConfiguration = {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    };
  }
  const items = await apifyRunSyncBatch(
    INSTAGRAM_PRIMARY_ACTOR,
    input,
    opts?.memoryMb ?? 2048,
    Math.min(540, 60 + urls.length * 10),
  );
  if (!items) return out;
  for (const item of items) {
    const sc = instagramShortcodeFromItem(item);
    if (!sc) continue;
    const list = pickInstagramMediaList(item);
    const carousel = detectInstagramCarousel(item);
    out.set(`ig:${sc}`, { slides: list, carousel, source: INSTAGRAM_PRIMARY_ACTOR });
  }
  return out;
}

// Stronger retry for Instagram carousels that came back short (only the
// cover slide, or fewer slides than the post claims). We re-run the same
// actor with a residential proxy and more memory; this commonly recovers
// the full childPosts list when the IG edge filtered the first request.
async function retryInstagramCarousel(
  url: string,
  rowKey: string,
  expected: number,
): Promise<ResolvedSource | null> {
  logger.info(
    { rowKey, url, expected, retryStrategy: "residential-proxy" },
    "media-downloader: retrying carousel via residential proxy",
  );
  const map = await batchResolveInstagram([url], {
    residentialProxy: true,
    memoryMb: 4096,
  });
  const id = urlIdentity(url);
  const got = id ? map.get(id) : undefined;
  if (got) {
    return { ...got, source: `${INSTAGRAM_PRIMARY_ACTOR}@residential` };
  }
  return null;
}

// Last-chance retry for Instagram carousels: hand the URL to a different
// Apify actor that's specialized for single posts. Only used when the
// primary scraper (even with residential proxy) still didn't return all
// childPosts.
async function trySecondaryInstagramCarouselActor(
  url: string,
  rowKey: string,
): Promise<ResolvedSource | null> {
  logger.info(
    { rowKey, url, retryStrategy: "secondary-actor", actor: INSTAGRAM_SECONDARY_ACTOR },
    "media-downloader: trying secondary IG actor for carousel",
  );
  // Task #209: structured trace on the secondary IG carousel actor
  // (Apify-only, residential session). Mirrors the shape used by the
  // primary batch + reel-downloader paths.
  logger.info(
    {
      event: "ig-extract-attach",
      phase: "apify-call",
      actor: INSTAGRAM_SECONDARY_ACTOR,
      rowKey,
      url,
      normalizedUrl: url,
      path: null,
      cookieSource: "apify-residential",
      cookieFlagPresent: false,
      cookieFileReadable: false,
      authenticated: true,
      strategy: "ig-secondary-carousel",
    },
    "ig-extract-attach: ig secondary carousel actor call",
  );
  const items = await apifyRunSyncBatch(
    INSTAGRAM_SECONDARY_ACTOR,
    {
      directUrls: [url],
      startUrls: [{ url }],
      urls: [url],
      resultsLimit: 1,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    },
    2048,
    180,
  );
  if (!items || !items.length) return null;
  for (const item of items) {
    const list = pickInstagramMediaList(item);
    const carousel = detectInstagramCarousel(item);
    if (list.length || carousel.isCarousel) {
      return { slides: list, carousel, source: INSTAGRAM_SECONDARY_ACTOR };
    }
  }
  return null;
}

// Secondary IG fallback. Some IG content (reels with restricted access,
// lightly-rate-limited posts, certain video-only links) comes back empty
// from the apify~instagram-scraper actor. In that case we try a dedicated
// reel/video downloader actor before falling all the way to yt-dlp. This
// is ONLY safe to use on non-carousel rows — it returns a single video and
// would silently downgrade a carousel to one slide.
async function tryInstagramReelDownloader(url: string): Promise<MediaUrls[]> {
  // Task #209: structured trace on the IG reel-downloader actor path
  // (Apify-only, no cookie file). Parallels the primary batch and
  // secondary carousel actor traces so a single grep on
  // `ig-extract-attach` reproduces every IG actor invocation.
  logger.info(
    {
      event: "ig-extract-attach",
      phase: "apify-call",
      actor: "presetshubham~instagram-reel-downloader",
      url,
      normalizedUrl: url,
      path: null,
      cookieSource: "apify-default",
      cookieFlagPresent: false,
      cookieFileReadable: false,
      authenticated: true,
      strategy: "ig-reel-downloader",
    },
    "ig-extract-attach: ig reel-downloader actor call",
  );
  // Task #195: actor input contract change. The presetshubham reel
  // downloader now requires {reelLinks:[url]} and rejects the legacy
  // {urls,startUrls,url} shape with HTTP 400 invalid-input. Aligning
  // both call sites so the primary reel path and the escalation
  // secondary path share the same canonical payload.
  const items = await apifyRunSyncBatch(
    "presetshubham~instagram-reel-downloader",
    {
      reelLinks: [url],
      proxyConfiguration: { useApifyProxy: true },
    },
    1024,
    120,
  );
  if (!items || !items.length) return [];
  const out: MediaUrls[] = [];
  const seen = new Set<string>();
  const push = (m: MediaUrls) => {
    const key = (m.videoUrl || m.imageUrl || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  const pickStr = (v: any): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item: any = raw;
    const videoUrl =
      pickStr(item.videoUrl) ||
      pickStr(item.video_url) ||
      pickStr(item.video) ||
      pickStr(item.downloadUrl) ||
      pickStr(item.download_url) ||
      pickStr(item.mediaUrl) ||
      pickStr(item.media_url) ||
      pickStr(item.url && item.type === "video" ? item.url : null);
    const imageUrl =
      pickStr(item.thumbnail) ||
      pickStr(item.thumbnailUrl) ||
      pickStr(item.thumbnail_url) ||
      pickStr(item.imageUrl) ||
      pickStr(item.image_url) ||
      pickStr(item.displayUrl) ||
      pickStr(item.coverUrl) ||
      null;
    if (videoUrl || imageUrl) push({ videoUrl, imageUrl });
    // Some downloader actors return a media[] / videos[] / images[] array.
    if (Array.isArray(item.media)) {
      for (const m of item.media) {
        if (typeof m === "string") push({ videoUrl: null, imageUrl: m });
        else if (m && typeof m === "object") {
          push({
            videoUrl: pickStr(m.videoUrl) || pickStr(m.video_url) || pickStr(m.url),
            imageUrl: pickStr(m.thumbnail) || pickStr(m.image) || null,
          });
        }
      }
    }
    if (Array.isArray(item.videos)) {
      for (const v of item.videos) {
        if (typeof v === "string") push({ videoUrl: v, imageUrl: null });
        else if (v && typeof v === "object")
          push({ videoUrl: pickStr(v.url) || pickStr(v.videoUrl), imageUrl: null });
      }
    }
  }
  return out;
}

const FACEBOOK_PRIMARY_ACTOR = "apify~facebook-posts-scraper";

export async function batchResolveFacebook(
  urls: string[],
  opts?: { residentialProxy?: boolean; memoryMb?: number },
): Promise<Map<string, ResolvedSource>> {
  const out = new Map<string, ResolvedSource>();
  if (urls.length === 0) return out;
  // Task #190: canonicalize every URL before the Apify actor and the
  // share-resolver see it. Strips fbclid / mibextid / __cft__ tracking
  // tokens, lowercases hosts, collapses fb.com / web.facebook.com to
  // www.facebook.com. Idempotent (resolveFacebookShareUrl normalizes
  // again as a defense-in-depth check; the second call no-ops).
  urls = urls.map((u) =>
    normalizeAndLog(u, { strategy: opts?.residentialProxy ? "fb-batch-residential" : "fb-batch", adLink: u }),
  );
  // Pre-resolve any /share/r|p|v share-redirect tokens to their canonical
  // /reel/<id> or /<page>/posts/<id> URLs before handing to Apify, otherwise
  // the actor returns empty for them and we fall through to a yt-dlp path
  // that also can't parse the share URL. resolveFacebookShareUrl now returns
  // null when every path lands on the login wall — fall back to the original
  // URL in that case so Apify still gets a chance (some non-share URLs do
  // resolve fine even if the share-redirect probe failed).
  const resolved = await Promise.all(
    urls.map(async (u) => (await resolveFacebookShareUrl(u, { adLink: u, strategy: "fb-batch-prefetch" })) ?? u),
  );
  const sendUrls = resolved.length ? resolved : urls;
  const input: ApifyActorInput = {
    startUrls: sendUrls.map((url) => ({ url })),
    resultsLimit: sendUrls.length,
  };
  if (opts?.residentialProxy) {
    // Task #158: auth-wall escalation runs the FB actor through Apify's
    // RESIDENTIAL proxy pool which carries an authenticated session
    // server-side. Public-facing IP addresses get login-walled by FB
    // for sustained automated traffic; the residential pool does not.
    input.proxyConfiguration = {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    };
  }
  const items = await apifyRunSyncBatch(
    FACEBOOK_PRIMARY_ACTOR,
    input,
    opts?.memoryMb ?? 2048,
    Math.min(540, 60 + sendUrls.length * 10),
  );
  if (!items) return out;
  for (const item of items) {
    const id = facebookIdentityFromItem(item);
    if (!id) continue;
    const list = pickFacebookMediaList(item);
    const carousel = detectFacebookCarousel(item);
    out.set(id, { slides: list, carousel, source: FACEBOOK_PRIMARY_ACTOR });
  }
  return out;
}

// Task #137: discriminated result so callers can distinguish a CDN
// timeout from a generic fetch failure. The downloader persists the
// timeout case as `cdn-fetch-timeout` (greppable in logs and the DB
// mediaError column) instead of the generic `cdn fetch failed`.
type FetchedMedia = { buf: Buffer; ext: string; contentType: string };
type FetchResult =
  | { ok: true; data: FetchedMedia }
  | { ok: false; reason: "timeout" | "http" | "size" | "type" | "error"; error: string };

async function fetchMediaUrlAsBuffer(url: string): Promise<FetchResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, CDN_FETCH_TIMEOUT_MS);
  try {
    let ab: ArrayBuffer;
    let ct: string;
    try {
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
          Accept: "*/*",
        },
        redirect: "follow",
      });
      if (!resp.ok) {
        return { ok: false, reason: "http", error: `cdn HTTP ${resp.status}` };
      }
      ct = (resp.headers.get("content-type") || "").toLowerCase();
      ab = await resp.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
    if (ab.byteLength === 0) return { ok: false, reason: "size", error: "cdn empty body" };
    if (ab.byteLength > MAX_BYTES) {
      return { ok: false, reason: "size", error: `cdn body exceeds ${MAX_BYTES} bytes` };
    }
    let ext = "";
    let contentType = ct || "application/octet-stream";
    if (ct.includes("mp4")) { ext = "mp4"; contentType = "video/mp4"; }
    else if (ct.includes("webm")) { ext = "webm"; contentType = "video/webm"; }
    else if (ct.includes("quicktime") || ct.includes("mov")) { ext = "mov"; contentType = "video/quicktime"; }
    else if (ct.includes("png")) { ext = "png"; contentType = "image/png"; }
    else if (ct.includes("webp")) { ext = "webp"; contentType = "image/webp"; }
    else if (ct.includes("gif")) { ext = "gif"; contentType = "image/gif"; }
    else if (ct.includes("jpeg") || ct.includes("jpg")) { ext = "jpg"; contentType = "image/jpeg"; }
    else {
      const m = url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
      const guess = (m?.[1] || "").toLowerCase();
      if (VIDEO_EXTS.has(guess)) { ext = guess; contentType = contentTypeFor(guess); }
      else if (IMAGE_EXTS.has(guess)) { ext = guess; contentType = contentTypeFor(guess); }
      else return { ok: false, reason: "type", error: `cdn unknown content type: ${ct || "<none>"}` };
    }
    return { ok: true, data: { buf: Buffer.from(ab), ext, contentType } };
  } catch (err: any) {
    if (timedOut) {
      return { ok: false, reason: "timeout", error: `cdn-fetch-timeout (${CDN_FETCH_TIMEOUT_MS}ms)` };
    }
    return { ok: false, reason: "error", error: `cdn: ${err?.message || String(err)}`.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadMediaFromCdn(
  cdnUrl: string,
  preferredKind: "video" | "image",
  opts?: { thumbnailUrl?: string | null },
): Promise<DownloadResult> {
  const fetched = await fetchMediaUrlAsBuffer(cdnUrl);
  if (!fetched.ok) {
    // Task #137: distinct, greppable error tags. `cdn:` prefixes generic
    // CDN failures; `cdn-fetch-timeout` is its own tag so admins can
    // distinguish a slow CDN from a 404 or wrong-MIME response.
    const tag =
      fetched.reason === "timeout" ? "cdn-fetch-timeout" : `cdn: ${fetched.error}`;
    logger.warn(
      { mediaError: "cdn:", strategy: "cdn-fetch", url: cdnUrl, reason: fetched.reason, err: fetched.error },
      "media-downloader: cdn fetch failed",
    );
    return { ok: false, error: tag };
  }
  const kind: "video" | "image" =
    VIDEO_EXTS.has(fetched.data.ext) ? "video" :
    IMAGE_EXTS.has(fetched.data.ext) ? "image" :
    preferredKind;
  // Audio gate. Some Apify-resolved CDN URLs point at a video-only
  // variant (notably FB DASH segments and certain reel renditions);
  // rejecting here lets the escalation chain advance to the next
  // actor and ultimately to yt-dlp, which knows how to merge a
  // separate audio stream. A `null` probe (transient ffprobe error)
  // is treated as trustworthy so we don't refuse perfectly fine
  // videos on a probe blip.
  if (kind === "video") {
    // T370: bounded-retry probe. ffprobe blip → second deeper-scan
    // attempt; still indeterminate → treat as no-audio so the caller
    // escalates rather than silently caching a silent video.
    const hasAudio = await videoBufferHasAudioTrackWithRetry(
      fetched.data.buf,
      fetched.data.ext,
    );
    if (!hasAudio) {
      logger.warn(
        { url: cdnUrl, ext: fetched.data.ext, bytes: fetched.data.buf.length },
        "media-downloader: cdn video has no audio track; rejecting so caller can escalate",
      );
      return { ok: false, error: "no-audio-track" };
    }
  }
  const objectPath = await uploadToObjectStorage(fetched.data.buf, fetched.data.ext, fetched.data.contentType);
  const result: DownloadResult = {
    ok: true,
    kind,
    objectPath,
    contentType: fetched.data.contentType,
    bytes: fetched.data.buf.length,
  };
  // Task #186: cache a poster thumbnail for video downloads. Prefer the
  // platform-supplied URL (sharper, server-cropped) and fall back to a
  // locally-rendered ffmpeg frame so video cards always have a real
  // preview instead of a black tile.
  if (kind === "video") {
    let thumb: { buf: Buffer; ext: string; contentType: string } | null = null;
    let source: "extraction" | "local-poster" | null = null;
    if (opts?.thumbnailUrl) {
      thumb = await fetchThumbnailBuffer(opts.thumbnailUrl);
      if (thumb) source = "extraction";
    }
    if (!thumb) {
      thumb = await generatePosterFromVideoBuffer(fetched.data.buf, fetched.data.ext);
      if (thumb) source = "local-poster";
    }
    if (thumb && source) {
      try {
        const thumbPath = await uploadThumbnailToObjectStorage(thumb.buf, thumb.ext, thumb.contentType);
        result.thumbnailObjectPath = thumbPath;
        result.thumbnailContentType = thumb.contentType;
        result.thumbnailSource = source;
        // Persist the source URL even when we fell back to ffmpeg, so a
        // future backfill can retry extraction without losing provenance.
        result.thumbnailSourceUrl = opts?.thumbnailUrl ?? null;
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err) },
          "media-downloader: thumbnail upload failed (cdn path)",
        );
      }
    }
  }
  return result;
}

// Task #155: per-platform Netscape cookies file resolved from object
// storage by the worker (NEVER the API; the worker entrypoint is the
// only thing that imports auth-cookies for cookie use). Falls back to
// the legacy YT_DLP_COOKIES_FILE env var when no DB jar exists, so an
// existing on-disk cookies.txt continues to work during migration.
//
// `cookieResolverMode` is set by initMediaWorker(); the API process
// keeps it at 'env-only' so an accidental API-side call can never read
// admin-uploaded cookies.
type CookieResolverMode = "env-only" | "db-and-env";
let cookieResolverMode: CookieResolverMode = "env-only";
let ytDlpEnvCookiesPathChecked: string | null | undefined;

export function setCookieResolverMode(mode: CookieResolverMode): void {
  cookieResolverMode = mode;
  logger.info({ mode }, "media-downloader: cookie resolver mode set");
}

async function getEnvCookiesPath(): Promise<string | null> {
  if (ytDlpEnvCookiesPathChecked !== undefined) return ytDlpEnvCookiesPathChecked;
  const raw = (process.env.YT_DLP_COOKIES_FILE || "").trim();
  if (!raw) {
    ytDlpEnvCookiesPathChecked = null;
    return null;
  }
  try {
    await access(raw, fsConstants.R_OK);
    ytDlpEnvCookiesPathChecked = raw;
    logger.info({ path: raw }, "media-downloader: yt-dlp env cookies file enabled");
    return raw;
  } catch (err: any) {
    logger.warn(
      { path: raw, err: err?.message || String(err) },
      "media-downloader: YT_DLP_COOKIES_FILE set but file not readable; ignoring",
    );
    ytDlpEnvCookiesPathChecked = null;
    return null;
  }
}

// Task #158: runtime extraction no longer reads the customer-uploaded
// auth_cookie_jars table. Authenticated extraction is served by the
// Apify residential-proxy escalation path (see runYtDlpWithAuthWallEscalation
// / escalateAuthWallToApify). The DB jar table and lib/auth-cookies module
// are kept for the auth-health probe history and dashboard surfacing only;
// they are intentionally NOT consulted here. Env-supplied cookies (set by
// operators outside the customer cookies.txt UI, which has been removed)
// are still honored as a break-glass for non-auth-wall yt-dlp edge cases.
// Task #187: per-call result so the persist path can attribute the row
// to whichever auth source actually fed yt-dlp. The `source` is one of
// "ig-db-jar" / "fb-db-jar" / "env" / null; null means anonymous.
interface ResolvedCookieFile {
  path: string;
  source: "ig-db-jar" | "fb-db-jar" | "env";
}
async function resolveCookiesForUrl(url: string): Promise<ResolvedCookieFile | null> {
  // Task #209: structured trace at the entry of every IG cookie
  // resolution. Lets an operator grep `ig-extract-attach phase=resolve`
  // to confirm the worker even attempted to materialize a jar for
  // this URL (vs. having silently skipped resolution due to mode).
  const igTarget = isInstagramUrl(url);
  if (igTarget) {
    logger.info(
      {
        event: "ig-extract-attach",
        phase: "resolve",
        resolverMode: cookieResolverMode,
        url,
        normalizedUrl: url,
        path: null,
        cookieSource: null,
        cookieFlagPresent: false,
        cookieFileReadable: false,
        authenticated: false,
      },
      "ig-extract-attach: cookie resolution invoked",
    );
  }
  // Worker-only DB jar reads. The API process keeps cookieResolverMode
  // at "env-only" so an accidental API-side call can never read the
  // admin-uploaded cookies.
  if (cookieResolverMode === "db-and-env") {
    if (igTarget) {
      try {
        const ig = await import("./instagram-session-cookies");
        const path = await ig.materializeInstagramCookieFile();
        if (path) {
          // Task #209: success counter for IG jar materialization.
          providerCounters.igCookieMaterializeSuccess += 1;
          logger.info(
            {
              event: "ig-extract-attach",
              phase: "materialize",
              outcome: "ok",
              url,
              normalizedUrl: url,
              path,
              cookieSource: "ig-db-jar",
              cookieFlagPresent: true,
              cookieFileReadable: true,
              authenticated: true,
            },
            "ig-extract-attach: ig jar materialized",
          );
          return { path, source: "ig-db-jar" };
        }
        // Reaching here means materializeInstagramCookieFile returned
        // null - an enumerated outcome (no-jar / expired / decrypt-fail
        // / empty) was already logged inside that helper. Bump the
        // counter so the dashboard reflects the failed attempt.
        providerCounters.igCookieMaterializeFail += 1;
        logger.warn(
          {
            event: "ig-extract-attach",
            phase: "materialize",
            outcome: "null",
            url,
            normalizedUrl: url,
            path: null,
            cookieSource: null,
            cookieFlagPresent: false,
            cookieFileReadable: false,
            authenticated: false,
          },
          "ig-extract-attach: ig jar materialization returned null",
        );
      } catch (err: any) {
        providerCounters.igCookieMaterializeFail += 1;
        logger.warn(
          {
            event: "ig-extract-attach",
            phase: "materialize",
            outcome: "throw",
            err: err?.message || String(err),
            url,
            normalizedUrl: url,
            path: null,
            cookieSource: null,
            cookieFlagPresent: false,
            cookieFileReadable: false,
            authenticated: false,
          },
          "media-downloader: IG cookie materialization failed; falling through to env",
        );
      }
    } else if (isFacebookUrl(url)) {
      try {
        const auth = await import("./auth-cookies");
        const path = await auth.materializeCookieFile("fb");
        if (path) return { path, source: "fb-db-jar" };
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err), url },
          "media-downloader: FB cookie materialization failed; falling through to env",
        );
      }
    }
  }
  const envPath = await getEnvCookiesPath();
  if (envPath) return { path: envPath, source: "env" };
  return null;
}

// Pre-clean any leftover `media.*` files in the workdir before a yt-dlp
// retry/run. Without `--no-continue` yt-dlp's HTTP Range resume against
// CDN URLs that don't honor partial responses returns HTTP 416 and the
// download dies. We pair `--no-continue` with this sweep so a fresh
// process never sees a stale `.part` or `.f<id>.mp4` from a previous
// crash on the same workdir.
async function preCleanWorkdir(workdir: string): Promise<void> {
  try {
    const entries = await readdir(workdir);
    await Promise.all(
      entries
        .filter((e) => e.startsWith("media.") || e.endsWith(".part"))
        .map((e) => rm(join(workdir, e), { force: true }).catch(() => undefined)),
    );
  } catch {
    /* fresh mkdtemp dir - nothing to clean */
  }
}

async function runYtDlpDownload(
  url: string,
  ctx?: { rowKey?: string | null; adLink?: string | null; strategy?: string },
): Promise<DownloadResult> {
  let workdir: string | null = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), "mediadl-"));
    const outTpl = join(workdir, "media.%(ext)s");
    // Task #155 / #193: pre-clean + --no-continue + --no-part +
    // --http-chunk-size 0 + --retries 0 + --force-overwrites
    // collectively eliminate the HTTP 416 "Requested Range Not
    // Satisfiable" failures we were getting against IG/FB CDN URLs
    // that don't accept Range headers. We OWN the retry loop below
    // (see runOnce wrapper) so yt-dlp's internal segment retry never
    // fires a Range request against a half-written file.
    await preCleanWorkdir(workdir);
    const cookies = await resolveCookiesForUrl(url);
    // Task #209: strict pre-spawn IG hard-fail. We refuse to invoke
    // yt-dlp against an Instagram URL unless we can prove the cookie
    // file is BOTH resolved AND readable AT THIS MOMENT. Three failure
    // shapes all collapse to the `auth-misconfigured` class so the
    // wrapper escalates straight to Apify residential proxy:
    //   1. cookies missing entirely (no admin jar, no env break-glass)
    //   2. cookies resolved but the file is unreadable when probed
    //      with access(R_OK) right before the spawn (race with temp-dir
    //      cleaner / chmod regression / FS error)
    //   3. cookies resolved but the cookie flag will not be passed
    //      (defensive: cookies?.path falsy)
    // Any of the three burns a guaranteed ig-login-required if we let
    // it spawn, so we short-circuit instead.
    if (isInstagramUrl(url)) {
      // T209: pre-spawn guard delegated to a pure helper so it is testable.
      const guardOutcome = await evaluateIgPreSpawnGuard(
        cookies,
        async (p) => { await access(p, fsConstants.R_OK); return true; },
      );
      const igHardFail = guardOutcome.hardFail;
      const igCookieFileReadable = guardOutcome.fileReadable;
      if (igHardFail) {
        providerCounters.igCookieAttachFail += 1;
        const attachFields = {
          event: "ig-extract-attach" as const,
          phase: "attach" as const,
          outcome: igHardFail === "no-cookies" ? "anonymous-blocked" : igHardFail,
          rowKey: ctx?.rowKey ?? null,
          adLink: ctx?.adLink ?? null,
          rawUrl: ctx?.adLink ?? url,
          normalizedUrl: url,
          path: cookies?.path ?? null,
          strategy: ctx?.strategy ?? "yt-dlp",
          resolverMode: cookieResolverMode,
          cookieSource: cookies?.source ?? null,
          cookieFlagPresent: Boolean(cookies?.path),
          cookieFileReadable: igCookieFileReadable,
          authenticated: false,
          recoveryClass: "auth-misconfigured" as const,
        };
        logger.warn(
          attachFields,
          `ig-extract-attach: refusing IG yt-dlp invocation (${igHardFail}); escalating to Apify residential`,
        );
        // Task #209 (post-review): emit an explicit `ig-attach-failed`
        // breadcrumb alias of the same fields so operations alerting
        // can match a dedicated event name without scanning the
        // unified `ig-extract-attach` stream and filtering on
        // outcome/phase. Both events carry identical contract fields
        // so a downstream pipeline can de-duplicate on (rowKey, ts).
        logger.warn(
          { ...attachFields, event: "ig-attach-failed" },
          `ig-attach-failed: ${igHardFail}`,
        );
        return {
          ok: false,
          error: igHardFailErrorString(igHardFail),
        };
      }
    }
    // T210: per-host pacing for yt-dlp. Same token bucket as the
    // Apify path, gated on the URL host so IG / FB extractor calls
    // are spaced apart even when a worker tick fans out a burst.
    try {
      const { awaitPaceSlot } = await import("./per-host-pacing");
      await awaitPaceSlot(isInstagramUrl(url) ? "ig" : isFacebookUrl(url) ? "fb" : null);
    } catch { /* best-effort */ }
    // Task #187 (runtime verification): emit a structured pre-spawn line
    // BEFORE every yt-dlp invocation so we can prove from logs that
    // (a) the worker booted with `db-and-env` resolver mode, (b) the
    // DB-backed jar materialized into a real readable file, (c) yt-dlp
    // is actually receiving `--cookies`, and (d) cookieSource is not
    // `none` for IG/FB rows. We deliberately do NOT log the materialized
    // cookie file PATH or its byte size (review fix): the path could be
    // used by another tenant on a shared host to target the temp file,
    // and the size is also operational auth-artifact metadata. A boolean
    // `cookieFileReadable` and the high-level `cookieSource` enum are
    // sufficient to prove continuity. Cookie BYTES are never logged.
    let cookieFileReadable = false;
    if (cookies) {
      try {
        await access(cookies.path, fsConstants.R_OK);
        cookieFileReadable = true;
      } catch {
        cookieFileReadable = false;
      }
    }
    // Task #209: per-spawn IG cookie attach counter / log. By
    // construction (the strict guard above) we only reach this branch
    // when cookies && cookieFileReadable, so the success path always
    // bumps the success counter and `authenticated=true` is honest.
    if (isInstagramUrl(url) && cookies && cookieFileReadable) {
      providerCounters.igCookieAttachSuccess += 1;
      logger.info(
        {
          event: "ig-extract-attach",
          phase: "attach",
          outcome: "ok",
          rowKey: ctx?.rowKey ?? null,
          adLink: ctx?.adLink ?? null,
          normalizedUrl: url,
          path: cookies.path,
          strategy: ctx?.strategy ?? "yt-dlp",
          resolverMode: cookieResolverMode,
          cookieSource: cookies.source,
          cookieFlagPresent: true,
          cookieFileReadable: true,
          authenticated: true,
        },
        "ig-extract-attach: ig cookie file attached to yt-dlp",
      );
    }
    logger.info(
      {
        event: "ytdlp-pre-spawn",
        rowKey: ctx?.rowKey ?? null,
        adLink: ctx?.adLink ?? null,
        rawUrl: ctx?.adLink ?? url,
        normalizedUrl: url,
        strategy: ctx?.strategy ?? "yt-dlp",
        platform: isInstagramUrl(url) ? "ig" : isFacebookUrl(url) ? "fb" : "other",
        primaryExtractor: "yt-dlp",
        fallbackTriggered: ctx?.strategy?.includes("fallback") ?? false,
        ytdlpSpawned: true,
        apifySpawned: false,
        resolverMode: cookieResolverMode,
        cookieSource: cookies?.source ?? "none",
        cookieFlagPresent: Boolean(cookies),
        cookieFileReadable,
      },
      "media-downloader: yt-dlp pre-spawn",
    );
    const args = [
      "--no-playlist",
      "--max-filesize", "80M",
      "--no-warnings",
      "--quiet",
      "--no-progress",
      // Task #155 / #193: belt-and-suspenders against partial-resume
      // corruption. --no-part disables the .part suffix, --no-continue
      // forbids resuming a leftover file, --force-overwrites makes any
      // stray file from a crashed run get truncated rather than
      // resumed, --no-mtime keeps the filesystem stat from interfering
      // with overwrite checks, --http-chunk-size 0 disables chunked
      // (Range-based) downloading entirely so a flaky CDN can't 416
      // mid-stream, and --retries 0 prevents yt-dlp's internal segment
      // retry from issuing a Range request against a half-written
      // file. The OUTER retry below owns the one-shot retry on a 416
      // / partial-resume signature.
      "--no-part",
      "--no-continue",
      "--no-mtime",
      "--force-overwrites",
      "--http-chunk-size", "0",
      "--retries", "0",
      "--fragment-retries", "0",
      "--socket-timeout", "20",
      "--user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "--add-header", "Accept-Language: en-US,en;q=0.9",
      ...(cookies ? ["--cookies", cookies.path] : []),
      // Audio-first format selection. Many platforms (IG/FB/TikTok)
      // serve high-quality video and audio as SEPARATE DASH/HLS
      // streams; the bare `best` selector then picks the highest-
      // bitrate single-file format which is frequently video-only,
      // producing a silent .mp4. The `bv*+ba` first option forces
      // yt-dlp to merge the best video + best audio so the output
      // always has audio when the platform exposes it. Subsequent
      // fallbacks explicitly require `acodec!=none` before falling
      // through to the legacy single-file selector.
      "-f",
      "bv*[filesize<80M]+ba/b[filesize<80M][acodec!=none]/b[acodec!=none]/best[filesize<80M]/best[height<=1080]/best",
      "--merge-output-format", "mp4",
      // Task #186: ask yt-dlp to drop the platform thumbnail next to the
      // media file and convert it to JPEG so the cached-thumbnail pipeline
      // gets a high-quality `extraction` source for free. A failure here
      // never blocks the video itself; the fallback is the ffmpeg poster
      // generated below.
      "--write-thumbnail",
      "--convert-thumbnails", "jpg",
      "-o", outTpl,
      url,
    ];
    // Task #193: outer one-shot retry on partial-resume / HTTP 416
    // signatures. Pre-cleans the workdir so a half-written `media.*`
    // file from the first attempt cannot be re-used as a resume
    // source on the retry, then re-spawns yt-dlp with the SAME args
    // (which already include --no-continue + --http-chunk-size 0).
    // We do NOT retry on auth-wall / not-found / quota / rate-limit
    // errors - those are owned by runYtDlpWithAuthWallEscalation and
    // would only burn time here.
    let r = await runYtDlp(args, PER_DOWNLOAD_TIMEOUT_MS);
    if (r.code !== 0 && isPartialResumeError(r.stderr)) {
      logger.warn(
        {
          event: "ytdlp-partial-resume-retry",
          rowKey: ctx?.rowKey ?? null,
          adLink: ctx?.adLink ?? null,
          strategy: ctx?.strategy ?? "yt-dlp",
          url,
          code: r.code,
          firstErr: r.stderr.split("\n").filter(Boolean).pop()?.slice(0, 200) ?? null,
        },
        "media-downloader: yt-dlp 416/partial-resume detected, pre-cleaning workdir and retrying once",
      );
      await preCleanWorkdir(workdir);
      r = await runYtDlp(args, PER_DOWNLOAD_TIMEOUT_MS);
      if (r.code === 0) {
        logger.info(
          {
            event: "ytdlp-partial-resume-recovered",
            rowKey: ctx?.rowKey ?? null,
            adLink: ctx?.adLink ?? null,
            strategy: ctx?.strategy ?? "yt-dlp",
            url,
          },
          "media-downloader: yt-dlp recovered after partial-resume retry",
        );
      }
    }
    if (r.code !== 0) {
      const lastErr = r.stderr.split("\n").filter(Boolean).pop() || "yt-dlp failed";
      // Task #137: row-scoped structured log so a stuck row's failure
      // is grep-able by rowKey/adLink and we can see which strategy
      // (ig-fallback / fb-fallback / single-url) drove the call.
      logger.warn(
        {
          rowKey: ctx?.rowKey ?? null,
          adLink: ctx?.adLink ?? null,
          strategy: ctx?.strategy ?? "yt-dlp",
          url,
          code: r.code,
          err: lastErr.slice(0, 400),
          partialResumeRetried: isPartialResumeError(r.stderr),
        },
        "media-downloader: yt-dlp non-zero exit",
      );
      return { ok: false, error: lastErr.slice(0, 400) };
    }
    const files = await readdir(workdir);
    const mediaFile = files.find((f) => f.startsWith("media."));
    if (!mediaFile) return { ok: false, error: "no media file produced" };
    const buf = await readFile(join(workdir, mediaFile));
    if (buf.length === 0) return { ok: false, error: "empty media file" };
    if (buf.length > MAX_BYTES) return { ok: false, error: "file exceeds size cap" };
    const ext = extname(mediaFile).toLowerCase().replace(".", "") || "mp4";
    const isImage = IMAGE_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isImage && !isVideo) {
      return { ok: false, error: `unsupported extension: ${ext}` };
    }
    // Audio gate. Refuse to persist a silent video: yt-dlp can still
    // pick a video-only format on platforms that lie about combined
    // streams. Returning an error here keeps the row pending and the
    // worker will retry (and on enough retries, mark failed) rather
    // than silently saving a no-audio cache that a user then opens
    // expecting sound. Probe failure (null) is treated as "trust it"
    // so a transient ffprobe issue doesn't break ingestion.
    if (isVideo) {
      // T370: bounded-retry probe (see videoFileHasAudioTrackWithRetry).
      // Probe blip on the live yt-dlp path now escalates instead of
      // silently caching a no-audio video.
      const localMediaPath = join(workdir, mediaFile);
      const hasAudio = await videoFileHasAudioTrackWithRetry(localMediaPath);
      if (!hasAudio) {
        logger.warn(
          { rowKey: ctx?.rowKey ?? null, adLink: ctx?.adLink ?? null, url, ext },
          "media-downloader: yt-dlp produced video with no audio track; rejecting",
        );
        return { ok: false, error: "no-audio-track" };
      }
    }
    const ct = contentTypeFor(ext);
    const objectPath = await uploadToObjectStorage(buf, ext, ct);
    const result: DownloadResult = {
      ok: true,
      kind: isImage ? "image" : "video",
      objectPath,
      contentType: ct,
      bytes: buf.length,
    };
    // Task #186: cache a poster for video downloads. yt-dlp's
    // `--write-thumbnail` drops `media.jpg` (or .webp/.png) next to the
    // media file when the platform exposes a thumbnail. Use it as the
    // sharper `extraction` source; otherwise fall back to ffmpeg on the
    // local file before we delete the workdir.
    if (!isImage) {
      let thumb: { buf: Buffer; ext: string; contentType: string } | null = null;
      let source: "extraction" | "local-poster" | null = null;
      const thumbFile = files.find(
        (f) =>
          f.startsWith("media.") &&
          f !== mediaFile &&
          /\.(jpg|jpeg|png|webp)$/i.test(f),
      );
      if (thumbFile) {
        try {
          const tbuf = await readFile(join(workdir, thumbFile));
          if (tbuf.length > 0 && tbuf.length <= 10 * 1024 * 1024) {
            const tExt = (extname(thumbFile).toLowerCase().replace(".", "") || "jpg");
            const tCt =
              tExt === "png" ? "image/png" :
              tExt === "webp" ? "image/webp" :
              "image/jpeg";
            thumb = { buf: tbuf, ext: tExt === "jpeg" ? "jpg" : tExt, contentType: tCt };
            source = "extraction";
          }
        } catch { /* fall through to ffmpeg */ }
      }
      if (!thumb) {
        thumb = await generatePosterFromVideoFile(join(workdir, mediaFile));
        if (thumb) source = "local-poster";
      }
      if (thumb && source) {
        try {
          const thumbPath = await uploadThumbnailToObjectStorage(thumb.buf, thumb.ext, thumb.contentType);
          result.thumbnailObjectPath = thumbPath;
          result.thumbnailContentType = thumb.contentType;
          result.thumbnailSource = source;
          // yt-dlp does not surface the platform poster URL it dropped to
          // disk, so we leave thumbnailSourceUrl null on this path - the
          // backfill will keep the existing extraction-quality file and
          // skip re-fetching.
        } catch (err: any) {
          logger.warn(
            { err: err?.message || String(err), rowKey: ctx?.rowKey ?? null },
            "media-downloader: thumbnail upload failed (yt-dlp path)",
          );
        }
      }
    }
    if (cookies) result.cookieSource = cookies.source;
    return result;
  } catch (err: any) {
    return { ok: false, error: (err?.message || String(err)).slice(0, 400) };
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
  }
}

async function fetchImageDirect(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 ApexOffersBoard/1.0" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    // Guard against HTML / error pages being persisted as image bytes:
    // require the response to actually advertise an image MIME type.
    if (!ct.startsWith("image/")) return null;
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return null;
    let ext = "jpg";
    if (ct.includes("png")) ext = "png";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    else if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    return { buf: Buffer.from(ab), ext };
  } catch {
    return null;
  }
}

// Single-URL fallback for refetchMediaForRow / non-batched flows.
export async function downloadAndStoreMedia(url: string): Promise<DownloadResult> {
  if (isLikelyImageUrl(url)) {
    const direct = await fetchImageDirect(url);
    if (direct) {
      const ct = contentTypeFor(direct.ext);
      const path = await uploadToObjectStorage(direct.buf, direct.ext, ct);
      return { ok: true, kind: "image", objectPath: path, contentType: ct, bytes: direct.buf.length };
    }
  }
  if (isInstagramUrl(url)) {
    const map = await batchResolveInstagram([url]);
    const id = urlIdentity(url);
    const got = id ? map.get(id) : undefined;
    if (got && got.slides.length) {
      const first = got.slides[0];
      // Refuse the post thumbnail when the URL is a video kind (reel) but
      // Apify only returned an imageUrl — fall through to the reel
      // downloader / yt-dlp instead of caching a still as the row's media.
      const wantsVideo = urlKindIsVideo(url);
      const target = first.videoUrl || (wantsVideo ? null : first.imageUrl);
      if (target) {
        const r = await downloadMediaFromCdn(target, first.videoUrl ? "video" : "image", { thumbnailUrl: first.thumbnailUrl ?? null });
        // T159: tag this primary-path success with the actual Apify
        // actor that resolved the URL so refetch's persistResult can
        // attribute the row to apifySuccess (instead of "single-fallback"
        // -> the unclassified bucket).
        if (r.ok) return { ...r, effectiveSource: got.source ?? INSTAGRAM_PRIMARY_ACTOR };
      }
    }
    // Secondary apify fallback (reel/video downloader actor) before yt-dlp.
    // Skip when the post is identified as a carousel — that actor returns
    // a single video and would silently downgrade the row.
    if (!got?.carousel.isCarousel) {
      try {
        const reelList = await tryInstagramReelDownloader(url);
        if (reelList.length) {
          const first = reelList[0];
          const wantsVideo = urlKindIsVideo(url);
          const target = first.videoUrl || (wantsVideo ? null : first.imageUrl);
          if (target) {
            const r = await downloadMediaFromCdn(target, first.videoUrl ? "video" : "image", { thumbnailUrl: first.thumbnailUrl ?? null });
            if (r.ok) return { ...r, effectiveSource: "presetshubham~instagram-reel-downloader" };
          }
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err) },
          "media-downloader: ig reel-downloader fallback crashed",
        );
      }
      const yt = await runYtDlpWithAuthWallEscalation(url, { strategy: "ig-single-fallback", adLink: url });
      if (yt.ok) return yt;
      // Pass the (possibly escalated-failed) error through verbatim so
      // the auth-wall-escalated-failed classifier can pick it up.
      return yt;
    }
    return { ok: false, error: "instagram: apify+yt-dlp both failed" };
  }
  if (isFacebookUrl(url)) {
    const canonical = (await resolveFacebookShareUrl(url, { adLink: url, strategy: "fb-single-url" })) ?? url;
    const map = await batchResolveFacebook([canonical]);
    // batchResolveFacebook keys by URL identity, but Apify echoes back the
    // canonical URL so we look that up first then fall back to the input.
    const id = urlIdentity(canonical) || urlIdentity(url);
    const got = id ? map.get(id) : undefined;
    if (got && got.slides.length) {
      const first = got.slides[0];
      // Same guard as the IG path: don't cache the post thumbnail when
      // the URL is a /reel/, /videos/, or /watch/ link and Apify only
      // returned imageUrl. Falling through here lets yt-dlp fetch the
      // actual video below.
      const wantsVideo = urlKindIsVideo(url) || urlKindIsVideo(canonical);
      const target = first.videoUrl || (wantsVideo ? null : first.imageUrl);
      if (target) {
        const r = await downloadMediaFromCdn(target, first.videoUrl ? "video" : "image", { thumbnailUrl: first.thumbnailUrl ?? null });
        if (r.ok) return { ...r, effectiveSource: got.source ?? FACEBOOK_PRIMARY_ACTOR };
      }
    }
    // Don't waste a yt-dlp run on a /share/r/<token> URL that we know
    // resolves to nothing but a login wall — yt-dlp will deterministically
    // 401 on those and just burn an attempt.
    if (isFacebookShareUrl(url) && canonical === url) {
      return {
        ok: false,
        error: "facebook: share URL only resolves to login wall (apify also empty)",
      };
    }
    // yt-dlp also handles canonical /reel/<id> better than /share/r/<token>.
    // Skip for FB carousels — yt-dlp returns one video and would silently
    // downgrade an attachments-style carousel row.
    if (!got?.carousel.isCarousel) {
      const yt = await runYtDlpWithAuthWallEscalation(canonical, { strategy: "fb-single-fallback", adLink: url });
      if (yt.ok) return yt;
      return yt;
    }
    return { ok: false, error: "facebook: apify+yt-dlp both failed" };
  }
  return await runYtDlpWithAuthWallEscalation(url, { strategy: "single-url", adLink: url });
}

interface PendingRow {
  id: number;
  rowKey: string;
  // Task #197: canonical URL the worker actually processes. Populated
  // from normalized_url when present, falling back to the raw adLink.
  // Every downstream call (extractor, share-resolver, batchers) reads
  // this field so the persisted normalized URL is the single processing
  // identity. The raw adLink is kept on rawAdLink for audit only.
  adLink: string;
  rawAdLink?: string;
  attempts: number;
  // Task #134: cached canonical URL from a prior share-redirect resolution.
  // When present, downstream strategies use this directly and skip the
  // re-resolution call - that's the entire point of persisting it on the
  // row in the first place.
  resolvedUrl: string | null;
  // Task #197: prior recovery class persisted on the row, used to bucket
  // the recovery into auth/extractor/temporary on the success branch.
  // Null on first-attempt rows.
  priorRecoveryClass?: string | null;
  // Task #197: timestamp of the row's first failed attempt - used to
  // approximate end-to-end recovery latency. Falls back to "now" when
  // null so first-time-failed rows don't pollute the average.
  firstFailedAt?: Date | string | null;
  // T374: prior persisted mediaKind (before this attempt). Used by
  // persistResult / persistMultiResult to refuse silently overwriting
  // a previously-video row with an image-only result on re-resolution
  // (e.g. a refetch that resolves to the cover thumbnail variant
  // instead of the underlying video). Null on rows that never had a
  // successful kind persisted.
  priorMediaKind?: "video" | "image" | null;
}

async function persistResult(
  row: PendingRow,
  result: DownloadResult,
  meta?: AdResearchBoardMediaMeta | null,
): Promise<void> {
  if (result.ok) {
    // T374: guard against silent video → image downgrade. When a row
    // previously persisted mediaKind='video' and this attempt resolved
    // to an image (typically the cover thumbnail variant of a video
    // post), refuse to overwrite the row. Convert the result into a
    // failure so the row enters the standard retry ladder instead of
    // appearing as a non-interactive image where a video used to be.
    const newKind = (result.kind || "image") as "image" | "video";
    if (newKind === "image" && row.priorMediaKind === "video") {
      logger.warn(
        {
          rowKey: row.rowKey,
          adLink: row.adLink,
          newKind,
          priorMediaKind: row.priorMediaKind,
          effectiveSource: result.effectiveSource ?? meta?.source ?? null,
        },
        "media-downloader: refusing video → image downgrade on re-resolution",
      );
      return persistResult(
        row,
        { ok: false, error: "video-degraded-to-image" },
        meta ?? null,
      );
    }
    const items: AdResearchBoardMediaItem[] | null = result.objectPath
      ? [{
          kind: (result.kind || "image") as "image" | "video",
          objectPath: result.objectPath,
          contentType: result.contentType || "application/octet-stream",
          // Task #186: persist per-slide thumbnail so the carousel modal
          // can render <img> over individual video slides too. Cover-row
          // columns mirror this for the card grid.
          thumbnailObjectPath: result.thumbnailObjectPath ?? null,
          thumbnailContentType: result.thumbnailContentType ?? null,
          thumbnailSource: result.thumbnailSource ?? null,
          thumbnailSourceUrl: result.thumbnailSourceUrl ?? null,
        }]
      : null;
    // T210: derive structured extraction-outcome metadata for the
    // dashboard's per-row triage panel. Fields are best-effort: if
    // the extractor path didn't surface enough context (older code
    // paths, callers that don't pass meta), the field is left null
    // rather than fabricated.
    const t210EffectiveSource = result.effectiveSource ?? meta?.source ?? null;
    const t210SourceLower = (t210EffectiveSource || "").toLowerCase();
    const t210Escalated = t210SourceLower.includes("apify-escalation");
    const t210AuthAttached = Boolean(result.cookieSource ?? meta?.cookieSource ?? null);
    const finalMeta: AdResearchBoardMediaMeta = {
      ...(meta || {}),
      capturedSlides: items?.length ?? 0,
      // Task #187: stamp which authenticated cookie source actually fed
      // the live extractor, so the admin dashboard can show
      // ytDlpAuthenticatedRecoveries provenance per row.
      ...(result.cookieSource !== undefined ? { cookieSource: result.cookieSource } : {}),
      // T210: structured extraction observability.
      extractorPath: t210EffectiveSource,
      escalationStage: t210Escalated ? 2 : (t210SourceLower.includes("apify") ? 1 : 0),
      authAttached: t210AuthAttached,
      residentialUsed: t210Escalated,
      finalRecoveryReason: row.attempts > 0 ? "recovered-after-retry" : "ok-primary",
      outcomeCategory: row.attempts > 0 ? "ok-recovered" : "ok-primary",
    };
    // Task #197: track recovery latency for rows that previously failed
    // (attempts > 0 means at least one prior failure cycle). The span
    // approximates the time from when the row was first picked up until
    // it finally succeeded; wired into the providerCounters running
    // sums so the snapshot can compute an interval average.
    if (row.attempts > 0) {
      providerCounters.recoveryLatencyMsSum += Math.max(0, Date.now() - new Date(row.firstFailedAt ?? Date.now()).getTime());
      providerCounters.recoveryLatencySamples += 1;
      // Bucket the recovery into auth / extractor / temporary based on
      // the prior recovery_class persisted on this row.
      const prior = (row.priorRecoveryClass || "").toLowerCase();
      if (prior === "recoverable-auth") providerCounters.authRecoveries += 1;
      else if (prior === "recoverable-extractor") providerCounters.extractorRecoveries += 1;
      else if (prior === "recoverable-temporary") providerCounters.temporaryRecoveries += 1;
      bumpAdResearchLiveSession({ recoveries: 1 });
    }
    await db
      .update(adResearchBoardItems)
      .set({
        mediaStatus: "ok",
        mediaKind: result.kind || null,
        mediaObjectPath: result.objectPath || null,
        mediaContentType: result.contentType || null,
        mediaItems: items,
        mediaMeta: finalMeta,
        // Task #186: cover thumbnail mirrored at row level for the card grid.
        mediaThumbnailObjectPath: result.thumbnailObjectPath ?? null,
        mediaThumbnailContentType: result.thumbnailContentType ?? null,
        mediaThumbnailSource: result.thumbnailSource ?? null,
        mediaThumbnailSourceUrl: result.thumbnailSourceUrl ?? null,
        mediaError: null,
        mediaErrorClass: null,
        // Task #197: clear recovery columns on terminal-ok so the row
        // shows "no pending recovery" in the dashboard and the queue
        // SELECT no longer treats it as scheduled work.
        recoveryClass: null,
        recoveryStrategy: null,
        retryAfterAt: null,
        mediaAttempts: row.attempts + 1,
        mediaDownloadedAt: new Date(),
        // Task #137 (next-stage): clear lease + record processing duration
        // on terminal write. Reading mediaStartedAt back inside the SET
        // expression lets us compute duration even when the in-process
        // PendingRow doesn't carry a startedAt field.
        mediaLeaseOwner: null,
        mediaLeaseUntil: null,
        mediaLastProcessingMs: sql`CASE WHEN ${adResearchBoardItems.mediaStartedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ${adResearchBoardItems.mediaStartedAt})) * 1000 ELSE NULL END`,
        // Task #309: stamp the per-row outcome change timestamp so the
        // 24h-windowed dashboard tiles in getQueueHealth() see this
        // success as a fresh outcome event. Sync upserts deliberately
        // do NOT bump this column.
        mediaOutcomeChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(adResearchBoardItems.id, row.id));
    recordPersistSuccess(finalMeta);
    logger.info(
      {
        rowKey: row.rowKey,
        bytes: result.bytes,
        kind: result.kind,
        meta: finalMeta,
      },
      "media-downloader: ok",
    );
    // Task #187: per-row INFO breadcrumb for log-driven extraction
    // forensics. Cookie BYTES never appear here - only the source label
    // ("ig-db-jar" / "fb-db-jar" / "env" / null), the row identifiers
    // and the extractor bucket. Mirrors the fail-branch trace so a
    // single `extraction-trace` filter rebuilds end-to-end attempt
    // history for any row.
    logger.info(
      {
        event: "extraction-trace",
        rowKey: row.rowKey,
        adLink: row.adLink,
        rawUrl: row.rawAdLink ?? row.adLink,
        canonicalUrl: row.resolvedUrl ?? row.adLink,
        normalizedUrl: row.resolvedUrl ?? row.adLink,
        platform: isInstagramUrl(row.adLink) ? "ig" : isFacebookUrl(row.adLink) ? "fb" : "other",
        outcome: "ok",
        finalOutcome: "ok",
        extractor: finalMeta.source ?? null,
        primaryExtractor: finalMeta.source ?? null,
        effectiveSource: result.effectiveSource ?? finalMeta.source ?? null,
        escalated: (result.effectiveSource ?? "").includes("apify-escalation") || (finalMeta.source ?? "").includes("apify-escalation"),
        fallbackTriggered: (result.effectiveSource ?? "").includes("apify-escalation") || (finalMeta.source ?? "").includes("apify-escalation"),
        ytdlpSpawned: (finalMeta.source ?? "").includes("yt-dlp") || (result.effectiveSource ?? "").includes("yt-dlp"),
        apifySpawned: (finalMeta.source ?? "").includes("apify") || (result.effectiveSource ?? "").includes("apify"),
        bytes: result.bytes ?? null,
        cookieSource: result.cookieSource ?? null,
        errorClass: null,
        attempts: row.attempts + 1,
      },
      "extraction-trace",
    );
  } else {
    // Preserve any caller-provided capturedSlides (e.g. partial-carousel
    // failures pass through how many slides actually downloaded). Only
    // default to 0 when the caller didn't provide a value at all so the
    // UI can still show "0/N" for hard failures.
    // T210: derive structured failure metadata. Pre-computed here so
    // both the dismissed and the will-retry branches persist the same
    // shape in mediaMeta. errorClass / recoveryClass are derived
    // further down; we add a placeholder pass and re-stamp after.
    const t210FailEffectiveSource = result.effectiveSource ?? meta?.source ?? null;
    const t210FailSourceLower = (t210FailEffectiveSource || "").toLowerCase();
    const t210FailEscalated = t210FailSourceLower.includes("apify-escalation");
    const t210FailAuthAttached = Boolean(meta?.cookieSource ?? null);
    const finalMeta: AdResearchBoardMediaMeta | null = meta || t210FailEffectiveSource
      ? {
          ...(meta || {}),
          capturedSlides: meta?.capturedSlides ?? 0,
          extractorPath: t210FailEffectiveSource,
          escalationStage: t210FailEscalated ? 2 : (t210FailSourceLower.includes("apify") ? 1 : 0),
          authAttached: t210FailAuthAttached,
          residentialUsed: t210FailEscalated,
        }
      : null;
    const newAttempts = row.attempts + 1;
    // Once a row has burned through MAX_ATTEMPTS we can't get the media
    // any other way, so dismiss it. Dismissed rows stay status=failed
    // (so the audit trail and last-error are preserved) but get hidden
    // from the user view, the admin "Needs Fixing" list, and — crucially
    // — the failed counter, so "Retry Failed (N)" can drop to zero after
    // a complete retry cycle instead of getting permanently stuck.
    const exhausted = newAttempts >= MAX_ATTEMPTS;
    const errorClass = classifyError(result.error);
    // Task #155: invalidate the IG rate-limit cache on real hits so the
    // next concurrency / backoff check picks up the new row immediately
    // instead of waiting for the 30s TTL to expire.
    if (errorClass === "ig-rate-limited") {
      igRateCountCache.expiresAt = 0;
      // Task #189: in-process per-interval counter (drained into the
      // queue_metrics snapshot row alongside the existing 24h rollup).
      providerCounters.igRateLimitHits += 1;
    }
    // Task #175: when an authenticated Facebook fetch comes back with
    // an auth-wall or expired-cookie classification, flip the FB jar to
    // expired so the admin panel surfaces it without waiting for a
    // manual Test Session click. `cookie-expired` is platform-agnostic
    // in the classifier, so we additionally gate on the row being a
    // Facebook URL to avoid mis-attributing IG cookie expiries.
    const isFbRow = isFacebookUrl(row.adLink);
    const isIgRow = isInstagramUrl(row.adLink);
    // Task #187: gate auto-expire on Apify NOT having recently hit a
    // quota wall. When Apify is throttled the live extractor takes
    // over and a single auth-wall hit there can be a transient blip
    // on a still-valid session - we don't want to flap the jar to
    // expired and force a fresh admin upload for what is really an
    // upstream Apify outage.
    const helpersForAutoExpire = await import("./media-downloader-helpers");
    const apifyQuotaRecent = helpersForAutoExpire.wasApifyQuotaRecent();
    if (
      !apifyQuotaRecent
      && (errorClass === "fb-auth-wall" || (isFbRow && errorClass === "cookie-expired") || errorClass === "auth-wall-escalated-failed")
    ) {
      if (isFbRow || errorClass === "fb-auth-wall") {
        try {
          const fbMod = await import("./facebook-cookies");
          await fbMod.markFbSessionExpired(
            `extractor ${errorClass}: ${(result.error || "").slice(0, 160)}`,
          );
        } catch { /* best-effort */ }
      }
    }
    // Task #187: mirror auto-expire for the IG admin-managed session
    // so an extractor-detected login wall flips the jar to expired
    // without waiting for a manual Test Session click. Same Apify-
    // quota gate as FB to avoid flapping a healthy session during
    // upstream Apify outages.
    // Task #187 (review fix): require IG row context for ALL IG-expire
    // triggers (not just cookie-expired / escalated). The classifier
    // shape `ig-login-required` typically aligns with an Instagram URL,
    // but a non-IG row that happens to surface that string in its error
    // (e.g. an embedded IG widget on an FB page) must not flap the IG
    // jar. Gating on isIgRow makes the precondition explicit.
    if (
      !apifyQuotaRecent
      && isIgRow
      && (errorClass === "ig-login-required" || errorClass === "cookie-expired" || errorClass === "auth-wall-escalated-failed" || errorClass === "ig-rate-limited")
    ) {
      try {
        const igMod = await import("./instagram-session-cookies");
        // Task #194: route extractor-detected auth signals through the
        // threshold gate so a single yt-dlp login-required (or rate-
        // limit, which carries zero weight) never flips a healthy
        // session. Map errorClass to IgAuthSignalKind.
        const kind: import("./instagram-session-cookies").IgAuthSignalKind =
          errorClass === "ig-rate-limited" ? "rate-limit"
            : errorClass === "cookie-expired" ? "true-invalidation"
              : errorClass === "auth-wall-escalated-failed" ? "true-invalidation"
                : "login-required-body";
        await igMod.recordAuthSignal({
          kind,
          reason: `extractor ${errorClass}: ${(result.error || "").slice(0, 160)}`,
        });
      } catch { /* best-effort */ }
    }
    // Task #197: derive normalized recovery class + planned strategy +
    // delayed retry timestamp for this failure cycle. The dashboard
    // surfaces these on the new "Recovery Pipeline" panel and the
    // periodic processor's SELECT honors retry_after_at so retries
    // follow the 10m / 1h / 6h ladder instead of the legacy fixed
    // 15-min cadence. Exhaustion-on-attempt-cap is folded into the
    // "dead-content" / "permanent-dismiss" bucket so a row that
    // previously burned through MAX_ATTEMPTS lands in dead-content
    // for the operator panel even if its underlying error class was
    // recoverable in isolation.
    const helpersForRecovery = await import("./media-downloader-helpers");
    let recoveryClass = helpersForRecovery.deriveRecoveryClass(errorClass);
    if (exhausted && recoveryClass !== "invalid-input") {
      recoveryClass = "dead-content";
    }
    const schedule = helpersForRecovery.computeRetrySchedule(recoveryClass, newAttempts, MAX_ATTEMPTS);
    // Counter bookkeeping for the dashboard. invalidUrlsBlocked is
    // bumped at the pre-claim filter so we don't double-count here.
    if (recoveryClass === "dead-content" && exhausted) {
      providerCounters.deadContentDismissed += 1;
      bumpAdResearchLiveSession({ deadContent: 1 });
    }
    if (!exhausted && schedule.retryAfterAt) {
      providerCounters.delayedRetriesScheduled += 1;
      bumpAdResearchLiveSession({ retries: 1 });
    }
    if (recoveryClass === "recoverable-auth" || recoveryClass === "auth-misconfigured") {
      bumpAdResearchLiveSession({ authFailures: 1 });
    }
    // T370: silent-source is terminal (skips retry ladder via
    // computeRetrySchedule) but is NOT auto-dismissed - the row must
    // stay visible on the public board so users see the cached video
    // playback with a "no audio" badge. Dismissing it would hide the
    // perfectly good visual asset behind the admin-only "Needs Fixing"
    // view. Admin "Re-fetch" still works because refetchMediaForRow
    // resets dismissed/attempts/recoveryClass independently.
    const dismissForInvalid =
      recoveryClass === "invalid-input"
      || recoveryClass === "dead-content";
    // Persisted mediaStatus differs for silent-source so the UI can
    // render the "no audio in source" badge and the queue-health
    // telemetry can count these rows distinctly from `failed`.
    // Task #401: split the retry lifecycle into retryable (`failed`) and
    // terminal (`failed_permanent`) so the live-health badge can ignore
    // exhausted rows entirely. `failed` only ever lives on rows that
    // still have a retry budget; once the worker burns the final attempt
    // the row moves to `failed_permanent` and stops counting toward any
    // live "current state" metric. `silent-source` is unchanged - it's
    // its own terminal status that the UI surfaces with a dedicated
    // "no audio in source" badge rather than treating it as a failure.
    const terminalMediaStatus: "failed" | "failed_permanent" | "silent-source" =
      recoveryClass === "silent-source" ? "silent-source"
        : exhausted ? "failed_permanent"
          : "failed";
    // T210: enrich the structured failure metadata with the now-known
    // recoveryClass + errorClass so the admin per-row triage panel
    // can show "why did this row land in its terminal state?" without
    // re-classifying client-side.
    if (finalMeta) {
      const t210OutcomeCategory: AdResearchBoardMediaMeta["outcomeCategory"] =
        recoveryClass === "recoverable-auth" ? "auth-failed"
          : recoveryClass === "auth-misconfigured" ? "auth-failed"
            : recoveryClass === "recoverable-extractor" ? "extractor-failed"
              : recoveryClass === "dead-content" ? "dead-content"
                : recoveryClass === "invalid-input" ? "invalid-input"
                  : recoveryClass === "unsupported-input" ? "unsupported-input"
                    : errorClass === "ig-rate-limited" ? "rate-limited"
                      : "other-failure";
      finalMeta.finalRecoveryReason = errorClass || schedule.recoveryStrategy;
      finalMeta.outcomeCategory = t210OutcomeCategory;
    }
    await db
      .update(adResearchBoardItems)
      .set({
        mediaStatus: terminalMediaStatus,
        mediaError: (result.error || "unknown error").slice(0, 400),
        mediaErrorClass: errorClass,
        // Task #197: stable recovery columns. Persisted at every
        // failure so the dashboard reads a single column instead of
        // re-classifying mediaErrorClass client-side.
        recoveryClass,
        recoveryStrategy: schedule.recoveryStrategy,
        retryAfterAt: schedule.retryAfterAt,
        mediaAttempts: newAttempts,
        mediaDownloadedAt: new Date(),
        // Task #137 (next-stage): clear lease + record processing duration
        // on terminal failure write. See ok-branch comment above.
        mediaLeaseOwner: null,
        mediaLeaseUntil: null,
        mediaLastProcessingMs: sql`CASE WHEN ${adResearchBoardItems.mediaStartedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ${adResearchBoardItems.mediaStartedAt})) * 1000 ELSE NULL END`,
        ...(finalMeta ? { mediaMeta: finalMeta } : {}),
        ...(exhausted || dismissForInvalid ? { dismissed: true } : {}),
        // Task #309: stamp the outcome change timestamp on every
        // failure / dismiss-on-exhaust write so 24h-windowed tiles
        // pick this up as a fresh outcome event.
        mediaOutcomeChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(adResearchBoardItems.id, row.id));
    if (exhausted) {
      logger.warn(
        { rowKey: row.rowKey, attempts: newAttempts, error: result.error, meta: finalMeta },
        "media-downloader: dismissed (max attempts exhausted)",
      );
    } else {
      logger.warn(
        { rowKey: row.rowKey, attempts: newAttempts, error: result.error, meta: finalMeta },
        "media-downloader: failed",
      );
    }
    // Task #187: per-row INFO breadcrumb for log-driven extraction
    // forensics. Cookie BYTES never appear here - only the source label,
    // the row identifiers, the error class, and the attempt count.
    logger.info(
      {
        event: "extraction-trace",
        rowKey: row.rowKey,
        adLink: row.adLink,
        rawUrl: row.rawAdLink ?? row.adLink,
        canonicalUrl: row.resolvedUrl ?? row.adLink,
        normalizedUrl: row.resolvedUrl ?? row.adLink,
        platform: isInstagramUrl(row.adLink) ? "ig" : isFbRow ? "fb" : "other",
        outcome: exhausted ? "dismissed" : "failed",
        finalOutcome: exhausted ? "dismissed" : "failed",
        extractor: finalMeta?.source ?? null,
        primaryExtractor: finalMeta?.source ?? null,
        effectiveSource: result.effectiveSource ?? finalMeta?.source ?? null,
        escalated: (result.effectiveSource ?? "").includes("apify-escalation") || (finalMeta?.source ?? "").includes("apify-escalation"),
        fallbackTriggered: (result.effectiveSource ?? "").includes("apify-escalation") || (finalMeta?.source ?? "").includes("apify-escalation"),
        ytdlpSpawned: (finalMeta?.source ?? "").includes("yt-dlp") || (result.effectiveSource ?? "").includes("yt-dlp"),
        apifySpawned: (finalMeta?.source ?? "").includes("apify") || (result.effectiveSource ?? "").includes("apify"),
        bytes: result.bytes ?? null,
        cookieSource: finalMeta?.cookieSource ?? result.cookieSource ?? null,
        errorClass,
        attempts: newAttempts,
        apifyQuotaRecent,
      },
      "extraction-trace",
    );
  }
}

// Task #134: persist a PARTIAL carousel result. The row gets a real
// `mediaStatus='partial'` (a first-class status, not a synthetic flavor of
// failed) so user-facing queries can include partials, the failed counter
// stays accurate, and Retry Partials can target rows by status alone
// without scanning JSON. Slides we DID download are persisted — partial
// is "useful but incomplete", not "broken".
async function persistPartialResult(
  row: PendingRow,
  items: AdResearchBoardMediaItem[],
  meta: AdResearchBoardMediaMeta | null,
  errorMessage: string,
): Promise<void> {
  const cover = items[0];
  const finalMeta: AdResearchBoardMediaMeta = {
    ...(meta || {}),
    capturedSlides: items.length,
  };
  await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "partial",
      mediaKind: cover?.kind ?? null,
      mediaObjectPath: cover?.objectPath ?? null,
      mediaContentType: cover?.contentType ?? null,
      mediaItems: items,
      mediaMeta: finalMeta,
      // Task #186: mirror cover slide's cached thumbnail so the card grid
      // for partial rows still renders a real preview frame instead of
      // the black <video preload="none"> tile this task is killing.
      mediaThumbnailObjectPath: cover?.thumbnailObjectPath ?? null,
      mediaThumbnailContentType: cover?.thumbnailContentType ?? null,
      // Honor the cover slide's actual capture source instead of hardcoding
      // "extraction"; partial-carousel cover slides can absolutely have come
      // from the local ffmpeg fallback when the platform poster URL failed.
      mediaThumbnailSource: cover?.thumbnailObjectPath ? (cover?.thumbnailSource ?? null) : null,
      mediaThumbnailSourceUrl: cover?.thumbnailSourceUrl ?? null,
      mediaError: errorMessage.slice(0, 400),
      mediaErrorClass: classifyError(errorMessage),
      mediaAttempts: row.attempts + 1,
      mediaDownloadedAt: new Date(),
      // Task #137 (next-stage): clear lease on terminal-but-partial write.
      mediaLeaseOwner: null,
      mediaLeaseUntil: null,
      mediaLastProcessingMs: sql`CASE WHEN ${adResearchBoardItems.mediaStartedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ${adResearchBoardItems.mediaStartedAt})) * 1000 ELSE NULL END`,
      // Task #309: stamp outcome change on partial-terminal write.
      mediaOutcomeChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(adResearchBoardItems.id, row.id));
  recordPersistSuccess(finalMeta);
  logger.warn(
    {
      rowKey: row.rowKey,
      attempts: row.attempts + 1,
      slides: items.length,
      meta: finalMeta,
    },
    "media-downloader: partial",
  );
  // Task #187: emit the per-row extraction-trace breadcrumb on the
  // partial path too so a single `extraction-trace` filter rebuilds
  // end-to-end attempt history regardless of which terminal branch the
  // row landed in (ok / partial / failed / dismissed).
  logger.info(
    {
      event: "extraction-trace",
      rowKey: row.rowKey,
      adLink: row.adLink,
      rawUrl: row.rawAdLink ?? row.adLink,
      canonicalUrl: row.resolvedUrl ?? row.adLink,
      normalizedUrl: row.resolvedUrl ?? row.adLink,
      platform: isInstagramUrl(row.adLink) ? "ig" : isFacebookUrl(row.adLink) ? "fb" : "other",
      outcome: "partial",
      finalOutcome: "partial",
      extractor: finalMeta.source ?? null,
      primaryExtractor: finalMeta.source ?? null,
      effectiveSource: finalMeta.source ?? null,
      escalated: (finalMeta.source ?? "").includes("apify-escalation"),
      fallbackTriggered: (finalMeta.source ?? "").includes("apify-escalation"),
      ytdlpSpawned: (finalMeta.source ?? "").includes("yt-dlp"),
      apifySpawned: (finalMeta.source ?? "").includes("apify"),
      // AdResearchBoardMediaItem doesn't carry per-slide byte counts in
      // the jsonb shape, so the partial-trace bytes field is intentionally
      // null - the failed path's `result.bytes` is the only authoritative
      // byte total we have, and that branch already emits its own trace.
      bytes: null,
      cookieSource: finalMeta.cookieSource ?? null,
      errorClass: classifyError(errorMessage),
      attempts: row.attempts + 1,
      slides: items.length,
    },
    "extraction-trace",
  );
}

// Persist a multi-item (carousel) success: stores all downloaded slides
// in mediaItems and uses the first slide as the primary mediaObjectPath
// for back-compat / cover thumbnail.
async function persistMultiResult(
  row: PendingRow,
  items: AdResearchBoardMediaItem[],
  meta?: AdResearchBoardMediaMeta | null,
): Promise<void> {
  if (items.length === 0) {
    const expected = meta?.expectedSlides ?? 0;
    const errText =
      meta?.isCarousel && expected > 0
        ? `carousel: 0/${expected} slides downloaded`
        : "carousel: no slides downloaded";
    await persistResult(row, { ok: false, error: errText }, meta);
    return;
  }
  const cover = items[0];
  // T374: guard against silent video → image downgrade on the carousel
  // path too. If every captured slide came back as an image but the
  // row previously held a video, the resolver almost certainly fell
  // back to the cover thumbnail variant of a video post. Refuse the
  // overwrite and route through persistResult's failure branch so the
  // row enters the standard retry ladder instead of degrading to a
  // non-interactive image.
  if (
    row.priorMediaKind === "video"
    && items.every((it) => it.kind === "image")
  ) {
    logger.warn(
      {
        rowKey: row.rowKey,
        adLink: row.adLink,
        slides: items.length,
        priorMediaKind: row.priorMediaKind,
        source: meta?.source ?? null,
      },
      "media-downloader: refusing carousel video → image downgrade on re-resolution",
    );
    await persistResult(
      row,
      { ok: false, error: "video-degraded-to-image" },
      meta ?? null,
    );
    return;
  }
  const finalMeta: AdResearchBoardMediaMeta = {
    ...(meta || {}),
    capturedSlides: items.length,
  };
  await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "ok",
      mediaKind: cover.kind,
      mediaObjectPath: cover.objectPath,
      mediaContentType: cover.contentType,
      mediaItems: items,
      mediaMeta: finalMeta,
      // Task #186: mirror cover slide's cached thumbnail for the card grid.
      mediaThumbnailObjectPath: cover.thumbnailObjectPath ?? null,
      mediaThumbnailContentType: cover.thumbnailContentType ?? null,
      // Honor the cover slide's actual capture source instead of hardcoding
      // "extraction"; the cover can have come from the ffmpeg fallback even
      // when later slides extracted cleanly.
      mediaThumbnailSource: cover.thumbnailObjectPath ? (cover.thumbnailSource ?? null) : null,
      mediaThumbnailSourceUrl: cover.thumbnailSourceUrl ?? null,
      mediaError: null,
      mediaErrorClass: null,
      mediaAttempts: row.attempts + 1,
      mediaDownloadedAt: new Date(),
      // Task #137 (next-stage): clear lease on terminal carousel-ok write.
      mediaLeaseOwner: null,
      mediaLeaseUntil: null,
      mediaLastProcessingMs: sql`CASE WHEN ${adResearchBoardItems.mediaStartedAt} IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - ${adResearchBoardItems.mediaStartedAt})) * 1000 ELSE NULL END`,
      // Task #309: stamp outcome change on terminal carousel-ok write.
      mediaOutcomeChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(adResearchBoardItems.id, row.id));
  recordPersistSuccess(finalMeta);
  logger.info(
    { rowKey: row.rowKey, slides: items.length, meta: finalMeta },
    "media-downloader: ok (carousel)",
  );
  // Task #187 (review fix): emit the per-row extraction-trace breadcrumb
  // on the carousel-success path too so a single `extraction-trace`
  // filter rebuilds end-to-end attempt history across every terminal
  // outcome (ok-single / ok-carousel / partial / failed / dismissed).
  // Cookie BYTES never appear here - only the source label.
  logger.info(
    {
      event: "extraction-trace",
      rowKey: row.rowKey,
      adLink: row.adLink,
      rawUrl: row.rawAdLink ?? row.adLink,
      canonicalUrl: row.resolvedUrl ?? row.adLink,
      normalizedUrl: row.resolvedUrl ?? row.adLink,
      platform: isInstagramUrl(row.adLink) ? "ig" : isFacebookUrl(row.adLink) ? "fb" : "other",
      outcome: "ok",
      finalOutcome: "ok",
      extractor: finalMeta.source ?? null,
      primaryExtractor: finalMeta.source ?? null,
      effectiveSource: finalMeta.source ?? null,
      escalated: (finalMeta.source ?? "").includes("apify-escalation"),
      fallbackTriggered: (finalMeta.source ?? "").includes("apify-escalation"),
      ytdlpSpawned: (finalMeta.source ?? "").includes("yt-dlp"),
      apifySpawned: (finalMeta.source ?? "").includes("apify"),
      bytes: null,
      cookieSource: finalMeta.cookieSource ?? null,
      errorClass: null,
      attempts: row.attempts + 1,
      slides: items.length,
    },
    "extraction-trace",
  );
}

async function markPending(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(adResearchBoardItems)
    .set({ mediaStatus: "pending", mediaError: null })
    .where(inArray(adResearchBoardItems.id, ids));
}

// Task #134: explicit lifecycle transition pending -> downloading at the
// start of a worker pass so the admin pipeline-counts surface accurately
// reflects in-flight work (rather than lumping it under "pending").
// Task #137 (next-stage): also stamps a lease (owner + expiry + start time)
// so a crashed worker's rows become claimable by the next pass after the
// short LEASE_TTL_MS, instead of waiting for the 15-min row backoff.
// Subsequent persistResult / persistPartialResult moves the row to its
// terminal state (ok | partial | failed) and clears the lease.
async function markDownloading(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS);
  await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "downloading",
      mediaError: null,
      mediaErrorClass: null,
      mediaLeaseOwner: WORKER_ID,
      mediaLeaseUntil: leaseUntil,
      mediaStartedAt: now,
      updatedAt: sql`now()`,
    })
    .where(inArray(adResearchBoardItems.id, ids));
}

// Task #137 (next-stage): atomic claim. Returns the subset of ids that
// this worker successfully won (i.e. were not held by a live lease from
// another worker). Mirrors `markDownloading` but is conditional on the
// row being claimable - status not 'ok' AND (no lease OR lease expired).
// Used by processPendingMedia after the candidate SELECT so two workers
// (e.g. during a deploy where the new process boots before the old one
// has shut down) can never double-process the same row.
async function claimRowsForProcessing(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS);
  const claimed = await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "downloading",
      mediaError: null,
      mediaErrorClass: null,
      mediaLeaseOwner: WORKER_ID,
      mediaLeaseUntil: leaseUntil,
      mediaStartedAt: now,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(adResearchBoardItems.id, ids),
        eq(adResearchBoardItems.dismissed, false),
        ne(adResearchBoardItems.mediaStatus, "ok"),
        or(
          isNull(adResearchBoardItems.mediaLeaseUntil),
          lt(adResearchBoardItems.mediaLeaseUntil, sql`now()`),
          // Self-reclaim: this same worker re-entering the pass (e.g.
          // back-to-back triggers within a single uptime window) keeps
          // its existing lease without contention.
          eq(adResearchBoardItems.mediaLeaseOwner, WORKER_ID),
        ),
      ),
    )
    .returning({ id: adResearchBoardItems.id });
  return claimed.map((r) => r.id);
}

// Task #137 (next-stage): periodic lease extension while a batch is in
// flight. Long-running batches (e.g. a 25-row Apify chunk that takes
// ~90s) would otherwise expire their lease mid-pass. Heartbeat extends
// every owned, still-in-flight row's lease by another LEASE_TTL_MS.
// Bounded to rows this worker still owns and not yet terminal so we
// don't keep stamping leases on rows another worker has reclaimed.
async function extendLeasesForOwnedRows(): Promise<number> {
  try {
    const newUntil = new Date(Date.now() + LEASE_TTL_MS);
    const updated = await db
      .update(adResearchBoardItems)
      .set({ mediaLeaseUntil: newUntil })
      .where(
        and(
          eq(adResearchBoardItems.mediaLeaseOwner, WORKER_ID),
          eq(adResearchBoardItems.mediaStatus, "downloading"),
        ),
      )
      .returning({ id: adResearchBoardItems.id });
    return updated.length;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), workerId: WORKER_ID },
      "media-downloader: lease heartbeat failed",
    );
    return 0;
  }
}

// Task #137: a single rejecting worker used to take down the entire pool
// (Promise.all short-circuits on first reject, leaving the rest of the
// rows abandoned in `downloading`). We now isolate per-item errors so
// one bad row can't poison the batch. The result slot for a rejected
// item is left as `undefined`; existing callers only use parallelMap for
// side effects (persistResult inside `fn`) so they tolerate this. The
// per-item error is logged with rowKey/strategy/err for triage.
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err: any) {
        results[idx] = undefined;
        const item: any = items[idx];
        logger.error(
          {
            mediaError: "parallelMap:item-crashed",
            rowKey: item?.rowKey ?? null,
            adLink: item?.adLink ?? null,
            strategy: "parallelMap",
            err: err?.message || String(err),
          },
          "media-downloader: parallelMap worker swallowed item rejection",
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// Union slides from two ResolvedSource results, deduping by canonical CDN
// URL (videoUrl wins over imageUrl when both are present on a slide). The
// merged result keeps the strongest carousel signal seen across inputs:
// `isCarousel` is true if either input flagged it, `expectedSlides` is the
// max reported, and `source` records both contributors so logs show what
// produced the final slide list. Used by the IG retry chain so primary +
// residential-retry + secondary-actor results combine instead of one
// overwriting the other when each returned a different partial subset.
function mergeResolvedSources(
  a: ResolvedSource | null,
  b: ResolvedSource | null,
): ResolvedSource | null {
  if (!a) return b;
  if (!b) return a;
  const merged: MediaUrls[] = [];
  const seen = new Set<string>();
  for (const src of [a, b]) {
    for (const slide of src.slides) {
      const key = (slide.videoUrl || slide.imageUrl || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(slide);
    }
  }
  const carousel: CarouselInfo = {
    isCarousel: a.carousel.isCarousel || b.carousel.isCarousel,
    expectedSlides: Math.max(a.carousel.expectedSlides, b.carousel.expectedSlides),
    typename: a.carousel.typename ?? b.carousel.typename ?? null,
  };
  const source = a.source === b.source ? a.source : `${a.source}+${b.source}`;
  return { slides: merged, carousel, source };
}

// Resolve a single Instagram row through the carousel-aware retry chain:
//   1. Use the batch's primary-actor result (passed in via `seed`).
//   2. If it's a carousel that came back short, retry with residential proxy
//      and merge slides into the running result.
//   3. If still short, try the secondary actor and merge again.
// Returns the merged ResolvedSource (or null if every step failed).
async function resolveInstagramRowWithRetries(
  row: PendingRow,
  seed: ResolvedSource | null,
): Promise<ResolvedSource | null> {
  let best: ResolvedSource | null = seed;

  // Helper: are we already complete enough to skip further retries? A
  // carousel is complete when the merged slide count meets the smaller of
  // (reported expected, MAX_CAROUSEL_SLIDES) — the cap applies because the
  // downloader will only ever persist that many slides anyway.
  const isComplete = (r: ResolvedSource | null): boolean => {
    if (!r || !r.slides.length) return false;
    if (!r.carousel.isCarousel) return true;
    const target = Math.min(
      Math.max(r.carousel.expectedSlides, 1),
      MAX_CAROUSEL_SLIDES,
    );
    return r.slides.length >= target;
  };

  if (!isComplete(best)) {
    // Task #155: respect adaptive backoff before each retry so we do
    // not burn through retries while IG is actively throttling us.
    const wait = await igBackoffDelayMs();
    if (wait > 0) {
      logger.info({ rowKey: row.rowKey, waitMs: wait }, "media-downloader: IG retry backoff");
      await sleep(wait);
    }
    const retried = await retryInstagramCarousel(
      row.adLink,
      row.rowKey,
      Math.max(best?.carousel.expectedSlides ?? 0, 2),
    );
    best = mergeResolvedSources(best, retried);
  }

  if (!isComplete(best) && best?.carousel.isCarousel) {
    const wait = await igBackoffDelayMs();
    if (wait > 0) {
      logger.info({ rowKey: row.rowKey, waitMs: wait }, "media-downloader: IG secondary backoff");
      await sleep(wait);
    }
    const secondary = await trySecondaryInstagramCarouselActor(
      row.adLink,
      row.rowKey,
    );
    best = mergeResolvedSources(best, secondary);
  }

  return best;
}

// Task #155: adaptive concurrency + retry backoff for IG. Driven by the
// shared, restart-safe rolling **1 hour** count of `ig-rate-limited`
// rows in `ad_research_board_items`. Cached for 30s so a hot batch
// loop doesn't hammer the DB; 30s is short relative to the 1h window
// so concurrency reacts quickly without per-call cost. Cross-worker
// safe because every worker reads the same source.
const IG_RATE_LIMIT_BACKOFF_THRESHOLD = 3;
const IG_RATE_LIMIT_CACHE_TTL_MS = 30_000;
let igRateCountCache = { value: 0, expiresAt: 0 };
async function getIgRateLimitedCount1h(): Promise<number> {
  const now = Date.now();
  if (igRateCountCache.expiresAt > now) return igRateCountCache.value;
  try {
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const [r] = await db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          gte(adResearchBoardItems.updatedAt, oneHourAgo),
          eq(adResearchBoardItems.mediaErrorClass, "ig-rate-limited"),
        ),
      );
    igRateCountCache = { value: Number(r?.n ?? 0), expiresAt: now + IG_RATE_LIMIT_CACHE_TTL_MS };
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, "media-downloader: ig rate-limit count query failed");
    // Fall back to last cached value rather than spamming retries.
    igRateCountCache.expiresAt = now + IG_RATE_LIMIT_CACHE_TTL_MS;
  }
  return igRateCountCache.value;
}
// Task #189: tiered adaptive concurrency. Replaces the prior binary
// "halve at threshold" rule with four tiers so we react proportionally
// to escalating 429 storms instead of clamping to half forever. Tiers:
//   <  3 hits/h   -> full FETCH_CONCURRENCY (3)
//   3-9   hits/h  -> half (max(1, floor(N/2)))      = 1
//   10-19 hits/h  -> quarter (max(1, floor(N/4)))   = 1
//   >=20  hits/h  -> single-flight (1) + cooldown injection upstream
// All tiers floor at 1 so the worker never fully stalls on a stale
// 1h rolling count - the cooldown gate handles full pauses separately.
const IG_RATE_LIMIT_QUARTER_THRESHOLD = 10;
const IG_RATE_LIMIT_SINGLEFLIGHT_THRESHOLD = 20;
async function adaptiveIgConcurrency(): Promise<number> {
  const recent = await getIgRateLimitedCount1h();
  if (recent >= IG_RATE_LIMIT_SINGLEFLIGHT_THRESHOLD) return 1;
  if (recent >= IG_RATE_LIMIT_QUARTER_THRESHOLD) {
    return Math.max(1, Math.floor(FETCH_CONCURRENCY / 4));
  }
  if (recent >= IG_RATE_LIMIT_BACKOFF_THRESHOLD) {
    return Math.max(1, Math.floor(FETCH_CONCURRENCY / 2));
  }
  return FETCH_CONCURRENCY;
}

// Task #189: pre-batch worker cooldown. When IG has been throttling us
// hard (>= IG_RATE_LIMIT_SINGLEFLIGHT_THRESHOLD hits/h) we sleep before
// resolving the next batch so the next pass lets IG's rate window cool
// off rather than firing another burst the moment the lease frees.
// Cap at 90s so a sustained storm cannot freeze the worker indefinitely
// - the existing 5-min processor interval will fire again soon enough.
// Each call applies independent ±25% jitter so multiple workers don't
// resume in lockstep. Returns the wait that was applied (0 = no-op).
const IG_COOLDOWN_BASE_MS = 30_000;
const IG_COOLDOWN_MAX_MS = 90_000;
export async function igPreBatchCooldownMs(): Promise<number> {
  const recent = await getIgRateLimitedCount1h();
  if (recent < IG_RATE_LIMIT_SINGLEFLIGHT_THRESHOLD) return 0;
  // Linear ramp from base to max over the 20..50 hit range so a true
  // storm gets the longer cooldown without overshooting the 90s cap.
  const ramp = Math.min(1, (recent - IG_RATE_LIMIT_SINGLEFLIGHT_THRESHOLD) / 30);
  const base = IG_COOLDOWN_BASE_MS + Math.floor((IG_COOLDOWN_MAX_MS - IG_COOLDOWN_BASE_MS) * ramp);
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}
export function _getIgRateLimitCount(): number { return igRateCountCache.value; }
export function _resetIgRateLimitForTest(): void { igRateCountCache = { value: 0, expiresAt: 0 }; }

// Task #155: exponential backoff with jitter for IG retry calls.
// Sourced from the same rolling 1h DB count used by the concurrency
// gate so retry delays match the global throttling state. Capped at
// 60s so a sustained 429 storm cannot freeze the worker indefinitely.
export async function igBackoffDelayMs(): Promise<number> {
  const recent = await getIgRateLimitedCount1h();
  if (recent < IG_RATE_LIMIT_BACKOFF_THRESHOLD) return 0;
  const exponent = Math.min(recent - IG_RATE_LIMIT_BACKOFF_THRESHOLD + 1, 6);
  const base = Math.min(60_000, 1_000 * Math.pow(2, exponent));
  // ±25% jitter so retry storms don't synchronize across workers.
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processInstagramBatch(rows: PendingRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Task #189: pre-batch cooldown. When the rolling 1h `ig-rate-limited`
  // count is in the storm tier, sleep with jitter BEFORE we mark the
  // batch downloading so other workers (and the next pass) don't pile
  // straight back into the throttled CDN. Auto-recovers as the rolling
  // window slides past the burst.
  const cooldownMs = await igPreBatchCooldownMs();
  if (cooldownMs > 0) {
    providerCounters.igCooldownsTriggered += 1;
    logger.warn(
      {
        event: "ig-rate-limit-cooldown",
        waitMs: cooldownMs,
        recentHits: igRateCountCache.value,
        batch: rows.length,
      },
      "media-downloader: IG rate-limit cooldown engaged before batch",
    );
    await sleep(cooldownMs);
  }
  // Task #134: explicit pending -> downloading transition so the admin
  // pipeline-counts surface accurately reflects in-flight work.
  await markDownloading(rows.map((r) => r.id));
  const urlByIdentity = new Map<string, PendingRow>();
  const orderedUrls: string[] = [];
  for (const r of rows) {
    const id = urlIdentity(r.adLink);
    if (id && !urlByIdentity.has(id)) {
      urlByIdentity.set(id, r);
      orderedUrls.push(r.adLink);
    }
  }
  logger.info(
    { batch: rows.length, unique: orderedUrls.length, strategy: "apify" },
    "media-downloader: resolving instagram batch via apify",
  );
  let resolved: Map<string, ResolvedSource>;
  try {
    resolved = await batchResolveInstagram(orderedUrls);
  } catch (err: any) {
    if (err instanceof ApifyBatchTimeoutError) {
      // Task #137: every row in this chunk is now stuck in `downloading`
      // because the batch resolver aborted. Mark them all failed with the
      // distinct `apify-batch-timeout` tag so the next pass picks them up
      // (after backoff) instead of leaving them in limbo.
      logger.warn(
        { mediaError: "apify:batch-timeout", strategy: "apify", actor: err.actor, batch: rows.length },
        "media-downloader: instagram apify batch timed out; failing batch rows",
      );
      await Promise.all(
        rows.map((row) =>
          persistResult(row, { ok: false, error: "apify-batch-timeout" }).catch((perr: any) =>
            logger.error(
              { mediaError: "apify:batch-timeout-persist", rowKey: row.rowKey, err: perr?.message || String(perr) },
              "media-downloader: failed to persist apify-batch-timeout for row",
            ),
          ),
        ),
      );
      return;
    }
    throw err;
  }
  // Task #155: adaptive concurrency. When IG has been rate-limiting us
  // recently (≥3 hits in the rolling 1h DB window) we halve in-batch
  // parallelism so the next pass doesn't keep slamming a throttled CDN.
  const concurrency = await adaptiveIgConcurrency();
  if (concurrency < FETCH_CONCURRENCY) {
    logger.warn(
      { concurrency, recentRateLimits: igRateCountCache.value },
      "media-downloader: IG adaptive backoff active",
    );
  }
  await parallelMap(rows, concurrency, async (row) => {
    try {
    const id = urlIdentity(row.adLink);
    const seed = id ? resolved.get(id) ?? null : null;
    const best = await resolveInstagramRowWithRetries(row, seed);

    if (best && best.slides.length) {
      const isCarousel = best.carousel.isCarousel;
      const expected = Math.max(
        best.carousel.expectedSlides,
        isCarousel ? best.slides.length : 1,
      );
      try {
        const downloaded = await downloadCarousel(best.slides, { rowKey: row.rowKey, adLink: row.adLink });
        if (downloaded.length === 0) {
          await persistResult(
            row,
            { ok: false, error: "carousel: 0 slides downloaded from CDN" },
            buildMeta(best, expected, "primary"),
          );
          return;
        }
        // For a carousel where we still didn't get all slides, mark FAILED
        // — never silently downgrade to a partial cover-only row. The
        // completeness check is normalized against MAX_CAROUSEL_SLIDES so
        // posts that legitimately have more slides than the cap don't get
        // marked failed when we already captured the maximum we'd persist.
        const target = isCarousel ? Math.min(expected, MAX_CAROUSEL_SLIDES) : 1;
        if (isCarousel && downloaded.length < target) {
          logger.warn(
            {
              rowKey: row.rowKey,
              expected,
              target,
              got: downloaded.length,
              actor: best.source,
            },
            "media-downloader: carousel incomplete after retries, marking partial",
          );
          // Task #134: partial carousels are now a first-class status,
          // NOT failed. The slides we did capture are still useful (the
          // user sees them), and the row stays eligible for a future
          // Retry Partials pass without re-burning quota on hopelessly
          // dead URLs (which are tracked separately as `failed`).
          await persistPartialResult(
            row,
            downloaded,
            { ...buildMeta(best, expected, "primary"), capturedSlides: downloaded.length },
            `carousel: only ${downloaded.length}/${target} slides captured`,
          );
          return;
        }
        await persistMultiResult(row, downloaded, buildMeta(best, expected, "primary"));
        return;
      } catch (err: any) {
        logger.warn(
          { rowKey: row.rowKey, err: err?.message || String(err) },
          "media-downloader: carousel download crashed, will fall back",
        );
      }
    }

    // From here, single-item fallbacks ONLY when the post is NOT a
    // carousel. Downgrading a carousel to a single video / image silently
    // loses slides, which is the bug this task fixes.
    if (best?.carousel.isCarousel) {
      await persistResult(
        row,
        {
          ok: false,
          error: `carousel: 0/${best.carousel.expectedSlides} slides captured (apify retries exhausted)`,
        },
        buildMeta(best, best.carousel.expectedSlides, "primary"),
      );
      return;
    }

    // Secondary apify fallback (reel/video downloader actor) before yt-dlp.
    try {
      const reelList = await tryInstagramReelDownloader(row.adLink);
      if (reelList.length) {
        const downloaded = await downloadCarousel(reelList, { rowKey: row.rowKey, adLink: row.adLink });
        if (downloaded.length) {
          await persistMultiResult(
            row,
            downloaded,
            {
              isCarousel: false,
              expectedSlides: 1,
              source: "presetshubham~instagram-reel-downloader",
              retryStrategy: "single-fallback",
            },
          );
          return;
        }
      }
    } catch (err: any) {
      logger.warn(
        { rowKey: row.rowKey, err: err?.message || String(err) },
        "media-downloader: ig reel-downloader fallback crashed",
      );
    }
    // Last-resort yt-dlp for this single (non-carousel) row. We resolve
    // the canonical URL first so share-link rows benefit from the same
    // redirect-follow + cookies-aware path downloadAndStoreMedia uses;
    // otherwise bulk retries keep slamming the same dead share URL.
    // resolveFacebookShareUrl is a no-op for non-FB hosts so it is safe
    // to call here even though this branch is the IG path.
    try {
      const canonical = (await resolveFacebookShareUrl(row.adLink, { rowKey: row.rowKey, adLink: row.adLink, strategy: "ig-batch-fallback" })) ?? row.adLink;
      const yt = await runYtDlpWithAuthWallEscalation(canonical, { rowKey: row.rowKey, adLink: row.adLink, strategy: "ig-batch-fallback" });
      await persistResult(
        row,
        yt.ok ? yt : { ok: false, error: yt.error || "instagram: apify+yt-dlp both failed" },
        {
          isCarousel: false,
          expectedSlides: 1,
          source: yt.effectiveSource ?? "yt-dlp",
          retryStrategy: "single-fallback",
        },
      );
    } catch (err: any) {
      await persistResult(row, { ok: false, error: (err?.message || String(err)).slice(0, 300) });
    }
    } catch (err: any) {
      // Task #137: per-item safety belt — anything that escaped the inner
      // strategy try/catches still gets persisted as a failed row instead
      // of leaving the row stuck in `downloading` for the next cutoff.
      logger.error(
        {
          mediaError: "ig:row-crashed",
          rowKey: row.rowKey,
          adLink: row.adLink,
          strategy: "instagram-batch",
          err: err?.message || String(err),
        },
        "media-downloader: instagram row processing crashed",
      );
      try {
        await persistResult(row, { ok: false, error: `ig: ${(err?.message || String(err)).slice(0, 280)}` });
      } catch (perr: any) {
        logger.error(
          { mediaError: "ig:row-persist-failed", rowKey: row.rowKey, err: perr?.message || String(perr) },
          "media-downloader: failed to persist crash for instagram row",
        );
      }
    }
  });
}

function buildMeta(
  resolved: ResolvedSource,
  expected: number,
  retryStrategy: string,
): AdResearchBoardMediaMeta {
  return {
    isCarousel: resolved.carousel.isCarousel,
    expectedSlides: expected,
    source: resolved.source ?? null,
    retryStrategy,
    typename: resolved.carousel.typename ?? null,
  };
}

// Task #134: persist the canonical /reel/<id> URL we resolved a /share/r/...
// token to back onto the row, so retries hand the canonical URL straight to
// Apify/yt-dlp instead of re-resolving the share token every cycle. Cheap
// fire-and-forget update — failure to persist is non-fatal (we'll just
// re-resolve next time).
async function persistResolvedUrl(rowId: number, resolved: string): Promise<void> {
  try {
    await db
      .update(adResearchBoardItems)
      .set({ resolvedUrl: resolved, updatedAt: sql`now()` })
      .where(eq(adResearchBoardItems.id, rowId));
  } catch (err: any) {
    logger.warn(
      { rowId, err: err?.message || String(err) },
      "media-downloader: failed to cache resolvedUrl",
    );
  }
}

async function processFacebookBatch(rows: PendingRow[]): Promise<void> {
  if (rows.length === 0) return;
  await markDownloading(rows.map((r) => r.id));
  // Task #134: pre-resolve every FB share-redirect row up-front so we can
  // (a) cache the canonical URL on the row, and (b) short-circuit rows that
  // only resolve to a login wall and mark them failed immediately rather
  // than burning a yt-dlp attempt that will deterministically 401.
  const shareLocked: PendingRow[] = [];
  const remaining: PendingRow[] = [];
  // Task #134: feed canonical URLs (not the original /share/r/... shortlinks)
  // into Apify so the batch resolver hits the real ad page instead of the
  // login wall. We keep the resolved URL per row so subsequent strategies
  // (yt-dlp fallback, identity dedupe) all use the canonical form.
  // If a previous pass already cached row.resolvedUrl, we reuse it instead
  // of calling resolveFacebookShareUrl again (which is the entire reason
  // we persist resolved_url in the first place).
  const canonicalByRowId = new Map<number, string>();
  await Promise.all(
    rows.map(async (r) => {
      if (!isFacebookShareUrl(r.adLink)) {
        // Non-share URLs may still have a cached canonical (e.g. an admin
        // edited the sheet). Prefer it when present.
        if (r.resolvedUrl) canonicalByRowId.set(r.id, r.resolvedUrl);
        remaining.push(r);
        return;
      }
      // Cached resolution from a prior pass - reuse, don't re-fetch.
      if (r.resolvedUrl && r.resolvedUrl !== r.adLink) {
        canonicalByRowId.set(r.id, r.resolvedUrl);
        remaining.push(r);
        return;
      }
      const canonical = await resolveFacebookShareUrl(r.adLink, { rowKey: r.rowKey, adLink: r.adLink, strategy: "fb-batch-presolve" });
      if (!canonical || canonical === r.adLink) {
        shareLocked.push(r);
      } else {
        await persistResolvedUrl(r.id, canonical);
        canonicalByRowId.set(r.id, canonical);
        remaining.push(r);
      }
    }),
  );
  // Task #134: share-locked rows are TERMINAL. We bypass persistResult so we
  // don't burn another retry slot every cycle - instead we pin
  // mediaAttempts to MAX_ATTEMPTS (the queue selector excludes those) and
  // dismiss the row so it stays out of the user view. Admin "Unhide Row"
  // / unretire flow can resurrect it manually if Facebook ever changes the
  // share-redirect behaviour.
  if (shareLocked.length > 0) {
    await db
      .update(adResearchBoardItems)
      .set({
        // Task #401: share-locked is a terminal exhaustion - this row
        // can never produce media without admin intervention, so it
        // belongs in the same `failed_permanent` bucket as a row that
        // burned through its retry budget naturally. Keeps the live
        // health badge clean.
        mediaStatus: "failed_permanent",
        mediaError: "share-url-locked",
        mediaErrorClass: classifyError("share-url-locked"),
        mediaAttempts: MAX_ATTEMPTS,
        dismissed: true,
        mediaMeta: {
          isCarousel: false,
          expectedSlides: 1,
          source: "share-resolver",
          retryStrategy: "share-locked",
        },
        // Task #309: stamp outcome change on share-locked terminal dismiss.
        mediaOutcomeChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(inArray(adResearchBoardItems.id, shareLocked.map((r) => r.id)));
    logger.info(
      { count: shareLocked.length, ids: shareLocked.map((r) => r.id) },
      "media-downloader: facebook share-locked rows terminally failed (no retry)",
    );
  }
  if (remaining.length === 0) return;
  rows = remaining;
  // Helper: prefer the resolved canonical URL when we have one, otherwise
  // fall back to the original adLink (non-share URLs, etc.).
  const effectiveUrl = (r: PendingRow): string =>
    canonicalByRowId.get(r.id) ?? r.adLink;
  const urlByIdentity = new Map<string, PendingRow>();
  const orderedUrls: string[] = [];
  for (const r of rows) {
    const url = effectiveUrl(r);
    const id = urlIdentity(url);
    if (id && !urlByIdentity.has(id)) {
      urlByIdentity.set(id, r);
      orderedUrls.push(url);
    }
  }
  logger.info(
    { batch: rows.length, unique: orderedUrls.length, strategy: "apify" },
    "media-downloader: resolving facebook batch via apify",
  );
  let resolved: Map<string, ResolvedSource>;
  try {
    resolved = await batchResolveFacebook(orderedUrls);
  } catch (err: any) {
    if (err instanceof ApifyBatchTimeoutError) {
      logger.warn(
        { mediaError: "apify:batch-timeout", strategy: "apify", actor: err.actor, batch: rows.length },
        "media-downloader: facebook apify batch timed out; failing batch rows",
      );
      await Promise.all(
        rows.map((row) =>
          persistResult(row, { ok: false, error: "apify-batch-timeout" }).catch((perr: any) =>
            logger.error(
              { mediaError: "apify:batch-timeout-persist", rowKey: row.rowKey, err: perr?.message || String(perr) },
              "media-downloader: failed to persist apify-batch-timeout for fb row",
            ),
          ),
        ),
      );
      return;
    }
    throw err;
  }
  await parallelMap(rows, FETCH_CONCURRENCY, async (row) => {
    try {
    const rowUrl = effectiveUrl(row);
    const id = urlIdentity(rowUrl);
    const seed = id ? resolved.get(id) ?? null : null;

    if (seed && seed.slides.length) {
      const isCarousel = seed.carousel.isCarousel;
      const expected = Math.max(
        seed.carousel.expectedSlides,
        isCarousel ? seed.slides.length : 1,
      );
      try {
        const downloaded = await downloadCarousel(seed.slides, { rowKey: row.rowKey, adLink: row.adLink });
        if (downloaded.length === 0) {
          await persistResult(
            row,
            { ok: false, error: "carousel: 0 slides downloaded from CDN" },
            buildMeta(seed, expected, "primary"),
          );
          return;
        }
        const target = isCarousel ? Math.min(expected, MAX_CAROUSEL_SLIDES) : 1;
        if (isCarousel && downloaded.length < target) {
          // Task #134: incomplete FB carousels are PARTIAL, not FAILED. We
          // keep the slides we managed to capture, render them in the user
          // view, and let admin "Retry Partials" re-queue them later.
          logger.warn(
            {
              rowKey: row.rowKey,
              expected,
              target,
              got: downloaded.length,
              actor: seed.source,
            },
            "media-downloader: FB carousel incomplete, marking partial",
          );
          await persistPartialResult(
            row,
            downloaded,
            { ...buildMeta(seed, expected, "primary"), capturedSlides: downloaded.length },
            `carousel: only ${downloaded.length}/${target} slides captured`,
          );
          return;
        }
        await persistMultiResult(row, downloaded, buildMeta(seed, expected, "primary"));
        return;
      } catch (err: any) {
        logger.warn(
          { rowKey: row.rowKey, err: err?.message || String(err) },
          "media-downloader: carousel download crashed, will fall back",
        );
      }
    }

    // Don't silently downgrade FB carousels via yt-dlp — it can only
    // grab a single video, and turning a 6-slide carousel into a single
    // image is exactly the bug the carousel triage flow targets.
    if (seed?.carousel.isCarousel) {
      await persistResult(
        row,
        {
          ok: false,
          error: `carousel: 0/${seed.carousel.expectedSlides} slides captured (apify exhausted)`,
        },
        buildMeta(seed, seed.carousel.expectedSlides, "primary"),
      );
      return;
    }

    // yt-dlp fallback: rowUrl is already the canonical URL (resolved
    // up-front during share pre-resolution), so we don't re-resolve.
    try {
      const yt = await runYtDlpWithAuthWallEscalation(rowUrl, { rowKey: row.rowKey, adLink: row.adLink, strategy: "fb-batch-fallback" });
      await persistResult(
        row,
        yt.ok ? yt : { ok: false, error: yt.error || "facebook: apify+yt-dlp both failed" },
        {
          isCarousel: false,
          expectedSlides: 1,
          source: yt.effectiveSource ?? "yt-dlp",
          retryStrategy: "single-fallback",
        },
      );
    } catch (err: any) {
      await persistResult(row, { ok: false, error: (err?.message || String(err)).slice(0, 300) });
    }
    } catch (err: any) {
      // Task #137: per-item safety belt for the FB batch — same idea as
      // the IG variant. One blown-up row never strands the rest in
      // `downloading`.
      logger.error(
        {
          mediaError: "fb:row-crashed",
          rowKey: row.rowKey,
          adLink: row.adLink,
          strategy: "facebook-batch",
          err: err?.message || String(err),
        },
        "media-downloader: facebook row processing crashed",
      );
      try {
        await persistResult(row, { ok: false, error: `fb: ${(err?.message || String(err)).slice(0, 280)}` });
      } catch (perr: any) {
        logger.error(
          { mediaError: "fb:row-persist-failed", rowKey: row.rowKey, err: perr?.message || String(perr) },
          "media-downloader: failed to persist crash for facebook row",
        );
      }
    }
  });
}

// Task #192: validate a candidate slide URL before we ever hand it to
// the CDN fetcher. Pure-string check (no I/O): rejects non-strings,
// blanks, and anything that doesn't parse as http/https. Caller drops
// invalid candidates rather than billing the actor for a 4xx round-
// trip on garbage like "" / null / "blob:..." / "data:...".
export function isValidSlideUrl(u: unknown): boolean {
  if (typeof u !== "string") return false;
  const t = u.trim();
  if (!t) return false;
  try {
    const parsed = new URL(t);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Task #192: build the ordered candidate list for one carousel slide.
// Primary URL (video first, image second) goes first; then the
// per-slide imageCandidates / videoCandidates the actor surfaced as
// alternate CDN mirrors; then the slide's thumbnailUrl as last-resort
// image fallback. Dedupe is by canonical string (helpers already
// dedupe within each list, but cross-list duplicates can still occur
// e.g. when imageUrl == thumbnailUrl). All candidates are URL-
// validated before inclusion. Pure - exported for unit tests.
export function buildSlideCandidateList(m: MediaUrls): { url: string; kind: "video" | "image" }[] {
  const out: { url: string; kind: "video" | "image" }[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined, kind: "video" | "image") => {
    if (!isValidSlideUrl(u)) return;
    const t = (u as string).trim();
    if (seen.has(t)) return;
    seen.add(t);
    out.push({ url: t, kind });
  };
  // Primary tier
  push(m.videoUrl ?? null, "video");
  push(m.imageUrl ?? null, "image");
  // Actor-supplied alternate CDN mirrors
  for (const u of m.videoCandidates ?? []) push(u, "video");
  for (const u of m.imageCandidates ?? []) push(u, "image");
  // Last-resort: the poster thumbnail. For a video slide a still frame
  // is better than nothing (the gallery still renders an image card)
  // and partial-carousel persistence will keep the row useful.
  push(m.thumbnailUrl ?? null, "image");
  return out;
}

// Task #192: per-slide CDN retry policy. Two attempts on the SAME URL
// before walking to the next candidate, with a small jittered backoff
// to ride out transient 5xx / 429s. Total worst-case per slide:
// candidates.length * 2 attempts; capped by SLIDE_RETRY_MAX_ATTEMPTS
// so a slide with a huge candidate list cannot starve the carousel.
const SLIDE_RETRY_PER_URL = 2;
const SLIDE_RETRY_MAX_ATTEMPTS = 6;
const SLIDE_RETRY_BACKOFF_MS = 350;

interface SlideDownloadOutcome {
  item: AdResearchBoardMediaItem | null;
  attempts: number;
  failures: { url: string; error: string }[];
}

async function downloadSingleSlideWithRecovery(
  m: MediaUrls,
): Promise<SlideDownloadOutcome> {
  const candidates = buildSlideCandidateList(m);
  const failures: { url: string; error: string }[] = [];
  let attempts = 0;
  if (!candidates.length) {
    return { item: null, attempts: 0, failures: [{ url: "", error: "no-valid-candidate-urls" }] };
  }
  for (const cand of candidates) {
    for (let i = 0; i < SLIDE_RETRY_PER_URL; i += 1) {
      if (attempts >= SLIDE_RETRY_MAX_ATTEMPTS) break;
      attempts += 1;
      try {
        const r = await downloadMediaFromCdn(cand.url, cand.kind, { thumbnailUrl: m.thumbnailUrl ?? null });
        if (r.ok && r.objectPath) {
          return {
            item: {
              kind: (r.kind || cand.kind) as "image" | "video",
              objectPath: r.objectPath,
              contentType: r.contentType || "application/octet-stream",
              // Task #186 / #192: per-slide thumbnail provenance. When
              // a video slide recovered via an image fallback the
              // resulting item's `kind` is "image", so the gallery
              // never tries to play an image as a video.
              thumbnailObjectPath: r.thumbnailObjectPath ?? null,
              thumbnailContentType: r.thumbnailContentType ?? null,
              thumbnailSource: r.thumbnailSource ?? null,
              thumbnailSourceUrl: r.thumbnailSourceUrl ?? m.thumbnailUrl ?? null,
            },
            attempts,
            failures,
          };
        }
        failures.push({ url: cand.url, error: (r.error || "unknown").slice(0, 120) });
      } catch (err: any) {
        failures.push({ url: cand.url, error: (err?.message || String(err)).slice(0, 120) });
      }
      // Don't backoff on the LAST attempt of this URL - the next
      // candidate is a different host so retry-after delay buys nothing.
      if (i + 1 < SLIDE_RETRY_PER_URL && attempts < SLIDE_RETRY_MAX_ATTEMPTS) {
        const jitter = Math.floor(Math.random() * SLIDE_RETRY_BACKOFF_MS);
        await new Promise((res) => setTimeout(res, SLIDE_RETRY_BACKOFF_MS + jitter));
      }
    }
    if (attempts >= SLIDE_RETRY_MAX_ATTEMPTS) break;
  }
  return { item: null, attempts, failures };
}

// Download every slide of a carousel (up to a sane cap to bound work).
// Returns only the slides that successfully uploaded; preserves order.
// Task #192: per-slide recovery. Each slide independently runs the
// candidate ladder (primary CDN URL -> actor-supplied alternate
// mirrors -> last-resort poster fallback) with bounded retries before
// giving up, so a single transient CDN 403 / 5xx no longer kills a
// whole carousel slot. Failures are logged with structured context
// so partial-carousel persistence has provenance for every dropped
// slide; the call site (processInstagramRow / processFacebookRow)
// already routes a length < expected result into persistPartialResult.
async function downloadCarousel(
  list: MediaUrls[],
  ctx?: { rowKey?: string | null; adLink?: string | null },
): Promise<AdResearchBoardMediaItem[]> {
  const slides = list.slice(0, MAX_CAROUSEL_SLIDES);
  const out: AdResearchBoardMediaItem[] = [];
  for (let idx = 0; idx < slides.length; idx += 1) {
    const m = slides[idx];
    const outcome = await downloadSingleSlideWithRecovery(m);
    if (outcome.item) {
      out.push(outcome.item);
      if (outcome.attempts > 1) {
        logger.info(
          {
            event: "carousel-slide-recovered",
            slideIndex: idx,
            attempts: outcome.attempts,
            failedCandidates: outcome.failures.length,
            rowKey: ctx?.rowKey ?? null,
            adLink: ctx?.adLink ?? null,
          },
          "media-downloader: carousel slide recovered after retry",
        );
      }
    } else {
      logger.warn(
        {
          event: "carousel-slide-failed",
          slideIndex: idx,
          attempts: outcome.attempts,
          failures: outcome.failures,
          rowKey: ctx?.rowKey ?? null,
          adLink: ctx?.adLink ?? null,
        },
        "media-downloader: carousel slide failed all candidates",
      );
    }
  }
  return out;
}

async function processOtherRow(row: PendingRow): Promise<void> {
  // Task #196 + Task #209: structurally non-extractable URLs are
  // persisted as failed and dismissed immediately so they never burn a
  // yt-dlp / Apify attempt. Two intake-rejection shapes added in T209
  // (`fb-photo-php`, `ig-profile-only`) are persisted under the new
  // `unsupported-input` error prefix so deriveRecoveryClass routes
  // them to the dedicated `unsupported-input` recovery class; all
  // other shapes keep the legacy `unsupported-url` prefix that maps
  // to `invalid-input` for backward compatibility with the existing
  // dashboard counter.
  const verdict = isUnsupportedExtractionUrl(row.adLink);
  if (verdict.unsupported) {
    await markDownloading([row.id]);
    // T209: parse-fail → unsupported-url (invalid-input); structural → unsupported-input.
    const isParseFail = verdict.reason === "invalid-url" || verdict.reason === "non-http-scheme";
    await persistResult(row, {
      ok: false,
      error: `${isParseFail ? "unsupported-url" : "unsupported-input"}: ${verdict.reason}`,
    });
    return;
  }
  await markDownloading([row.id]);
  try {
    if (isLikelyImageUrl(row.adLink)) {
      const direct = await fetchImageDirect(row.adLink);
      if (direct) {
        const ct = contentTypeFor(direct.ext);
        const path = await uploadToObjectStorage(direct.buf, direct.ext, ct);
        await persistResult(
          row,
          { ok: true, kind: "image", objectPath: path, contentType: ct, bytes: direct.buf.length },
          { isCarousel: false, expectedSlides: 1, source: "direct", retryStrategy: "primary" },
        );
        return;
      }
    }
    const yt = await runYtDlpWithAuthWallEscalation(row.adLink, { rowKey: row.rowKey, adLink: row.adLink, strategy: "other-row" });
    await persistResult(row, yt, {
      isCarousel: false,
      expectedSlides: 1,
      source: yt.effectiveSource ?? "yt-dlp",
      retryStrategy: "primary",
    });
  } catch (err: any) {
    await persistResult(row, { ok: false, error: (err?.message || String(err)).slice(0, 300) });
  }
}

// Task #186: one-time admin backfill. Walks every video row that has a
// cached mp4 in object storage but no `media_thumbnail_object_path` yet,
// downloads the cached video back into a tempfile, runs ffmpeg to render
// the first-frame poster, and uploads it to research-media/thumbnails/.
// Bounded by `limit` and processed serially so a backfill of thousands
// of rows can't pin every Apify worker or the storage proxy. Safe to
// re-run; rows that already have a thumbnail are skipped by the WHERE.
export async function backfillVideoThumbnails(opts?: {
  limit?: number;
}): Promise<{
  scanned: number;
  updated: number;
  updatedFromExtraction: number;
  updatedFromLocalPoster: number;
  failed: number;
}> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 1000));
  // Two-bucket selection: rows with NO thumbnail at all, AND rows whose
  // existing thumbnail came from the ffmpeg fallback but still carry a
  // platform source URL we can re-attempt for a sharper extraction. The
  // latter lets a transient platform 503 at original capture time get
  // healed by the next backfill pass instead of being stuck on the local
  // poster forever.
  const rows = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      mediaObjectPath: adResearchBoardItems.mediaObjectPath,
      mediaContentType: adResearchBoardItems.mediaContentType,
      mediaItems: adResearchBoardItems.mediaItems,
      mediaThumbnailObjectPath: adResearchBoardItems.mediaThumbnailObjectPath,
      mediaThumbnailSource: adResearchBoardItems.mediaThumbnailSource,
      mediaThumbnailSourceUrl: adResearchBoardItems.mediaThumbnailSourceUrl,
    })
    .from(adResearchBoardItems)
    .where(
      and(
        eq(adResearchBoardItems.mediaKind, "video"),
        inArray(adResearchBoardItems.mediaStatus, ["ok", "partial"]),
        isNotNull(adResearchBoardItems.mediaObjectPath),
        or(
          isNull(adResearchBoardItems.mediaThumbnailObjectPath),
          and(
            eq(adResearchBoardItems.mediaThumbnailSource, "local-poster"),
            isNotNull(adResearchBoardItems.mediaThumbnailSourceUrl),
          ),
        ),
      ),
    )
    // Deterministic ordered cursor by id ASC. Combined with the WHERE
    // clause (which excludes already-thumbnailed rows the moment a row
    // is updated), each repeated batch run advances strictly forward
    // through the long tail and we never re-pick the same persistent-
    // failure rows over and over while leaving the rest unprocessed.
    .orderBy(adResearchBoardItems.id)
    .limit(limit);
  let updated = 0;
  let updatedFromExtraction = 0;
  let updatedFromLocalPoster = 0;
  let failed = 0;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  for (const row of rows) {
    if (!row.mediaObjectPath) { failed++; continue; }
    let workdir: string | null = null;
    try {
      // Priority #1: re-fetch the original platform poster URL when we
      // have one stashed. Sharper than ffmpeg, and re-tries after a
      // transient platform failure during original capture.
      const sourceUrl = row.mediaThumbnailSourceUrl
        ?? (Array.isArray(row.mediaItems) ? row.mediaItems[0]?.thumbnailSourceUrl ?? null : null);
      let thumb: { buf: Buffer; ext: string; contentType: string } | null = null;
      let source: "extraction" | "local-poster" | null = null;
      if (sourceUrl) {
        thumb = await fetchThumbnailBuffer(sourceUrl);
        if (thumb) source = "extraction";
      }
      // Priority #2: ffmpeg first-frame from the cached video. Only
      // useful for rows that had no thumbnail at all - we don't want
      // to overwrite an existing local-poster with an identical local-
      // poster on every pass.
      if (!thumb && !row.mediaThumbnailObjectPath) {
        const objectsPrefix = "/objects/";
        if (!row.mediaObjectPath.startsWith(objectsPrefix)) { failed++; continue; }
        const rel = row.mediaObjectPath.slice(objectsPrefix.length);
        const fullPath = `${privateDir.replace(/\/$/, "")}/${rel}`;
        const { bucket, object } = parseGcsPath(fullPath);
        workdir = await mkdtemp(join(tmpdir(), "thumb-bf-"));
        const ext = (extname(row.mediaObjectPath).toLowerCase().replace(".", "") || "mp4");
        const localPath = join(workdir, `media.${ext}`);
        const [buf] = await objectStorageClient.bucket(bucket).file(object).download();
        await writeFile(localPath, buf);
        thumb = await generatePosterFromVideoFile(localPath);
        if (thumb) source = "local-poster";
      }
      if (!thumb || !source) { failed++; continue; }
      const thumbPath = await uploadThumbnailToObjectStorage(thumb.buf, thumb.ext, thumb.contentType);
      await db
        .update(adResearchBoardItems)
        .set({
          mediaThumbnailObjectPath: thumbPath,
          mediaThumbnailContentType: thumb.contentType,
          mediaThumbnailSource: source,
          mediaThumbnailSourceUrl: source === "extraction" ? sourceUrl : row.mediaThumbnailSourceUrl ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(adResearchBoardItems.id, row.id));
      updated++;
      if (source === "extraction") updatedFromExtraction++; else updatedFromLocalPoster++;
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), rowKey: row.rowKey },
        "media-downloader: thumbnail backfill row failed",
      );
      failed++;
    } finally {
      if (workdir) {
        try { await rm(workdir, { recursive: true, force: true }); } catch {}
      }
    }
  }
  logger.info(
    { scanned: rows.length, updated, updatedFromExtraction, updatedFromLocalPoster, failed, limit },
    "media-downloader: thumbnail backfill pass done",
  );
  return { scanned: rows.length, updated, updatedFromExtraction, updatedFromLocalPoster, failed };
}

// One-shot admin backfill: scans cached video rows, downloads each
// cached object back into a tempfile, runs ffprobe to detect a missing
// audio track, and requeues offending rows so the Media Worker re-fetches
// them through the now-audio-aware download path. Idempotent: rows that
// pass the probe are left alone, and rows that are requeued get
// `mediaError='no-audio-track'` so the action shows up in the admin
// dashboard's diagnostic log.
export async function backfillVideosMissingAudio(opts?: {
  limit?: number;
}): Promise<{
  scanned: number;
  requeued: number;
  okWithAudio: number;
  probeFailed: number;
}> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 1000));
  const rows = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      mediaObjectPath: adResearchBoardItems.mediaObjectPath,
    })
    .from(adResearchBoardItems)
    .where(
      and(
        eq(adResearchBoardItems.mediaKind, "video"),
        // T370: scan ok/partial AND silent-source rows so the
        // backfill can re-evaluate ads cached before the hardened
        // gate landed (including legacy silent-source rows that an
        // earlier implementation auto-dismissed).
        inArray(adResearchBoardItems.mediaStatus, ["ok", "partial", "silent-source"]),
        isNotNull(adResearchBoardItems.mediaObjectPath),
      ),
    )
    .orderBy(adResearchBoardItems.id)
    .limit(limit);
  let requeued = 0;
  let okWithAudio = 0;
  let probeFailed = 0;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    // Non-fatal: return empty diagnostics so the admin endpoint can
    // surface a clean error message instead of 500'ing. Mirrors how
    // the rest of the worker fails open when storage isn't configured.
    logger.warn(
      { scanned: rows.length },
      "media-downloader: no-audio backfill skipped, PRIVATE_OBJECT_DIR not set",
    );
    return { scanned: rows.length, requeued: 0, okWithAudio: 0, probeFailed: rows.length };
  }
  for (const row of rows) {
    if (!row.mediaObjectPath) { probeFailed++; continue; }
    let workdir: string | null = null;
    try {
      const objectsPrefix = "/objects/";
      if (!row.mediaObjectPath.startsWith(objectsPrefix)) { probeFailed++; continue; }
      const rel = row.mediaObjectPath.slice(objectsPrefix.length);
      const fullPath = `${privateDir.replace(/\/$/, "")}/${rel}`;
      const { bucket, object } = parseGcsPath(fullPath);
      workdir = await mkdtemp(join(tmpdir(), "audio-bf-"));
      const ext = (extname(row.mediaObjectPath).toLowerCase().replace(".", "") || "mp4");
      const localPath = join(workdir, `media.${ext}`);
      const [buf] = await objectStorageClient.bucket(bucket).file(object).download();
      await writeFile(localPath, buf);
      const hasAudio = await videoFileHasAudioTrack(localPath);
      if (hasAudio === true) {
        okWithAudio++;
        continue;
      }
      if (hasAudio === null) {
        probeFailed++;
        continue;
      }
      // hasAudio === false: requeue this row. Reset attempts so the
      // worker actually retries (otherwise an already-exhausted row
      // would be skipped). Clear mediaDownloadedAt so the queue idx
      // re-orders it correctly. T370: also clear the cached object
      // pointers and recovery columns so the hardened download chain
      // re-fetches from scratch (rather than re-pointing at the same
      // silent file) and so previously dismissed silent-source rows
      // come back live.
      await db
        .update(adResearchBoardItems)
        .set({
          mediaStatus: "pending",
          mediaError: "no-audio-track",
          mediaErrorClass: null,
          mediaAttempts: 0,
          mediaDownloadedAt: null,
          mediaObjectPath: null,
          mediaContentType: null,
          mediaItems: null,
          recoveryClass: null,
          recoveryStrategy: null,
          retryAfterAt: null,
          dismissed: false,
          updatedAt: sql`now()`,
        })
        .where(eq(adResearchBoardItems.id, row.id));
      requeued++;
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), rowKey: row.rowKey },
        "media-downloader: no-audio backfill row failed",
      );
      probeFailed++;
    } finally {
      if (workdir) {
        try { await rm(workdir, { recursive: true, force: true }); } catch {}
      }
    }
  }
  logger.info(
    { scanned: rows.length, requeued, okWithAudio, probeFailed, limit },
    "media-downloader: no-audio backfill pass done",
  );
  return { scanned: rows.length, requeued, okWithAudio, probeFailed };
}

// Companion backfill for rows whose source URL is a video kind
// (instagram-reel, facebook-reel, facebook-video, direct-video) but
// whose cached `media_kind` is "image" — i.e. the post thumbnail was
// silently saved instead of the actual video. Requeues offenders so
// the now-video-aware download path re-fetches them via yt-dlp.
// Idempotent: video-kind rows already cached as video are left alone.
export async function backfillVideoKindRowsCachedAsImage(opts?: {
  limit?: number;
}): Promise<{ scanned: number; requeued: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 1000));
  const rows = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      adLink: adResearchBoardItems.adLink,
      urlKind: adResearchBoardItems.urlKind,
    })
    .from(adResearchBoardItems)
    .where(
      and(
        eq(adResearchBoardItems.mediaKind, "image"),
        inArray(adResearchBoardItems.mediaStatus, ["ok", "partial"]),
        eq(adResearchBoardItems.dismissed, false),
        inArray(adResearchBoardItems.urlKind, [
          "instagram-reel",
          "facebook-reel",
          "facebook-video",
          "direct-video",
        ]),
      ),
    )
    .orderBy(adResearchBoardItems.id)
    .limit(limit);
  let requeued = 0;
  for (const row of rows) {
    await db
      .update(adResearchBoardItems)
      .set({
        mediaStatus: "pending",
        mediaError: "video-cached-as-image",
        mediaAttempts: 0,
        mediaDownloadedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(adResearchBoardItems.id, row.id));
    requeued++;
  }
  logger.info(
    { scanned: rows.length, requeued, limit },
    "media-downloader: video-cached-as-image backfill pass done",
  );
  return { scanned: rows.length, requeued };
}

let inFlightProcessor: Promise<void> | null = null;

export function processPendingMediaInBackground(opts?: {
  sessionId?: number;
  sessionSummary?: Record<string, unknown>;
}): void {
  if (inFlightProcessor) {
    // Task #229 follow-up: a sync triggered the processor while another
    // run is still draining. We can't keep the new session "running"
    // through the in-flight cycle, so close it immediately rather than
    // leaving a dangling running row. The next periodic pass will pick
    // up any newly-synced rows.
    logger.info("media-downloader: processor already running, skipping new trigger");
    if (opts?.sessionId) {
      void import("./sync-session")
        .then((m) => m.completeSyncSession(opts.sessionId!, {
          status: "completed",
          summary: { ...(opts.sessionSummary || {}), processorDeferred: true },
        }))
        .catch(() => { /* best-effort */ });
    }
    return;
  }
  const sessionId = opts?.sessionId;
  inFlightProcessor = processPendingMedia(sessionId)
    .catch((err) => logger.error({ err }, "media-downloader: processor crashed"))
    .finally(async () => {
      inFlightProcessor = null;
      if (sessionId) {
        try {
          const m = await import("./sync-session");
          await m.recordSessionEvent(sessionId, {
            kind: "extraction_completed",
            message: "media processor pass complete",
          });
          await m.completeSyncSession(sessionId, {
            status: "completed",
            summary: opts?.sessionSummary || null,
          });
        } catch (err) {
          logger.warn({ err, sessionId }, "media-downloader: failed to close session after processor");
        }
      }
    });
}

async function processPendingMedia(sessionId?: number): Promise<void> {
  if (sessionId) {
    void import("./sync-session")
      .then((m) => m.recordSessionEvent(sessionId, {
        kind: "extraction_started",
        message: "media processor pass started",
      }))
      .catch(() => { /* best-effort */ });
  }
  // Task #197: `cutoff` is still used by the stuck-`downloading` recovery
  // branch (legacy fallback for rows pre-dating lease columns). The
  // separate `transientCutoff` + `TRANSIENT_RETRY_CLASSES` plumbing
  // that previously gated failed-row re-claim was removed when
  // retry_after_at became the sole retry gate.
  const cutoff = new Date(Date.now() - RETRY_BACKOFF_MINUTES * 60 * 1000);
  const pending = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      // Task #197: queue feeds the worker the canonical (normalized)
      // URL when one was persisted at sync time. The raw adLink is
      // retained on the row for audit / dashboard display, but every
      // downstream extractor (Apify, yt-dlp, share-resolver) now sees
      // the normalized identity, so dedupe and per-kind routing line
      // up with what we tell admins they are processing. COALESCE
      // gracefully covers the legacy case where normalized_url has
      // not been backfilled yet.
      adLink: sql<string>`COALESCE(${adResearchBoardItems.normalizedUrl}, ${adResearchBoardItems.adLink})`,
      rawAdLink: adResearchBoardItems.adLink,
      attempts: adResearchBoardItems.mediaAttempts,
      // Task #134: read the cached canonical URL so per-kind processors
      // can skip share-redirect re-resolution on subsequent passes.
      resolvedUrl: adResearchBoardItems.resolvedUrl,
      // Task #197: prior recovery class + first-failure timestamp so the
      // success branch can bucket the recovery (auth/extractor/temporary)
      // and approximate the end-to-end recovery latency without an extra
      // round-trip.
      priorRecoveryClass: adResearchBoardItems.recoveryClass,
      firstFailedAt: adResearchBoardItems.mediaStartedAt,
      // T374: read the prior persisted mediaKind so persistResult /
      // persistMultiResult can refuse a silent video → image downgrade
      // on re-resolution (typically a refetch that resolves the cover
      // thumbnail variant instead of the underlying video). The
      // underlying column is `text`, but the only values the
      // downloader ever writes are 'video' / 'image' / null - the
      // sql<> cast narrows the inferred row type accordingly without
      // bypassing typing.
      priorMediaKind: sql<"video" | "image" | null>`${adResearchBoardItems.mediaKind}`,
    })
    .from(adResearchBoardItems)
    .where(
      and(
        // Task #197: honor the delayed-retry ladder. A row with a future
        // retry_after_at is intentionally held back until the wall-clock
        // catches up, so the periodic processor doesn't burn quota
        // hammering the same upstream condition. NULL retry_after_at
        // (legacy rows + freshly synced rows) bypasses the gate.
        or(
          isNull(adResearchBoardItems.retryAfterAt),
          lt(adResearchBoardItems.retryAfterAt, sql`now()`),
        ),
        // Skip rows the admin or the downloader has already dismissed —
        // we should never re-attempt them or they'd just re-fail and burn
        // CPU + Apify quota every cycle.
        eq(adResearchBoardItems.dismissed, false),
        // Task #137 (next-stage): never select a row whose lease is
        // still alive in another worker. Self-owned leases (this same
        // WORKER_ID) are still selectable since claimRowsForProcessing
        // will refresh the lease atomically.
        or(
          isNull(adResearchBoardItems.mediaLeaseUntil),
          lt(adResearchBoardItems.mediaLeaseUntil, sql`now()`),
          eq(adResearchBoardItems.mediaLeaseOwner, WORKER_ID),
        ),
        or(
          isNull(adResearchBoardItems.mediaStatus),
          eq(adResearchBoardItems.mediaStatus, "pending"),
          and(
            eq(adResearchBoardItems.mediaStatus, "failed"),
            lt(adResearchBoardItems.mediaAttempts, MAX_ATTEMPTS),
            // Task #197: retry_after_at is now the SINGLE retry gate
            // for failed rows. The 10m / 1h / 6h ladder is fully
            // expressed in retry_after_at by computeRetrySchedule(),
            // so the legacy mediaDownloadedAt cooldown
            // (RETRY_BACKOFF_MINUTES / TRANSIENT_RETRY_BACKOFF_MIN)
            // would only delay short-ladder retries (e.g. a
            // 10-minute step is otherwise blocked by the legacy
            // 15-minute floor). The top-level WHERE clause already
            // gates on retry_after_at IS NULL OR retry_after_at <=
            // now(), which both honors the ladder for fresh failures
            // and preserves "no gate" semantics for legacy rows that
            // pre-date the ladder columns.
          ),
          // Task #137: stuck-row recovery. Rows can get pinned in
          // `downloading` if the worker crashed (process restart, OOM,
          // unhandled rejection that escaped parallelMap before the
          // safety belt was added) before persistResult fired. Two
          // independent triggers:
          //   1. Lease expired (fast: ~2min after worker death).
          //   2. mediaDownloadedAt past 15min backoff (legacy fallback
          //      for rows from before lease columns were added).
          // Either one is sufficient; together they make recovery both
          // fast and back-compatible.
          and(
            eq(adResearchBoardItems.mediaStatus, "downloading"),
            lt(adResearchBoardItems.mediaAttempts, MAX_ATTEMPTS),
            or(
              and(
                isNotNull(adResearchBoardItems.mediaLeaseUntil),
                lt(adResearchBoardItems.mediaLeaseUntil, sql`now()`),
              ),
              isNull(adResearchBoardItems.mediaDownloadedAt),
              lt(adResearchBoardItems.mediaDownloadedAt, cutoff),
            ),
          ),
        ),
      ),
    )
    // Task #137 (scaling pass): fairness + prioritization. Within a single
    // pass we serve work in this order so a backlog of stuck retries can
    // never starve a manual admin refetch or a fresh sync row:
    //   1. mediaPriority ASC (manual=10, fresh=20, default=50, recovery=80)
    //   2. derived class: fresh-and-untried < retries < stuck-recovery
    //   3. mediaAttempts ASC (low-attempt rows first within the same class)
    //   4. id ASC (stable tie-break for predictable progression)
    // The MAX_CANDIDATES_PER_PASS LIMIT applies after this ORDER BY so the
    // most important work is always picked up first; lower-priority rows
    // wait for the next pass on the periodic timer.
    .orderBy(
      asc(adResearchBoardItems.mediaPriority),
      sql`CASE
        WHEN ${adResearchBoardItems.mediaStatus} IS NULL OR (${adResearchBoardItems.mediaStatus} = 'pending' AND ${adResearchBoardItems.mediaAttempts} = 0) THEN 0
        WHEN ${adResearchBoardItems.mediaStatus} = 'downloading' THEN 2
        ELSE 1
      END`,
      asc(adResearchBoardItems.mediaAttempts),
      asc(adResearchBoardItems.id),
    )
    .limit(MAX_CANDIDATES_PER_PASS);

  if (pending.length === 0) {
    logger.info("media-downloader: nothing to process");
    return;
  }

  // Task #196: pre-claim filter for structurally non-extractable URLs.
  // Persist failed + dismissed (so the queue counter clears) for any
  // row whose URL is unsupported (reel.farm, dashboard / internal hosts,
  // non-http schemes, malformed redirects, bare hostnames). These rows
  // never reach yt-dlp / Apify so they don't burn extractor capacity or
  // a retry slot. Done BEFORE the lease claim so two workers don't race
  // on the same dismissal.
  const unsupportedRows = pending.filter((p) => isUnsupportedExtractionUrl(p.adLink).unsupported);
  if (unsupportedRows.length > 0) {
    for (const row of unsupportedRows) {
      const verdict = isUnsupportedExtractionUrl(row.adLink);
      const newAttempts = (row.attempts ?? 0) + 1;
      // T209: parse-fail → invalid-input; structural rejection → unsupported-input.
      const isParseFail = verdict.reason === "invalid-url" || verdict.reason === "non-http-scheme";
      const errPrefix = isParseFail ? "unsupported-url" : "unsupported-input";
      const errClass = isParseFail ? "unsupported-url" : "unsupported-input";
      const recClass = isParseFail ? "invalid-input" : "unsupported-input";
      const recStrategy = isParseFail ? "permanent-dismiss-invalid" : "permanent-dismiss-unsupported";
      try {
        await db
          .update(adResearchBoardItems)
          .set({
            // Task #197: structurally invalid URLs use the dedicated
            // `invalid` mediaStatus so they never collide with the
            // failed/retry pool. dismissed=true is the redundant belt
            // (the pre-claim SELECT also won't match `invalid`).
            mediaStatus: "invalid",
            mediaError: `${errPrefix}: ${verdict.reason}`,
            mediaErrorClass: errClass,
            recoveryClass: recClass,
            recoveryStrategy: recStrategy,
            retryAfterAt: null,
            mediaAttempts: MAX_ATTEMPTS,
            dismissed: true,
            mediaLeaseOwner: null,
            mediaLeaseUntil: null,
            mediaDownloadedAt: new Date(),
            // Task #309: stamp outcome change on pre-claim invalid/unsupported dismiss.
            mediaOutcomeChangedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(adResearchBoardItems.id, row.id));
        providerCounters.invalidUrlsBlocked += 1;
        bumpAdResearchLiveSession({ invalidUrls: 1 });
        logger.warn(
          {
            rowKey: row.rowKey,
            adLink: row.adLink,
            reason: verdict.reason,
            attempts: newAttempts,
            strategy: "unsupported-url-pre-claim",
          },
          "media-downloader: dismissed unsupported url before extraction",
        );
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err), rowKey: row.rowKey },
          "media-downloader: failed to persist unsupported-url dismissal",
        );
      }
    }
  }
  const filteredPending = pending.filter((p) => !isUnsupportedExtractionUrl(p.adLink).unsupported);
  if (filteredPending.length === 0) {
    logger.info(
      { unsupported: unsupportedRows.length },
      "media-downloader: nothing to process after unsupported-url filter",
    );
    return;
  }
  // Reuse the rest of the pipeline with the filtered set.
  pending.length = 0;
  pending.push(...filteredPending);

  // Task #137: structured log for the stuck-row recovery branch so an
  // admin can see, per pass, exactly which rows we re-picked from a
  // crashed/timed-out previous attempt. Cheap second SELECT bounded to
  // the same id set so it never widens the working set.
  try {
    const ids = pending.map((p) => p.id);
    const stuckRows = await db
      .select({ id: adResearchBoardItems.id, rowKey: adResearchBoardItems.rowKey, adLink: adResearchBoardItems.adLink, attempts: adResearchBoardItems.mediaAttempts })
      .from(adResearchBoardItems)
      .where(
        and(
          inArray(adResearchBoardItems.id, ids),
          eq(adResearchBoardItems.mediaStatus, "downloading"),
        ),
      );
    if (stuckRows.length > 0) {
      logger.warn(
        {
          count: stuckRows.length,
          rows: stuckRows.map((r) => ({ rowKey: r.rowKey, adLink: r.adLink, attempts: r.attempts })),
          strategy: "stuck-row-recovery",
        },
        "media-downloader: re-picked stuck downloading rows past backoff",
      );
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: stuck-row recovery log query failed",
    );
  }

  // Task #137 (next-stage): atomic claim. We narrow the SELECT-derived
  // candidate set to only rows we actually won. Anything we lose to
  // another live worker simply waits for the next pass; we never block
  // on it. This is the single biggest correctness win of the lease
  // system: no more "two replicas redownload the same row twice and
  // both write conflicting object paths" race.
  const candidateIds = pending.map((p) => p.id);
  const claimedIds = await claimRowsForProcessing(candidateIds);
  const claimedSet = new Set(claimedIds);
  const claimedRows = pending.filter((p) => claimedSet.has(p.id));
  const lostCount = candidateIds.length - claimedIds.length;
  if (lostCount > 0) {
    logger.info(
      { lostToOtherWorkers: lostCount, claimed: claimedIds.length, candidates: candidateIds.length, workerId: WORKER_ID },
      "media-downloader: yielded rows to another live worker (lease held)",
    );
  }
  if (claimedRows.length === 0) {
    logger.info("media-downloader: nothing claimed this pass");
    return;
  }

  const insta: PendingRow[] = [];
  const fb: PendingRow[] = [];
  const other: PendingRow[] = [];
  for (const row of claimedRows) {
    if (isInstagramUrl(row.adLink)) insta.push(row);
    else if (isFacebookUrl(row.adLink)) fb.push(row);
    else other.push(row);
  }

  logger.info(
    {
      claimed: claimedRows.length,
      instagram: insta.length,
      facebook: fb.length,
      other: other.length,
      workerId: WORKER_ID,
    },
    "media-downloader: processing queue (batched, leased)",
  );

  // Task #137 (next-stage): start the lease heartbeat for the duration
  // of this pass. We extend every owned still-in-flight row's lease
  // every LEASE_HEARTBEAT_MS so a long Apify chunk (~90s typical, 2min
  // hard cap) never expires its lease mid-pass. Stopped in the finally
  // block below regardless of whether the pass succeeded.
  const heartbeat = setInterval(() => {
    extendLeasesForOwnedRows().then((extended) => {
      if (extended > 0) {
        logger.info(
          { extended, workerId: WORKER_ID },
          "media-downloader: lease heartbeat extended in-flight rows",
        );
      }
    });
  }, LEASE_HEARTBEAT_MS);
  // Make sure the heartbeat doesn't keep the event loop alive at
  // shutdown. The lease will simply expire if we crash, which is the
  // entire point of the recovery branch.
  heartbeat.unref?.();

  // Bounded global concurrency. Lifted from 1 → 2 chunks per platform
  // for the next-stage hardening: a single Apify chunk can stall on a
  // slow IG fetch for up to APIFY_BATCH_TIMEOUT_MS (2min), and with
  // PARALLELISM=1 the entire IG queue blocks behind it. Two chunks in
  // flight gives ~2x throughput on large boards while still leaving DB
  // pool + Apify quota headroom (typical APIFY_BATCH_SIZE=25 means at
  // most 50 IG + 50 FB rows in flight at once).
  const BATCH_PARALLELISM = 2;
  const instaChunks: PendingRow[][] = [];
  for (let i = 0; i < insta.length; i += APIFY_BATCH_SIZE) {
    instaChunks.push(insta.slice(i, i + APIFY_BATCH_SIZE));
  }
  const fbChunks: PendingRow[][] = [];
  for (let i = 0; i < fb.length; i += APIFY_BATCH_SIZE) {
    fbChunks.push(fb.slice(i, i + APIFY_BATCH_SIZE));
  }

  try {
    await Promise.all([
      parallelMap(instaChunks, BATCH_PARALLELISM, processInstagramBatch),
      parallelMap(fbChunks, BATCH_PARALLELISM, processFacebookBatch),
      other.length
        ? parallelMap(other, FETCH_CONCURRENCY, processOtherRow)
        : Promise.resolve(),
    ]);
  } finally {
    clearInterval(heartbeat);
  }

  logger.info({ workerId: WORKER_ID, processed: claimedRows.length }, "media-downloader: queue drained");
}

export async function refetchMediaForRow(itemId: number): Promise<DownloadResult> {
  const [row] = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      adLink: adResearchBoardItems.adLink,
      attempts: adResearchBoardItems.mediaAttempts,
      resolvedUrl: adResearchBoardItems.resolvedUrl,
      // T374: snapshot the prior persisted mediaKind BEFORE clearing
      // cached pointers below so the persist guard can refuse a silent
      // video → image downgrade (refetch resolving to the cover
      // thumbnail variant instead of the underlying video). Underlying
      // column is `text`; sql<> narrows the inferred row type to the
      // values the downloader actually writes without resorting to a
      // structural `as any`.
      priorMediaKind: sql<"video" | "image" | null>`${adResearchBoardItems.mediaKind}`,
    })
    .from(adResearchBoardItems)
    .where(eq(adResearchBoardItems.id, itemId));
  if (!row) return { ok: false, error: "row not found" };

  // Task #137 (next-stage): refetch also takes a lease so two simultaneous
  // refetch requests for the same row can't double-download. The lease
  // is cleared inside persistResult / persistMultiResult / persistPartialResult.
  await markDownloading([itemId]);
  // Task #137 (scaling pass): manual refetch is the highest-priority work
  // we have. Bump priority so any future re-queue (e.g. user self-heal)
  // also jumps the line if this attempt fails and falls back to retry.
  //
  // T370: admin "Re-fetch media" must always invalidate the cached
  // download state and re-run the audio gate from scratch. Reset
  // attempts to 0, clear dismissed (so a previously silent-source /
  // dead-content row can re-attempt), null out cached object pointers
  // so a probe-blip-cached silent video isn't re-served from cache,
  // and clear retry-after so the next worker tick picks it up
  // immediately. mediaError / mediaErrorClass were already cleared by
  // markDownloading.
  await db
    .update(adResearchBoardItems)
    .set({
      mediaPriority: 10,
      mediaAttempts: 0,
      dismissed: false,
      mediaObjectPath: null,
      mediaContentType: null,
      mediaItems: null,
      // T374: clear cached thumbnail pointers too. The previous reset
      // left these intact, so a refetched row could keep rendering an
      // old cover thumbnail in the grid even after the underlying
      // mediaObjectPath was nulled - and on a video → image guard
      // trip the row would fall back to a stale thumbnail it should
      // have invalidated. Hard-reset all cached media-identity
      // pointers so the row is uniformly "no cached media" until the
      // re-resolution writes new ones.
      mediaThumbnailObjectPath: null,
      mediaThumbnailContentType: null,
      mediaThumbnailSource: null,
      mediaThumbnailSourceUrl: null,
      retryAfterAt: null,
      recoveryClass: null,
      recoveryStrategy: null,
    })
    .where(eq(adResearchBoardItems.id, itemId));

  // Try the carousel-aware path first for IG/FB so refetch picks up all
  // slides, not just the cover. This mirrors the batch-processor logic
  // including the residential-proxy + secondary-actor retry chain for IG.
  // Facebook is handled by the dedicated `else if (isFacebookUrl(...))`
  // branch below which already calls resolveFacebookShareUrl to follow
  // share-link redirects before resolving the post.
  if (isInstagramUrl(row.adLink)) {
    const map = await batchResolveInstagram([row.adLink]);
    const id = urlIdentity(row.adLink);
    const seed = id ? map.get(id) ?? null : null;
    const best = await resolveInstagramRowWithRetries(row, seed);
    if (best && best.slides.length) {
      const expected = Math.max(
        best.carousel.expectedSlides,
        best.carousel.isCarousel ? best.slides.length : 1,
      );
      const downloaded = await downloadCarousel(best.slides, { rowKey: row.rowKey, adLink: row.adLink });
      const target = best.carousel.isCarousel
        ? Math.min(expected, MAX_CAROUSEL_SLIDES)
        : 1;
      if (downloaded.length > 0 && (!best.carousel.isCarousel || downloaded.length >= target)) {
        await persistMultiResult(row, downloaded, buildMeta(best, expected, "primary"));
        return {
          ok: true,
          kind: downloaded[0].kind,
          objectPath: downloaded[0].objectPath,
          contentType: downloaded[0].contentType,
        };
      }
      if (best.carousel.isCarousel && downloaded.length > 0) {
        // Task #134: incomplete carousel is PARTIAL, not failed - keep the
        // captured slides visible to users (mirrors processInstagramBatch).
        const errMsg = `carousel: only ${downloaded.length}/${target} slides captured`;
        await persistPartialResult(
          row,
          downloaded,
          { ...buildMeta(best, expected, "primary"), capturedSlides: downloaded.length },
          errMsg,
        );
        return {
          ok: true,
          kind: downloaded[0].kind,
          objectPath: downloaded[0].objectPath,
          contentType: downloaded[0].contentType,
        };
      }
    }
    if (best?.carousel.isCarousel) {
      const errMsg = `carousel: 0/${best.carousel.expectedSlides} slides captured (apify exhausted)`;
      await persistResult(
        row,
        { ok: false, error: errMsg },
        buildMeta(best, best.carousel.expectedSlides, "primary"),
      );
      return { ok: false, error: errMsg };
    }
  } else if (isFacebookUrl(row.adLink)) {
    // Task #134: reuse cached resolved_url across passes; only call
    // resolveFacebookShareUrl when no canonical is cached. Mirrors
    // processFacebookBatch so admin reruns and background passes converge.
    let canonical: string | null = row.resolvedUrl;
    if (!canonical && isFacebookShareUrl(row.adLink)) {
      canonical = await resolveFacebookShareUrl(row.adLink, { rowKey: row.rowKey, adLink: row.adLink, strategy: "fb-other-row" });
      if (canonical && canonical !== row.adLink) {
        await persistResolvedUrl(row.id, canonical);
      } else {
        // Share-locked TERMINAL: pin attempts to MAX_ATTEMPTS + dismiss so
        // we don't burn another retry slot every cycle.
        const errMsg = "share-url-locked";
        await db
          .update(adResearchBoardItems)
          .set({
            // Task #401: terminal exhaustion - see note on the batch
            // share-locked write above. `failed_permanent` keeps the
            // live-health badge from flagging these forever.
            mediaStatus: "failed_permanent",
            mediaError: errMsg,
            mediaErrorClass: classifyError(errMsg),
            mediaAttempts: MAX_ATTEMPTS,
            dismissed: true,
            // Task #309: stamp outcome change on single-row share-locked terminal dismiss.
            mediaOutcomeChangedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(adResearchBoardItems.id, row.id));
        logger.warn(
          { rowKey: row.rowKey, adLink: row.adLink },
          "media-downloader: share-url-locked (refetch terminal)",
        );
        return { ok: false, error: errMsg };
      }
    }
    const effective = canonical || row.adLink;
    const map = await batchResolveFacebook([effective]);
    const id = urlIdentity(effective) || urlIdentity(row.adLink);
    const seed = id ? map.get(id) ?? null : null;
    if (seed && seed.slides.length) {
      const expected = Math.max(
        seed.carousel.expectedSlides,
        seed.carousel.isCarousel ? seed.slides.length : 1,
      );
      const downloaded = await downloadCarousel(seed.slides, { rowKey: row.rowKey, adLink: row.adLink });
      const target = seed.carousel.isCarousel
        ? Math.min(expected, MAX_CAROUSEL_SLIDES)
        : 1;
      if (downloaded.length > 0 && (!seed.carousel.isCarousel || downloaded.length >= target)) {
        await persistMultiResult(row, downloaded, buildMeta(seed, expected, "primary"));
        return {
          ok: true,
          kind: downloaded[0].kind,
          objectPath: downloaded[0].objectPath,
          contentType: downloaded[0].contentType,
        };
      }
      if (seed.carousel.isCarousel && downloaded.length > 0) {
        // Task #134: incomplete carousel is PARTIAL (mirrors processFacebookBatch).
        const errMsg = `carousel: only ${downloaded.length}/${target} slides captured`;
        await persistPartialResult(
          row,
          downloaded,
          { ...buildMeta(seed, expected, "primary"), capturedSlides: downloaded.length },
          errMsg,
        );
        return {
          ok: true,
          kind: downloaded[0].kind,
          objectPath: downloaded[0].objectPath,
          contentType: downloaded[0].contentType,
        };
      }
    }
    if (seed?.carousel.isCarousel) {
      const errMsg = `carousel: 0/${seed.carousel.expectedSlides} slides captured (apify exhausted)`;
      await persistResult(
        row,
        { ok: false, error: errMsg },
        buildMeta(seed, seed.carousel.expectedSlides, "primary"),
      );
      return { ok: false, error: errMsg };
    }
  }

  // Non-carousel single-item fallback path. T159: thread the
  // effectiveSource string up from downloadAndStoreMedia so the persist
  // attribution reflects which provider actually served the bytes (apify
  // primary actor / reel-downloader / yt-dlp / apify-escalation) instead
  // of the generic "single-fallback" tag. Falling back to the literal
  // string only when downloadAndStoreMedia didn't populate effectiveSource
  // ensures recordPersistSuccess can still classify the row, and the
  // residual fallback bucket logs a warn so we notice if a provider path
  // ever forgets to tag itself.
  const result = await downloadAndStoreMedia(row.adLink);
  await persistResult(row, result, {
    isCarousel: false,
    expectedSlides: 1,
    source: result.ok ? (result.effectiveSource ?? "single-fallback") : "single-fallback",
    retryStrategy: "single-fallback",
  });
  return result;
}

// Admin triage: find rows that look like carousels and reset them so the
// next downloader pass retries with the new strong-retry chain.
//
// Catches three cases:
//   1. New-style rows where mediaMeta.isCarousel=true AND
//      capturedSlides < expectedSlides (partial captures).
//   2. Rows that already failed with a 'carousel:' error message.
//   3. Legacy rows from before mediaMeta existed: mediaStatus='ok' with
//      a single mediaItem and no mediaMeta on an Instagram /p/ post or
//      Facebook post URL. These are the historical silent downgrades the
//      task explicitly targets — we re-queue them and let the new
//      downloader detect carousels properly.
//
// Returns the count of rows reset. Safe to run repeatedly; if nothing
// matches it's a no-op.
export async function requeueIncompleteCarousels(): Promise<{
  ok: boolean;
  requeued: number;
}> {
  const rows = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      adLink: adResearchBoardItems.adLink,
      mediaMeta: adResearchBoardItems.mediaMeta,
      mediaStatus: adResearchBoardItems.mediaStatus,
      mediaError: adResearchBoardItems.mediaError,
      mediaItems: adResearchBoardItems.mediaItems,
    })
    .from(adResearchBoardItems);
  const ids: number[] = [];
  let legacyHits = 0;
  for (const r of rows) {
    const meta = (r.mediaMeta || {}) as AdResearchBoardMediaMeta;
    const captured = meta.capturedSlides ?? r.mediaItems?.length ?? 0;
    const expected = meta.expectedSlides ?? 0;
    const errIsCarousel =
      typeof r.mediaError === "string" &&
      r.mediaError.toLowerCase().includes("carousel:");
    const looksIncomplete =
      (meta.isCarousel === true && captured < Math.max(expected, 2)) ||
      (r.mediaStatus === "failed" && errIsCarousel);
    // Legacy backfill: rows that look "ok" with a single mediaItem, no
    // mediaMeta, and a link that *could* be a carousel post. We don't
    // know for sure without re-resolving, so we re-queue and let the
    // downloader's detector make the call. The downloader is idempotent
    // for non-carousel rows so this is safe.
    let legacyCarouselCandidate = false;
    if (
      !looksIncomplete &&
      r.mediaStatus === "ok" &&
      !r.mediaMeta &&
      (r.mediaItems?.length ?? 0) <= 1 &&
      r.adLink
    ) {
      const link = r.adLink;
      const isIgPostLike = isInstagramUrl(link) && /\/(p|reel|tv)\//i.test(link);
      const isFbPostLike = isFacebookUrl(link);
      if (isIgPostLike || isFbPostLike) {
        legacyCarouselCandidate = true;
        legacyHits += 1;
      }
    }
    if (looksIncomplete || legacyCarouselCandidate) ids.push(r.id);
  }
  if (ids.length === 0) {
    return { ok: true, requeued: 0 };
  }
  await db
    .update(adResearchBoardItems)
    .set({
      mediaStatus: "pending",
      mediaError: null,
      mediaAttempts: 0,
      mediaDownloadedAt: null,
      // Task #137 (scaling pass): triaged carousels are admin-driven so
      // they should jump the line ahead of standard background retries.
      mediaPriority: 20,
      // Task #309: requeue is a retry-write outcome change.
      mediaOutcomeChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(inArray(adResearchBoardItems.id, ids));
  logger.info(
    { count: ids.length, legacyHits },
    "media-downloader: requeued incomplete carousel rows for triage",
  );
  processPendingMediaInBackground();
  return { ok: true, requeued: ids.length };
}

// Task #137: one-shot boot summary so the API Server logs include a
// snapshot of the queue health at startup. Cheap (one indexed COUNT
// per status bucket via groupBy) and runs as a fire-and-forget after
// processPendingMediaInBackground() so admins can see what state the
// last process left the queue in.
export async function logBootMediaStatusSummary(): Promise<void> {
  try {
    const rows = await db
      .select({ status: adResearchBoardItems.mediaStatus, n: count() })
      .from(adResearchBoardItems)
      .where(eq(adResearchBoardItems.dismissed, false))
      .groupBy(adResearchBoardItems.mediaStatus);
    const summary = { ok: 0, failed: 0, pending: 0, downloading: 0, partial: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.n);
      summary.total += n;
      if (row.status === "ok") summary.ok += n;
      else if (row.status === "failed") summary.failed += n;
      else if (row.status === "partial") summary.partial += n;
      else if (row.status === "downloading") summary.downloading += n;
      else summary.pending += n;
    }
    const cutoff = new Date(Date.now() - RETRY_BACKOFF_MINUTES * 60 * 1000);
    const stuckRows = await db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.dismissed, false),
          eq(adResearchBoardItems.mediaStatus, "downloading"),
          or(
            isNull(adResearchBoardItems.mediaDownloadedAt),
            lt(adResearchBoardItems.mediaDownloadedAt, cutoff),
          ),
        ),
      );
    const stuck = Number(stuckRows[0]?.n ?? 0);
    logger.info(
      { ...summary, stuck, workerId: WORKER_ID },
      "media-downloader: boot mediaStatus summary",
    );
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: boot summary query failed",
    );
  }
}

// Task #137 (next-stage): comprehensive queue-health snapshot for the
// admin dashboard. Single endpoint, no client-side aggregation. Each
// sub-query is bounded (count() or LIMIT 25) so this is cheap to call
// every 10s from a single admin pane. Heavy lifting (groupBy on small
// indexed columns) is left to Postgres.
// Task #307: short in-process TTL cache around the queue-health snapshot.
// `getQueueHealth()` runs ~15 aggregate queries; the admin dashboard polls
// it every 10s and React Query will refetch on every tab switch / focus,
// which used to stall the Ad Research Board's first paint. Caching for a
// few seconds collapses bursts of parallel callers (de-dup via the
// in-flight promise) and absorbs rapid repeat opens. The kept TTL is
// short enough that the 10s polling cadence still observes fresh data
// every cycle.
const QUEUE_HEALTH_CACHE_TTL_MS = 8_000;
let queueHealthCache: { at: number; value: Awaited<ReturnType<typeof computeQueueHealth>> } | null = null;
let queueHealthInflight: Promise<Awaited<ReturnType<typeof computeQueueHealth>>> | null = null;

export async function getQueueHealth(): Promise<Awaited<ReturnType<typeof computeQueueHealth>>> {
  const now = Date.now();
  if (queueHealthCache && now - queueHealthCache.at < QUEUE_HEALTH_CACHE_TTL_MS) {
    return queueHealthCache.value;
  }
  if (queueHealthInflight) return queueHealthInflight;
  queueHealthInflight = (async () => {
    try {
      const value = await computeQueueHealth();
      queueHealthCache = { at: Date.now(), value };
      return value;
    } finally {
      queueHealthInflight = null;
    }
  })();
  return queueHealthInflight;
}

async function computeQueueHealth(): Promise<{
  workerId: string;
  status: { ok: number; failed: number; pending: number; downloading: number; partial: number; stuck: number };
  // Task #151: real outcomes (success rate, terminal vs retrying,
  // operational buckets). Complements the queue-mechanics `status`.
  outcomes: {
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
  };
  active: { rows: number; workers: Array<{ owner: string; rows: number; oldestLeaseSecLeft: number | null }> };
  recentFailures: Array<{ rowKey: string; adLink: string; mediaError: string | null; mediaErrorClass: string | null; attempts: number; updatedAt: string; platform: "ig" | "fb" | "yt" | "other"; bucket: OperationalBucket; terminal: boolean; dismissed: boolean }>;
  errorClasses: Record<string, number>;
  attemptsHistogram: Record<string, number>;
  processingMs: { count: number; avg: number | null; p50: number | null; p95: number | null; max: number | null };
  throughput: { last1h: number; last24h: number };
  // Task #155: cookie-jar metadata + per-platform auth-health. Cookies
  // BYTES never appear here — only "is a jar configured", "when was it
  // uploaded", "what did the last probe say". `authFailures1h` is the
  // count of error rows in the auth bucket in the last hour so admins
  // can see the impact of an expired jar at a glance.
  auth: {
    jars: Array<{
      id: number;
      platform: "ig" | "fb";
      uploadedBy: string | null;
      uploadedAt: string;
      lastValidatedAt: string | null;
      status: string;
      ageHours: number;
      notes: string | null;
    }>;
    health: Array<{
      platform: "ig" | "fb";
      status: "ok" | "degraded" | "expired" | "unknown";
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastError: string | null;
      lastErrorClass: string | null;
      lastProbeAt: string | null;
      probeUrl: string | null;
    }>;
    authFailures1h: number;
    authFailures24h: number;
    // Task #155: derived rolling ratio + threshold severity. The
    // dashboard uses these to render a CRITICAL banner above queue
    // health when authentication is the dominant failure mode.
    authFailureRatio1h: number; // 0..1, authFailures1h / processed1h
    severity: "ok" | "warning" | "critical";
  };
  // Task #158: per-provider observability counters captured by the
  // worker since the last metrics-snapshot flush. Surfaces apify vs
  // yt-dlp success volume and how often the auth-wall escalation chain
  // recovered a row vs left it terminally failed.
  providers: {
    apifySuccess: number;
    ytdlpSuccess: number;
    escalationCount: number;
    escalationRecovered: number;
    ytdlpAuthRecoveries: number;
    escalationRecoveryRate: number; // 0..1
    // Task #187: spec-mandated dashboard counters. `ytDlpAuthenticatedRecoveries`
    // is an alias of `ytdlpAuthRecoveries`; `apifyEscalationRecoveries` is an
    // alias of `escalationRecovered`. Both retained for back-compat with older
    // dashboard wiring. `authFailureRecoveryRate` is the cohort-level rate of
    // reopened auth-failure rows that successfully redownloaded after reopen.
    ytDlpAuthenticatedRecoveries: number;
    apifyEscalationRecoveries: number;
    authFailureRecoveryRate: number; // 0..1
    windowHours: number;
    // Task #197: recovery-pipeline rollup fields surfaced on the new
    // dashboard panel. invalidUrlsBlocked + deadContentDismissed are
    // monotonic block counts; the three recovery class counts split
    // recovered failures by failure family so the operator can see
    // where retry effort is paying off.
    invalidUrlsBlocked: number;
    deadContentDismissed: number;
    delayedRetriesScheduled: number;
    temporaryRecoveries: number;
    authRecoveries: number;
    extractorRecoveries: number;
    avgRecoveryLatencyMs: number | null;
    // Task #197: per-actor success rates over the same 24h rollup
    // window. `successes` is the raw success count, `share` is its
    // share of the total successes the dashboard panel ranks by.
    perActorSuccess: Array<{ actor: string; successes: number; share: number }>;
  };
  // Task #197: persisted verification benchmark. Single object stored
  // on the sync_status singleton row by the verification-benchmark
  // route; null when no benchmark has ever been started. Surfaced on
  // the admin dashboard so the operator can confirm the recovery
  // pipeline landed against a real before/after delta.
  verificationBenchmark: {
    stage: "before" | "completed";
    startedAt: string;
    completedAt: string | null;
    reopened: number;
    before: {
      successRateBp: number;
      usableMedia: number;
      totalProcessed: number;
      terminalFailures: number;
      invalidUrlsBlocked: number;
      deadContentDismissed: number;
      delayedRetriesScheduled: number;
      temporaryRecoveries: number;
      authRecoveries: number;
      extractorRecoveries: number;
    };
    after: {
      successRateBp: number;
      usableMedia: number;
      totalProcessed: number;
      terminalFailures: number;
      invalidUrlsBlocked: number;
      deadContentDismissed: number;
      delayedRetriesScheduled: number;
      temporaryRecoveries: number;
      authRecoveries: number;
      extractorRecoveries: number;
    } | null;
  } | null;
  // Task #196: extractor runtime diagnostics. Surfaces the yt-dlp
  // binary version detected on the worker, the latest published
  // version on PyPI (best-effort), and an `outdated` flag so the
  // dashboard can warn an operator when an upgrade is overdue.
  runtime: {
    ytDlpVersion: string | null;
    ytDlpLatestVersion: string | null;
    ytDlpOutdated: boolean | null;
    ytDlpCheckedAt: string;
    ytDlpError?: string;
  };
  // Task #194: worker-liveness signal for the admin dashboard. The
  // Media Worker writes one queue_metrics row every
  // QUEUE_METRICS_INTERVAL_MS (default 5min); if the latest row is
  // older than `staleThresholdSec` AND there are zero rows currently
  // leased, the worker process is presumed dead. Surfaced so the
  // dashboard can render a loud banner pointing at the Media Worker
  // workflow rather than letting the outage hide behind frozen tiles.
  worker: {
    lastSnapshotAt: string | null;
    ageSeconds: number | null;
    staleThresholdSec: number;
    activeLeases: number;
    isStale: boolean;
  };
  // T210: dashboard split into "Current State" (live, point-in-time)
  // vs "Events 24h" (cumulative deltas). Additive to the legacy
  // top-level fields above so existing dashboard wiring is
  // unaffected; new tiles can read directly off this block.
  t210: {
    currentState: {
      queueDepth: { pending: number; downloading: number; partial: number; stuck: number };
      activeLeases: number;
      probeAnomalies: { ig: { count: number; lastAt: string | null; lastReason: string | null }; fb: { count: number; lastAt: string | null; lastReason: string | null } } | null;
      pacing: {
        ig: { nextAvailableAt: number; totalWaitedMs: number; pacedCalls: number; totalCalls: number; intervalMs: number };
        fb: { nextAvailableAt: number; totalWaitedMs: number; pacedCalls: number; totalCalls: number; intervalMs: number };
      } | null;
    };
    events24h: {
      throughput: number;
      authFailures: number;
      rateLimited: number;
      providerFailures: number;
      terminalFailures: number;
      dismissedTotal: number;
      retrying: number;
    };
  };
  generatedAt: string;
}> {
  const STUCK_BACKOFF_MINUTES = 15;
  const stuckCutoff = new Date(Date.now() - STUCK_BACKOFF_MINUTES * 60 * 1000);
  // Task #237 (window-only reset): natural rolling-window floors for
  // every dashboard query. If an admin has set a "fresh start" cutoff
  // via the Reset 24h Window admin action, both floors clamp to
  // MAX(natural floor, analyticsWindowCutoff) so the underlying rows
  // stay in the database but the rolling-window views (Failure
  // Breakdown, Recent Failures, Processing Latency, throughput,
  // terminalFailures / dismissed24h / retrying tiles, authFailures1h/24h)
  // start fresh from this timestamp. Single cheap singleton read;
  // falls back to the unclamped floors on any error so a hiccup here
  // can never blank the dashboard. We rebind `oneHourAgo` / `oneDayAgo`
  // to the clamped values so every downstream query auto-picks up the
  // floor without per-call edits.
  let analyticsWindowCutoff: Date | null = null;
  try {
    const cutoffRows = await db
      .select({ cutoff: adResearchBoardSyncStatus.analyticsWindowCutoff })
      .from(adResearchBoardSyncStatus)
      .where(eq(adResearchBoardSyncStatus.id, 1))
      .limit(1);
    analyticsWindowCutoff = cutoffRows[0]?.cutoff ?? null;
  } catch {
    analyticsWindowCutoff = null;
  }
  const naturalHourAgo = Date.now() - 60 * 60 * 1000;
  const naturalDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const cutoffMs = analyticsWindowCutoff ? analyticsWindowCutoff.getTime() : -Infinity;
  const oneHourAgo = new Date(Math.max(naturalHourAgo, cutoffMs));
  const oneDayAgo = new Date(Math.max(naturalDayAgo, cutoffMs));

  // Run independent queries in parallel - each uses an indexed column
  // (mediaStatus, dismissed, mediaLeaseUntil, mediaOutcomeChangedAt) so
  // the whole snapshot is cheap. Subset of columns only - no scanning
  // JSON.
  //
  // Task #309: every 24h-windowed tile in this method now clamps by
  // `media_outcome_changed_at` instead of `updated_at`. The sheet
  // upsert path bumps `updated_at` for every fetched row, which used
  // to drag old failures into the fresh window after a "Sync Now",
  // defeating the Reset 24h Window action. The new column is only
  // written by terminal-state writes inside this file (and by the
  // admin manual-dismiss endpoint), so windows now reflect actual
  // outcome events. Stuck/lease/throughput queries that key off
  // `mediaDownloadedAt` or `mediaLeaseUntil` are unchanged.
  const [
    statusRows,
    stuckRow,
    activeLeaseRows,
    recentFailureRows,
    errorClassRows,
    attemptsRows,
    procRows,
    throughput1hRow,
    throughput24hRow,
    // Task #151 outcome queries (independent of `statusRows`).
    dismissedWithFailureRow,
    dismissedWithFailureAllTimeRow,
    terminalFailedRow,
    retryingRow,
    failureClassMixAggRows,
    failureClassMixLegacyRows,
    // Task #194: most recent queue_metrics snapshot timestamp doubles
    // as a worker heartbeat. Worker writes one row every
    // QUEUE_METRICS_INTERVAL_MS; if the latest one is older than
    // WORKER_STALE_THRESHOLD_SEC AND there are zero leases, we
    // surface a "worker offline" banner.
    latestSnapshotRow,
  ] = await Promise.all([
    db
      .select({ status: adResearchBoardItems.mediaStatus, n: count() })
      .from(adResearchBoardItems)
      // Task #237 (window-only reset, second pass): clamp the headline
      // status counts (OK / FAILED / PENDING / DOWNLOADING / PARTIAL)
      // by the rolling-window floor so the operator's fresh-start
      // cutoff also clears SUCCESS RATE, USABLE MEDIA, and TOTAL
      // PROCESSED (all derived from this query). Without the cutoff
      // active, oneDayAgo is the natural now-24h floor and these
      // counts behave like before.
      // Task #309: clamp by mediaOutcomeChangedAt instead of updatedAt
      // so sheet-upsert touches don't drag pre-reset rows back into
      // the fresh window.
      .where(and(
        eq(adResearchBoardItems.dismissed, false),
        gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
      ))
      .groupBy(adResearchBoardItems.mediaStatus),
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.dismissed, false),
          eq(adResearchBoardItems.mediaStatus, "downloading"),
          or(
            isNull(adResearchBoardItems.mediaDownloadedAt),
            lt(adResearchBoardItems.mediaDownloadedAt, stuckCutoff),
          ),
        ),
      ),
    db
      .select({
        owner: adResearchBoardItems.mediaLeaseOwner,
        leaseUntil: adResearchBoardItems.mediaLeaseUntil,
      })
      .from(adResearchBoardItems)
      .where(
        and(
          isNotNull(adResearchBoardItems.mediaLeaseOwner),
          isNotNull(adResearchBoardItems.mediaLeaseUntil),
          gt(adResearchBoardItems.mediaLeaseUntil, sql`now()`),
        ),
      ),
    db
      .select({
        rowKey: adResearchBoardItems.rowKey,
        adLink: adResearchBoardItems.adLink,
        mediaError: adResearchBoardItems.mediaError,
        mediaErrorClass: adResearchBoardItems.mediaErrorClass,
        attempts: adResearchBoardItems.mediaAttempts,
        // Task #309: surface the outcome-change timestamp so the
        // "Recent Failures" tile renders the actual time of the
        // failure event rather than the most recent sheet upsert.
        updatedAt: adResearchBoardItems.mediaOutcomeChangedAt,
        dismissed: adResearchBoardItems.dismissed,
      })
      .from(adResearchBoardItems)
      .where(
        and(
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
          // T403: administrative moderation actions ("manually
          // dismissed by admin") are not operational failures and must
          // never appear in the Recent Failures tile. The historical
          // dismiss endpoint stamped mediaErrorClass='dismissed' on
          // these rows; the rewritten endpoint no longer writes any
          // operational state at all. Filter both legacy and
          // hypothetical-future moderation markers out defensively.
          sql`${adResearchBoardItems.mediaErrorClass} IS DISTINCT FROM 'dismissed'`,
          or(
            eq(adResearchBoardItems.mediaStatus, "failed"),
            // Task #401: include terminal `failed_permanent` rows so the
            // "Recent Failures" admin tile still shows them - they're
            // hidden from the live-health badge but operators still
            // need to see WHAT just terminally failed so they can
            // diagnose root cause.
            eq(adResearchBoardItems.mediaStatus, "failed_permanent"),
            and(
              eq(adResearchBoardItems.dismissed, true),
              isNotNull(adResearchBoardItems.mediaError),
            ),
          ),
        ),
      )
      .orderBy(desc(adResearchBoardItems.mediaOutcomeChangedAt))
      .limit(25),
    db
      .select({ klass: adResearchBoardItems.mediaErrorClass, n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.mediaStatus, "failed"),
          // Task #309: clamp by mediaOutcomeChangedAt.
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
          isNotNull(adResearchBoardItems.mediaErrorClass),
        ),
      )
      .groupBy(adResearchBoardItems.mediaErrorClass),
    db
      .select({ attempts: adResearchBoardItems.mediaAttempts, n: count() })
      .from(adResearchBoardItems)
      // Task #237 (window-only reset, second pass): clamp the attempts
      // histogram by the rolling-window floor so a fresh-start cutoff
      // also clears the histogram tile. Without the cutoff active,
      // oneDayAgo is the natural now-24h floor (was previously
      // unbounded; the histogram is a "what is the queue currently
      // sitting at" tile so 24h is the right scope anyway).
      // Task #309: clamp by mediaOutcomeChangedAt instead of updatedAt.
      .where(and(
        eq(adResearchBoardItems.dismissed, false),
        gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
      ))
      .groupBy(adResearchBoardItems.mediaAttempts),
    db
      .select({ ms: adResearchBoardItems.mediaLastProcessingMs })
      .from(adResearchBoardItems)
      .where(
        and(
          isNotNull(adResearchBoardItems.mediaLastProcessingMs),
          // Task #309: clamp processing-latency window by outcome change.
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
        ),
      )
      .orderBy(desc(adResearchBoardItems.mediaOutcomeChangedAt))
      .limit(200),
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.mediaStatus, "ok"),
          gte(adResearchBoardItems.mediaDownloadedAt, oneHourAgo),
        ),
      ),
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.mediaStatus, "ok"),
          gte(adResearchBoardItems.mediaDownloadedAt, oneDayAgo),
        ),
      ),
    // 24h dismissed-with-failure: powers the warning header,
    // terminalFailures, and dismissedTotal display tile.
    // Task #309: clamp by mediaOutcomeChangedAt.
    // T403: exclude admin moderation actions (mediaErrorClass='dismissed').
    // Only genuine operational failures that ended in dismiss/exhaustion
    // count here; manual admin dismisses must never inflate
    // terminalFailures or shrink the success rate.
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.dismissed, true),
          isNotNull(adResearchBoardItems.mediaError),
          sql`${adResearchBoardItems.mediaErrorClass} IS DISTINCT FROM 'dismissed'`,
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
        ),
      ),
    // All-time dismissed-with-failure: success-rate denominator. Was
    // formerly all-time so the headline yield metric considered the
    // full board population. Task #237 (window-only reset, second
    // pass): now clamped to the rolling-window floor so the operator's
    // fresh-start cutoff zeroes out the success-rate denominator
    // alongside the numerator (statusOk/statusPartial). Net effect
    // after a fresh reset: totalProcessed=0, frontend renders SUCCESS
    // RATE as "-". Without the cutoff active, oneDayAgo is the natural
    // now-24h floor.
    // Task #309: clamp by mediaOutcomeChangedAt instead of updatedAt.
    // T403: exclude admin moderation actions from the success-rate denominator.
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.dismissed, true),
          isNotNull(adResearchBoardItems.mediaError),
          sql`${adResearchBoardItems.mediaErrorClass} IS DISTINCT FROM 'dismissed'`,
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
        ),
      ),
    // 24h terminal failures: rows that moved into the terminal
    // `failed_permanent` state within the last 24h. Task #401 split the
    // retry lifecycle so terminal exhaustion is a dedicated mediaStatus
    // instead of a `failed && attempts >= MAX_ATTEMPTS` derived state,
    // which means stale exhausted rows from weeks-old extraction code
    // no longer keep the live-health badge stuck on Critical. The 24h
    // clamp via mediaOutcomeChangedAt keeps the metric scoped to recent
    // terminal events the operator can still act on. dismissed=true is
    // intentionally NOT filtered because new failed_permanent writes
    // also stamp dismissed=true; the status value alone is now the
    // canonical signal.
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.mediaStatus, "failed_permanent"),
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
        ),
      ),
    // 24h retrying: live failed rows still under MAX_ATTEMPTS whose
    // outcome changed in the last 24h. Time-scoped to match the
    // `retryVolume24h` snapshot field name.
    // Task #309: clamp by mediaOutcomeChangedAt.
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          eq(adResearchBoardItems.dismissed, false),
          eq(adResearchBoardItems.mediaStatus, "failed"),
          lt(adResearchBoardItems.mediaAttempts, MAX_ATTEMPTS),
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
        ),
      ),
    // 24h failure mix - DB-side aggregation, no row-cap. Covers live
    // failed + dismissed-with-failure rows whose mediaErrorClass is set.
    // Task #309: clamp by mediaOutcomeChangedAt.
    // T403: explicitly exclude mediaErrorClass='dismissed' so admin
    // moderation never appears in the operational failure-class
    // breakdown.
    db
      .select({ klass: adResearchBoardItems.mediaErrorClass, n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
          isNotNull(adResearchBoardItems.mediaErrorClass),
          sql`${adResearchBoardItems.mediaErrorClass} IS DISTINCT FROM 'dismissed'`,
          or(
            and(
              eq(adResearchBoardItems.dismissed, false),
              eq(adResearchBoardItems.mediaStatus, "failed"),
            ),
            and(
              eq(adResearchBoardItems.dismissed, true),
              isNotNull(adResearchBoardItems.mediaError),
            ),
          ),
        ),
      )
      .groupBy(adResearchBoardItems.mediaErrorClass),
    // Legacy fallback: fetch only rows where mediaErrorClass IS NULL so
    // they can be reclassified in JS. Expected to be small (every new
    // terminal write sets the class), but no cap so totals stay exact.
    // Task #309: clamp by mediaOutcomeChangedAt.
    // T403: also skip rows whose mediaError is the moderation marker
    // text - these are legacy admin dismisses that pre-date the class
    // column being populated. mediaErrorClass IS NULL is already in the
    // where clause, so we just filter by mediaError text.
    db
      .select({ mediaError: adResearchBoardItems.mediaError })
      .from(adResearchBoardItems)
      .where(
        and(
          gte(adResearchBoardItems.mediaOutcomeChangedAt, oneDayAgo),
          isNull(adResearchBoardItems.mediaErrorClass),
          sql`COALESCE(${adResearchBoardItems.mediaError}, '') NOT ILIKE '%manually dismissed by admin%'`,
          or(
            and(
              eq(adResearchBoardItems.dismissed, false),
              eq(adResearchBoardItems.mediaStatus, "failed"),
            ),
            and(
              eq(adResearchBoardItems.dismissed, true),
              isNotNull(adResearchBoardItems.mediaError),
            ),
          ),
        ),
      ),
    db
      .select({ capturedAt: adResearchBoardQueueMetrics.capturedAt })
      .from(adResearchBoardQueueMetrics)
      .orderBy(desc(adResearchBoardQueueMetrics.capturedAt))
      .limit(1),
  ]);

  const status = { ok: 0, failed: 0, pending: 0, downloading: 0, partial: 0, stuck: 0 };
  for (const row of statusRows) {
    const n = Number(row.n);
    if (row.status === "ok") status.ok += n;
    else if (row.status === "failed") status.failed += n;
    else if (row.status === "partial") status.partial += n;
    else if (row.status === "downloading") status.downloading += n;
    // Task #401: `failed_permanent` and `silent-source` are terminal
    // states the live-health badge intentionally ignores - they don't
    // belong in any of the live buckets above. invalid was already
    // excluded (only handled implicitly via the else-clause fallthrough
    // pre-T401). Skip them so `status.pending` doesn't absorb them.
    else if (
      row.status === "failed_permanent"
      || row.status === "silent-source"
      || row.status === "invalid"
    ) {
      // intentionally ignored - terminal, surfaced via separate tiles
    }
    else status.pending += n;
  }
  status.stuck = Number(stuckRow[0]?.n ?? 0);

  // Group active leases by owner so the dashboard can show per-worker
  // load. oldestLeaseSecLeft surfaces "is this worker about to lose
  // its lease" - useful when debugging a worker that's stalled.
  const byOwner = new Map<string, { rows: number; minUntil: number }>();
  const nowMs = Date.now();
  for (const r of activeLeaseRows) {
    const owner = r.owner || "unknown";
    const untilMs = r.leaseUntil ? new Date(r.leaseUntil).getTime() : nowMs;
    const cur = byOwner.get(owner) ?? { rows: 0, minUntil: Number.POSITIVE_INFINITY };
    cur.rows += 1;
    cur.minUntil = Math.min(cur.minUntil, untilMs);
    byOwner.set(owner, cur);
  }
  const workers = Array.from(byOwner.entries()).map(([owner, v]) => ({
    owner,
    rows: v.rows,
    oldestLeaseSecLeft: Number.isFinite(v.minUntil) ? Math.max(0, Math.round((v.minUntil - nowMs) / 1000)) : null,
  }));

  const errorClasses: Record<string, number> = {};
  for (const r of errorClassRows) {
    errorClasses[r.klass || "unknown"] = Number(r.n);
  }
  // Backfill bucket counts; reclassify legacy NULL-class rows in JS.
  const buckets: Record<OperationalBucket, number> = {
    auth: 0, "rate-limit": 0, quota: 0, unavailable: 0, dead: 0, unsupported: 0, retryable: 0,
  };
  // Provider-specific failure tally (apify/cdn/yt-dlp + apify quota).
  // Narrower than `retryable + quota` so the metric reflects true
  // upstream-provider issues rather than generic timeouts/share-locks.
  const PROVIDER_CLASSES = new Set([
    "apify", "cdn", "yt-dlp-failure", "quota-exceeded", "apify-quota-exceeded",
  ]);
  let providerFailures = 0;
  for (const r of failureClassMixAggRows) {
    const klass = r.klass || "unknown";
    const n = Number(r.n);
    buckets[operationalBucket(klass)] += n;
    if (PROVIDER_CLASSES.has(klass)) providerFailures += n;
  }
  // Reclassify legacy NULL-class rows (small set) so totals stay exact.
  for (const r of failureClassMixLegacyRows) {
    const klass = classifyError(r.mediaError);
    errorClasses[klass] = (errorClasses[klass] || 0) + 1;
    buckets[operationalBucket(klass)] += 1;
    if (PROVIDER_CLASSES.has(klass)) providerFailures += 1;
  }

  const attemptsHistogram: Record<string, number> = {};
  for (const r of attemptsRows) {
    attemptsHistogram[String(r.attempts ?? 0)] = Number(r.n);
  }

  // p50/p95 from the recent-200-rows sample. Cheap, no DB-side
  // percentile_cont needed (which would require a window function).
  const samples = procRows
    .map((r) => Number(r.ms ?? 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const pct = (p: number): number | null => {
    if (samples.length === 0) return null;
    const idx = Math.min(samples.length - 1, Math.floor((p / 100) * samples.length));
    return Math.round(samples[idx]);
  };
  const processingMs = {
    count: samples.length,
    avg: samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null,
    p50: pct(50),
    p95: pct(95),
    max: samples.length > 0 ? Math.round(samples[samples.length - 1]) : null,
  };

  // Outcome rollup via pure helper (regression-tested). providerFailures
  // is derived from a narrow allow-list of upstream-provider classes
  // rather than the entire retryable bucket, so generic
  // timeouts/share-locks don't distort it.
  const outcomes = computeOutcomeRollup({
    statusOk: status.ok,
    statusPartial: status.partial,
    statusFailed: status.failed,
    dismissedWithFailureAllTime: Number(dismissedWithFailureAllTimeRow[0]?.n ?? 0),
    dismissedWithFailure24h: Number(dismissedWithFailureRow[0]?.n ?? 0),
    terminalLive24h: Number(terminalFailedRow[0]?.n ?? 0),
    retrying: Number(retryingRow[0]?.n ?? 0),
    buckets,
    providerFailures,
  });

  return {
    workerId: WORKER_ID,
    status,
    outcomes,
    active: { rows: activeLeaseRows.length, workers },
    recentFailures: recentFailureRows.map((r) => {
      const klass = r.mediaErrorClass || classifyError(r.mediaError);
      return {
        rowKey: r.rowKey,
        adLink: r.adLink,
        mediaError: r.mediaError,
        mediaErrorClass: klass,
        attempts: r.attempts,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        platform: derivePlatform(r.adLink),
        bucket: operationalBucket(klass),
        terminal: r.dismissed || r.attempts >= MAX_ATTEMPTS,
        dismissed: r.dismissed,
      };
    }),
    errorClasses,
    attemptsHistogram,
    processingMs,
    throughput: {
      last1h: Number(throughput1hRow[0]?.n ?? 0),
      last24h: Number(throughput24hRow[0]?.n ?? 0),
    },
    auth: await buildAuthSection({
      oneHourAgo,
      oneDayAgo,
      // Strict 1h-scoped throughput. buildAuthSection adds the 1h
      // failure count (queried independently) to compute a true
      // last-hour "total processed" denominator for the auth ratio.
      throughputLast1h: Number(throughput1hRow[0]?.n ?? 0),
    }),
    // Task #158 (review fix): API and Worker run in separate processes,
    // so the in-memory `providerCounters` is always zero in the API
    // process that serves this endpoint. Read the last 24h of
    // queue_metrics snapshot rows (written by the Worker every
    // ~5 min) and sum the per-interval columns. That gives the
    // dashboard a real, cross-process rolling 24h provider mix
    // (widened from 1h in T187 review fix to match spec semantics).
    providers: await (async () => {
      try {
        // Task #187 (review fix): provider rollup window widened to 24h
        // so the three new auth-continuity counters
        // (ytDlpAuthenticatedRecoveries, apifyEscalationRecoveries,
        // authFailureRecoveryRate) are reported on the spec-mandated
        // 24h horizon rather than the prior 1h window.
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            apifySuccess: adResearchBoardQueueMetrics.apifySuccess,
            ytdlpSuccess: adResearchBoardQueueMetrics.ytdlpSuccess,
            escalationCount: adResearchBoardQueueMetrics.escalationCount,
            escalationRecovered: adResearchBoardQueueMetrics.escalationRecovered,
            ytdlpAuthRecoveries: adResearchBoardQueueMetrics.ytdlpAuthRecoveries,
            authFailures24h: adResearchBoardQueueMetrics.authFailures24h,
            invalidUrlsBlocked: adResearchBoardQueueMetrics.invalidUrlsBlocked,
            deadContentDismissed: adResearchBoardQueueMetrics.deadContentDismissed,
            delayedRetriesScheduled: adResearchBoardQueueMetrics.delayedRetriesScheduled,
            temporaryRecoveries: adResearchBoardQueueMetrics.temporaryRecoveries,
            authRecoveries: adResearchBoardQueueMetrics.authRecoveries,
            extractorRecoveries: adResearchBoardQueueMetrics.extractorRecoveries,
            avgRecoveryLatencyMs: adResearchBoardQueueMetrics.avgRecoveryLatencyMs,
            perActorSuccess: adResearchBoardQueueMetrics.perActorSuccess,
          })
          .from(adResearchBoardQueueMetrics)
          .where(gte(adResearchBoardQueueMetrics.capturedAt, since));
        // Task #197: merge per-actor success maps across the window
        // into a ranked list. Each snapshot's map is summed key-by-key,
        // then sorted by count and capped to keep the dashboard panel
        // compact.
        const perActorTotals: Record<string, number> = {};
        for (const r of rows) {
          const m = (r.perActorSuccess as Record<string, number> | null) || null;
          if (!m) continue;
          for (const [actor, n] of Object.entries(m)) {
            perActorTotals[actor] = (perActorTotals[actor] || 0) + Number(n || 0);
          }
        }
        const perActorTotal = Object.values(perActorTotals).reduce((a, b) => a + b, 0);
        const perActorRanked = Object.entries(perActorTotals)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
          .map(([actor, successes]) => ({
            actor,
            successes,
            share: perActorTotal > 0 ? successes / perActorTotal : 0,
          }));
        const sum = rows.reduce(
          (acc, r) => ({
            apifySuccess: acc.apifySuccess + Number(r.apifySuccess ?? 0),
            ytdlpSuccess: acc.ytdlpSuccess + Number(r.ytdlpSuccess ?? 0),
            escalationCount: acc.escalationCount + Number(r.escalationCount ?? 0),
            escalationRecovered: acc.escalationRecovered + Number(r.escalationRecovered ?? 0),
            ytdlpAuthRecoveries: acc.ytdlpAuthRecoveries + Number(r.ytdlpAuthRecoveries ?? 0),
            authFailures24h: acc.authFailures24h + Number(r.authFailures24h ?? 0),
            invalidUrlsBlocked: acc.invalidUrlsBlocked + Number(r.invalidUrlsBlocked ?? 0),
            deadContentDismissed: acc.deadContentDismissed + Number(r.deadContentDismissed ?? 0),
            delayedRetriesScheduled: acc.delayedRetriesScheduled + Number(r.delayedRetriesScheduled ?? 0),
            temporaryRecoveries: acc.temporaryRecoveries + Number(r.temporaryRecoveries ?? 0),
            authRecoveries: acc.authRecoveries + Number(r.authRecoveries ?? 0),
            extractorRecoveries: acc.extractorRecoveries + Number(r.extractorRecoveries ?? 0),
            recoveryLatencySum: acc.recoveryLatencySum + (r.avgRecoveryLatencyMs == null ? 0 : Number(r.avgRecoveryLatencyMs)),
            recoveryLatencyN: acc.recoveryLatencyN + (r.avgRecoveryLatencyMs == null ? 0 : 1),
          }),
          {
            apifySuccess: 0, ytdlpSuccess: 0, escalationCount: 0,
            escalationRecovered: 0, ytdlpAuthRecoveries: 0, authFailures24h: 0,
            invalidUrlsBlocked: 0, deadContentDismissed: 0, delayedRetriesScheduled: 0,
            temporaryRecoveries: 0, authRecoveries: 0, extractorRecoveries: 0,
            recoveryLatencySum: 0, recoveryLatencyN: 0,
          },
        );
        // Task #187: three new dashboard counters layered on the
        // existing rollup. apifyEscalationRecoveries is a clearer
        // alias for escalationRecovered (kept for back-compat).
        // authFailureRecoveryRate compares total recoveries
        // (escalation + ytdlp authenticated) against the universe of
        // auth-class events that triggered them, so an operator can
        // see "of all the auth walls we hit this hour, what fraction
        // did we end up serving anyway?".
        const apifyEscalationRecoveries = sum.escalationRecovered;
        const ytDlpAuthenticatedRecoveries = sum.ytdlpAuthRecoveries;
        // Task #187 (review fix): authFailureRecoveryRate is now a true
        // cohort metric. Numerator: rows reopened in the last 24h that
        // later landed back on mediaStatus='ok' AND had a successful
        // download AFTER the reopen timestamp. Denominator: total rows
        // reopened in the same window. Prior interval-counter formula
        // double-counted unrelated runs and was rejected in code review.
        const reopenSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let reopenedTotal = 0;
        let reopenedRecovered = 0;
        try {
          const totalRow = await db
            .select({ n: count() })
            .from(adResearchBoardItems)
            .where(gte(adResearchBoardItems.mediaReopenedAt, reopenSince));
          reopenedTotal = Number(totalRow[0]?.n ?? 0);
          const recoveredRow = await db
            .select({ n: count() })
            .from(adResearchBoardItems)
            .where(
              and(
                gte(adResearchBoardItems.mediaReopenedAt, reopenSince),
                eq(adResearchBoardItems.mediaStatus, "ok"),
                isNotNull(adResearchBoardItems.mediaDownloadedAt),
                gt(adResearchBoardItems.mediaDownloadedAt, adResearchBoardItems.mediaReopenedAt),
              ),
            );
          reopenedRecovered = Number(recoveredRow[0]?.n ?? 0);
        } catch { /* best-effort - leave as zeros */ }
        const authFailureRecoveryRate = reopenedTotal > 0 ? reopenedRecovered / reopenedTotal : 0;
        return {
          apifySuccess: sum.apifySuccess,
          ytdlpSuccess: sum.ytdlpSuccess,
          escalationCount: sum.escalationCount,
          escalationRecovered: sum.escalationRecovered,
          ytdlpAuthRecoveries: sum.ytdlpAuthRecoveries,
          escalationRecoveryRate: sum.escalationCount > 0
            ? sum.escalationRecovered / sum.escalationCount
            : 0,
          ytDlpAuthenticatedRecoveries,
          apifyEscalationRecoveries,
          authFailureRecoveryRate,
          windowHours: 24,
          invalidUrlsBlocked: sum.invalidUrlsBlocked,
          deadContentDismissed: sum.deadContentDismissed,
          delayedRetriesScheduled: sum.delayedRetriesScheduled,
          temporaryRecoveries: sum.temporaryRecoveries,
          authRecoveries: sum.authRecoveries,
          extractorRecoveries: sum.extractorRecoveries,
          avgRecoveryLatencyMs: sum.recoveryLatencyN > 0
            ? Math.round(sum.recoveryLatencySum / sum.recoveryLatencyN)
            : null,
          perActorSuccess: perActorRanked,
        };
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err) },
          "media-downloader: providers rollup query failed; returning zeros",
        );
        return {
          apifySuccess: 0, ytdlpSuccess: 0, escalationCount: 0,
          escalationRecovered: 0, ytdlpAuthRecoveries: 0,
          escalationRecoveryRate: 0,
          ytDlpAuthenticatedRecoveries: 0,
          apifyEscalationRecoveries: 0,
          authFailureRecoveryRate: 0,
          windowHours: 24,
          invalidUrlsBlocked: 0, deadContentDismissed: 0,
          delayedRetriesScheduled: 0, temporaryRecoveries: 0,
          authRecoveries: 0, extractorRecoveries: 0,
          avgRecoveryLatencyMs: null,
          perActorSuccess: [],
        };
      }
    })(),
    // Task #197: persisted verification benchmark. Read the singleton
    // sync_status row; on a fresh DB the row may be absent, in which
    // case the panel renders "no benchmark recorded yet".
    verificationBenchmark: await (async () => {
      try {
        const rows = await db
          .select({
            payload: adResearchBoardSyncStatus.lastVerificationBenchmark,
          })
          .from(adResearchBoardSyncStatus)
          .where(eq(adResearchBoardSyncStatus.id, 1))
          .limit(1);
        const payload = rows[0]?.payload as any;
        return payload && typeof payload === "object" ? payload : null;
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err) },
          "media-downloader: verification benchmark read failed; returning null",
        );
        return null;
      }
    })(),
    // Task #196: yt-dlp runtime diagnostics (cached). Reads the cache
    // populated by the worker boot probe / first call; never spawns
    // synchronously inside the dashboard request path.
    runtime: await (async () => {
      const info = await getYtDlpRuntimeInfo();
      return {
        ytDlpVersion: info.current,
        ytDlpLatestVersion: info.latest,
        ytDlpOutdated: info.outdated,
        ytDlpCheckedAt: info.checkedAt,
        ...(info.error ? { ytDlpError: info.error } : {}),
      };
    })(),
    // Task #194: derive worker liveness from the queue_metrics
    // heartbeat. We treat the worker as offline only when the latest
    // snapshot is older than the threshold AND there are zero active
    // leases - that combination distinguishes a dead worker from a
    // healthy worker quietly idling on a drained queue (which still
    // emits snapshots). `lastSnapshotAt` is null on a brand-new
    // database that has never had a worker alive at all; in that
    // case we suppress the offline signal until this API process has
    // been up long enough for a worker (running in parallel) to have
    // posted its first snapshot. Without that grace period a freshly
    // restarted stack would briefly flash the offline banner before
    // the worker's first 5-minute heartbeat lands.
    worker: (() => {
      const last = latestSnapshotRow[0]?.capturedAt
        ? new Date(latestSnapshotRow[0].capturedAt as unknown as string | Date)
        : null;
      const ageSec = last ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 1000)) : null;
      const activeLeases = activeLeaseRows.length;
      const apiUptimeSec = Math.floor(process.uptime());
      const inGracePeriod = ageSec == null && apiUptimeSec < WORKER_STALE_THRESHOLD_SEC;
      const stale = !inGracePeriod
        && (ageSec == null || ageSec > WORKER_STALE_THRESHOLD_SEC)
        && activeLeases === 0;
      return {
        lastSnapshotAt: last ? last.toISOString() : null,
        ageSeconds: ageSec,
        staleThresholdSec: WORKER_STALE_THRESHOLD_SEC,
        activeLeases,
        isStale: stale,
      };
    })(),
    // T210: dashboard split into "Current State" vs "24h Historical
    // Events". Both blocks are derived from data already gathered
    // above so this is purely a regrouping for the admin UI -- no new
    // queries, no behavior change for existing consumers, and the
    // legacy top-level fields stay in place for back-compat.
    //
    //   currentState  -> live, point-in-time view of the queue (depth,
    //                    leases, jar status, last probe).
    //   events24h     -> cumulative deltas over the last 24 hours
    //                    (throughput, auth failures, retries scheduled,
    //                    soft probe anomalies that did NOT flip jars).
    t210: (() => {
      let probeAnomalies: ReturnType<typeof import("./probe-anomaly-counter").getProbeAnomalySnapshot> | null = null;
      let pacing: ReturnType<typeof import("./per-host-pacing").getPacingSnapshot> | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        probeAnomalies = require("./probe-anomaly-counter").getProbeAnomalySnapshot();
      } catch { probeAnomalies = null; }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        pacing = require("./per-host-pacing").getPacingSnapshot();
      } catch { pacing = null; }
      return {
        currentState: {
          queueDepth: {
            pending: status.pending,
            downloading: status.downloading,
            partial: status.partial,
            stuck: status.stuck,
          },
          activeLeases: activeLeaseRows.length,
          probeAnomalies,
          pacing,
        },
        events24h: {
          throughput: Number(throughput24hRow[0]?.n ?? 0),
          authFailures: outcomes.authBlocked,
          rateLimited: outcomes.rateLimited,
          providerFailures: outcomes.providerFailures,
          terminalFailures: outcomes.terminalFailures,
          dismissedTotal: outcomes.dismissedTotal,
          retrying: outcomes.retrying,
        },
      };
    })(),
    generatedAt: new Date().toISOString(),
  };
}

// Task #155: build the `auth` block of getQueueHealth(). Pulled into a
// Severity thresholds: any expired jar OR >25% of recent jobs in the
// auth bucket is CRITICAL (operator action required). Any degraded
// jar, missing cookies, or >5% auth ratio is WARNING. Pulled out of
// buildAuthSection() so it's directly unit-testable with synthetic
// 1h counts.
// Task #158: severity is derived from Apify probe outcomes + the live
// auth-failure ratio only. Customer cookie jars no longer feed runtime
// extraction (Apify holds the session), so jar presence / "no-cookies"
// signals are deliberately NOT considered here - their absence is the
// expected steady state. `jarCount` and `healthErrorClasses` are kept
// in the input shape for back-compat with existing call sites and unit
// tests, but only `healthStatuses` (probe outcomes) and `ratio1h` (live
// auth-bucket failure rate) influence severity.
export function computeAuthSeverity(input: {
  ratio1h: number;
  healthStatuses: ReadonlyArray<"ok" | "degraded" | "expired" | "unknown">;
  healthErrorClasses?: ReadonlyArray<string | null>;
  jarCount?: number;
}): "ok" | "warning" | "critical" {
  const anyExpired = input.healthStatuses.includes("expired");
  const anyDegraded = input.healthStatuses.includes("degraded");
  if (anyExpired || input.ratio1h > 0.25) return "critical";
  if (anyDegraded || input.ratio1h > 0.05) return "warning";
  return "ok";
}

// helper so the giant Promise.all above stays readable. Counts the
// 1h/24h auth-bucket failure rows by joining the recent-failure stream
// with classifyError-derived buckets, then layers in DB-stored cookie
// jar metadata and probe outcomes.
async function buildAuthSection(opts: {
  oneHourAgo: Date;
  oneDayAgo: Date;
  throughputLast1h: number;
}): Promise<{
  jars: Array<{ id: number; platform: "ig" | "fb"; uploadedBy: string | null; uploadedAt: string; lastValidatedAt: string | null; status: string; ageHours: number; notes: string | null }>;
  health: Array<{ platform: "ig" | "fb"; status: "ok" | "degraded" | "expired" | "unknown"; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; lastErrorClass: string | null; lastProbeAt: string | null; probeUrl: string | null }>;
  authFailures1h: number;
  authFailures24h: number;
  authFailureRatio1h: number;
  severity: "ok" | "warning" | "critical";
}> {
  // Strict auth class set per task spec: numerator is exactly
  // ig-login-required + fb-auth-wall (the two classes that prove
  // cookies failed). cookie-expired remains an auth-bucket label for
  // dashboards but is not part of the severity numerator because it
  // is recorded by the probe, not by the queue.
  const AUTH_CLASSES = ["ig-login-required", "fb-auth-wall"];
  const [authFailures1hRow, authFailures24hRow, totalFailures1hRow, authBlock] = await Promise.all([
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          // Task #309: clamp by mediaOutcomeChangedAt.
          gte(adResearchBoardItems.mediaOutcomeChangedAt, opts.oneHourAgo),
          inArray(adResearchBoardItems.mediaErrorClass, AUTH_CLASSES),
        ),
      ),
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          // Task #309: clamp by mediaOutcomeChangedAt.
          gte(adResearchBoardItems.mediaOutcomeChangedAt, opts.oneDayAgo),
          inArray(adResearchBoardItems.mediaErrorClass, AUTH_CLASSES),
        ),
      ),
    // True 1h-scoped failure count - everything that landed in the
    // failed bucket (or was dismissed-with-error) in the last hour.
    // Combined with throughputLast1h this gives a strictly 1h-scoped
    // "total processed" denominator so the auth ratio reacts to the
    // last-hour collapse the dashboard CRITICAL signal must catch.
    db
      .select({ n: count() })
      .from(adResearchBoardItems)
      .where(
        and(
          // Task #309: clamp by mediaOutcomeChangedAt.
          gte(adResearchBoardItems.mediaOutcomeChangedAt, opts.oneHourAgo),
          or(
            eq(adResearchBoardItems.mediaStatus, "failed"),
            and(
              eq(adResearchBoardItems.dismissed, true),
              isNotNull(adResearchBoardItems.mediaError),
            ),
          ),
        ),
      ),
    (async () => {
      try {
        const mod = await import("./auth-cookies");
        return await mod.getAuthSection();
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err) },
          "media-downloader: auth section unavailable",
        );
        return { jars: [], health: [] };
      }
    })(),
  ]);
  const authFailures1h = Number(authFailures1hRow[0]?.n ?? 0);
  const authFailures24h = Number(authFailures24hRow[0]?.n ?? 0);
  const totalFailures1h = Number(totalFailures1hRow[0]?.n ?? 0);
  // Required formula per task spec:
  //   ratio = (ig-login-required + fb-auth-wall) / total processed in last 1h
  // where "total processed" = successful downloads in 1h + all failure
  // rows (including dismissed-with-error) in 1h. Strictly 1h-scoped
  // so a sudden auth-wall storm immediately dominates the ratio.
  const totalProcessed1h = opts.throughputLast1h + totalFailures1h;
  const denom1h = Math.max(1, totalProcessed1h);
  const authFailureRatio1h = authFailures1h / denom1h;
  const severity = computeAuthSeverity({
    ratio1h: authFailureRatio1h,
    healthStatuses: authBlock.health.map((h) => h.status),
    healthErrorClasses: authBlock.health.map((h) => h.lastErrorClass),
    jarCount: authBlock.jars.length,
  });
  return {
    jars: authBlock.jars.map((j) => ({
      id: j.id,
      platform: j.platform,
      uploadedBy: j.uploadedBy,
      uploadedAt: j.uploadedAt,
      lastValidatedAt: j.lastValidatedAt,
      status: j.status,
      ageHours: j.ageHours,
      notes: j.notes,
    })),
    health: authBlock.health,
    authFailures1h,
    authFailures24h,
    authFailureRatio1h,
    severity,
  };
}

// Task #401: stale-failure terminalization sweeper. Promotes any
// `status='failed' AND attempts >= MAX_ATTEMPTS AND mediaStatus !=
// 'failed_permanent'` rows up to the terminal lifecycle status so they
// drop out of the live health badge's retryable-failure bucket. The
// download path's persistResult already does this in-band; this sweeper
// is a safety net for rows that ended up exhausted via a code path that
// bypassed persistResult (older versions, crashes mid-write, manual SQL
// edits, etc.). Bounded by STALE_FAILURE_SWEEP_BATCH so a one-time
// backlog cannot freeze the processor tick.
const STALE_FAILURE_SWEEP_BATCH = 200;
let staleFailureSweepInFlight = false;
async function runStaleFailureTerminalizationSweep(): Promise<void> {
  if (staleFailureSweepInFlight) return;
  staleFailureSweepInFlight = true;
  try {
    const { db, adResearchBoardItems } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const result: { rowCount?: number | null } = await db.execute(sql`
      UPDATE ${adResearchBoardItems}
      SET ${sql.identifier("media_status")} = 'failed_permanent',
          ${sql.identifier("media_outcome_changed_at_t309")} = NOW(),
          ${sql.identifier("dismissed")} = true,
          ${sql.identifier("dismissed_reason")} = COALESCE(${sql.identifier("dismissed_reason")}, 'media_retry_exhausted'),
          ${sql.identifier("dismissed_at")} = COALESCE(${sql.identifier("dismissed_at")}, NOW())
      WHERE ${sql.identifier("id")} IN (
        SELECT ${sql.identifier("id")}
        FROM ${adResearchBoardItems}
        WHERE ${sql.identifier("media_status")} = 'failed'
          AND ${sql.identifier("media_attempts")} >= ${MAX_ATTEMPTS}
        LIMIT ${STALE_FAILURE_SWEEP_BATCH}
      )
    `);
    const promoted = result.rowCount ?? 0;
    if (promoted > 0) {
      logger.info(
        { promoted, workerId: WORKER_ID, maxAttempts: MAX_ATTEMPTS },
        "media-downloader: stale-failure terminalization sweep promoted rows to failed_permanent",
      );
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: stale-failure terminalization sweep failed",
    );
  } finally {
    staleFailureSweepInFlight = false;
  }
}

// Task #137 (scaling pass): periodic processor loop. The boot hook and
// post-sync triggers cover the common case, but if neither fires for a
// while (e.g. no syncs overnight, lease expiries trickling in) the queue
// would stall until the next manual action. This loop guarantees a pass
// every PROCESSOR_INTERVAL_MS +/- jitter. The loop is self-rescheduling
// (setTimeout, not setInterval) so a slow pass cannot pile up overlapping
// runs on the next tick. unref'd so the timer never blocks shutdown.
let periodicProcessorTimer: NodeJS.Timeout | null = null;
function scheduleNextPeriodicProcessorRun(): void {
  const jitter = Math.floor((Math.random() * 2 - 1) * PROCESSOR_INTERVAL_JITTER_MS);
  const wait = Math.max(30_000, PROCESSOR_INTERVAL_MS + jitter);
  periodicProcessorTimer = setTimeout(() => {
    try {
      // Skip the trigger if a pass is already in flight: the in-memory
      // inFlightProcessor lock inside processPendingMediaInBackground
      // will short-circuit anyway, but logging "skipped" once per tick
      // is noisier than just deferring to the next scheduled run.
      processPendingMediaInBackground();
      // Task #401: stale-failure terminalization sweeper. The download
      // path already writes failed_permanent when a retry exhausts, but
      // older rows from before the lifecycle status existed, or rows
      // promoted to attempts>=MAX by a code path that bypassed
      // persistResult (e.g. a process crash mid-write), can linger as
      // status='failed' AND attempts>=MAX_ATTEMPTS forever and keep
      // poisoning the live health badge. Promote them here in bounded
      // batches so the live-state query stays clean without needing a
      // manual reset.
      void runStaleFailureTerminalizationSweep();
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err) },
        "media-downloader: periodic processor trigger failed",
      );
    } finally {
      scheduleNextPeriodicProcessorRun();
    }
  }, wait);
  periodicProcessorTimer.unref?.();
}
export function startPeriodicMediaProcessor(): void {
  if (periodicProcessorTimer) return;
  logger.info(
    {
      intervalMs: PROCESSOR_INTERVAL_MS,
      jitterMs: PROCESSOR_INTERVAL_JITTER_MS,
      maxCandidatesPerPass: MAX_CANDIDATES_PER_PASS,
      workerId: WORKER_ID,
    },
    "media-downloader: periodic processor scheduled",
  );
  scheduleNextPeriodicProcessorRun();
}

// Task #325: periodic thumbnail backfill loop. The ad-grid <img> poster
// path only kicks in when `media_thumbnail_object_path` is populated, so
// rows that were downloaded before the thumbnail-cache code shipped (or
// rows whose extraction URL transient-failed and got stuck on the local
// ffmpeg poster) keep falling back to the slow `<video preload=metadata>`
// tile. This loop calls `backfillVideoThumbnails` every
// THUMB_BACKFILL_INTERVAL_MS, draining the long tail in bounded chunks
// so a 1700-row backfill can't pin the worker. When a pass touches no
// rows we back off to IDLE_INTERVAL so we don't keep banging on the DB
// once the queue is fully caught up - any new video row written by the
// downloader path already populates the thumbnail in-band so the
// idle-loop only needs to wake up rarely to catch the next stale batch.
const THUMB_BACKFILL_ACTIVE_INTERVAL_MS = (() => {
  const raw = process.env["AD_RESEARCH_THUMB_BACKFILL_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : 10 * 60 * 1000;
})();
const THUMB_BACKFILL_IDLE_INTERVAL_MS = 60 * 60 * 1000;
const THUMB_BACKFILL_JITTER_MS = 30_000;
const THUMB_BACKFILL_BATCH_LIMIT = (() => {
  const raw = process.env["AD_RESEARCH_THUMB_BACKFILL_LIMIT"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.floor(n) : 100;
})();
let periodicThumbnailBackfillTimer: NodeJS.Timeout | null = null;
let thumbnailBackfillInFlight = false;
function scheduleNextThumbnailBackfillRun(baseIntervalMs: number): void {
  const jitter = Math.floor((Math.random() * 2 - 1) * THUMB_BACKFILL_JITTER_MS);
  const wait = Math.max(60_000, baseIntervalMs + jitter);
  periodicThumbnailBackfillTimer = setTimeout(() => {
    void runPeriodicThumbnailBackfillTick();
  }, wait);
  periodicThumbnailBackfillTimer.unref?.();
}
async function runPeriodicThumbnailBackfillTick(): Promise<void> {
  if (thumbnailBackfillInFlight) {
    scheduleNextThumbnailBackfillRun(THUMB_BACKFILL_ACTIVE_INTERVAL_MS);
    return;
  }
  thumbnailBackfillInFlight = true;
  let nextInterval = THUMB_BACKFILL_ACTIVE_INTERVAL_MS;
  try {
    const result = await backfillVideoThumbnails({ limit: THUMB_BACKFILL_BATCH_LIMIT });
    if (result.scanned > 0 || result.updated > 0) {
      logger.info(
        { ...result, limit: THUMB_BACKFILL_BATCH_LIMIT, workerId: WORKER_ID },
        "media-downloader: periodic thumbnail backfill pass",
      );
    }
    // Back off when nothing was found to do OR when a full batch made
    // zero forward progress (persistent failures - the WHERE clause
    // re-selects the same rows every pass since they still match the
    // missing-thumbnail predicate, so staying in active cadence would
    // just spin on the same failures forever). Speed back up the moment
    // a pass actually updates rows, so a fresh batch of legacy rows
    // drains quickly.
    if (result.scanned === 0 || result.updated === 0) {
      nextInterval = THUMB_BACKFILL_IDLE_INTERVAL_MS;
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: periodic thumbnail backfill failed",
    );
  } finally {
    thumbnailBackfillInFlight = false;
    scheduleNextThumbnailBackfillRun(nextInterval);
  }
}
export function startPeriodicThumbnailBackfill(): void {
  if (periodicThumbnailBackfillTimer) return;
  logger.info(
    {
      activeIntervalMs: THUMB_BACKFILL_ACTIVE_INTERVAL_MS,
      idleIntervalMs: THUMB_BACKFILL_IDLE_INTERVAL_MS,
      jitterMs: THUMB_BACKFILL_JITTER_MS,
      batchLimit: THUMB_BACKFILL_BATCH_LIMIT,
      workerId: WORKER_ID,
    },
    "media-downloader: periodic thumbnail backfill scheduled",
  );
  scheduleNextThumbnailBackfillRun(THUMB_BACKFILL_ACTIVE_INTERVAL_MS);
}

// Task #237: poll the reset-signal control row. When the API process
// has stamped `resetRequestedAt` newer than the last `resetAcknowledgedAt`,
// zero the in-memory provider counters and stamp the ack so the same
// signal isn't replayed forever. Returns the structured outcome so the
// caller (snapshot recorder) can include it in logs. Idempotent and
// best-effort: any DB error is swallowed so a transient hiccup never
// stalls the metrics pipeline.
export async function processQueueMetricsResetSignal(): Promise<{
  acknowledged: boolean;
  requestedAt: string | null;
  acknowledgedAt: string | null;
  actor: string | null;
}> {
  try {
    const rows = await db
      .select({
        requestedAt: adResearchBoardQueueMetricsControl.resetRequestedAt,
        acknowledgedAt: adResearchBoardQueueMetricsControl.resetAcknowledgedAt,
        actor: adResearchBoardQueueMetricsControl.lastResetActor,
        dryRun: adResearchBoardQueueMetricsControl.lastResetDryRun,
      })
      .from(adResearchBoardQueueMetricsControl)
      .where(eq(adResearchBoardQueueMetricsControl.id, 1))
      .limit(1);
    const row = rows[0];
    if (!row || !row.requestedAt) {
      return { acknowledged: false, requestedAt: null, acknowledgedAt: null, actor: null };
    }
    const reqMs = new Date(row.requestedAt).getTime();
    const ackMs = row.acknowledgedAt ? new Date(row.acknowledgedAt).getTime() : 0;
    if (reqMs <= ackMs) {
      return {
        acknowledged: false,
        requestedAt: new Date(row.requestedAt).toISOString(),
        acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt).toISOString() : null,
        actor: row.actor ?? null,
      };
    }
    if (!row.dryRun) {
      resetProviderCounters();
    }
    const ackAt = new Date();
    await db
      .update(adResearchBoardQueueMetricsControl)
      .set({ resetAcknowledgedAt: ackAt })
      .where(eq(adResearchBoardQueueMetricsControl.id, 1));
    logger.info(
      {
        actor: row.actor ?? null,
        requestedAt: new Date(row.requestedAt).toISOString(),
        acknowledgedAt: ackAt.toISOString(),
        dryRun: row.dryRun ?? false,
        workerId: WORKER_ID,
      },
      "media-downloader: queue-health reset signal acknowledged",
    );
    return {
      acknowledged: true,
      requestedAt: new Date(row.requestedAt).toISOString(),
      acknowledgedAt: ackAt.toISOString(),
      actor: row.actor ?? null,
    };
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        cause: err?.cause?.message ?? err?.cause,
        code: err?.code ?? err?.cause?.code,
        detail: err?.detail ?? err?.cause?.detail,
      },
      "media-downloader: queue-health reset signal poll failed",
    );
    return { acknowledged: false, requestedAt: null, acknowledgedAt: null, actor: null };
  }
}

// Task #137 (scaling pass): historical queue metrics. Writes a snapshot
// row capturing status counts, throughput, and processing latency. The
// dashboard reads the most recent N rows to render trend charts without
// re-aggregating raw items on every poll. Each snapshot is two cheap
// indexed COUNTs + an INSERT, so this is safe to run every 5 min.
export async function recordQueueMetricsSnapshot(): Promise<void> {
  // Task #237: process any pending reset signal BEFORE collecting
  // counters. Guarantees the snapshot row that lands after a reset
  // starts from a zeroed in-memory baseline rather than draining the
  // pre-reset accumulator into the first post-reset row. Note: we
  // re-check inside the lock-protected transaction below so that a
  // reset which lands while we are gathering reads is still honored
  // before the row is inserted.
  await processQueueMetricsResetSignal();
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const [
      statusRows,
      stuckRow,
      activeRow,
      throughput1hRow,
      throughput24hRow,
      failures1hRow,
      procRows,
    ] = await Promise.all([
      db
        .select({ status: adResearchBoardItems.mediaStatus, n: count() })
        .from(adResearchBoardItems)
        .where(eq(adResearchBoardItems.dismissed, false))
        .groupBy(adResearchBoardItems.mediaStatus),
      db
        .select({ n: count() })
        .from(adResearchBoardItems)
        .where(
          and(
            eq(adResearchBoardItems.dismissed, false),
            eq(adResearchBoardItems.mediaStatus, "downloading"),
            or(
              isNull(adResearchBoardItems.mediaDownloadedAt),
              lt(adResearchBoardItems.mediaDownloadedAt, stuckCutoff),
            ),
          ),
        ),
      db
        .select({ n: count() })
        .from(adResearchBoardItems)
        .where(
          and(
            isNotNull(adResearchBoardItems.mediaLeaseOwner),
            isNotNull(adResearchBoardItems.mediaLeaseUntil),
            gt(adResearchBoardItems.mediaLeaseUntil, sql`now()`),
          ),
        ),
      db
        .select({ n: count() })
        .from(adResearchBoardItems)
        .where(
          and(
            eq(adResearchBoardItems.mediaStatus, "ok"),
            gte(adResearchBoardItems.mediaDownloadedAt, oneHourAgo),
          ),
        ),
      db
        .select({ n: count() })
        .from(adResearchBoardItems)
        .where(
          and(
            eq(adResearchBoardItems.mediaStatus, "ok"),
            gte(adResearchBoardItems.mediaDownloadedAt, oneDayAgo),
          ),
        ),
      db
        .select({ n: count() })
        .from(adResearchBoardItems)
        .where(
          and(
            eq(adResearchBoardItems.mediaStatus, "failed"),
            gte(adResearchBoardItems.updatedAt, oneHourAgo),
          ),
        ),
      db
        .select({ ms: adResearchBoardItems.mediaLastProcessingMs })
        .from(adResearchBoardItems)
        .where(
          and(
            isNotNull(adResearchBoardItems.mediaLastProcessingMs),
            gte(adResearchBoardItems.updatedAt, oneHourAgo),
          ),
        )
        .orderBy(desc(adResearchBoardItems.updatedAt))
        .limit(200),
    ]);

    const buckets = { ok: 0, failed: 0, pending: 0, downloading: 0, partial: 0 };
    for (const r of statusRows) {
      const n = Number(r.n);
      if (r.status === "ok") buckets.ok += n;
      else if (r.status === "failed") buckets.failed += n;
      else if (r.status === "partial") buckets.partial += n;
      else if (r.status === "downloading") buckets.downloading += n;
      else buckets.pending += n;
    }
    const samples = procRows
      .map((r) => Number(r.ms ?? 0))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const avg = samples.length > 0
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : null;
    const p95 = samples.length > 0
      ? Math.round(samples[Math.min(samples.length - 1, Math.floor(0.95 * samples.length))])
      : null;

    // Outcome fields for sparklines; reuse queue-health snapshot.
    let outcomeFields = {
      totalRows: 0, usableMedia: 0, successRateBp: 0, terminalFailures: 0,
      dismissedTotal: 0, authFailures24h: 0, rateLimits24h: 0,
      providerFailures24h: 0, retryVolume24h: 0,
    };
    try {
      const snap = await getQueueHealth();
      outcomeFields = {
        totalRows: snap.outcomes.totalProcessed,
        usableMedia: snap.outcomes.usableMedia,
        successRateBp: snap.outcomes.successRateBp,
        terminalFailures: snap.outcomes.terminalFailures,
        dismissedTotal: snap.outcomes.dismissedTotal,
        authFailures24h: snap.outcomes.authBlocked,
        rateLimits24h: snap.outcomes.rateLimited,
        providerFailures24h: snap.outcomes.providerFailures,
        retryVolume24h: snap.outcomes.retrying,
      };
    } catch {
      // Snapshot row still gets the legacy fields below even if the
      // outcome rollup query failed - we never want a transient DB
      // hiccup to produce a missing data point in the time series.
    }

    // Task #237: lock-protected critical section. The advisory lock is
    // held by both this snapshot writer and the admin reset endpoint.
    // Holding it across "drain counters + INSERT + retention prune"
    // guarantees the API's provider-mix UPDATE cannot interleave with
    // our INSERT, and re-checking the reset signal *after* acquiring
    // the lock guarantees that if a reset landed while we were
    // gathering reads, the counters drained into this row start at
    // zero.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${QUEUE_METRICS_LOCK_KEY})`);
      await processQueueMetricsResetSignal();
      // Task #158: drain per-provider counters into the snapshot row and
      // reset them so the next interval starts at zero. Each row therefore
      // captures the activity in its 5-min window (matching the way the
      // dashboard reads the trend table).
      const providers = snapshotAndResetProviderCounters();
      await tx.insert(adResearchBoardQueueMetrics).values({
      statusPending: buckets.pending,
      statusDownloading: buckets.downloading,
      statusOk: buckets.ok,
      statusFailed: buckets.failed,
      statusPartial: buckets.partial,
      stuck: Number(stuckRow[0]?.n ?? 0),
      activeLeases: Number(activeRow[0]?.n ?? 0),
      throughput1h: Number(throughput1hRow[0]?.n ?? 0),
      throughput24h: Number(throughput24hRow[0]?.n ?? 0),
      failures1h: Number(failures1hRow[0]?.n ?? 0),
      avgProcessingMs: avg,
      p95ProcessingMs: p95,
      ...outcomeFields,
      apifySuccess: providers.apifySuccess,
      ytdlpSuccess: providers.ytdlpSuccess,
      escalationCount: providers.escalationCount,
      escalationRecovered: providers.escalationRecovered,
      ytdlpAuthRecoveries: providers.ytdlpAuthRecoveries,
      igRateLimitHits: providers.igRateLimitHits,
      igCooldownsTriggered: providers.igCooldownsTriggered,
      // Task #209: drain the four IG cookie continuity counters into
      // the snapshot row so the dashboard can chart materialize/attach
      // success vs fail per 5-min interval.
      igCookieMaterializeSuccess: providers.igCookieMaterializeSuccess,
      igCookieMaterializeFail: providers.igCookieMaterializeFail,
      igCookieAttachSuccess: providers.igCookieAttachSuccess,
      igCookieAttachFail: providers.igCookieAttachFail,
      // Task #197: drain the new recovery-pipeline counters into the
      // 5-min snapshot row so the dashboard can chart them and a 24h
      // rollup query can sum them across intervals (mirrors the
      // existing apifySuccess / ytdlpSuccess pattern).
      invalidUrlsBlocked: providers.invalidUrlsBlocked,
      deadContentDismissed: providers.deadContentDismissed,
      delayedRetriesScheduled: providers.delayedRetriesScheduled,
      temporaryRecoveries: providers.temporaryRecoveries,
      authRecoveries: providers.authRecoveries,
      extractorRecoveries: providers.extractorRecoveries,
      avgRecoveryLatencyMs: providers.recoveryLatencySamples > 0
        ? Math.round(providers.recoveryLatencyMsSum / providers.recoveryLatencySamples)
        : null,
      // Task #197: per-actor success map captured in this 5-min window.
      // Stored as JSONB so the rollup query can SUM the maps key-by-key
      // across all snapshots in the dashboard window without an extra
      // table join.
      perActorSuccess: providers.perActorSuccess,
      });

      // Best-effort retention prune inside the same lock-protected
      // transaction so it cannot race the admin reset. Bounded by an
      // indexed timestamp so this stays cheap even as the table grows.
      const retentionCutoff = new Date(Date.now() - QUEUE_METRICS_RETENTION_MS);
      await tx
        .delete(adResearchBoardQueueMetrics)
        .where(lt(adResearchBoardQueueMetrics.capturedAt, retentionCutoff));
    });
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "media-downloader: queue metrics snapshot failed",
    );
  }
}

let metricsRecorderTimer: NodeJS.Timeout | null = null;
export function startQueueMetricsRecorder(): void {
  if (metricsRecorderTimer) return;
  logger.info(
    { intervalMs: QUEUE_METRICS_INTERVAL_MS, retentionMs: QUEUE_METRICS_RETENTION_MS },
    "media-downloader: queue metrics recorder scheduled",
  );
  // Fire-and-forget initial snapshot so the dashboard has at least one
  // data point shortly after boot, then settle into the cadence.
  recordQueueMetricsSnapshot().catch(() => undefined);
  metricsRecorderTimer = setInterval(() => {
    recordQueueMetricsSnapshot().catch(() => undefined);
  }, QUEUE_METRICS_INTERVAL_MS);
  metricsRecorderTimer.unref?.();
}

// Task #237: dedicated fast-poll watcher for the queue-health reset
// signal. The full snapshot recorder runs every 5 minutes which is too
// slow for the in-memory provider counters to clear after an admin
// triggers a reset. This watcher runs every few seconds, processes any
// pending reset signal (zeroing in-memory counters and stamping the
// ack timestamp), and exits quietly when there is no pending signal.
// Designed to run alongside `startQueueMetricsRecorder` on the worker
// process; harmless if the recorder also processes the same signal -
// `processQueueMetricsResetSignal` is idempotent (ack timestamp gates
// the work).
let metricsResetWatcherTimer: NodeJS.Timeout | null = null;
const QUEUE_METRICS_RESET_POLL_MS = (() => {
  const raw = process.env["AD_RESEARCH_RESET_POLL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 5_000;
})();
export function startQueueMetricsResetWatcher(): void {
  if (metricsResetWatcherTimer) return;
  logger.info(
    { intervalMs: QUEUE_METRICS_RESET_POLL_MS, workerId: WORKER_ID },
    "media-downloader: queue-health reset watcher scheduled",
  );
  // Fire once at boot so a reset that landed while the worker was
  // restarting still gets picked up before the first snapshot tick.
  processQueueMetricsResetSignal().catch(() => undefined);
  metricsResetWatcherTimer = setInterval(() => {
    processQueueMetricsResetSignal().catch(() => undefined);
  }, QUEUE_METRICS_RESET_POLL_MS);
  metricsResetWatcherTimer.unref?.();
}

// Task #137 (scaling pass): historical trend snapshots for the dashboard.
// Returns the most recent points within the requested window so the
// frontend can render small sparklines without aggregating raw items.
export async function getQueueTrends(opts: { hours?: number } = {}): Promise<{
  windowHours: number;
  points: Array<{
    capturedAt: string;
    statusPending: number;
    statusDownloading: number;
    statusOk: number;
    statusFailed: number;
    statusPartial: number;
    stuck: number;
    activeLeases: number;
    throughput1h: number;
    throughput24h: number;
    failures1h: number;
    avgProcessingMs: number | null;
    p95ProcessingMs: number | null;
    totalRows: number;
    usableMedia: number;
    successRateBp: number;
    terminalFailures: number;
    dismissedTotal: number;
    authFailures24h: number;
    rateLimits24h: number;
    providerFailures24h: number;
    retryVolume24h: number;
    apifySuccess: number;
    ytdlpSuccess: number;
    escalationCount: number;
    escalationRecovered: number;
    ytdlpAuthRecoveries: number;
    igRateLimitHits: number;
    igCooldownsTriggered: number;
    igCookieMaterializeSuccess: number;
    igCookieMaterializeFail: number;
    igCookieAttachSuccess: number;
    igCookieAttachFail: number;
  }>;
}> {
  const hours = Math.max(1, Math.min(168, opts.hours ?? 24));
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      capturedAt: adResearchBoardQueueMetrics.capturedAt,
      statusPending: adResearchBoardQueueMetrics.statusPending,
      statusDownloading: adResearchBoardQueueMetrics.statusDownloading,
      statusOk: adResearchBoardQueueMetrics.statusOk,
      statusFailed: adResearchBoardQueueMetrics.statusFailed,
      statusPartial: adResearchBoardQueueMetrics.statusPartial,
      stuck: adResearchBoardQueueMetrics.stuck,
      activeLeases: adResearchBoardQueueMetrics.activeLeases,
      throughput1h: adResearchBoardQueueMetrics.throughput1h,
      throughput24h: adResearchBoardQueueMetrics.throughput24h,
      failures1h: adResearchBoardQueueMetrics.failures1h,
      avgProcessingMs: adResearchBoardQueueMetrics.avgProcessingMs,
      p95ProcessingMs: adResearchBoardQueueMetrics.p95ProcessingMs,
      totalRows: adResearchBoardQueueMetrics.totalRows,
      usableMedia: adResearchBoardQueueMetrics.usableMedia,
      successRateBp: adResearchBoardQueueMetrics.successRateBp,
      terminalFailures: adResearchBoardQueueMetrics.terminalFailures,
      dismissedTotal: adResearchBoardQueueMetrics.dismissedTotal,
      authFailures24h: adResearchBoardQueueMetrics.authFailures24h,
      rateLimits24h: adResearchBoardQueueMetrics.rateLimits24h,
      providerFailures24h: adResearchBoardQueueMetrics.providerFailures24h,
      retryVolume24h: adResearchBoardQueueMetrics.retryVolume24h,
      apifySuccess: adResearchBoardQueueMetrics.apifySuccess,
      ytdlpSuccess: adResearchBoardQueueMetrics.ytdlpSuccess,
      escalationCount: adResearchBoardQueueMetrics.escalationCount,
      escalationRecovered: adResearchBoardQueueMetrics.escalationRecovered,
      ytdlpAuthRecoveries: adResearchBoardQueueMetrics.ytdlpAuthRecoveries,
      igRateLimitHits: adResearchBoardQueueMetrics.igRateLimitHits,
      igCooldownsTriggered: adResearchBoardQueueMetrics.igCooldownsTriggered,
      igCookieMaterializeSuccess: adResearchBoardQueueMetrics.igCookieMaterializeSuccess,
      igCookieMaterializeFail: adResearchBoardQueueMetrics.igCookieMaterializeFail,
      igCookieAttachSuccess: adResearchBoardQueueMetrics.igCookieAttachSuccess,
      igCookieAttachFail: adResearchBoardQueueMetrics.igCookieAttachFail,
    })
    .from(adResearchBoardQueueMetrics)
    .where(gte(adResearchBoardQueueMetrics.capturedAt, cutoff))
    .orderBy(asc(adResearchBoardQueueMetrics.capturedAt));
  return {
    windowHours: hours,
    points: rows.map((r) => ({
      capturedAt: r.capturedAt instanceof Date ? r.capturedAt.toISOString() : String(r.capturedAt),
      statusPending: r.statusPending,
      statusDownloading: r.statusDownloading,
      statusOk: r.statusOk,
      statusFailed: r.statusFailed,
      statusPartial: r.statusPartial,
      stuck: r.stuck,
      activeLeases: r.activeLeases,
      throughput1h: r.throughput1h,
      throughput24h: r.throughput24h,
      failures1h: r.failures1h,
      avgProcessingMs: r.avgProcessingMs,
      p95ProcessingMs: r.p95ProcessingMs,
      totalRows: r.totalRows,
      usableMedia: r.usableMedia,
      successRateBp: r.successRateBp,
      terminalFailures: r.terminalFailures,
      dismissedTotal: r.dismissedTotal,
      authFailures24h: r.authFailures24h,
      rateLimits24h: r.rateLimits24h,
      providerFailures24h: r.providerFailures24h,
      retryVolume24h: r.retryVolume24h,
      apifySuccess: r.apifySuccess,
      ytdlpSuccess: r.ytdlpSuccess,
      escalationCount: r.escalationCount,
      escalationRecovered: r.escalationRecovered,
      ytdlpAuthRecoveries: r.ytdlpAuthRecoveries,
      igRateLimitHits: r.igRateLimitHits,
      igCooldownsTriggered: r.igCooldownsTriggered,
      igCookieMaterializeSuccess: r.igCookieMaterializeSuccess,
      igCookieMaterializeFail: r.igCookieMaterializeFail,
      igCookieAttachSuccess: r.igCookieAttachSuccess,
      igCookieAttachFail: r.igCookieAttachFail,
    })),
  };
}
