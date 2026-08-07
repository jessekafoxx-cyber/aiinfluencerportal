import { sql, eq } from "drizzle-orm";
import type { db as DB } from "@workspace/db";
import {
  automationJobsTable,
  creditReservationsTable,
  JOB_STATUS,
  RESERVATION_STATUS,
  type AutomationJob,
} from "@workspace/db";
import type { JobQueue } from "@workspace/job-queue";
import type { CreditEngine } from "@workspace/billing-engine";
import {
  CreditReservationRequiredError,
  ProviderConfigurationError,
  ProviderValidationError,
  ProviderExecutor,
  type NormalizedError,
  type ProviderAdapter,
  type ProviderRegistry,
  type ProviderResult,
  type ProviderStatus,
  type GuardedExecutionContext,
} from "@workspace/provider-adapters";
import type { WorkflowRegistry } from "./registry";
import type {
  WorkflowDefinition,
  WorkflowExecutionState,
  WorkflowStepContext,
  WorkflowStepDefinition,
} from "./types";

type Db = typeof DB;

export interface WorkflowRunnerOptions {
  db: Db;
  jobQueue: JobQueue;
  creditEngine: CreditEngine;
  workflows: WorkflowRegistry;
  adapters: ProviderRegistry;
  /** Worker identifier for job locking and logs. */
  workerId: string;
  /** Logger; defaults to a no-op when omitted. */
  log?: (
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ) => void;
  /** Fetches the current monotonic time; useful for tests. */
  now?: () => Date;
  /**
   * Optional callback invoked before every step's adapter.execute. When it
   * resolves to `true`, the step fails non-retryably with code
   * `PROVIDER_DISABLED` so admins can stop a misbehaving provider without
   * losing in-flight jobs (they surface in the Stuck Jobs / Provider Errors
   * admin views and can be retried after re-enabling).
   */
  isProviderDisabled?: (providerSlug: string) => Promise<boolean> | boolean;
}

export type WorkflowOutcome =
  | { kind: "completed"; jobId: number; outputs: Record<string, unknown> }
  | { kind: "waiting_provider"; jobId: number; providerSlug: string; externalRef: string; pollAfterMs?: number }
  | { kind: "failed"; jobId: number; errorCode: string; errorMessage: string; retryable: boolean };

const noopLog = (): void => undefined;

interface JobPayloadShape {
  input?: Record<string, unknown>;
  state?: WorkflowExecutionState;
  reservationId?: number;
  workspaceId?: number | null;
}

export class WorkflowRunner {
  private readonly db: Db;
  private readonly jobQueue: JobQueue;
  private readonly creditEngine: CreditEngine;
  private readonly workflows: WorkflowRegistry;
  private readonly adapters: ProviderRegistry;
  private readonly executor: ProviderExecutor;
  private readonly workerId: string;
  private readonly log: (
    level: "info" | "warn" | "error",
    msg: string,
    meta?: Record<string, unknown>,
  ) => void;
  private readonly now: () => Date;
  private readonly isProviderDisabled?: (
    providerSlug: string,
  ) => Promise<boolean> | boolean;

  constructor(opts: WorkflowRunnerOptions) {
    this.db = opts.db;
    this.jobQueue = opts.jobQueue;
    this.creditEngine = opts.creditEngine;
    this.workflows = opts.workflows;
    this.adapters = opts.adapters;
    this.workerId = opts.workerId;
    this.log = opts.log ?? noopLog;
    this.now = opts.now ?? (() => new Date());
    this.isProviderDisabled = opts.isProviderDisabled;

    const engine = this.creditEngine;
    this.executor = new ProviderExecutor({
      registry: this.adapters,
      validateReservation: async (ctx) => {
        const reservation = await engine.getReservation(ctx.reservationId);
        if (!reservation) {
          throw new CreditReservationRequiredError(
            `reservation ${ctx.reservationId} not found`,
          );
        }
        if (reservation.status !== RESERVATION_STATUS.HELD) {
          throw new CreditReservationRequiredError(
            `reservation ${ctx.reservationId} has status '${reservation.status}', expected 'held'`,
          );
        }
        if (reservation.userId !== ctx.userId) {
          throw new CreditReservationRequiredError(
            `reservation ${ctx.reservationId} belongs to user ${reservation.userId}, not ${ctx.userId}`,
          );
        }
        if (reservation.jobId !== null && ctx.jobId !== reservation.jobId) {
          throw new CreditReservationRequiredError(
            `reservation ${ctx.reservationId} belongs to job ${reservation.jobId}, not ${ctx.jobId}`,
          );
        }
      },
    });
  }

