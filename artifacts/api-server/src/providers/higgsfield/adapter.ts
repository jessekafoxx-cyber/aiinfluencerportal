// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Higgsfield provider adapter.
//
// Thin normalization layer over the existing dispatchHiggsfield helper
// in influencer-pipeline.ts. Behavior is identical to the pre-Slice-C
// codepath - this module only:
//   1) wraps the existing call in NormalizedResult / NormalizedError shape
//   2) records a reliability event for the call
//   3) parses the raw webhook body into a NormalizedResult so route
//      handlers can route through a single normalization point
// Polling delegates to a freshly-written GET /v1/job-sets/{id} that
// mirrors the existing pollHiggsfieldStuckJobs body verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import type { AiInfluencerJob } from "@workspace/db";
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

const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";

export interface HiggsfieldSubmitInput {
  jobId: number;
  prefs: AiInfluencerJob["prefs"];
  strict?: boolean;
  qaNotes?: string | null;
}

export interface HiggsfieldWebhookPayload {
  jobs?: Array<{
    id?: string;
    status?: string;
    results?: {
      raw?: { url?: string };
      min?: { url?: string };
      original?: { url?: string };
    };
  }>;
  // Top-level shape sometimes seen in webhooks (single-job callback).
  status?: string;
  results?: {
    raw?: { url?: string };
    min?: { url?: string };
    original?: { url?: string };
  };
  result_url?: string;
}

const capabilities: ProviderCapabilities = {
  webhook: true,
  polling: true,
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

function higgsfieldHeaders(): Record<string, string> | null {
  const apiKey = process.env.HIGGSFIELD_API_KEY;
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  if (apiKey) {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }
  if (keyId && keySecret) {
    return {
      "hf-api-key": keyId,
      "hf-secret": keySecret,
      "Content-Type": "application/json",
    };
  }
  return null;
}

function pickResultUrl(results?: {
  raw?: { url?: string };
  min?: { url?: string };
  original?: { url?: string };
}): string | null {
  if (!results) return null;
  return (
    results.raw?.url ?? results.original?.url ?? results.min?.url ?? null
  );
}

export const higgsfieldAdapter: ProviderAdapter<
  HiggsfieldSubmitInput,
  string,
  HiggsfieldWebhookPayload
> = {
  id: "higgsfield",
  capabilities,
  supportsWebhook: () => true,
  supportsPolling: () => true,

  async submit(input) {
    const startedAt = Date.now();
    // Lazy import to avoid a circular eager-load cycle: pipeline.ts
    // imports the manager (which imports this adapter), and we in turn
    // need a function defined in pipeline.ts. ESM live bindings make
    // this safe at call time.
    const { dispatchHiggsfield } = await import(
      "../../lib/influencer-pipeline"
    );
    const res = await dispatchHiggsfield(input.jobId, input.prefs, {
      strict: input.strict,
      qaNotes: input.qaNotes ?? null,
    });
    const latencyMs = Date.now() - startedAt;
    if (res.providerJobId) {
      recordReliabilityEvent({
        provider: "higgsfield",
        ts: Date.now(),
        success: true,
        latencyMs,
      });
      // Slice D: persistent telemetry. Additive - the in-mem ring
      // buffer above keeps fast-path snapshotting; this row gives
      // forensic + cross-restart visibility.
      recordExecutionEvent({
        provider: "higgsfield",
        operation: "submit",
        stage: "base_generation",
        jobId: input.jobId,
        providerJobId: res.providerJobId,
        success: true,
        latencyMs,
      });
      return {
        provider: "higgsfield",
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
      provider: "higgsfield",
      ts: Date.now(),
      success: false,
      latencyMs,
      errorClass: err.class,
    });
    recordExecutionEvent({
      provider: "higgsfield",
      operation: "submit",
      stage: "base_generation",
      jobId: input.jobId,
      success: false,
      latencyMs,
      errorClass: err.class,
      errorCode: err.code,
      errorMessage: err.message,
    });
    return {
      provider: "higgsfield",
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
    const headers = higgsfieldHeaders();
    if (!headers) {
      return {
        provider: "higgsfield",
        providerJobId,
        status: "failed",
        assetUrls: [],
        thumbnails: [],
        retryable: false,
        terminal: true,
        degraded: false,
        raw: null,
        metrics: {},
        error: buildError({ err: "missing higgsfield credentials" }),
      };
    }
    try {
      const res = await fetch(
        `${HIGGSFIELD_BASE_URL}/v1/job-sets/${providerJobId}`,
        {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          provider: "higgsfield",
          providerJobId,
          status: "failed",
          assetUrls: [],
          thumbnails: [],
          retryable: true,
          terminal: false,
          degraded: false,
          raw: { status: res.status, body: text.slice(0, 500) },
          metrics: {},
          error: buildError({ status: res.status, responseText: text }),
        };
      }
      const json = (await res.json().catch(() => ({}))) as {
        jobs?: Array<{
          id?: string;
          status?: string;
          results?: {
            raw?: { url?: string };
            min?: { url?: string };
            original?: { url?: string };
          };
        }>;
      };
      const inner = json.jobs?.[0];
      const url = pickResultUrl(inner?.results);
      if (inner?.status !== "completed") {
        return {
          provider: "higgsfield",
          providerJobId,
          status: "in_progress",
          assetUrls: [],
          thumbnails: [],
          retryable: true,
          terminal: false,
          degraded: false,
          raw: json,
          metrics: {},
          error: null,
        };
      }
      if (!url) {
        return {
          provider: "higgsfield",
          providerJobId,
          status: "completed",
          assetUrls: [],
          thumbnails: [],
          retryable: false,
          terminal: true,
          degraded: true,
          raw: json,
          metrics: {},
          error: buildError({ emptyOutput: true }),
        };
      }
      return {
        provider: "higgsfield",
        providerJobId,
        status: "completed",
        assetUrls: [url],
        thumbnails: [url],
        retryable: false,
        terminal: true,
        degraded: false,
        raw: json,
        metrics: {},
        error: null,
      };
    } catch (err) {
      return {
        provider: "higgsfield",
        providerJobId,
        status: "failed",
        assetUrls: [],
        thumbnails: [],
        retryable: true,
        terminal: false,
        degraded: false,
        raw: null,
        metrics: {},
        error: buildError({ err }),
      };
    }
  },

  async getResult(providerJobId) {
    return this.poll(providerJobId);
  },

  normalizeWebhook(raw) {
    // Higgsfield may send either a job-sets shape (jobs[0].results) or a
    // single-job callback (top-level results / result_url). Mirror the
    // tolerance the existing webhook handler has.
    const inner = raw.jobs?.[0];
    const status = inner?.status ?? raw.status;
    const url =
      pickResultUrl(inner?.results) ??
      pickResultUrl(raw.results) ??
      raw.result_url ??
      null;
    const providerJobId = inner?.id ?? null;
    if (status && status !== "completed") {
      return {
        provider: "higgsfield",
        providerJobId,
        status: "in_progress",
        assetUrls: [],
        thumbnails: [],
        retryable: true,
        terminal: false,
        degraded: false,
        raw,
        metrics: {},
        error: null,
      };
    }
    if (!url) {
      return {
        provider: "higgsfield",
        providerJobId,
        status: "completed",
        assetUrls: [],
        thumbnails: [],
        retryable: false,
        terminal: true,
        degraded: true,
        raw,
        metrics: {},
        error: buildError({ emptyOutput: true }),
      };
    }
    return {
      provider: "higgsfield",
      providerJobId,
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
