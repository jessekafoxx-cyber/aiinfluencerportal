// Media worker runtime entrypoint (Task #140).
//
// This process owns the media-download queue, the queue metrics
// recorder, the automation worker host, and every scheduler that can
// transitively trigger media work (ad-research-board sync,
// funnels-research-board sync, knowledge ingestion). It is split out of
// the API runtime so that heavy media activity, an Apify response parse
// spike, or a yt-dlp storm cannot stall HTTP request handlers, and an
// uncaught error in queue code cannot take the API down.
//
// Lease safety during cutover: the queue uses Postgres row leases with
// heartbeats and a stuck-lease sweeper (see `media-downloader.ts` and
// `workers/runner.ts`). `claimRowsForProcessing` performs a conditional
// `UPDATE ... WHERE lease_expires_at IS NULL OR lease_expires_at < now()`
// so two concurrent worker processes (e.g. the old in-process loop during
// a rolling restart and this new one) cannot both claim the same row.
// If a worker is killed mid-pass the lease simply expires and the next
// worker re-claims the row; per-row `media_status` transitions are
// idempotent so no duplicate uploads to GCS regardless of which worker
// process drives them. This is why graceful shutdown of the media
// pipeline does not need any new drain primitives in `media-downloader`
// (which is locked by the task's "do not touch" constraint): kill the
// process, the lease expires, the next boot picks up where we left off.
//
// Kill switches:
//   * MEDIA_WORKERS_DISABLED=1 - skips media queue boot hooks/timers.
//   * AUTOMATION_WORKERS_DISABLED=1 - skips the automation worker host.
//
// The worker exposes an optional internal /healthz on WORKER_HEALTH_PORT
// for the workflow runner to check. It does NOT register any public HTTP
// service paths in artifact.toml.

import http from "node:http";
import { bootstrapRuntime } from "./lib/runtime-bootstrap";

bootstrapRuntime("worker");

import { logger } from "./lib/logger";
import { ensureAdResearchBoardFreshOnBoot, scheduleNextDailyAdResearchBoardSync } from "./lib/ad-research-board-sync";
import {
  ensureFunnelsResearchBoardFreshOnBoot,
  scheduleNextDailyFunnelsResearchBoardSync,
} from "./lib/funnels-research-board-sync";
import {
  processPendingMediaInBackground,
  logBootMediaStatusSummary,
  startPeriodicMediaProcessor,
  startPeriodicThumbnailBackfill,
  startQueueMetricsRecorder,
  startQueueMetricsResetWatcher,
  setCookieResolverMode,
  probeYtDlpRuntimeAtBoot,
  getYtDlpRuntimeInfo,
} from "./lib/media-downloader";
// Task #155: worker-only auth health probe. Imported here (not by the
// API entrypoint) so DB-stored cookie bytes can ONLY be materialized
// inside the worker process.
import { startAuthHealthProbe } from "./lib/auth-health-probe";
import { startKnowledgeScheduler } from "./lib/knowledge/scheduler";
import { startSupportKnowledgeScheduler } from "./support-bot/knowledge-ingest";
import { ensureBackgroundMusicImportedOnBoot } from "./lib/dfy-background-music-importer";
import { ensurePlatinumClubResourcesSeeded } from "./lib/ensure-platinum-club-resources";
import { ensurePlatinumClubBuildsSeeded } from "./lib/ensure-platinum-club-builds";
import {
  ensureBridgePagesImportedOnBoot,
  scheduleNextWeeklyBridgePagesSync,
} from "./lib/dfy-bridge-pages-importer";
import {
  ensureAdvertorialPagesImportedOnBoot,
  scheduleNextWeeklyAdvertorialPagesSync,
} from "./lib/dfy-advertorial-pages-importer";
import {
  ensureFunnelTemplatesImportedOnBoot,
  scheduleNextWeeklyFunnelTemplatesSync,
} from "./lib/dfy-funnel-templates-importer";
import {
  startDfyDriveAssetsPeriodicSync,
  triggerImmediateSync,
  DRIVE_FOLDERS_TO_SYNC,
} from "./lib/dfy-drive-assets-importer";
import { startReactivationReminderScheduler } from "./lib/portal-reactivation-reminder";
import { ensureDfySchemaApplied } from "./lib/ensure-dfy-schema-applied";
import { runWorkers, type WorkerHostHandles } from "./workers/index";
import {
  getProviderAuthSnapshot,
  refreshProviderAuth,
  startProviderAuthPreflight,
} from "./lib/influencer-provider-preflight";
// Task #388: boot-time config sanity check. HIGGSFIELD_WEBHOOK_SECRET is
// optional, but in production its absence has two real costs:
//   1) every callback is accepted unsigned (logged loudly elsewhere), and
//   2) we cannot set `webhook.secret` on the dispatch body without
//      sending an empty string, which Higgsfield's validator rejects
//      with HTTP 422. The dispatcher now omits the field when the
//      secret is unset, but we still want operators to see a single
//      explicit boot-line warning so the missing secret is obvious in
//      the worker logs at startup.
if (!process.env.HIGGSFIELD_WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === "production") {
    logger.warn(
      "HIGGSFIELD_WEBHOOK_SECRET is not set. Higgsfield webhooks will be accepted unsigned and dispatch calls will omit webhook.secret. Set this secret to enable spoof protection.",
    );
  } else {
    logger.info(
      "HIGGSFIELD_WEBHOOK_SECRET is not set (non-production). Higgsfield dispatch will omit webhook.secret and webhook callbacks will be accepted unsigned.",
    );
  }
}

