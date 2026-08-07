// Task #608 - Calendly endpoints for the Sales CRM.
//
// All routes are mounted via the parent crm router. The webhook
// receiver is gated only by Calendly signature verification (no Clerk).
// Everything else lives behind the same loadCrmUser middleware as the
// rest of /api/crm and admin-only writes are gated by `requireRole`.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  crmCalendarEvents,
  crmCalendlySettings,
  crmContacts,
  crmActivities,
  crmPipelineStages,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  cancelScheduledEvent,
  createSchedulingLink,
  deleteWebhookSubscription,
  getInvitee,
  getScheduledEvent,
  isCalendlyConfigured,
  listEventTypes,
  listScheduledEvents,
  listEventInvitees,
  listWebhookSubscriptions,
  subscribeWebhook,
  verifyWebhookSignature,
  type CalendlyInvitee,
  type CalendlyScheduledEvent,
} from "../lib/calendly";
import {
  getCalendlySettingsRow,
  upsertBookingFromCalendly,
  runOnce as runReconcilerOnce,
} from "../lib/crm-calendly-reconciler";
import { getBrandBaseUrl } from "../lib/brand-url";
import {
  decryptCalendlyWebhookKey,
  encryptCalendlyWebhookKey,
  isCalendlyWebhookSecretConfigured,
} from "../lib/crm-calendly-secret";
import crypto from "node:crypto";

export const CALENDLY_WEBHOOK_PATH = "/crm/webhooks/calendly";
export const CALENDLY_WEBHOOK_EVENTS = [
  "invitee.created",
  "invitee.canceled",
  "invitee_no_show.created",
  "invitee_no_show.deleted",
];

// ---------------------------------------------------------------------
// Webhook receiver - exported so it can be mounted with raw-body
// middleware in app.ts BEFORE express.json runs (signature requires
// the byte-exact request body).
// ---------------------------------------------------------------------
export async function handleCalendlyWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const settings = await getCalendlySettingsRow();
    if (!settings.webhookSigningKey) {
      logger.warn("[crm-calendly] webhook arrived but signing key not configured");
      res.status(401).json({ error: "webhook_not_configured" });
      return;
    }
    const raw = (req as unknown as { rawBody?: Buffer; body?: unknown }).rawBody;
    const bodyForSig: Buffer | string =
      raw && Buffer.isBuffer(raw)
        ? raw
        : typeof req.body === "string"
          ? req.body
          : Buffer.isBuffer(req.body)
            ? (req.body as Buffer)
            : JSON.stringify(req.body ?? {});
    const sig =
      (req.header("calendly-webhook-signature") ||
        req.header("Calendly-Webhook-Signature") ||
        "") as string;
    let verifyKey: string;
    try {
      verifyKey = decryptCalendlyWebhookKey(settings.webhookSigningKey);
    } catch (err) {
      logger.warn({ err }, "[crm-calendly] could not decrypt webhook signing key");
      res.status(500).json({ error: "signing_key_unreadable" });
      return;
    }
    if (!verifyWebhookSignature(bodyForSig, sig, verifyKey)) {
      logger.warn({ sig: sig?.slice(0, 32) }, "[crm-calendly] bad webhook signature");
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    let payload: any;
    try {
      payload =
        typeof bodyForSig === "string"
          ? JSON.parse(bodyForSig)
          : JSON.parse(bodyForSig.toString("utf8"));
    } catch (err) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const event = String(payload?.event || "");
    const data = payload?.payload ?? {};

    if (event === "invitee.created" || event === "invitee.canceled") {
      const inviteeUri: string | undefined = data?.uri;
      const eventUri: string | undefined = data?.event;
      if (!inviteeUri || !eventUri) {
        res.status(400).json({ error: "missing_uris" });
        return;
      }
      // Pull authoritative copies (the webhook payload is enough for
      // most fields but using the API gives us a consistent shape with
      // the reconciler path).
      const [inv, ev] = await Promise.all([
        getInvitee(inviteeUri).catch(() => normalizeInviteeFromPayload(data)),
        getScheduledEvent(eventUri).catch(() => normalizeEventFromPayload(data)),
      ]);
      await upsertBookingFromCalendly(ev, inv, "webhook");
    } else if (
      event === "invitee_no_show.created" ||
      event === "invitee_no_show.deleted"
    ) {
      const inviteeUri: string | undefined = data?.invitee?.uri;
      if (!inviteeUri) {
        res.status(200).json({ ok: true, ignored: "no_invitee_uri" });
        return;
      }
      const isNoShow = event === "invitee_no_show.created";
      const [row] = await db
        .select()
        .from(crmCalendarEvents)
        .where(eq(crmCalendarEvents.calendlyInviteeUri, inviteeUri))
        .limit(1);
      if (row) {
        await db
          .update(crmCalendarEvents)
          .set({
            status: isNoShow ? "no_show" : "active",
            updatedAt: new Date(),
          })
          .where(eq(crmCalendarEvents.id, row.id));
        if (row.contactId) {
          await db.insert(crmActivities).values({
            contactId: row.contactId,
            type: isNoShow ? "meeting_no_show" : "meeting_no_show_cleared",
            subject: row.eventName ?? "Calendly meeting",
          });
        }
      }
    } else {
      logger.warn({ event }, "[crm-calendly] unknown webhook event ignored");
    }

    res.status(200).json({ ok: true });
    return;
  } catch (err) {
    logger.error({ err }, "[crm-calendly] webhook handler threw");
    // Return 200 so Calendly doesn't retry an internal bug forever; the
    // hourly reconciler will pick up anything we lost here.
    res.status(200).json({ ok: false, error: "internal" });
    return;
  }
}

