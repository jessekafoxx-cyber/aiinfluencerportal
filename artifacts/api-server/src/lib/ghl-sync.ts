/**
 * GoHighLevel (LeadConnector) lead mirror.
 *
 * Public surface:
 *   - `ghlConfigured()` - true iff GHL_API_KEY + GHL_LOCATION_ID are set.
 *   - `upsertGhlContact({ email, phone?, firstName?, country?, source?, tags? })`
 *     - upserts the contact and caches the returned id on funnel_leads.
 *       Returns the cached / fresh contact id or null on failure.
 *   - `addGhlTag({ email, tag })` / `removeGhlTag({ email, tag })`
 *     - tag manipulation by email. Both upsert first if no cached id.
 *   - `tagGhlPurchased({ email })` - one-shot: adds "Purchased",
 *     removes "not-purchased", stamps funnel_leads.ghl_purchased_tagged_at.
 *     Idempotent.
 *   - `startGhlNotPurchasedScheduler()` - boot-time loop that tags
 *     leads older than 5 min with no purchase as "not-purchased".
 *     Stamps funnel_leads.ghl_not_purchased_tagged_at as a one-shot.
 *
 * Every public function swallows GHL errors (logged via `logger.warn`)
 * so a flaky GHL can never block a funnel submit, a paid-state flip,
 * or any other caller in the hot path.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, funnelLeadsTable, ordersTable } from "@workspace/db";
import { logger } from "./logger";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const TAG_NOT_PURCHASED = "not-purchased";
// Canonical purchase tag - the ONLY tag we apply on a paid main flip.
// EXACT string matched by the GHL "Purchased - Follow Up" workflow
// trigger (Contact Tag -> Tag Added includes ...). Do NOT change
// casing, spacing, or punctuation without updating the workflow.
const TAG_PURCHASED_AI_INFLUENCER_MASTERCLASS =
  "ai influencer masterclass + dfy build";
// Legacy tags - retired in favor of the single canonical purchase
// tag above. Kept here so the paid-flip path can actively REMOVE
// them on every replay, eventually cleaning every contact.
const LEGACY_TAG_PURCHASED = "Purchased";
const LEGACY_TAG_PURCHASED_PREFIXED =
  "purchased: ai influencer masterclass + dfy build";

const NOT_PURCHASED_DELAY_MS = 5 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 60 * 1000;
const SCHEDULER_BATCH_SIZE = 50;

interface GhlContactResponse {
  contact?: {
    id?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function getGhlConfig(): { apiKey: string; locationId: string } | null {
  const apiKey = process.env.GHL_API_KEY?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId };
}

export function ghlConfigured(): boolean {
  return getGhlConfig() !== null;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

async function ghlFetch(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<Response> {
  const { apiKey, headers, ...rest } = init;
  return fetch(`${GHL_API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers || {}),
    },
  });
}

export interface UpsertGhlContactOpts {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  country?: string | null;
  source?: string | null;
  tags?: string[];
}

/**
 * Upsert a contact in GoHighLevel and cache the returned id on
 * funnel_leads. Returns the contact id on success, null otherwise.
 */
