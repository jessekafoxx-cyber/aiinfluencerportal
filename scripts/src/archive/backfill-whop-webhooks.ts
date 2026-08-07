/**
 * Backfill Whop payment webhooks.
 *
 * Lists every paid receipt from Whop within the lookback window, then for any
 * receipt that carries metadata.orderId, replays it through our existing
 * /api/whop/webhook endpoint with a valid HMAC signature. This reuses 100%
 * of the live webhook code (bundle path, single-plan path, enrollment email,
 * Meta CAPI, affiliate credit, etc.) so a backfill is identical to a fresh
 * delivery -- including the idempotency guards that prevent double-grants.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:whop-webhooks
 *
 * Env:
 *   WHOP_API_KEY            (required)
 *   WHOP_BUSINESS_ID        (required)
 *   WHOP_WEBHOOK_SECRET     (required - same secret the live webhook uses)
 *   WEBHOOK_TARGET_URL      (default: http://localhost:8080/api/whop/webhook)
 *   LOOKBACK_HOURS          (default: 72)
 *   DRY_RUN                 ("1" to list receipts without posting)
 */

import crypto from "node:crypto";

const WHOP_API_BASE = "https://api.whop.com/api/v2";
const WHOP_API_KEY = process.env.WHOP_API_KEY || "";
const WHOP_BUSINESS_ID = process.env.WHOP_BUSINESS_ID || "";
const WHOP_WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET || "";
const WEBHOOK_TARGET_URL =
  process.env.WEBHOOK_TARGET_URL || "http://localhost:8080/api/whop/webhook";
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || "72");
const DRY_RUN = process.env.DRY_RUN === "1";

if (!WHOP_API_KEY || !WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}
if (!WHOP_WEBHOOK_SECRET && !DRY_RUN) {
  console.error("Missing WHOP_WEBHOOK_SECRET (required to sign replay events)");
  process.exit(1);
}

interface WhopReceipt {
  id: string;
  user?: string | { id: string; email?: string };
  user_id?: string;
  membership?: string;
  membership_id?: string;
  plan?: string;
  plan_id?: string;
  product?: string;
  product_id?: string;
  status?: string;
  total?: number;
  subtotal?: number;
  currency?: string;
  paid_at?: number | string;
  created_at?: number | string;
  metadata?: Record<string, unknown>;
}

interface WhopReceiptListResponse {
  pagination?: { current_page: number; total_page: number; total_count: number };
  data: WhopReceipt[];
}

async function whopGet<T>(path: string, query: Record<string, unknown>): Promise<T> {
  const url = new URL(`${WHOP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${WHOP_API_KEY}`,
      "X-Company-ID": WHOP_BUSINESS_ID,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whop GET ${path} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function listAllReceipts(startedAfterSeconds: number): Promise<WhopReceipt[]> {
  const all: WhopReceipt[] = [];
  let page = 1;
  // Hard cap so a misconfigured cursor cannot loop forever.
  while (page <= 50) {
    const resp = await whopGet<WhopReceiptListResponse>("/payments", {
      page,
      per: 100,
      started_after: startedAfterSeconds,
      status: "paid",
    });
    const batch = resp?.data || [];
    all.push(...batch);
    const totalPages = resp?.pagination?.total_page || 1;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }
  return all;
}

function signAndBuildHeaders(rawBody: string): Record<string, string> {
  const computed = crypto
    .createHmac("sha256", WHOP_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Whop-Signature": `sha256=${computed}`,
  };
}

interface ReplayResult {
  receiptId: string;
  orderId: string | undefined;
  status: number;
  body: string;
}

async function replayReceipt(receipt: WhopReceipt): Promise<ReplayResult> {
  const event = {
    id: `backfill_${receipt.id}`,
    action: "payment.succeeded",
    api_version: "v2",
    data: receipt,
  };
  const rawBody = JSON.stringify(event);
  const headers = signAndBuildHeaders(rawBody);
  const res = await fetch(WEBHOOK_TARGET_URL, {
    method: "POST",
    headers,
    body: rawBody,
  });
  const body = await res.text();
  return {
    receiptId: receipt.id,
    orderId: (receipt.metadata?.orderId as string | undefined) || undefined,
    status: res.status,
    body: body.slice(0, 200),
  };
}

async function main() {
  const startedAfter = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  console.log(
    `[backfill] listing Whop paid receipts since ${new Date(startedAfter * 1000).toISOString()} (lookback=${LOOKBACK_HOURS}h)`,
  );
  const receipts = await listAllReceipts(startedAfter);
  console.log(`[backfill] fetched ${receipts.length} paid receipt(s) from Whop`);

  const withOrderId = receipts.filter(
    (r) => typeof r.metadata?.orderId === "string" && (r.metadata.orderId as string).length > 0,
  );
  const withoutOrderId = receipts.length - withOrderId.length;
  console.log(
    `[backfill] ${withOrderId.length} carry metadata.orderId; ${withoutOrderId} skipped (no orderId, e.g. DFY/coaching/upsells handled by other paths)`,
  );

  if (DRY_RUN) {
    for (const r of withOrderId) {
      console.log(
        `[dry-run] receipt=${r.id} orderId=${r.metadata?.orderId} planId=${r.plan ?? r.plan_id} total=${r.total} paid_at=${r.paid_at}`,
      );
    }
    console.log(`[backfill] DRY_RUN=1 -- nothing posted. Set DRY_RUN=0 to replay.`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const r of withOrderId) {
    try {
      const result = await replayReceipt(r);
      if (result.status >= 200 && result.status < 300) {
        ok += 1;
        console.log(
          `[ok] receipt=${result.receiptId} orderId=${result.orderId} status=${result.status}`,
        );
      } else {
        failed += 1;
        console.warn(
          `[fail] receipt=${result.receiptId} orderId=${result.orderId} status=${result.status} body=${result.body}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`[error] receipt=${r.id} orderId=${r.metadata?.orderId}`, err);
    }
  }

  console.log(`[backfill] done. ok=${ok} failed=${failed} skipped=${withoutOrderId}`);
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
