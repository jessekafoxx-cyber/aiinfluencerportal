// Task #175: bring the Facebook cookies admin panel up to parity with
// the Instagram cookies panel. Admins can paste either a Netscape
// `cookies.txt` export OR a Cookie-Editor JSON export. JSON pastes are
// normalized to Netscape format eagerly so yt-dlp's `--cookies <file>`
// path works unchanged. The resulting Netscape text is encrypted at
// rest with AES-256-GCM keyed off `FACEBOOK_COOKIES_SECRET` before it
// is uploaded to object storage. A backward-compatible read path keeps
// any pre-existing plaintext jars working.
//
// Public API:
//   parseFbCookies(text)          - auto-detect Netscape | JSON, normalize, validate
//   isFbConfigured()              - whether FACEBOOK_COOKIES_SECRET is set
//   encryptFbBytes(text)          - encrypt Netscape text -> envelope buffer
//   decryptFbBytes(buf)           - envelope buffer | legacy plaintext -> Netscape text
//   markFbSessionExpired(reason)  - flip the active FB jar to 'expired'

import crypto from "crypto";
import { logger } from "./logger";

export const FB_REQUIRED_COOKIES = ["c_user", "xs", "datr"] as const;

export interface NormalizedFbCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number; // unix seconds; 0 means session cookie
}

export interface ParsedFbCookies {
  format: "netscape" | "json";
  cookies: NormalizedFbCookie[];
  netscapeText: string;
  missingRequired: string[];
}

// ── Encryption ─────────────────────────────────────────────────────────
interface EncryptedBlob {
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

function getKey(): Buffer {
  const raw = process.env.FACEBOOK_COOKIES_SECRET;
  if (!raw) {
    throw new Error(
      "FACEBOOK_COOKIES_SECRET env var is not set. Set it before saving Facebook session cookies.",
    );
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isFbConfigured(): boolean {
  return !!process.env.FACEBOOK_COOKIES_SECRET;
}

function encrypt(plain: string): EncryptedBlob {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ct.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(blob: EncryptedBlob): string {
  const key = getKey();
  const iv = Buffer.from(blob.iv, "base64");
  const ct = Buffer.from(blob.ciphertext, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Encrypt Netscape cookie text and return the buffer to persist. */
export function encryptFbBytes(plain: string): Buffer {
  const blob = encrypt(plain);
  return Buffer.from(JSON.stringify(blob), "utf8");
}

/**
 * Decrypt bytes from object storage. Backward-compatible: if the bytes
 * are not an encryption envelope (legacy plaintext Netscape jars
 * uploaded before T175), return the bytes verbatim as utf8 text.
 */
export function decryptFbBytes(buf: Buffer): string {
  const text = buf.toString("utf8");
  // Cheap probe before JSON.parse on multi-MB input.
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed
        && typeof parsed === "object"
        && parsed.alg === "aes-256-gcm"
        && typeof parsed.iv === "string"
        && typeof parsed.ciphertext === "string"
        && typeof parsed.authTag === "string"
      ) {
        return decrypt(parsed as EncryptedBlob);
      }
    } catch {
      // not JSON envelope -> fall through to plaintext
    }
  }
  return text;
}

// ── Parsing & normalization ────────────────────────────────────────────
//
// Detect the input format up-front and emit a clear, format-specific
// error rather than the generic "no tab-separated rows" message that
// the legacy Netscape-only validator produced for JSON pastes.

function looksLikeJson(input: string): boolean {
  const t = input.trimStart();
  return t.startsWith("[") || t.startsWith("{");
}

function escapeNetscapeField(v: string): string {
  // Netscape cookies.txt fields are tab-separated; tabs in a value
  // would corrupt the row. Strip them defensively. yt-dlp tolerates
  // newline removal too.
  return v.replace(/[\t\r\n]+/g, " ");
}

function cookieToNetscapeRow(c: NormalizedFbCookie): string {
  const domain = c.domain || ".facebook.com";
  const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
  return [
    domain,
    includeSubdomains,
    c.path || "/",
    c.secure ? "TRUE" : "FALSE",
    String(c.expires || 0),
    escapeNetscapeField(c.name),
    escapeNetscapeField(c.value),
  ].join("\t");
}

function buildNetscape(cookies: NormalizedFbCookie[]): string {
  const lines = ["# Netscape HTTP Cookie File", "# Generated by GREGORY admin panel", ""];
  for (const c of cookies) lines.push(cookieToNetscapeRow(c));
  lines.push("");
  return lines.join("\n");
}

function parseNetscape(text: string): NormalizedFbCookie[] {
  const out: NormalizedFbCookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      if (trimmed.toLowerCase().startsWith("#httponly_")) {
        line = line.replace(/^#HttpOnly_/i, "");
      } else {
        continue;
      }
    }
    const f = line.split("\t");
    if (f.length < 7) continue;
    const expiresNum = Number(f[4]);
    out.push({
      domain: f[0],
      path: f[2] || "/",
      secure: f[3]?.toUpperCase() === "TRUE",
      httpOnly: false,
      expires: Number.isFinite(expiresNum) ? Math.floor(expiresNum) : 0,
      name: f[5],
      value: f.slice(6).join("\t"),
    });
  }
  return out;
}

function parseJsonExport(text: string): NormalizedFbCookie[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`JSON cookie export is not valid JSON: ${err?.message || err}`);
  }
  let arr: unknown;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).cookies)) {
    arr = (parsed as any).cookies;
  } else {
    throw new Error("JSON cookie export must be an array or { cookies: [...] }.");
  }
  const list = arr as unknown[];
  if (list.length === 0) throw new Error("JSON cookie export contains no cookies.");
  const out: NormalizedFbCookie[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const value = typeof c.value === "string" ? c.value : "";
    if (!name || !value) continue;
    const rawDomain = typeof c.domain === "string" ? c.domain : "";
    const domain = rawDomain || ".facebook.com";
    const path = typeof c.path === "string" && c.path ? c.path : "/";
    const expiresField = c.expires ?? c.expirationDate ?? c.expiry;
    const expires = typeof expiresField === "number" && Number.isFinite(expiresField)
      ? Math.floor(expiresField)
      : 0;
    out.push({
      name,
      value,
      domain,
      path,
      secure: typeof c.secure === "boolean" ? c.secure : false,
      httpOnly: typeof c.httpOnly === "boolean" ? c.httpOnly : false,
      expires,
    });
  }
  if (out.length === 0) throw new Error("JSON cookie export had no usable cookies after normalization.");
  return out;
}

