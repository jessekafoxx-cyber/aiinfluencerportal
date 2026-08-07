/**
 * Google Ads offline conversion upload.
 *
 * Fires a click-conversion against the Google Ads API v17 REST endpoint when
 * a purchase has a gclid. Required env vars (all optional - feature is a
 * no-op when any is missing):
 *   GOOGLE_ADS_DEVELOPER_TOKEN   — manager-level developer token
 *   GOOGLE_ADS_CUSTOMER_ID       — 10-digit customer ID, no dashes
 *   GOOGLE_ADS_CONVERSION_NAME   — conversion action resource name segment
 *                                  (e.g. "Purchase") OR full resource name
 *   GOOGLE_ADS_CLIENT_ID         — OAuth2 client ID
 *   GOOGLE_ADS_CLIENT_SECRET     — OAuth2 client secret
 *   GOOGLE_ADS_REFRESH_TOKEN     — offline refresh token
 */

import crypto from "crypto";
import { logger } from "./logger.js";

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
const CONVERSION_NAME = process.env.GOOGLE_ADS_CONVERSION_NAME || "Purchase";
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || "";

export function isGoogleAdsConfigured(): boolean {
  return Boolean(
    DEVELOPER_TOKEN &&
    CUSTOMER_ID &&
    CLIENT_ID &&
    CLIENT_SECRET &&
    REFRESH_TOKEN,
  );
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth2 failed: ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

function sha256Hash(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function toGoogleDateTime(d: Date): string {
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "+00:00");
}

export async function pushGoogleOfflineConversion(opts: {
  gclid: string;
  valueMicros: number;
  conversionDateTime?: Date;
  email?: string | null;
}): Promise<boolean> {
  if (!isGoogleAdsConfigured()) return false;
  try {
    const accessToken = await getAccessToken();
    const convDt = toGoogleDateTime(opts.conversionDateTime ?? new Date());

    const conversionAction = CONVERSION_NAME.startsWith("customers/")
      ? CONVERSION_NAME
      : `customers/${CUSTOMER_ID}/conversionActions/${CONVERSION_NAME}`;

    const body: Record<string, any> = {
      conversions: [
        {
          gclid: opts.gclid,
          conversionAction,
          conversionDateTime: convDt,
          conversionValue: opts.valueMicros / 1_000_000,
          currencyCode: "USD",
          ...(opts.email
            ? {
                hashedUserIdentifiers: [
                  { hashedEmail: sha256Hash(opts.email) },
                ],
              }
            : {}),
        },
      ],
      partialFailure: true,
    };

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${CUSTOMER_ID}:uploadClickConversions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN,
        },
        body: JSON.stringify(body),
      },
    );

    const responseBody: any = await res.json().catch(() => ({}));
    const ok = res.ok && !responseBody.partialFailureError;

    logger.info(
      {
        gclid: opts.gclid.slice(0, 12) + "...",
        status: res.status,
        ok,
        partialFailureError: responseBody.partialFailureError || null,
      },
      "[google-ads-offline] uploadClickConversions response",
    );
    return ok;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, gclid: opts.gclid.slice(0, 12) + "..." },
      "[google-ads-offline] push failed",
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Meta / Google ad spend pull helpers (used by the profit scheduler and
// the /crm/command-center/profit/refresh endpoint).
// ---------------------------------------------------------------------------

const META_ACCESS_TOKEN = process.env.META_ADS_ACCESS_TOKEN || "";
const META_ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID || "";

export function isMetaAdsPullConfigured(): boolean {
  return Boolean(META_ACCESS_TOKEN && META_ACCOUNT_ID);
}

/**
 * Pull Meta Ads spend for a given day from the Marketing API v21.
 * Returns the spend in cents, or null if unconfigured / failed.
 */
export async function pullMetaAdSpendCents(day: string): Promise<number | null> {
  if (!isMetaAdsPullConfigured()) return null;
  try {
    const accountId = META_ACCOUNT_ID.startsWith("act_")
      ? META_ACCOUNT_ID
      : `act_${META_ACCOUNT_ID}`;
    const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/insights`);
    url.searchParams.set("access_token", META_ACCESS_TOKEN);
    url.searchParams.set("fields", "spend");
    url.searchParams.set("time_range", JSON.stringify({ since: day, until: day }));
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("level", "account");

    const res = await fetch(url.toString());
    const json: any = await res.json();
    if (!res.ok || json.error) {
      logger.warn({ error: json.error, day }, "[meta-ads-pull] API error");
      return null;
    }
    const spendUsd = parseFloat((json.data?.[0]?.spend) || "0");
    return Math.round(spendUsd * 100);
  } catch (err) {
    logger.warn({ err: (err as Error).message, day }, "[meta-ads-pull] fetch failed");
    return null;
  }
}

const GOOGLE_ADS_SPEND_MCC_ID = process.env.GOOGLE_ADS_MCC_CUSTOMER_ID || CUSTOMER_ID;

/**
 * Pull Google Ads spend for a given day using the Google Ads API v17.
 * Returns the spend in cents, or null if unconfigured / failed.
 */
export async function pullGoogleAdSpendCents(day: string): Promise<number | null> {
  if (!isGoogleAdsConfigured() || !GOOGLE_ADS_SPEND_MCC_ID) return null;
  try {
    const accessToken = await getAccessToken();
    const query = `SELECT metrics.cost_micros FROM customer WHERE segments.date = '${day}'`;
    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${GOOGLE_ADS_SPEND_MCC_ID}/googleAds:search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN,
        },
        body: JSON.stringify({ query }),
      },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn({ error: json, day }, "[google-ads-spend] API error");
      return null;
    }
    const micros = Number(json.results?.[0]?.metrics?.costMicros || 0);
    return Math.round(micros / 10000);
  } catch (err) {
    logger.warn({ err: (err as Error).message, day }, "[google-ads-spend] fetch failed");
    return null;
  }
}
