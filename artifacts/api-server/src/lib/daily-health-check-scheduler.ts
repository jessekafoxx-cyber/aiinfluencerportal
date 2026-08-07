// Task #774: daily prevention audit layer.
//
// Runs the shared read-only health audits (see ./health-audits.ts) once a
// day on the worker. On any finding it emits a `[daily-health-check]` warn
// log with the structured findings AND posts a summarized alert to the
// #ops Slack webhook (OPS_SLACK_WEBHOOK_URL) so the recurring Room30
// support failure modes get caught the same day rather than when the next
// customer reports them. Clean passes stay silent on Slack (log-only) so
// the channel does not get spammed.
//
// Read-only: the audits only SELECT / external-GET. This scheduler never
// writes to the DB or any third party other than the Slack webhook.
//
// Prod-only: like the other ops schedulers, this only fires when
// NODE_ENV === 'production' unless DAILY_HEALTH_CHECK_ALLOW_DEV=1.
// Kill switch: DAILY_HEALTH_CHECK_DISABLED=1.
// Cadence override: DAILY_HEALTH_CHECK_INTERVAL_MS (default 24h, floor 1h).

import { logger } from "./logger";
import { postOpsSlackAlert } from "./ops-slack";
import { runHealthAudits } from "./health-audits";

const SOURCE = "daily-health-check";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 5 * 60 * 1000;

function resolveIntervalMs(): number {
  const raw = process.env.DAILY_HEALTH_CHECK_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, parsed);
}

async function runOnce(): Promise<void> {
  try {
    const report = await runHealthAudits();
    if (!report.hasFindings) {
      logger.info(
        { durationMs: report.durationMs },
        `[${SOURCE}] all audits passed`,
      );
      return;
    }
    const findings = report.audits.filter((a) => a.severity !== "ok");
    logger.warn(
      { findings, durationMs: report.durationMs },
      `[${SOURCE}] findings detected`,
    );
    const lines = findings.map((a) => `- [${a.severity.toUpperCase()}] ${a.label}: ${a.summary}`);
    await postOpsSlackAlert({
      source: SOURCE,
      text: `AI Influencer Portfolio daily health check found ${findings.length} issue(s):\n${lines.join("\n")}`,
      context: { findingCount: findings.length },
    });
  } catch (err: unknown) {
    const message = err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message) : String(err);
    logger.error({ err: message }, `[${SOURCE}] run failed`);
  }
}

export function startDailyHealthCheckScheduler(): void {
  if (process.env.DAILY_HEALTH_CHECK_DISABLED === "1") {
    logger.info(`[${SOURCE}] disabled via DAILY_HEALTH_CHECK_DISABLED=1`);
    return;
  }
  const allowDev = process.env.DAILY_HEALTH_CHECK_ALLOW_DEV === "1";
  if (process.env.NODE_ENV !== "production" && !allowDev) {
    logger.info(
      `[${SOURCE}] skipped (NODE_ENV !== 'production'; set DAILY_HEALTH_CHECK_ALLOW_DEV=1 to run in dev)`,
    );
    return;
  }
  const intervalMs = resolveIntervalMs();
  logger.info(
    { intervalMs, bootDelayMs: BOOT_DELAY_MS },
    `[${SOURCE}] scheduler started`,
  );
  const boot = setTimeout(() => {
    void runOnce();
    const timer = setInterval(() => void runOnce(), intervalMs);
    timer.unref?.();
  }, BOOT_DELAY_MS);
  boot.unref?.();
}
