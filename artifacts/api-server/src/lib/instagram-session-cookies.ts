// Task #169: admin-managed Instagram session cookies for Apify scraping.
//
// An admin pastes a JSON cookie blob exported from Cookie-Editor or
// EditThisCookie. We validate it (sessionid / ds_user_id / csrftoken
// must be present), normalize it to the {name,value,domain,path,...}
// shape Apify's IG actors accept on `loginCookies` / `sessionCookies`,
// encrypt it at rest using AES-256-GCM keyed off INSTAGRAM_COOKIES_SECRET,
// and persist it in the existing `provider_configs` table under
// (provider_slug='instagram', key='session_cookies').
//
// Public API:
//   getMetadata()           - GET endpoint payload (never returns plaintext)
//   saveCookies(text, who)  - PUT endpoint impl
//   clearCookies()          - DELETE endpoint impl
//   loadCookiesForApify()   - per-run cached loader for Apify call sites
//   markSessionExpired(why) - flip the saved row to 'expired'
//   testWithApify()         - admin "Test session" probe

import crypto from "crypto";
import { mkdtemp, writeFile, chmod, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { db, providerConfigsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

export const PROVIDER_SLUG = "instagram";
export const CONFIG_KEY = "session_cookies";

const REQUIRED_COOKIES = ["sessionid", "ds_user_id", "csrftoken"] as const;

export interface ApifyCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expires?: number;
}

interface EncryptedBlob {
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

interface StoredValue {
  encrypted: EncryptedBlob;
  savedAt: string;
  savedBy: string | null;
  cookieCount: number;
  inferredExpiresAt: string | null;
  status: "active" | "expired";
  lastError: string | null;
  cookieNames: string[];
  sessionidPreview: string | null;
  // Task #194 (resilient expiry): bounded auth-signal history backing
  // the threshold-based session expiry. Both fields are optional so old
  // rows persisted before #194 keep deserializing cleanly.
  authSignalHistory?: IgAuthSignalEntry[];
  lastAuthSuccessAt?: string | null;
}

// ── Task #194: resilient IG session expiry ─────────────────────────────
//
// Pre-#194 behavior was to flip the saved IG jar to `expired` on the
// first auth-shaped signal we saw (HTTP 401, login_required body, empty
// dataset, etc). In practice IG returns those same shapes during
// transient anti-bot challenges and rate-limit spikes, so a healthy
// session would get prematurely invalidated and stay cookieless until
// an admin re-pasted it. #194 introduces:
//
//   - signal classification (true-invalidation, login-required-body,
//     empty-payload, anti-bot, rate-limit)
//   - bounded rolling-window history per session
//   - weighted confidence score per signal kind
//   - dual gates: hard-invalidation count OR confidence threshold
//   - rate-limit signals carry zero weight (never expire)
//   - successful Apify dataset clears the history and stamps
//     lastAuthSuccessAt
//
// Public API additions: `recordAuthSignal({kind, reason})` and
// `recordAuthSuccess()`. The legacy `markSessionExpired` is kept for
// admin Test-Session probes and #187 backward compat.

export type IgAuthSignalKind =
  | "true-invalidation"
  | "login-required-body"
  | "empty-payload"
  | "anti-bot"
  | "rate-limit";

export interface IgAuthSignalEntry {
  kind: IgAuthSignalKind;
  at: string;
  reason: string;
}

export const IG_AUTH_SIGNAL_WEIGHTS: Record<IgAuthSignalKind, number> = {
  "true-invalidation": 1.0,
  "login-required-body": 0.5,
  "empty-payload": 0.3,
  "anti-bot": 0.2,
  "rate-limit": 0.0,
};

export const IG_AUTH_SIGNAL_WINDOW_MS = 10 * 60 * 1000;
export const IG_AUTH_CONFIDENCE_THRESHOLD = 2.0;
export const IG_AUTH_HARD_INVALIDATION_THRESHOLD = 2;
export const IG_AUTH_SIGNAL_HISTORY_MAX = 20;

// Pure: classify an Apify HTTP failure or extractor body into one of
// the IgAuthSignalKind buckets. Returns null when the response carries
// no auth-shaped signal (e.g. 5xx, network error).
export function classifyIgAuthSignal(
  httpStatus: number | null,
  body: string | null,
): IgAuthSignalKind | null {
  const lower = (body || "").toLowerCase();
  // Rate-limit MUST be tested first so a 429 carrying "login required"
  // boilerplate doesn't get mis-classified as a true invalidation.
  if (
    httpStatus === 429
    || lower.includes("rate limit")
    || lower.includes("ratelimit")
    || lower.includes("too many requests")
  ) {
    return "rate-limit";
  }
  if (
    httpStatus === 401
    || lower.includes("session_expired")
    || lower.includes("session expired")
    || lower.includes("checkpoint_required")
    || lower.includes("checkpoint")
  ) {
    return "true-invalidation";
  }
  if (
    lower.includes("login_required")
    || lower.includes("login required")
    || lower.includes("only available for registered")
  ) {
    return "login-required-body";
  }
  if (
    httpStatus === 403
    && (lower.includes("captcha") || lower.includes("challenge") || lower.includes("blocked"))
  ) {
    return "anti-bot";
  }
  return null;
}

export interface IgAuthSignalEvaluation {
  inWindow: IgAuthSignalEntry[];
  confidence: number;
  hardCount: number;
  shouldExpire: boolean;
  reason: string | null;
}

// Pure: given a signal history, decide whether the session should be
// flipped to `expired` *now*. Splits the decision into a weighted
// confidence score AND an independent hard-invalidation counter so a
// genuine 401/checkpoint streak still expires quickly even if the
// score path hasn't crossed yet.
export function evaluateIgAuthSignals(
  history: readonly IgAuthSignalEntry[] | null | undefined,
  now: number = Date.now(),
  windowMs: number = IG_AUTH_SIGNAL_WINDOW_MS,
): IgAuthSignalEvaluation {
  const list = Array.isArray(history) ? history : [];
  const cutoff = now - windowMs;
  const inWindow: IgAuthSignalEntry[] = [];
  for (const e of list) {
    const t = Date.parse(e?.at ?? "");
    if (Number.isFinite(t) && t >= cutoff) inWindow.push(e);
  }
  let confidence = 0;
  let hardCount = 0;
  for (const e of inWindow) {
    confidence += IG_AUTH_SIGNAL_WEIGHTS[e.kind] ?? 0;
    if (e.kind === "true-invalidation") hardCount += 1;
  }
  const shouldExpire =
    hardCount >= IG_AUTH_HARD_INVALIDATION_THRESHOLD
    || confidence >= IG_AUTH_CONFIDENCE_THRESHOLD;
  const reason = shouldExpire
    ? `confidence=${confidence.toFixed(2)} hard=${hardCount} (${inWindow.length} signals in ${Math.round(
        windowMs / 60000,
      )}m window)`
    : null;
  return { inWindow, confidence, hardCount, shouldExpire, reason };
}

export interface SessionCookieMetadata {
  present: boolean;
  status: "missing" | "active" | "expired";
  savedAt: string | null;
  savedBy: string | null;
  cookieCount: number;
  cookieNames: string[];
  sessionidPreview: string | null;
  inferredExpiresAt: string | null;
  hasRequiredCookies: boolean;
  missingRequired: string[];
  lastError: string | null;
  configured: boolean;
}

// ── Encryption ─────────────────────────────────────────────────────────
function getKey(): Buffer {
  const raw = process.env.INSTAGRAM_COOKIES_SECRET;
  if (!raw) {
    throw new Error(
      "INSTAGRAM_COOKIES_SECRET env var is not set. Set it before saving Instagram session cookies.",
    );
  }
  // Accept any-length secret; derive a stable 32-byte key via sha256.
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isConfigured(): boolean {
  return !!process.env.INSTAGRAM_COOKIES_SECRET;
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

// ── Parsing & validation ───────────────────────────────────────────────

// Accepts:
//  - JSON array of cookie objects (Cookie-Editor / EditThisCookie format)
//  - JSON object wrapping `cookies: [...]`
// Normalizes various shapes:
//  - Cookie-Editor: { name, value, domain, path, secure, httpOnly, sameSite, expirationDate }
//  - EditThisCookie: same shape, sometimes `hostOnly` / `session` flags
//  - Apify's own shape: same shape, `expires` instead of `expirationDate`
export function parseAndNormalize(raw: string): {
  cookies: ApifyCookie[];
  missingRequired: string[];
  sessionidValue: string | null;
} {
  if (!raw || typeof raw !== "string") throw new Error("Cookie blob is empty.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Cookie blob is not valid JSON: ${err?.message || err}`);
  }
  let arr: unknown;
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).cookies)) {
    arr = (parsed as any).cookies;
  } else {
    throw new Error("Cookie blob must be a JSON array or { cookies: [...] }.");
  }
  const list = arr as unknown[];
  if (list.length === 0) throw new Error("Cookie blob contains no cookies.");

  const cookies: ApifyCookie[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    const value = typeof c.value === "string" ? c.value : "";
    if (!name || !value) continue;
    const rawDomain = typeof c.domain === "string" ? c.domain : "";
    const domain = rawDomain || ".instagram.com";
    const path = typeof c.path === "string" && c.path ? c.path : "/";
    const expiresField = c.expires ?? c.expirationDate ?? c.expiry;
    const expires = typeof expiresField === "number" && Number.isFinite(expiresField)
      ? Math.floor(expiresField)
      : undefined;
    cookies.push({
      name,
      value,
      domain,
      path,
      secure: typeof c.secure === "boolean" ? c.secure : undefined,
      httpOnly: typeof c.httpOnly === "boolean" ? c.httpOnly : undefined,
      sameSite: typeof c.sameSite === "string" ? c.sameSite : undefined,
      ...(expires !== undefined ? { expires } : {}),
    });
  }
  if (cookies.length === 0) throw new Error("No usable cookies after normalization.");

  const missingRequired = REQUIRED_COOKIES.filter(
    (n) => !cookies.some((c) => c.name === n),
  );
  const sessionid = cookies.find((c) => c.name === "sessionid")?.value ?? null;
  return { cookies, missingRequired, sessionidValue: sessionid };
}

// Instagram sessionid format: "<userId>%3A<...>%3A<...>" (URL-encoded).
// There's no embedded issue timestamp we can reliably parse, so the
// inferred expiry is best-effort: assume ~365 days from save (IG's
// session cookie lifetime in practice). Returned as ISO string.
function inferExpiry(): string {
  const ms = Date.now() + 365 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function maskValue(v: string | null): string | null {
  if (!v) return null;
  if (v.length <= 8) return "***";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

// ── DB helpers ─────────────────────────────────────────────────────────
async function readRow(): Promise<StoredValue | null> {
  const [row] = await db
    .select({ value: providerConfigsTable.value })
    .from(providerConfigsTable)
    .where(
      and(
        eq(providerConfigsTable.providerSlug, PROVIDER_SLUG),
        eq(providerConfigsTable.key, CONFIG_KEY),
      ),
    )
    .limit(1);
  if (!row || !row.value) return null;
  return row.value as StoredValue;
}

async function writeRow(stored: StoredValue): Promise<void> {
  // Upsert by (provider_slug, key) - the table has a unique index on this pair.
  const existing = await db
    .select({ id: providerConfigsTable.id })
    .from(providerConfigsTable)
    .where(
      and(
        eq(providerConfigsTable.providerSlug, PROVIDER_SLUG),
        eq(providerConfigsTable.key, CONFIG_KEY),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(providerConfigsTable)
      .set({ value: stored as unknown })
      .where(eq(providerConfigsTable.id, existing[0].id));
  } else {
    await db.insert(providerConfigsTable).values({
      providerSlug: PROVIDER_SLUG,
      key: CONFIG_KEY,
      value: stored as unknown,
    });
  }
  invalidateCache();
}

// ── Public API ─────────────────────────────────────────────────────────

function toMetadata(stored: StoredValue | null): SessionCookieMetadata {
  const configured = isConfigured();
  if (!stored) {
    return {
      present: false,
      status: "missing",
      savedAt: null,
      savedBy: null,
      cookieCount: 0,
      cookieNames: [],
      sessionidPreview: null,
      inferredExpiresAt: null,
      hasRequiredCookies: false,
      missingRequired: [...REQUIRED_COOKIES],
      lastError: null,
      configured,
    };
  }
  const missing = REQUIRED_COOKIES.filter((n) => !stored.cookieNames.includes(n));
  return {
    present: true,
    status: stored.status,
    savedAt: stored.savedAt,
    savedBy: stored.savedBy,
    cookieCount: stored.cookieCount,
    cookieNames: stored.cookieNames,
    sessionidPreview: stored.sessionidPreview,
    inferredExpiresAt: stored.inferredExpiresAt,
    hasRequiredCookies: missing.length === 0,
    missingRequired: missing,
    lastError: stored.lastError,
    configured,
  };
}

export async function getMetadata(): Promise<SessionCookieMetadata> {
  const stored = await readRow();
  return toMetadata(stored);
}

export async function saveCookies(
  rawJson: string,
  savedBy: string | null,
): Promise<SessionCookieMetadata> {
  if (!isConfigured()) {
    throw new Error(
      "INSTAGRAM_COOKIES_SECRET is not set. Configure it before saving session cookies.",
    );
  }
  const { cookies, missingRequired, sessionidValue } = parseAndNormalize(rawJson);
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required cookies: ${missingRequired.join(", ")}. Re-export from your browser while logged into Instagram.`,
    );
  }
  const plaintext = JSON.stringify(cookies);
  const encrypted = encrypt(plaintext);
  const stored: StoredValue = {
    encrypted,
    savedAt: new Date().toISOString(),
    savedBy,
    cookieCount: cookies.length,
    inferredExpiresAt: inferExpiry(),
    status: "active",
    lastError: null,
    cookieNames: cookies.map((c) => c.name),
    sessionidPreview: maskValue(sessionidValue),
  };
  await writeRow(stored);
  logger.info(
    { savedBy, cookieCount: cookies.length },
    "instagram-session-cookies: new session saved",
  );
  return toMetadata(stored);
}

export async function clearCookies(): Promise<void> {
  await db
    .delete(providerConfigsTable)
    .where(
      and(
        eq(providerConfigsTable.providerSlug, PROVIDER_SLUG),
        eq(providerConfigsTable.key, CONFIG_KEY),
      ),
    );
  invalidateCache();
  logger.info("instagram-session-cookies: session cleared");
}

export async function markSessionExpired(reason: string | null): Promise<void> {
  const stored = await readRow();
  if (!stored || stored.status === "expired") return;
  const next: StoredValue = {
    ...stored,
    status: "expired",
    lastError: (reason || "auth-blocked").slice(0, 300),
  };
  await writeRow(next);
  logger.warn({ reason }, "instagram-session-cookies: session marked expired");
}

// Task #194: append a classified auth signal to the session's rolling
// history and only flip the jar to `expired` when the dual-gate
// threshold (hard-invalidation count OR weighted confidence) trips.
// Single transient signals (one 401, one empty dataset, etc) leave the
// session active. Rate-limit signals are recorded for observability but
// carry zero weight, so a 429 spike never expires a healthy session.
//
// Logs structured `ig-auth-signal-recorded` (info) on every call and
// `ig-session-expired-by-threshold` (warn) only on the call that
// actually crosses the threshold. No session bytes are ever logged.
export async function recordAuthSignal(input: {
  kind: IgAuthSignalKind;
  reason: string | null;
}): Promise<{ recorded: boolean; expired: boolean; confidence: number; hardCount: number }> {
  const { kind } = input;
  const reason = (input.reason || "").slice(0, 200);
  const stored = await readRow();
  if (!stored) return { recorded: false, expired: false, confidence: 0, hardCount: 0 };
  if (stored.status === "expired") {
    return { recorded: false, expired: true, confidence: 0, hardCount: 0 };
  }
  const now = Date.now();
  const prev = Array.isArray(stored.authSignalHistory) ? stored.authSignalHistory : [];
  const entry: IgAuthSignalEntry = { kind, at: new Date(now).toISOString(), reason };
  // Keep only the most recent IG_AUTH_SIGNAL_HISTORY_MAX entries so the
  // JSON column never grows unbounded across long-running incidents.
  const next = [...prev, entry].slice(-IG_AUTH_SIGNAL_HISTORY_MAX);
  const evalResult = evaluateIgAuthSignals(next, now);
  if (evalResult.shouldExpire) {
    const summary = `${kind}: ${evalResult.reason}`;
    const expiredRow: StoredValue = {
      ...stored,
      status: "expired",
      lastError: summary.slice(0, 300),
      authSignalHistory: next,
    };
    await writeRow(expiredRow);
    logger.warn(
      {
        event: "ig-session-expired-by-threshold",
        triggerKind: kind,
        confidence: Number(evalResult.confidence.toFixed(2)),
        hardCount: evalResult.hardCount,
        windowSize: evalResult.inWindow.length,
      },
      "instagram-session-cookies: threshold crossed - session marked expired",
    );
    return { recorded: true, expired: true, confidence: evalResult.confidence, hardCount: evalResult.hardCount };
  }
  await writeRow({ ...stored, authSignalHistory: next });
  logger.info(
    {
      event: "ig-auth-signal-recorded",
      kind,
      confidence: Number(evalResult.confidence.toFixed(2)),
      hardCount: evalResult.hardCount,
      windowSize: evalResult.inWindow.length,
      threshold: IG_AUTH_CONFIDENCE_THRESHOLD,
      hardThreshold: IG_AUTH_HARD_INVALIDATION_THRESHOLD,
    },
    "instagram-session-cookies: auth signal recorded below expiry threshold",
  );
  return { recorded: true, expired: false, confidence: evalResult.confidence, hardCount: evalResult.hardCount };
}

// Task #194: a successful Apify dataset (or healthy yt-dlp extraction)
// indicates the session is healthy right now. Clear the rolling
// history so the next isolated 401/empty-payload doesn't immediately
// trip the threshold from accumulated stale signals.
export async function recordAuthSuccess(): Promise<void> {
  const stored = await readRow();
  if (!stored) return;
  const hadHistory = Array.isArray(stored.authSignalHistory) && stored.authSignalHistory.length > 0;
  if (!hadHistory && stored.lastAuthSuccessAt) return;
  await writeRow({
    ...stored,
    authSignalHistory: [],
    lastAuthSuccessAt: new Date().toISOString(),
  });
  if (hadHistory) {
    logger.info(
      { event: "ig-auth-signals-cleared" },
      "instagram-session-cookies: healthy result cleared auth-signal history",
    );
  }
}

// ── Per-run loader with one log line per run ───────────────────────────
//
// Apify call sites invoke loadCookiesForApify() once per run. The cookies
// are decrypted lazily and cached for COOKIE_CACHE_TTL_MS so a sweep of
// many rows doesn't hammer the DB or repeatedly decrypt. The cache is
// invalidated by save/clear/markExpired.

interface CacheEntry {
  cookies: ApifyCookie[] | null;
  status: "active" | "expired" | "missing";
  expiresAt: number;
}
const COOKIE_CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;
function invalidateCache(): void {
  cache = null;
  // Task #187: keep the on-disk Netscape file cache in lock-step with
  // the in-memory ApifyCookie cache so save / clear / markExpired all
  // force the next yt-dlp call to materialize a fresh file.
  invalidateMaterializedCache();
}

// ── Worker-only Netscape cookies file materialization (Task #187) ─────
//
// yt-dlp's `--cookies <path>` flag wants a Netscape `cookies.txt`. The
// IG admin panel stores the session as an encrypted Apify-shaped JSON
// blob under provider_configs, so we synthesize a Netscape file on
// demand and cache it under a 0700 process-private tmp dir. Identity
// keyed off the row's `savedAt` so any save / clear / markExpired
// invalidates the cached file instantly.
//
// Worker-only: media-downloader.resolveCookiesForUrl() only invokes
// this when cookieResolverMode === "db-and-env" (set by initMediaWorker).
// The API process keeps the resolver in env-only mode, so the disk file
// is never written by the API.

interface MaterializedIgEntry {
  savedAt: string;
  path: string;
  expiresAt: number;
}
const MATERIALIZE_TTL_MS = 60_000;
let materialized: MaterializedIgEntry | null = null;
let materializeDir: string | null = null;

function invalidateMaterializedCache(): void {
  materialized = null;
}

async function ensureMaterializeDir(): Promise<string> {
  if (materializeDir) return materializeDir;
  const dir = await mkdtemp(join(tmpdir(), "ig-cookies-"));
  try { await chmod(dir, 0o700); } catch { /* best-effort */ }
  materializeDir = dir;
  return dir;
}

function escapeNetscapeField(s: string): string {
  // Netscape cookies.txt is tab-separated; strip any embedded tabs/CRLF
  // so a malformed cookie value can't break the parser yt-dlp uses.
  return (s || "").replace(/[\t\r\n]/g, "");
}

function buildNetscapeFromApifyCookies(cookies: ApifyCookie[]): string {
  const lines: string[] = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    if (!c.name || !c.value) continue;
    const domain = escapeNetscapeField(c.domain || ".instagram.com");
    const flag = domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = escapeNetscapeField(c.path || "/");
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires = Number.isFinite(c.expires) && (c.expires as number) > 0
      ? String(Math.floor(c.expires as number))
      : "0";
    const name = escapeNetscapeField(c.name);
    const value = escapeNetscapeField(c.value);
    const prefix = c.httpOnly ? "#HttpOnly_" : "";
    lines.push(`${prefix}${domain}\t${flag}\t${path}\t${secure}\t${expires}\t${name}\t${value}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Materialize the active IG session jar to a worker-local Netscape
 * `cookies.txt` and return the path. Returns `null` when no jar is
 * configured or the jar is marked expired. Cached for 60s; identity
 * key is the row's `savedAt` so any save / clear / markExpired forces
 * the next call to write a fresh file.
 *
 * Worker-only - the API process never invokes this because the cookie
 * resolver mode there stays at "env-only".
 */
export async function materializeInstagramCookieFile(): Promise<string | null> {
  const now = Date.now();
  if (materialized && materialized.expiresAt > now) {
    try {
      await access(materialized.path, fsConstants.R_OK);
      return materialized.path;
    } catch {
      materialized = null;
    }
  }
  const stored = await readRow();
  // Task #187 (runtime continuity): structured lifecycle log at every
  // terminal branch so an operator can grep `ig-materialize` to see why
  // a yt-dlp invocation came up cookieless. We never log the cookie file
  // PATH or BYTES (security review fix) - only counts and outcome enum.
  if (!stored) {
    logger.info(
      { event: "ig-materialize", outcome: "no-jar-configured" },
      "instagram-session-cookies: no jar in DB; IG yt-dlp will be cookieless",
    );
    materialized = null;
    return null;
  }
  if (stored.status === "expired") {
    logger.info(
      { event: "ig-materialize", outcome: "jar-expired", savedAt: stored.savedAt },
      "instagram-session-cookies: jar marked expired; refusing to materialize",
    );
    materialized = null;
    return null;
  }
  if (materialized && materialized.savedAt === stored.savedAt) {
    materialized.expiresAt = now + MATERIALIZE_TTL_MS;
    try {
      await access(materialized.path, fsConstants.R_OK);
      logger.info(
        { event: "ig-materialize", outcome: "cache-hit", savedAt: stored.savedAt },
        "instagram-session-cookies: served from in-memory cache",
      );
      return materialized.path;
    } catch { /* re-write below */ }
  }
  let cookies: ApifyCookie[];
  try {
    const plain = decrypt(stored.encrypted);
    cookies = JSON.parse(plain) as ApifyCookie[];
  } catch (err: any) {
    logger.error(
      { event: "ig-materialize", outcome: "decrypt-failed", err: err?.message || String(err) },
      "instagram-session-cookies: failed to decrypt for materialization; check INSTAGRAM_COOKIES_SECRET",
    );
    return null;
  }
  if (!Array.isArray(cookies) || cookies.length === 0) {
    logger.warn(
      { event: "ig-materialize", outcome: "empty-cookie-array", savedAt: stored.savedAt },
      "instagram-session-cookies: decrypted blob contained no cookies",
    );
    return null;
  }
  const text = buildNetscapeFromApifyCookies(cookies);
  const dir = await ensureMaterializeDir();
  // Stable filename per savedAt so concurrent calls don't race.
  const safeId = stored.savedAt.replace(/[^0-9A-Za-z]+/g, "");
  const path = join(dir, `ig-${safeId}.txt`);
  await writeFile(path, text, { mode: 0o600 });
  try { await chmod(path, 0o600); } catch { /* best-effort */ }
  let fileReadable = false;
  try {
    await access(path, fsConstants.R_OK);
    fileReadable = true;
  } catch { /* unreachable - we just wrote it */ }
  logger.info(
    {
      event: "ig-materialize",
      outcome: "wrote-fresh",
      savedAt: stored.savedAt,
      cookieCount: cookies.length,
      fileReadable,
    },
    "instagram-session-cookies: materialized fresh Netscape file for yt-dlp",
  );
  materialized = {
    savedAt: stored.savedAt,
    path,
    expiresAt: now + MATERIALIZE_TTL_MS,
  };
  return path;
}

let warnedThisInterval = false;
let warnedClearedAt = 0;

export async function loadCookiesForApify(): Promise<ApifyCookie[] | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.status === "active" ? cache.cookies : null;
  }
  const stored = await readRow();
  if (!stored) {
    cache = { cookies: null, status: "missing", expiresAt: now + COOKIE_CACHE_TTL_MS };
    maybeLogMissing("missing");
    return null;
  }
  if (stored.status === "expired") {
    cache = { cookies: null, status: "expired", expiresAt: now + COOKIE_CACHE_TTL_MS };
    maybeLogMissing("expired");
    return null;
  }
  let cookies: ApifyCookie[];
  try {
    const plain = decrypt(stored.encrypted);
    cookies = JSON.parse(plain) as ApifyCookie[];
  } catch (err: any) {
    logger.error(
      { err: err?.message || String(err) },
      "instagram-session-cookies: failed to decrypt saved cookies; check INSTAGRAM_COOKIES_SECRET",
    );
    cache = { cookies: null, status: "missing", expiresAt: now + COOKIE_CACHE_TTL_MS };
    return null;
  }
  cache = { cookies, status: "active", expiresAt: now + COOKIE_CACHE_TTL_MS };
  warnedThisInterval = false;
  return cookies;
}

function maybeLogMissing(state: "missing" | "expired"): void {
  // One structured warning per cache-window, not per item.
  const now = Date.now();
  if (warnedThisInterval && now - warnedClearedAt < COOKIE_CACHE_TTL_MS) return;
  warnedThisInterval = true;
  warnedClearedAt = now;
  logger.warn(
    { state },
    state === "expired"
      ? "instagram-session-cookies: saved session is marked expired - paste fresh cookies"
      : "instagram-session-cookies: no saved session cookies; running Apify Instagram actor anonymously",
  );
}

// ── Apify input injection helper ───────────────────────────────────────
//
// Called by Apify call sites that target an IG actor. Adds loginCookies
// (used by apify~instagram-scraper, apify~instagram-post-scraper,
// apify~instagram-profile-scraper) and sessionCookies (used by some
// alternate actors). If no cookies are saved, returns the input
// unchanged. Never throws - bad config must not break existing flows.

const INSTAGRAM_ACTOR_PATTERNS: RegExp[] = [
  /(^|[/~])instagram[-_]?(scraper|post[-_]?scraper|profile[-_]?scraper|reel[-_]?downloader)/i,
];

export function isInstagramActor(actorPathOrId: string): boolean {
  if (!actorPathOrId) return false;
  return INSTAGRAM_ACTOR_PATTERNS.some((re) => re.test(actorPathOrId));
}

export async function withInstagramSessionCookies<T extends Record<string, unknown>>(
  actorPathOrId: string,
  input: T,
): Promise<T> {
  if (!isInstagramActor(actorPathOrId)) return input;
  let cookies: ApifyCookie[] | null = null;
  try {
    cookies = await loadCookiesForApify();
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), actor: actorPathOrId },
      "instagram-session-cookies: failed to load cookies; proceeding anonymously",
    );
    return input;
  }
  if (!cookies || cookies.length === 0) return input;
  // Don't clobber any caller-provided cookies field.
  const next = { ...input } as Record<string, unknown>;
  if (next.loginCookies === undefined) next.loginCookies = cookies;
  if (next.sessionCookies === undefined) next.sessionCookies = cookies;
  return next as T;
}

