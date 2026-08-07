import { sql, eq, and, inArray, lt, lte } from "drizzle-orm";
import type { db as DB } from "@workspace/db";
import {
  automationJobsTable,
  automationJobEventsTable,
  JOB_STATUS,
  type AutomationJob,
} from "@workspace/db";
import {
  type EnqueueInput,
  type EnqueueResult,
  type ClaimNextInput,
  type HeartbeatInput,
  type CompleteInput,
  type FailInput,
  type CancelInput,
  type RequeueStuckInput,
  type AppendEventInput,
  JobNotFoundError,
  JobLockMismatchError,
} from "./types";

type Db = typeof DB;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DEFAULT_LOCK_TTL_MS = 60_000;
const DEFAULT_BASE_BACKOFF_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface JobQueueOptions {
  db: Db;
  defaultLockTtlMs?: number;
  defaultBaseBackoffMs?: number;
  defaultMaxBackoffMs?: number;
}

export class JobQueue {
  private readonly db: Db;
  private readonly defaultLockTtlMs: number;
  private readonly defaultBaseBackoffMs: number;
  private readonly defaultMaxBackoffMs: number;

  constructor(opts: JobQueueOptions) {
    this.db = opts.db;
    this.defaultLockTtlMs = opts.defaultLockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.defaultBaseBackoffMs = opts.defaultBaseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.defaultMaxBackoffMs = opts.defaultMaxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const runAt = input.runAt ?? new Date();
    const values = {
      type: input.type,
      payload: input.payload ?? {},
      workspaceId: input.workspaceId ?? null,
      userId: input.userId,
      workflowId: input.workflowId ?? null,
      influencerId: input.influencerId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      runAt,
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 5,
      status: JOB_STATUS.QUEUED,
    };

    return this.db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const inserted = await tx
          .insert(automationJobsTable)
          .values(values)
          .onConflictDoNothing({
            target: automationJobsTable.idempotencyKey,
            where: sql`${automationJobsTable.idempotencyKey} IS NOT NULL`,
          })
          .returning();
        if (inserted.length > 0) {
          await this.appendEventInternal(tx, {
            jobId: inserted[0]!.id,
            eventType: "enqueued",
            message: `Enqueued job of type ${input.type}`,
          });
          return { job: inserted[0]!, enqueued: true };
        }
        const existing = await tx
          .select()
          .from(automationJobsTable)
          .where(eq(automationJobsTable.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (existing.length === 0) {
          throw new Error("enqueue: conflict but no existing row found");
        }
        return { job: existing[0]!, enqueued: false };
      }

      const [job] = await tx.insert(automationJobsTable).values(values).returning();
      await this.appendEventInternal(tx, {
        jobId: job!.id,
        eventType: "enqueued",
        message: `Enqueued job of type ${input.type}`,
      });
      return { job: job!, enqueued: true };
    });
  }

  async claimNext(input: ClaimNextInput): Promise<AutomationJob | null> {
    const limit = input.limit ?? 1;
    const lockTtlMs = input.lockTtlMs ?? this.defaultLockTtlMs;
    const now = new Date();
    const stuckBefore = new Date(now.getTime() - lockTtlMs);

    const typeFilter =
      input.types && input.types.length > 0
        ? sql`AND ${automationJobsTable.type} IN (${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `,
          )})`
        : sql``;

    return this.db.transaction(async (tx) => {
      const selected = await tx.execute(sql`
        SELECT id FROM ${automationJobsTable}
        WHERE (
          (${automationJobsTable.status} IN (${JOB_STATUS.QUEUED}, ${JOB_STATUS.RETRYING}) AND ${automationJobsTable.runAt} <= ${now})
          OR (${automationJobsTable.status} = ${JOB_STATUS.RUNNING} AND ${automationJobsTable.lockedAt} < ${stuckBefore})
        )
        ${typeFilter}
        ORDER BY ${automationJobsTable.priority} DESC, ${automationJobsTable.runAt} ASC, ${automationJobsTable.id} ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const rows = (selected as { rows: unknown[] }).rows ?? (selected as unknown as unknown[]);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const id = Number((rows[0] as { id: number | string }).id);

      const updated = await tx
        .update(automationJobsTable)
        .set({
          status: JOB_STATUS.RUNNING,
          lockedAt: now,
          lockedBy: input.workerId,
          startedAt: sql`COALESCE(${automationJobsTable.startedAt}, ${now})`,
          attempts: sql`${automationJobsTable.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(automationJobsTable.id, id))
        .returning();
      const claimed = updated[0] ?? null;
      if (claimed) {
        await this.appendEventInternal(tx, {
          jobId: claimed.id,
          eventType: "claimed",
          message: `Claimed by worker ${input.workerId}`,
          metadata: { workerId: input.workerId, attempt: claimed.attempts },
        });
      }
      return claimed;
    });
  }

  async heartbeat(input: HeartbeatInput): Promise<AutomationJob> {
    const now = new Date();
    const updated = await this.db
      .update(automationJobsTable)
      .set({ lockedAt: now, updatedAt: now })
      .where(
        and(
          eq(automationJobsTable.id, input.jobId),
          eq(automationJobsTable.lockedBy, input.workerId),
          eq(automationJobsTable.status, JOB_STATUS.RUNNING),
        ),
      )
      .returning();
    if (updated.length === 0) {
      const exists = await this.db
        .select({ id: automationJobsTable.id })
        .from(automationJobsTable)
        .where(eq(automationJobsTable.id, input.jobId))
        .limit(1);
      if (exists.length === 0) throw new JobNotFoundError(input.jobId);
      throw new JobLockMismatchError(input.jobId, input.workerId);
    }
    return updated[0]!;
  }

  async complete(input: CompleteInput): Promise<AutomationJob> {
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, input.jobId);
      if (input.workerId && job.lockedBy && job.lockedBy !== input.workerId) {
        throw new JobLockMismatchError(input.jobId, input.workerId);
      }
      const [row] = await tx
        .update(automationJobsTable)
        .set({
          status: JOB_STATUS.COMPLETED,
          completedAt: now,
          lockedAt: null,
          lockedBy: null,
          result: input.result ?? null,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(automationJobsTable.id, input.jobId))
        .returning();
      await this.appendEventInternal(tx, {
        jobId: input.jobId,
        eventType: "completed",
        message: "Job completed",
        metadata: input.result ? { result: input.result } : undefined,
      });
      return row!;
    });
    return updated;
  }

  async fail(input: FailInput): Promise<AutomationJob> {
    const now = new Date();
    const baseBackoffMs = input.baseBackoffMs ?? this.defaultBaseBackoffMs;
    const maxBackoffMs = input.maxBackoffMs ?? this.defaultMaxBackoffMs;
    return this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, input.jobId);
      if (input.workerId && job.lockedBy && job.lockedBy !== input.workerId) {
        throw new JobLockMismatchError(input.jobId, input.workerId);
      }
      const retryable = input.retryable ?? true;
      const willRetry = retryable && job.attempts < job.maxAttempts;
      if (willRetry) {
        const delay = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, job.attempts));
        const nextRunAt = new Date(now.getTime() + delay);
        const [row] = await tx
          .update(automationJobsTable)
          .set({
            status: JOB_STATUS.RETRYING,
            runAt: nextRunAt,
            lockedAt: null,
            lockedBy: null,
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage ?? null,
            updatedAt: now,
          })
          .where(eq(automationJobsTable.id, input.jobId))
          .returning();
        await this.appendEventInternal(tx, {
          jobId: input.jobId,
          eventType: "failed_retrying",
          message: input.errorMessage ?? "Job failed, will retry",
          metadata: {
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            attempts: job.attempts,
            nextRunAt: nextRunAt.toISOString(),
            delayMs: delay,
          },
        });
        return row!;
      }

      const [row] = await tx
        .update(automationJobsTable)
        .set({
          status: JOB_STATUS.FAILED,
          failedAt: now,
          lockedAt: null,
          lockedBy: null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          updatedAt: now,
        })
        .where(eq(automationJobsTable.id, input.jobId))
        .returning();
      await this.appendEventInternal(tx, {
        jobId: input.jobId,
        eventType: "failed",
        message: input.errorMessage ?? "Job failed",
        metadata: {
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          attempts: job.attempts,
          terminal: true,
        },
      });
      return row!;
    });
  }

  async cancel(input: CancelInput): Promise<AutomationJob> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const job = await this.lockJob(tx, input.jobId);
      if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.CANCELLED) {
        return job;
      }
      const [row] = await tx
        .update(automationJobsTable)
        .set({
          status: JOB_STATUS.CANCELLED,
          lockedAt: null,
          lockedBy: null,
          updatedAt: now,
        })
        .where(eq(automationJobsTable.id, input.jobId))
        .returning();
      await this.appendEventInternal(tx, {
        jobId: input.jobId,
        eventType: "cancelled",
        message: input.reason ?? "Job cancelled",
      });
      return row!;
    });
  }

  async requeueStuck(input: RequeueStuckInput): Promise<AutomationJob[]> {
    const cutoff = new Date(Date.now() - input.olderThanMs);
    const limit = input.limit ?? 100;
    return this.db.transaction(async (tx) => {
      const stuck = await tx
        .select({ id: automationJobsTable.id })
        .from(automationJobsTable)
        .where(
          and(
            eq(automationJobsTable.status, JOB_STATUS.RUNNING),
            lt(automationJobsTable.lockedAt, cutoff),
          ),
        )
        .limit(limit);
      if (stuck.length === 0) return [];
      const ids = stuck.map((s) => s.id);
      const now = new Date();
      const updated = await tx
        .update(automationJobsTable)
        .set({
          status: JOB_STATUS.RETRYING,
          lockedAt: null,
          lockedBy: null,
          runAt: now,
          updatedAt: now,
        })
        .where(and(inArray(automationJobsTable.id, ids), eq(automationJobsTable.status, JOB_STATUS.RUNNING), lte(automationJobsTable.lockedAt, cutoff)))
        .returning();
      for (const row of updated) {
        await this.appendEventInternal(tx, {
          jobId: row.id,
          eventType: "requeued_stuck",
          message: "Requeued after stuck lock timeout",
        });
      }
      return updated;
    });
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    await this.appendEventInternal(this.db, input);
  }

  private async lockJob(tx: Tx, jobId: number): Promise<AutomationJob> {
    const locked = await tx.execute(
      sql`SELECT * FROM ${automationJobsTable} WHERE ${automationJobsTable.id} = ${jobId} FOR UPDATE`,
    );
    const rows = (locked as { rows: unknown[] }).rows ?? (locked as unknown as unknown[]);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new JobNotFoundError(jobId);
    }
    return mapJobRow(rows[0] as Record<string, unknown>);
  }

  private async appendEventInternal(
    runner: Db | Tx,
    input: AppendEventInput,
  ): Promise<void> {
    await runner.insert(automationJobEventsTable).values({
      jobId: input.jobId,
      eventType: input.eventType,
      message: input.message ?? null,
      metadata: input.metadata ?? null,
    });
  }
}

function mapJobRow(row: Record<string, unknown>): AutomationJob {
  return {
    id: Number(row["id"]),
    workspaceId: row["workspace_id"] == null ? null : Number(row["workspace_id"]),
    userId: Number(row["user_id"]),
    workflowId: row["workflow_id"] == null ? null : Number(row["workflow_id"]),
    influencerId: row["influencer_id"] == null ? null : Number(row["influencer_id"]),
    type: String(row["type"]),
    payload: (row["payload"] as Record<string, unknown>) ?? {},
    result: (row["result"] as Record<string, unknown> | null) ?? null,
    status: String(row["status"]),
    priority: Number(row["priority"]),
    attempts: Number(row["attempts"]),
    maxAttempts: Number(row["max_attempts"]),
    runAt: row["run_at"] as Date,
    lockedAt: (row["locked_at"] as Date | null) ?? null,
    lockedBy: (row["locked_by"] as string | null) ?? null,
    startedAt: (row["started_at"] as Date | null) ?? null,
    completedAt: (row["completed_at"] as Date | null) ?? null,
    failedAt: (row["failed_at"] as Date | null) ?? null,
    errorCode: (row["error_code"] as string | null) ?? null,
    errorMessage: (row["error_message"] as string | null) ?? null,
    idempotencyKey: (row["idempotency_key"] as string | null) ?? null,
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}
