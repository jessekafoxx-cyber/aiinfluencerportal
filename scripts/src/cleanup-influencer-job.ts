/**
 * Task #675 — Cleanup helper for an influencer pipeline job that is wedged
 * mid-scene-swap (status='swapping_scenes', scene_image_urls=[],
 * finalize_attempts saturated, eta_at passed). The underlying scene-swap
 * pipeline bug is being fixed separately; this script unsticks the row,
 * mirrors the failure onto the parent ai_influencers row, refunds the
 * generation slot (implicit — countActiveInfluencerJobs excludes
 * status='failed'), and sends the buyer a "build couldn't complete"
 * email + in-portal notification through the existing helpers.
 *
 * Generations counter:
 *   The "Generations used: N of 6" UI is driven by
 *   countActiveInfluencerJobs(clientId) in routes/influencer-jobs.ts, which
 *   counts free-tier jobs whose status <> 'failed'. So flipping the job to
 *   'failed' is the refund — no separate counter column to touch.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run cleanup:influencer-job -- --job 12
 *   pnpm --filter @workspace/scripts run cleanup:influencer-job -- --job 12 --apply
 *
 * Idempotent: re-running against an already-cleaned job (status='failed' /
 * 'ready' / 'ready_degraded') prints "already clean" and exits 0.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  aiInfluencerJobsTable,
  aiInfluencersTable,
  appUsers,
  portalNotificationsTable,
} from "@workspace/db";
import { sendEmail } from "../../artifacts/api-server/src/lib/email";
import { logger } from "../../artifacts/api-server/src/lib/logger";
import { postInfluencerStuckAlert } from "../../artifacts/api-server/src/lib/influencer-stuck-alert";

const CLEANUP_REASON = "manual_cleanup_scene_swap_no_output";

type Args = { jobId: number; apply: boolean; force: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let jobId: number | null = null;
  let apply = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--force") force = true;
    else if (a === "--job") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--job requires a positive integer (got ${argv[i]})`);
      jobId = n;
    } else if (a.startsWith("--job=")) {
      const n = Number(a.slice("--job=".length));
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--job requires a positive integer (got ${a})`);
      jobId = n;
    }
  }
  if (jobId == null) throw new Error("--job <id> is required");
  return { jobId, apply, force };
}

async function main() {
  const { jobId, apply, force } = parseArgs();

  const [job] = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .limit(1);
  if (!job) {
    console.error(`Job ${jobId} not found.`);
    process.exit(1);
  }

  const [user] = await db
    .select({ id: appUsers.id, email: appUsers.email, name: appUsers.name })
    .from(appUsers)
    .where(eq(appUsers.id, job.clientId))
    .limit(1);

  // Compute current counter (free-tier jobs not status='failed') so we
  // can report "counter before" / "counter after" in the summary.
  const activeBefore = await db
    .select({ id: aiInfluencerJobsTable.id, status: aiInfluencerJobsTable.status })
    .from(aiInfluencerJobsTable)
    .where(and(
      eq(aiInfluencerJobsTable.clientId, job.clientId),
      eq(aiInfluencerJobsTable.isFreeTier, true),
    ));
  const counterBefore = activeBefore.filter((r) => r.status !== "failed").length;

  let influencer: { id: number; name: string; status: string } | null = null;
  if (job.influencerId) {
    const [inf] = await db
      .select({ id: aiInfluencersTable.id, name: aiInfluencersTable.name, status: aiInfluencersTable.status })
      .from(aiInfluencersTable)
      .where(eq(aiInfluencersTable.id, job.influencerId))
      .limit(1);
    influencer = inf ?? null;
  }
  if (!influencer) {
    const [inf] = await db
      .select({ id: aiInfluencersTable.id, name: aiInfluencersTable.name, status: aiInfluencersTable.status })
      .from(aiInfluencersTable)
      .where(and(
        eq(aiInfluencersTable.clientId, job.clientId),
        eq(aiInfluencersTable.name, `Influencer ${jobId}`),
      ))
      .limit(1);
    influencer = inf ?? null;
  }

  const sceneCount = Array.isArray(job.sceneImageUrls) ? job.sceneImageUrls.length : 0;
  const TERMINAL_STATES = new Set(["failed", "ready", "ready_degraded"]);
  const alreadyClean = TERMINAL_STATES.has(job.status);

  // Safety guard: by default only operate on the known stuck pattern
  // (status='swapping_scenes' AND zero scenes). --force opts out for
  // operators who want to clean up a different shape (e.g. wedged in
  // generating_base / enhancing).
  const matchesStuckPattern = job.status === "swapping_scenes" && sceneCount === 0;
  const counterAfter = job.isFreeTier ? Math.max(0, counterBefore - 1) : counterBefore;

  console.log("=== cleanup-influencer-job summary ===");
  console.log(`  job.id:               ${job.id}`);
  console.log(`  job.status:           ${job.status}`);
  console.log(`  job.failureReason:    ${job.failureReason ?? "<null>"}`);
  console.log(`  job.lastErrorCode:    ${job.lastErrorCode ?? "<null>"}`);
  console.log(`  job.finalizeAttempts: ${job.finalizeAttempts}`);
  console.log(`  job.sceneImageUrls:   ${sceneCount} entries`);
  console.log(`  job.etaAt:            ${job.etaAt?.toISOString?.() ?? job.etaAt}`);
  console.log(`  job.notifiedAt:       ${job.notifiedAt?.toISOString?.() ?? job.notifiedAt ?? "<null>"}`);
  console.log(`  job.emailSentAt:      ${job.emailSentAt?.toISOString?.() ?? job.emailSentAt ?? "<null>"}`);
  console.log(`  client.id / email:    ${job.clientId} / ${user?.email ?? "<no email>"}`);
  console.log(`  influencer:           ${influencer ? `${influencer.id} "${influencer.name}" status=${influencer.status}` : "<none>"}`);
  console.log(`  generations used:     ${counterBefore} (free-tier jobs not in 'failed')`);
  console.log(`  isFreeTier:           ${job.isFreeTier}`);
  console.log(`  matchesStuckPattern:  ${matchesStuckPattern} (status='swapping_scenes' AND zero scenes)`);
  console.log(`  mode:                 ${apply ? "APPLY" : "DRY-RUN"}${force ? " --force" : ""}`);

  if (alreadyClean) {
    console.log("Job is already in a terminal state — already clean. No writes.");
    process.exit(0);
  }

  if (!matchesStuckPattern && !force) {
    console.error("");
    console.error(`Refusing to clean up: job ${jobId} does not match the known stuck pattern`);
    console.error("(status='swapping_scenes' with zero scenes). Re-run with --force to override.");
    process.exit(2);
  }

  if (!apply) {
    console.log("");
    console.log("Would write the following (re-run with --apply):");
    console.log(`  UPDATE ai_influencer_jobs SET status='failed', failure_reason='${CLEANUP_REASON}', last_error_code='${CLEANUP_REASON}' WHERE id=${jobId};`);
    if (influencer && influencer.status === "building") {
      console.log(`  UPDATE ai_influencers   SET status='failed' WHERE id=${influencer.id};`);
    }
    console.log(`  INSERT portal_notifications (client_id=${job.clientId}, type='influencer_failed', ...);`);
    if (user?.email) console.log(`  sendEmail to ${user.email} (subject: "We couldn't finish your AI influencer build")`);
    console.log(`  expected generations used after: ${counterAfter}`);
    process.exit(0);
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  // 1. Job: terminal failed. Guard on the original non-terminal status so a
  //    concurrent worker tick can't clobber a 'ready' transition (defensive).
  const [updatedJob] = await db
    .update(aiInfluencerJobsTable)
    .set({
      status: "failed",
      failureReason: CLEANUP_REASON,
      lastErrorCode: CLEANUP_REASON,
      lastErrorMessage: `Manual cleanup: job wedged in ${job.status} with ${sceneCount} scenes after ${job.finalizeAttempts} finalize attempts.`,
      heartbeatAt: new Date(),
      // Stamp completedAt so the row is unambiguously terminal.
      completedAt: job.completedAt ?? new Date(),
    })
    .where(and(
      eq(aiInfluencerJobsTable.id, jobId),
      eq(aiInfluencerJobsTable.status, job.status),
    ))
    .returning({ id: aiInfluencerJobsTable.id, status: aiInfluencerJobsTable.status });
  if (!updatedJob) {
    console.error(`Job ${jobId} status changed underneath us — re-run to re-evaluate.`);
    process.exit(2);
  }

  // 2. Influencer mirror.
  if (influencer && influencer.status === "building") {
    await db
      .update(aiInfluencersTable)
      .set({ status: "failed" })
      .where(and(
        eq(aiInfluencersTable.id, influencer.id),
        eq(aiInfluencersTable.status, "building"),
      ));
  }

  // 3. Portal notification — idempotent against notifiedAt.
  const sentNotification = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(aiInfluencerJobsTable)
      .set({ notifiedAt: new Date() })
      .where(and(eq(aiInfluencerJobsTable.id, jobId), isNull(aiInfluencerJobsTable.notifiedAt)))
      .returning({ id: aiInfluencerJobsTable.id });
    if (claimed.length === 0) return false;
    await tx.insert(portalNotificationsTable).values({
      clientId: job.clientId,
      type: "influencer_failed",
      title: "We couldn't finish your AI influencer build",
      body: "Your generation slot has been refunded. Tap to try again.",
      payload: { jobId, influencerId: influencer?.id ?? null, reason: CLEANUP_REASON },
      href: "/your-influencers",
    });
    return true;
  });

  // 4. Email — idempotent against emailSentAt.
  let emailStatus: "sent" | "failed" | "skipped-already-sent" | "skipped-no-email" = "skipped-no-email";
  if (user?.email && !job.emailSentAt) {
    const firstName = user.name?.trim().split(/\s+/)[0];
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    const text = [
      greeting,
      "",
      "We hit a snag finishing your AI influencer build and couldn't complete it.",
      "We've refunded the generation slot to your account, so you can start a fresh build whenever you're ready.",
      "",
      "Open the workspace and try again: https://room30.ai/members/your-influencers",
      "",
      "- The Room30 team",
    ].join("\n");
    const sent = await sendEmail({
      userId: job.clientId,
      email: user.email,
      subject: "We couldn't finish your AI influencer build",
      body: text,
      templateType: "influencer_failed",
      metadata: { jobId, influencerId: influencer?.id ?? null, reason: CLEANUP_REASON },
    });
    if (sent.status === "sent") {
      await db
        .update(aiInfluencerJobsTable)
        .set({ emailSentAt: new Date() })
        .where(eq(aiInfluencerJobsTable.id, jobId));
      emailStatus = "sent";
    } else {
      emailStatus = "failed";
      console.warn(`email send failed: ${sent.error ?? "unknown"}`);
    }
  } else if (job.emailSentAt) {
    emailStatus = "skipped-already-sent";
  }

  // 5. Audit log line.
  logger.info(
    {
      task: 675,
      script: "cleanup-influencer-job",
      jobId,
      influencerId: influencer?.id ?? null,
      clientId: job.clientId,
      buyerEmail: user?.email ?? null,
      fromStatus: job.status,
      toStatus: "failed",
      reason: CLEANUP_REASON,
      sceneCount,
      finalizeAttempts: job.finalizeAttempts,
      notificationInserted: sentNotification,
      emailStatus,
      counterBefore,
      counterAfter,
      isFreeTier: job.isFreeTier,
      runner: process.env.USER ?? process.env.LOGNAME ?? "unknown",
    },
    "cleanup-influencer-job: applied",
  );

  // Task #701: notify #ops that a stuck job was hand-cleaned. Fire
  // after the row has been flipped so the alert reflects committed
  // state. Wrapped already inside the emitter; no try/catch needed.
  await postInfluencerStuckAlert({
    jobId,
    clientId: job.clientId,
    source: "cli_cleanup",
    failureReason: CLEANUP_REASON,
    finalizeAttempts: job.finalizeAttempts,
    etaAgeMs: job.etaAt ? Date.now() - new Date(job.etaAt).getTime() : null,
    totalElapsedMs: Date.now() - new Date(job.createdAt).getTime(),
    extra: { fromStatus: job.status, sceneCount },
  });

  console.log("");
  console.log(`Applied. Job ${jobId} → status='failed' (${CLEANUP_REASON}).`);
  console.log(`  influencer:        ${influencer ? `${influencer.id} → ${influencer.status === "building" ? "failed" : influencer.status}` : "<none>"}`);
  console.log(`  notification:      ${sentNotification ? "inserted" : "skipped (already notified)"}`);
  console.log(`  email:             ${emailStatus}`);
  console.log(`  generations used:  ${counterBefore} → ${Math.max(0, counterBefore - 1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