/**
 * Auto-detect Netscape vs JSON, normalize to a canonical cookie list,
 * regenerate Netscape text (so yt-dlp can consume the result either
 * way), and check that the required FB cookies are present.
 *
 * Throws with a clear, format-specific message on a parse failure.
 */
export function parseFbCookies(rawInput: string): ParsedFbCookies {
  if (!rawInput || typeof rawInput !== "string" || !rawInput.trim()) {
    throw new Error("Cookie input is empty.");
  }
  const isJson = looksLikeJson(rawInput);
  const cookies = isJson ? parseJsonExport(rawInput) : parseNetscape(rawInput);
  if (cookies.length === 0) {
    if (isJson) throw new Error("JSON cookie export had no usable cookies.");
    throw new Error("Netscape cookies.txt had no tab-separated cookie rows.");
  }
  const missingRequired = FB_REQUIRED_COOKIES.filter(
    (n) => !cookies.some((c) => c.name === n),
  );
  return {
    format: isJson ? "json" : "netscape",
    cookies,
    netscapeText: buildNetscape(cookies),
    missingRequired,
  };
}

// ── Auto-expiry hook ───────────────────────────────────────────────────
//
// Mirrors instagram-session-cookies.markSessionExpired. Called by
// yt-dlp / Apify call sites when an FB auth-wall is detected at
// runtime so the admin panel reflects the expiry without waiting for
// a manual Test Session click.

export async function markFbSessionExpired(reason: string | null): Promise<void> {
  try {
    const mod = await import("./auth-cookies");
    const active = await mod.resolveActiveJar("fb");
    if (!active || active.status === "expired") return;
    await mod.markJarStatus("fb", "expired", (reason || "auth-blocked").slice(0, 200));
    invalidateFbApifyCache();
    logger.warn({ reason, jarId: active.id }, "facebook-cookies: session marked expired");
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "facebook-cookies: failed to mark session expired",
    );
  }
}

// ── Apify input injection (Task #178) ──────────────────────────────────
//
// Mirrors instagram-session-cookies.ts. Apify FB actors accept a
// `cookies` array of {name,value,domain,path,...} entries; injecting
// the admin-managed jar lifts a chunk of FB extractions out of the
// authenticated-only login wall. Loader is per-cache-window cached so
// a sweep of many rows produces at most one log line per window.

export interface ApifyFbCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
}

const FB_ACTOR_PATTERNS: RegExp[] = [
  /(^|[/~])facebook[-_]?(posts[-_]?scraper|comments[-_]?scraper|reel[-_]?scraper|reels[-_]?scraper|pages[-_]?scraper|page[-_]?scraper|videos[-_]?scraper|video[-_]?scraper|ads[-_]?scraper|ad[-_]?library[-_]?scraper)/i,
];

