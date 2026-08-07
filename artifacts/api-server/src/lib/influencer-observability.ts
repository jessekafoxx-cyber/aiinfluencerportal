// ─────────────────────────────────────────────────────────────────────────────
// Task #250 - influencer pipeline observability + error taxonomy.
//
// Centralized normalized error codes, a single stage-transition logger
// helper, and a small set of pure helpers for capping retries and
// trimming the per-job webhook ring buffer. Imported by
// influencer-pipeline.ts and routes/influencer-jobs.ts so the pipeline
// only has one source of truth for "what counts as an error" and "how
// do we log a transition".
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "./logger";
import type { AiInfluencerJob } from "@workspace/db";

// Normalized error taxonomy. Every provider call site maps the raw
// error (HTTP status, SDK exception, empty payload) into one of these
// codes before persisting onto the job row.
export const INFLUENCER_ERROR_CODES = [
  "PROVIDER_TIMEOUT",
  "RATE_LIMIT",
  "INVALID_RESPONSE",
  "EMPTY_OUTPUT",
  "WEBHOOK_FAILURE",
  "SCENE_SWAP_FAILURE",
  // Task #674: scene-swap failure mode taxonomy. Replaces the
  // catch-all SCENE_SWAP_FAILURE for the cases we can distinguish at
  // the Gemini call site so admin diagnostics + replay tooling can
  // tell "Gemini returned text-only / safety-blocked" (EMPTY_RESPONSE)
  // apart from "Gemini timed out" (TIMEOUT), "HTTP 4xx schema error"
  // (INVALID_RESPONSE), or "GPT-4o QA rejected the placement"
  // (QA_REJECTED). SCENE_SWAP_NO_OUTPUT is the terminal job-level
  // verdict when finalize has been re-attempted past the cap with
  // zero usable scenes — it routes the job to status=failed with
  // failureReason=scene_swap_no_output so the user is unblocked.
  "SCENE_SWAP_EMPTY_RESPONSE",
  "SCENE_SWAP_INVALID_RESPONSE",
  "SCENE_SWAP_TIMEOUT",
  "SCENE_SWAP_QA_REJECTED",
  "SCENE_SWAP_NO_OUTPUT",
  // Task #690: granular Gemini scene-swap policy/refusal codes. The
  // adapter classifies the upstream finishReason / blockReason into
  // one of these so the worker stops burning retries on calls that
  // will never succeed and the admin diagnostics row shows the actual
  // cause. SAFETY_BLOCK / RECITATION_BLOCK are terminal; the
  // NO_IMAGE_IN_RESPONSE variant is text-only refusal (retryable once
  // with a softened prompt, then terminal).
  "SAFETY_BLOCK",
  "RECITATION_BLOCK",
  "NO_IMAGE_IN_RESPONSE",
  "SCENE_SWAP_SAFETY_BLOCK",
  "SCENE_SWAP_RECITATION_BLOCK",
  "SCENE_SWAP_NO_IMAGE_IN_RESPONSE",
  "PARTIAL_BATCH_FAILURE",
  "DELIVERY_FAILURE",
  "CONFIG_MISSING",
  // Slice A: marker stamped onto a job that bypassed the Enhancor
  // skin-enhancement stage (empty payload, malformed payload, timeout)
  // and used the base portrait as the enhanced image so the pipeline
  // could continue. Triggers ready_degraded at finalize.
  "ENHANCOR_DEGRADED",
  "WARDROBE_REJECT",
  "QA_REJECT",
  "UNKNOWN",
] as const;

export type InfluencerErrorCode = (typeof INFLUENCER_ERROR_CODES)[number];

// Per-stage retry caps. Generous on the provider hops (network blips
// are common) and tight on finalize so a wedged finalize does not run
// 50 times a minute.
export const RETRY_CAPS: Record<string, number> = {
  higgsfield: 3,
  enhancor: 3,
  scene: 2,
  finalize: 5,
  email: 3,
};

export const WEBHOOK_EVENT_HISTORY_LIMIT = 10;

