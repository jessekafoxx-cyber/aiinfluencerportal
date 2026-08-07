import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  externalApiKeysTable,
  externalApiSettingsTable,
  type ExternalApiKey,
} from "@workspace/db";
import { logger } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      externalApiKey?: ExternalApiKey;
    }
  }
}

export function hashExternalApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

// In-process token-bucket: per-key rolling-window limiter. Good enough for
// a single-instance deployment; if we ever shard the API horizontally we
// will need to move this into Postgres or Redis. The limiter ignores
// anonymous (auth-failed) traffic - that path returns 401 immediately and
// never reaches the bucket.
//
// Window + cap are env-tunable so Viktor can bulk-upload influencer
// assets (angles batch, settings, setting images) without tripping the
// limiter. Defaults: 600 requests / 60s = 10 rps sustained, well above
// the previous 1 rps cap that was blocking real workloads.
const RATE_LIMIT_WINDOW_MS = (() => {
  const v = Number(process.env.EXTERNAL_API_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();
const RATE_LIMIT_MAX = (() => {
  const v = Number(process.env.EXTERNAL_API_RATE_LIMIT_MAX);
  return Number.isFinite(v) && v > 0 ? v : 600;
})();
const buckets = new Map<number, { windowStart: number; count: number }>();

function checkRate(keyId: number): { ok: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const bucket = buckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(keyId, { windowStart: now, count: 1 });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1, resetMs: RATE_LIMIT_WINDOW_MS };
  }
  bucket.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  const resetMs = RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart);
  return { ok: bucket.count <= RATE_LIMIT_MAX, remaining, resetMs };
}

// Lazy-upserts the singleton settings row (id=1). Returns the current
// kill-switch state.
export async function loadExternalApiSettings() {
  const rows = await db
    .select()
    .from(externalApiSettingsTable)
    .where(eq(externalApiSettingsTable.id, 1))
    .limit(1);
  if (rows.length > 0) return rows[0]!;
  const [created] = await db
    .insert(externalApiSettingsTable)
    .values({ id: 1, killSwitchEnabled: false })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // race lost - re-read
  const [again] = await db
    .select()
    .from(externalApiSettingsTable)
    .where(eq(externalApiSettingsTable.id, 1))
    .limit(1);
  return again!;
}

export const requireExternalApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const headerVal = req.headers["x-api-key"];
  const presented = typeof headerVal === "string" ? headerVal.trim() : "";
  if (!presented) {
    res.status(401).json({ error: "missing_api_key", message: "Send the key in the x-api-key header." });
    return;
  }

  let key: ExternalApiKey | undefined;
  try {
    const hash = hashExternalApiKey(presented);
    const rows = await db
      .select()
      .from(externalApiKeysTable)
      .where(and(eq(externalApiKeysTable.keyHash, hash), isNull(externalApiKeysTable.revokedAt)))
      .limit(1);
    key = rows[0];
  } catch (err) {
    logger.error({ err }, "[external-api] key lookup failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }

  if (!key) {
    res.status(401).json({ error: "invalid_api_key", message: "Key is unknown or has been revoked." });
    return;
  }

  // Global kill switch beats any individual key.
  try {
    const settings = await loadExternalApiSettings();
    if (settings.killSwitchEnabled) {
      res.status(503).json({
        error: "kill_switch_enabled",
        message: "External admin API is temporarily disabled by an administrator.",
        reason: settings.killSwitchReason ?? null,
      });
      return;
    }
  } catch (err) {
    logger.error({ err }, "[external-api] settings load failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }

  const rate = checkRate(key.id);
  res.setHeader("x-ratelimit-limit", String(RATE_LIMIT_MAX));
  res.setHeader("x-ratelimit-remaining", String(rate.remaining));
  res.setHeader("x-ratelimit-reset", String(Math.ceil(rate.resetMs / 1000)));
  if (!rate.ok) {
    res.status(429).json({
      error: "rate_limit_exceeded",
      message: `Limit is ${RATE_LIMIT_MAX} requests per minute per key.`,
      retryAfterSeconds: Math.ceil(rate.resetMs / 1000),
    });
    return;
  }

  // Best-effort lastUsed update; do not block the request on failure.
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
  db.update(externalApiKeysTable)
    .set({ lastUsedAt: sql`now()`, lastUsedIp: ip })
    .where(eq(externalApiKeysTable.id, key.id))
    .catch((err) => logger.warn({ err, keyId: key!.id }, "[external-api] lastUsed touch failed"));

  req.externalApiKey = key;
  next();
};
