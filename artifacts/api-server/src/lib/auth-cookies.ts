// Task #155: authenticated scraping support for the media-download
// queue. The active cookies.txt file (one per platform) is uploaded by
// an admin, persisted in object storage under an admin-only prefix, and
// materialized to a worker-local tmp file on demand. yt-dlp is then
// invoked with `--cookies <path>` so IG/FB login walls and rate-limit
// gates that were silently dropping ~85% of jobs can finally pass.
//
// Public API:
//   resolveActiveJar(platform)        -> DB row for the active jar
//   materializeCookieFile(platform)   -> on-disk path with TTL cache
//   validateNetscapeCookies(text)     -> rough format check
//   uploadCookiesContent(platform...) -> save to object storage + DB
//   markJarStatus(platform, status)   -> degrade/expire the active jar
//   listJars()                        -> metadata-only (never bytes)
//
// IMPORTANT: cookie BYTES never leave the server. Admin endpoints only
// return jar metadata. Materialized files are written to an
// 0700-mode-friendly process-private tmp directory.

import { mkdtemp, writeFile, readFile, chmod, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  db,
  authCookieJars,
  authHealth,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";
import { decryptFbBytes, encryptFbBytes } from "./facebook-cookies";

export type CookiePlatform = "ig" | "fb";
export const COOKIE_PLATFORMS: CookiePlatform[] = ["ig", "fb"];

export function isCookiePlatform(s: unknown): s is CookiePlatform {
  return s === "ig" || s === "fb";
}

const COOKIE_OBJECT_PREFIX = "auth-cookies"; // admin-only, never publicly served
const MATERIALIZE_TTL_MS = 60_000;            // refresh on-disk file at most every minute
const COOKIE_BYTES_MAX = 2 * 1024 * 1024;     // 2MB hard cap on a cookies.txt

// ── Object storage helpers ──────────────────────────────────────────────
function parseGcsPath(fullPath: string): { bucket: string; object: string } {
  const norm = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = norm.slice(1).split("/");
  return { bucket: parts[0], object: parts.slice(1).join("/") };
}

// Internal: write raw bytes (already encrypted for FB) to object storage.
async function putCookieObject(buf: Buffer, platform: CookiePlatform): Promise<string> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const id = randomUUID();
  const fullPath = `${privateDir.replace(/\/$/, "")}/${COOKIE_OBJECT_PREFIX}/${platform}/${id}.txt`;
  const { bucket, object } = parseGcsPath(fullPath);
  await objectStorageClient
    .bucket(bucket)
    .file(object)
    .save(buf, {
      contentType: "text/plain",
      metadata: { contentType: "text/plain", cacheControl: "no-store" },
      resumable: false,
    });
  return fullPath; // store the full GCS-style path; readers use parseGcsPath
}

async function getCookieObjectBytes(fullPath: string): Promise<Buffer> {
  const { bucket, object } = parseGcsPath(fullPath);
  const [buf] = await objectStorageClient.bucket(bucket).file(object).download();
  return buf;
}

async function deleteCookieObject(fullPath: string): Promise<void> {
  try {
    const { bucket, object } = parseGcsPath(fullPath);
    await objectStorageClient.bucket(bucket).file(object).delete({ ignoreNotFound: true });
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err), fullPath }, "auth-cookies: object delete failed");
  }
}

