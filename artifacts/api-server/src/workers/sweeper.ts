import type { JobQueue } from "@workspace/job-queue";
import { logger } from "../lib/logger";

export interface JobSweeperOptions {
  jobQueue: JobQueue;
  /** Tick interval in ms (default 60s). */
  intervalMs?: number;
  /** Threshold for considering a job's lock stuck (default 5 minutes). */
  stuckThresholdMs?: number;
}

/**
 * Periodically requeues jobs whose worker locks have expired without a
 * heartbeat. Acts as the safety net for crashed workers.
 */
export class JobSweeper {
  private readonly jobQueue: JobQueue;
  private readonly intervalMs: number;
  private readonly stuckThresholdMs: number;
  private readonly abort = new AbortController();
  private running: Promise<void> | null = null;

  constructor(opts: JobSweeperOptions) {
    this.jobQueue = opts.jobQueue;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.stuckThresholdMs = opts.stuckThresholdMs ?? 5 * 60_000;
  }

  start(): void {
    if (this.running) return;
    this.running = this.loop();
    logger.info(
      { intervalMs: this.intervalMs, stuckThresholdMs: this.stuckThresholdMs },
      "Job sweeper started",
    );
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.running) await this.running;
    this.running = null;
    logger.info("Job sweeper stopped");
  }

  private async loop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const requeued = await this.jobQueue.requeueStuck({
          olderThanMs: this.stuckThresholdMs,
          limit: 100,
        });
        if (requeued.length > 0) {
          logger.info({ count: requeued.length }, "Requeued stuck jobs");
        }
      } catch (err) {
        logger.error({ err }, "Job sweeper tick failed");
      }
      await this.sleep(this.intervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
