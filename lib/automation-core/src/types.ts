import type { ProviderAdapter, ProviderExecutionContext } from "@workspace/provider-adapters";

/** Maps workflow state to the input expected by a step's adapter. */
export type StepInputMapper<TInput = unknown> = (
  state: Record<string, unknown>,
  ctx: WorkflowStepContext,
) => TInput | Promise<TInput>;

export interface WorkflowStepContext {
  jobId: number;
  userId: number;
  workspaceId?: number | null;
  workflowSlug: string;
  stepName: string;
  stepIdx: number;
  attempt: number;
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export interface WorkflowStepDefinition<TInput = unknown, TOutput = unknown> {
  /** Unique step identifier within the workflow. */
  name: string;
  /** Provider slug to look up an adapter from the registry. */
  provider: string;
  /** Maps current workflow state to adapter input. */
  inputMapping: StepInputMapper<TInput>;
  /** Where to store the adapter output in workflow state (defaults to step name). */
  outputKey?: string;
  /** When true, a step failure does not fail the workflow; output is set to null. */
  optional?: boolean;
  /** Predicate; when true, the step is skipped (output=null) before execute. */
  skipWhen?: (state: Record<string, unknown>, ctx: WorkflowStepContext) => boolean | Promise<boolean>;
  /** Optional adapter override for tests / advanced wiring. */
  adapter?: ProviderAdapter<TInput, TOutput>;
  /** Static config merged into the ProviderExecutionContext (rarely needed). */
  config?: Record<string, unknown>;
}

/**
 * Context passed to WorkflowDefinition.onComplete when a job finishes
 * successfully. `providerCostBreakdown` maps step name to credits consumed.
 */
export interface WorkflowTerminalContext {
  jobId: number;
  userId: number;
  state: WorkflowExecutionState;
  totalCreditsCost: number;
  providerCostBreakdown: Record<string, number>;
}

/**
 * Context passed to WorkflowDefinition.onFailed when a job terminally fails.
 */
export interface WorkflowFailedContext extends WorkflowTerminalContext {
  errorCode: string;
  errorMessage: string;
}

/**
 * Context passed to WorkflowDefinition.onStart immediately after credit
 * reservation is confirmed (lazy or pre-reserved), before any step runs.
 * Use to record the reservationId into tracking tables for jobs that did not
 * pre-reserve (e.g. scheduled runs).
 */
export interface WorkflowStartContext {
  jobId: number;
  userId: number;
  reservationId: number;
  state: WorkflowExecutionState;
}

/**
 * Context passed to WorkflowDefinition.onStepComplete after each step
 * finishes successfully. Use for in-flight observability and partial-cost
 * tracking (e.g. appending to providerCostBreakdown per step).
 */
export interface WorkflowStepCompleteContext {
  jobId: number;
  userId: number;
  stepName: string;
  stepIdx: number;
  costCredits: number;
  providerCostCents: number;
  output: unknown;
  state: WorkflowExecutionState;
}

export interface WorkflowDefinition {
  /** Unique workflow slug, also used as automation_jobs.type. */
  slug: string;
  /** Human-friendly name. */
  name: string;
  /** Ordered steps. */
  steps: WorkflowStepDefinition[];
  /** Total credit estimate; defaults to sum of step `adapter.estimateCost`. */
  estimateCredits?: (input: Record<string, unknown>) => number | Promise<number>;
  /** Default max attempts for jobs of this workflow. */
  maxAttempts?: number;
  /**
   * Called by the WorkflowRunner immediately after credit reservation is
   * confirmed (lazy or pre-reserved), before the first step executes.
   * Hook failures are caught and logged — they do not affect the job outcome.
   * Use to write reservationId back into tracking tables for scheduled runs.
   */
  onStart?: (ctx: WorkflowStartContext) => Promise<void>;
  /**
   * Called by the WorkflowRunner after each step finishes successfully.
   * Hook failures are caught and logged — they do not affect the job outcome.
   * Use for in-flight observability, partial cost tracking, or intermediate
   * status updates.
   */
  onStepComplete?: (ctx: WorkflowStepCompleteContext) => Promise<void>;
  /**
   * Called by the WorkflowRunner after a job completes successfully and credits
   * are finalized. Hook failures are caught and logged — they do not affect
   * the job outcome. Use for side-effects such as DB record updates or
   * scheduling the next occurrence of a recurring job.
   */
  onComplete?: (ctx: WorkflowTerminalContext) => Promise<void>;
  /**
   * Called by the WorkflowRunner when a job terminally fails (status FAILED or
   * CANCELLED) and credits are released. Hook failures are caught and logged.
   */
  onFailed?: (ctx: WorkflowFailedContext) => Promise<void>;
}

export interface WorkflowExecutionState {
  /** Original input payload from job.payload.input. */
  input: Record<string, unknown>;
  /** Map of step name (or outputKey) -> output. */
  outputs: Record<string, unknown>;
  /** Cursor: index of next step to execute. */
  nextStepIdx: number;
  /** Async work in progress for current step, if any. */
  pending?: {
    stepIdx: number;
    providerSlug: string;
    externalRef: string;
  };
  /** Buffered per-step usage; flushed only on terminal success. */
  pendingUsage?: PendingUsageRecord[];
  /** Buffered per-step raw provider costs; flushed only on terminal success. */
  pendingProviderCosts?: PendingProviderCostRecord[];
}

export interface PendingUsageRecord {
  providerSlug: string;
  stepName: string;
  stepIdx: number;
  costCredits: number;
  units?: number;
  metadata?: Record<string, unknown>;
}

export interface PendingProviderCostRecord {
  providerSlug: string;
  stepName: string;
  externalRef?: string;
  costInCents: number;
  units?: number;
  metadata?: Record<string, unknown>;
}

export type WorkflowAdapterContext = ProviderExecutionContext;
