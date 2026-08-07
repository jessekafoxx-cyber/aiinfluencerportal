// T210: per-host token-bucket pacing. Both Instagram and Facebook flap
// a healthy session into a login wall when the worker fans out a burst
// of extractor calls in the same second. The previous architecture had
// no host-level admission control, so a single worker tick that pulled
// 10 IG rows would emit 10 yt-dlp / Apify calls back-to-back and
// reliably trip IG's anti-bot heuristics within the first minute.
//
// This module gates every IG / FB extractor call (yt-dlp + Apify) on
// a per-host token bucket so no two outbound calls to the same host
// fire closer than the configured minimum spacing. The bucket is
// purely in-process - safe across the API server and the Media Worker
// because the Media Worker is the only process that issues extractor
// calls in production.
//
// Defaults:
//   IG: 1 call per ~10s   (env: T210_IG_MIN_INTERVAL_MS, default 10000)
//   FB: 1 call per ~6s    (env: T210_FB_MIN_INTERVAL_MS, default 6000)
//   other hosts: no pacing
//
// Public API:
//   awaitPaceSlot(host)        - resolves once a slot is available;
//                                resolves immediately for unpaced hosts.
//   getPacingSnapshot()        - dashboard-friendly view of current
//                                slot timestamps + queued waiters.
//
// Pacing is best-effort and intentionally simple. We do NOT model
// burst capacity - the goal is to break up tight bursts, not to
// throttle steady-state throughput. If a stricter shape is needed in
// the future, swap the implementation for a leaky-bucket with
// configurable burst.

import { logger } from "./logger";

export type PacedHost = "ig" | "fb";

interface BucketState {
  // Wall-clock (ms epoch) at or after which the next call may proceed.
  nextAvailableAt: number;
  // Sum of waits paid since process start, ms. Surfaced for the
  // dashboard so an operator can see how much queue time pacing has
  // imposed at any moment.
  totalWaitedMs: number;
  // Count of calls that observed a non-zero wait.
  pacedCalls: number;
  // Count of calls overall.
  totalCalls: number;
}

const buckets: Record<PacedHost, BucketState> = {
  ig: { nextAvailableAt: 0, totalWaitedMs: 0, pacedCalls: 0, totalCalls: 0 },
  fb: { nextAvailableAt: 0, totalWaitedMs: 0, pacedCalls: 0, totalCalls: 0 },
};

function envIntervalMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function intervalForHost(host: PacedHost): number {
  if (host === "ig") return envIntervalMs("T210_IG_MIN_INTERVAL_MS", 10_000);
  return envIntervalMs("T210_FB_MIN_INTERVAL_MS", 6_000);
}

function classifyHost(input: string | null | undefined): PacedHost | null {
  const s = (input || "").toLowerCase();
  if (!s) return null;
  if (s === "ig" || s.includes("instagram")) return "ig";
  if (s === "fb" || s.includes("facebook")) return "fb";
  return null;
}

/**
 * Reserve a pacing slot for `host`. Resolves immediately for unpaced
 * hosts; otherwise resolves after at most `intervalForHost(host)` ms.
 */
export async function awaitPaceSlot(host: string | null | undefined): Promise<void> {
  const paced = classifyHost(host);
  if (!paced) return;
  const slot = buckets[paced];
  const interval = intervalForHost(paced);
  const now = Date.now();
  slot.totalCalls += 1;
  if (interval <= 0) {
    slot.nextAvailableAt = now;
    return;
  }
  let waitMs = 0;
  if (slot.nextAvailableAt <= now) {
    slot.nextAvailableAt = now + interval;
  } else {
    waitMs = slot.nextAvailableAt - now;
    slot.nextAvailableAt += interval;
  }
  if (waitMs > 0) {
    slot.totalWaitedMs += waitMs;
    slot.pacedCalls += 1;
    logger.debug(
      { host: paced, waitMs, intervalMs: interval, nextAt: new Date(slot.nextAvailableAt).toISOString() },
      "per-host-pacing: deferring extractor call",
    );
    await new Promise<void>((res) => setTimeout(res, waitMs));
  }
}

export interface PacingSnapshot {
  ig: BucketState & { intervalMs: number };
  fb: BucketState & { intervalMs: number };
}

export function getPacingSnapshot(): PacingSnapshot {
  return {
    ig: { ...buckets.ig, intervalMs: intervalForHost("ig") },
    fb: { ...buckets.fb, intervalMs: intervalForHost("fb") },
  };
}

// Test-only helper.
export function _resetPacingForTests(): void {
  buckets.ig = { nextAvailableAt: 0, totalWaitedMs: 0, pacedCalls: 0, totalCalls: 0 };
  buckets.fb = { nextAvailableAt: 0, totalWaitedMs: 0, pacedCalls: 0, totalCalls: 0 };
}
