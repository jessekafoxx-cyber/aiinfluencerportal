/**
 * Recover Whop buyers who fell through the broken-webhook gap.
 *
 * The bundle iframe path attaches metadata.orderId to every Whop receipt so
 * the live webhook can flip the matching orders row to paid and call
 * enrollPurchaserAndSendEmail. Buyers who used the Whop hosted checkout page
 * (whop.com/...) instead never carry that metadata, so even with a working
 * webhook there is nothing to match. This script recovers them by:
 *
 *   1. Listing every paid receipt for the configured business.
 *   2. Looking up each buyer's email via the Whop user endpoint.
 *   3. Grouping receipts by lower-cased email so a buyer who bought the main
 *      product plus an order bump becomes one synthetic order with both
 *      entitlements set, not two separate rows.
 *   4. Upserting an orders row keyed on a deterministic recovery id so
 *      reruns are idempotent (`recovery-<sha1(email)>`).
 *   5. Calling enrollPurchaserAndSendEmail. It dedupes on
 *      (email, orderId) via email_logs so reruns will not double-send.
 *
 * Usage:
 *   DRY_RUN=1 pnpm --filter @workspace/scripts run recover:whop-buyers
 *   pnpm --filter @workspace/scripts run recover:whop-buyers   # writes + emails
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID                  (required)
 *   DATABASE_URL                                     (required)
 *   CLERK_SECRET_KEY                                 (required for invitations)
 *   RESEND_API_KEY (or whatever sendEmail needs)     (required to send)
 *   LOOKBACK_HOURS                                   (default: 168 = 7 days)
 *   ONLY_EMAIL=foo@bar.com                           (recover a single buyer)
 *   SKIP_EMAIL=1                                     (DB updates only, no email)
 *   DRY_RUN=1                                        (no writes, no emails)
 */

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";
import { getWhopProductByProductId } from "@workspace/api-server/whopProducts";

const WHOP_API_BASE = "https://api.whop.com/api/v2";
const WHOP_API_KEY = process.env.WHOP_API_KEY || "";
const WHOP_BUSINESS_ID = process.env.WHOP_BUSINESS_ID || "";
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || "168");
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_EMAIL = process.env.SKIP_EMAIL === "1";
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();

if (!WHOP_API_KEY || !WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}

interface WhopReceipt {
  id: string;
  user?: string;
  product?: string;
  plan?: string;
  status?: string;
  total?: number;
  subtotal?: number;
  paid_at?: number;
  refunded_amount?: number;
  billing_first_name?: string | null;
  billing_last_name?: string | null;
  metadata?: Record<string, unknown>;
}

interface WhopReceiptListResponse {
  pagination?: { current_page: number; total_page: number; total_count: number };
  data: WhopReceipt[];
}

interface WhopUser {
  id: string;
  email?: string | null;
  username?: string | null;
  name?: string | null;
}

const headers = {
  Authorization: `Bearer ${WHOP_API_KEY}`,
  "X-Company-ID": WHOP_BUSINESS_ID,
  Accept: "application/json",
};

