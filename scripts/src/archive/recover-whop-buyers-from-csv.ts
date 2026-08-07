/**
 * Recover Whop buyers from a CSV export of the Whop dashboard Payments page.
 *
 * Why this exists: the Whop /users/{id} REST endpoint requires admin-scope
 * permissions our API key doesn't have, and Cloudflare rate-limits the
 * API key path heavily. The dashboard CSV export is the only reliable way
 * to fan out portal access + welcome emails to buyers who came in during
 * the broken-webhook window.
 *
 * Accepts BOTH dashboard CSV exports:
 *   - Payments CSV       (one row per payment, has "Status" + "Product ID")
 *   - Members  CSV       (one row per active member, has "Product IDs"
 *                          plural, comma-separated; no Status column)
 * Members CSV is the recommended source -- every row is by definition a
 * confirmed active member, so refunds/failures are already filtered out.
 *
 * Usage:
 *   CSV_PATH=attached_assets/whop_members.csv DRY_RUN=1 \
 *     pnpm --filter @workspace/scripts run recover:whop-buyers-csv
 *
 *   # then to actually apply:
 *   CSV_PATH=attached_assets/whop_payments.csv DRY_RUN=0 \
 *     pnpm --filter @workspace/scripts run recover:whop-buyers-csv
 *
 * Env:
 *   CSV_PATH                                         (required)
 *   DATABASE_URL                                     (required)
 *   CLERK_SECRET_KEY, RESEND_API_KEY                 (required to send)
 *   ONLY_EMAIL=foo@bar.com                           (recover a single buyer)
 *   SKIP_EMAIL=1                                     (DB updates only)
 *   DRY_RUN=1                                        (default: no writes)
 *
 * CSV column detection (case-insensitive, picks the first that matches):
 *   email   : "email", "buyer email", "customer email", "user email"
 *   product : "product id", "product", "product_id"
 *             (also matches Whop's product NAME column if it contains the
 *              configured product slugs; otherwise rows are skipped)
 *   amount  : "amount", "total", "subtotal", "price"
 *   status  : "status"
 *   refund  : "refunded amount", "refunded_amount"
 *   first   : "first name", "billing first name"
 *   last    : "last name", "billing last name"
 *   userId  : "user id", "buyer id", "customer id"
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, ordersTable } from "@workspace/db";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";
import {
  WHOP_PRODUCTS,
  getWhopProductByProductId,
} from "@workspace/api-server/whopProducts";

const CSV_PATH = process.env.CSV_PATH || "";
const DRY_RUN = process.env.DRY_RUN !== "0";
const SKIP_EMAIL = process.env.SKIP_EMAIL === "1";
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();

if (!CSV_PATH) {
  console.error("Missing CSV_PATH (e.g. CSV_PATH=attached_assets/whop_payments.csv)");
  process.exit(1);
}
const resolved = path.resolve(CSV_PATH);
if (!fs.existsSync(resolved)) {
  console.error(`CSV not found at ${resolved}`);
  process.exit(1);
}

// ---------- minimal CSV parser (RFC 4180-ish, handles quoted fields + commas) ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (cell !== "" || row.length > 0) {
          row.push(cell);
          rows.push(row);
        }
        row = [];
        cell = "";
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function pickColumn(headers: string[], candidates: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = norm.indexOf(c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// productId -> field on `orders`. Mirrors recover-whop-buyers-by-email.ts.
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

// If the CSV doesn't include the product id, fall back to matching the
// product name column against known product slugs/titles.
function productNameToField(name: string): keyof typeof ordersTable.$inferSelect | null {
  const lower = name.toLowerCase();
  for (const def of Object.values(WHOP_PRODUCTS)) {
    const haystacks = [def.slug, def.label || "", def.productId].map((s) =>
      s.toLowerCase(),
    );
    if (haystacks.some((h) => h && lower.includes(h))) {
      const f = productIdToOrdersField(def.productId);
      if (f) return f;
    }
  }
  return null;
}

function recoveryOrderId(email: string): string {
  const hash = crypto.createHash("sha1").update(email).digest("hex").slice(0, 16);
  return `recovery-${hash}`;
}

interface BuyerBucket {
  email: string;
  whopUserId?: string;
  firstName?: string;
  lastName?: string;
  fields: Set<keyof typeof ordersTable.$inferSelect>;
  // High-ticket / unmapped product IDs we saw on this buyer (Portugal,
  // DFY, monthly subs etc). Surfaced at the end so the operator can
  // hand-claim via the coaching `verify-whop` endpoint or the DFY admin.
  highTicketProductIds: Set<string>;
  totalCents: number;
  rowCount: number;
}

// Slugs that are NOT funnel-bump-style "flag on orders" entitlements -
// these need the high-ticket / coaching_agreements flow and must be
// granted manually (or by a future automation that calls
// claimDfyAgreementFromWhop). Listing them out so we can split the
// recovery output cleanly.
const HIGH_TICKET_SLUGS = new Set<string>([
  "live_portugal_main",
  "live_portugal_vip",
  "coaching_5k",
  "dfy_15k",
  "dfy_ai_influencer",
]);

async function main() {
  const text = fs.readFileSync(resolved, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }
  const headers = rows[0];
  console.log(`[csv] columns: ${headers.join(" | ")}`);

  const idxEmail = pickColumn(headers, [
    "email",
    "buyer email",
    "customer email",
    "user email",
  ]);
  // Members CSV uses "Product IDs" (plural, comma-separated). Payments
  // CSV uses singular "Product ID". Try plural first.
  const idxProduct = pickColumn(headers, [
    "product ids",
    "product_ids",
    "product id",
    "product_id",
  ]);
  const idxProductName = pickColumn(headers, ["product", "product name", "plan"]);
  const idxAmount = pickColumn(headers, ["amount", "total", "subtotal", "price"]);
  // NOTE: do NOT include "state" here - the Members CSV has a geographic
  // "State" column (US state code) that would otherwise be misread as
  // payment status.
  const idxStatus = pickColumn(headers, ["status", "payment status"]);
  const idxRefund = pickColumn(headers, ["refunded amount", "refunded_amount", "refund amount"]);
  const idxFirst = pickColumn(headers, ["first name", "billing first name", "first_name"]);
  const idxLast = pickColumn(headers, ["last name", "billing last name", "last_name"]);
  const idxName = pickColumn(headers, ["name", "customer name", "buyer name"]);
  const idxUser = pickColumn(headers, ["user id", "buyer id", "customer id", "user_id"]);

  if (idxEmail === -1) {
    console.error(
      "CSV is missing an email column. Expected one of: email, buyer email, customer email, user email",
    );
    process.exit(1);
  }
  if (idxProduct === -1 && idxProductName === -1) {
    console.error(
      "CSV is missing a product column. Need either product id, product, plan, or product name.",
    );
    process.exit(1);
  }

  const byEmail = new Map<string, BuyerBucket>();
  let skippedNoEmail = 0;
  let skippedRefunded = 0;
  let skippedNotPaid = 0;
  let skippedUnmapped = 0;
  let skippedFiltered = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const email = (row[idxEmail] || "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      skippedNoEmail++;
      continue;
    }
    if (ONLY_EMAIL && email !== ONLY_EMAIL) {
      skippedFiltered++;
      continue;
    }

    if (idxStatus !== -1) {
      const status = (row[idxStatus] || "").trim().toLowerCase();
      if (status && !/paid|succeeded|complete|success/.test(status)) {
        skippedNotPaid++;
        continue;
      }
    }
    if (idxRefund !== -1) {
      const refunded = parseFloat(row[idxRefund] || "0");
      if (refunded > 0) {
        skippedRefunded++;
        continue;
      }
    }

    // Collect every product id on this row. Members CSV puts them in a
    // single "Product IDs" cell as a comma-separated list.
    const fieldsForRow: Array<keyof typeof ordersTable.$inferSelect> = [];
    const highTicketForRow: string[] = [];
    if (idxProduct !== -1) {
      const cell = (row[idxProduct] || "").trim();
      const pids = cell
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("prod_"));
      for (const pid of pids) {
        const def = getWhopProductByProductId(pid);
        const f = productIdToOrdersField(pid);
        if (f) {
          fieldsForRow.push(f);
        } else if (def && HIGH_TICKET_SLUGS.has(def.slug)) {
          highTicketForRow.push(`${pid} (${def.slug})`);
        } else {
          highTicketForRow.push(pid);
        }
      }
    }
    if (fieldsForRow.length === 0 && highTicketForRow.length === 0 && idxProductName !== -1) {
      const pname = (row[idxProductName] || "").trim();
      if (pname) {
        const f = productNameToField(pname);
        if (f) fieldsForRow.push(f);
      }
    }
    if (fieldsForRow.length === 0 && highTicketForRow.length === 0) {
      skippedUnmapped++;
      continue;
    }

    const amountStr = idxAmount !== -1 ? (row[idxAmount] || "0").replace(/[$,]/g, "") : "0";
    const amountDollars = parseFloat(amountStr) || 0;

    // Members CSV often has only a single "Name" column instead of
    // first/last. Split it so the welcome email greets them properly.
    let firstName: string | undefined;
    let lastName: string | undefined;
    if (idxFirst !== -1) firstName = (row[idxFirst] || "").trim() || undefined;
    if (idxLast !== -1) lastName = (row[idxLast] || "").trim() || undefined;
    if (!firstName && !lastName && idxName !== -1) {
      const full = (row[idxName] || "").trim();
      if (full) {
        const parts = full.split(/\s+/);
        firstName = parts[0];
        if (parts.length > 1) lastName = parts.slice(1).join(" ");
      }
    }

    let bucket = byEmail.get(email);
    if (!bucket) {
      bucket = {
        email,
        whopUserId: idxUser !== -1 ? (row[idxUser] || "").trim() || undefined : undefined,
        firstName,
        lastName,
        fields: new Set(),
        highTicketProductIds: new Set(),
        totalCents: 0,
        rowCount: 0,
      };
      byEmail.set(email, bucket);
    }
    for (const f of fieldsForRow) bucket.fields.add(f);
    for (const p of highTicketForRow) bucket.highTicketProductIds.add(p);
    bucket.totalCents += Math.round(amountDollars * 100);
    bucket.rowCount += 1;
  }

  console.log(
    `[recover] bucketed ${byEmail.size} unique buyer(s). skipped: refunded=${skippedRefunded} not-paid=${skippedNotPaid} no-email=${skippedNoEmail} unmapped-product=${skippedUnmapped} filtered=${skippedFiltered}`,
  );

  // Always print the per-buyer breakdown -- it's small and the user wants
  // to see what the recovery will do.
  let withMain = 0;
  let withFunnelOnly = 0;
  let withHighTicketOnly = 0;
  let withBoth = 0;
  for (const b of byEmail.values()) {
    if (b.fields.has("mainProductPaid")) withMain++;
    const hasFunnel = b.fields.size > 0;
    const hasHigh = b.highTicketProductIds.size > 0;
    if (hasFunnel && hasHigh) withBoth++;
    else if (hasFunnel) withFunnelOnly++;
    else if (hasHigh) withHighTicketOnly++;
  }
  console.log(`[recover] ${withMain} buyer(s) qualify for the welcome email (mainProductPaid set)`);
  console.log(
    `[recover] split: funnel-only=${withFunnelOnly} high-ticket-only=${withHighTicketOnly} both=${withBoth}`,
  );
  for (const b of byEmail.values()) {
    const ht = b.highTicketProductIds.size > 0 ? `  HIGH-TICKET=[${[...b.highTicketProductIds].join(",")}]` : "";
    console.log(
      `  ${b.email}  fields=[${[...b.fields].join(",") || "-"}]  rows=${b.rowCount}  $${(b.totalCents / 100).toFixed(2)}${ht}`,
    );
  }
  if (withHighTicketOnly + withBoth > 0) {
    console.log(
      `\n[recover] NOTE: ${withHighTicketOnly + withBoth} buyer(s) have high-ticket products (Portugal / DFY / coaching). This script does NOT enroll them - they need claimDfyAgreementFromWhop / the coaching verify-whop endpoint. They are listed above with HIGH-TICKET=[...] for manual handling.`,
    );
  }

  if (DRY_RUN) {
    console.log(`[recover] DRY_RUN=1 (default) -- nothing written. Set DRY_RUN=0 to apply.`);
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
        firstName: b.firstName,
        lastName: b.lastName,
        whopUserId: b.whopUserId,
        totalAmount: b.totalCents,
        updatedAt: new Date(),
      };
      for (const f of b.fields) updates[f as string] = true;

      await db
        .insert(ordersTable)
        .values({ id: recoveryId, ...(updates as Record<string, unknown>) } as never)
        .onConflictDoUpdate({
          target: ordersTable.id,
          set: updates as Record<string, unknown>,
        });
      okOrders++;
      console.log(`[order] ${b.email} -> ${recoveryId} fields=${[...b.fields].join(",")}`);

      if (!SKIP_EMAIL && b.fields.has("mainProductPaid")) {
        const result = await enrollPurchaserAndSendEmail({
          email: b.email,
          orderId: recoveryId,
        });
        okEmails++;
        console.log(`[email] ${b.email} -> ${JSON.stringify(result)}`);
      }
    } catch (err) {
      failed++;
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
