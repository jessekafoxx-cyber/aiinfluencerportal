import { eq } from "drizzle-orm";
import type { JobQueue } from "@workspace/job-queue";
import {
  db as defaultDb,
  automationWorkflowsTable,
  automationSchedulesTable,
} from "@workspace/db";
import type {
  NormalizedError,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
} from "@workspace/provider-adapters";
import { ProviderValidationError } from "@workspace/provider-adapters";

export interface InternalSchedulerInput {
  scheduledAt: string | Date;
  publishWorkflow?: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
}

export interface InternalSchedulerOutput {
  scheduledJobId: number;
  scheduleId: number;
  scheduledAt: string;
  publishWorkflow: string;
}

export interface InternalSchedulerAdapterOptions {
  jobQueue: JobQueue;
  db?: typeof defaultDb;
}

/**
 * Internal scheduler "provider" used by `schedule_post`. Persists a one-shot
 * row in `automation_schedules` AND enqueues a delayed `publish_post` job at
 * `runAt = scheduledAt`. Cost: 0 credits. Idempotent on `idempotencyKey`.
 */
export class InternalSchedulerAdapter
  implements ProviderAdapter<InternalSchedulerInput, InternalSchedulerOutput>
{
  readonly slug = "internal_scheduler";
  private readonly jobQueue: JobQueue;
  private readonly db: typeof defaultDb;

  constructor(opts: InternalSchedulerAdapterOptions) {
    this.jobQueue = opts.jobQueue;
    this.db = opts.db ?? defaultDb;
  }

  private async findOrCreateWorkflowId(slug: string): Promise<number> {
    const existing = await this.db
      .select({ id: automationWorkflowsTable.id })
      .from(automationWorkflowsTable)
      .where(eq(automationWorkflowsTable.slug, slug))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await this.db
      .insert(automationWorkflowsTable)
      .values({ slug, name: slug })
      .returning({ id: automationWorkflowsTable.id });
    if (!row) throw new Error(`Failed to upsert automation workflow ${slug}`);
    return row.id;
  }

  estimateCost(): number {
    return 0;
  }

  validateInput(input: InternalSchedulerInput): void {
    if (!input.scheduledAt) {
      throw new ProviderValidationError(
        this.slug,
        "scheduledAt is required (Date or ISO string)",
      );
    }
    const at = new Date(input.scheduledAt);
    if (Number.isNaN(at.getTime())) {
      throw new ProviderValidationError(
        this.slug,
        `scheduledAt is not a valid date: ${String(input.scheduledAt)}`,
      );
    }
    if (!input.payload || typeof input.payload !== "object") {
      throw new ProviderValidationError(this.slug, "payload (object) is required");
    }
  }

  async execute(
    input: InternalSchedulerInput,
    ctx: ProviderExecutionContext,
  ): Promise<ProviderResult<InternalSchedulerOutput>> {
    this.validateInput(input);
    const scheduledAt = new Date(input.scheduledAt);
    const publishWorkflow = input.publishWorkflow ?? "publish_post";
    const idempotencyKey =
      input.idempotencyKey ?? `schedule:${ctx.jobId ?? "anon"}:${ctx.stepIdx ?? 0}`;

    const workflowId = await this.findOrCreateWorkflowId(publishWorkflow);
    const [scheduleRow] = await this.db
      .insert(automationSchedulesTable)
      .values({
        userId: ctx.userId,
        workflowId,
        cron: "@once",
        timezone: "UTC",
        payload: input.payload,
        nextRunAt: scheduledAt,
        isActive: false,
      })
      .returning({ id: automationSchedulesTable.id });
    if (!scheduleRow) throw new Error("Failed to insert automation_schedules row");

    const enq = await this.jobQueue.enqueue({
      type: publishWorkflow,
      userId: ctx.userId,
      payload: input.payload,
      runAt: scheduledAt,
      idempotencyKey,
      ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
      ...(typeof input.maxAttempts === "number"
        ? { maxAttempts: input.maxAttempts }
        : {}),
    });

    return {
      status: "completed",
      output: {
        scheduledJobId: enq.job.id,
        scheduleId: scheduleRow.id,
        scheduledAt: scheduledAt.toISOString(),
        publishWorkflow,
      },
      actualCostCredits: 0,
    };
  }

  normalizeError(err: unknown): NormalizedError {
    if (err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { errorCode: "INTERNAL_SCHEDULER_ERROR", errorMessage: msg, retryable: true };
  }
}
