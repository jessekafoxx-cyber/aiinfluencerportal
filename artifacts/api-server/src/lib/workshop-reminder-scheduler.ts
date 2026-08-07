// Platinum Club workshop reminder scheduler.
//
// Sends two automated email blasts to every Platinum Club member for
// every scheduled live workshop:
//   1. 24h before startsAt (notice + portal link, no Zoom link inline)
//   2. 15m before startsAt (Zoom link inline as the primary CTA)
//
// Cadence: runs every 5 minutes from the Media Worker. Each tick
// looks for workshops whose startsAt falls in a wide window around
// the trigger time and whose corresponding reminder_*_sent_at column
// is still NULL. The column is flipped via an atomic
// `UPDATE ... WHERE reminder_*_sent_at IS NULL RETURNING *` so two
// worker processes during a rolling restart cannot double-blast.
//
// Recipient set: every distinct lower(email) on `orders` where
// (platinumPaid OR upsell3Paid) is true AND the grant has not been
// revoked. Mirrors the kit-backfill / wati-backfill aggregation so
// the same buyers KIT/WATI sees as "platinum-club" tagged are the
// ones who get the workshop emails.
//
// Sender: `Greg from Room30 <hello@users.room30.ai>` with replyTo
// `hello@room30.ai`. Sending from the verified users.room30.ai
// subdomain (per replit.md) so Resend accepts the From line.
//
// Kill switch: WORKSHOP_REMINDERS_DISABLED=1.
// Cadence override: WORKSHOP_REMINDERS_INTERVAL_MS (default 5 min,
// floor 60s).

import { and, eq, gt, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, liveWorkshopsTable, ordersTable, portalUsersTable, type LiveWorkshop } from "@workspace/db";
import { getBrandBaseUrl } from "./brand-url";
import { logger } from "./logger";
import { sendEmail } from "./email";
import { escapeHtml } from "./email-render";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 30 * 1000;
// Due-by semantics (NOT a strict trigger window). A reminder is
// "due" once `now >= startsAt - leadTime` AND startsAt has not yet
// passed (with a small grace so a workshop that started 1-2 min ago
// still triggers its 15m reminder if the worker was momentarily
// down). The atomic `UPDATE WHERE reminder_*_sent_at IS NULL` claim
// guarantees the blast still goes out at most once. This survives
// worker downtime that would have skipped a strict ±10m window,
// and also picks up workshops that get created <24h before startsAt
// (those still get the 24h reminder on the next tick instead of
// silently missing it).
const PAST_GRACE_MS = 5 * 60 * 1000;

const FROM_EMAIL = 'AI Influencer Portfolio <hello@users.room30.ai>';
const REPLY_TO = 'hello@room30.ai';

function portalWorkshopsUrl(): string {
  return `${getBrandBaseUrl()}/members/platinum-club?tab=workshops`;
}
const SEND_THROTTLE_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let started = false;
let timer: NodeJS.Timeout | null = null;

function readIntervalMs(): number {
  const raw = process.env["WORKSHOP_REMINDERS_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_INTERVAL_MS;
  return n;
}

interface PlatinumMember {
  email: string;
  firstName: string | null;
}

// Returns every distinct lower(email) on orders that currently has
// Platinum Club access (platinumPaid OR upsell3Paid) AND has not
// been fully revoked. First name is sourced from portal_users via a
// secondary lookup (orders has no name column).
async function listPlatinumMembers(): Promise<PlatinumMember[]> {
  const rows = await db
    .select({
      email: sql<string>`lower(${ordersTable.email})`,
      revoked: sql<boolean>`bool_and(coalesce(${ordersTable.grantReason}, '') LIKE 'revoked:%')`,
    })
    .from(ordersTable)
    .where(
      and(
        isNotNull(ordersTable.email),
        ne(ordersTable.email, ''),
        or(eq(ordersTable.platinumPaid, true), eq(ordersTable.upsell3Paid, true)),
      ),
    )
    .groupBy(sql`lower(${ordersTable.email})`);

  const eligible = rows.filter(
    (r) => r.email && /^\S+@\S+\.\S+$/.test(r.email) && !r.revoked,
  );
  if (eligible.length === 0) return [];

  const nameRows = await db
    .select({
      email: sql<string>`lower(${portalUsersTable.email})`,
      firstName: sql<string | null>`max(${portalUsersTable.firstName})`,
    })
    .from(portalUsersTable)
    .where(isNotNull(portalUsersTable.email))
    .groupBy(sql`lower(${portalUsersTable.email})`);
  const nameByEmail = new Map<string, string | null>();
  for (const n of nameRows) {
    if (n.email) nameByEmail.set(n.email, n.firstName);
  }

  return eligible.map((r) => ({
    email: r.email,
    firstName: nameByEmail.get(r.email) ?? null,
  }));
}

function formatWorkshopDateTime(startsAt: Date): {
  longDate: string;
  shortDate: string;
  timeUk: string;
} {
  // Render in Europe/London since the portal admin schedules
  // workshops in UK time (Greg's local) and the column is stored
  // as a naive timestamp matching what the admin entered.
  const longDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(startsAt);
  const shortDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  }).format(startsAt);
  const timeUk = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }).format(startsAt);
  return { longDate, shortDate, timeUk };
}

