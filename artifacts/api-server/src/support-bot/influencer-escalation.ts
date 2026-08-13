// Support-bot escalation for "my AI influencer has not generated"
// complaints (>24h). Verifies the customer email matches a portal
// account, then posts the owner's verbatim manual-generation request to
// the #manual-ai-influencer-generation Slack channel tagging Viktor.
//
// Slack transport: incoming webhooks are channel-bound, so the channel
// is selected by which webhook URL is configured, not by channel id.
// Preferred: MANUAL_INFLUENCER_SLACK_WEBHOOK_URL (webhook created for
// #manual-ai-influencer-generation). Fallback: VIKTOR_SLACK_WEBHOOK_URL
// (the existing Viktor handoff channel). If Slack fails entirely we
// fall back to emailing hello@room30.ai so no customer is dropped.
//
// Same production gate as lib/viktor-slack.ts: only NODE_ENV=production
// posts for real; set VIKTOR_SLACK_ALLOW_DEV=1 to test from dev.

import { db, portalUsersTable, appUsers, aiInfluencerJobsTable } from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendEmail } from "../lib/email";

const SUPPORT_EMAIL = "support@aiinfluencerpublishing.com";

export type InfluencerEscalationResult =
  | { status: "no_account" }
  | { status: "escalated"; via: "slack" | "email" | "dev_skip" }
  | { status: "failed" };

function viktorMention(): string {
  const id = process.env.VIKTOR_SLACK_USER_ID?.trim();
  return id ? `<@${id}>` : "@Viktor";
}

function buildMessage(clientName: string, email: string): string {
  // Verbatim template from the owner - do not reword.
  return (
    `Please do a manual ai influencer generation for ${clientName} & ${email} and push to their account ASAP and also give me google drive link with all images in (anyone with a link can view).\n\n` +
    `We need the same images you do in portal so main image, 12 angles, and then different settings including podcast, speaking, car, selfie etc\n\n` +
    `Please do a high priority as customer is waiting and send me Google drive link + let me know if portal push was successful`
  );
}

async function findLatestJob(
  normalizedEmail: string,
): Promise<{ id: number; status: string } | null> {
  try {
    const [row] = await db
      .select({
        id: aiInfluencerJobsTable.id,
        status: aiInfluencerJobsTable.status,
      })
      .from(aiInfluencerJobsTable)
      .innerJoin(appUsers, eq(aiInfluencerJobsTable.clientId, appUsers.id))
      .where(sql`lower(${appUsers.email}) = ${normalizedEmail}`)
      .orderBy(desc(aiInfluencerJobsTable.createdAt))
      .limit(1);
    return row ?? null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[support-bot] influencer job lookup failed (non-fatal)",
    );
    return null;
  }
}

async function postToSlack(text: string): Promise<boolean> {
  const url =
    process.env.MANUAL_INFLUENCER_SLACK_WEBHOOK_URL?.trim() ||
    process.env.VIKTOR_SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    logger.warn(
      {},
      "[support-bot] no Slack webhook configured for manual influencer escalation",
    );
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: body.slice(0, 200) },
        "[support-bot] influencer escalation webhook returned non-2xx",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[support-bot] influencer escalation webhook POST failed",
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function escalateInfluencerGeneration(opts: {
  clientName: string;
  email: string;
  sessionId: string;
}): Promise<InfluencerEscalationResult> {
  const normalized = opts.email.trim().toLowerCase();
  if (!normalized) return { status: "no_account" };

  // The client email MUST match a portal account (owner requirement).
  // Influencer jobs hang off app_users, portal sign-ins off portal_users
  // - accept a match on either so we don't bounce legit buyers mid-sync.
  const [portalRows, appRows] = await Promise.all([
    db
      .select({ id: portalUsersTable.id })
      .from(portalUsersTable)
      .where(sql`lower(${portalUsersTable.email}) = ${normalized}`)
      .limit(1),
    db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(sql`lower(${appUsers.email}) = ${normalized}`)
      .limit(1),
  ]);
  if (portalRows.length === 0 && appRows.length === 0) {
    return { status: "no_account" };
  }

  const latestJob = await findLatestJob(normalized);
  const jobLine = latestJob
    ? ` Latest influencer job: #${latestJob.id} (${latestJob.status}).`
    : "";
  const text =
    `${viktorMention()} ${buildMessage(opts.clientName, normalized)}` +
    `\n\n(Sent by the AI Influencer Portfolio support bot. Portal account verified for ${normalized}.${jobLine})`;

  const isProd = process.env.NODE_ENV === "production";
  const allowDev = process.env.VIKTOR_SLACK_ALLOW_DEV === "1";
  if (!isProd && !allowDev) {
    logger.info(
      { sessionId: opts.sessionId, email: normalized },
      "[support-bot] non-production env; skipping influencer escalation Slack post (set VIKTOR_SLACK_ALLOW_DEV=1 to override)",
    );
    return { status: "escalated", via: "dev_skip" };
  }

  if (await postToSlack(text)) {
    logger.warn(
      { sessionId: opts.sessionId, email: normalized, jobId: latestJob?.id },
      "[support-bot] posted manual influencer generation escalation to Slack",
    );
    return { status: "escalated", via: "slack" };
  }

  // Slack failed - fall back to email so the request is never dropped.
  try {
    const result = await sendEmail({
      email: SUPPORT_EMAIL,
      subject: `MANUAL AI INFLUENCER GENERATION NEEDED - ${opts.clientName} (${normalized})`,
      body:
        `The support bot tried to post this to the #manual-ai-influencer-generation Slack channel but Slack was unreachable. Please action manually:\n\n` +
        `${buildMessage(opts.clientName, normalized)}\n\n` +
        `Portal account verified for ${normalized}.${jobLine}\nSession: ${opts.sessionId}`,
      templateType: "support_bot_escalation",
      metadata: { sessionId: opts.sessionId, customerEmail: normalized },
    });
    if (result.status === "sent") {
      return { status: "escalated", via: "email" };
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[support-bot] influencer escalation email fallback failed",
    );
  }
  return { status: "failed" };
}
