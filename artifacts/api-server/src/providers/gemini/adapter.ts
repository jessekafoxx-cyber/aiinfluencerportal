// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Gemini provider adapter (Nano Banana scene image).
//
// Gemini scene-swap calls are synchronous HTTP - they return the image
// bytes inline. supportsWebhook=false and supportsPolling=false.
// submit() resolves with a terminal NormalizedResult containing the
// b64 payload + mimeType so the orchestration layer can upload it
// itself (preserving the exact upload + QA flow that already exists in
// runSceneSwaps).
// ─────────────────────────────────────────────────────────────────────────────

import { classifyError, type InfluencerErrorCode } from "../../lib/influencer-observability";
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

export interface GeminiSubmitInput {
  prompt: string;
  inputImages?: { data: string; mimeType: string }[];
}

// Gemini's sync result piggybacks inside NormalizedResult.raw so the
// orchestration code can keep using b64_json + mimeType verbatim.
export interface GeminiRawResult {
  b64_json: string;
  mimeType: string;
}

const capabilities: ProviderCapabilities = {
  webhook: false,
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
  // Task #674: propagate the structured gemini no-image diagnostics
  // (candidateCount/finishReason/blockReason/partKinds/textSnippet)
  // attached by lib/integrations-gemini-ai/src/image/pro.ts so they
  // reach the scene-swap caller through NormalizedError.payload
  // instead of being lost in the catch-block remap.
  const e = input.err as Record<string, unknown> | null;
  // Task #690: also propagate `safetyRatings` (per-candidate or top-level
  // promptFeedback) and the raw `promptFeedback` blob so the pipeline's
  // persistError row captures the full Gemini diagnostic surface, not
  // just the high-level finishReason/blockReason. Without these the
  // operator can't tell which safety category (HARM_CATEGORY_*) tripped
  // the block, and the SAFETY_BLOCK / RECITATION_BLOCK / NO_IMAGE
  // taxonomy collapses into "just a block".
  const payload =
    e &&
    (typeof e.candidateCount === "number" ||
      typeof e.finishReason === "string" ||
      typeof e.blockReason === "string" ||
      Array.isArray(e.partKinds) ||
      typeof e.textSnippet === "string" ||
      typeof e.kind === "string" ||
      e.safetyRatings !== undefined ||
      e.promptFeedback !== undefined)
      ? {
          kind: typeof e.kind === "string" ? e.kind : null,
          candidateCount:
            typeof e.candidateCount === "number" ? e.candidateCount : null,
          finishReason:
            typeof e.finishReason === "string" ? e.finishReason : null,
          blockReason:
            typeof e.blockReason === "string" ? e.blockReason : null,
          partKinds: Array.isArray(e.partKinds) ? e.partKinds : null,
          textSnippet:
            typeof e.textSnippet === "string" ? e.textSnippet : null,
          safetyRatings: e.safetyRatings ?? null,
          promptFeedback: e.promptFeedback ?? null,
        }
      : undefined;

  // Task #690: when the upstream throw is one of our structured
  // no-image errors (kind ∈ {safety_block, recitation_block, no_image})
  // bypass classifyError's regex chain and pick the canonical code
  // directly. classifyError previously collapsed all three into
  // UNKNOWN, which the scene-swap remap then rewrote to a generic
  // SCENE_SWAP_FAILURE and burned the full retry budget.
  const kind = typeof e?.kind === "string" ? (e.kind as string) : null;
  if (kind === "safety_block" || kind === "recitation_block" || kind === "no_image") {
    const code: InfluencerErrorCode =
      kind === "safety_block"
        ? "SAFETY_BLOCK"
        : kind === "recitation_block"
          ? "RECITATION_BLOCK"
          : "NO_IMAGE_IN_RESPONSE";
    const fc = classifyToFailureClass(code, input.status);
    const { retryable, terminal } = failureRetryability(fc);
    return {
      class: fc,
      code,
      message: String((e as { message?: unknown }).message ?? code),
      retryable,
      terminal,
      ...(payload ? { payload } : {}),
    };
  }

  const cls = classifyError(input);
  const fc = classifyToFailureClass(cls.code, input.status);
  const { retryable, terminal } = failureRetryability(fc);
  return {
    class: fc,
    code: cls.code,
    message: cls.message,
    retryable,
    terminal,
    ...(payload ? { payload } : {}),
  };
}

export const geminiAdapter: ProviderAdapter<
  GeminiSubmitInput,
  string,
  unknown
> = {
  id: "gemini",
  capabilities,
  supportsWebhook: () => false,
  supportsPolling: () => false,

  async submit(input) {
    const startedAt = Date.now();
    try {
      // Lazy dynamic import mirrors the existing runSceneSwaps loader
      // in influencer-pipeline.ts and keeps the gemini lib's composite
      // build out of the boot path.
      const mod = await import("@workspace/integrations-gemini-ai/image" as any);
      const generateProImage = mod.generateProImage as (opts: {
        prompt: string;
        inputImages?: { data: string; mimeType: string }[];
      }) => Promise<{ b64_json: string; mimeType: string }>;
      const result = await generateProImage({
        prompt: input.prompt,
        inputImages: input.inputImages,
      });
      const latencyMs = Date.now() - startedAt;
      const buf = Buffer.from(result.b64_json, "base64");
      recordReliabilityEvent({
        provider: "gemini",
        ts: Date.now(),
        success: true,
        latencyMs,
      });
      recordExecutionEvent({
        provider: "gemini",
        operation: "submit",
        stage: "scene_swap",
        success: true,
        latencyMs,
        outputBytes: buf.length,
      });
      return {
        provider: "gemini",
        providerJobId: null,
        status: "completed",
        assetUrls: [],
        thumbnails: [],
        retryable: false,
        terminal: true,
        degraded: false,
        raw: result satisfies GeminiRawResult,
        metrics: { latencyMs, outputBytes: buf.length },
        error: null,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const e = buildError({ err });
      recordReliabilityEvent({
        provider: "gemini",
        ts: Date.now(),
        success: false,
        latencyMs,
        errorClass: e.class,
      });
      recordExecutionEvent({
        provider: "gemini",
        operation: "submit",
        stage: "scene_swap",
        success: false,
        latencyMs,
        errorClass: e.class,
        errorCode: e.code,
        errorMessage: e.message,
      });
      return {
        provider: "gemini",
        providerJobId: null,
        status: "failed",
        assetUrls: [],
        thumbnails: [],
        retryable: e.retryable,
        terminal: e.terminal,
        degraded: false,
        raw: null,
        metrics: { latencyMs },
        error: e,
      };
    }
  },

  async poll(providerJobId) {
    return {
      provider: "gemini",
      providerJobId,
      status: "completed",
      assetUrls: [],
      thumbnails: [],
      retryable: false,
      terminal: true,
      degraded: false,
      raw: null,
      metrics: {},
      error: null,
    };
  },

  async getResult(providerJobId) {
    return this.poll(providerJobId);
  },

  normalizeWebhook(_raw) {
    // Gemini has no webhook channel on this platform. Return a TERMINAL
    // failure NormalizedResult so any future caller that reaches here
    // by mistake gets a clear signal instead of a silent partial.
    return {
      provider: "gemini",
      providerJobId: null,
      status: "failed",
      assetUrls: [],
      thumbnails: [],
      retryable: false,
      terminal: true,
      degraded: false,
      raw: null,
      metrics: {},
      error: {
        class: "TERMINAL",
        code: "WEBHOOK_FAILURE",
        message: "Gemini does not expose a webhook channel",
        retryable: false,
        terminal: true,
      },
    };
  },

  classifyFailure: buildError,
};