// ── Format validation ───────────────────────────────────────────────────
// Netscape format: header line "# Netscape HTTP Cookie File" (or a "#HttpOnly_"
// prefixed row) followed by tab-separated rows with 7 fields:
//   domain  flag  path  secure  expires  name  value
// We accept either the canonical header or any line that's a 7-field tab row.
export function validateNetscapeCookies(text: string): { ok: boolean; reason?: string; rows: number } {
  if (!text || typeof text !== "string") return { ok: false, reason: "empty file", rows: 0 };
  if (Buffer.byteLength(text, "utf8") > COOKIE_BYTES_MAX) {
    return { ok: false, reason: "file exceeds 2MB cap", rows: 0 };
  }
  const lines = text.split(/\r?\n/);
  let rows = 0;
  let headerSeen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.toLowerCase().includes("netscape http cookie file")) headerSeen = true;
      // #HttpOnly_<domain>... lines are still valid data rows after the prefix
      if (line.toLowerCase().startsWith("#httponly_")) {
        const stripped = raw.replace(/^#HttpOnly_/i, "");
        const fields = stripped.split("\t");
        if (fields.length >= 7) rows += 1;
      }
      continue;
    }
    const fields = raw.split("\t");
    if (fields.length >= 7) rows += 1;
  }
  if (rows === 0) return { ok: false, reason: "no tab-separated cookie rows found", rows: 0 };
  if (!headerSeen) {
    // Many real exports omit the canonical header; accept as long as we
    // saw real cookie rows but warn so the admin can re-export if desired.
    logger.info({ rows }, "auth-cookies: accepting cookies file without canonical Netscape header");
  }
  return { ok: true, rows };
}

// ── DB helpers ──────────────────────────────────────────────────────────
export interface CookieJarMetadata {
  id: number;
  platform: CookiePlatform;
  uploadedBy: string | null;
  uploadedAt: string;
  lastValidatedAt: string | null;
  status: string;
  notes: string | null;
  ageHours: number;
}

// Drizzle types `timestamp({ withTimezone: true })` as `Date` in TS, but
// the runtime value can also arrive as an ISO string when an upstream
// caller hands us a hand-rolled row. Normalize both shapes with a
// fully typed helper so we never need an `as any` escape hatch.
function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function rowToMeta(row: typeof authCookieJars.$inferSelect): CookieJarMetadata {
  const uploadedAt = toDate(row.uploadedAt) ?? new Date();
  const lastValidated = toDate(row.lastValidatedAt);
  const ageMs = Date.now() - uploadedAt.getTime();
  return {
    id: row.id,
    platform: row.platform as CookiePlatform,
    uploadedBy: row.uploadedBy ?? null,
    uploadedAt: uploadedAt.toISOString(),
    lastValidatedAt: lastValidated ? lastValidated.toISOString() : null,
    status: row.status,
    notes: row.notes ?? null,
    ageHours: Math.round(ageMs / (60 * 60 * 1000)),
  };
}

export async function resolveActiveJar(
  platform: CookiePlatform,
): Promise<typeof authCookieJars.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(authCookieJars)
    .where(
      and(
        eq(authCookieJars.platform, platform),
        isNull(authCookieJars.deletedAt),
      ),
    )
    .orderBy(desc(authCookieJars.uploadedAt))
    .limit(1);
  return row ?? null;
}

export async function listJars(): Promise<CookieJarMetadata[]> {
  const rows = await db
    .select()
    .from(authCookieJars)
    .where(isNull(authCookieJars.deletedAt))
    .orderBy(desc(authCookieJars.uploadedAt));
  return rows.map(rowToMeta);
}

export async function uploadCookiesContent(
  platform: CookiePlatform,
  text: string,
  uploadedBy: string | null,
  notes: string | null = null,
): Promise<CookieJarMetadata> {
  const v = validateNetscapeCookies(text);
  if (!v.ok) throw new Error(`Invalid cookies.txt: ${v.reason}`);
  // Task #175: encrypt FB jars at rest under FACEBOOK_COOKIES_SECRET.
  // IG admin path no longer uses this helper (IG cookies live in
  // provider_configs via instagram-session-cookies.ts); we keep the
  // platform === 'ig' branch as a no-op for any future re-introduction
  // and so legacy callers keep working.
  const buf = platform === "fb" ? encryptFbBytes(text) : Buffer.from(text, "utf8");
  const objectPath = await putCookieObject(buf, platform);

  // Soft-delete previous active jar(s) so resolveActiveJar always returns
  // exactly one. We don't hard-delete - retention is useful for audits.
  const previous = await db
    .select()
    .from(authCookieJars)
    .where(and(eq(authCookieJars.platform, platform), isNull(authCookieJars.deletedAt)));
  if (previous.length > 0) {
    await db
      .update(authCookieJars)
      .set({ deletedAt: sql`now()`, status: "expired" })
      .where(and(eq(authCookieJars.platform, platform), isNull(authCookieJars.deletedAt)));
  }

  const [row] = await db
    .insert(authCookieJars)
    .values({
      platform,
      objectPath,
      uploadedBy,
      status: "active",
      notes,
    })
    .returning();
  invalidateMaterializedCache(platform);
  logger.info(
    { platform, jarId: row.id, rows: v.rows, uploadedBy },
    "auth-cookies: new jar uploaded",
  );
  return rowToMeta(row);
}