const mediaDisabled = process.env["MEDIA_WORKERS_DISABLED"] === "1";

let workerHost: WorkerHostHandles | null = null;

function startMediaPipeline(): void {
  if (mediaDisabled) {
    logger.warn("MEDIA_WORKERS_DISABLED=1 set; media queue loops will not start");
    return;
  }
  // Task #155: this worker process is the ONLY runtime allowed to read
  // admin-uploaded cookies from object storage. Flip the resolver mode
  // before any media work kicks off so a fast restart doesn't race.
  try {
    setCookieResolverMode("db-and-env");
    startAuthHealthProbe();
  } catch (err) {
    logger.error({ err }, "auth health probe failed to start");
  }
  // Task #196: best-effort yt-dlp version probe at boot. Logs the
  // current binary version, the latest published version on PyPI, and
  // an `outdated` flag so an operator can spot extractor drift in the
  // worker boot logs without grepping the dashboard. Never blocks
  // pipeline start and never throws.
  void probeYtDlpRuntimeAtBoot();
  ensureAdResearchBoardFreshOnBoot()
    .catch((err) => logger.error({ err }, "adResearchBoard boot sync failed"))
    .finally(() => {
      processPendingMediaInBackground();
      logBootMediaStatusSummary().catch((err) =>
        logger.error({ err }, "logBootMediaStatusSummary failed"),
      );
      try {
        startPeriodicMediaProcessor();
        // Task #325: drain the long tail of legacy video rows that were
        // downloaded before the in-band thumbnail-cache code shipped, so
        // the ad-grid <img> poster path eventually covers every row.
        startPeriodicThumbnailBackfill();
        startQueueMetricsRecorder();
        // Task #237: fast-poll watcher for the queue-health reset
        // signal. Lets an admin-triggered reset clear the worker's
        // in-memory provider counters within seconds rather than
        // waiting up to QUEUE_METRICS_INTERVAL_MS for the next
        // snapshot tick.
        startQueueMetricsResetWatcher();
      } catch (err) {
        logger.error({ err }, "media-downloader scaling timers failed to start");
      }
    });
  scheduleNextDailyAdResearchBoardSync();
  ensureFunnelsResearchBoardFreshOnBoot().catch((err) =>
    logger.error({ err }, "funnelsResearchBoard boot sync failed"),
  );
  scheduleNextDailyFunnelsResearchBoardSync();
  startKnowledgeScheduler();
  startSupportKnowledgeScheduler();
  // Task #498: self-heal any missed DFY-related migration on this DB
  // (subfolder catalog, sheet-sync columns, advertorial pages catalog)
  // BEFORE the importers/sync schedulers below run any queries against
  // those tables. Idempotent CREATE/ALTER IF NOT EXISTS only; no data
  // backfills (those still go through the migration runner per
  // replit.md). Awaited so importers downstream are guaranteed to see
  // the post-heal schema; a failure is logged and we still proceed so
  // the worker doesn't deadlock on a transient DDL hiccup.
  void (async () => {
    try {
      await ensureDfySchemaApplied();
    } catch (err) {
      logger.error({ err }, "ensureDfySchemaApplied (worker) failed");
    }
    ensureBackgroundMusicImportedOnBoot().catch((err) =>
      logger.error({ err }, "ensureBackgroundMusicImportedOnBoot boot hook failed"),
    );
    // T402: seed the bridge-pages catalog from the curated Google Sheet
    // and re-sync once a week so any new rows Greg adds appear without
    // admin work in the portal UI. Manual rows are never touched.
    ensureBridgePagesImportedOnBoot().catch((err) =>
      logger.error({ err }, "ensureBridgePagesImportedOnBoot boot hook failed"),
    );
    scheduleNextWeeklyBridgePagesSync();
    // T441: same flow for the 20 Advertorial Page Templates gallery.
    ensureAdvertorialPagesImportedOnBoot().catch((err) =>
      logger.error({ err }, "ensureAdvertorialPagesImportedOnBoot boot hook failed"),
    );
    scheduleNextWeeklyAdvertorialPagesSync();
    // Mirror the bridge-pages flow for the 5+ Sales Funnel Templates
    // gallery: seed from the curated sheet on first boot, then re-sync
    // weekly. Manual admin-added rows are left alone.
    ensureFunnelTemplatesImportedOnBoot().catch((err) =>
      logger.error({ err }, "ensureFunnelTemplatesImportedOnBoot boot hook failed"),
    );
    scheduleNextWeeklyFunnelTemplatesSync();
    // T313: keep dfy_drive_assets in sync with the configured Drive folders
    // (250+ Scenes + 100 AI Influencers) so the gallery serves from the DB
    // and GCS instead of proxying live Drive thumbnails.
    try {
      startDfyDriveAssetsPeriodicSync();
    } catch (err) {
      logger.error({ err }, "startDfyDriveAssetsPeriodicSync failed");
    }
    // Task #498: kick an immediate Drive sync per configured slug after
    // schema heal so a boot recovering from missing tables (the #498
    // symptom) restores the DFY tiles within seconds rather than
    // waiting for the next periodic tick. triggerImmediateSync respects
    // per-slug concurrency / cadence guards so this is safe to call on
    // every boot - duplicates collapse into the running sync.
    for (const slug of Object.keys(DRIVE_FOLDERS_TO_SYNC)) {
      triggerImmediateSync(slug).catch((err) =>
        logger.warn(
          { event: "dfy-drive-sync-boot-trigger-failed", slug, err: err instanceof Error ? err.message : String(err) },
          `dfy-drive-sync: boot-triggered sync for ${slug} failed`,
        ),
      );
    }
  })();
  // Task #299: daily reminder to buyers who got the invite/account-ready
  // email but never actually signed in. Lives on the worker so the API
  // process never spends time iterating portal_users for outbound mail.
  try {
    startReactivationReminderScheduler();
  } catch (err) {
    logger.error({ err }, "reactivation reminder scheduler failed to start");
  }
}

