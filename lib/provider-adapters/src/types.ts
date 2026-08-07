export interface ProviderExecutionContext {
  jobId?: number | null;
  userId: number;
  workflowSlug?: string;
  stepIdx?: number;
  /**
   * Workspace the job belongs to. Null for personal-account jobs.
   * Passed through by WorkflowRunner from the job payload.
   */
  workspaceId?: number | null;
  /**
   * The active held credit reservation for this job.
   * Required by guarded providers (Claude, HeyGen, Blotato, Creatomate).
   * Adapters must not inspect this directly; use ProviderExecutor instead.
   */
  reservationId?: number | null;
  /**
   * Workflow runtime state (outputs from previous steps, inputs to this run, etc).
   * Adapters may read from this when their input mapping references prior step outputs.
   */
  state?: Record<string, unknown>;
  /**
   * Logger function for adapters to emit structured events.
   */
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export interface ProviderSyncResult<T = unknown> {
  status: "completed";
  output: T;
  /**
   * Actual credit cost in credits, if known. Used to finalize reservations.
   */
  actualCostCredits?: number;
  /**
   * Provider-side cost in cents (raw provider invoice line). Recorded into
   * provider_cost_events when present.
   */
  providerCostCents?: number;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderAsyncPending {
  status: "waiting_provider";
  externalRef: string;
  /**
   * How long to wait before next polling check, in ms. Defaults to adapter
   * choice if omitted.
   */
  pollAfterMs?: number;
  metadata?: Record<string, unknown>;
}

export type ProviderResult<T = unknown> = ProviderSyncResult<T> | ProviderAsyncPending;

export interface ProviderStatus<T = unknown> {
  status: "pending" | "completed" | "failed";
  output?: T;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  pollAfterMs?: number;
  actualCostCredits?: number;
  providerCostCents?: number;
}

export interface ProviderWebhookUpdate<T = unknown> {
  externalRef: string;
  status: "completed" | "failed" | "pending";
  output?: T;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  /**
   * Stable string used for dedupe across redeliveries (often
   * `${providerSlug}:${eventId}` or `${providerSlug}:${externalRef}:${event}`).
   */
  dedupeKey?: string;
  /**
   * Async billing fields. Mirrors ProviderStatus so webhook completions
   * accumulate usage_events/provider_costs identically to sync/poll paths.
   */
  actualCostCredits?: number;
  providerCostCents?: number;
}

export interface NormalizedError {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export class ProviderValidationError extends Error {
  code = "PROVIDER_VALIDATION_ERROR";
  constructor(public providerSlug: string, message: string) {
    super(`[${providerSlug}] ${message}`);
    this.name = "ProviderValidationError";
  }
}

export class ProviderConfigurationError extends Error {
  code = "PROVIDER_CONFIGURATION_ERROR";
  constructor(public providerSlug: string, message: string) {
    super(`[${providerSlug}] ${message}`);
    this.name = "ProviderConfigurationError";
  }
}

export interface ProviderAdapter<TInput = Record<string, unknown>, TOutput = unknown> {
  readonly slug: string;

  /**
   * Returns the credit cost estimate for this adapter call. Used by the
   * workflow runner to reserve credits up-front.
   */
  estimateCost(input: TInput): Promise<number> | number;

  /**
   * Throws ProviderValidationError on bad input. Should also surface missing
   * credentials / configuration as a fail-fast typed error.
   */
  validateInput(input: TInput): Promise<void> | void;

  /**
   * Runs the provider call. Returns either a sync result or an async pending
   * marker that the runner must follow up on (via getStatus / handleWebhook).
   */
  execute(input: TInput, ctx: ProviderExecutionContext): Promise<ProviderResult<TOutput>>;

  /**
   * Polls async providers when no webhook arrives. Optional for sync-only
   * adapters.
   */
  getStatus?(externalRef: string, ctx: ProviderExecutionContext): Promise<ProviderStatus<TOutput>>;

  /**
   * Normalizes a raw provider webhook payload into a stable update shape.
   * Optional for adapters that do not support webhooks.
   */
  handleWebhook?(payload: unknown): Promise<ProviderWebhookUpdate<TOutput> | null> | ProviderWebhookUpdate<TOutput> | null;

  /**
   * Normalizes raw provider output to the adapter's TOutput shape. Useful
   * when getStatus / handleWebhook return raw provider envelopes.
   */
  normalizeResult?(raw: unknown): TOutput;

  /**
   * Classifies a thrown error into a typed retryability classification so the
   * runner can decide between retry vs dead-letter.
   */
  normalizeError?(err: unknown): NormalizedError;
}
