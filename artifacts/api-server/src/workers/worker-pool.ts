import { logger } from "../lib/logger";
import type { AutomationRuntime } from "./runner";

export interface WorkerPoolOptions {
  runtime: AutomationRuntime;
  /** Number of concurrent worker loops (default 2). */
  concurrency?: number;
  /** Idle poll interval in ms when no jobs are available (default 2000). */
  idleIntervalMs?: number;
  /** Job types to filter on; omit to claim all types. */
  types?: string[];
  /** Lock TTL passed to claimNext (default 60_000). */
  lockTtlMs?: number;
  /** Heartbeat interval while a job is running; must be < lockTtlMs. */
  heartbeatIntervalMs?: number;
}

export class WorkerPool {
  private readonly runtime: AutomationRuntime;
  private readonly concurrency: number;
  private readonly idleIntervalMs: number;
  private readonly types?: string[];
  private readonly lockTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly abort = new AbortController();
  private loops: Promise<void>[] = [];

  constructor(opts: WorkerPoolOptions) {
    this.runtime = opts.runtime;
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.idleIntervalMs = opts.idleIntervalMs ?? 2000;
    this.types = opts.types;
    this.lockTtlMs = opts.lockTtlMs ?? 60_000;
    this.heartbeatIntervalMs = Math.max(
      1_000,
      opts.heartbeatIntervalMs ?? Math.min(10_000, Math.floor(this.lockTtlMs / 4)),
    );
  }

  start(): void {
    if (this.loops.length > 0) return;
    for (let i = 0; i < this.concurrency; i++) {
      this.loops.push(this.runLoop(i));
    }
    logger.info({ concurrency: this.concurrency }, "Worker pool started");
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled(this.loops);
    this.loops = [];
    logger.info("Worker pool stopped");
  }

  private async runLoop(index: number): Promise<void> {
    const workerId = `${this.runtime.workerId}#${index}`;
    while (!this.abort.signal.aborted) {
      try {
        const job = await this.runtime.jobQueue.claimNext({
          workerId,
          types: this.types,
          lockTtlMs: this.lockTtlMs,
        });
        if (!job) {
          await this.sleep(this.idleIntervalMs);
          continue;
        }
        const heartbeatHandle = this.startHeartbeat(job.id, workerId);
        try {
          await this.runtime.runner.runJob(job, { workerId });
        } catch (err) {
          logger.error(
            {
              err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
              jobId: job.id,
              type: job.type,
            },
            "WorkflowRunner.runJob threw an unexpected error",
          );
          // Best-effort retryable fail to release the lock.
          try {
            await this.runtime.jobQueue.fail({
              jobId: job.id,
              workerId,
              errorCode: "WORKER_UNCAUGHT",
              errorMessage: err instanceof Error ? err.message : String(err),
              retryable: true,
            });
          } catch (failErr) {
            logger.error({ err: failErr, jobId: job.id }, "Failed to mark job failed after uncaught");
          }
        } finally {
          heartbeatHandle.stop();
        }
      } catch (err) {
        logger.error({ err, workerId }, "Worker loop iteration error");
        await this.sleep(this.idleIntervalMs);
      }
    }
  }

  private startHeartbeat(jobId: number, workerId: string): { stop: () => void } {
    const interval = setInterval(() => {
      this.runtime.jobQueue
        .heartbeat({ jobId, workerId })
        .catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : err, jobId, workerId },
            "Heartbeat failed (job may have been requeued by sweeper)",
          );
        });
    }, this.heartbeatIntervalMs);
    if (typeof interval.unref === "function") interval.unref();
    return {
      stop: () => clearInterval(interval),
    };
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