export async function upsertGhlContact(
  opts: UpsertGhlContactOpts,
): Promise<string | null> {
  const cfg = getGhlConfig();
  if (!cfg) return null;
  const email = normalizeEmail(opts.email);
  if (!email) return null;

  try {
    const body: Record<string, unknown> = {
      locationId: cfg.locationId,
      email,
    };
    const phone = opts.phone?.trim();
    if (phone) body.phone = phone;
    const firstName = opts.firstName?.trim();
    if (firstName) body.firstName = firstName;
    const country = opts.country?.trim();
    if (country) body.country = country;
    const source = opts.source?.trim();
    if (source) body.source = source;
    if (opts.tags && opts.tags.length > 0) body.tags = opts.tags;

    const res = await ghlFetch("/contacts/upsert", {
      apiKey: cfg.apiKey,
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, email, body: text.slice(0, 500) },
        "[ghl-sync] upsert failed",
      );
      return null;
    }

    const data = (await res.json().catch(() => null)) as GhlContactResponse | null;
    const contactId = data?.contact?.id ?? null;
    if (!contactId || typeof contactId !== "string") {
      logger.warn({ email }, "[ghl-sync] upsert returned no contact id");
      return null;
    }

    // Cache on funnel_leads if the lead row exists. The row may not
    // exist for purchases that bypassed the funnel form (admin grants,
    // direct portal-addon buys) - that is fine, the contact id is
    // still useful for the immediate tag call.
    try {
      await db
        .update(funnelLeadsTable)
        .set({ ghlContactId: contactId, lastSeenAt: new Date() })
        .where(
          and(
            eq(funnelLeadsTable.email, email),
            // Only write if currently null OR different - avoids a
            // pointless UPDATE that bumps lastSeenAt on every paid flip.
            or(
              isNull(funnelLeadsTable.ghlContactId),
              sql`${funnelLeadsTable.ghlContactId} <> ${contactId}`,
            ),
          ),
        );
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), email },
        "[ghl-sync] failed to cache contact id on funnel_leads",
      );
    }

    return contactId;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), email },
      "[ghl-sync] upsert threw",
    );
    return null;
  }
}

async function getCachedContactId(email: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ ghlContactId: funnelLeadsTable.ghlContactId })
      .from(funnelLeadsTable)
      .where(eq(funnelLeadsTable.email, email))
      .limit(1);
    return row?.ghlContactId ?? null;
  } catch {
    return null;
  }
}

async function resolveContactId(opts: {
  email: string;
  upsertFallback: UpsertGhlContactOpts;
}): Promise<string | null> {
  const cached = await getCachedContactId(opts.email);
  if (cached) return cached;
  return upsertGhlContact(opts.upsertFallback);
}

async function applyTagOp(args: {
  email: string;
  tag: string;
  op: "add" | "remove";
  upsertFallback: UpsertGhlContactOpts;
}): Promise<boolean> {
  const cfg = getGhlConfig();
  if (!cfg) return false;
  const email = normalizeEmail(args.email);
  if (!email) return false;

  const contactId = await resolveContactId({
    email,
    upsertFallback: { ...args.upsertFallback, email },
  });
  if (!contactId) return false;

  try {
    const res = await ghlFetch(`/contacts/${contactId}/tags`, {
      apiKey: cfg.apiKey,
      method: args.op === "add" ? "POST" : "DELETE",
      body: JSON.stringify({ tags: [args.tag] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        {
          status: res.status,
          email,
          tag: args.tag,
          op: args.op,
          body: text.slice(0, 300),
        },
        "[ghl-sync] tag op failed",
      );
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), email, tag: args.tag, op: args.op },
      "[ghl-sync] tag op threw",
    );
    return false;
  }
}

export interface TagPurchasedOpts {
  email: string;
  firstName?: string | null;
  phone?: string | null;
}

/**
 * One-shot: apply the canonical purchase tag, clean up legacy tags
 * (`Purchased`, `purchased: ai influencer masterclass + dfy build`)
 * and `not-purchased`, then stamp
 * `funnel_leads.ghl_purchased_tagged_at`. Skips silently if already
 * stamped. Idempotent - safe to call from webhook retries.
 *
 * Tag scheme (per product spec):
 *   - ADD:    "ai influencer masterclass + dfy build" (canonical)
 *   - REMOVE: "Purchased"   (legacy umbrella, retired)
 *   - REMOVE: "purchased: ai influencer masterclass + dfy build" (legacy)
 *   - REMOVE: "not-purchased"
 *
 * The legacy removes are best-effort and run every replay so existing
 * contacts get cleaned up naturally over time.
 */