export function isFacebookActor(actorPathOrId: string): boolean {
  if (!actorPathOrId) return false;
  return FB_ACTOR_PATTERNS.some((re) => re.test(actorPathOrId));
}

const FB_COOKIE_CACHE_TTL_MS = 60_000;

interface FbCacheEntry {
  jarId: number;
  uploadedAtMs: number;
  cookies: ApifyFbCookie[] | null;
  status: "active" | "expired" | "missing";
  expiresAt: number;
}

let fbCache: FbCacheEntry | null = null;
let fbWarnedThisInterval = false;
let fbWarnedClearedAt = 0;
let fbAttachedLoggedAt = 0;

export function invalidateFbApifyCache(): void {
  fbCache = null;
  fbWarnedThisInterval = false;
  fbAttachedLoggedAt = 0;
}

function netscapeToApifyCookies(text: string): ApifyFbCookie[] {
  const out: ApifyFbCookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      if (trimmed.toLowerCase().startsWith("#httponly_")) {
        line = line.replace(/^#HttpOnly_/i, "");
      } else {
        continue;
      }
    }
    const f = line.split("\t");
    if (f.length < 7) continue;
    const expiresNum = Number(f[4]);
    const name = f[5];
    const value = f.slice(6).join("\t");
    if (!name || !value) continue;
    out.push({
      name,
      value,
      domain: f[0] || ".facebook.com",
      path: f[2] || "/",
      secure: (f[3] || "").toUpperCase() === "TRUE",
      ...(Number.isFinite(expiresNum) && expiresNum > 0
        ? { expires: Math.floor(expiresNum) }
        : {}),
    });
  }
  return out;
}

function maybeLogFbMissing(state: "missing" | "expired"): void {
  const now = Date.now();
  if (fbWarnedThisInterval && now - fbWarnedClearedAt < FB_COOKIE_CACHE_TTL_MS) return;
  fbWarnedThisInterval = true;
  fbWarnedClearedAt = now;
  logger.warn(
    { state },
    state === "expired"
      ? "facebook-cookies: saved session is marked expired - paste fresh cookies"
      : "facebook-cookies: no saved session cookies; running Apify Facebook actor anonymously",
  );
}

async function readActiveFbJar(): Promise<
  { jarId: number; uploadedAtMs: number; status: string; cookies: ApifyFbCookie[] } | null
> {
  const auth = await import("./auth-cookies");
  const active = await auth.resolveActiveJar("fb");
  if (!active) return null;
  const plain = await auth.readActiveJarPlaintext("fb");
  if (!plain) return null;
  const cookies = netscapeToApifyCookies(plain.text);
  return { jarId: plain.jarId, uploadedAtMs: plain.uploadedAtMs, status: active.status, cookies };
}

export async function loadFbCookiesForApify(): Promise<ApifyFbCookie[] | null> {
  const now = Date.now();
  if (fbCache && fbCache.expiresAt > now) {
    return fbCache.status === "active" ? fbCache.cookies : null;
  }
  let info: { jarId: number; uploadedAtMs: number; status: string; cookies: ApifyFbCookie[] } | null;
  try {
    info = await readActiveFbJar();
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "facebook-cookies: failed to read active jar",
    );
    return null;
  }
  if (!info) {
    fbCache = { jarId: 0, uploadedAtMs: 0, cookies: null, status: "missing", expiresAt: now + FB_COOKIE_CACHE_TTL_MS };
    maybeLogFbMissing("missing");
    return null;
  }
  if (info.status === "expired") {
    fbCache = {
      jarId: info.jarId,
      uploadedAtMs: info.uploadedAtMs,
      cookies: null,
      status: "expired",
      expiresAt: now + FB_COOKIE_CACHE_TTL_MS,
    };
    maybeLogFbMissing("expired");
    return null;
  }
  if (info.cookies.length === 0) {
    fbCache = {
      jarId: info.jarId,
      uploadedAtMs: info.uploadedAtMs,
      cookies: null,
      status: "missing",
      expiresAt: now + FB_COOKIE_CACHE_TTL_MS,
    };
    maybeLogFbMissing("missing");
    return null;
  }
  fbCache = {
    jarId: info.jarId,
    uploadedAtMs: info.uploadedAtMs,
    cookies: info.cookies,
    status: "active",
    expiresAt: now + FB_COOKIE_CACHE_TTL_MS,
  };
  fbWarnedThisInterval = false;
  // Throttled "cookies attached" structured log (one per cache window)
  // so operators can verify production runs really are authenticated.
  if (now - fbAttachedLoggedAt > FB_COOKIE_CACHE_TTL_MS) {
    fbAttachedLoggedAt = now;
    logger.info(
      { jarId: info.jarId, cookieCount: info.cookies.length },
      "facebook-cookies: cookies attached for Apify FB actors",
    );
  }
  return info.cookies;
}

