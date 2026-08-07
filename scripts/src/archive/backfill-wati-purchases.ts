/**
 * Task #603 - one-shot backfill of the WATI revenue ledger.
 *
 * Walks every paid revenue source - low-ticket orders (main, bumps,
 * upsells, downsells, platinum, dfy pack, portfolio), high-ticket
 * coaching/DFY/Portugal agreements, portal credit packs - and records
 * each as a row in `wati_purchases`. Once all rows are in the ledger
 * it enqueues one `purchase_sync` op per phone so the drain loop
 * pushes lifetime_revenue / last_purchase_* / purchase_count to WATI.
 *
 * Idempotent: each (orderId, slug) is INSERT ... ON CONFLICT DO
 * NOTHING, so a re-run will only enqueue contacts whose ledger
 * actually grew. Filters to "real revenue" via paymentSourceType -
 * admin grants / free promos / migration backfills are excluded so
 * the WATI lifetime_revenue figure matches actual paid receipts.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run wati:backfill-purchases
 *   pnpm --filter @workspace/scripts run wati:backfill-purchases -- --apply
 */

import { sql, and, eq, isNotNull, ne, inArray } from "drizzle-orm";
import {
  db,
  ordersTable,
  coachingAgreementsTable,
  researchCreditPurchasesTable,
  osToolCreditPurchasesTable,
  portalUsersTable,
  watiPurchasesTable,
  watiSyncOutboxTable,
} from "@workspace/db";
import { normalizePhoneE164 } from "../../../artifacts/api-server/src/lib/wati-client";
import { purchaseDescriptorForSlug } from "../../../artifacts/api-server/src/lib/wati-sync";
import { isRealRevenueSource } from "../../../artifacts/api-server/src/lib/payment-provenance";

interface Summary {
  dryRun: boolean;
  ordersScanned: number;
  orderLinesRecorded: number;
  ordersSkippedNoPhone: number;
  ordersSkippedNotRealRevenue: number;
  coachingScanned: number;
  coachingRecorded: number;
  coachingSkippedNoPhone: number;
  researchCreditsScanned: number;
  researchCreditsRecorded: number;
  osToolPacksScanned: number;
  osToolPacksRecorded: number;
  alreadyRecorded: number;
  uniquePhones: number;
  purchaseSyncEnqueued: number;
}

const PAID_LINE_FIELDS: Array<{
  flag: keyof typeof ordersTable.$inferSelect;
  slug: string;
}> = [
  { flag: "mainProductPaid", slug: "mainProductPaid" },
  { flag: "bump2Paid", slug: "bump2Paid" },
  { flag: "bump3Paid", slug: "bump3Paid" },
  { flag: "upsell1Paid", slug: "upsell1Paid" },
  { flag: "upsell2Paid", slug: "upsell2Paid" },
  { flag: "upsell3Paid", slug: "upsell3Paid" },
  { flag: "downsell1Paid", slug: "downsell1Paid" },
  { flag: "platinumPaid", slug: "platinumPaid" },
  { flag: "doneForYouPackPaid", slug: "doneForYouPackPaid" },
  { flag: "portfolioPaid", slug: "portfolioPaid" },
];

async function tryInsertPurchase(args: {
  orderId: string;
  slug: string;
  phone: string;
  email: string | null;
  amountCents: number;
  occurredAt: Date | null;
}): Promise<boolean> {
  const desc = purchaseDescriptorForSlug(args.slug);
  const inserted = await db
    .insert(watiPurchasesTable)
    .values({
      orderId: args.orderId,
      slug: args.slug,
      contactPhone: args.phone,
      contactEmail: args.email,
      amountCents: Math.max(0, Math.floor(args.amountCents || 0)),
      productName: desc.productName,
      occurredAt: args.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [watiPurchasesTable.orderId, watiPurchasesTable.slug],
    })
    .returning({ orderId: watiPurchasesTable.orderId });
  return inserted.length > 0;
}

