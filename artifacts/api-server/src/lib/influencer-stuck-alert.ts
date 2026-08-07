// Task #701: emit a #ops Slack alert when an AI Influencer job is
// auto-failed for being stuck. Reuses the shared `OPS_SLACK_WEBHOOK_URL`
// poster (`lib/ops-slack.ts`). Dedupe via the `stuck_alert_sent_at`
// column on `ai_influencer_jobs` so re-entry of the same failure
// branch on the next finalize tick can never double-post.
//
// The emitter is intentionally `void`-returning and swallows its own
// errors - a flaky webhook (or a missing-dedupe-column drift) must
// never abort the failure transition the caller is committing.

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  aiInfluencerJobsTable,
  appUsers,
} from "@workspace/db";
import { logger } from "./logger";
import { postOpsSlackAlert } from "./ops-slack";

export type StuckAlertSource =
  | "fast_fail"
  | "cap_sliceB"
  | "cap_inline"
  | "cli_cleanup"
  | "admin_mark_failed";

export type StuckAlertContext = {
  jobId: number;
  clientId: number;
  source: StuckAlertSource;
  failureReason: string;
  finalizeAttempts: number;
  etaAgeMs: number | null;
  totalElapsedMs: number | null;
  failedIdx?: number[];
  extra?: Record<string, unknown>;
};

function publicBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  const abs = Math.abs(ms);
  const sign = ms < 0 ? "-" : "";
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s`;
  if (abs < 60 * 60_000) return `${sign}${Math.round(abs / 60_000)}m`;
  const h = Math.floor(abs / (60 * 60_000));
  const m = Math.round((abs % (60 * 60_000)) / 60_000);
  return `${sign}${h}h${m}m`;
}

export async function postInfluencerStuckAlert(
  ctx: StuckAlertContext,
): Promise<void> {
  try {
    // Claim the dedupe stamp atomically before posting. If another
    // tick already claimed it (or the column drifted out of the
    // dev schema), we bail without posting.
    const claimed = await db
      .update(aiInfluencerJobsTable)
      .set({ stuckAlertSentAt: new Date() })
      .where(
        and(
          eq(aiInfluencerJobsTable.id, ctx.jobId),
          isNull(aiInfluencerJobsTable.stuckAlertSentAt),
        ),
      )
      .returning({ id: aiInfluencerJobsTable.id });
    if (claimed.length === 0) {
      logger.info(
        { jobId: ctx.jobId, source: ctx.source, task: 701 },
        "[influencer-stuck-alert] dedupe stamp already claimed; skipping Slack post",
      );
      return;
    }

    let buyerEmail: string | null = null;
    try {
      const [u] = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, ctx.clientId))
        .limit(1);
      buyerEmail = u?.email ?? null;
    } catch (err) {
      logger.warn(
        { err, jobId: ctx.jobId, task: 701 },
        "[influencer-stuck-alert] buyer-email lookup failed; posting without email",
      );
    }

    const base = publicBaseUrl();
    const link = base
      ? `${base}/members/admin/influencer-generations?jobId=${ctx.jobId}`
      : `/members/admin/influencer-generations?jobId=${ctx.jobId}`;

    const failedIdxStr =
      ctx.failedIdx && ctx.failedIdx.length > 0
        ? ctx.failedIdx.join(",")
        : "none";

    const lines = [
      `:rotating_light: *AI Influencer job auto-failed (stuck)*`,
      `*Job:* #${ctx.jobId}  *Buyer:* ${buyerEmail ?? `client #${ctx.clientId}`}`,
      `*Source:* \`${ctx.source}\`  *Reason:* \`${ctx.failureReason}\``,
      `*Finalize attempts:* ${ctx.finalizeAttempts}  *ETA age:* ${fmtDuration(ctx.etaAgeMs)}  *Total elapsed:* ${fmtDuration(ctx.totalElapsedMs)}`,
      `*Failed scene idx:* ${failedIdxStr}`,
      `<${link}|Open in admin console>`,
    ];
    const text = lines.join("\n");

    await postOpsSlackAlert({
      source: "influencer-stuck",
      text,
      context: {
        jobId: ctx.jobId,
        clientId: ctx.clientId,
        buyerEmail,
        stuckSource: ctx.source,
        failureReason: ctx.failureReason,
        finalizeAttempts: ctx.finalizeAttempts,
        etaAgeMs: ctx.etaAgeMs,
        totalElapsedMs: ctx.totalElapsedMs,
        failedIdx: ctx.failedIdx ?? [],
        task: 701,
        ...(ctx.extra ?? {}),
      },
    });
  } catch (err) {
    logger.warn(
      { err, jobId: ctx.jobId, source: ctx.source, task: 701 },
      "[influencer-stuck-alert] alert emitter threw; swallowing",
    );
  }
}