export async function withFacebookSessionCookies<T extends Record<string, unknown>>(
  actorPathOrId: string,
  input: T,
): Promise<T> {
  if (!isFacebookActor(actorPathOrId)) return input;
  let cookies: ApifyFbCookie[] | null = null;
  try {
    cookies = await loadFbCookiesForApify();
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), actor: actorPathOrId },
      "facebook-cookies: failed to load cookies; proceeding anonymously",
    );
    return input;
  }
  if (!cookies || cookies.length === 0) return input;
  return applyFbCookiesToInput(input, cookies);
}

/**
 * Like `withFacebookSessionCookies` but also reports whether the
 * admin-managed jar was actually injected into the input. Callers
 * that drive auto-expiry on auth-blocked responses should use this
 * variant so they don't false-flip the saved jar to expired when the
 * caller already supplied its own `cookies` value (or when there's
 * no jar / no FB actor to begin with).
 */
export async function withFacebookSessionCookiesTracked<
  T extends Record<string, unknown>,
>(actorPathOrId: string, input: T): Promise<{ input: T; attached: boolean }> {
  if (!isFacebookActor(actorPathOrId)) return { input, attached: false };
  let cookies: ApifyFbCookie[] | null = null;
  try {
    cookies = await loadFbCookiesForApify();
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), actor: actorPathOrId },
      "facebook-cookies: failed to load cookies; proceeding anonymously",
    );
    return { input, attached: false };
  }
  if (!cookies || cookies.length === 0) return { input, attached: false };
  // Only consider the jar "attached" when the helper actually
  // populated at least one of the FB cookie fields (i.e. the caller
  // didn't pre-supply every variant). This avoids false-flipping the
  // saved jar to expired when the caller already brought its own
  // session and our helper became a no-op.
  const src = input as Record<string, unknown>;
  const callerProvidedAll =
    src.cookies !== undefined
    && src.loginCookies !== undefined
    && src.sessionCookies !== undefined;
  const next = applyFbCookiesToInput(input, cookies);
  return { input: next, attached: !callerProvidedAll };
}

/**
 * Merge an FB session jar into an Apify actor input under the field
 * names the various FB actors look for, without clobbering a
 * caller-provided value. Shared between runtime injection and the
 * admin Test Session probe so probe / production parity is exact.
 */
function applyFbCookiesToInput<T extends Record<string, unknown>>(
  input: T,
  cookies: ApifyFbCookie[],
): T {
  const next = { ...input } as Record<string, unknown>;
  // Different Apify FB actors look for the session jar under different
  // input field names (the canonical posts/comments/pages scrapers use
  // `cookies`, while a few community actors mirror IG and read
  // `loginCookies` / `sessionCookies`). Set all three so we light up
  // every actor we touch.
  if (next.cookies === undefined) next.cookies = cookies;
  if (next.loginCookies === undefined) next.loginCookies = cookies;
  if (next.sessionCookies === undefined) next.sessionCookies = cookies;
  return next as T;
}

// ── Admin "Test session" probe (Task #178) ─────────────────────────────
//
// Mirrors instagram-session-cookies.testWithApify. Runs an authenticated
// Apify FB actor against a stable public page so the admin can verify
// the saved jar end-to-end (decrypt -> inject -> Apify -> dataset). On
// failure the active jar is auto-flipped to `expired`; on success any
// stale `expired` flag is cleared.

export interface FbTestResult {
  ok: boolean;
  status:
    | "ok"
    | "auth-blocked"
    | "rate-limited"
    | "no-cookies"
    | "no-token"
    | "actor-error"
    | "timeout"
    | "no-data"
    | "quota-exceeded";
  error: string | null;
  sample: { pageName: string; followers: number | null } | null;
}

const FB_TEST_PAGE_URL = "https://www.facebook.com/MetaforDevelopers";

async function loadCookiesIgnoringStatus(): Promise<ApifyFbCookie[] | null> {
  try {
    const auth = await import("./auth-cookies");
    const plain = await auth.readActiveJarPlaintext("fb");
    if (!plain) return null;
    const cookies = netscapeToApifyCookies(plain.text);
    return cookies.length > 0 ? cookies : null;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "facebook-cookies: failed to read jar for probe",
    );
    return null;
  }
}