function ctaButtonHtml(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#C9A44C" style="border-radius:10px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:16px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#0A0A0A;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;border-radius:10px;">${escapeHtml(label)}</a></td></tr></table>`;
}

function build24hBody(opts: {
  firstName: string | null;
  title: string;
  longDate: string;
  timeUk: string;
  durationMinutes: number;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hey ${escapeHtml(opts.firstName)},` : 'Hey,';
  const subject = `Your Platinum Club workshop is tomorrow - ${opts.title}`;
  const text =
    `${opts.firstName ? `Hey ${opts.firstName},` : 'Hey,'}\n\n` +
    `Quick heads-up - your next Platinum Club workshop is happening tomorrow.\n\n` +
    `Workshop: ${opts.title}\n` +
    `When: ${opts.longDate} at ${opts.timeUk} UK time\n` +
    `Length: ${opts.durationMinutes} minutes\n\n` +
    `The Zoom link is inside the portal under Platinum Club > Workshops. Just click Join Live Call on the workshop card when it's time.\n\n` +
    `${portalWorkshopsUrl()}\n\n` +
    `See you on the call.\n\n` +
    `- The AI Influencer Portfolio team`;
  const html =
    `<p>${greeting}</p>` +
    `<p>Quick heads-up - your next <strong>Platinum Club workshop</strong> is happening <strong>tomorrow</strong>.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background:#0F0F0F;border:1px solid rgba(201,164,76,0.30);border-radius:10px;padding:18px 22px;"><tr><td>` +
    `<p style="margin:0 0 8px 0;color:#C9A44C;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;">Next Live Workshop</p>` +
    `<p style="margin:0 0 10px 0;color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(opts.title)}</p>` +
    `<p style="margin:0;color:#E8E8E8;font-size:14px;line-height:1.6;">${escapeHtml(opts.longDate)} at <strong>${escapeHtml(opts.timeUk)}</strong> UK time<br/>${opts.durationMinutes} minutes</p>` +
    `</td></tr></table>` +
    `<p>The Zoom link is inside the portal under <strong>Platinum Club &rsaquo; Workshops</strong>. Click <strong>Join Live Call</strong> on the workshop card when it's time.</p>` +
    ctaButtonHtml(portalWorkshopsUrl(), 'Open Workshops In Portal') +
    `<p>I'll send another reminder 15 minutes before we go live, with the Zoom link right in the email.</p>` +
    `<p>See you on the call.</p>` +
    `<p>- The AI Influencer Portfolio team</p>`;
  return { subject, text, html };
}

function build15mBody(opts: {
  firstName: string | null;
  title: string;
  timeUk: string;
  meetingUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.firstName ? `Hey ${escapeHtml(opts.firstName)},` : 'Hey,';
  const subject = `Starting in 15 minutes - Zoom link inside`;
  const text =
    `${opts.firstName ? `Hey ${opts.firstName},` : 'Hey,'}\n\n` +
    `We're starting the Platinum Club workshop in 15 minutes (${opts.timeUk} UK time).\n\n` +
    `Workshop: ${opts.title}\n\n` +
    `Zoom link: ${opts.meetingUrl}\n\n` +
    `See you in a few.\n\n` +
    `- The AI Influencer Portfolio team`;
  const html =
    `<p>${greeting}</p>` +
    `<p>We're starting the <strong>Platinum Club workshop</strong> in <strong>15 minutes</strong> (${escapeHtml(opts.timeUk)} UK time).</p>` +
    `<p style="margin:18px 0 6px 0;color:#C9A44C;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;">Workshop</p>` +
    `<p style="margin:0 0 18px 0;color:#ffffff;font-size:17px;font-weight:bold;">${escapeHtml(opts.title)}</p>` +
    ctaButtonHtml(opts.meetingUrl, 'Join The Zoom Call') +
    `<p style="margin:18px 0;color:#9a9a9a;font-size:13px;word-break:break-all;">Or copy this link into your browser:<br/><a href="${escapeHtml(opts.meetingUrl)}" style="color:#C9A44C;">${escapeHtml(opts.meetingUrl)}</a></p>` +
    `<p>See you in a few.</p>` +
    `<p>- The AI Influencer Portfolio team</p>`;
  return { subject, text, html };
}

async function claimWorkshop(
  workshopId: number,
  column: 'reminder24hSentAt' | 'reminder15mSentAt',
): Promise<LiveWorkshop | null> {
  // Atomic claim: only one worker (or rolling-restart sibling) can
  // flip the sent-at column for a given workshop.
  const targetCol = column === 'reminder24hSentAt'
    ? liveWorkshopsTable.reminder24hSentAt
    : liveWorkshopsTable.reminder15mSentAt;
  const rows = await db
    .update(liveWorkshopsTable)
    .set(column === 'reminder24hSentAt'
      ? { reminder24hSentAt: new Date() }
      : { reminder15mSentAt: new Date() })
    .where(and(eq(liveWorkshopsTable.id, workshopId), isNull(targetCol)))
    .returning();
  return rows[0] ?? null;
}

export interface SendWorkshopReminderResult {
  workshopId: number;
  kind: '24h' | '15m';
  sent: number;
  failed: number;
  recipients: number;
}

async function sendReminderForWorkshop(
  workshop: LiveWorkshop,
  kind: '24h' | '15m',
): Promise<SendWorkshopReminderResult> {
  const members = await listPlatinumMembers();
  const { longDate, timeUk } = formatWorkshopDateTime(workshop.startsAt);

  let sent = 0;
  let failed = 0;
  const templateType = kind === '24h' ? 'workshop_reminder_24h' : 'workshop_reminder_15m';

  for (const m of members) {
    const body = kind === '24h'
      ? build24hBody({
          firstName: m.firstName,
          title: workshop.title,
          longDate,
          timeUk,
          durationMinutes: workshop.durationMinutes,
        })
      : build15mBody({
          firstName: m.firstName,
          title: workshop.title,
          timeUk,
          meetingUrl: workshop.meetingUrl,
        });

    try {
      const result = await sendEmail({
        email: m.email,
        subject: body.subject,
        body: body.text,
        bodyHtml: body.html,
        templateType,
        from: FROM_EMAIL,
        replyTo: REPLY_TO,
        metadata: {
          workshopId: workshop.id,
          workshopTitle: workshop.title,
          startsAt: workshop.startsAt.toISOString(),
          kind,
        },
      });
      if (result.status === 'sent') sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, workshopId: workshop.id, email: m.email, kind },
        '[workshop-reminders] send failed',
      );
    }
    await sleep(SEND_THROTTLE_MS);
  }

  logger.info(
    { workshopId: workshop.id, title: workshop.title, kind, recipients: members.length, sent, failed },
    '[workshop-reminders] blast complete',
  );

  return { workshopId: workshop.id, kind, sent, failed, recipients: members.length };
}