export async function deleteJar(platform: CookiePlatform): Promise<void> {
  const active = await resolveActiveJar(platform);
  if (!active) return;
  await db
    .update(authCookieJars)
    .set({ deletedAt: sql`now()`, status: "expired" })
    .where(eq(authCookieJars.id, active.id));
  await deleteCookieObject(active.objectPath);
  invalidateMaterializedCache(platform);
  logger.info({ platform, jarId: active.id }, "auth-cookies: jar deleted");
}

export async function markJarStatus(
  platform: CookiePlatform,
  status: "active" | "degraded" | "expired",
  notes?: string | null,
): Promise<void> {
  const active = await resolveActiveJar(platform);
  if (!active) return;
  if (active.status === status) return;
  await db
    .update(authCookieJars)
    .set({
      status,
      lastValidatedAt: sql`now()`,
      ...(notes !== undefined ? { notes } : {}),
    })
    .where(eq(authCookieJars.id, active.id));
  logger.info({ platform, jarId: active.id, status }, "auth-cookies: jar status changed");
}

// ── Materialization to disk (with TTL cache + uploadedAt invalidation) ──
interface MaterializedEntry {
  jarId: number;
  uploadedAt: number;
  path: string;
  expiresAt: number;
}
const materialized = new Map<CookiePlatform, MaterializedEntry>();
let materializeDir: string | null = null;

function invalidateMaterializedCache(platform?: CookiePlatform): void {
  if (platform) materialized.delete(platform);
  else materialized.clear();
}

async function ensureMaterializeDir(): Promise<string> {
  if (materializeDir) return materializeDir;
  const dir = await mkdtemp(join(tmpdir(), "auth-cookies-"));
  try { await chmod(dir, 0o700); } catch { /* best-effort */ }
  materializeDir = dir;
  return dir;
}

/**
 * Materialize the active jar for `platform` to a worker-local file and
 * return the path. Returns `null` when no jar is configured. Called by
 * the worker on every yt-dlp invocation; cached for MATERIALIZE_TTL_MS
 * and invalidated when the DB row's uploadedAt changes.
 *
 * Worker-only: API runtime never invokes this (it is gated by being
 * referenced solely from the worker code paths in media-downloader.ts).
 */
export async function materializeCookieFile(
  platform: CookiePlatform,
): Promise<string | null> {
  const now = Date.now();
  const cached = materialized.get(platform);
  if (cached && cached.expiresAt > now) {
    try {
      await access(cached.path, fsConstants.R_OK);
      return cached.path;
    } catch {
      materialized.delete(platform);
    }
  }
  const active = await resolveActiveJar(platform);
  if (!active) {
    materialized.delete(platform);
    return null;
  }
  const uploadedAtDate = toDate(active.uploadedAt) ?? new Date();
  const uploadedAtMs = uploadedAtDate.getTime();
  if (cached && cached.jarId === active.id && cached.uploadedAt === uploadedAtMs) {
    cached.expiresAt = now + MATERIALIZE_TTL_MS;
    try {
      await access(cached.path, fsConstants.R_OK);
      return cached.path;
    } catch { /* fall through and re-fetch */ }
  }
  let buf: Buffer;
  try {
    buf = await getCookieObjectBytes(active.objectPath);
  } catch (err: any) {
    logger.warn(
      { platform, jarId: active.id, err: err?.message || String(err) },
      "auth-cookies: failed to download cookie object; proceeding without cookies",
    );
    return null;
  }
  // Task #175: FB bytes are an encrypted envelope (or legacy plaintext).
  // Decrypt to Netscape text before writing to the worker-local file.
  let outBuf = buf;
  if (platform === "fb") {
    try {
      outBuf = Buffer.from(decryptFbBytes(buf), "utf8");
    } catch (err: any) {
      logger.warn(
        { platform, jarId: active.id, err: err?.message || String(err) },
        "auth-cookies: failed to decrypt FB jar; check FACEBOOK_COOKIES_SECRET",
      );
      return null;
    }
  }
  const dir = await ensureMaterializeDir();
  const path = join(dir, `${platform}-${active.id}.txt`);
  await writeFile(path, outBuf, { mode: 0o600 });
  try { await chmod(path, 0o600); } catch { /* best-effort */ }
  materialized.set(platform, {
    jarId: active.id,
    uploadedAt: uploadedAtMs,
    path,
    expiresAt: now + MATERIALIZE_TTL_MS,
  });
  return path;
}

