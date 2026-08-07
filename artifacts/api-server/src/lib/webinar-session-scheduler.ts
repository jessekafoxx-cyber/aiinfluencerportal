// Task #797 - Evergreen Webinar session generator + status sweep.
//
// Runs on the Media Worker. Each tick:
//   1. Ensures the next `upcomingCount` future sessions exist (idempotent
//      on the starts_at unique index).
//   2. Sweeps session statuses (scheduled -> live -> ended) so admin
//      lists reflect the wall clock without a viewer hitting the public
//      endpoints.
//
// Kill switch: WEBINAR_SCHEDULER_DISABLED=1.
// Cadence override: WEBINAR_SCHEDULER_INTERVAL_MS (default 5 min, floor 60s).

import { getWebinarSettings, ensureUpcomingSessions, sweepSessionStatuses } from "./webinar";
import { logger } from "./logger";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_DELAY_MS = 30 * 1000;

let started = false;
let timer: NodeJS.Timeout | null = null;

function readIntervalMs(): number {
  const raw = process.env["WEBINAR_SCHEDULER_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_INTERVAL_MS;
  return n;
}

async function runOnce(): Promise<void> {
  const settings = await getWebinarSettings();
  await ensureUpcomingSessions(settings);
  await sweepSessionStatuses();
}

function arm(intervalMs: number): void {
  timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error({ err }, "[webinar-scheduler] tick threw");
    }
    arm(intervalMs);
  }, intervalMs);
  timer.unref?.();
}

export function startWebinarSessionScheduler(): void {
  if (started) return;
  if (process.env["WEBINAR_SCHEDULER_DISABLED"] === "1") {
    logger.warn("WEBINAR_SCHEDULER_DISABLED=1 set; webinar session scheduler will not start");
    return;
  }
  started = true;
  const intervalMs = readIntervalMs();
  logger.info({ intervalMs, firstDelayMs: FIRST_DELAY_MS }, "webinar session scheduler started");
  const first = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error({ err }, "[webinar-scheduler] first tick threw");
    }
    arm(intervalMs);
  }, FIRST_DELAY_MS);
  first.unref?.();
}

export function stopWebinarSessionScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
}