async function runOnce(): Promise<void> {
  const now = Date.now();
  // 24h reminder is due once startsAt is <=24h away AND still
  // sufficiently in the future that this is meaningfully a "tomorrow"
  // notice (not the 15m one). Past-grace lets a momentarily-down
  // worker catch a workshop that just started.
  const t24DueBefore = new Date(now + 24 * 60 * 60 * 1000);
  const t24NotAfter = new Date(now + 20 * 60 * 1000); // skip if <20m out (let 15m own it)
  const earliestValidStartsAt = new Date(now - PAST_GRACE_MS);

  // 15m reminder is due once startsAt is <=15m away. Same past-grace
  // so a worker that was down 1-2m past startsAt still fires.
  const t15DueBefore = new Date(now + 15 * 60 * 1000);

  const dueFor24h = await db
    .select()
    .from(liveWorkshopsTable)
    .where(
      and(
        isNull(liveWorkshopsTable.reminder24hSentAt),
        lte(liveWorkshopsTable.startsAt, t24DueBefore),
        gte(liveWorkshopsTable.startsAt, t24NotAfter),
      ),
    );

  const dueFor15m = await db
    .select()
    .from(liveWorkshopsTable)
    .where(
      and(
        isNull(liveWorkshopsTable.reminder15mSentAt),
        lte(liveWorkshopsTable.startsAt, t15DueBefore),
        gte(liveWorkshopsTable.startsAt, earliestValidStartsAt),
      ),
    );

  for (const w of dueFor24h) {
    const claimed = await claimWorkshop(w.id, 'reminder24hSentAt');
    if (!claimed) continue; // sibling worker won the race
    try {
      await sendReminderForWorkshop(claimed, '24h');
    } catch (err) {
      logger.error({ err, workshopId: w.id }, '[workshop-reminders] 24h blast threw');
    }
  }

  for (const w of dueFor15m) {
    const claimed = await claimWorkshop(w.id, 'reminder15mSentAt');
    if (!claimed) continue;
    try {
      await sendReminderForWorkshop(claimed, '15m');
    } catch (err) {
      logger.error({ err, workshopId: w.id }, '[workshop-reminders] 15m blast threw');
    }
  }
}

