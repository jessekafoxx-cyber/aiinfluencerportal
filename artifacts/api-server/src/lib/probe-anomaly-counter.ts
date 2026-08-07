// T210: lightweight in-process counter of soft (non-jar-flipping)
// auth-health probe anomalies. The auth-health probe used to mark the
// admin-managed cookie jar `expired` on any non-ok probe, including
// soft signals like timeout / actor-error / empty payload. T210 makes
// the probe non-destructive for those signals; this module records
// them so the admin dashboard can still surface "the probe is
// degraded but the jar is intentionally preserved".
//
// Pure in-process state - no DB writes here. The dashboard renders
// `getProbeAnomalySnapshot()` alongside the existing auth-health
// section. State resets implicitly with the worker process and is
// flushed via `snapshotAndResetProbeAnomalies()` from the periodic
// queue-metrics writer.

export type ProbeAnomalyPlatform = "ig" | "fb";

interface PerPlatformAnomaly {
  count: number;
  lastAt: string | null;
  lastReason: string | null;
}

const state: Record<ProbeAnomalyPlatform, PerPlatformAnomaly> = {
  ig: { count: 0, lastAt: null, lastReason: null },
  fb: { count: 0, lastAt: null, lastReason: null },
};

export function noteProbeAnomaly(
  platform: ProbeAnomalyPlatform,
  reason: string,
): void {
  const slot = state[platform];
  slot.count += 1;
  slot.lastAt = new Date().toISOString();
  slot.lastReason = (reason || "").slice(0, 120);
}

export function getProbeAnomalySnapshot(): Record<ProbeAnomalyPlatform, PerPlatformAnomaly> {
  return {
    ig: { ...state.ig },
    fb: { ...state.fb },
  };
}

export function snapshotAndResetProbeAnomalies(): Record<ProbeAnomalyPlatform, PerPlatformAnomaly> {
  const snap = getProbeAnomalySnapshot();
  state.ig = { count: 0, lastAt: null, lastReason: null };
  state.fb = { count: 0, lastAt: null, lastReason: null };
  return snap;
}