// ── Apify probe ────────────────────────────────────────────────────────
//
// Tiny synchronous Apify run against a known-public profile to confirm
// the saved session is actually accepted by the actor. Returns within
// ~30s thanks to the run-sync timeout. Reports back one of:
//   - { ok: true, sample }
//   - { ok: false, status: "auth-blocked" | "rate-limited" | "no-cookies" |
//                          "no-token" | "actor-error" | "timeout" |
//                          "no-data", error }

export interface TestResult {
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
  sample: { username: string; postCount: number } | null;
}

const TEST_PROFILE = "natgeo"; // stable, public, large account

// Load cookies regardless of `status` flag. Used by the admin Test probe so
// that an admin can re-validate a session that was previously auto-marked
// expired (e.g. by a transient empty-dataset failure) without first having
// to re-paste it.
async function loadCookiesIgnoringStatus(): Promise<ApifyCookie[] | null> {
  const stored = await readRow();
  if (!stored) return null;
  try {
    const plain = decrypt(stored.encrypted);
    return JSON.parse(plain) as ApifyCookie[];
  } catch (err: any) {
    logger.error(
      { err: err?.message || String(err) },
      "instagram-session-cookies: failed to decrypt saved cookies; check INSTAGRAM_COOKIES_SECRET",
    );
    return null;
  }
}

