/**
 * Task #456 backfill: recover orders stuck on the /thankyou setup-account
 * 403 because `mainProductPaid = false` even though Whop has a paid
 * receipt for the order id.
 *
 * Selects every orders row where `mainProductPaid = false` AND
 * `createdAt > SINCE`, looks each one up against Whop using the same
 * paths /portal/setup-account uses (stored whopReceiptId, then a
 * metadata.orderId scan over recent paid receipts), then back-fills the
 * paid flags + whopReceiptId / whopUserId / totalAmount and triggers
 * `enrollPurchaserAndSendEmail` so each buyer gets the canonical "set
 * your password" email. Idempotent on email+orderId via email_logs, so
 * safe to re-run.
 *
 * Usage:
 *   DRY_RUN=1 pnpm --filter @workspace/scripts run recover:thankyou-stuck
 *   pnpm --filter @workspace/scripts run recover:thankyou-stuck
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID    (required)
 *   DATABASE_URL                       (required)
 *   CLERK_SECRET_KEY                   (required for enrollment)
 *   RESEND_API_KEY                     (required to send emails)
 *   SINCE_HOURS                        (default: 168 = 7 days)
 *   ONLY_OID=ord_xxx                   (recover a single order)
 *   DRY_RUN=1                          (no writes, no emails)
 *   SKIP_EMAIL=1                       (DB updates only)
 */

import { and, eq, gt } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import {
  getReceipt as whopGetReceipt,
  listReceipts as whopListReceipts,
  type WhopReceipt,
} from "@workspace/api-server/whopClient";
import {
  WHOP_PRODUCTS,
  getWhopProductByPlanId,
} from "@workspace/api-server/whopProducts";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";

const SINCE_HOURS = Number(process.env.SINCE_HOURS || "168");
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_EMAIL = process.env.SKIP_EMAIL === "1";
const ONLY_OID = (process.env.ONLY_OID || "").trim();

if (!process.env.WHOP_API_KEY || !process.env.WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}

interface VerifyResult {
  matched: WhopReceipt | null;
  path: "receipt_id" | "metadata_scan" | null;
}

async function findPaidReceiptForOrder(
  order: typeof ordersTable.$inferSelect,
): Promise<VerifyResult> {
  if (order.whopReceiptId) {
    try {
      const r = await whopGetReceipt(order.whopReceiptId);
      const status = (r?.status || "").toLowerCase();
      if (r && (status === "paid" || status === "succeeded")) {
        return { matched: r, path: "receipt_id" };
      }
    } catch (err) {
      console.warn(
        `[recover] getReceipt failed for ${order.id} receipt=${order.whopReceiptId}:`,
        (err as Error).message,
      );
    }
  }

  const createdMs = order.createdAt ? order.createdAt.getTime() : Date.now();
  const since = Math.max(
    Math.floor(createdMs / 1000) - 120,
    Math.floor(Date.now() / 1000) - 14 * 24 * 3600,
  );
  for (let page = 1; page <= 10; page += 1) {
    let resp;
    try {
      resp = await whopListReceipts({
        page,
        per: 100,
        startedAfter: since,
        status: "paid",
      });
    } catch (err) {
      console.warn(
        `[recover] listReceipts page ${page} failed for ${order.id}:`,
        (err as Error).message,
      );
      break;
    }
    const data = resp?.data || [];
    const found = data.find((r: any) => {
      const md = r?.metadata || {};
      return md && md.orderId === order.id;
    });
    if (found) return { matched: found as WhopReceipt, path: "metadata_scan" };
    const totalPages = resp?.pagination?.total_page || 1;
    if (page >= totalPages || data.length === 0) break;
  }

  return { matched: null, path: null };
}