export async function tagGhlPurchased(opts: TagPurchasedOpts): Promise<void> {
  if (!ghlConfigured()) return;
  const email = normalizeEmail(opts.email);
  if (!email) return;

  try {
    // Check the one-shot gate. If already stamped, skip every call.
    const [row] = await db
      .select({
        id: funnelLeadsTable.id,
        ghlPurchasedTaggedAt: funnelLeadsTable.ghlPurchasedTaggedAt,
      })
      .from(funnelLeadsTable)
      .where(eq(funnelLeadsTable.email, email))
      .limit(1);

    if (row?.ghlPurchasedTaggedAt) return;

    const upsertFallback: UpsertGhlContactOpts = {
      email,
      firstName: opts.firstName ?? null,
      phone: opts.phone ?? null,
      source: "stripe-paid",
    };

    // 1. Apply the canonical purchase tag. This MUST succeed for the
    //    one-shot gate to stamp - everything else is best-effort cleanup.
    const okAdd = await applyTagOp({
      email,
      tag: TAG_PURCHASED_AI_INFLUENCER_MASTERCLASS,
      op: "add",
      upsertFallback,
    });

    // 2. Best-effort cleanup of every tag this contact should NOT have.
    //    Fire-and-forget so a flaky GHL on cleanup doesn't block the
    //    primary purchase tag.
    for (const legacy of [
      LEGACY_TAG_PURCHASED,
      LEGACY_TAG_PURCHASED_PREFIXED,
      TAG_NOT_PURCHASED,
    ]) {
      void applyTagOp({
        email,
        tag: legacy,
        op: "remove",
        upsertFallback,
      });
    }

    if (okAdd && row?.id) {
      try {
        await db
          .update(funnelLeadsTable)
          .set({ ghlPurchasedTaggedAt: new Date() })
          .where(
            and(
              eq(funnelLeadsTable.id, row.id),
              isNull(funnelLeadsTable.ghlPurchasedTaggedAt),
            ),
          );
      } catch (err: any) {
        logger.warn(
          { err: err?.message || String(err), email },
          "[ghl-sync] failed to stamp ghlPurchasedTaggedAt",
        );
      }
    }
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), email },
      "[ghl-sync] tagGhlPurchased threw",
    );
  }
}

/**
 * Find every funnel_leads row that:
 *   - was created >= 5 min ago,
 *   - has not been stamped `not-purchased` yet,
 *   - has not been stamped `Purchased` yet,
 *   - and has no paid main order linked by email.
 * Tag them `not-purchased` in GHL (upserting the contact if needed)
 * and stamp ghl_not_purchased_tagged_at as the one-shot gate.
 */
async function drainNotPurchasedBatch(): Promise<number> {
  if (!ghlConfigured()) return 0;
  const cutoff = new Date(Date.now() - NOT_PURCHASED_DELAY_MS);

  let rows: Array<{
    id: number;
    email: string;
    firstName: string | null;
    phone: string | null;
    country: string | null;
    sourcePage: string | null;
  }> = [];
  try {
    rows = await db
      .select({
        id: funnelLeadsTable.id,
        email: funnelLeadsTable.email,
        firstName: funnelLeadsTable.firstName,
        phone: funnelLeadsTable.phone,
        country: funnelLeadsTable.country,
        sourcePage: funnelLeadsTable.sourcePage,
      })
      .from(funnelLeadsTable)
      .where(
        and(
          lt(funnelLeadsTable.createdAt, cutoff),
          isNull(funnelLeadsTable.ghlNotPurchasedTaggedAt),
          isNull(funnelLeadsTable.ghlPurchasedTaggedAt),
          // Exclude leads who already paid via a different path
          // (purchase flip races with the scheduler, or admin grant
          // bypassed the funnel). We don't want to tag a buyer as
          // not-purchased just because tagGhlPurchased hadn't been
          // called yet at scheduler tick time.
          sql`NOT EXISTS (
            SELECT 1 FROM ${ordersTable} o
            WHERE lower(o.email) = ${funnelLeadsTable.email}
              AND o.main_product_paid = true
          )`,
        ),
      )
      .limit(SCHEDULER_BATCH_SIZE);
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "[ghl-sync] not-purchased batch select failed",
    );
    return 0;
  }

  if (rows.length === 0) return 0;

  let tagged = 0;
  for (const row of rows) {
    const ok = await applyTagOp({
      email: row.email,
      tag: TAG_NOT_PURCHASED,
      op: "add",
      upsertFallback: {
        email: row.email,
        firstName: row.firstName,
        phone: row.phone,
        country: row.country,
        source: row.sourcePage ? `funnel:lead (${row.sourcePage})` : "funnel:lead",
      },
    });
    if (!ok) continue;
    try {
      await db
        .update(funnelLeadsTable)
        .set({ ghlNotPurchasedTaggedAt: new Date() })
        .where(
          and(
            eq(funnelLeadsTable.id, row.id),
            isNull(funnelLeadsTable.ghlNotPurchasedTaggedAt),
          ),
        );
      tagged += 1;
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), email: row.email },
        "[ghl-sync] failed to stamp ghlNotPurchasedTaggedAt",
      );
    }
  }

  if (tagged > 0) {
    logger.info(
      { tagged, scanned: rows.length },
      "[ghl-sync] tagged not-purchased leads",
    );
  }
  return tagged;
}

