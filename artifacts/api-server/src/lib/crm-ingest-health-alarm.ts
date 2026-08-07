// Task #647 - CRM ingest health alarm.
//
// `enqueueCrmContact()` is fire-and-forget by design: any DB error is
// logged at WARN and swallowed so checkout / sign-in is never blocked.
// The downside is that if the mirror starts failing for every row
// (schema drift, missing pipeline stage, DB perms), nothing visible
// breaks until contact counts diverge again. This scheduler watches
// that delta and pages ops within the hour.
//
// What it does on every tick (default every 15 minutes):
//   1. Counts distinct emails that ought to be in `crm_contacts` for
//      the trailing window:
//        - `coaching_agreements.paid_at` within the window
//        - `portal_users.created_at` within the window (active rows)
//        - `orders.created_at` within the window where main_product_paid
//   2. Counts how many of those emails actually have a `crm_contacts`
//      row (matched case-insensitively).
//   3. If the missing delta exceeds CRM_INGEST_ALARM_THRESHOLD (default
//      5) AND it sustains across two consecutive ticks, logs ERROR,
//      writes a sync_sessions alarm row, and emails the operator.
//
// Note on semantics: step 2 checks email *existence* in crm_contacts
// rather than counting `crm_contacts.created_at` rows inside the same
// window. This is intentional - an operator who runs
// `crm:backfill-contacts --apply` to repair a gap inserts rows with a
// fresh created_at, so a strict same-window count would keep firing
// for an hour even after the gap is closed. Existence-coverage clears
// as soon as the mirror catches up.
//
// Anti-spam: at most one alert email per ALARM_REPEAT_HOURS (default 6).
// Cold-start grace: first ALARM_QUIET_HOURS (default 1) after worker
// boot the alarm is suppressed. Kill switch: CRM_INGEST_ALARM_DISABLED=1.

import { desc, eq, sql } from "drizzle-orm";
import { db, syncSessions } from "@workspace/db";
import { logger } from "./logger";
import { sendEmail } from "./email";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_DELAY_MS = 2 * 60 * 1000;
const ALARM_QUIET_HOURS = 1;
const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 5;
const ALARM_REPEAT_HOURS = 6;
const CONSECUTIVE_TICKS_REQUIRED = 2;

const ALARM_BOARD = "crm-ingest-health";

let started = false;
let timer: NodeJS.Timeout | null = null;
let consecutiveHits = 0;
const bootAt = Date.now();

function adminEmail(): string {
  return (
    process.env.CRM_INGEST_ALARM_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "greg@cookemedia.io"
  ).trim();
}

function thresholdFromEnv(): number {
  const raw = process.env.CRM_INGEST_ALARM_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_THRESHOLD;
}

export interface CrmIngestHealthSample {
  windowMs: number;
  windowStart: Date;
  windowEnd: Date;
  expectedEmails: number;
  presentEmails: number;
  missingEmails: number;
  missingSample: string[];
  perSource: {
    coaching: number;
    portalUsers: number;
    orders: number;
  };
}

/**
 * Run the join the alarm + one-shot script share. Counts distinct
 * source emails from the trailing window and how many already exist in
 * crm_contacts. Exported so `scripts/src/crm-ingest-health-check.ts`
 * can reuse the exact same SQL.
 */
