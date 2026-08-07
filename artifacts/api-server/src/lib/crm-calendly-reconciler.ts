// Task #608 - hourly Calendly reconciler. Lives in the Media Worker
// process (per replit.md runtime-layout rule) so a webhook outage does
// not leave the CRM blind to bookings.

import {
  db,
  crmCalendarEvents,
  crmCalendlySettings,
  crmContacts,
  crmActivities,
  crmPipelineStages,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  isCalendlyConfigured,
  listScheduledEvents,
  listEventInvitees,
  type CalendlyScheduledEvent,
  type CalendlyInvitee,
} from "./calendly";

const ONE_HOUR_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startCrmCalendlyReconciler(): void {
  if (process.env.MEDIA_WORKERS_DISABLED === "1") {
    logger.warn(
      "[crm-calendly] MEDIA_WORKERS_DISABLED=1; skipping reconciler",
    );
    return;
  }
  if (timer) return;
  // First tick a minute after boot so we don't fight other startup work,
  // then hourly. tick() guards on isCalendlyConfigured() internally.
  timer = setTimeout(function tick() {
    runOnce()
      .catch((err) =>
        logger.error({ err }, "[crm-calendly] reconciler tick failed"),
      )
      .finally(() => {
        timer = setTimeout(tick, ONE_HOUR_MS);
      });
  }, 60_000);
}

export async function runOnce(): Promise<{
  events: number;
  newContacts: number;
  upserts: number;
  windowDays?: number;
}> {
  if (!isCalendlyConfigured()) {
    return { events: 0, newContacts: 0, upserts: 0 };
  }
  const now = new Date();
  const minStartTime = new Date(now.getTime() - 7 * 24 * ONE_HOUR_MS);
  const maxStartTime = new Date(now.getTime() + 30 * 24 * ONE_HOUR_MS);
  const events = await listScheduledEvents({ minStartTime, maxStartTime });
  let newContacts = 0;
  let upserts = 0;
  // Bookings the reconciler had to insert from scratch are bookings the
  // webhook never delivered. Track them separately and log a clear
  // "webhook missed N events" line so a Calendly webhook outage shows
  // up in routine ops without staring at counts.
  let missedByWebhook = 0;
  for (const ev of events) {
    try {
      const invitees = await listEventInvitees(ev.uri).catch((err) => {
        logger.warn(
          { err, uri: ev.uri },
          "[crm-calendly] listEventInvitees failed",
        );
        return [] as CalendlyInvitee[];
      });
      for (const inv of invitees) {
        const result = await upsertBookingFromCalendly(ev, inv, "reconciler");
        if (result.upserted) upserts++;
        if (result.createdContact) newContacts++;
        if (result.isNew) missedByWebhook++;
      }
    } catch (err) {
      logger.warn(
        { err, eventUri: ev.uri },
        "[crm-calendly] event processing failed",
      );
    }
  }
  if (events.length > 0) {
    logger.info(
      { events: events.length, upserts, newContacts, missedByWebhook },
      "[crm-calendly] reconciler swept window",
    );
  }
  if (missedByWebhook > 0) {
    logger.warn(
      { missedByWebhook, events: events.length },
      `[crm-calendly] webhook missed ${missedByWebhook} events in last sweep`,
    );
  }
  return { events: events.length, newContacts, upserts, windowDays: 37 };
}

/**
 * Upsert one booking row + matching contact + activity. Idempotent on
 * `calendly_invitee_uri`. Returns whether anything was changed.
 */
