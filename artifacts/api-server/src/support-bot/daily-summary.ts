// Daily Alana (AI support bot) summary for Slack.
//
// Once a day the worker compiles the last 24h of support_bot_sessions
// into a short ops digest - what customers asked about, what the bot
// sorted on its own (refunds, bug reports, influencer escalations),
// what needed / still needs a human, and suggested knowledge-base
// improvements - and posts it to the support Slack webhook.
//
// Webhook resolution: SUPPORT_BOT_SLACK_WEBHOOK_URL first, then
// OPS_SLACK_WEBHOOK_URL as fallback. Neither set -> log-only, no throw.
//
// Prod-only unless SUPPORT_BOT_SUMMARY_ALLOW_DEV=1.
// Kill switch: SUPPORT_BOT_SUMMARY_DISABLED=1.
// Send hour override: SUPPORT_BOT_SUMMARY_HOUR_UTC (0-23, default 7).
//
// The LLM step runs on gpt-4o (fast, non-reasoning) with a hard input
// budget; if the model call fails the summary still goes out with the
// hard stats so the daily signal never silently disappears.

import { gte, sql } from "drizzle-orm";
import { db, supportBotSessionsTable } from "@workspace/db";
import type {
  SupportBotMessage,
  SupportBotSessionMetadata,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const SOURCE = "support-bot-daily-summary";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOUR_UTC = 7;
const MAX_DIGEST_SESSIONS = 40;
const MAX_DIGEST_CHARS = 12000;
const FALLBACK_REPLY_PREFIX = "Sorry, having a bit of trouble on my end";

export interface SupportBotDailyStats {
  windowStart: string;
  windowEnd: string;
  activeSessions: number;
  newSessions: number;
  userMessages: number;
  emailsCaptured: number;
  escalationsToHuman: number;
  refundsIssued: number;
  bugReportsFiled: number;
  influencerEscalations: number;
  fallbackReplies: number;
  intentCounts: Record<string, number>;
}

export interface SupportBotDailySummary {
  stats: SupportBotDailyStats;
  text: string;
  aiSectionOk: boolean;
}

function inWindow(iso: string | undefined, since: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= since.getTime();
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

// Customer message excerpts leave the system (OpenAI + Slack), so strip
// obvious PII first: email addresses, phone-like digit runs, and URL query
// strings (which can carry tokens). Themes survive; identifiers don't.
function redactPii(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(https?:\/\/[^\s?]+)\?\S+/g, "$1?[params]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
}

interface SessionDigest {
  intent: string;
  flags: string[];
  userLines: string[];
}

function digestSession(
  messages: SupportBotMessage[],
  metadata: SupportBotSessionMetadata,
  since: Date,
): SessionDigest {
  const flags: string[] = [];
  if (inWindow(metadata.escalatedEmailSentAt, since)) flags.push("escalated-to-human");
  if (inWindow(metadata.refundIssuedAt, since)) flags.push("refund-issued");
  if (inWindow(metadata.bugSubmittedAt, since)) flags.push("bug-report-filed");
  if (inWindow(metadata.influencerEscalatedAt, since)) flags.push("influencer-escalated");
  const recentUser = messages.filter(
    (m) => m.role === "user" && inWindow(m.at, since),
  );
  const picked = recentUser.length <= 3
    ? recentUser
    : [recentUser[0]!, recentUser[1]!, recentUser[recentUser.length - 1]!];
  return {
    intent: metadata.lastIntent || "general",
    flags,
    userLines: picked.map((m) => truncate(redactPii(m.content), 220)),
  };
}

export async function buildSupportBotDailySummary(): Promise<SupportBotDailySummary> {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS);

  const rows = await db
    .select()
    .from(supportBotSessionsTable)
    .where(gte(supportBotSessionsTable.updatedAt, since));

  const stats: SupportBotDailyStats = {
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    activeSessions: rows.length,
    newSessions: 0,
    userMessages: 0,
    emailsCaptured: 0,
    escalationsToHuman: 0,
    refundsIssued: 0,
    bugReportsFiled: 0,
    influencerEscalations: 0,
    fallbackReplies: 0,
    intentCounts: {},
  };

  const digests: SessionDigest[] = [];
  for (const row of rows) {
    const messages = (row.messages || []) as SupportBotMessage[];
    const metadata = (row.metadata || {}) as SupportBotSessionMetadata;
    if (row.createdAt >= since) stats.newSessions += 1;
    if (row.email) stats.emailsCaptured += 1;
    if (inWindow(metadata.escalatedEmailSentAt, since)) stats.escalationsToHuman += 1;
    if (inWindow(metadata.refundIssuedAt, since)) stats.refundsIssued += 1;
    if (inWindow(metadata.bugSubmittedAt, since)) stats.bugReportsFiled += 1;
    if (inWindow(metadata.influencerEscalatedAt, since)) stats.influencerEscalations += 1;
    for (const m of messages) {
      if (!inWindow(m.at, since)) continue;
      if (m.role === "user") stats.userMessages += 1;
      else if (m.content.startsWith(FALLBACK_REPLY_PREFIX)) stats.fallbackReplies += 1;
    }
    const intent = metadata.lastIntent || "general";
    stats.intentCounts[intent] = (stats.intentCounts[intent] || 0) + 1;
    const d = digestSession(messages, metadata, since);
    if (d.userLines.length > 0) digests.push(d);
  }

  const header = formatStatsBlock(stats);

  if (rows.length === 0) {
    return {
      stats,
      text: `${header}\n\nQuiet day - no support bot conversations in the last 24h. Nothing to review.`,
      aiSectionOk: true,
    };
  }

  let aiSection = "";
  let aiSectionOk = false;
  try {
    aiSection = await generateAiSection(digests);
    aiSectionOk = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, `[${SOURCE}] AI analysis failed; sending stats-only summary`);
    aiSection =
      "AI analysis unavailable today (model call failed) - stats above are still accurate. Check worker logs.";
  }

  return { stats, text: `${header}\n\n${aiSection}`, aiSectionOk };
}