function startAutomationWorkers(): void {
  try {
    workerHost = runWorkers();
  } catch (err) {
    logger.error({ err }, "automation workers failed to start");
  }
}

function startHealthServer(): void {
  const rawPort = process.env["WORKER_HEALTH_PORT"];
  if (!rawPort) return;
  const port = Number(rawPort);
  if (!Number.isFinite(port) || port <= 0) {
    logger.warn({ rawPort }, "invalid WORKER_HEALTH_PORT; skipping health endpoint");
    return;
  }
  const server = http.createServer(async (req, res) => {
    if (req.url === "/healthz") {
      // Task #200: mirror the API healthz contract so the same field
      // names are usable by deploy / observability tooling for either
      // runtime.
      // Task #209: also surface the cached yt-dlp runtime info so an
      // operator can hit either healthz endpoint to read the live
      // extractor version. Worker is the canonical source (the boot
      // probe runs here) so this read is always cache-warm.
      let ytDlp: {
        ytDlpVersion: string | null;
        ytDlpLatestVersion: string | null;
        ytDlpOutdated: boolean | null;
        ytDlpCheckedAt: string;
        ytDlpError?: string;
      } | null = null;
      try {
        const info = await getYtDlpRuntimeInfo();
        ytDlp = {
          ytDlpVersion: info.current,
          ytDlpLatestVersion: info.latest,
          ytDlpOutdated: info.outdated,
          ytDlpCheckedAt: info.checkedAt,
          ...(info.error ? { ytDlpError: info.error } : {}),
        };
      } catch {
        ytDlp = null;
      }
      // Task #261: boot health contract — populated providerAuth on
      // every healthz response. Awaits the inflight preflight on
      // cache miss (de-duped by refreshProviderAuth itself).
      let providerAuth = getProviderAuthSnapshot();
      if (!providerAuth) {
        try {
          providerAuth = await refreshProviderAuth();
        } catch {
          providerAuth = null;
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          buildSha: process.env.BUILD_SHA || "unknown",
          builtAt: process.env.BUILT_AT || null,
          runtime: "worker",
          pid: process.pid,
          // Task #598: surface KIT + WATI config status on the worker
          // healthz too (mirrors the API contract) so a single probe
          // can verify the contact-mirror pipeline end-to-end.
          ...(() => {
            try {
              const kitOk = !!process.env.KIT_API_KEY?.trim();
              const watiOk =
                !!process.env.WATI_API_KEY?.trim() && !!process.env.WATI_BASE_URL?.trim();
              return {
                kitConfigOk: kitOk,
                watiConfigOk: watiOk,
                ...(watiOk ? {} : { watiConfigError: "WATI_API_KEY / WATI_BASE_URL not set" }),
              };
            } catch {
              return { kitConfigOk: false, watiConfigOk: false };
            }
          })(),
          ytDlp,
          providerAuth,
        }),
      );
      return;
    }
    // Deployment startup probes may hit "/" (default probe path). Answer
    // 200 there too so a probe misconfiguration can never fail a publish.
    if (req.url === "/" || req.url === "") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", runtime: "worker" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => logger.info({ port }, "worker healthz listening"));
}

startMediaPipeline();
startAutomationWorkers();
startHealthServer();

// Seed the Platinum Club "Agency Growth Blueprint" content library. Runs
// unconditionally at worker boot (NOT gated by MEDIA_WORKERS_DISABLED) since
// it is a pure DB-only idempotent loader with no media-queue dependency.
// Publish ships the table but skips data backfills, so this loader owns the
// row content (seed-if-empty only - never overwrites admin-managed rows; the
// table is owned by the in-portal admin panel once seeded).
ensurePlatinumClubResourcesSeeded().catch((err) =>
  logger.error({ err }, "ensurePlatinumClubResourcesSeeded boot hook failed"),
);

// DFY Builds taxonomy seed (seed-if-empty; admin-owned once seeded). Recreates
// the May + June starter builds so existing resources map to the right build.
ensurePlatinumClubBuildsSeeded().catch((err) =>
  logger.error({ err }, "ensurePlatinumClubBuildsSeeded boot hook failed"),
);

// Influencer-jobs pipeline tick (Slice 3/4). Lightweight Postgres-backed
// worker that dispatches Higgsfield, finalizes when eta_at passes, and
// fires the in-portal notification + Resend email.
//
// Task #708: generation is now handed off to Viktor via Slack + the
// external API, so the internal Higgsfield/Enhancor loop is OFF by
// default. Flip INFLUENCER_INTERNAL_PIPELINE_ENABLED=1 to roll back
// to the in-process pipeline. Code is left in place intentionally.
import { startInfluencerJobsWorker } from "./workers/influencer-jobs-worker";
import { isInternalInfluencerPipelineEnabled } from "./lib/viktor-slack";
if (isInternalInfluencerPipelineEnabled()) {
  startInfluencerJobsWorker();
} else {
  logger.warn(
    { task: 708 },
    "influencer internal pipeline disabled (INFLUENCER_INTERNAL_PIPELINE_ENABLED!=1); Viktor handles generation via external API",
  );
}

// Slice D - Provider telemetry hourly rollup. Aggregates the previous
// hour of provider_execution_events into a provider_health_snapshots
// row per provider. Idempotent (unique (provider, window_start)).
// Honors AUTOMATION_WORKERS_DISABLED=1.
import { startProviderTelemetryRollup } from "./lib/provider-telemetry-rollup";
startProviderTelemetryRollup();

// Task #261: provider auth preflight loop. Runs in the worker so the
// pipeline-owning runtime is the source of truth for "are providers
// reachable right now?". The API health endpoint reads from the same
// in-process cache populated here when running in the same node.
// Task #708: also gated by INFLUENCER_INTERNAL_PIPELINE_ENABLED.
// The preflight only probes Higgsfield/Enhancor, which are dormant
// when Viktor owns generation - keeping it on would burn API credits
// and noise the health endpoint with red checks that no buyer path
// reads anymore.
if (isInternalInfluencerPipelineEnabled()) {
  startProviderAuthPreflight();
} else {
  logger.warn(
    { task: 708 },
    "provider auth preflight disabled (INFLUENCER_INTERNAL_PIPELINE_ENABLED!=1)",
  );
}

// Task #828: AI Video Studio HeyGen polling fallback. Picks up video_jobs
// still "generating" and resolves them via the same finalize/fail path as
// the HeyGen webhook, plus fails+refunds jobs past the generation timeout.
// Honors VIDEO_POLLER_DISABLED=1 and silently skips when HeyGen is unset.
import { startVideoJobPoller } from "./lib/video-job-poller";
startVideoJobPoller();

// In-Replit podcast auto-edit worker (Task #839). Claims editStatus='pending'
// jobs and runs the ffmpeg SOP edit on the worker (never the web server).
// Self-guards on MEDIA_WORKERS_DISABLED.
import { startVideoEditWorker } from "./lib/video-edit-worker";
startVideoEditWorker();

// Command Center nightly attribution rollup. Runs at 02:15 UTC each day
// (10 min after the revenue rollup). Aggregates yesterday's cc_conversions
// by channel/campaign into cc_daily_attribution so the Attribution tab can
// query pre-computed totals for charts. Honors CC_ATTRIBUTION_ROLLUP_DISABLED=1.
import { startCcDailyAttributionRollup } from "./lib/cc-daily-attribution-scheduler";
startCcDailyAttributionRollup();

// Task #797: Evergreen Webinar session generator + status sweep. Every
// 5 min ensures the next N nightly sessions exist and flips
// scheduled -> live -> ended by the wall clock. Honors
// WEBINAR_SCHEDULER_DISABLED=1.
import { startWebinarSessionScheduler } from "./lib/webinar-session-scheduler";
startWebinarSessionScheduler();

// Task #774: daily prevention audit layer. Runs read-only health
// audits (entitlement drift, paid buyers missing an AI Influencer build,
// unreachable workshop-recording Wistia media) once a
// day and posts a summarized #ops Slack alert on any finding. Prod-only
// (DAILY_HEALTH_CHECK_ALLOW_DEV=1 to run in dev), kill switch
// DAILY_HEALTH_CHECK_DISABLED=1.
import { startDailyHealthCheckScheduler } from "./lib/daily-health-check-scheduler";
startDailyHealthCheckScheduler();

// Steph (AI support bot) daily Slack digest. Once a day (default 07:00
// UTC, SUPPORT_BOT_SUMMARY_HOUR_UTC to change) the worker summarizes the
// last 24h of support bot conversations - major issues, what the bot
// sorted, what needed a human, improvement ideas - and posts it to
// SUPPORT_BOT_SLACK_WEBHOOK_URL (falls back to OPS_SLACK_WEBHOOK_URL).
// Prod-only (SUPPORT_BOT_SUMMARY_ALLOW_DEV=1 to run in dev), kill switch
// SUPPORT_BOT_SUMMARY_DISABLED=1.
import { startSupportBotDailySummaryScheduler } from "./support-bot/daily-summary";
startSupportBotDailySummaryScheduler();


// GHL not-purchased tagger. Every minute scans funnel_leads older
// than 5 min with no purchase, tags them "not-purchased" in
// GoHighLevel and stamps the one-shot gate column. Honors
// GHL_SYNC_DISABLED=1; idles silently if GHL_API_KEY / GHL_LOCATION_ID
// are unset.
import { startGhlNotPurchasedScheduler } from "./lib/ghl-sync";
startGhlNotPurchasedScheduler();

// Task #608: hourly Calendly reconciler. Lives on the worker per the
// runtime-layout rule in replit.md so a webhook outage cannot leave
// the CRM blind to bookings. Honors MEDIA_WORKERS_DISABLED=1 itself.
import { startCrmCalendlyReconciler } from "./lib/crm-calendly-reconciler";
startCrmCalendlyReconciler();

// Platinum Club workshop reminder scheduler. Every 5 min checks for
// workshops whose startsAt is in the 24h-out or 15m-out window and
// sends the corresponding email blast to every Platinum Club member.
// Idempotent via atomic UPDATE WHERE reminder_*_sent_at IS NULL so
// rolling restarts cannot double-blast. Honors
// WORKSHOP_REMINDERS_DISABLED=1.
import { startWorkshopReminderScheduler } from "./lib/workshop-reminder-scheduler";
startWorkshopReminderScheduler();

// Task #647: alert ops when the in-process CRM mirror falls behind.
// Compares trailing-hour buyer/portal email counts against crm_contacts
// and emails operators when the missing delta sustains above threshold.
// Honors CRM_INGEST_ALARM_DISABLED=1.
import { startCrmIngestHealthAlarm } from "./lib/crm-ingest-health-alarm";
startCrmIngestHealthAlarm();

// Task #778: research generation stale-job sweeper. Every 5 min flips
// any research_generation_jobs row stuck in pending/processing with no
// updatedAt progress for ~20 min to status=error, so a hung
// fire-and-forget generation (process restart mid-run, or a hung
// LLM/scrape step) can never block the user behind the 409
// "already in progress" guard indefinitely. Atomic UPDATE scoped by
// status + staleness, safe across rolling restarts. Honors
// RESEARCH_JOB_SWEEPER_DISABLED=1.
import { startResearchJobSweeperScheduler } from "./lib/research-job-sweeper-scheduler";
startResearchJobSweeperScheduler();

// AI Influencer overdue-delivery watchdog. Under the external Viktor-delivery
// model, re-alerts the team at 24h undelivered and auto-fails at 72h (which
// returns the buyer's build slot and surfaces the portal Retry path). No-op
// when the internal pipeline owns generation. Honors
// INFLUENCER_OVERDUE_WATCHDOG_DISABLED=1.
import { startInfluencerOverdueWatchdog } from "./lib/influencer-overdue-watchdog";
startInfluencerOverdueWatchdog();

// ── Graceful shutdown ────────────────────────────────────────────────────
// Stop the automation worker host (which itself stops claiming new jobs
// and awaits the in-flight pass per `WorkerPool.stop`). The media queue
// is intentionally NOT drained in-process because `media-downloader.ts`
// is out of scope for this task; the Postgres lease + heartbeat (see
// header note above) makes a hard exit during an in-flight media pass
// safe — the lease expires and the next worker re-claims the row. A 30s
// drain-timeout safety valve forces exit if shutdown otherwise stalls.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down");
  const drainTimeout = setTimeout(() => {
    logger.warn("worker drain timeout exceeded (30s); forcing exit");
    process.exit(1);
  }, 30_000);
  drainTimeout.unref?.();
  try {
    if (workerHost) {
      await workerHost.stop();
    }
  } catch (err) {
    logger.error({ err }, "error during worker host stop");
  }
  clearTimeout(drainTimeout);
  logger.info("worker shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