export async function sampleCrmIngestHealth(
  windowMs: number = WINDOW_MS,
  sampleLimit: number = 10,
): Promise<CrmIngestHealthSample> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowMs);

  const rows = await db.execute<{
    expected: number;
    present: number;
    missing_sample: string[] | null;
    coaching: number;
    portal_users: number;
    orders: number;
  }>(sql`
    WITH expected AS (
      SELECT lower(email) AS email, 'coaching'::text AS src
        FROM coaching_agreements
       WHERE email IS NOT NULL
         AND paid_at IS NOT NULL
         AND paid_at >= ${windowStart}
         AND paid_at <  ${windowEnd}
      UNION
      SELECT lower(email) AS email, 'portal_users'::text AS src
        FROM portal_users
       WHERE email IS NOT NULL
         AND is_active = true
         AND created_at >= ${windowStart}
         AND created_at <  ${windowEnd}
      UNION
      SELECT lower(email) AS email, 'orders'::text AS src
        FROM orders
       WHERE email IS NOT NULL
         AND main_product_paid = true
         AND created_at >= ${windowStart}
         AND created_at <  ${windowEnd}
    ),
    distinct_expected AS (
      SELECT DISTINCT email FROM expected
    ),
    joined AS (
      SELECT e.email,
             EXISTS (
               SELECT 1 FROM crm_contacts c
                WHERE lower(c.email) = e.email
             ) AS present
        FROM distinct_expected e
    )
    SELECT
      (SELECT count(*)::int FROM distinct_expected)                                 AS expected,
      (SELECT count(*)::int FROM joined WHERE present)                              AS present,
      (SELECT coalesce(array_agg(email ORDER BY email), ARRAY[]::text[])
         FROM (SELECT email FROM joined WHERE NOT present ORDER BY email LIMIT ${sampleLimit}) s
      )                                                                              AS missing_sample,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'coaching')      AS coaching,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'portal_users')  AS portal_users,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'orders')        AS orders
  `);

  const r = (rows.rows as Array<Record<string, unknown>>)[0] ?? {};
  const expected = Number(r.expected || 0);
  const present = Number(r.present || 0);
  const missingSample = Array.isArray(r.missing_sample)
    ? (r.missing_sample as string[])
    : [];

  return {
    windowMs,
    windowStart,
    windowEnd,
    expectedEmails: expected,
    presentEmails: present,
    missingEmails: Math.max(0, expected - present),
    missingSample,
    perSource: {
      coaching: Number(r.coaching || 0),
      portalUsers: Number(r.portal_users || 0),
      orders: Number(r.orders || 0),
    },
  };
}

async function lastAlarmAt(): Promise<Date | null> {
  try {
    const rows = await db
      .select({ at: syncSessions.completedAt })
      .from(syncSessions)
      .where(eq(syncSessions.board, ALARM_BOARD))
      .orderBy(desc(syncSessions.completedAt))
      .limit(1);
    return rows[0]?.at ?? null;
  } catch {
    return null;
  }
}

async function recordAlarmFired(detail: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(syncSessions).values({
      board: ALARM_BOARD,
      trigger: "scheduler",
      status: "completed",
      completedAt: new Date(),
      buildSha: process.env.BUILD_SHA ?? null,
      workerPid: String(process.pid),
      summary: detail,
    });
  } catch (err) {
    logger.warn({ err }, "[crm-ingest-alarm] failed to record alarm row");
  }
}

function alarmEmailHtml(sample: CrmIngestHealthSample, threshold: number): string {
  const windowMin = Math.round(sample.windowMs / 60_000);
  const samplePreview = sample.missingSample.length
    ? `<ul>${sample.missingSample
        .map((e) => `<li><code>${e}</code></li>`)
        .join("")}</ul>`
    : "<p><em>(no sample emails captured)</em></p>";
  return [
    "<p><strong>CRM ingest health alarm</strong></p>",
    `<p>${sample.missingEmails} of ${sample.expectedEmails} buyer/portal emails ` +
      `in the last ${windowMin} minutes have no <code>crm_contacts</code> row ` +
      `(threshold: ${threshold}).</p>`,
    "<p>Per-source counts in window:</p>",
    "<ul>",
    `<li>coaching_agreements.paid_at: <strong>${sample.perSource.coaching}</strong></li>`,
    `<li>portal_users.created_at (active): <strong>${sample.perSource.portalUsers}</strong></li>`,
    `<li>orders.created_at (main_product_paid): <strong>${sample.perSource.orders}</strong></li>`,
    "</ul>",
    "<p>Sample of missing emails:</p>",
    samplePreview,
    "<p>What to check, in order:</p>",
    "<ol>",
    "<li>API server logs for <code>[crm-ingest] enqueueCrmContact failed</code> WARN lines.</li>",
    "<li>Run <code>pnpm --filter @workspace/scripts run check:schema-drift</code> against prod - missing columns on <code>crm_contacts</code> / <code>crm_pipeline_stages</code> are the usual culprit.</li>",
    "<li>Verify at least one row exists in <code>crm_pipeline_stages</code> (the ingest needs a default stage).</li>",
    "<li>Back-fill the gap with <code>pnpm --filter @workspace/scripts run crm:backfill-contacts -- --apply</code>.</li>",
    "</ol>",
    "<p style='color:#888;font-size:12px;'>This alert will not repeat for at least " +
      `${ALARM_REPEAT_HOURS} hours, and stops firing automatically once the delta clears.</p>`,
  ].join("\n");
}

