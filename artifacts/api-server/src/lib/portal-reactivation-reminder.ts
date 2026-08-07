// Task #299: send a one-time reactivation reminder email to active buyers
// who received their invite / account-ready email but never actually
// signed in. The "Welcome to Room30 AI" email only fires the first time
// a buyer signs in, so silent buyers were getting no nudge between
// purchase and first login. This scheduler runs daily on the worker and
// emails any eligible row exactly once.
//
// Eligibility (enforced in the atomic UPDATE so concurrent passes / a
// rolling restart can never double-send):
//   - is_active = true
//   - role != 'admin'
//   - last_login_at IS NULL  (never signed in)
//   - reactivation_email_sent_at IS NULL  (idempotency)
//   - COALESCE(invited_at, created_at) was at least
//     REACTIVATION_MIN_AGE_DAYS ago and at most
//     REACTIVATION_MAX_AGE_DAYS ago. The lower bound gives the buyer a
//     few days to log in on their own; the upper bound prevents us from
//     blasting accounts that have been silently dormant for months.
//
// Refunded / deactivated accounts are excluded by `is_active = true` —
// the existing refund clawback flow already flips that flag to false.
//
// The email is plain and friendly; it links straight to the sign-in page.

import { sql } from "drizzle-orm";
import { db, portalUsersTable } from "@workspace/db";
import { getBrandBaseUrl } from "./brand-url";
import { sendEmail } from "./email";
import { type EmailBrand } from "./email-render";
import { logger } from "./logger";

// Every reactivation reminder renders as Room30 AI (Task #661). Legacy
// `"main"` rows still exist in portal_users for historical reasons but
// no longer select an Apex Offers shell.
type ReminderCopy = {
  appName: string;
  bullets: string[];
};

function signInUrl(): string {
  return `${getBrandBaseUrl()}/members/sign-in`;
}
const ROOM30_REMINDER_COPY: ReminderCopy = {
  appName: "AI Influencer Portfolio",
  bullets: [
    "The AI Influencer Portfolio masterclass, broken into bite-sized lessons.",
    "Your AI Influencer build with the tools to generate, edit and publish.",
    "AI + human support whenever you get stuck.",
  ],
};

function brandFromPortalKey(_portalKey: string | null | undefined): EmailBrand {
  return "room30";
}

// Task spec: nudge between 3 and 7 days after the invite went out. The
// max-age bound also acts as a safety ceiling so a long worker outage
// or a backfilled column can never blast accounts that have been
// dormant for weeks.
const REACTIVATION_MIN_AGE_DAYS = 3;
const REACTIVATION_MAX_AGE_DAYS = 7;