/**
 * Resolve the right cookie file for a target URL. Picks IG vs FB based
 * on hostname. Returns null when no jar is configured for that platform.
 */
export async function resolveCookieFileForUrl(url: string): Promise<{
  path: string;
  platform: CookiePlatform;
} | null> {
  const platform = platformFromUrl(url);
  if (!platform) return null;
  const path = await materializeCookieFile(platform);
  return path ? { path, platform } : null;
}

export function platformFromUrl(url: string | null | undefined): CookiePlatform | null {
  const u = (url || "").toLowerCase();
  if (!u) return null;
  if (u.includes("instagram.com") || u.includes("instagr.am") || u.includes("cdninstagram")) return "ig";
  if (u.includes("facebook.com") || u.includes("fb.com") || u.includes("fb.watch") || u.includes("fbcdn")) return "fb";
  return null;
}

// ── Auth health storage ─────────────────────────────────────────────────
export interface AuthHealthRecord {
  platform: CookiePlatform;
  status: "ok" | "degraded" | "expired" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastErrorClass: string | null;
  lastProbeAt: string | null;
  probeUrl: string | null;
}

function isAuthStatus(s: string): s is AuthHealthRecord["status"] {
  return s === "ok" || s === "degraded" || s === "expired" || s === "unknown";
}

function ahRowToRecord(row: typeof authHealth.$inferSelect): AuthHealthRecord {
  const iso = (d: Date | string | null): string | null => {
    const dt = toDate(d);
    return dt ? dt.toISOString() : null;
  };
  return {
    platform: row.platform as CookiePlatform,
    status: isAuthStatus(row.status) ? row.status : "unknown",
    lastSuccessAt: iso(row.lastSuccessAt),
    lastFailureAt: iso(row.lastFailureAt),
    lastError: row.lastError ?? null,
    lastErrorClass: row.lastErrorClass ?? null,
    lastProbeAt: iso(row.lastProbeAt),
    probeUrl: row.probeUrl ?? null,
  };
}

export async function getAuthHealth(): Promise<AuthHealthRecord[]> {
  const rows = await db.select().from(authHealth);
  return rows.map(ahRowToRecord);
}

