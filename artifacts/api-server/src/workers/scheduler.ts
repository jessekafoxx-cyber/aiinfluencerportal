import { db } from "@workspace/db";
import { ScheduleSweeper, type WorkflowRegistry } from "@workspace/automation-core";
import type { JobQueue } from "@workspace/job-queue";
import { logger } from "../lib/logger";

export interface SchedulerLoopOptions {
  jobQueue: JobQueue;
  workflows: WorkflowRegistry;
  /** Tick interval in ms (default 30s). */
  intervalMs?: number;
}

/**
 * Polling loop that runs the schedule sweeper at a fixed cadence. Cron parsing
 * is intentionally pluggable on `ScheduleSweeper`; the default just bumps
 * next_run_at by 1h until a real cron parser is wired in.
 */
export class SchedulerLoop {
  private readonly sweeper: ScheduleSweeper;
  private readonly intervalMs: number;
  private readonly abort = new AbortController();
  private running: Promise<void> | null = null;

  constructor(opts: SchedulerLoopOptions) {
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.sweeper = new ScheduleSweeper({
      db,
      jobQueue: opts.jobQueue,
      workflows: opts.workflows,
      log: (level, msg, meta) => logger[level]({ ...meta }, msg),
    });
  }

  start(): void {
    if (this.running) return;
    this.running = this.loop();
    logger.info({ intervalMs: this.intervalMs }, "Scheduler loop started");
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.running) await this.running;
    this.running = null;
    logger.info("Scheduler loop stopped");
  }

  private async loop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const result = await this.sweeper.sweep();
        if (result.scanned > 0) {
          logger.info({ scanned: result.scanned, enqueued: result.enqueued }, "Schedule sweep tick");
        }
      } catch (err) {
        logger.error({ err }, "Schedule sweep failed");
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