function normalizeInviteeFromPayload(data: any): CalendlyInvitee {
  return {
    uri: String(data?.uri ?? ""),
    email: String(data?.email ?? ""),
    name: data?.name ?? null,
    first_name: data?.first_name ?? null,
    last_name: data?.last_name ?? null,
    status: String(data?.status ?? "active"),
    reschedule_url: String(data?.reschedule_url ?? ""),
    cancel_url: String(data?.cancel_url ?? ""),
    event: String(data?.event ?? ""),
    questions_and_answers: data?.questions_and_answers ?? [],
    no_show: data?.no_show ?? null,
  };
}

function normalizeEventFromPayload(data: any): CalendlyScheduledEvent {
  const sched = data?.scheduled_event ?? data ?? {};
  return {
    uri: String(sched?.uri ?? data?.event ?? ""),
    name: sched?.name ?? null,
    status: String(sched?.status ?? "active"),
    start_time: String(sched?.start_time ?? data?.start_time ?? new Date().toISOString()),
    end_time: String(sched?.end_time ?? data?.end_time ?? new Date().toISOString()),
    event_type: String(sched?.event_type ?? data?.event_type ?? ""),
  };
}

// ---------------------------------------------------------------------
// Authenticated routes (mounted on the parent crm router AFTER
// loadCrmUser).
// ---------------------------------------------------------------------
export function buildCalendlyRouter(opts: {
  requireRole: (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => void;
}): IRouter {
  const r = Router();
  const { requireRole } = opts;

  // List bookings for the calendar view. ?from=ISO&to=ISO required.
  // Visibility: admins/leaders see everything; members only see events
  // attached to contacts they own. Unmatched events (contactId IS NULL)
  // are admin/leader-only since they leak invitee email/name.
  r.get("/crm/calendar/events", async (req, res) => {
    try {
      const me = (req as any).crmUser as { id: number; role: string } | undefined;
      if (!me) {
        res.status(401).json({ error: "no_crm_user" });
        return;
      }
      const seeAll = me.role === "admin" || me.role === "leader";
      const fromRaw = String(req.query.from || "");
      const toRaw = String(req.query.to || "");
      const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 7 * 24 * 3600_000);
      const to = toRaw ? new Date(toRaw) : new Date(Date.now() + 30 * 24 * 3600_000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        res.status(400).json({ error: "invalid_date_range" });
        return;
      }
      const whereConds = [
        gte(crmCalendarEvents.startTime, from),
        lte(crmCalendarEvents.startTime, to),
      ];
      if (!seeAll) {
        // Members: only events attached to a contact they own. The join
        // is a leftJoin in the select below so we add the ownership
        // predicate explicitly here on the contacts side.
        whereConds.push(eq(crmContacts.assignedTo, me.id));
      }
      // For members, switch to an inner join so a NULL contactId (no
      // matching CRM contact for the invitee) is excluded - we don't
      // want to leak invitee email/name to non-leaders.
      const baseSelect = db
        .select({
          id: crmCalendarEvents.id,
          contactId: crmCalendarEvents.contactId,
          calendlyEventUri: crmCalendarEvents.calendlyEventUri,
          calendlyInviteeUri: crmCalendarEvents.calendlyInviteeUri,
          eventName: crmCalendarEvents.eventName,
          inviteeEmail: crmCalendarEvents.inviteeEmail,
          inviteeName: crmCalendarEvents.inviteeName,
          startTime: crmCalendarEvents.startTime,
          endTime: crmCalendarEvents.endTime,
          status: crmCalendarEvents.status,
          rescheduleUrl: crmCalendarEvents.rescheduleUrl,
          cancelUrl: crmCalendarEvents.cancelUrl,
          contactEmail: crmContacts.email,
          contactFirstName: crmContacts.firstName,
          contactLastName: crmContacts.lastName,
        })
        .from(crmCalendarEvents);
      const joined = seeAll
        ? baseSelect.leftJoin(
            crmContacts,
            eq(crmCalendarEvents.contactId, crmContacts.id),
          )
        : baseSelect.innerJoin(
            crmContacts,
            eq(crmCalendarEvents.contactId, crmContacts.id),
          );
      const rows = await joined
        .where(and(...whereConds))
        .orderBy(asc(crmCalendarEvents.startTime));
      res.json({ events: rows });
      return;
    } catch (err) {
      logger.warn({ err }, "[crm-calendly] list calendar events failed");
      res.status(500).json({ error: "list_failed" });
      return;
    }
  });

  // Per-contact upcoming + past bookings. Used by the contact card tab.
  // Visibility: members may only read appointments for contacts they
  // own; admins/leaders can read any contact's appointments.
  r.get("/crm/contacts/:id/calendar", async (req, res) => {
    const me = (req as any).crmUser as { id: number; role: string } | undefined;
    if (!me) {
      res.status(401).json({ error: "no_crm_user" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const [contact] = await db
      .select({ id: crmContacts.id, assignedTo: crmContacts.assignedTo })
      .from(crmContacts)
      .where(eq(crmContacts.id, id))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "contact_not_found" });
      return;
    }
    const seeAll = me.role === "admin" || me.role === "leader";
    if (!seeAll && contact.assignedTo !== me.id) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const rows = await db
      .select()
      .from(crmCalendarEvents)
      .where(eq(crmCalendarEvents.contactId, id))
      .orderBy(desc(crmCalendarEvents.startTime));
    res.json({ events: rows });
  });

  // Settings (admin-only writes). Read returns sanitized status flags.
  r.get("/crm/calendly/settings", requireRole("admin", "leader"), async (_req, res) => {
    try {
      const row = await getCalendlySettingsRow();
      res.json({
        configured: isCalendlyConfigured(),
        defaultEventTypeUri: row.defaultEventTypeUri,
        sendLinkStageId: row.sendLinkStageId,
        cancelOnStageIds: row.cancelOnStageIds ?? [],
        webhookSubscribed: !!row.webhookSubscriptionUri,
        webhookSubscriptionUri: row.webhookSubscriptionUri,
      });
      return;
    } catch (err) {
      logger.warn({ err }, "[crm-calendly] get settings failed");
      res.status(500).json({ error: "settings_failed" });
      return;
    }
  });

  r.patch("/crm/calendly/settings", requireRole("admin"), async (req, res) => {
    try {
      const row = await getCalendlySettingsRow();
      const b = req.body ?? {};
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if ("defaultEventTypeUri" in b) {
        patch.defaultEventTypeUri = b.defaultEventTypeUri || null;
      }
      if ("sendLinkStageId" in b) {
        const v = b.sendLinkStageId;
        patch.sendLinkStageId = typeof v === "number" ? v : null;
      }
      if ("cancelOnStageIds" in b) {
        const v = Array.isArray(b.cancelOnStageIds)
          ? b.cancelOnStageIds.filter((x: unknown) => typeof x === "number")
          : [];
        patch.cancelOnStageIds = v;
      }
      const [updated] = await db
        .update(crmCalendlySettings)
        .set(patch)
        .where(eq(crmCalendlySettings.id, row.id))
        .returning();
      res.json({
        settings: {
          defaultEventTypeUri: updated.defaultEventTypeUri,
          sendLinkStageId: updated.sendLinkStageId,
          cancelOnStageIds: updated.cancelOnStageIds ?? [],
          webhookSubscribed: !!updated.webhookSubscriptionUri,
        },
      });
      return;
    } catch (err) {
      logger.warn({ err }, "[crm-calendly] patch settings failed");
      res.status(500).json({ error: "settings_update_failed" });
      return;
    }
  });

  // List event types (for the picker in Settings).
  r.get("/crm/calendly/event-types", requireRole("admin", "leader"), async (_req, res) => {
    if (!isCalendlyConfigured()) {
      res.json({ eventTypes: [], configured: false });
      return;
    }
    try {
      const types = await listEventTypes();
      res.json({ eventTypes: types, configured: true });
      return;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[crm-calendly] list event types failed");
      res.status(502).json({ error: "calendly_unreachable" });
      return;
    }
  });

  // Subscribe (or re-subscribe) the webhook with Calendly.
  r.post(
    "/crm/calendly/webhook/subscribe",
    requireRole("admin"),
    async (_req, res) => {
      if (!isCalendlyConfigured()) {
        res.status(503).json({ error: "calendly_not_configured" });
        return;
      }
      if (!isCalendlyWebhookSecretConfigured()) {
        res.status(503).json({ error: "calendly_webhook_secret_missing" });
        return;
      }
      try {
        const row = await getCalendlySettingsRow();
        const callbackUrl = `${getBrandBaseUrl()}/api${CALENDLY_WEBHOOK_PATH}`;
        // Reuse the existing signing key if present so we don't break
        // the in-flight verification config; otherwise mint one and
        // store it. The stored value is an encryption envelope, so we
        // decrypt before reuse and re-encrypt before persisting.
        const signingKey = row.webhookSigningKey
          ? decryptCalendlyWebhookKey(row.webhookSigningKey)
          : crypto.randomBytes(32).toString("hex");
        // If a subscription exists, drop it first so we don't
        // accumulate duplicates pointing at the same URL.
        try {
          const existing = await listWebhookSubscriptions();
          for (const sub of existing) {
            if (sub.callback_url === callbackUrl) {
              await deleteWebhookSubscription(sub.uri).catch(() => {});
            }
          }
        } catch (err) {
          logger.warn({ err }, "[crm-calendly] could not list existing subs");
        }
        const sub = await subscribeWebhook({
          url: callbackUrl,
          events: CALENDLY_WEBHOOK_EVENTS,
          signingKey,
          scope: "organization",
        });
        await db
          .update(crmCalendlySettings)
          .set({
            webhookSubscriptionUri: sub.uri,
            webhookSigningKey: encryptCalendlyWebhookKey(signingKey),
            updatedAt: new Date(),
          })
          .where(eq(crmCalendlySettings.id, row.id));
        res.json({ ok: true, subscriptionUri: sub.uri, callbackUrl });
        return;
      } catch (err: any) {
        logger.warn({ err: err?.message, body: err?.body }, "[crm-calendly] subscribe failed");
        res.status(502).json({ error: "subscribe_failed", detail: err?.message });
        return;
      }
    },
  );

  // Manual 90-day backfill.
  r.post("/crm/calendly/resync", requireRole("admin", "leader"), async (_req, res) => {
    if (!isCalendlyConfigured()) {
      res.status(503).json({ error: "calendly_not_configured" });
      return;
    }
    try {
      const now = new Date();
      const min = new Date(now.getTime() - 90 * 24 * 3600_000);
      const max = new Date(now.getTime() + 60 * 24 * 3600_000);
      const events = await listScheduledEvents({
        minStartTime: min,
        maxStartTime: max,
      });
      let upserts = 0;
      let newContacts = 0;
      for (const ev of events) {
        const invitees = await listEventInvitees(ev.uri).catch(() => []);
        for (const inv of invitees) {
          const r = await upsertBookingFromCalendly(ev, inv, "manual_resync");
          if (r.upserted) upserts++;
          if (r.createdContact) newContacts++;
        }
      }
      res.json({ events: events.length, upserts, newContacts });
      return;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[crm-calendly] resync failed");
      res.status(502).json({ error: "resync_failed" });
      return;
    }
  });

  return r;
}