async function enqueuePurchaseSync(phone: string, email: string | null): Promise<void> {
  await db.insert(watiSyncOutboxTable).values({
    contactPhone: phone,
    contactEmail: email,
    op: "purchase_sync",
    tag: null,
    payload: { source: "backfill:t603", extraTags: ["purchased"] },
    status: "pending",
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary: Summary = {
    dryRun: !apply,
    ordersScanned: 0,
    orderLinesRecorded: 0,
    ordersSkippedNoPhone: 0,
    ordersSkippedNotRealRevenue: 0,
    coachingScanned: 0,
    coachingRecorded: 0,
    coachingSkippedNoPhone: 0,
    researchCreditsScanned: 0,
    researchCreditsRecorded: 0,
    osToolPacksScanned: 0,
    osToolPacksRecorded: 0,
    alreadyRecorded: 0,
    uniquePhones: 0,
    purchaseSyncEnqueued: 0,
  };

  const phones = new Map<string, string | null>();

  function notePhone(p: string, email: string | null) {
    if (!phones.has(p)) phones.set(p, email);
  }

  // ---- 1. Funnel orders. Per-line: walk the 10 paid_* booleans. ----
  const orders = await db
    .select()
    .from(ordersTable)
    .where(and(isNotNull(ordersTable.email), ne(ordersTable.email, "")));
  for (const o of orders) {
    summary.ordersScanned++;
    const phone = o.phone ? normalizePhoneE164(o.phone) : null;
    if (!phone) {
      summary.ordersSkippedNoPhone++;
      continue;
    }
    const source = (o.paymentSourceType || null) as Parameters<typeof isRealRevenueSource>[0] | null;
    if (source && !isRealRevenueSource(source)) {
      summary.ordersSkippedNotRealRevenue++;
      continue;
    }
    let recordedAny = false;
    for (const { flag, slug } of PAID_LINE_FIELDS) {
      if (o[flag] !== true) continue;
      // Use totalAmount as a fallback: per-line cents are not stored,
      // so we attribute the order's total to the MAIN line and 0 to
      // the rest. This matches what the live wiring does (it only
      // knows the cents that flowed through THIS Stripe charge - for
      // historical orders we have no per-line breakdown).
      const isMain = flag === "mainProductPaid";
      const cents = isMain ? (o.totalAmount || 0) : 0;
      if (apply) {
        const ok = await tryInsertPurchase({
          orderId: o.id,
          slug,
          phone,
          email: o.email,
          amountCents: cents,
          occurredAt: o.updatedAt ?? o.createdAt ?? null,
        });
        if (ok) {
          summary.orderLinesRecorded++;
          recordedAny = true;
        } else {
          summary.alreadyRecorded++;
        }
      } else {
        summary.orderLinesRecorded++;
        recordedAny = true;
      }
    }
    if (recordedAny) notePhone(phone, o.email);
  }

  // ---- 2. High-ticket coaching agreements. ----
  const agreements = await db
    .select()
    .from(coachingAgreementsTable)
    .where(eq(coachingAgreementsTable.status, "active"));
  for (const a of agreements) {
    summary.coachingScanned++;
    const phone = a.phone ? normalizePhoneE164(a.phone) : null;
    if (!phone) {
      summary.coachingSkippedNoPhone++;
      continue;
    }
    if (!a.whopSessionId && !a.whopMembershipId) {
      // No receipt id = not real revenue per Task #505 rules.
      continue;
    }
    const slug = `coaching:${a.agreementType}`;
    if (apply) {
      const ok = await tryInsertPurchase({
        orderId: `coaching:${a.id}`,
        slug,
        phone,
        email: a.email,
        amountCents: a.packagePriceCents || 0,
        occurredAt: a.paidAt ?? a.createdAt ?? null,
      });
      if (ok) {
        summary.coachingRecorded++;
        notePhone(phone, a.email);
      } else {
        summary.alreadyRecorded++;
      }
    } else {
      summary.coachingRecorded++;
      notePhone(phone, a.email);
    }
  }

  // ---- 3. Portal credit packs - resolve phone via the buyer's most
  //         recent order (portal_users has no phone column). ----
  async function phoneForEmail(email: string | null): Promise<string | null> {
    if (!email) return null;
    const rows = await db
      .select({ phone: ordersTable.phone })
      .from(ordersTable)
      .where(
        and(
          sql`lower(${ordersTable.email}) = ${email.toLowerCase()}`,
          isNotNull(ordersTable.phone),
          ne(ordersTable.phone, ""),
        ),
      )
      .orderBy(sql`${ordersTable.createdAt} DESC`)
      .limit(1);
    return rows[0]?.phone ? normalizePhoneE164(rows[0].phone) : null;
  }

  // Research credits.
  const researchRows = await db
    .select({
      id: researchCreditPurchasesTable.id,
      whopSessionId: researchCreditPurchasesTable.whopSessionId,
      amountCents: researchCreditPurchasesTable.amountCents,
      grantedAt: researchCreditPurchasesTable.grantedAt,
      createdAt: researchCreditPurchasesTable.createdAt,
      userId: researchCreditPurchasesTable.userId,
      email: portalUsersTable.email,
    })
    .from(researchCreditPurchasesTable)
    .innerJoin(portalUsersTable, eq(researchCreditPurchasesTable.userId, portalUsersTable.id))
    .where(eq(researchCreditPurchasesTable.status, "granted"));
  for (const r of researchRows) {
    summary.researchCreditsScanned++;
    const phone = await phoneForEmail(r.email);
    if (!phone) continue;
    if (apply) {
      const ok = await tryInsertPurchase({
        orderId: `credit:${r.whopSessionId ?? `research-${r.id}`}`,
        slug: "research_regeneration_credit",
        phone,
        email: r.email,
        amountCents: r.amountCents || 0,
        occurredAt: r.grantedAt ?? r.createdAt ?? null,
      });
      if (ok) {
        summary.researchCreditsRecorded++;
        notePhone(phone, r.email);
      } else {
        summary.alreadyRecorded++;
      }
    } else {
      summary.researchCreditsRecorded++;
      notePhone(phone, r.email);
    }
  }

  // OS tool credit packs.
  const osPackRows = await db
    .select({
      id: osToolCreditPurchasesTable.id,
      whopSessionId: osToolCreditPurchasesTable.whopSessionId,
      amountCents: osToolCreditPurchasesTable.amountCents,
      grantedAt: osToolCreditPurchasesTable.grantedAt,
      createdAt: osToolCreditPurchasesTable.createdAt,
      userId: osToolCreditPurchasesTable.userId,
      email: portalUsersTable.email,
    })
    .from(osToolCreditPurchasesTable)
    .innerJoin(portalUsersTable, eq(osToolCreditPurchasesTable.userId, portalUsersTable.id))
    .where(eq(osToolCreditPurchasesTable.status, "granted"));
  for (const r of osPackRows) {
    summary.osToolPacksScanned++;
    const phone = await phoneForEmail(r.email);
    if (!phone) continue;
    if (apply) {
      const ok = await tryInsertPurchase({
        orderId: `credit:${r.whopSessionId ?? `os-${r.id}`}`,
        slug: "os_tool_credit_pack",
        phone,
        email: r.email,
        amountCents: r.amountCents || 0,
        occurredAt: r.grantedAt ?? r.createdAt ?? null,
      });
      if (ok) {
        summary.osToolPacksRecorded++;
        notePhone(phone, r.email);
      } else {
        summary.alreadyRecorded++;
      }
    } else {
      summary.osToolPacksRecorded++;
      notePhone(phone, r.email);
    }
  }

  summary.uniquePhones = phones.size;

  // ---- 4. Enqueue ONE purchase_sync per phone (drain handler reads
  //         the ledger and pushes the consolidated aggregates). Skip
  //         phones that already have a pending purchase_sync row.
  if (apply && phones.size > 0) {
    const phoneList = Array.from(phones.keys());
    const existing = new Set<string>();
    for (let i = 0; i < phoneList.length; i += 200) {
      const slice = phoneList.slice(i, i + 200);
      const rows = await db
        .select({ contactPhone: watiSyncOutboxTable.contactPhone })
        .from(watiSyncOutboxTable)
        .where(
          and(
            eq(watiSyncOutboxTable.op, "purchase_sync"),
            eq(watiSyncOutboxTable.status, "pending"),
            inArray(watiSyncOutboxTable.contactPhone, slice),
          ),
        );
      for (const r of rows) existing.add(r.contactPhone);
    }
    for (const [phone, email] of phones.entries()) {
      if (existing.has(phone)) continue;
      await enqueuePurchaseSync(phone, email);
      summary.purchaseSyncEnqueued++;
    }
  } else {
    summary.purchaseSyncEnqueued = phones.size;
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log(
      "\nDry-run only. Re-run with --apply to write wati_purchases rows and enqueue purchase_sync ops.",
    );
  } else {
    console.log(
      "\nDone. The WATI worker drain loop (every 15s) will push aggregates to WATI.",
    );
  }
}

main().catch((err) => {
  console.error("[backfill-wati-purchases] failed:", err);
  process.exit(1);
});