export async function recordProbeOutcome(opts: {
  platform: CookiePlatform;
  ok: boolean;
  errorClass?: string | null;
  error?: string | null;
  probeUrl: string;
}): Promise<void> {
  // T210: gate the destructive jar-status flip on a HARD auth signal.
  // Soft signals (timeout, actor-error, empty payload, rate-limit,
  // extractor-stale) are recorded as `degraded` on auth_health for
  // operator visibility but MUST NOT flap a still-valid admin jar to
  // `expired`. The previous behavior treated every non-ok probe as
  // grounds to mark the jar expired/degraded which was the dominant
  // false-positive pathway for jars going `expired` while the saved
  // session was actually fine.
  const helpers = await import("./media-downloader-helpers");
  const hardAuth = !opts.ok && helpers.isHardAuthSignal(opts.errorClass);
  const status: AuthHealthRecord["status"] = opts.ok
    ? "ok"
    : hardAuth
      ? "expired"
      : "degraded";
  // Use a single client-side `now` so insert and onConflict update
  // share the same timestamp. Drizzle's $inferInsert types these as
  // Date, so we pass real Date values rather than `sql\`now()\`` to
  // avoid type-escape hatches.
  const now = new Date();
  const values: typeof authHealth.$inferInsert = {
    platform: opts.platform,
    status,
    probeUrl: opts.probeUrl,
    lastProbeAt: now,
    ...(opts.ok
      ? { lastSuccessAt: now }
      : {
          lastFailureAt: now,
          lastError: (opts.error || "").slice(0, 500),
          lastErrorClass: opts.errorClass || null,
        }),
    updatedAt: now,
  };
  await db
    .insert(authHealth)
    .values(values)
    .onConflictDoUpdate({ target: authHealth.platform, set: values });

  if (opts.ok) {
    await markJarStatus(opts.platform, "active", null);
  } else if (hardAuth) {
    // Only a confirmed-bad hard auth signal flips the jar to expired.
    await markJarStatus(opts.platform, "expired", opts.error?.slice(0, 200) ?? null);
  } else {
    // T210: soft signal. Leave the jar at its current status. Note the
    // anomaly so the dashboard can surface "probe is degraded but jar
    // is preserved" without mutating the jar row.
    try {
      const { noteProbeAnomaly } = await import("./probe-anomaly-counter");
      noteProbeAnomaly(opts.platform, opts.errorClass || "soft-signal");
    } catch { /* best-effort */ }
  }
}

// Exposed for tests / dashboard - returns the metadata the queue-health
// endpoint embeds in its `auth` block.
export async function getAuthSection(): Promise<{
  jars: CookieJarMetadata[];
  health: AuthHealthRecord[];
}> {
  const [jars, health] = await Promise.all([listJars(), getAuthHealth()]);
  return { jars, health };
}

// Task #172: parse a stored jar's bytes to compute display-only stats
// (cookie row count + max-expiry across rows). Bytes are downloaded from
// object storage server-side and never returned to the caller. Safe to
// call from the API process - unlike `materializeCookieFile`, this does
// not write the cookies to a worker-local tmp file.
export interface CookieJarStats {
  cookieCount: number;
  inferredExpiresAt: string | null;
  // Task #175: extra display-only fields surfaced for the FB admin
  // panel so it can mirror the IG panel's compact metadata grid
  // (c_user preview, required-cookie presence). Populated only for
  // the FB platform; left undefined for IG / future platforms.
  cUserPreview?: string | null;
  hasRequiredCookies?: boolean;
  missingRequired?: string[];
}
export async function getActiveJarStats(
  platform: CookiePlatform,
): Promise<CookieJarStats | null> {
  const active = await resolveActiveJar(platform);
  if (!active) return null;
  let buf: Buffer;
  try {
    buf = await getCookieObjectBytes(active.objectPath);
  } catch (err: any) {
    logger.warn(
      { platform, jarId: active.id, err: err?.message || String(err) },
      "auth-cookies: failed to read jar object for stats",
    );
    return { cookieCount: 0, inferredExpiresAt: null };
  }
  // Task #175: FB bytes are an encrypted envelope. Decrypt for stats
  // computation. If the secret is missing, fall back to empty stats so
  // the panel still renders without throwing.
  let text: string;
  if (platform === "fb") {
    // Task #175: decryptFbBytes auto-detects an encrypted envelope and
    // falls back to legacy plaintext when the bytes are not enveloped,
    // so legacy plaintext jars remain readable even when
    // FACEBOOK_COOKIES_SECRET is not configured.
    try { text = decryptFbBytes(buf); }
    catch (err: any) {
      logger.warn(
        { platform, jarId: active.id, err: err?.message || String(err) },
        "auth-cookies: failed to decrypt FB jar for stats",
      );
      return { cookieCount: 0, inferredExpiresAt: null };
    }
  } else {
    text = buf.toString("utf8");
  }
  let count = 0;
  let maxExpires = 0;
  // Task #175: collect cookie names + a c_user preview for the FB panel
  // metadata grid so it mirrors the IG panel's "sessionid" preview.
  const namesPresent = new Set<string>();
  let cUserValue: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let row = raw;
    if (line.startsWith("#")) {
      if (line.toLowerCase().startsWith("#httponly_")) {
        row = raw.replace(/^#HttpOnly_/i, "");
      } else {
        continue;
      }
    }
    const fields = row.split("\t");
    if (fields.length < 7) continue;
    count += 1;
    const exp = Number(fields[4]);
    if (Number.isFinite(exp) && exp > maxExpires) maxExpires = exp;
    const name = fields[5];
    if (name) namesPresent.add(name);
    if (name === "c_user" && !cUserValue) {
      cUserValue = fields.slice(6).join("\t");
    }
  }
  const inferredExpiresAt = maxExpires > 0
    ? new Date(maxExpires * 1000).toISOString()
    : null;
  if (platform === "fb") {
    const FB_REQUIRED = ["c_user", "xs", "datr"];
    const missingRequired = FB_REQUIRED.filter((n) => !namesPresent.has(n));
    const cUserPreview = cUserValue
      ? (cUserValue.length > 8 ? `${cUserValue.slice(0, 4)}…${cUserValue.slice(-4)}` : cUserValue)
      : null;
    return {
      cookieCount: count,
      inferredExpiresAt,
      cUserPreview,
      hasRequiredCookies: missingRequired.length === 0,
      missingRequired,
    };
  }
  return { cookieCount: count, inferredExpiresAt };
}

