// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Enhancor provider adapter.
//
// Thin normalization layer over dispatchEnhancor in influencer-pipeline.ts.
// Enhancor is webhook-only on this platform - existing code does not poll
// it - so supportsPolling=false and poll() returns a NormalizedResult
// that signals "not supported".
// ─────────────────────────────────────────────────────────────────────────────

import { classifyError } from "../../lib/influencer-observability";
import {
  classifyToFailureClass,
  failureRetryability,
  type NormalizedError,
  type NormalizedResult,
  type ProviderAdapter,
  type ProviderCapabilities,
} from "../shared/types";
import { recordReliabilityEvent } from "../shared/reliability";
import { recordExecutionEvent } from "../../lib/provider-telemetry";

export interface EnhancorSubmitInput {
  jobId: number;
  baseImageUrl: string;
}

export interface EnhancorWebhookPayload {
  status?: string;
  imageUrl?: string;
  image_url?: string;
  output?: { url?: string } | string;
  result?: { url?: string } | string;
  data?: { url?: string };
}

const capabilities: ProviderCapabilities = {
  webhook: true,
  polling: false,
  cancel: false,
  estimateLatency: false,
  estimateCost: false,
};

function buildError(input: {
  status?: number;
  err?: unknown;
  responseText?: string;
  emptyOutput?: boolean;
}): NormalizedError {
  const cls = classifyError(input);
  const fc = classifyToFailureClass(cls.code, input.status);
  const { retryable, terminal } = failureRetryability(fc);
  return {
    class: fc,
    code: cls.code,
    message: cls.message,
    retryable,
    terminal,
  };
}

function pickEnhancorUrl(raw: EnhancorWebhookPayload): string | null {
  if (raw.imageUrl) return raw.imageUrl;
  if (raw.image_url) return raw.image_url;
  if (raw.data?.url) return raw.data.url;
  if (raw.output) {
    if (typeof raw.output === "string") return raw.output;
    if (raw.output.url) return raw.output.url;
  }
  if (raw.result) {
    if (typeof raw.result === "string") return raw.result;
    if (raw.result.url) return raw.result.url;
  }
  return null;
}

export const enhancorAdapter: ProviderAdapter<
  EnhancorSubmitInput,
  string,
  EnhancorWebhookPayload
> = {
  id: "enhancor",
  capabilities,
  supportsWebhook: () => true,
  supportsPolling: () => false,

  async submit(input) {
    const startedAt = Date.now();
    const { dispatchEnhancor } = await import(
      "../../lib/influencer-pipeline"
    );
    const res = await dispatchEnhancor(input.jobId, input.baseImageUrl);
    const latencyMs = Date.now() - startedAt;
    if (res.providerJobId) {
      recordReliabilityEvent({
        provider: "enhancor",
        ts: Date.now(),
        success: true,
        latencyMs,
      });
      recordExecutionEvent({
        provider: "enhancor",
        operation: "submit",
        stage: "enhancement",
        jobId: input.jobId,
        providerJobId: res.providerJobId,
        success: true,
        latencyMs,
      });
      return {
        provider: "enhancor",
        providerJobId: res.providerJobId,
        status: "submitted",
        assetUrls: [],
        thumbnails: [],
        retryable: false,
        terminal: false,
        degraded: false,
        raw: res,
        metrics: { latencyMs },
        error: null,
      };
    }
    const err = res.error
      ? {
          ...buildError({}),
          code: res.error.code,
          message: res.error.message,
          class: classifyToFailureClass(res.error.code),
          payload: res.error.payload,
          ...failureRetryability(classifyToFailureClass(res.error.code)),
        }
      : buildError({ err: "dispatch returned no id" });
    recordReliabilityEvent({
      provider: "enhancor",
      ts: Date.now(),
      success: false,
      latencyMs,
      errorClass: err.class,
    });
    recordExecutionEvent({
      provider: "enhancor",
      operation: "submit",
      stage: "enhancement",
      jobId: input.jobId,
      success: false,
      latencyMs,
      errorClass: err.class,
      errorCode: err.code,
      errorMessage: err.message,
    });
    return {
      provider: "enhancor",
      providerJobId: null,
      status: "failed",
      assetUrls: [],
      thumbnails: [],
      retryable: err.retryable,
      terminal: err.terminal,
      degraded: false,
      raw: res,
      metrics: { latencyMs },
      error: err,
    };
  },

  async poll(providerJobId) {
    return {
      provider: "enhancor",
      providerJobId,
      status: "in_progress",
      assetUrls: [],
      thumbnails: [],
      retryable: false,
      terminal: false,
      degraded: false,
      raw: null,
      metrics: {},
      error: null,
    };
  },

  async getResult(providerJobId) {
    return this.poll(providerJobId);
  },

  normalizeWebhook(raw) {
    const url = pickEnhancorUrl(raw);
    if (!url) {
      return {
        provider: "enhancor",
        providerJobId: null,
        status: "completed",
        assetUrls: [],
        thumbnails: [],
        retryable: false,
        terminal: true,
        degraded: true,
        raw,
        metrics: {},
        error: {
          class: "EMPTY_OUTPUT",
          code: "ENHANCOR_DEGRADED",
          message: "Enhancor webhook arrived with no usable image url",
          retryable: false,
          terminal: true,
        },
      };
    }
    return {
      provider: "enhancor",
      providerJobId: null,
      status: "completed",
      assetUrls: [url],
      thumbnails: [url],
      retryable: false,
      terminal: true,
      degraded: false,
      raw,
      metrics: {},
      error: null,
    };
  },

  classifyFailure: buildError,
};
