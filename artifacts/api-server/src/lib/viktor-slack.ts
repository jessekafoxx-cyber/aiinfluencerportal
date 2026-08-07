// Task #708: Slack notifier for the Viktor (external agent) handoff.
//
// Mirrors lib/ops-slack.ts but uses VIKTOR_SLACK_WEBHOOK_URL so the
// Viktor channel is isolated from the #ops alerts pipe. Fire-and-
// forget: a flaky webhook must never bubble into the caller (i.e. a
// buyer submitting the Generate modal). When the env var is unset
// the helper logs once and returns.

import { logger } from "./logger";
import { db, aiInfluencerJobsTable, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";

function publicBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

// Slack only triggers a real mention notification when the user/bot id
// is wrapped as <@U…>. A literal "@Viktor" string just gets cosmetic
// styling. Falls back to the literal label if the env var is unset so
// the message is still readable.
function viktorMention(): string {
  const id = process.env.VIKTOR_SLACK_USER_ID?.trim();
  return id ? `<@${id}>` : "@Viktor";
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

async function postViktorSlackRaw(text: string): Promise<void> {
  // Gate non-production environments. Dev and prod have separate
  // databases with independent auto-increment sequences, so a Slack
  // notification fired from the dev workflow labelled "Job #16" points
  // at a row Viktor cannot see via the production external API (which
  // has its own, unrelated #16). The mismatch wedged Viktor's upload
  // workflow until we noticed. Production is the only env that should
  // ever notify Viktor; opt into dev with VIKTOR_SLACK_ALLOW_DEV=1 for
  // controlled testing against a shared DB.
  const isProd = process.env.NODE_ENV === "production";
  const allowDev = process.env.VIKTOR_SLACK_ALLOW_DEV === "1";
  if (!isProd && !allowDev) {
    logger.info(
      { task: 708, nodeEnv: process.env.NODE_ENV ?? "unset" },
      "[viktor-slack] non-production env; skipping notification (set VIKTOR_SLACK_ALLOW_DEV=1 to override)",
    );
    return;
  }
  const url = process.env.VIKTOR_SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    logger.info(
      { task: 708 },
      "[viktor-slack] VIKTOR_SLACK_WEBHOOK_URL unset; skipping notification (log-only)",
    );
    return;
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
        { status: res.status, body: body.slice(0, 200), task: 708 },
        "[viktor-slack] webhook returned non-2xx",
      );
    }
  } catch (err) {
    logger.warn(
      { err: errMessage(err), task: 708 },
      "[viktor-slack] webhook POST failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

export type ViktorJobContext = {
  jobId: number;
  reason?: "new" | "retry" | "admin_retry" | "overdue" | "auto_failed";
};

/**
 * Notify Viktor that a new influencer job is queued. Loads the buyer
 * email + prefs from the DB so callers only need to pass the job id.
 * Never throws.
 */
export async function notifyViktor(ctx: ViktorJobContext): Promise<void> {
  try {
    const [job] = await db
      .select({
        id: aiInfluencerJobsTable.id,
        clientId: aiInfluencerJobsTable.clientId,
        status: aiInfluencerJobsTable.status,
        prefs: aiInfluencerJobsTable.prefs,
        isFreeTier: aiInfluencerJobsTable.isFreeTier,
        etaAt: aiInfluencerJobsTable.etaAt,
        createdAt: aiInfluencerJobsTable.createdAt,
        influencerId: aiInfluencerJobsTable.influencerId,
      })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, ctx.jobId))
      .limit(1);
    if (!job) {
      logger.warn({ jobId: ctx.jobId, task: 708 }, "[viktor-slack] job not found");
      return;
    }
    let buyerEmail: string | null = null;
    try {
      // ai_influencer_jobs.client_id FKs to app_users.id, NOT
      // portal_users.id. The two tables have independent serial
      // sequences, so the wrong lookup either returned a different
      // buyer or nothing at all - exactly what wedged Viktor's first
      // upload attempt. Match the external API path (see
      // findAppUserByEmail in routes/external-api-influencers.ts).
      const [u] = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, job.clientId))
        .limit(1);
      buyerEmail = u?.email ?? null;
    } catch (err) {
      logger.warn({ err, jobId: ctx.jobId, task: 708 }, "[viktor-slack] buyer email lookup failed");
    }

    // Canonical admin route (matches lib/influencer-stuck-alert.ts).
    const base = publicBaseUrl();
    const link = base
      ? `${base}/admin/influencer-generations?jobId=${job.id}`
      : `/admin/influencer-generations?jobId=${job.id}`;

    const reasonLabel =
      ctx.reason === "retry"
        ? " (buyer retry)"
        : ctx.reason === "admin_retry"
          ? " (admin retry)"
          : "";

    // The watchdog reasons get their own distinct header so the team can
    // tell an SLA escalation apart from a fresh hand-off at a glance.
    const headerLine =
      ctx.reason === "overdue"
        ? `${viktorMention()} :hourglass_flowing_sand: *AI Influencer job STILL UNDELIVERED past the 24h promise - please prioritise*`
        : ctx.reason === "auto_failed"
          ? `${viktorMention()} :x: *AI Influencer job AUTO-FAILED after 72h undelivered - the buyer's slot was returned so they can re-request*`
          : `${viktorMention()} :art: *New AI Influencer job${reasonLabel}*`;

    // Slack's text limit is ~40KB. We include the full prefs +
    // characterProfile inline by default so Viktor has everything he
    // needs to start generation without a follow-up API call; only
    // truncate when the payload approaches the platform limit.
    const SLACK_TEXT_LIMIT = 38_000;
    const prefsJson = (() => {
      try {
        const full = JSON.stringify(job.prefs, null, 2);
        if (full.length <= SLACK_TEXT_LIMIT) {
          return "```\n" + full + "\n```";
        }
        return (
          "```\n" +
          full.slice(0, SLACK_TEXT_LIMIT) +
          "\n... [truncated " +
          (full.length - SLACK_TEXT_LIMIT) +
          " chars]\n```"
        );
      } catch {
        return "(prefs unavailable)";
      }
    })();

    const lines = [
      headerLine,
      `*Job:* #${job.id}  *Buyer:* ${buyerEmail ?? `client #${job.clientId}`}  *Free tier:* ${job.isFreeTier ? "yes" : "no"}`,
      `*ETA shown to buyer:* ${job.etaAt ? new Date(job.etaAt).toISOString() : "unset"}`,
      `*Influencer slot:* ${job.influencerId ?? "(none yet)"}`,
      `*Prefs + character profile:*`,
      prefsJson,
      `<${link}|Open in admin console>`,
    ];
    await postViktorSlackRaw(lines.join("\n"));
  } catch (err) {
    logger.warn(
      { err: errMessage(err), jobId: ctx.jobId, task: 708 },
      "[viktor-slack] notifyViktor threw; swallowing",
    );
  }
}