function arm(intervalMs: number): void {
  timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error({ err }, '[workshop-reminders] tick threw');
    }
    arm(intervalMs);
  }, intervalMs);
  timer.unref?.();
}

export function startWorkshopReminderScheduler(): void {
  if (started) return;
  if (process.env["WORKSHOP_REMINDERS_DISABLED"] === '1') {
    logger.warn('WORKSHOP_REMINDERS_DISABLED=1 set; workshop reminder scheduler will not start');
    return;
  }
  started = true;
  const intervalMs = readIntervalMs();
  logger.info({ intervalMs, firstDelayMs: FIRST_DELAY_MS }, 'workshop reminder scheduler started');
  const first = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error({ err }, '[workshop-reminders] first tick threw');
    }
    arm(intervalMs);
  }, FIRST_DELAY_MS);
  first.unref?.();
}

export function stopWorkshopReminderScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
}

// One-shot "starts in ~N minutes - Zoom link inside" blast used when
// we need to force the 15m reminder out manually (e.g. workshop is
// imminent and the 5-min scheduler tick hasn't fired yet, or we
// missed the window). Atomically claims reminder_15m_sent_at so the
// regular scheduler won't double-send. Picks the next upcoming
// workshop (earliest startsAt in the future, with a small past-grace
// so a workshop that started 1-2m ago still triggers).
export async function sendImmediate15mReminder(opts?: {
  onlyEmails?: string[];
}): Promise<{
  workshopId: number;
  workshopTitle: string;
  startsAt: string;
  recipients: number;
  sent: number;
  failed: number;
  alreadySent?: boolean;
} | { error: string }> {
  const now = new Date();
  const earliestValidStartsAt = new Date(now.getTime() - PAST_GRACE_MS);
  const upcoming = await db
    .select()
    .from(liveWorkshopsTable)
    .where(gte(liveWorkshopsTable.startsAt, earliestValidStartsAt))
    .orderBy(liveWorkshopsTable.startsAt)
    .limit(1);
  const workshop = upcoming[0];
  if (!workshop) return { error: 'no_upcoming_workshop' };

  const claimed = await claimWorkshop(workshop.id, 'reminder15mSentAt');
  if (!claimed) {
    return {
      workshopId: workshop.id,
      workshopTitle: workshop.title,
      startsAt: workshop.startsAt.toISOString(),
      recipients: 0,
      sent: 0,
      failed: 0,
      alreadySent: true,
    };
  }

  // Reuse the standard 15m template so wording matches what buyers
  // already expect from the scheduled blast.
  const allMembers = await listPlatinumMembers();
  const filter = opts?.onlyEmails
    ? new Set(opts.onlyEmails.map((e) => e.trim().toLowerCase()))
    : null;
  const members = filter ? allMembers.filter((m) => filter.has(m.email)) : allMembers;
  const { timeUk } = formatWorkshopDateTime(claimed.startsAt);

  let sent = 0;
  let failed = 0;
  for (const m of members) {
    const body = build15mBody({
      firstName: m.firstName,
      title: claimed.title,
      timeUk,
      meetingUrl: claimed.meetingUrl,
    });
    try {
      const result = await sendEmail({
        email: m.email,
        subject: body.subject,
        body: body.text,
        bodyHtml: body.html,
        templateType: 'workshop_reminder_15m',
        from: FROM_EMAIL,
        replyTo: REPLY_TO,
        metadata: {
          workshopId: claimed.id,
          workshopTitle: claimed.title,
          startsAt: claimed.startsAt.toISOString(),
          kind: '15m',
          source: 'immediate_manual_blast',
        },
      });
      if (result.status === 'sent') sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, workshopId: claimed.id, email: m.email },
        '[workshop-reminders] immediate 15m send failed',
      );
    }
    await sleep(SEND_THROTTLE_MS);
  }

  logger.info(
    { workshopId: claimed.id, recipients: members.length, sent, failed },
    '[workshop-reminders] immediate 15m blast complete',
  );

  return {
    workshopId: claimed.id,
    workshopTitle: claimed.title,
    startsAt: claimed.startsAt.toISOString(),
    recipients: members.length,
    sent,
    failed,
  };
}