function formatStatsBlock(stats: SupportBotDailyStats): string {
  const intents = Object.entries(stats.intentCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const lines = [
    ":robot_face: *Alana daily summary* (last 24h)",
    `- Conversations: ${stats.activeSessions} (${stats.newSessions} new), ${stats.userMessages} customer messages, ${stats.emailsCaptured} emails captured`,
    `- Handled by bot: ${stats.refundsIssued} refunds issued, ${stats.bugReportsFiled} bug reports filed, ${stats.influencerEscalations} influencer jobs escalated`,
    `- Handed to humans: ${stats.escalationsToHuman} escalation emails sent`,
  ];
  if (stats.fallbackReplies > 0) {
    lines.push(`- :warning: Bot errors: ${stats.fallbackReplies} fallback replies (model call failed mid-chat)`);
  }
  if (intents) lines.push(`- Topics: ${intents}`);
  return lines.join("\n");
}

async function generateAiSection(digests: SessionDigest[]): Promise<string> {
  const sample = digests.slice(0, MAX_DIGEST_SESSIONS);
  let payload = "";
  for (let i = 0; i < sample.length; i++) {
    const d = sample[i]!;
    const block = [
      `Session ${i + 1} [intent: ${d.intent}${d.flags.length ? "; " + d.flags.join(", ") : ""}]`,
      ...d.userLines.map((l) => `  customer: ${l}`),
    ].join("\n");
    if (payload.length + block.length > MAX_DIGEST_CHARS) break;
    payload += `${block}\n`;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 700,
    messages: [
      {
        role: "system",
        content: [
          "You are an ops analyst reviewing one day of conversations from Alana, the AI Influencer Portfolio support bot.",
          "You only see what CUSTOMERS wrote plus per-session flags (refund-issued, bug-report-filed, escalated-to-human, influencer-escalated mean the bot completed that action).",
          "Write a short Slack digest with exactly these four sections, each a bolded heading (*Heading*) followed by 1-4 short bullets starting with '- ':",
          "*Major issues* - the main problems/themes customers raised, with rough counts when a theme repeats.",
          "*Sorted* - what got resolved (bot actions from flags, plus questions the bot could clearly answer).",
          "*Not resolved* - what needed a human, repeated complaints, or anything that looks stuck. If nothing, say 'Nothing outstanding.'",
          "*Improvement ideas* - concrete suggestions: knowledge-base gaps to fill, recurring questions worth a canned answer, product issues to fix upstream.",
          "Rules: plain text for Slack (no markdown headers, no tables). Use a regular hyphen - never em or en dashes. Be specific and concise; max ~250 words total. Never invent facts not supported by the transcripts.",
        ].join("\n"),
      },
      { role: "user", content: `Conversations from the last 24h:\n\n${payload}` },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("empty model response");
  return text;
}

async function postToSlack(text: string): Promise<boolean> {
  const url = (
    process.env.SUPPORT_BOT_SLACK_WEBHOOK_URL || process.env.OPS_SLACK_WEBHOOK_URL || ""
  ).trim();
  if (!url) {
    logger.warn(
      `[${SOURCE}] SUPPORT_BOT_SLACK_WEBHOOK_URL unset; summary not posted (log-only)`,
    );
    logger.info(
      { summaryPreview: text.slice(0, 600) },
      `[${SOURCE}] summary preview (log-only, truncated)`,
    );
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 39000) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: body.slice(0, 200) },
        `[${SOURCE}] Slack webhook returned non-2xx`,
      );
      return false;
    }
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, `[${SOURCE}] Slack webhook POST failed`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function runSupportBotDailySummary(): Promise<
  SupportBotDailySummary & { posted: boolean }
> {
  const summary = await buildSupportBotDailySummary();
  const posted = await postToSlack(summary.text);
  logger.info(
    {
      posted,
      aiSectionOk: summary.aiSectionOk,
      activeSessions: summary.stats.activeSessions,
      escalations: summary.stats.escalationsToHuman,
    },
    `[${SOURCE}] daily summary run complete`,
  );
  return { ...summary, posted };
}

// Once-per-day send guard. During rolling restarts two worker instances
// can both hit the send hour; an atomic date-keyed compare-and-set on the
// app_settings kv table makes sure only one of them posts. Applies to the
// scheduler only - the admin on-demand endpoint intentionally bypasses it.
const SUMMARY_SENT_KEY = "support_bot_summary_last_sent_date";

async function claimDailySendSlot(dateKey: string): Promise<boolean> {
  const res = await db.execute(sql`
    insert into app_settings (key, value, updated_at)
    values (${SUMMARY_SENT_KEY}, ${dateKey}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where app_settings.value is distinct from excluded.value
    returning key
  `);
  return res.rows.length > 0;
}

function resolveHourUtc(): number {
  const raw = process.env.SUPPORT_BOT_SUMMARY_HOUR_UTC?.trim();
  if (!raw) return DEFAULT_HOUR_UTC;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_HOUR_UTC;
  return n;
}

function msUntilNextRun(hourUtc: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startSupportBotDailySummaryScheduler(): void {
  if (process.env.SUPPORT_BOT_SUMMARY_DISABLED === "1") {
    logger.info(`[${SOURCE}] disabled via SUPPORT_BOT_SUMMARY_DISABLED=1`);
    return;
  }
  const allowDev = process.env.SUPPORT_BOT_SUMMARY_ALLOW_DEV === "1";
  if (process.env.NODE_ENV !== "production" && !allowDev) {
    logger.info(
      `[${SOURCE}] skipped (NODE_ENV !== 'production'; set SUPPORT_BOT_SUMMARY_ALLOW_DEV=1 to run in dev)`,
    );
    return;
  }
  const hourUtc = resolveHourUtc();
  const scheduleNext = () => {
    const delay = msUntilNextRun(hourUtc);
    logger.info(
      { hourUtc, nextRunInMs: delay },
      `[${SOURCE}] next daily summary scheduled`,
    );
    const t = setTimeout(() => {
      (async () => {
        const dateKey = new Date().toISOString().slice(0, 10);
        const claimed = await claimDailySendSlot(dateKey);
        if (!claimed) {
          logger.info(
            { dateKey },
            `[${SOURCE}] summary already sent today by another instance; skipping`,
          );
          return;
        }
        await runSupportBotDailySummary();
      })()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err: msg }, `[${SOURCE}] scheduled run failed`);
        })
        .finally(scheduleNext);
    }, delay);
    t.unref?.();
  };
  scheduleNext();
}
