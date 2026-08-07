import { sql, and, eq, lte } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import type { db as DB } from "@workspace/db";
import { automationSchedulesTable, type AutomationSchedule } from "@workspace/db";
import type { JobQueue } from "@workspace/job-queue";
import type { WorkflowRegistry } from "./registry";

type Db = typeof DB;

export interface ScheduleSweepOptions {
  db: Db;
  jobQueue: JobQueue;
  workflows: WorkflowRegistry;
  /** Cap of schedules processed per sweep (default 50). */
  batchSize?: number;
  log?: (
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ) => void;
  now?: () => Date;
  /**
   * Computes the next-run timestamp from a cron expression. We expose this as
   * a strategy so the host can choose a parser (e.g. cron-parser) without
   * pulling it into the lib.
   */
  computeNextRunAt?: (cron: string, timezone: string, after: Date) => Date;
}

const DEFAULT_BATCH_SIZE = 50;

const noopLog = (): void => undefined;

// Cron-aware next-run via `cron-parser`. On parse failure (bad cron / tz)
// falls back to +1h and logs, so a malformed schedule can't stall the sweep.
function defaultComputeNextRunAt(
  cron: string,
  tz: string,
  after: Date,
  log?: (
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ) => void,
): Date {
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: after,
      tz: tz || "UTC",
    });
    return interval.next().toDate();
  } catch (err) {
    log?.("warn", `Failed to parse cron '${cron}' tz='${tz}', defaulting to +1h`, {
      cron,
      tz,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Date(after.getTime() + 60 * 60 * 1000);
  }
}

export interface ScheduleSweepResult {
  enqueued: number;
  scanned: number;
}

// Enqueues workflow jobs for any schedule whose next_run_at <= now and
// advances next_run_at to the next cron occurrence.
export class ScheduleSweeper {
  private readonly db: Db;
  private readonly jobQueue: JobQueue;
  private readonly workflows: WorkflowRegistry;
  private readonly batchSize: number;
  private readonly log: (
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ) => void;
  private readonly now: () => Date;
  private readonly computeNextRunAt: (cron: string, timezone: string, after: Date) => Date;

  constructor(opts: ScheduleSweepOptions) {
    this.db = opts.db;
    this.jobQueue = opts.jobQueue;
    this.workflows = opts.workflows;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.log = opts.log ?? noopLog;
    this.now = opts.now ?? (() => new Date());
    this.computeNextRunAt =
      opts.computeNextRunAt ??
      ((cron: string, tz: string, after: Date): Date =>
        defaultComputeNextRunAt(cron, tz, after, this.log));
  }

  async sweep(): Promise<ScheduleSweepResult> {
    const now = this.now();
    const due = await this.db
      .select()
      .from(automationSchedulesTable)
      .where(
        and(
          eq(automationSchedulesTable.isActive, true),
          lte(automationSchedulesTable.nextRunAt, now),
        ),
      )
      .limit(this.batchSize);

    let enqueued = 0;
    for (const schedule of due) {
      try {
        await this.fireSchedule(schedule, now);
        enqueued += 1;
      } catch (err) {
        this.log("error", `Failed to fire schedule ${schedule.id}`, {
          scheduleId: schedule.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { enqueued, scanned: due.length };
  }

  private async fireSchedule(schedule: AutomationSchedule, now: Date): Promise<void> {
    const workflow = await this.resolveWorkflowSlug(schedule);
    if (!workflow) {
      this.log("warn", `Schedule ${schedule.id} references unknown workflow ${schedule.workflowId}`, {
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
      });
      return;
    }
    const idempotencyKey = `schedule:${schedule.id}:${schedule.nextRunAt.toISOString()}`;
    await this.jobQueue.enqueue({
      type: workflow,
      payload: {
        input: schedule.payload ?? {},
        scheduleId: schedule.id,
      },
      userId: schedule.userId,
      idempotencyKey,
    });
    const nextRunAt = this.computeNextRunAt(schedule.cron, schedule.timezone, now);
    await this.db
      .update(automationSchedulesTable)
      .set({
        lastRunAt: now,
        nextRunAt,
        updatedAt: now,
      })
      .where(eq(automationSchedulesTable.id, schedule.id));
  }

  private async resolveWorkflowSlug(schedule: AutomationSchedule): Promise<string | null> {
    // Walk the registry first; map id -> slug requires a small lookup query.
    const rows = await this.db.execute<{ slug: string }>(sql`
      SELECT slug FROM automation_workflows WHERE id = ${schedule.workflowId} LIMIT 1
    `);
    const slug = rows.rows?.[0]?.slug;
    if (!slug) return null;
    if (!this.workflows.get(slug)) {
      this.log("warn", `Schedule ${schedule.id} workflow slug '${slug}' not registered in process`, {
        scheduleId: schedule.id,
        slug,
      });
    }
    return slug;
  }
}