async function whopGet<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${WHOP_API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whop GET ${path} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function listAllPaidReceipts(startedAfterSeconds: number): Promise<WhopReceipt[]> {
  const all: WhopReceipt[] = [];
  let page = 1;
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

const userCache = new Map<string, WhopUser | null>();
async function fetchUser(whopUserId: string): Promise<WhopUser | null> {
  if (userCache.has(whopUserId)) return userCache.get(whopUserId) ?? null;
  try {
    const u = await whopGet<WhopUser>(`/users/${whopUserId}`);
    userCache.set(whopUserId, u);
    return u;
  } catch (err) {
    console.warn(`[user] fetch failed ${whopUserId}:`, (err as Error).message);
    userCache.set(whopUserId, null);
    return null;
  }
}

// productId -> field on `orders`. Only entitlements we know how to grant.
// bump1 is deprecated. Coaching/DFY/Portugal/credit packs are handled by
// other dedicated flows (claimDfyAgreementFromWhop etc.) and are
// intentionally excluded here.
function productIdToOrdersField(productId: string): keyof typeof ordersTable.$inferSelect | null {
  const def = getWhopProductByProductId(productId);
  if (!def) return null;
  switch (def.slug) {
    case "main":
      return "mainProductPaid";
    case "bump2":
      return "bump2Paid";
    case "bump3":
      return "bump3Paid";
    case "upsell1":
      return "upsell1Paid";
    case "downsell1":
      return "downsell1Paid";
    default:
      return null;
  }
}

function recoveryOrderId(email: string): string {
  const hash = crypto.createHash("sha1").update(email).digest("hex").slice(0, 16);
  return `recovery-${hash}`;
}

interface BuyerBucket {
  email: string;
  whopUserId: string;
  firstName?: string | null;
  lastName?: string | null;
  receipts: WhopReceipt[];
  fields: Set<keyof typeof ordersTable.$inferSelect>;
  totalCents: number;
}

async function main() {
  const startedAfter = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  console.log(
    `[recover] listing paid receipts since ${new Date(startedAfter * 1000).toISOString()} (lookback=${LOOKBACK_HOURS}h, DRY_RUN=${DRY_RUN}, ONLY_EMAIL=${ONLY_EMAIL || "(all)"})`,
  );
  const receipts = await listAllPaidReceipts(startedAfter);
  console.log(`[recover] fetched ${receipts.length} paid receipt(s)`);

  // Bucket receipts by buyer email.
  const byEmail = new Map<string, BuyerBucket>();
  let skippedNoUser = 0;
  let skippedNoEmail = 0;
  let skippedNoMapping = 0;
  let skippedRefunded = 0;

  for (const r of receipts) {
    if ((r.refunded_amount ?? 0) > 0) {
      skippedRefunded += 1;
      continue;
    }
    if (!r.user) {
      skippedNoUser += 1;
      continue;
    }
    if (!r.product) {
      skippedNoMapping += 1;
      continue;
    }
    const field = productIdToOrdersField(r.product);
    if (!field) {
      skippedNoMapping += 1;
      continue;
    }
    const u = await fetchUser(r.user);
    const email = (u?.email || "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      skippedNoEmail += 1;
      continue;
    }
    if (ONLY_EMAIL && email !== ONLY_EMAIL) continue;

    let bucket = byEmail.get(email);
    if (!bucket) {
      bucket = {
        email,
        whopUserId: r.user,
        firstName: r.billing_first_name ?? u?.name?.split(" ")[0] ?? null,
        lastName:
          r.billing_last_name ?? u?.name?.split(" ").slice(1).join(" ") ?? null,
        receipts: [],
        fields: new Set(),
        totalCents: 0,
      };
      byEmail.set(email, bucket);
    }
    bucket.receipts.push(r);
    bucket.fields.add(field);
    // Whop returns dollars in `total` for /payments listings; multiply.
    bucket.totalCents += Math.round(((r.total ?? r.subtotal ?? 0) as number) * 100);
  }

  console.log(
    `[recover] bucketed into ${byEmail.size} unique buyer(s). skipped: refunded=${skippedRefunded}, no-user=${skippedNoUser}, no-email=${skippedNoEmail}, unmapped-product=${skippedNoMapping}`,
  );

  if (DRY_RUN) {
    for (const b of byEmail.values()) {
      console.log(
        `[dry-run] ${b.email} fields=${[...b.fields].join(",")} totalCents=${b.totalCents} receipts=${b.receipts.length}`,
      );
    }
    console.log(`[recover] DRY_RUN=1 -- nothing written. Set DRY_RUN=0 to apply.`);
    return;
  }

  let okOrders = 0;
  let okEmails = 0;
  let failed = 0;
  for (const b of byEmail.values()) {
    const recoveryId = recoveryOrderId(b.email);
    try {
      const updates: Record<string, unknown> = {
        email: b.email,
        firstName: b.firstName ?? undefined,
        lastName: b.lastName ?? undefined,
        whopUserId: b.whopUserId,
        totalAmount: b.totalCents,
        updatedAt: new Date(),
      };
      for (const f of b.fields) updates[f as string] = true;

      // Insert if missing, otherwise OR-merge the paid flags. Using
      // onConflictDoUpdate keyed on the deterministic recovery id makes
      // reruns idempotent.
      await db
        .insert(ordersTable)
        .values({ id: recoveryId, ...(updates as any) })
        .onConflictDoUpdate({
          target: ordersTable.id,
          set: updates as any,
        });
      okOrders += 1;
      console.log(
        `[order] ${b.email} -> ${recoveryId} fields=${[...b.fields].join(",")}`,
      );

      if (!SKIP_EMAIL && b.fields.has("mainProductPaid")) {
        const result = await enrollPurchaserAndSendEmail({
          email: b.email,
          orderId: recoveryId,
        });
        okEmails += 1;
        console.log(`[email] ${b.email} -> ${JSON.stringify(result)}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${b.email}`, err);
    }
  }

  console.log(
    `[recover] done. orders_upserted=${okOrders} emails_sent=${okEmails} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[recover] fatal", err);
    process.exit(1);
  });