async function clearFbExpiredFlagOnSuccess(): Promise<void> {
  try {
    const auth = await import("./auth-cookies");
    const active = await auth.resolveActiveJar("fb");
    if (!active || active.status === "active") return;
    await auth.markJarStatus("fb", "active", null);
    invalidateFbApifyCache();
  } catch {
    /* swallow */
  }
}

export async function testWithApify(): Promise<FbTestResult> {
  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!token) {
    return { ok: false, status: "no-token", error: "APIFY_TOKEN env var not set", sample: null };
  }
  const cookies = await loadCookiesIgnoringStatus();
  if (!cookies || cookies.length === 0) {
    return { ok: false, status: "no-cookies", error: "No saved session cookies", sample: null };
  }
  const actor = "apify~facebook-pages-scraper";
  // Use the shared injection helper so the probe sets cookies under
  // the exact same field names that production runs do.
  const input = applyFbCookiesToInput(
    { startUrls: [{ url: FB_TEST_PAGE_URL }], resultsLimit: 1 } as Record<string, unknown>,
    cookies,
  );
  const url =
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=25&memory=1024`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = (await resp.text().catch(() => "")).slice(0, 300);
      const helpers = await import("./media-downloader-helpers");
      // Task #181: classify the failure with the shared helper so the
      // FB/IG probes and the production wrappers all use the same
      // decision path. Quota is matched first - those responses arrive
      // as HTTP 403 `platform-feature-disabled` and the cookies are
      // perfectly valid, so we must NOT auto-expire the jar.
      const kind = helpers.classifyApifyHttpFailure(resp.status, body);
      if (kind === "quota") {
        helpers.noteApifyQuotaSignal();
        return {
          ok: false,
          status: "quota-exceeded",
          error: `Apify monthly usage hard limit exceeded (HTTP ${resp.status}): ${body}`,
          sample: null,
        };
      }
      if (kind === "auth") {
        await markFbSessionExpired(`probe HTTP ${resp.status}`);
        return { ok: false, status: "auth-blocked", error: `HTTP ${resp.status}: ${body}`, sample: null };
      }
      return { ok: false, status: "actor-error", error: `HTTP ${resp.status}: ${body}`, sample: null };
    }
    const data = await resp.json().catch(() => null);
    const items = Array.isArray(data) ? data : [];
    if (items.length === 0) {
      // Task #181: an empty dataset right after a recent Apify quota
      // signal is most likely a quota side-effect, not a real auth
      // wall. Defer the auto-expire so a healthy jar is not flipped.
      const helpers = await import("./media-downloader-helpers");
      if (helpers.wasApifyQuotaRecent()) {
        return {
          ok: false,
          status: "quota-exceeded",
          error: "Apify returned no items shortly after a quota response - skipping session-expire",
          sample: null,
        };
      }
      // T210: empty Apify probe dataset is a SOFT signal. The previous
      // behavior auto-expired the FB jar on this branch, but empty
      // payloads can also come from extractor-stale or upstream Apify
      // hiccups. Record an anomaly and report inconclusive instead of
      // flipping a still-valid jar.
      try {
        const { noteProbeAnomaly } = await import("./probe-anomaly-counter");
        noteProbeAnomaly("fb", "probe-empty-dataset");
      } catch { /* best-effort */ }
      return {
        ok: false,
        status: "actor-error",
        error: "Apify returned no items - probe inconclusive (jar preserved)",
        sample: null,
      };
    }
    const first = items[0] as any;
    const text = JSON.stringify(first).toLowerCase();
    if (text.includes("login_required") || text.includes("login required") || text.includes("checkpoint")) {
      await markFbSessionExpired("Apify reported login_required");
      return { ok: false, status: "auth-blocked", error: "Apify reported login_required", sample: null };
    }
    if (text.includes("rate limit") || text.includes("ratelimit")) {
      return { ok: false, status: "rate-limited", error: "Apify reported rate-limit", sample: null };
    }
    const pageName = first.title || first.pageName || first.name || FB_TEST_PAGE_URL;
    const followers = typeof first.followers === "number"
      ? first.followers
      : typeof first.followersCount === "number"
        ? first.followersCount
        : typeof first.likes === "number"
          ? first.likes
          : null;
    await clearFbExpiredFlagOnSuccess();
    return { ok: true, status: "ok", error: null, sample: { pageName, followers } };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, status: "timeout", error: "Probe timed out after 30s", sample: null };
    }
    return { ok: false, status: "actor-error", error: err?.message || String(err), sample: null };
  } finally {
    clearTimeout(timer);
  }
}