let schedulerStarted = false;

export function startGhlNotPurchasedScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!ghlConfigured()) {
    logger.info("[ghl-sync] scheduler skipped (GHL_API_KEY / GHL_LOCATION_ID unset)");
    return;
  }

  if (process.env.GHL_SYNC_DISABLED === "1") {
    logger.info("[ghl-sync] scheduler disabled by GHL_SYNC_DISABLED=1");
    return;
  }

  logger.info(
    { intervalMs: SCHEDULER_INTERVAL_MS, delayMs: NOT_PURCHASED_DELAY_MS },
    "[ghl-sync] starting not-purchased scheduler",
  );

  const tick = async () => {
    try {
      await drainNotPurchasedBatch();
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err) },
        "[ghl-sync] scheduler tick threw",
      );
    }
  };

  // First tick after a short delay so worker boot completes first.
  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, SCHEDULER_INTERVAL_MS);
  }, 10_000);
}

// ---------------------------------------------------------------------------
// 1-1 Onboarding Call (GHL booking widget)
// ---------------------------------------------------------------------------

/** GHL calendar id for "Room30.ai - Masterclass 1-1 Onboarding Call". */
export const ONBOARDING_CALL_CALENDAR_ID = "eUBO2GGTIzk59M2DGrN1";

/** Public LeadConnector booking widget iframe src for that calendar. */
export const ONBOARDING_CALL_BOOKING_URL = `https://api.leadconnectorhq.com/widget/booking/${ONBOARDING_CALL_CALENDAR_ID}`;

/**
 * Resolve a GHL contact id for an email WITHOUT creating one. Tries the
 * funnel_leads cache first (no API call), then a read-only contacts search.
 *
 * Returns `{ contactId: null, error: false }` when the email is simply
 * unknown (an unknown buyer obviously has no booking) and
 * `{ contactId: null, error: true }` when the lookup itself failed, so the
 * caller can mark the whole booked-detection result inconclusive rather than
 * pretending the buyer definitively has no booking.
 */