async function check(): Promise<void> {
  const sinceBoot = Date.now() - bootAt;
  if (sinceBoot < ALARM_QUIET_HOURS * 3600 * 1000) {
    return;
  }

  let sample: CrmIngestHealthSample;
  try {
    sample = await sampleCrmIngestHealth();
  } catch (err) {
    logger.warn({ err }, "[crm-ingest-alarm] sample query failed");
    return;
  }

  const threshold = thresholdFromEnv();
  // Spec wording is "delta exceeds threshold" (strict greater-than),
  // so missing==threshold is still considered healthy.
  if (sample.missingEmails <= threshold) {
    if (consecutiveHits > 0) {
      logger.info(
        { missing: sample.missingEmails, threshold },
        "[crm-ingest-alarm] delta cleared, resetting hit counter",
      );
    }
    consecutiveHits = 0;
    return;
  }

  consecutiveHits += 1;
  if (consecutiveHits < CONSECUTIVE_TICKS_REQUIRED) {
    logger.warn(
      {
        missing: sample.missingEmails,
        expected: sample.expectedEmails,
        threshold,
        hits: consecutiveHits,
      },
      "[crm-ingest-alarm] missing-contacts delta above threshold (waiting for confirmation)",
    );
    return;
  }

  const lastAlarm = await lastAlarmAt();
  if (lastAlarm && Date.now() - lastAlarm.getTime() < ALARM_REPEAT_HOURS * 3600 * 1000) {
    return;
  }

  const to = adminEmail();
  const windowMin = Math.round(sample.windowMs / 60_000);
  const subject = `[GREGORY] CRM ingest missing ${sample.missingEmails} of ${sample.expectedEmails} buyers in last ${windowMin}m`;
  const body =
    `${sample.missingEmails} of ${sample.expectedEmails} buyer/portal emails in the last ` +
    `${windowMin} minutes have no crm_contacts row (threshold ${threshold}). ` +
    `Per-source: coaching=${sample.perSource.coaching}, ` +
    `portal_users=${sample.perSource.portalUsers}, ` +
    `orders=${sample.perSource.orders}. ` +
    `Sample: ${sample.missingSample.join(", ") || "(none)"}. ` +
    `Check API logs for [crm-ingest] WARN lines, then run crm:backfill-contacts to repair.`;

  logger.error(
    {
      missing: sample.missingEmails,
      expected: sample.expectedEmails,
      threshold,
      perSource: sample.perSource,
      missingSample: sample.missingSample,
    },
    "[crm-ingest-alarm] firing - CRM ingest has fallen behind",
  );

  try {
    await sendEmail({
      email: to,
      subject,
      body,
      bodyHtml: alarmEmailHtml(sample, threshold),
      templateType: "crm_ingest_health_alarm",
      metadata: {
        missingEmails: sample.missingEmails,
        expectedEmails: sample.expectedEmails,
        threshold,
        windowMs: sample.windowMs,
        perSource: sample.perSource,
      },
    });
    await recordAlarmFired({
      to,
      missingEmails: sample.missingEmails,
      expectedEmails: sample.expectedEmails,
      threshold,
      perSource: sample.perSource,
      missingSample: sample.missingSample,
      windowMs: sample.windowMs,
    });
    logger.warn(
      { to, missing: sample.missingEmails, expected: sample.expectedEmails },
      "[crm-ingest-alarm] operator emailed",
    );
    consecutiveHits = 0;
  } catch (err) {
    logger.error({ err, to }, "[crm-ingest-alarm] failed to send alarm email");
  }
}

function arm(): void {
  timer = setTimeout(async () => {
    await check();
    arm();
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function startCrmIngestHealthAlarm(): void {
  if (started) return;
  if (process.env["CRM_INGEST_ALARM_DISABLED"] === "1") {
    logger.warn(
      "CRM_INGEST_ALARM_DISABLED=1 set; CRM ingest health alarm will not start",
    );
    return;
  }
  started = true;
  logger.info(
    {
      checkIntervalMs: CHECK_INTERVAL_MS,
      windowMs: WINDOW_MS,
      threshold: thresholdFromEnv(),
      quietHoursAfterBoot: ALARM_QUIET_HOURS,
      repeatHours: ALARM_REPEAT_HOURS,
      to: adminEmail(),
    },
    "CRM ingest health alarm started",
  );
  const first = setTimeout(async () => {
    await check();
    arm();
  }, FIRST_DELAY_MS);
  first.unref?.();
}

export function stopCrmIngestHealthAlarm(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
  consecutiveHits = 0;
}
