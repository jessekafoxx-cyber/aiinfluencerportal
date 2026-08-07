// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Provider reliability scoring (placeholder infrastructure).
//
// In-memory ring buffer of recent provider call outcomes. Exposes a
// rolled-up snapshot via getReliabilitySnapshot() so an admin endpoint
// (or future router) can read it. Does NOT influence runtime decisions
// in this slice - ENABLE_PROVIDER_SCORING gates any future use.
// ─────────────────────────────────────────────────────────────────────────────

import type { FailureClass, ProviderId } from "./types";

export interface ReliabilityEvent {
  provider: ProviderId;
  ts: number;
  success: boolean;
  latencyMs?: number;
  errorClass?: FailureClass;
}

export interface ReliabilitySnapshot {
  provider: ProviderId;
  sampleSize: number;
  successRate: number;
  avgLatency: number | null;
  timeoutRate: number;
  emptyOutputRate: number;
  webhookFailureRate: number;
}

const RING_LIMIT = 500;
const buffers: Record<ProviderId, ReliabilityEvent[]> = {
  higgsfield: [],
  enhancor: [],
  gemini: [],
};

// Best-effort, non-throwing recorder. Adapters call this from inside a
// try/catch wrapper so a recording failure can never fail the request.
export function recordReliabilityEvent(ev: ReliabilityEvent): void {
  try {
    const buf = buffers[ev.provider];
    if (!buf) return;
    buf.push(ev);
    if (buf.length > RING_LIMIT) {
      buf.splice(0, buf.length - RING_LIMIT);
    }
  } catch {
    // swallow - reliability scoring must never break a provider call
  }
}

function rollUp(provider: ProviderId): ReliabilitySnapshot {
  const buf = buffers[provider];
  const sampleSize = buf.length;
  if (sampleSize === 0) {
    return {
      provider,
      sampleSize: 0,
      successRate: 0,
      avgLatency: null,
      timeoutRate: 0,
      emptyOutputRate: 0,
      webhookFailureRate: 0,
    };
  }
  let successes = 0;
  let timeouts = 0;
  let emptyOutputs = 0;
  let webhookFailures = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  for (const ev of buf) {
    if (ev.success) successes++;
    if (ev.errorClass === "TIMEOUT") timeouts++;
    if (ev.errorClass === "EMPTY_OUTPUT") emptyOutputs++;
    if (ev.errorClass === "WEBHOOK_MISSING") webhookFailures++;
    if (typeof ev.latencyMs === "number") {
      latencyTotal += ev.latencyMs;
      latencyCount++;
    }
  }
  return {
    provider,
    sampleSize,
    successRate: successes / sampleSize,
    avgLatency: latencyCount > 0 ? latencyTotal / latencyCount : null,
    timeoutRate: timeouts / sampleSize,
    emptyOutputRate: emptyOutputs / sampleSize,
    webhookFailureRate: webhookFailures / sampleSize,
  };
}

export function getReliabilitySnapshot(): ReliabilitySnapshot[] {
  return (Object.keys(buffers) as ProviderId[]).map(rollUp);
}

export function getReliabilityFor(provider: ProviderId): ReliabilitySnapshot {
  return rollUp(provider);
}

// Visible for tests.
export function _resetReliabilityForTests(): void {
  for (const k of Object.keys(buffers) as ProviderId[]) {
    buffers[k].length = 0;
  }
}