async function findGhlContactIdByEmail(
  rawEmail: string,
): Promise<{ contactId: string | null; error: boolean }> {
  const cfg = getGhlConfig();
  if (!cfg) return { contactId: null, error: false };
  const email = normalizeEmail(rawEmail);
  if (!email) return { contactId: null, error: false };

  const cached = await getCachedContactId(email);
  if (cached) return { contactId: cached, error: false };

  try {
    const params = new URLSearchParams({
      locationId: cfg.locationId,
      query: email,
      limit: "20",
    });
    const res = await ghlFetch(`/contacts/?${params.toString()}`, {
      apiKey: cfg.apiKey,
      method: "GET",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: text.slice(0, 300) },
        "[ghl-onboarding] contact search failed",
      );
      return { contactId: null, error: true };
    }
    const data = (await res.json().catch(() => null)) as
      | { contacts?: Array<{ id?: string; email?: string | null }> }
      | null;
    const contacts = Array.isArray(data?.contacts) ? data!.contacts! : [];
    const match = contacts.find(
      (c) => normalizeEmail(c?.email) === email && typeof c?.id === "string",
    );
    return { contactId: match?.id ?? null, error: false };
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "[ghl-onboarding] contact search threw",
    );
    return { contactId: null, error: true };
  }
}

// ---------------------------------------------------------------------------
// Elite 1-1 Mentorship Application (custom Typeform replacement)
// ---------------------------------------------------------------------------

/**
 * GHL calendar id for the Elite 1-1 Mentorship demo call shown on the final
 * step of the in-app application form. Driven by `GHL_ELITE_CALENDAR_ID` so it
 * can be set without a redeploy; empty until configured (the form still works
 * and creates the contact - it just shows a "calendar is being set up" notice).
 */
export const ELITE_MENTORSHIP_CALENDAR_ID =
  process.env.GHL_ELITE_CALENDAR_ID?.trim() || "";

const ELITE_MENTORSHIP_TAG = "elite-mentorship-applicant";

/** Public LeadConnector booking widget src for the elite mentorship calendar, or "" when unset. */
export function eliteMentorshipBookingUrl(): string {
  if (!ELITE_MENTORSHIP_CALENDAR_ID) return "";
  return `https://api.leadconnectorhq.com/widget/booking/${ELITE_MENTORSHIP_CALENDAR_ID}`;
}

export interface EliteMentorshipApplication {
  firstName: string;
  email: string;
  phone: string;
  currentSituation?: string;
  monthlyIncome?: string;
  targetIncome?: string;
  investmentWillingness?: string;
  twelveMonthVision?: string;
}

/**
 * Add a free-text note to a GHL contact. Best-effort - logs and returns false
 * on any failure so it can never block the application flow.
 */
async function addGhlContactNote(args: {
  apiKey: string;
  contactId: string;
  body: string;
}): Promise<boolean> {
  try {
    const res = await ghlFetch(`/contacts/${args.contactId}/notes`, {
      apiKey: args.apiKey,
      method: "POST",
      body: JSON.stringify({ body: args.body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: text.slice(0, 300) },
        "[ghl-mentorship] note create failed",
      );
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "[ghl-mentorship] note create threw",
    );
    return false;
  }
}

/**
 * Submit an Elite 1-1 Mentorship application to GoHighLevel:
 *   1. Upsert the contact (name / email / phone), tag `elite-mentorship-applicant`,
 *      and best-effort custom fields keyed by the spec keys.
 *   2. Attach a readable note with every qualifying answer so the partnership
 *      team always sees the answers even if the custom fields are not configured
 *      in the GHL account.
 *
 * Never throws and never blocks the caller - on any failure it logs and returns
 * null so the applicant can always proceed to the booking calendar.
 */
export async function submitEliteMentorshipApplication(
  app: EliteMentorshipApplication,
): Promise<string | null> {
  const cfg = getGhlConfig();
  if (!cfg) return null;
  const email = normalizeEmail(app.email);
  if (!email) return null;

  try {
    const customFields = [
      { key: "current_situation", field_value: app.currentSituation || "" },
      { key: "monthly_income", field_value: app.monthlyIncome || "" },
      { key: "target_monthly_income", field_value: app.targetIncome || "" },
      { key: "investment_willingness", field_value: app.investmentWillingness || "" },
      { key: "twelve_month_vision", field_value: app.twelveMonthVision || "" },
    ].filter((f) => f.field_value);

    const body: Record<string, unknown> = {
      locationId: cfg.locationId,
      email,
      source: "Elite 1-1 Mentorship Application",
      tags: [ELITE_MENTORSHIP_TAG],
    };
    const firstName = app.firstName?.trim();
    if (firstName) body.firstName = firstName;
    const phone = app.phone?.trim();
    if (phone) body.phone = phone;
    if (customFields.length > 0) body.customFields = customFields;

    const res = await ghlFetch("/contacts/upsert", {
      apiKey: cfg.apiKey,
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, email, body: text.slice(0, 500) },
        "[ghl-mentorship] application upsert failed",
      );
      return null;
    }

    const data = (await res.json().catch(() => null)) as GhlContactResponse | null;
    const contactId = data?.contact?.id ?? null;
    if (!contactId || typeof contactId !== "string") {
      logger.warn({ email }, "[ghl-mentorship] upsert returned no contact id");
      return null;
    }

    // Readable note so the team sees the answers regardless of custom-field setup.
    const noteLines = [
      "Elite 1-1 Mentorship Application",
      `Name: ${firstName || "-"}`,
      `Phone: ${phone || "-"}`,
      `Current situation: ${app.currentSituation || "-"}`,
      `Monthly income: ${app.monthlyIncome || "-"}`,
      `Target monthly income (12mo): ${app.targetIncome || "-"}`,
      `Investment willingness: ${app.investmentWillingness || "-"}`,
      "12-month vision:",
      app.twelveMonthVision || "-",
    ];
    void addGhlContactNote({
      apiKey: cfg.apiKey,
      contactId,
      body: noteLines.join("\n"),
    });

    return contactId;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), email },
      "[ghl-mentorship] submit threw",
    );
    return null;
  }
}