/** True when the buyer-facing internal Higgsfield/Enhancor pipeline
 *  should run. Defaults to OFF since Task #708 hands generation to
 *  Viktor; flip INFLUENCER_INTERNAL_PIPELINE_ENABLED=1 to roll back. */
export function isInternalInfluencerPipelineEnabled(): boolean {
  return process.env.INFLUENCER_INTERNAL_PIPELINE_ENABLED === "1";
}

// ---------------------------------------------------------------------------
// Dispute notification (Stripe charge.dispute.created)
//
// Reuses postViktorSlackRaw + the same dev gate as the influencer
// pipeline so the dispute channel never gets dev noise. Fire-and-
// forget: webhook handlers must never block on Slack.
// ---------------------------------------------------------------------------

export type ViktorDisputeContext = {
  disputeId: string;
  chargeId: string;
  paymentIntentId: string | null;
  buyerEmail: string | null;
  amountCents: number;
  currency: string;
  reason: string;
  evidenceDueBy: number | null;
  productSlugs: string[];
  orderId: string | null;
  isHighTicket: boolean;
  agreementId: number | null;
};

export async function notifyViktorOfDispute(
  ctx: ViktorDisputeContext,
): Promise<void> {
  try {
    const base = publicBaseUrl();
    const adminLink = base
      ? `${base}/admin/dispute-defense?email=${encodeURIComponent(ctx.buyerEmail || "")}`
      : `/admin/dispute-defense`;
    const amountStr = `$${(ctx.amountCents / 100).toFixed(2)} ${ctx.currency.toUpperCase()}`;
    const dueStr = ctx.evidenceDueBy
      ? new Date(ctx.evidenceDueBy * 1000).toISOString().split("T")[0]
      : "(unknown)";
    const lines = [
      `${viktorMention()} :rotating_light: *New Stripe dispute opened*`,
      `*Buyer:* ${ctx.buyerEmail ?? "(unknown)"}  *Amount:* ${amountStr}`,
      `*Reason:* ${ctx.reason}  *Evidence deadline:* ${dueStr}`,
      `*Dispute:* ${ctx.disputeId}  *Charge:* ${ctx.chargeId}  *PI:* ${ctx.paymentIntentId ?? "(unknown)"}`,
      `*Products:* ${ctx.productSlugs.length ? ctx.productSlugs.join(", ") : "(unknown)"}`,
      ctx.isHighTicket
        ? `*High-ticket agreement:* ${ctx.agreementId ? `#${ctx.agreementId}` : "(missing!)"}`
        : `*Order:* ${ctx.orderId ?? "(unknown)"}`,
      `Entitlements revoked. Evidence staged but not submitted - review and submit in <${adminLink}|the admin panel>.`,
    ];
    await postViktorSlackRaw(lines.join("\n"));
  } catch (err) {
    logger.warn(
      { err: errMessage(err), disputeId: ctx.disputeId },
      "[viktor-slack] notifyViktorOfDispute threw; swallowing",
    );
  }
}

// ---------------------------------------------------------------------------
// High-ticket agreement-missing alert (Task 13 tail).
//
// Fires when a coaching/DFY PaymentIntent succeeds but the
// coaching_agreements row referenced by meta.agreementId is missing.
// This should be impossible under the normal flow (the agreement is
// signed-and-stored BEFORE Stripe takes payment) - if it ever fires
// we have either a metadata-tampering attempt or a serious data-loss
// bug, so Viktor / the team need to know in real time.
// ---------------------------------------------------------------------------

export async function notifyViktorOfMissingAgreement(ctx: {
  paymentIntentId: string;
  agreementId: number | string;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
}): Promise<void> {
  try {
    const amountStr = `$${(ctx.amountCents / 100).toFixed(2)} ${ctx.currency.toUpperCase()}`;
    const lines = [
      `${viktorMention()} :warning: *High-ticket payment succeeded WITHOUT a signed agreement on file*`,
      `*PI:* ${ctx.paymentIntentId}  *Agreement id referenced:* ${ctx.agreementId}`,
      `*Amount:* ${amountStr}  *Buyer:* ${ctx.buyerEmail ?? "(unknown)"}`,
      `This should be impossible - the agreement is signed-and-stored before Stripe takes payment. Investigate immediately.`,
    ];
    await postViktorSlackRaw(lines.join("\n"));
  } catch (err) {
    logger.warn(
      { err: errMessage(err), paymentIntentId: ctx.paymentIntentId },
      "[viktor-slack] notifyViktorOfMissingAgreement threw; swallowing",
    );
  }
}
