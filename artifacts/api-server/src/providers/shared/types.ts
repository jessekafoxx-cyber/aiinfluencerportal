// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Provider adapter abstraction - shared types.
//
// Every provider adapter (higgsfield, enhancor, gemini) implements this
// interface so the orchestration engine can treat them uniformly.
// Existing per-provider behavior is preserved 1:1 - the adapter is a
// thin normalization layer, NOT a behavior change.
// ─────────────────────────────────────────────────────────────────────────────

import type { InfluencerErrorCode } from "../../lib/influencer-observability";

export type ProviderId = "higgsfield" | "enhancor" | "gemini";

// Normalized failure taxonomy (Slice C). Each provider's classifyFailure()
// returns one of these classes alongside the legacy InfluencerErrorCode.
// The legacy code stays primary for now so all existing pipeline code
// (RETRY_CAPS, persistError, failJob) keeps working unchanged.
export const FAILURE_CLASSES = [
  "RATE_LIMIT",
  "EMPTY_OUTPUT",
  "INVALID_RESPONSE",
  "TIMEOUT",
  "WEBHOOK_MISSING",
  "AUTH_FAILURE",
  "PROVIDER_DOWN",
  "MODERATION_BLOCK",
  "TRANSIENT",
  "TERMINAL",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface NormalizedError {
  class: FailureClass;
  // Legacy code preserved verbatim so existing call sites can keep
  // persisting it onto the job row without remapping.
  code: InfluencerErrorCode;
  message: string;
  retryable: boolean;
  terminal: boolean;
  payload?: unknown;
}

export type NormalizedStatus =
  | "submitted"
  | "in_progress"
  | "completed"
  | "failed";

export interface NormalizedResult {
  provider: ProviderId;
  providerJobId: string | null;
  status: NormalizedStatus;
  assetUrls: string[];
  thumbnails: string[];
  retryable: boolean;
  terminal: boolean;
  degraded: boolean;
  raw: unknown;
  metrics: {
    latencyMs?: number;
    outputBytes?: number;
  };
  error: NormalizedError | null;
}

export interface ProviderCapabilities {
  webhook: boolean;
  polling: boolean;
  cancel: boolean;
  estimateLatency: boolean;
  estimateCost: boolean;
}

// Generic adapter interface. Concrete adapters narrow the input/output
// generics to their own request shapes. The orchestration engine calls
// these methods through the ProviderManager - it never imports the
// adapter modules directly.
export interface ProviderAdapter<
  TSubmitInput = unknown,
  TPollInput = string,
  TWebhookPayload = unknown,
> {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  submit(input: TSubmitInput): Promise<NormalizedResult>;
  poll(providerJobId: TPollInput): Promise<NormalizedResult>;
  getResult(providerJobId: TPollInput): Promise<NormalizedResult>;
  normalizeWebhook(raw: TWebhookPayload): NormalizedResult;
  classifyFailure(input: {
    status?: number;
    err?: unknown;
    responseText?: string;
    emptyOutput?: boolean;
  }): NormalizedError;

  supportsWebhook(): boolean;
  supportsPolling(): boolean;

  // Optional capabilities. ProviderManager checks `capabilities.cancel`
  // etc before invoking these.
  cancel?(providerJobId: TPollInput): Promise<void>;
  estimateLatency?(): number;
  estimateCost?(): number;
}

// Helper: map the legacy InfluencerErrorCode to the new FailureClass.
// Used by every adapter's classifyFailure() so the mapping stays
// centralized and the pipeline code does not need to know about it.
export function classifyToFailureClass(
  code: InfluencerErrorCode,
  status?: number,
): FailureClass {
  switch (code) {
    case "RATE_LIMIT":
      return "RATE_LIMIT";
    case "PROVIDER_TIMEOUT":
      return "TIMEOUT";
    case "EMPTY_OUTPUT":
      return "EMPTY_OUTPUT";
    case "INVALID_RESPONSE":
      if (status === 401 || status === 403) return "AUTH_FAILURE";
      return "INVALID_RESPONSE";
    case "WEBHOOK_FAILURE":
      return "WEBHOOK_MISSING";
    case "CONFIG_MISSING":
      return "AUTH_FAILURE";
    case "ENHANCOR_DEGRADED":
      return "EMPTY_OUTPUT";
    // Task #690: terminal Gemini policy blocks. retryable=false so the
    // worker stops burning attempts on a request the model will keep
    // refusing for identical input.
    case "SAFETY_BLOCK":
    case "RECITATION_BLOCK":
    case "SCENE_SWAP_SAFETY_BLOCK":
    case "SCENE_SWAP_RECITATION_BLOCK":
      return "MODERATION_BLOCK";
    // Task #690: text-only refusal — the model returned content but no
    // image part. Allow retry (a softened prompt or a fresh attempt can
    // produce an image), but classify as EMPTY_OUTPUT so we keep the
    // existing retry-budget semantics.
    case "NO_IMAGE_IN_RESPONSE":
    case "SCENE_SWAP_NO_IMAGE_IN_RESPONSE":
      return "EMPTY_OUTPUT";
    case "SCENE_SWAP_FAILURE":
    case "PARTIAL_BATCH_FAILURE":
    case "DELIVERY_FAILURE":
      return "TRANSIENT";
    case "UNKNOWN":
    default:
      return "TRANSIENT";
  }
}

// Helper: derive retryable/terminal from a failure class. Used by
// adapters to populate NormalizedError without each one re-deriving.
export function failureRetryability(
  cls: FailureClass,
): { retryable: boolean; terminal: boolean } {
  switch (cls) {
    case "AUTH_FAILURE":
    case "MODERATION_BLOCK":
    case "TERMINAL":
      return { retryable: false, terminal: true };
    case "RATE_LIMIT":
    case "TIMEOUT":
    case "WEBHOOK_MISSING":
    case "PROVIDER_DOWN":
    case "EMPTY_OUTPUT":
    case "INVALID_RESPONSE":
    case "TRANSIENT":
      return { retryable: true, terminal: false };
  }
}