/**
 * Stage-change reactor. Called from the existing PATCH
 * /crm/contacts/:id/stage handler after the contact has been updated.
 * Runs side-effects in parallel and never throws back into the request
 * handler - we log and move on so a Calendly outage never rolls back a
 * legitimate stage move.
 */
export async function reactToStageChange(opts: {
  contactId: number;
  fromStageId: number | null;
  toStageId: number;
  byUserId: number | null;
}): Promise<void> {
  if (!isCalendlyConfigured()) return;
  try {
    const settings = await getCalendlySettingsRow();
    const cancelStages = Array.isArray(settings.cancelOnStageIds)
      ? settings.cancelOnStageIds
      : [];
    const isSendStage =
      settings.sendLinkStageId != null &&
      opts.toStageId === settings.sendLinkStageId;
    const isCancelStage = cancelStages.includes(opts.toStageId);
    if (!isSendStage && !isCancelStage) return;

    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.id, opts.contactId))
      .limit(1);
    if (!contact) return;

    if (isSendStage && settings.defaultEventTypeUri) {
      try {
        const link = await createSchedulingLink({
          ownerUri: settings.defaultEventTypeUri,
          maxEventCount: 1,
        });
        await db
          .update(crmContacts)
          .set({
            calendlySchedulingLink: {
              bookingUrl: link.booking_url,
              ownerUri: link.owner,
              createdAt: new Date().toISOString(),
              eventTypeUri: settings.defaultEventTypeUri,
            },
            updatedAt: new Date(),
          })
          .where(eq(crmContacts.id, opts.contactId));
        await db.insert(crmActivities).values({
          contactId: opts.contactId,
          userId: opts.byUserId,
          type: "booking_link_sent",
          subject: "Single-use Calendly booking link generated",
          body: link.booking_url,
        });
      } catch (err) {
        logger.warn(
          { err, contactId: opts.contactId },
          "[crm-calendly] createSchedulingLink failed during stage reaction",
        );
      }
    }

    if (isCancelStage) {
      try {
        const now = new Date();
        const future = await db
          .select()
          .from(crmCalendarEvents)
          .where(
            and(
              eq(crmCalendarEvents.contactId, opts.contactId),
              eq(crmCalendarEvents.status, "active"),
              gte(crmCalendarEvents.startTime, now),
            ),
          );
        for (const booking of future) {
          try {
            await cancelScheduledEvent(
              booking.calendlyEventUri,
              "Pipeline stage moved to a closed/lost state in CRM",
            );
            await db
              .update(crmCalendarEvents)
              .set({ status: "canceled", updatedAt: new Date() })
              .where(eq(crmCalendarEvents.id, booking.id));
            await db.insert(crmActivities).values({
              contactId: opts.contactId,
              userId: opts.byUserId,
              type: "meeting_canceled_by_stage",
              subject: booking.eventName ?? "Calendly meeting canceled by stage move",
              body: booking.calendlyEventUri,
            });
          } catch (err) {
            logger.warn(
              { err, eventUri: booking.calendlyEventUri },
              "[crm-calendly] cancelScheduledEvent failed during stage reaction",
            );
          }
        }
      } catch (err) {
        logger.warn({ err }, "[crm-calendly] cancel-on-stage sweep failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "[crm-calendly] reactToStageChange threw");
  }
}

export { runReconcilerOnce };