async function clearExpiredFlagOnSuccess(): Promise<void> {
  const stored = await readRow();
  if (!stored || stored.status === "active") return;
  await writeRow({ ...stored, status: "active", lastError: null });
}

export async function testWithApify(): Promise<TestResult> {
  const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  if (!token) {
    return { ok: false, status: "no-token", error: "APIFY_TOKEN env var not set", sample: null };
  }
  const cookies = await loadCookiesIgnoringStatus();
  if (!cookies || cookies.length === 0) {
    return { ok: false, status: "no-cookies", error: "No saved session cookies", sample: null };
  }
  const actor = "apify~instagram-profile-scraper";
  const input: Record<string, unknown> = {
    usernames: [TEST_PROFILE],
    resultsLimit: 1,
    loginCookies: cookies,
    sessionCookies: cookies,
  };
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
      // Task #181: never let an Apify account quota outage flip the
      // saved IG session to expired - mirror the FB probe behavior
      // and use the shared classifier so both probes agree.
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
      return { ok: false, status: "actor-error", error: `HTTP ${resp.status}: ${body}`, sample: null };
    }
    const data = await resp.json().catch(() => null);
    const items = Array.isArray(data) ? data : [];
    if (items.length === 0) {
      // Task #181: defer the auto-expire when a recent Apify quota
      // signal was observed - the empty dataset is most likely a
      // quota side-effect, not a real auth wall. Real auth failures
      // still flip the jar via the login_required branch below.
      const helpers = await import("./media-downloader-helpers");
      if (helpers.wasApifyQuotaRecent()) {
        return {
          ok: false,
          status: "quota-exceeded",
          error: "Apify returned no items shortly after a quota response - skipping session-expire",
          sample: null,
        };
      }
      // Empty dataset usually means the actor failed silently or the
      // session was rejected at the IG edge. Treat as auth-blocked so
      // the admin sees a useful signal.
      await markSessionExpired("Apify probe returned no items");
      return { ok: false, status: "auth-blocked", error: "Apify returned no items - session likely expired", sample: null };
    }
    const first = items[0] as any;
    const text = JSON.stringify(first).toLowerCase();
    if (text.includes("login_required") || text.includes("login required")) {
      await markSessionExpired("Apify reported login_required");
      return { ok: false, status: "auth-blocked", error: "Apify reported login_required", sample: null };
    }
    if (text.includes("rate limit") || text.includes("ratelimit")) {
      return { ok: false, status: "rate-limited", error: "Apify reported rate-limit", sample: null };
    }
    const username = first.username || first.ownerUsername || TEST_PROFILE;
    const postCount = Array.isArray(first.latestPosts)
      ? first.latestPosts.length
      : typeof first.postsCount === "number"
        ? first.postsCount
        : 0;
    await clearExpiredFlagOnSuccess();
    return { ok: true, status: "ok", error: null, sample: { username, postCount } };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, status: "timeout", error: "Probe timed out after 30s", sample: null };
    }
    return { ok: false, status: "actor-error", error: err?.message || String(err), sample: null };
  } finally {
    clearTimeout(timer);
  }
}
