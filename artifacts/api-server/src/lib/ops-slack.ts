// Task #701: shared #ops Slack webhook poster.
//
// Shared by the AI Influencer stuck-job alerter (and any future ops
// alerting site). Behavior:
//   - `OPS_SLACK_WEBHOOK_URL` unset -> log-only, no throw.
//   - 10s timeout via AbortController.
//   - Non-2xx response -> warn log (truncated body), no throw.
//   - Network / timeout error -> warn log, no throw.
// Fire-and-forget: a flaky webhook must not bubble into the caller.

import { logger } from "./logger";

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

export async function postOpsSlackAlert(opts: {
  source: string;
  text: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const { source, text, context } = opts;
  const url = process.env.OPS_SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    logger.info(
      { source, ...(context ?? {}) },
      `[${source}] OPS_SLACK_WEBHOOK_URL unset; skipping Slack alert (log-only)`,
    );
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { source, status: res.status, body: body.slice(0, 200), ...(context ?? {}) },
        `[${source}] Slack webhook returned non-2xx`,
      );
    }
  } catch (err: unknown) {
    logger.warn(
      { source, err: errMessage(err), ...(context ?? {}) },
      `[${source}] Slack webhook POST failed`,
    );
  } finally {
    clearTimeout(timer);
  }
}