export interface OnboardingCallStatus {
  /** true iff GHL_API_KEY + GHL_LOCATION_ID are set. */
  configured: boolean;
  /** true iff this email has ever booked the onboarding call (book-once-ever). */
  hasBooked: boolean;
  /** true iff a GHL call failed and the result is therefore inconclusive. */
  error: boolean;
}

/**
 * Check whether an email has booked the 1-1 onboarding call. Resolves the
 * contact id (cache -> read-only search), pulls their appointments, and counts
 * ANY appointment on the onboarding calendar - including cancelled ones. The
 * product rule is book-once-ever: a single appointment on this calendar (live
 * or cancelled) permanently hides the booking option, so a cancellation never
 * re-opens the slot.
 *
 * Never throws - GHL failures return { error: true, hasBooked: false } so
 * callers fail open (we would rather show the booking option to someone who
 * already booked than hide it from someone who has not).
 */
export async function hasBookedOnboardingCall(
  rawEmail: string,
): Promise<OnboardingCallStatus> {
  const cfg = getGhlConfig();
  if (!cfg) return { configured: false, hasBooked: false, error: false };

  const { contactId, error: lookupError } =
    await findGhlContactIdByEmail(rawEmail);
  // The contact lookup itself failed => inconclusive, fail open.
  if (lookupError) return { configured: true, hasBooked: false, error: true };
  // No contact at all => definitely no booking (not an error).
  if (!contactId) return { configured: true, hasBooked: false, error: false };

  try {
    const res = await ghlFetch(`/contacts/${contactId}/appointments`, {
      apiKey: cfg.apiKey,
      method: "GET",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: text.slice(0, 300) },
        "[ghl-onboarding] appointments fetch failed",
      );
      return { configured: true, hasBooked: false, error: true };
    }
    const data = (await res.json().catch(() => null)) as
      | {
          events?: Array<{
            calendarId?: string | null;
          }>;
        }
      | null;
    const events = Array.isArray(data?.events) ? data!.events! : [];
    const hasBooked = events.some(
      (ev) => ev?.calendarId === ONBOARDING_CALL_CALENDAR_ID,
    );
    return { configured: true, hasBooked, error: false };
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err) },
      "[ghl-onboarding] appointments fetch threw",
    );
    return { configured: true, hasBooked: false, error: true };
  }
}