  /**
   * Runs a single claimed job through its workflow definition. Caller is
   * responsible for claiming the job via `jobQueue.claimNext` first.
   *
   * The optional `opts.workerId` overrides the runtime-default worker id for
   * all queue mutations (`heartbeat` / `complete` / `fail`) tied to this
   * single execution. Callers (e.g. WorkerPool with per-loop ids like
   * `<runtime>#<index>`) MUST pass the same id they used when claiming the
   * job, otherwise JobQueue will throw `JobLockMismatchError`.
   */
  async runJob(
    job: AutomationJob,
    opts: { workerId?: string } = {},
  ): Promise<WorkflowOutcome> {
    const callWorkerId = opts.workerId ?? this.workerId;
    const def = this.workflows.get(job.type);
    if (!def) {
      const msg = `No workflow registered for type '${job.type}'`;
      await this.failJob(job, "WORKFLOW_NOT_REGISTERED", msg, false, undefined, callWorkerId);
      return { kind: "failed", jobId: job.id, errorCode: "WORKFLOW_NOT_REGISTERED", errorMessage: msg, retryable: false };
    }

    const payload = (job.payload ?? {}) as JobPayloadShape;
    const state: WorkflowExecutionState = payload.state ?? {
      input: payload.input ?? {},
      outputs: {},
      nextStepIdx: 0,
    };

    let reservationId = payload.reservationId;
    const isLazyReservation = reservationId == null;
    if (reservationId == null) {
      try {
        reservationId = await this.reserveCredits(def, job, state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? "RESERVATION_FAILED";
        await this.failJob(job, code, msg, false, undefined, callWorkerId);
        return { kind: "failed", jobId: job.id, errorCode: code, errorMessage: msg, retryable: false };
      }
      await this.persistJobState(job.id, state, reservationId);
    }

    // Fire onStart after reservation is confirmed. Called on first execution
    // (isLazyReservation) and also on pre-reserved runs so all runs get the hook.
    if (def.onStart && state.nextStepIdx === 0 && !state.pending) {
      try {
        await def.onStart({ jobId: job.id, userId: job.userId, reservationId: reservationId!, state });
      } catch (startErr) {
        this.log("warn", `onStart hook threw for job ${job.id}`, {
          err: startErr instanceof Error ? startErr.message : String(startErr),
        });
      }
    }

    if (state.pending) {
      const status = await this.checkPending(
        def,
        job,
        state,
        payload,
        reservationId!,
      );
      if (status.kind !== "completed_step") {
        if (status.kind === "still_pending") {
          await this.persistJobState(job.id, state, reservationId);
          await this.scheduleFollowUp(job, status.pollAfterMs ?? 10_000);
          return {
            kind: "waiting_provider",
            jobId: job.id,
            providerSlug: state.pending.providerSlug,
            externalRef: state.pending.externalRef,
            pollAfterMs: status.pollAfterMs,
          };
        }
        // step failed
        return this.handleStepFailure(def, job, state, reservationId, status.error, callWorkerId);
      }
    }

    while (state.nextStepIdx < def.steps.length) {
      const step = def.steps[state.nextStepIdx]!;
      const adapter = this.resolveAdapter(step);
      const stepCtx: WorkflowStepContext = {
        jobId: job.id,
        userId: job.userId,
        workspaceId: payload.workspaceId ?? job.workspaceId ?? null,
        workflowSlug: def.slug,
        stepName: step.name,
        stepIdx: state.nextStepIdx,
        attempt: job.attempts + 1,
        log: (level, msg, meta) =>
          this.log(level, `[${def.slug}#${step.name}] ${msg}`, { jobId: job.id, ...meta }),
      };

      if (step.skipWhen) {
        let shouldSkip = false;
        try {
          shouldSkip = !!(await step.skipWhen(
            state as unknown as Record<string, unknown>,
            stepCtx,
          ));
        } catch (err) {
          const normalized = this.normalizeError(adapter, err);
          return this.handleStepFailure(def, job, state, reservationId, {
            ...normalized,
            stepName: step.name,
            stepIdx: state.nextStepIdx,
          }, callWorkerId);
        }
        if (shouldSkip) {
          const outputKey = step.outputKey ?? step.name;
          state.outputs[outputKey] = null;
          state.nextStepIdx += 1;
          await this.persistJobState(job.id, state, reservationId);
          await this.jobQueue.appendEvent({
            jobId: job.id,
            eventType: "step_skipped",
            message: `Step ${step.name} skipped by skipWhen predicate`,
            metadata: { stepIdx: stepCtx.stepIdx },
          });
          continue;
        }
      }

      let input: unknown;
      try {
        input = await step.inputMapping(state as unknown as Record<string, unknown>, stepCtx);
        if (adapter.validateInput) {
          await adapter.validateInput(input as never);
        }
      } catch (err) {
        const normalized = this.normalizeError(adapter, err);
        return this.handleStepFailure(def, job, state, reservationId, {
          ...normalized,
          stepName: step.name,
          stepIdx: state.nextStepIdx,
        }, callWorkerId);
      }

      if (this.isProviderDisabled) {
        let disabled = false;
        try {
          disabled = !!(await this.isProviderDisabled(step.provider));
        } catch (err) {
          this.log("warn", "isProviderDisabled callback threw", {
            providerSlug: step.provider,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        if (disabled) {
          return this.handleStepFailure(
            def,
            job,
            state,
            reservationId,
            {
              errorCode: "PROVIDER_DISABLED",
              errorMessage: `Provider ${step.provider} is currently disabled by an admin`,
              retryable: false,
              stepName: step.name,
              stepIdx: state.nextStepIdx,
            },
            callWorkerId,
          );
        }
      }

      const guardedCtx: GuardedExecutionContext = {
        jobId: job.id,
        userId: job.userId,
        workspaceId: payload.workspaceId ?? job.workspaceId ?? null,
        reservationId: reservationId!,
        workflowId: def.slug,
        actionType: step.name,
        provider: step.provider,
        stepIdx: state.nextStepIdx,
        state: state as unknown as Record<string, unknown>,
        log: stepCtx.log,
      };

      let result: ProviderResult<unknown>;
      try {
        result = await this.executor.executeAdapter(
          step.provider,
          adapter,
          input as never,
          guardedCtx,
        );
      } catch (err) {
        const normalized = this.normalizeError(adapter, err);
        return this.handleStepFailure(def, job, state, reservationId, {
          ...normalized,
          stepName: step.name,
          stepIdx: state.nextStepIdx,
        }, callWorkerId);
      }

      if (result.status === "waiting_provider") {
        state.pending = {
          stepIdx: state.nextStepIdx,
          providerSlug: step.provider,
          externalRef: result.externalRef,
        };
        await this.persistJobState(job.id, state, reservationId);
        await this.jobQueue.appendEvent({
          jobId: job.id,
          eventType: "step_pending",
          message: `Step ${step.name} waiting on provider`,
          metadata: { stepIdx: state.nextStepIdx, externalRef: result.externalRef },
        });
        await this.scheduleFollowUp(job, result.pollAfterMs ?? 10_000);
        return {
          kind: "waiting_provider",
          jobId: job.id,
          providerSlug: step.provider,
          externalRef: result.externalRef,
          pollAfterMs: result.pollAfterMs,
        };
      }

      const outputKey = step.outputKey ?? step.name;
      state.outputs[outputKey] = result.output;
      state.nextStepIdx += 1;
      delete state.pending;

      this.recordPendingBilling(state, step, state.nextStepIdx - 1, job.id, {
        actualCostCredits: result.actualCostCredits,
        providerCostCents: result.providerCostCents,
        externalRef: result.externalRef,
      });

      await this.jobQueue.appendEvent({
        jobId: job.id,
        eventType: "step_completed",
        message: `Step ${step.name} completed`,
        metadata: { stepIdx: state.nextStepIdx - 1, outputKey },
      });
      await this.persistJobState(job.id, state, reservationId);

      // Fire per-step hook for in-flight observability and partial cost tracking.
      if (def.onStepComplete) {
        try {
          await def.onStepComplete({
            jobId: job.id,
            userId: job.userId,
            stepName: step.name,
            stepIdx: state.nextStepIdx - 1,
            costCredits: result.actualCostCredits ?? 0,
            providerCostCents: result.providerCostCents ?? 0,
            output: result.output,
            state,
          });
        } catch (stepHookErr) {
          this.log("warn", `onStepComplete hook threw for job ${job.id} step ${step.name}`, {
            err: stepHookErr instanceof Error ? stepHookErr.message : String(stepHookErr),
          });
        }
      }
    }

    // Capture billing data BEFORE finalizeWithReservation clears pendingUsage.
    const pendingUsageSnapshot = state.pendingUsage ?? [];
    const totalCreditsCost = Math.max(
      0,
      Math.ceil(
        pendingUsageSnapshot.reduce(
          (sum, u) => sum + (Number.isFinite(u.costCredits) ? u.costCredits : 0),
          0,
        ),
      ),
    );
    const providerCostBreakdown: Record<string, number> = {};
    for (const u of pendingUsageSnapshot) {
      providerCostBreakdown[u.stepName] =
        (providerCostBreakdown[u.stepName] ?? 0) + u.costCredits;
    }

    await this.finalizeWithReservation(job, reservationId, state);
    await this.jobQueue.complete({
      jobId: job.id,
      result: { outputs: state.outputs },
      workerId: callWorkerId,
    });

    // Fire-and-forget lifecycle hook — failure must not affect the job outcome.
    if (def.onComplete) {
      try {
        await def.onComplete({ jobId: job.id, userId: job.userId, state, totalCreditsCost, providerCostBreakdown });
      } catch (hookErr) {
        this.log("warn", `onComplete hook threw for job ${job.id}`, {
          err: hookErr instanceof Error ? hookErr.message : String(hookErr),
        });
      }
    }

    return { kind: "completed", jobId: job.id, outputs: state.outputs };
  }

  private resolveAdapter(step: WorkflowStepDefinition): ProviderAdapter<unknown, unknown> {
    if (step.adapter) return step.adapter as ProviderAdapter<unknown, unknown>;
    return this.adapters.require(step.provider);
  }

  private normalizeError(
    adapter: ProviderAdapter<unknown, unknown>,
    err: unknown,
  ): NormalizedError {
    if (err instanceof CreditReservationRequiredError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    if (err instanceof ProviderValidationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    if (err instanceof ProviderConfigurationError) {
      return { errorCode: err.code, errorMessage: err.message, retryable: false };
    }
    if (adapter.normalizeError) {
      try {
        return adapter.normalizeError(err);
      } catch {
        // fall through
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { errorCode: "PROVIDER_ERROR", errorMessage: msg, retryable: true };
  }

  private async reserveCredits(
    def: WorkflowDefinition,
    job: AutomationJob,
    state: WorkflowExecutionState,
  ): Promise<number> {
    let estimate = 0;
    if (def.estimateCredits) {
      estimate = await def.estimateCredits(state.input);
    } else {
      for (const step of def.steps) {
        const adapter = this.resolveAdapter(step);
        try {
          const stepInput = await step.inputMapping(state as unknown as Record<string, unknown>, {
            jobId: job.id,
            userId: job.userId,
            workspaceId: job.workspaceId,
            workflowSlug: def.slug,
            stepName: step.name,
            stepIdx: 0,
            attempt: job.attempts + 1,
            log: () => undefined,
          });
          const cost = await adapter.estimateCost(stepInput as never);
          estimate += Number.isFinite(cost) ? cost : 0;
        } catch {
          // If a later step's input mapping depends on prior outputs, we will
          // still reserve a conservative single-credit floor below.
        }
      }
    }
    estimate = Math.max(1, Math.ceil(estimate));
    const reservation = await this.creditEngine.reserveCredits({
      userId: job.userId,
      workspaceId: job.workspaceId,
      jobId: job.id,
      amount: estimate,
      reason: `Workflow ${def.slug} estimate`,
      idempotencyKey: `job:${job.id}:reserve`,
    });
    return reservation.reservationId;
  }

  private async finalizeWithReservation(
    job: AutomationJob,
    reservationId: number | undefined,
    state: WorkflowExecutionState,
  ): Promise<void> {
    // Emit deferred usage / cost events ONLY on terminal success — this keeps
    // dead-lettered runs from leaving orphaned usage_events behind.
    const pendingUsage = state.pendingUsage ?? [];
    for (const u of pendingUsage) {
      await this.creditEngine.recordUsage({
        jobId: job.id,
        providerSlug: u.providerSlug,
        units: u.units ?? 1,
        costCredits: u.costCredits,
        metadata: { stepName: u.stepName, ...(u.metadata ?? {}) },
      });
    }
    const pendingCosts = state.pendingProviderCosts ?? [];
    for (const c of pendingCosts) {
      await this.creditEngine.recordProviderCost({
        providerSlug: c.providerSlug,
        externalRef: c.externalRef,
        costInCents: c.costInCents,
        units: c.units ?? 1,
        metadata: { jobId: job.id, stepName: c.stepName, ...(c.metadata ?? {}) },
      });
    }
    state.pendingUsage = [];
    state.pendingProviderCosts = [];

    if (reservationId == null) return;
    const actual = pendingUsage.reduce(
      (sum, u) => sum + (Number.isFinite(u.costCredits) ? u.costCredits : 0),
      0,
    );
    await this.creditEngine.finalizeReservation({
      reservationId,
      actualAmount: Math.max(0, Math.ceil(actual)),
      reason: `Workflow ${job.type} finalize`,
      idempotencyKey: `job:${job.id}:finalize`,
    });
  }

  private async handleStepFailure(
    def: WorkflowDefinition,
    job: AutomationJob,
    state: WorkflowExecutionState,
    reservationId: number | undefined,
    err: NormalizedError & { stepName?: string; stepIdx?: number },
    callWorkerId: string = this.workerId,
  ): Promise<WorkflowOutcome> {
    const step = def.steps[err.stepIdx ?? state.nextStepIdx];
    if (step?.optional) {
      const outputKey = step.outputKey ?? step.name;
      state.outputs[outputKey] = null;
      state.nextStepIdx = (err.stepIdx ?? state.nextStepIdx) + 1;
      delete state.pending;
      await this.persistJobState(job.id, state, reservationId);
      await this.jobQueue.appendEvent({
        jobId: job.id,
        eventType: "step_skipped",
        message: `Optional step ${step.name} failed: ${err.errorMessage}`,
        metadata: { errorCode: err.errorCode },
      });
      await this.scheduleFollowUp(job, 0);
      return {
        kind: "waiting_provider",
        jobId: job.id,
        providerSlug: step.provider,
        externalRef: "(optional-skip)",
      };
    }

    await this.persistJobState(job.id, state, reservationId);

    const updated = await this.failJob(
      job,
      err.errorCode,
      err.errorMessage,
      err.retryable,
      { stepName: err.stepName, stepIdx: err.stepIdx },
      callWorkerId,
    );

    const terminal = updated.status === JOB_STATUS.FAILED ||
      updated.status === JOB_STATUS.CANCELLED;
    if (terminal && reservationId != null) {
      await this.creditEngine.releaseReservation({
        reservationId,
        reason: `Workflow ${job.type} terminal: ${err.errorCode}`,
        idempotencyKey: `job:${job.id}:release`,
      });
    }

    // Fire-and-forget lifecycle hook — failure must not affect the job outcome.
    if (terminal && def.onFailed) {
      try {
        await def.onFailed({
          jobId: job.id,
          userId: job.userId,
          state,
          totalCreditsCost: 0,
          providerCostBreakdown: {},
          errorCode: err.errorCode,
          errorMessage: err.errorMessage,
        });
      } catch (hookErr) {
        this.log("warn", `onFailed hook threw for job ${job.id}`, {
          err: hookErr instanceof Error ? hookErr.message : String(hookErr),
        });
      }
    }

    return {
      kind: "failed",
      jobId: job.id,
      errorCode: err.errorCode,
      errorMessage: err.errorMessage,
      retryable: err.retryable,
    };
  }

  private async checkPending(
    def: WorkflowDefinition,
    job: AutomationJob,
    state: WorkflowExecutionState,
    payload: JobPayloadShape,
    reservationId: number,
  ): Promise<
    | { kind: "completed_step" }
    | { kind: "still_pending"; pollAfterMs?: number }
    | { kind: "step_failed"; error: NormalizedError & { stepName: string; stepIdx: number } }
  > {
    const pending = state.pending!;
    const step = def.steps[pending.stepIdx];
    if (!step) {
      return {
        kind: "step_failed",
        error: {
          errorCode: "WORKFLOW_STATE_CORRUPT",
          errorMessage: `pending step idx ${pending.stepIdx} out of range`,
          retryable: false,
          stepName: "(unknown)",
          stepIdx: pending.stepIdx,
        },
      };
    }
    const adapter = this.resolveAdapter(step);
    if (!adapter.getStatus) {
      return { kind: "still_pending", pollAfterMs: 30_000 };
    }
    const guardedCtx: GuardedExecutionContext = {
      jobId: job.id,
      userId: job.userId,
      workspaceId: payload.workspaceId ?? job.workspaceId ?? null,
      reservationId,
      workflowId: def.slug,
      actionType: step.name,
      provider: step.provider,
      stepIdx: pending.stepIdx,
      state: state as unknown as Record<string, unknown>,
    };
    let status: ProviderStatus<unknown>;
    try {
      status = await this.executor.getStatusFromAdapter(
        step.provider,
        adapter,
        pending.externalRef,
        guardedCtx,
      );
    } catch (err) {
      const normalized = this.normalizeError(adapter, err);
      this.log("warn", `getStatus failed for step ${step.name}: ${normalized.errorMessage}`, {
        jobId: job.id,
        stepIdx: pending.stepIdx,
        errorCode: normalized.errorCode,
      });
      return { kind: "still_pending", pollAfterMs: 15_000 };
    }
    if (status.status === "completed") {
      const outputKey = step.outputKey ?? step.name;
      state.outputs[outputKey] = status.output;
      state.nextStepIdx = pending.stepIdx + 1;
      delete state.pending;
      this.recordPendingBilling(state, step, pending.stepIdx, job.id, {
        actualCostCredits: status.actualCostCredits,
        providerCostCents: status.providerCostCents,
        externalRef: pending.externalRef,
      });
      await this.jobQueue.appendEvent({
        jobId: job.id,
        eventType: "step_completed",
        message: `Step ${step.name} completed (async)`,
        metadata: { stepIdx: pending.stepIdx, outputKey },
      });

      // Fire onStepComplete for async completions so per-step cost tracking is
      // consistent with the synchronous execute path.
      if (def.onStepComplete) {
        try {
          await def.onStepComplete({
            jobId: job.id,
            userId: job.userId,
            stepName: step.name,
            stepIdx: pending.stepIdx,
            costCredits: status.actualCostCredits ?? 0,
            providerCostCents: status.providerCostCents ?? 0,
            output: status.output,
            state,
          });
        } catch (stepHookErr) {
          this.log("warn", `onStepComplete hook threw for job ${job.id} step ${step.name} (async)`, {
            err: stepHookErr instanceof Error ? stepHookErr.message : String(stepHookErr),
          });
        }
      }

      return { kind: "completed_step" };
    }
    if (status.status === "failed") {
      return {
        kind: "step_failed",
        error: {
          errorCode: status.errorCode ?? "PROVIDER_ASYNC_FAILED",
          errorMessage: status.errorMessage ?? `Step ${step.name} failed`,
          retryable: status.retryable ?? true,
          stepName: step.name,
          stepIdx: pending.stepIdx,
        },
      };
    }
    return { kind: "still_pending", pollAfterMs: status.pollAfterMs ?? 15_000 };
  }

  /**
   * Apply a webhook update for a job waiting on a provider. The caller
   * (HTTP webhook handler) is responsible for upstream dedupe via
   * `provider_webhook_events.dedupe_key`.
   *
   * Concurrency: the read+validate+write happens inside a transaction
   * holding `SELECT ... FOR UPDATE` on the job row. This serializes against
   * any other writer (a second webhook, a sweeper requeue) and against the
   * worker's `runJob`/`checkPending` paths once they too take the lock.
   * If the job is currently `RUNNING` (claimed by a worker) we defer to the
   * worker's polling cycle: the next `getStatus` will observe the same
   * provider state and complete the step. The webhook event row is already
   * persisted upstream so it is not lost.
   */
  async applyWebhookUpdate(
    jobId: number,
    update: {
      providerSlug: string;
      externalRef: string;
      status: "completed" | "failed";
      output?: unknown;
      errorCode?: string;
      errorMessage?: string;
      retryable?: boolean;
      actualCostCredits?: number;
      providerCostCents?: number;
    },
  ): Promise<WorkflowOutcome> {
    type ApplyDecision =
      | { kind: "outcome"; outcome: WorkflowOutcome }
      | {
          kind: "failure";
          def: WorkflowDefinition;
          job: AutomationJob;
          state: WorkflowExecutionState;
          reservationId: number | undefined;
          err: NormalizedError & { stepName: string; stepIdx: number };
        };

    const decision = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM ${automationJobsTable} WHERE ${automationJobsTable.id} = ${jobId} FOR UPDATE`,
      );
      const [job] = await tx
        .select()
        .from(automationJobsTable)
        .where(eq(automationJobsTable.id, jobId))
        .limit(1);
      if (!job) {
        throw new Error(`applyWebhookUpdate: job ${jobId} not found`);
      }
      if (job.status === JOB_STATUS.RUNNING) {
        this.log("warn", `Webhook for running job ${jobId} deferred to worker poll`, { jobId });
        return {
          kind: "outcome",
          outcome: {
            kind: "failed",
            jobId,
            errorCode: "JOB_BUSY",
            errorMessage: "job is being processed by a worker; webhook deferred",
            retryable: false,
          },
        } satisfies ApplyDecision;
      }
      const payload = (job.payload ?? {}) as JobPayloadShape;
      const state = payload.state;
      if (!state?.pending) {
        this.log("warn", `Webhook for job ${jobId} but no pending step`, { jobId });
        return {
          kind: "outcome",
          outcome: { kind: "failed", jobId, errorCode: "NO_PENDING_STEP", errorMessage: "No pending step", retryable: false },
        } satisfies ApplyDecision;
      }
      if (state.pending.externalRef !== update.externalRef) {
        this.log("warn", `Webhook externalRef mismatch for job ${jobId}`, {
          jobId,
          expected: state.pending.externalRef,
          actual: update.externalRef,
        });
        return {
          kind: "outcome",
          outcome: { kind: "failed", jobId, errorCode: "EXTERNAL_REF_MISMATCH", errorMessage: "externalRef mismatch", retryable: false },
        } satisfies ApplyDecision;
      }
      if (state.pending.providerSlug !== update.providerSlug) {
        this.log("warn", `Webhook providerSlug mismatch for job ${jobId}`, {
          jobId,
          expected: state.pending.providerSlug,
          actual: update.providerSlug,
        });
        return {
          kind: "outcome",
          outcome: {
            kind: "failed",
            jobId,
            errorCode: "PROVIDER_SLUG_MISMATCH",
            errorMessage: `webhook providerSlug '${update.providerSlug}' does not match pending step provider '${state.pending.providerSlug}'`,
            retryable: false,
          },
        } satisfies ApplyDecision;
      }
      const def = this.workflows.require(job.type);
      const step = def.steps[state.pending.stepIdx]!;
      if (step.provider !== update.providerSlug) {
        this.log("warn", `Webhook providerSlug mismatch with workflow step for job ${jobId}`, {
          jobId,
          stepProvider: step.provider,
          actual: update.providerSlug,
        });
        return {
          kind: "outcome",
          outcome: {
            kind: "failed",
            jobId,
            errorCode: "PROVIDER_SLUG_MISMATCH",
            errorMessage: `webhook providerSlug '${update.providerSlug}' does not match step '${step.name}' provider '${step.provider}'`,
            retryable: false,
          },
        } satisfies ApplyDecision;
      }

      if (update.status === "completed") {
        const outputKey = step.outputKey ?? step.name;
        const completedStepIdx = state.pending.stepIdx;
        state.outputs[outputKey] = update.output;
        state.nextStepIdx = completedStepIdx + 1;
        delete state.pending;
        this.recordPendingBilling(state, step, completedStepIdx, jobId, {
          actualCostCredits: update.actualCostCredits,
          providerCostCents: update.providerCostCents,
          externalRef: update.externalRef,
        });
        const now = this.now();
        await tx
          .update(automationJobsTable)
          .set({
            payload: sql`coalesce(${automationJobsTable.payload}, '{}'::jsonb) || ${JSON.stringify({
              state,
              ...(payload.reservationId != null ? { reservationId: payload.reservationId } : {}),
            })}::jsonb`,
            status: JOB_STATUS.QUEUED,
            runAt: now,
            lockedAt: null,
            lockedBy: null,
            updatedAt: now,
          })
          .where(eq(automationJobsTable.id, jobId));
        return {
          kind: "outcome",
          outcome: {
            kind: "waiting_provider",
            jobId,
            providerSlug: update.providerSlug,
            externalRef: update.externalRef,
          },
        } satisfies ApplyDecision;
      }

      return {
        kind: "failure",
        def,
        job,
        state,
        reservationId: payload.reservationId,
        err: {
          errorCode: update.errorCode ?? "WEBHOOK_FAILED",
          errorMessage: update.errorMessage ?? `Step ${step.name} failed via webhook`,
          retryable: update.retryable ?? false,
          stepName: step.name,
          stepIdx: state.pending.stepIdx,
        },
      } satisfies ApplyDecision;
    });

    if (decision.kind === "outcome") {
      if (decision.outcome.kind === "waiting_provider") {
        await this.jobQueue.appendEvent({
          jobId,
          eventType: "webhook_step_completed",
          message: `Step completed via webhook`,
        });
      }
      return decision.outcome;
    }
    return this.handleStepFailure(
      decision.def,
      decision.job,
      decision.state,
      decision.reservationId,
      decision.err,
    );
  }

  private async persistJobState(
    jobId: number,
    state: WorkflowExecutionState,
    reservationId: number | undefined,
  ): Promise<void> {
    await this.db
      .update(automationJobsTable)
      .set({
        payload: sql`coalesce(${automationJobsTable.payload}, '{}'::jsonb) || ${JSON.stringify({
          state,
          ...(reservationId != null ? { reservationId } : {}),
        })}::jsonb`,
        updatedAt: this.now(),
      })
      .where(eq(automationJobsTable.id, jobId));
  }

  private async scheduleFollowUp(job: AutomationJob, delayMs: number): Promise<void> {
    const runAt = new Date(this.now().getTime() + Math.max(0, delayMs));
    await this.db
      .update(automationJobsTable)
      .set({
        status: "queued",
        runAt,
        lockedAt: null,
        lockedBy: null,
        updatedAt: this.now(),
      })
      .where(eq(automationJobsTable.id, job.id));
  }

  private recordPendingBilling(
    state: WorkflowExecutionState,
    step: WorkflowStepDefinition,
    stepIdx: number,
    jobId: number,
    fields: {
      actualCostCredits?: number;
      providerCostCents?: number;
      externalRef?: string;
    },
  ): void {
    if (
      typeof fields.actualCostCredits === "number" &&
      fields.actualCostCredits > 0
    ) {
      (state.pendingUsage ??= []).push({
        providerSlug: step.provider,
        stepName: step.name,
        stepIdx,
        costCredits: fields.actualCostCredits,
        units: 1,
        metadata: { stepIdx },
      });
    }
    if (
      typeof fields.providerCostCents === "number" &&
      fields.providerCostCents >= 0
    ) {
      (state.pendingProviderCosts ??= []).push({
        providerSlug: step.provider,
        stepName: step.name,
        externalRef: fields.externalRef,
        costInCents: fields.providerCostCents,
        units: 1,
        metadata: { jobId, stepName: step.name },
      });
    }
  }

  private async failJob(
    job: AutomationJob,
    errorCode: string,
    errorMessage: string,
    retryable: boolean,
    metadata?: Record<string, unknown>,
    callWorkerId: string = this.workerId,
  ): Promise<AutomationJob> {
    if (metadata) {
      await this.jobQueue.appendEvent({
        jobId: job.id,
        eventType: retryable ? "step_failed_retryable" : "step_failed_terminal",
        message: errorMessage,
        metadata: { errorCode, ...metadata },
      });
    }
    return this.jobQueue.fail({
      jobId: job.id,
      errorCode,
      errorMessage,
      retryable,
      workerId: callWorkerId,
    });
  }
}

/** Helper to count active reservations for a job (used by tests/admin). */
export async function countActiveReservationsForJob(
  db: Db,
  jobId: number,
): Promise<number> {
  const rows = await db
    .select({ id: creditReservationsTable.id })
    .from(creditReservationsTable)
    .where(
      sql`${creditReservationsTable.jobId} = ${jobId}
        AND ${creditReservationsTable.status} = ${RESERVATION_STATUS.HELD}`,
    );
  return rows.length;
}