// Daily cadence. The scheduler self-reschedules so a slow pass cannot
// pile up overlapping timers (same pattern as ad-research-board-sync).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Run a few minutes after midnight UTC so it interleaves cleanly with
// the other daily syncs (3:30am for ad research, etc.) rather than
// piling onto the same wake.
function getMsUntilNext0215UTC(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 15, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function escapeHtmlSafe(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Eligible = {
  id: number;
  email: string;
  firstName: string | null;
  portalKey: string | null;
};

// Atomic claim. Sets reactivation_email_sent_at = now() on every row
// that still satisfies all eligibility predicates and returns the rows
// we won. Anything that races us (a concurrent worker, a sign-in that
// just landed, an admin promotion, a deactivation) drops out of the
// WHERE clause and is silently skipped.
async function claimEligibleUsers(): Promise<Eligible[]> {
  const claimed = await db
    .update(portalUsersTable)
    .set({ reactivationEmailSentAt: new Date() })
    .where(
      sql`${portalUsersTable.isActive} = true
        AND ${portalUsersTable.role} <> 'admin'
        AND ${portalUsersTable.lastLoginAt} IS NULL
        AND ${portalUsersTable.reactivationEmailSentAt} IS NULL
        AND COALESCE(${portalUsersTable.invitedAt}, ${portalUsersTable.createdAt})
            <= now() - (${REACTIVATION_MIN_AGE_DAYS} || ' days')::interval
        AND COALESCE(${portalUsersTable.invitedAt}, ${portalUsersTable.createdAt})
            >= now() - (${REACTIVATION_MAX_AGE_DAYS} || ' days')::interval
        AND ${portalUsersTable.email} IS NOT NULL
        AND ${portalUsersTable.email} NOT LIKE '%@portal.local'`,
    )
    .returning({
      id: portalUsersTable.id,
      email: portalUsersTable.email,
      firstName: portalUsersTable.firstName,
      portalKey: portalUsersTable.portalKey,
    });
  return claimed;
}

async function sendReminder(user: Eligible): Promise<void> {
  const brand = brandFromPortalKey(user.portalKey);
  const copy = ROOM30_REMINDER_COPY;
  const url = signInUrl();
  const firstName = (user.firstName || "").trim();
  const greeting = firstName
    ? `Hi ${firstName},`
    : "Hi there,";

  const bulletsText = copy.bullets.map((b) => `  - ${b}`).join("\n");
  const bulletsHtml = copy.bullets
    .map(
      (b) =>
        `<li style="margin:0 0 8px 0;">${escapeHtmlSafe(b)}</li>`,
    )
    .join("");

  const text = [
    greeting,
    "",
    `We noticed you have not signed into your ${copy.appName} account yet.`,
    "",
    "Everything you paid for is sitting in the members portal waiting for you:",
    "",
    bulletsText,
    "",
    "Sign in here and pick up where you left off:",
    url,
    "",
    "If you are having any trouble getting in, just reply to this email and we will sort it out.",
    "",
    `The ${copy.appName} team`,
  ].join("\n");

  const html = `
    <p style="margin:0 0 18px 0;">${escapeHtmlSafe(greeting)}</p>
    <p style="margin:0 0 18px 0;">We noticed you have not signed into your ${escapeHtmlSafe(copy.appName)} account yet.</p>
    <p style="margin:0 0 14px 0;">Everything you paid for is sitting in the members portal waiting for you:</p>
    <ul style="margin:0 0 22px 22px;padding:0;color:#E8E8E8;">
      ${bulletsHtml}
    </ul>
    <p style="margin:0 0 26px 0;">Sign in and pick up where you left off.</p>
    <p style="margin:0 0 26px 0;">
      <a href="${escapeHtmlSafe(url)}" style="display:inline-block;background:#C9A44C;color:#0A0A0A;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold;text-decoration:none;padding:14px 26px;border-radius:8px;">Sign in to my account</a>
    </p>
    <p style="margin:0;color:rgba(255,255,255,0.55);font-size:13px;">If you are having trouble getting in, just reply to this email and we will sort it out.</p>
  `.trim();

  try {
    await sendEmail({
      userId: user.id,
      email: user.email,
      subject: `Your ${copy.appName} account is waiting for you`,
      body: text,
      bodyHtml: html,
      brand,
      templateType: "portal_reactivation_reminder",
      metadata: { trigger: "scheduled_reactivation_reminder", brand },
    });
  } catch (err) {
    // The atomic UPDATE has already marked the row as sent. We accept
    // the (rare) failed-send case rather than risk duplicate emails on
    // retry; the failure is logged inside sendEmail() and surfaced in
    // email_logs.
    logger.warn(
      { err, userId: user.id },
      "[reactivation-reminder] sendEmail threw",
    );
  }
}

export async function runReactivationReminderPass(
  trigger: "boot" | "scheduled" | "manual" = "scheduled",
): Promise<{ sent: number }> {
  let users: Eligible[] = [];
  try {
    users = await claimEligibleUsers();
  } catch (err) {
    logger.error({ err, trigger }, "[reactivation-reminder] claim failed");
    return { sent: 0 };
  }
  if (users.length === 0) {
    logger.info({ trigger }, "[reactivation-reminder] no eligible buyers this pass");
    return { sent: 0 };
  }
  logger.info(
    { trigger, count: users.length },
    "[reactivation-reminder] sending reminders",
  );
  for (const user of users) {
    await sendReminder(user);
  }
  return { sent: users.length };
}

let scheduled = false;

export function startReactivationReminderScheduler(): void {
  if (scheduled) return;
  scheduled = true;

  // Best-effort one-shot pass shortly after boot so a long-restart gap
  // does not delay reminders by up to ~24h. Delay a minute so the rest
  // of the worker boot (DB pool warmup, etc.) settles first.
  setTimeout(() => {
    runReactivationReminderPass("boot").catch((err) =>
      logger.error({ err }, "[reactivation-reminder] boot pass failed"),
    );
  }, 60_000).unref?.();

  const scheduleNext = (): void => {
    const ms = getMsUntilNext0215UTC();
    logger.info(
      { nextRunIn: `${(ms / 3600000).toFixed(1)}h` },
      "[reactivation-reminder] scheduled next daily pass (02:15 UTC)",
    );
    const t = setTimeout(() => {
      runReactivationReminderPass("scheduled")
        .catch((err) =>
          logger.error({ err }, "[reactivation-reminder] scheduled pass failed"),
        )
        .finally(scheduleNext);
    }, ms);
    t.unref?.();
  };
  scheduleNext();

  // Defensive safety net: if the long timer ever drifts (process suspend,
  // clock skew), a 24h fallback interval ensures we still run roughly
  // once a day. The atomic UPDATE makes overlapping passes harmless.
  const fallback = setInterval(() => {
    runReactivationReminderPass("scheduled").catch((err) =>
      logger.error({ err }, "[reactivation-reminder] fallback pass failed"),
    );
  }, ONE_DAY_MS);
  fallback.unref?.();
}
