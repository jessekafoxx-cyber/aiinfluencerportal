// Task #608 - Calendly v2 API client + webhook signature verifier.
//
// Reads the bearer token from CALENDLY_API_TOKEN. Throws on auth or
// quota failures with a structured Error so callers can decide whether
// to retry. We keep this file deliberately thin: typed helpers for
// exactly the endpoints the CRM integration needs.

import crypto from "node:crypto";
import { logger } from "./logger";

const BASE = "https://api.calendly.com";

export class CalendlyError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function getToken(): string {
  const t = (process.env.CALENDLY_API_TOKEN || "").trim();
  if (!t) {
    throw new CalendlyError(
      503,
      "CALENDLY_API_TOKEN is not configured",
      null,
    );
  }
  return t;
}

export function isCalendlyConfigured(): boolean {
  return !!(process.env.CALENDLY_API_TOKEN || "").trim();
}

async function request<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined> },
): Promise<T> {
  const token = getToken();
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  };

  // Tiny retry/backoff for 429 + 5xx.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), {
      ...init,
      headers,
    });
    if (res.status === 429 || res.status >= 500) {
      // `retry-after` is in seconds per RFC 7231; our exponential
      // fallback is already in milliseconds. Normalize both to ms and
      // cap so a server-supplied 60s wait can't stall the request
      // queue beyond 30s per attempt.
      const headerSec = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(headerSec) && headerSec > 0
        ? Math.min(headerSec * 1000, 30_000)
        : Math.min(2 ** attempt * 250, 4000);
      if (attempt === 3) {
        const text = await res.text().catch(() => "");
        throw new CalendlyError(
          res.status,
          `Calendly ${res.status} after retries: ${text || res.statusText}`,
          text,
        );
      }
      await new Promise((r) => setTimeout(r, retryAfterMs));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      throw new CalendlyError(
        res.status,
        `Calendly ${res.status}: ${res.statusText}`,
        body,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  // unreachable
  throw new CalendlyError(0, "Calendly request loop exited unexpectedly", null);
}

// ---------------------------------------------------------------------
// Types - intentionally narrow; we only model fields we use.
// ---------------------------------------------------------------------

export interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  current_organization: string;
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  active: boolean;
  scheduling_url: string;
  duration: number;
  kind: string;
  slug: string;
}

export interface CalendlyScheduledEvent {
  uri: string;
  name: string | null;
  status: string;
  start_time: string;
  end_time: string;
  event_type: string;
  cancellation?: { canceled_by: string; reason: string | null } | null;
  event_memberships?: Array<{ user: string }>;
}

export interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  reschedule_url: string;
  cancel_url: string;
  event: string;
  questions_and_answers?: Array<{ question: string; answer: string }>;
  no_show?: { uri: string } | null;
}

export interface CalendlySchedulingLink {
  booking_url: string;
  owner: string;
  owner_type: string;
}

export interface CalendlyWebhookSubscription {
  uri: string;
  callback_url: string;
  events: string[];
  scope: string;
  state: string;
  organization?: string;
  user?: string;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

export async function getCurrentUser(): Promise<CalendlyUser> {
  const r = await request<{ resource: CalendlyUser }>("/users/me");
  return r.resource;
}

export async function listEventTypes(opts?: {
  userUri?: string;
  organizationUri?: string;
}): Promise<CalendlyEventType[]> {
  const me = !opts?.userUri && !opts?.organizationUri ? await getCurrentUser() : null;
  const params: Record<string, string | undefined> = {};
  if (opts?.userUri) params.user = opts.userUri;
  else if (opts?.organizationUri) params.organization = opts.organizationUri;
  else if (me) params.user = me.uri;
  const out: CalendlyEventType[] = [];
  let next: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await request<{
      collection: CalendlyEventType[];
      pagination: { next_page: string | null };
    }>(next ?? "/event_types", { query: next ? undefined : params });
    out.push(...(r.collection || []));
    if (!r.pagination?.next_page) break;
    next = r.pagination.next_page;
  }
  return out;
}

export async function listScheduledEvents(opts: {
  minStartTime: Date;
  maxStartTime: Date;
  inviteeEmail?: string;
  eventTypeUri?: string;
  status?: "active" | "canceled";
}): Promise<CalendlyScheduledEvent[]> {
  const me = await getCurrentUser();
  const params: Record<string, string> = {
    organization: me.current_organization,
    min_start_time: opts.minStartTime.toISOString(),
    max_start_time: opts.maxStartTime.toISOString(),
    count: "100",
  };
  if (opts.inviteeEmail) params.invitee_email = opts.inviteeEmail.toLowerCase();
  if (opts.eventTypeUri) params.event_type = opts.eventTypeUri;
  if (opts.status) params.status = opts.status;
  const out: CalendlyScheduledEvent[] = [];
  let next: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await request<{
      collection: CalendlyScheduledEvent[];
      pagination: { next_page: string | null };
    }>(next ?? "/scheduled_events", { query: next ? undefined : params });
    out.push(...(r.collection || []));
    if (!r.pagination?.next_page) break;
    next = r.pagination.next_page;
  }
  return out;
}

