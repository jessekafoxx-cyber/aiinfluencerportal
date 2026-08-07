import crypto from "crypto";
import { db } from "@workspace/db";
import { metaCapiEventsTable } from "@workspace/db";
import { and, eq, like, or } from "drizzle-orm";
import { logger } from "../lib/logger";

const PIXEL_ID = process.env.META_PIXEL_ID || "";
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || "";
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE || "";
const GRAPH_VERSION = "v21.0";

export type MetaOrderType = "standard" | "high_ticket";

export interface MetaPurchaseInput {
  eventId: string;
  eventSourceUrl?: string;
  eventTime?: number;
  email?: string | null;
  phone?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  value: number;
  currency?: string;
  orderType: MetaOrderType;
  contentName?: string;
  contentIds?: string[];
  testEventCode?: string;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function isMetaCapiConfigured(): boolean {
  return Boolean(PIXEL_ID && ACCESS_TOKEN);
}

async function claimEvent(eventId: string, eventName: string): Promise<boolean> {
  if (!eventId) return false;
  try {
    const inserted = await db.insert(metaCapiEventsTable).values({
      eventId,
      eventName,
      pixelId: PIXEL_ID,
      status: "processing",
      responseBody: null as any,
    }).onConflictDoNothing().returning({ eventId: metaCapiEventsTable.eventId });
    if (inserted.length > 0) return true;
    // A row already exists for this eventId. Re-claim it ONLY when a prior
    // send failed (status `error_*` / `fetch_error`) - otherwise a transient
    // Meta/network failure on the first attempt would leave a dead claim row
    // that makes every webhook retry skip as a "duplicate", permanently
    // swallowing the conversion. The conditional UPDATE is atomic: if two
    // retries race, only one flips the row back to "processing" and proceeds;
    // the loser is reported as a duplicate (Meta also de-dupes on event_id,
    // so a rare double-send is harmless). Rows in "sent" / "processing" are
    // left untouched and treated as duplicates.
    const reclaimed = await db.update(metaCapiEventsTable)
      .set({ status: "processing", responseBody: null as any })
      .where(and(
        eq(metaCapiEventsTable.eventId, eventId),
        or(like(metaCapiEventsTable.status, "error%"), eq(metaCapiEventsTable.status, "fetch_error")),
      ))
      .returning({ eventId: metaCapiEventsTable.eventId });
    return reclaimed.length > 0;
  } catch (err) {
    logger.error({ err, eventId }, "metaCapi: failed to claim event");
    return false;
  }
}

async function finalizeEvent(eventId: string, status: string, responseBody: string) {
  try {
    await db.update(metaCapiEventsTable)
      .set({ status, responseBody: responseBody.slice(0, 4000) })
      .where(eq(metaCapiEventsTable.eventId, eventId));
  } catch (err) {
    logger.error({ err, eventId }, "metaCapi: failed to finalize event");
  }
}

export async function sendMetaPurchaseEvent(input: MetaPurchaseInput): Promise<{ ok: boolean; skipped?: string; status?: number; body?: any }> {
  if (!isMetaCapiConfigured()) {
    logger.warn({ eventId: input.eventId }, "metaCapi: not configured, skipping");
    return { ok: false, skipped: "not_configured" };
  }

  const claimed = await claimEvent(input.eventId, "Purchase");
  if (!claimed) {
    logger.info({ eventId: input.eventId }, "metaCapi: event already claimed/sent, skipping");
    return { ok: true, skipped: "duplicate" };
  }

  const userData: Record<string, any> = {};
  if (input.email) userData.em = [sha256(normalizeEmail(input.email))];
  if (input.phone) {
    const norm = normalizePhone(input.phone);
    if (norm) userData.ph = [sha256(norm)];
  }
  if (input.clientIpAddress) userData.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const customData: Record<string, any> = {
    currency: input.currency || "USD",
    value: Number(input.value.toFixed(2)),
    order_type: input.orderType,
  };
  if (input.contentName) customData.content_name = input.contentName;
  if (input.contentIds && input.contentIds.length) {
    customData.content_ids = input.contentIds;
    customData.content_type = "product";
  }

  const event: Record<string, any> = {
    event_name: "Purchase",
    event_time: input.eventTime || Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "website",
    user_data: userData,
    custom_data: customData,
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;

  const payload: Record<string, any> = { data: [event] };
  const testCode = input.testEventCode || TEST_EVENT_CODE;
  if (testCode) payload.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  let status = 0;
  let bodyText = "";
  let bodyJson: any = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    bodyText = await res.text();
    try { bodyJson = JSON.parse(bodyText); } catch {}
    const ok = res.ok;
    logger.info({ eventId: input.eventId, eventName: "Purchase", status, ok, body: bodyJson || bodyText }, "metaCapi: response");
    await finalizeEvent(input.eventId, ok ? "sent" : `error_${status}`, bodyText);
    return { ok, status, body: bodyJson || bodyText };
  } catch (err: any) {
    logger.error({ err, eventId: input.eventId }, "metaCapi: fetch failed");
    await finalizeEvent(input.eventId, "fetch_error", String(err?.message || err));
    return { ok: false, status, body: String(err?.message || err) };
  }
}

export interface MetaLeadInput {
  eventId: string;
  eventSourceUrl?: string;
  eventTime?: number;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  contentName?: string;
  contentCategory?: string;
  testEventCode?: string;
}

export async function sendMetaLeadEvent(input: MetaLeadInput): Promise<{ ok: boolean; skipped?: string; status?: number; body?: any }> {
  if (!isMetaCapiConfigured()) {
    logger.warn({ eventId: input.eventId }, "metaCapi: not configured, skipping Lead event");
    return { ok: false, skipped: "not_configured" };
  }

  const claimed = await claimEvent(input.eventId, "Lead");
  if (!claimed) {
    logger.info({ eventId: input.eventId }, "metaCapi: Lead event already claimed/sent, skipping");
    return { ok: true, skipped: "duplicate" };
  }

  const userData: Record<string, any> = {};
  if (input.email) userData.em = [sha256(normalizeEmail(input.email))];
  if (input.phone) {
    const norm = normalizePhone(input.phone);
    if (norm) userData.ph = [sha256(norm)];
  }
  if (input.firstName) userData.fn = [sha256(input.firstName.trim().toLowerCase())];
  if (input.lastName) userData.ln = [sha256(input.lastName.trim().toLowerCase())];
  if (input.clientIpAddress) userData.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const customData: Record<string, any> = {};
  if (input.contentName) customData.content_name = input.contentName;
  if (input.contentCategory) customData.content_category = input.contentCategory;

  const event: Record<string, any> = {
    event_name: "Lead",
    event_time: input.eventTime || Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "website",
    user_data: userData,
    custom_data: customData,
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;

  const payload: Record<string, any> = { data: [event] };
  const testCode = input.testEventCode || TEST_EVENT_CODE;
  if (testCode) payload.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  let status = 0;
  let bodyText = "";
  let bodyJson: any = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    bodyText = await res.text();
    try { bodyJson = JSON.parse(bodyText); } catch {}
    const ok = res.ok;
    logger.info({ eventId: input.eventId, eventName: "Lead", status, ok, body: bodyJson || bodyText }, "metaCapi: Lead response");
    await finalizeEvent(input.eventId, ok ? "sent" : `error_${status}`, bodyText);
    return { ok, status, body: bodyJson || bodyText };
  } catch (err: any) {
    logger.error({ err, eventId: input.eventId }, "metaCapi: Lead fetch failed");
    await finalizeEvent(input.eventId, "fetch_error", String(err?.message || err));
    return { ok: false, status, body: String(err?.message || err) };
  }
}

export function readFbpFbcFromCookies(req: any): { fbp: string | null; fbc: string | null } {
  const cookieHeader: string = req.headers?.cookie || "";
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v.join("="));
  });
  return { fbp: cookies._fbp || null, fbc: cookies._fbc || null };
}

export function getClientIp(req: any): string | null {
  const fwd = req.headers?.["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.headers?.["x-real-ip"]?.toString() || req.socket?.remoteAddress || null;
}

export function getClientUserAgent(req: any): string | null {
  return req.headers?.["user-agent"]?.toString() || null;
}
