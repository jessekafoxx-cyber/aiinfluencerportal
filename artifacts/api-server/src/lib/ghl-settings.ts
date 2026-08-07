/**
 * GHL connection + purchase-webhook secret, stored in the app_settings
 * key/value table so every duplicated template clone generates its own
 * secret and connects its own GoHighLevel account — nothing is hardcoded.
 *
 * Keys:
 *   - ghl_purchase_webhook_secret: whsec_<hex> shared secret for
 *     POST /api/public/webhooks/ghl
 *   - ghl_connection: JSON { token, locationId } (GHL Private Integration
 *     token + Location ID). The token is never returned to the frontend.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";

const SECRET_KEY = "ghl_purchase_webhook_secret";
const CONNECTION_KEY = "ghl_connection";

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export async function getWebhookSecret(): Promise<string> {
  const existing = await getSetting(SECRET_KEY);
  if (existing) return existing;
  const secret = generateSecret();
  await setSetting(SECRET_KEY, secret);
  return secret;
}

export async function rotateWebhookSecret(): Promise<string> {
  const secret = generateSecret();
  await setSetting(SECRET_KEY, secret);
  return secret;
}

export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface GhlConnection {
  token: string;
  locationId: string;
}

export async function getGhlConnection(): Promise<GhlConnection | null> {
  const raw = await getSetting(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GhlConnection>;
    if (typeof parsed.token === "string" && typeof parsed.locationId === "string") {
      return { token: parsed.token, locationId: parsed.locationId };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export async function saveGhlConnection(conn: GhlConnection): Promise<void> {
  await setSetting(CONNECTION_KEY, JSON.stringify(conn));
}

export async function clearGhlConnection(): Promise<void> {
  await db.delete(appSettingsTable).where(eq(appSettingsTable.key, CONNECTION_KEY));
}