function buildUpdates(
  order: typeof ordersTable.$inferSelect,
  matched: WhopReceipt,
): Record<string, unknown> {
  const planId = (matched as any).plan || (matched as any).plan_id || "";
  const userField = (matched as any).user;
  const whopUserId =
    typeof userField === "string"
      ? userField
      : userField && typeof userField === "object" && "id" in userField
      ? (userField as any).id
      : (matched as any).user_id || null;

  const totalRaw =
    typeof matched.total === "number"
      ? matched.total
      : typeof matched.subtotal === "number"
      ? matched.subtotal
      : null;
  const totalCents = totalRaw && totalRaw > 0 ? Math.round(totalRaw * 100) : null;

  const updates: Record<string, unknown> = {
    mainProductPaid: true,
    updatedAt: new Date(),
  };
  if (matched.id) updates.whopReceiptId = matched.id;
  if (whopUserId) updates.whopUserId = whopUserId;
  if (totalCents && (!order.totalAmount || order.totalAmount === 0)) {
    updates.totalAmount = totalCents;
  }

  const def = planId ? getWhopProductByPlanId(planId) : null;
  const isBundleLike = !def && planId && planId !== WHOP_PRODUCTS.main.planId;
  if (isBundleLike) {
    const slugSet = new Set(
      ((order.productSlugs || "") as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (slugSet.has("order-bump-1")) updates.bump1Paid = true;
    if (slugSet.has("order-bump-2")) updates.bump2Paid = true;
    if (slugSet.has("order-bump-3")) updates.bump3Paid = true;
    if (!order.whopBundlePlanId) updates.whopBundlePlanId = planId;
  }

  return updates;
}

async function main() {
  const sinceDate = new Date(Date.now() - SINCE_HOURS * 3600 * 1000);
  console.log(
    `[recover] selecting unpaid orders since ${sinceDate.toISOString()} (SINCE_HOURS=${SINCE_HOURS}, DRY_RUN=${DRY_RUN}, ONLY_OID=${ONLY_OID || "(all)"})`,
  );

  const rows = ONLY_OID
    ? await db.select().from(ordersTable).where(eq(ordersTable.id, ONLY_OID))
    : await db
        .select()
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.mainProductPaid, false),
            gt(ordersTable.createdAt, sinceDate),
          ),
        );

  console.log(`[recover] candidate orders: ${rows.length}`);

  let alreadyPaid = 0;
  let recovered = 0;
  let noReceipt = 0;
  let failed = 0;
  let emailsSent = 0;

  for (const order of rows) {
    if (order.mainProductPaid) {
      alreadyPaid += 1;
      continue;
    }
    try {
      const { matched, path } = await findPaidReceiptForOrder(order);
      if (!matched) {
        noReceipt += 1;
        console.log(`[no-receipt] ${order.id} email=${order.email}`);
        continue;
      }
      const updates = buildUpdates(order, matched);
      console.log(
        `[match] ${order.id} via=${path} receipt=${matched.id} plan=${(matched as any).plan || (matched as any).plan_id} updates=${JSON.stringify(updates)}`,
      );
      if (DRY_RUN) {
        recovered += 1;
        continue;
      }
      const [updated] = await db
        .update(ordersTable)
        .set(updates as any)
        .where(eq(ordersTable.id, order.id))
        .returning();
      recovered += 1;
      if (!SKIP_EMAIL && updated?.email) {
        try {
          const result = await enrollPurchaserAndSendEmail({
            email: updated.email,
            orderId: order.id,
          });
          if (result.status === "sent") emailsSent += 1;
          console.log(
            `[email] ${updated.email} orderId=${order.id} -> ${JSON.stringify(result)}`,
          );
        } catch (err) {
          console.warn(
            `[email-fail] ${updated.email} orderId=${order.id}:`,
            (err as Error).message,
          );
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${order.id}`, err);
    }
  }

  console.log(
    `[recover] done. candidates=${rows.length} already_paid=${alreadyPaid} recovered=${recovered} no_receipt=${noReceipt} failed=${failed} emails_sent=${emailsSent}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[recover] fatal", err);
    process.exit(1);
  });
