/**
 * ProviderExecutor — credit-reservation-aware adapter dispatch layer.
 *
 * Wraps a ProviderRegistry and a ReservationValidator. Before calling
 * execute() or getStatus() on any adapter in CREDIT_GUARDED_PROVIDERS, the
 * executor validates that:
 *   1. The execution context carries a numeric reservationId and jobId.
 *   2. The supplied ReservationValidator confirms the reservation is `held`
 *      and belongs to the current user/job.
 *
 * Non-guarded adapters bypass all guard logic and are dispatched directly.
 *
 * Two dispatch styles are provided:
 *   - Slug-based: executeBySlug / getStatusBySlug — looks up the adapter from
 *     the registry. Useful for tests and direct calls.
 *   - Adapter-based: executeAdapter / getStatusFromAdapter — takes a
 *     pre-resolved adapter. Used by WorkflowRunner which already resolves step
 *     adapters (supporting optional inline `step.adapter` overrides).
 */

import {
  CREDIT_GUARDED_PROVIDERS,
  CreditReservationRequiredError,
  type ReservationContext,
  type ReservationValidator,
} from "./credit-guard";
import type { ProviderRegistry } from "./registry";
import type {
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderResult,
  ProviderStatus,
} from "./types";

/**
 * Execution context required by ProviderExecutor for every guarded call.
 * Extends the base ProviderExecutionContext with fields that carry credit /
 * billing identity so the guard can verify reservation ownership.
 */
export interface GuardedExecutionContext extends ProviderExecutionContext {
  /** Required: the job that owns this execution. */
  jobId: number;
  /** Required: workspace the job belongs to (null for personal accounts). */
  workspaceId: number | null;
  /** Required: active held reservation for this job. */
  reservationId: number;
  /** Workflow slug, forwarded as workflowSlug in the underlying ProviderExecutionContext. */
  workflowId: string;
  /** Step name / action identifier (e.g. "generate_script", "render_video"). */
  actionType: string;
  /** Provider slug being called (mirrors the adapter slug). */
  provider: string;
}

export interface ProviderExecutorOptions {
  registry: ProviderRegistry;
  /**
   * Validates that the reservation in the context is held and matches the
   * active job. Should throw CreditReservationRequiredError on any mismatch.
   */
  validateReservation: ReservationValidator;
}

export class ProviderExecutor {
  private readonly registry: ProviderRegistry;
  private readonly validateReservation: ReservationValidator;

  constructor(opts: ProviderExecutorOptions) {
    this.registry = opts.registry;
    this.validateReservation = opts.validateReservation;
  }

  // ── Adapter-based dispatch (used by WorkflowRunner) ──────────────────────

  /**
   * Executes a pre-resolved adapter with full credit-guard enforcement.
   * Use when you have already obtained the adapter (e.g. via resolveAdapter).
   */
  async executeAdapter<TInput = unknown, TOutput = unknown>(
    adapterSlug: string,
    adapter: ProviderAdapter<TInput, TOutput>,
    input: TInput,
    ctx: GuardedExecutionContext,
  ): Promise<ProviderResult<TOutput>> {
    if (CREDIT_GUARDED_PROVIDERS.has(adapterSlug)) {
      await this.runGuard(ctx, adapterSlug);
    }
    return adapter.execute(input, this.toProviderCtx(ctx));
  }

  /**
   * Polls a pre-resolved adapter for async status with full credit-guard
   * enforcement. Use when you have already obtained the adapter.
   */
  async getStatusFromAdapter<TOutput = unknown>(
    adapterSlug: string,
    adapter: ProviderAdapter<unknown, TOutput>,
    externalRef: string,
    ctx: GuardedExecutionContext,
  ): Promise<ProviderStatus<TOutput>> {
    if (CREDIT_GUARDED_PROVIDERS.has(adapterSlug)) {
      await this.runGuard(ctx, adapterSlug);
    }
    if (!adapter.getStatus) {
      throw new Error(`Adapter '${adapterSlug}' does not support getStatus`);
    }
    return adapter.getStatus(
      externalRef,
      this.toProviderCtx(ctx),
    ) as Promise<ProviderStatus<TOutput>>;
  }

  // ── Slug-based dispatch (registry lookup; useful for tests) ──────────────

  /**
   * Looks up the adapter from the registry by slug, then executes it with
   * full credit-guard enforcement.
   */
  async executeBySlug<TInput = unknown, TOutput = unknown>(
    adapterSlug: string,
    input: TInput,
    ctx: GuardedExecutionContext,
  ): Promise<ProviderResult<TOutput>> {
    if (CREDIT_GUARDED_PROVIDERS.has(adapterSlug)) {
      await this.runGuard(ctx, adapterSlug);
    }
    const adapter = this.registry.require<TInput, TOutput>(adapterSlug);
    return adapter.execute(input, this.toProviderCtx(ctx));
  }

  /**
   * Looks up the adapter from the registry by slug, then polls it for async
   * status with full credit-guard enforcement.
   */
  async getStatusBySlug<TOutput = unknown>(
    adapterSlug: string,
    externalRef: string,
    ctx: GuardedExecutionContext,
  ): Promise<ProviderStatus<TOutput>> {
    if (CREDIT_GUARDED_PROVIDERS.has(adapterSlug)) {
      await this.runGuard(ctx, adapterSlug);
    }
    const adapter = this.registry.require<unknown, TOutput>(adapterSlug);
    if (!adapter.getStatus) {
      throw new Error(`Adapter '${adapterSlug}' does not support getStatus`);
    }
    return adapter.getStatus(
      externalRef,
      this.toProviderCtx(ctx),
    ) as Promise<ProviderStatus<TOutput>>;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async runGuard(ctx: GuardedExecutionContext, provider: string): Promise<void> {
    if (ctx.reservationId == null || !Number.isInteger(ctx.reservationId)) {
      throw new CreditReservationRequiredError(
        "a numeric reservationId is required in the execution context",
        provider,
      );
    }
    if (!ctx.jobId || !Number.isInteger(ctx.jobId)) {
      throw new CreditReservationRequiredError(
        "a numeric jobId is required in the execution context",
        provider,
      );
    }
    const resCtx: ReservationContext = {
      reservationId: ctx.reservationId,
      jobId: ctx.jobId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    };
    await this.validateReservation(resCtx);
  }

  private toProviderCtx(ctx: GuardedExecutionContext): ProviderExecutionContext {
    return {
      jobId: ctx.jobId,
      userId: ctx.userId,
      workflowSlug: ctx.workflowId,
      workspaceId: ctx.workspaceId,
      reservationId: ctx.reservationId,
      stepIdx: ctx.stepIdx,
      state: ctx.state,
      log: ctx.log,
    };
  }
}