export async function upsertBookingFromCalendly(
  ev: CalendlyScheduledEvent,
  inv: CalendlyInvitee,
  source: "webhook" | "reconciler" | "manual_resync",
): Promise<{
  upserted: boolean;
  createdContact: boolean;
  contactId: number | null;
  isNew: boolean;
}> {
  const email = (inv.email || "").trim().toLowerCase();
  let contactId: number | null = null;
  let createdContact = false;

  if (email) {
    const [existing] = await db
      .select()
      .from(crmContacts)
      .where(sql`lower(${crmContacts.email}) = ${email}`)
      .limit(1);
    if (existing) {
      contactId = existing.id;
    } else {
      const [stage] = await db
        .select()
        .from(crmPipelineStages)
        .orderBy(crmPipelineStages.sortOrder)
        .limit(1);
      const firstName = inv.first_name || splitName(inv.name).first;
      const lastName = inv.last_name || splitName(inv.name).last;
      try {
        const [inserted] = await db
          .insert(crmContacts)
          .values({
            email: inv.email,
            firstName,
            lastName,
            source: "calendly",
            stageId: stage?.id ?? null,
            lastActivityAt: new Date(),
          })
          .returning();
        contactId = inserted.id;
        createdContact = true;
      } catch (err) {
        // Race: another upsert created it concurrently. Re-select.
        const [retry] = await db
          .select()
          .from(crmContacts)
          .where(sql`lower(${crmContacts.email}) = ${email}`)
          .limit(1);
        contactId = retry?.id ?? null;
      }
    }
  }

  const status =
    inv.status === "canceled" || ev.status === "canceled"
      ? "canceled"
      : "active";

  const startTime = new Date(ev.start_time);
  const endTime = ev.end_time ? new Date(ev.end_time) : null;

  const [existingBooking] = await db
    .select()
    .from(crmCalendarEvents)
    .where(eq(crmCalendarEvents.calendlyInviteeUri, inv.uri))
    .limit(1);

  let upserted = false;
  let isNew = false;
  let priorStatus: string | null = null;

  if (existingBooking) {
    priorStatus = existingBooking.status;
    const needsUpdate =
      existingBooking.status !== status ||
      existingBooking.contactId !== contactId ||
      existingBooking.startTime?.getTime() !== startTime.getTime() ||
      (existingBooking.endTime?.getTime() ?? null) !==
        (endTime ? endTime.getTime() : null);
    if (needsUpdate) {
      await db
        .update(crmCalendarEvents)
        .set({
          contactId,
          status,
          startTime,
          endTime,
          rescheduleUrl: inv.reschedule_url,
          cancelUrl: inv.cancel_url,
          rawPayload: { event: ev, invitee: inv, source },
          updatedAt: new Date(),
        })
        .where(eq(crmCalendarEvents.id, existingBooking.id));
      upserted = true;
    }
  } else {
    await db.insert(crmCalendarEvents).values({
      contactId,
      calendlyEventUri: ev.uri,
      calendlyInviteeUri: inv.uri,
      eventTypeUri: ev.event_type,
      eventName: ev.name,
      inviteeEmail: inv.email,
      inviteeName: inv.name,
      startTime,
      endTime,
      status,
      rescheduleUrl: inv.reschedule_url,
      cancelUrl: inv.cancel_url,
      rawPayload: { event: ev, invitee: inv, source },
    });
    upserted = true;
    isNew = true;
  }

  // Activity rows: write `meeting_booked` on first sight, and
  // `meeting_canceled` if status flipped from active to canceled.
  if (contactId) {
    if (isNew && status === "active") {
      await db.insert(crmActivities).values({
        contactId,
        type: "meeting_booked",
        subject: ev.name || "Calendly meeting booked",
        body: formatActivityBody(ev, inv),
      });
      await db
        .update(crmContacts)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(crmContacts.id, contactId));
    } else if (
      priorStatus === "active" &&
      status === "canceled"
    ) {
      await db.insert(crmActivities).values({
        contactId,
        type: "meeting_canceled",
        subject: ev.name || "Calendly meeting canceled",
        body: formatActivityBody(ev, inv),
      });
      await db
        .update(crmContacts)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(crmContacts.id, contactId));
    }
  }

  return { upserted, createdContact, contactId, isNew };
}

function splitName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function formatActivityBody(
  ev: CalendlyScheduledEvent,
  inv: CalendlyInvitee,
): string {
  const lines = [
    `Event: ${ev.name ?? "(unnamed)"}`,
    `When: ${ev.start_time}`,
    `Invitee: ${inv.name ?? "(no name)"} <${inv.email}>`,
    `Reschedule: ${inv.reschedule_url}`,
    `Cancel: ${inv.cancel_url}`,
  ];
  return lines.join("\n");
}

/** Read (or lazily create) the singleton settings row. */
export async function getCalendlySettingsRow() {
  const [row] = await db
    .select()
    .from(crmCalendlySettings)
    .orderBy(crmCalendlySettings.id)
    .limit(1);
  if (row) return row;
  const [inserted] = await db
    .insert(crmCalendlySettings)
    .values({})
    .returning();
  return inserted;
}