// Task #187 (review fix): cheap identity probe for the active jar so
// callers (e.g. the FB share-cookie cache in media-downloader) can
// invalidate by jarId/uploadedAt on every call without re-decrypting
// the cookie bytes. Returns null when no jar is configured.
export async function getActiveJarIdentity(
  platform: CookiePlatform,
): Promise<{ jarId: number; uploadedAtMs: number } | null> {
  const active = await resolveActiveJar(platform);
  if (!active) return null;
  const uploadedAtMs = (toDate(active.uploadedAt) ?? new Date()).getTime();
  return { jarId: active.id, uploadedAtMs };
}

// Read directly so the readFile import isn't a dead reference.
export async function readMaterializedFileForTest(
  platform: CookiePlatform,
): Promise<Buffer | null> {
  const p = await materializeCookieFile(platform);
  if (!p) return null;
  return readFile(p);
}

// Task #178: server-side decrypted-text accessor for the active jar.
// Used by `facebook-cookies.loadFbCookiesForApify` so the API process
// can read the FB jar without going through the worker-only
// `materializeCookieFile` tmp-file path. Returns the parsed Netscape
// text plus the active jar id + uploadedAt so callers can cache by
// identity. Returns null when no jar is configured.
export async function readActiveJarPlaintext(
  platform: CookiePlatform,
): Promise<{ jarId: number; uploadedAtMs: number; text: string } | null> {
  const active = await resolveActiveJar(platform);
  if (!active) return null;
  let buf: Buffer;
  try {
    buf = await getCookieObjectBytes(active.objectPath);
  } catch (err: any) {
    logger.warn(
      { platform, jarId: active.id, err: err?.message || String(err) },
      "auth-cookies: failed to read jar object for plaintext accessor",
    );
    return null;
  }
  let text: string;
  if (platform === "fb") {
    try { text = decryptFbBytes(buf); }
    catch (err: any) {
      logger.warn(
        { platform, jarId: active.id, err: err?.message || String(err) },
        "auth-cookies: failed to decrypt FB jar; check FACEBOOK_COOKIES_SECRET",
      );
      return null;
    }
  } else {
    text = buf.toString("utf8");
  }
  const uploadedAtMs = (toDate(active.uploadedAt) ?? new Date()).getTime();
  return { jarId: active.id, uploadedAtMs, text };
}