// One-shot blast helper used by the immediate "tomorrow's workshop"
// announcement script. Picks the next upcoming workshop (startsAt in
// the future), composes a one-off announcement (NOT the regular 24h
// template), and sends to every Platinum member. Does not touch the
// reminder_*_sent_at idempotency columns - this is an out-of-band
// notice and the 24h scheduler will still fire on its own window.
export async function sendImmediateUpcomingWorkshopBlast(opts?: {
  onlyEmails?: string[];
}): Promise<{
  workshopId: number;
  workshopTitle: string;
  startsAt: string;
  recipients: number;
  sent: number;
  failed: number;
} | { error: string }> {
  const now = new Date();
  const upcoming = await db
    .select()
    .from(liveWorkshopsTable)
    .where(gt(liveWorkshopsTable.startsAt, now))
    .orderBy(liveWorkshopsTable.startsAt)
    .limit(1);
  const workshop = upcoming[0];
  if (!workshop) return { error: 'no_upcoming_workshop' };

  const allMembers = await listPlatinumMembers();
  const filter = opts?.onlyEmails
    ? new Set(opts.onlyEmails.map((e) => e.trim().toLowerCase()))
    : null;
  const members = filter ? allMembers.filter((m) => filter.has(m.email)) : allMembers;
  const { longDate, timeUk } = formatWorkshopDateTime(workshop.startsAt);

  let sent = 0;
  let failed = 0;
  for (const m of members) {
    const greeting = m.firstName ? `Hey ${escapeHtml(m.firstName)},` : 'Hey,';
    const subject = `Your first live Platinum Club workshop`;
    const text =
      `${m.firstName ? `Hey ${m.firstName},` : 'Hey,'}\n\n` +
      `Quick one - our first live Platinum Club workshop is happening soon.\n\n` +
      `Workshop: ${workshop.title}\n` +
      `When: ${longDate} at ${timeUk} UK time\n` +
      `Length: ${workshop.durationMinutes} minutes\n\n` +
      `The Zoom link is inside the portal under Platinum Club > Workshops. Click Join Live Call on the workshop card when it's time.\n\n` +
      `${portalWorkshopsUrl()}\n\n` +
      `I'll also send you a reminder 15 minutes before we go live with the Zoom link right in the email, so you can't miss it.\n\n` +
      `See you on the call.\n\n` +
      `- The AI Influencer Portfolio team`;
    const html =
      `<p>${greeting}</p>` +
      `<p>Quick one - our <strong>first live Platinum Club workshop</strong> is happening soon.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;background:#0F0F0F;border:1px solid rgba(201,164,76,0.30);border-radius:10px;padding:18px 22px;"><tr><td>` +
      `<p style="margin:0 0 8px 0;color:#C9A44C;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;">Next Live Workshop</p>` +
      `<p style="margin:0 0 10px 0;color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(workshop.title)}</p>` +
      `<p style="margin:0;color:#E8E8E8;font-size:14px;line-height:1.6;">${escapeHtml(longDate)} at <strong>${escapeHtml(timeUk)}</strong> UK time<br/>${workshop.durationMinutes} minutes</p>` +
      `</td></tr></table>` +
      `<p>The Zoom link is inside the portal under <strong>Platinum Club &rsaquo; Workshops</strong>. Click <strong>Join Live Call</strong> on the workshop card when it's time.</p>` +
      ctaButtonHtml(portalWorkshopsUrl(), 'Open Workshops In Portal') +
      `<p>I'll also drop a reminder in your inbox 15 minutes before we go live with the Zoom link right in the email, so you can't miss it.</p>` +
      `<p>See you on the call.</p>` +
      `<p>- The AI Influencer Portfolio team</p>`;

    try {
      const result = await sendEmail({
        email: m.email,
        subject,
        body: text,
        bodyHtml: html,
        templateType: 'workshop_first_announcement',
        from: FROM_EMAIL,
        replyTo: REPLY_TO,
        metadata: {
          workshopId: workshop.id,
          workshopTitle: workshop.title,
          startsAt: workshop.startsAt.toISOString(),
          kind: 'first_announcement',
        },
      });
      if (result.status === 'sent') sent += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, workshopId: workshop.id, email: m.email },
        '[workshop-reminders] first-announcement send failed',
      );
    }
    await sleep(SEND_THROTTLE_MS);
  }

  return {
    workshopId: workshop.id,
    workshopTitle: workshop.title,
    startsAt: workshop.startsAt.toISOString(),
    recipients: members.length,
    sent,
    failed,
  };
}
