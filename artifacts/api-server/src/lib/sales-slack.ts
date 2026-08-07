// Sales / lead Slack notifier.
//
// Three independent #-channel webhooks, one per event type:
//   - SLACK_WEBHOOK_LEADS         -> #leads (every funnel email capture)
//   - SLACK_WEBHOOK_LOWTICKETSALE -> #low-ticket (paid order < $400)
//   - SLACK_WEBHOOK_HIGHTICKETSALE-> #high-ticket-sale (paid order >= $400)
//
// Per the user's setup choice, a single paid order produces exactly ONE
// Slack message: high-ticket sales fire the high-ticket webhook and SKIP
// the low-ticket one. Threshold is HIGH_TICKET_THRESHOLD_CENTS (= 40000,
// i.e. $400.00). Adjust there if you ever want to retune.
//
// Modeled on `ops-slack.ts`: fire-and-forget, 10s timeout via
// AbortController, unset env var = log-only no-throw, non-2xx / network
// failure = warn log no-throw. A flaky webhook must NEVER block a lead
// upsert or a paid-state flip.

import { logger } from "./logger";

export const HIGH_TICKET_THRESHOLD_CENTS = 40000; // $400.00

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

async function postSlack(opts: {
  source: string;
  webhookUrl: string | undefined;
  webhookEnvName: string;
  text: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const { source, webhookUrl, webhookEnvName, text, context } = opts;
  const url = webhookUrl?.trim();
  if (!url) {
    logger.info(
      { source, webhookEnvName, ...(context ?? {}) },
      `[${source}] ${webhookEnvName} unset; skipping Slack notify (log-only)`,
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

function fmtUsd(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Fired once per funnel email capture (after the lead row is upserted). */
export function notifyLeadCaptured(opts: {
  email: string;
  firstName?: string | null;
  phone?: string | null;
  country?: string | null;
  sourcePage?: string | null;
  referrer?: string | null;
}): void {
  const lines: string[] = [];
  lines.push(`:bust_in_silhouette: *New lead* - ${opts.email}`);
  const meta: string[] = [];
  if (opts.firstName) meta.push(`name: ${opts.firstName}`);
  if (opts.phone) meta.push(`phone: ${opts.phone}`);
  if (opts.country) meta.push(`country: ${opts.country}`);
  if (opts.sourcePage) meta.push(`page: ${opts.sourcePage}`);
  if (opts.referrer) meta.push(`ref: ${opts.referrer}`);
  if (meta.length) lines.push(meta.join(" · "));
  void postSlack({
    source: "sales-slack/lead",
    webhookUrl: process.env.SLACK_WEBHOOK_LEADS,
    webhookEnvName: "SLACK_WEBHOOK_LEADS",
    text: lines.join("\n"),
    context: { email: opts.email },
  });
}

/**
 * Fired once per paid event whose per-flip amount is above the high-ticket
 * threshold ($400). Always routes to SLACK_WEBHOOK_HIGHTICKETSALE.
 * Low-ticket funnel orders are intentionally NOT handled here - they
 * fire once-per-order via notifyLowTicketOrderSummary from the
 * GET /api/funnel/order/:oid endpoint (so the message includes the
 * full cart total + every bump/upsell, not one ping per flip).
 *
 * `forceHighTicket` bypasses the $400 threshold so a product line can opt
 * into the high-ticket channel regardless of price (used by the managed DFY
 * Ads / DFY Content services, whose Bronze tiers sit below $400 but should
 * still notify the high-ticket-sale channel). A $0 order never posts.
 */
export function notifyPaidOrder(opts: {
  email: string | null;
  customerName?: string | null;
  productLabel: string;
  amountCents: number;
  orderRef: string;
  source: string;
  detailUrl?: string | null;
  forceHighTicket?: boolean;
}): void {
  if (opts.amountCents <= 0) return;
  if (!opts.forceHighTicket && opts.amountCents <= HIGH_TICKET_THRESHOLD_CENTS) return;
  const customerName = opts.customerName?.trim() || null;
  const lines: string[] = [];
  lines.push(
    `:rocket: *HIGH-TICKET sale* - ${fmtUsd(opts.amountCents)} ${opts.productLabel}`,
  );
  if (customerName) lines.push(`Customer: ${customerName}`);
  const meta: string[] = [];
  if (opts.email) meta.push(opts.email);
  meta.push(opts.orderRef);
  meta.push(`via ${opts.source}`);
  lines.push(meta.join(" · "));
  if (opts.detailUrl) lines.push(opts.detailUrl);
  void postSlack({
    source: "sales-slack/high-ticket",
    webhookUrl: process.env.SLACK_WEBHOOK_HIGHTICKETSALE,
    webhookEnvName: "SLACK_WEBHOOK_HIGHTICKETSALE",
    text: lines.join("\n"),
    context: {
      email: opts.email,
      customerName,
      amountCents: opts.amountCents,
      productLabel: opts.productLabel,
      orderRef: opts.orderRef,
    },
  });
}

/**
 * Fires ONCE per low-ticket funnel order (idempotency owned upstream
 * via the orders.low_ticket_slack_posted_at atomic-claim pattern in
 * GET /api/funnel/order/:oid). Posts a single message to
 * SLACK_WEBHOOK_LOWTICKETSALE with the full cart total + every item
 * the buyer ended up with (main + bumps + upsells/downsells).
 */
export function notifyLowTicketOrderSummary(opts: {
  email: string | null;
  orderId: string;
  totalCents: number;
  items: Array<{ slug: string; name: string; priceCents: number }>;
}): void {
  if (!opts.items.length) return;
  const lines: string[] = [];
  lines.push(
    `:money_with_wings: *New sale* - ${fmtUsd(opts.totalCents)} total · ${opts.items.length} item${opts.items.length === 1 ? "" : "s"}`,
  );
  if (opts.email) lines.push(opts.email);
  for (const it of opts.items) {
    lines.push(`• ${it.name} (${fmtUsd(it.priceCents)})`);
  }
  lines.push(`order #${opts.orderId}`);
  void postSlack({
    source: "sales-slack/low-ticket",
    webhookUrl: process.env.SLACK_WEBHOOK_LOWTICKETSALE,
    webhookEnvName: "SLACK_WEBHOOK_LOWTICKETSALE",
    text: lines.join("\n"),
    context: {
      email: opts.email,
      orderId: opts.orderId,
      totalCents: opts.totalCents,
      itemCount: opts.items.length,
    },
  });
}
