import { logger } from "../lib/logger";
import { getAutomationRuntime } from "./runner";
import { buildAutomationCore } from "./workflows";
import { WorkerPool } from "./worker-pool";
import { SchedulerLoop } from "./scheduler";
import { JobSweeper } from "./sweeper";
import { WebhookProcessor } from "./webhook-processor";
import { startZeroConversionAlert, stopZeroConversionAlert } from "../lib/zero-conversion-alert";

export interface WorkerHostHandles {
  runtime: ReturnType<typeof getAutomationRuntime>;
  workerPool: WorkerPool;
  scheduler: SchedulerLoop;
  sweeper: JobSweeper;
  webhookProcessor: WebhookProcessor;
  stop: () => Promise<void>;
}

let started: WorkerHostHandles | null = null;

/**
 * Boots the in-process worker host: WorkflowRunner pool + scheduler sweeper +
 * stuck-lock sweeper. Idempotent — safe to call once after the http server is
 * listening.
 *
 * Set `AUTOMATION_WORKERS_DISABLED=1` to skip startup (useful for tests / cli
 * scripts that import the express app but should not consume jobs).
 */
export function runWorkers(): WorkerHostHandles | null {
  if (started) return started;
  if (process.env["AUTOMATION_WORKERS_DISABLED"] === "1") {
    logger.warn("AUTOMATION_WORKERS_DISABLED=1 set; worker host will not start");
    return null;
  }
  const runtime = getAutomationRuntime();
  const { workflows } = buildAutomationCore();
  const concurrency = parseIntOr(process.env["AUTOMATION_WORKER_CONCURRENCY"], 2);
  const idleIntervalMs = parseIntOr(process.env["AUTOMATION_WORKER_IDLE_INTERVAL_MS"], 2000);
  const lockTtlMs = parseIntOr(process.env["AUTOMATION_WORKER_LOCK_TTL_MS"], 60_000);
  // Heartbeat must comfortably beat the lock TTL; default lockTtl/4 capped at 10s.
  const heartbeatIntervalMs = parseIntOr(
    process.env["AUTOMATION_WORKER_HEARTBEAT_MS"],
    Math.min(10_000, Math.max(1_000, Math.floor(lockTtlMs / 4))),
  );

  const workerPool = new WorkerPool({
    runtime,
    concurrency,
    idleIntervalMs,
    lockTtlMs,
    heartbeatIntervalMs,
  });
  const scheduler = new SchedulerLoop({
    jobQueue: runtime.jobQueue,
    workflows,
    intervalMs: parseIntOr(process.env["AUTOMATION_SCHEDULER_INTERVAL_MS"], 30_000),
  });
  const sweeper = new JobSweeper({
    jobQueue: runtime.jobQueue,
    intervalMs: parseIntOr(process.env["AUTOMATION_SWEEPER_INTERVAL_MS"], 60_000),
    stuckThresholdMs: parseIntOr(process.env["AUTOMATION_SWEEPER_STUCK_MS"], 5 * 60_000),
  });
  const webhookProcessor = new WebhookProcessor({
    runtime,
    idleIntervalMs: parseIntOr(
      process.env["AUTOMATION_WEBHOOK_PROCESSOR_INTERVAL_MS"],
      2_000,
    ),
  });

  workerPool.start();
  scheduler.start();
  sweeper.start();
  webhookProcessor.start();
  // Funnel health check: alerts via logger.error if N consecutive paid main
  // orders (default 20 within 24h) flip ZERO upsell/downsell columns. See
  // lib/zero-conversion-alert.ts for tuning. Added in Task #454 after the
  // funnel ran 100+ paid orders with zero upsell conversions and no signal.
  startZeroConversionAlert();

  // ── Integration-test synthetic stuck pool ────────────────────────────────
  // Set AUTOMATION_SYNTHETIC_STUCK_POOL=1 **and** NODE_ENV=test in a
  // subprocess integration test to activate a pool whose single job never
  // resolves. This causes workerHost.stop() to block until the drain-timeout
  // safety valve in index.ts fires, exercising that path end-to-end without
  // a real slow workflow or DB job.
  // Both env vars MUST be absent in production. Requiring AUTOMATION_TEST_MODE
  // as a second independent gate means accidental production activation needs
  // two independent configuration errors simultaneously.
  let syntheticPool: WorkerPool | null = null;
  if (
    process.env["AUTOMATION_SYNTHETIC_STUCK_POOL"] === "1" &&
    process.env["AUTOMATION_TEST_MODE"] === "1"
  ) {
    logger.warn(
      "AUTOMATION_SYNTHETIC_STUCK_POOL=1 set; adding synthetic stuck pool for drain-timeout test",
    );
    const stuckRuntime = {
      workerId: "synthetic-stuck",
      jobQueue: {
        claimNext: async () => ({ id: -1, type: "synthetic-stuck", payload: {} }),
        heartbeat: async () => {},
        fail: async () => {},
      },
      runner: {
        runJob: async () =>
          new Promise<void>(() => {
            // deliberately never resolves — simulates a stuck provider call
          }),
      },
    } as unknown as ReturnType<typeof getAutomationRuntime>;
    syntheticPool = new WorkerPool({
      runtime: stuckRuntime,
      concurrency: 1,
      idleIntervalMs: 60_000,
      lockTtlMs: 60_000,
      heartbeatIntervalMs: 60_000,
    });
    syntheticPool.start();
  }

  const stop = async (): Promise<void> => {
    logger.info("Stopping automation worker host");
    stopZeroConversionAlert();
    await Promise.allSettled([
      workerPool.stop(),
      scheduler.stop(),
      sweeper.stop(),
      webhookProcessor.stop(),
      ...(syntheticPool ? [syntheticPool.stop()] : []),
    ]);
  };

  started = { runtime, workerPool, scheduler, sweeper, webhookProcessor, stop };

  return started;
}

function parseIntOr(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export { getAutomationRuntime } from "./runner";
export { buildAutomationCore } from "./workflows";
export { WorkerPool } from "./worker-pool";
export { SchedulerLoop } from "./scheduler";
export { JobSweeper } from "./sweeper";
export { WebhookProcessor } from "./webhook-processor";