export async function listEventInvitees(eventUri: string): Promise<CalendlyInvitee[]> {
  // The Calendly URI for an event ends with the uuid; the invitees
  // collection is at <event uri>/invitees.
  const path = `${eventUri}/invitees`;
  const r = await request<{ collection: CalendlyInvitee[] }>(path);
  return r.collection || [];
}

export async function getInvitee(uri: string): Promise<CalendlyInvitee> {
  const r = await request<{ resource: CalendlyInvitee }>(uri);
  return r.resource;
}

export async function getScheduledEvent(uri: string): Promise<CalendlyScheduledEvent> {
  const r = await request<{ resource: CalendlyScheduledEvent }>(uri);
  return r.resource;
}

export async function cancelScheduledEvent(
  eventUri: string,
  reason: string,
): Promise<void> {
  await request<unknown>(`${eventUri}/cancellation`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function createSchedulingLink(opts: {
  ownerUri: string;
  maxEventCount?: number;
}): Promise<CalendlySchedulingLink> {
  const r = await request<{ resource: CalendlySchedulingLink }>(
    "/scheduling_links",
    {
      method: "POST",
      body: JSON.stringify({
        max_event_count: opts.maxEventCount ?? 1,
        owner: opts.ownerUri,
        owner_type: "EventType",
      }),
    },
  );
  return r.resource;
}

export async function listWebhookSubscriptions(opts?: {
  organizationUri?: string;
  scope?: "organization" | "user";
}): Promise<CalendlyWebhookSubscription[]> {
  const me = await getCurrentUser();
  const params: Record<string, string> = {
    organization: opts?.organizationUri ?? me.current_organization,
    scope: opts?.scope ?? "organization",
    count: "100",
  };
  if ((params.scope) === "user") params.user = me.uri;
  const r = await request<{ collection: CalendlyWebhookSubscription[] }>(
    "/webhook_subscriptions",
    { query: params },
  );
  return r.collection || [];
}

export async function subscribeWebhook(opts: {
  url: string;
  events: string[];
  signingKey?: string;
  scope?: "organization" | "user";
}): Promise<CalendlyWebhookSubscription> {
  const me = await getCurrentUser();
  const body: Record<string, unknown> = {
    url: opts.url,
    events: opts.events,
    organization: me.current_organization,
    scope: opts.scope ?? "organization",
  };
  if (opts.scope === "user") body.user = me.uri;
  if (opts.signingKey) body.signing_key = opts.signingKey;
  const r = await request<{ resource: CalendlyWebhookSubscription }>(
    "/webhook_subscriptions",
    { method: "POST", body: JSON.stringify(body) },
  );
  return r.resource;
}

export async function deleteWebhookSubscription(uri: string): Promise<void> {
  await request<unknown>(uri, { method: "DELETE" });
}

/**
 * Verify a Calendly webhook signature header of the form
 * `t=<unix_seconds>,v1=<hex>` where v1 = HMAC_SHA256(`${t}.${rawBody}`, key).
 * Returns true on valid signature within a 5 minute skew window.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  header: string | undefined | null,
  signingKey: string,
): boolean {
  if (!header || !signingKey) return false;
  try {
    const parts = header.split(",").map((p) => p.trim());
    let t: string | null = null;
    let v1: string | null = null;
    for (const p of parts) {
      const [k, v] = p.split("=");
      if (k === "t") t = v ?? null;
      else if (k === "v1") v1 = v ?? null;
    }
    if (!t || !v1) return false;
    const ts = Number(t);
    if (!Number.isFinite(ts)) return false;
    const ageSec = Math.abs(Date.now() / 1000 - ts);
    if (ageSec > 60 * 5) {
      logger.warn({ ageSec }, "[calendly] webhook timestamp outside skew window");
      return false;
    }
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const mac = crypto
      .createHmac("sha256", signingKey)
      .update(`${t}.${body}`)
      .digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(v1, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    logger.warn({ err }, "[calendly] verifyWebhookSignature threw");
    return false;
  }
}

/** Extract the trailing UUID from a Calendly resource URI. */
export function uriUuid(uri: string): string {
  const m = uri.match(/[a-f0-9-]{8,}$/i);
  return m ? m[0] : uri;
}