// Normalize an arbitrary error/response into the taxonomy. Used at the
// call site so the persisted error code is always meaningful.
export function classifyError(input: {
  status?: number;
  err?: unknown;
  responseText?: string;
  emptyOutput?: boolean;
}): { code: InfluencerErrorCode; message: string } {
  const { status, err, responseText, emptyOutput } = input;
  const message =
    (err instanceof Error ? err.message : err ? String(err) : "") ||
    responseText?.slice(0, 200) ||
    "unknown error";
  if (emptyOutput) return { code: "EMPTY_OUTPUT", message: message || "empty provider output" };
  if (status === 408 || /timeout|ETIMEDOUT|ECONNRESET|aborted/i.test(message)) {
    return { code: "PROVIDER_TIMEOUT", message };
  }
  if (status === 429 || /rate.?limit|too many/i.test(message)) {
    return { code: "RATE_LIMIT", message };
  }
  if (status && status >= 400 && status < 500) {
    return { code: "INVALID_RESPONSE", message: `HTTP ${status}: ${message}` };
  }
  if (status && status >= 500) {
    return { code: "PROVIDER_TIMEOUT", message: `HTTP ${status}: ${message}` };
  }
  return { code: "UNKNOWN", message };
}

// Truncate a payload snippet so we never store megabytes of provider
// response on the job row.
export function truncatePayload(value: unknown, maxChars = 500): unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, maxChars);
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxChars) return value;
    return { _truncated: true, snippet: s.slice(0, maxChars) };
  } catch {
    return { _truncated: true, snippet: String(value).slice(0, maxChars) };
  }
}

export type StageLogFields = {
  jobId: number;
  clientId?: number | null;
  fromStage?: string | null;
  toStage: string;
  provider?: string | null;
  providerJobId?: string | null;
  stageElapsedMs?: number | null;
  totalElapsedMs?: number | null;
  retryCount?: number | null;
  assetCount?: number | null;
  sceneCount?: number | null;
  errorCode?: InfluencerErrorCode | null;
  errorMessage?: string | null;
  notes?: Record<string, unknown>;
};

// Single helper used by both the worker (singleton `logger`) and route
// handlers. We accept an optional `log` (req.log) so route handlers can
// keep the request-id correlation, otherwise fall back to the singleton.
export function logStageTransition(
  fields: StageLogFields,
  log?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
): void {
  const sink = log ?? logger;
  const payload = {
    pipeline: "influencer",
    jobId: fields.jobId,
    clientId: fields.clientId ?? null,
    fromStage: fields.fromStage ?? null,
    toStage: fields.toStage,
    provider: fields.provider ?? null,
    providerJobId: fields.providerJobId ?? null,
    stageElapsedMs: fields.stageElapsedMs ?? null,
    totalElapsedMs: fields.totalElapsedMs ?? null,
    retryCount: fields.retryCount ?? null,
    assetCount: fields.assetCount ?? null,
    sceneCount: fields.sceneCount ?? null,
    errorCode: fields.errorCode ?? null,
    errorMessage: fields.errorMessage ?? null,
    ...(fields.notes ?? {}),
  };
  if (fields.errorCode) {
    sink.warn(payload, "influencer stage transition (error)");
  } else {
    sink.info(payload, "influencer stage transition");
  }
}

// Compute "stage elapsed" + "total elapsed" from the job snapshot we
// already have in memory at the call site. Cheap and avoids an extra
// DB roundtrip.
export function computeElapsed(job: Pick<AiInfluencerJob, "createdAt"> & { stageStartedAt?: Date | null }): {
  stageElapsedMs: number | null;
  totalElapsedMs: number;
} {
  const now = Date.now();
  const total = now - new Date(job.createdAt).getTime();
  const stage = job.stageStartedAt ? now - new Date(job.stageStartedAt).getTime() : null;
  return { stageElapsedMs: stage, totalElapsedMs: Math.max(0, total) };
}

// Bounded ring-buffer push for webhook events (kept on the job row).
export function appendWebhookEvent<T>(events: T[], next: T, limit = WEBHOOK_EVENT_HISTORY_LIMIT): T[] {
  const out = [...events, next];
  if (out.length <= limit) return out;
  return out.slice(out.length - limit);
}
