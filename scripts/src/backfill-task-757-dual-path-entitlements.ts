// Task #757: backfill the sidebar entitlement columns so they match the
// funnel-equivalent columns for historical buyers who purchased DFY Pack,
// Platinum Club, or Our Portfolio through the funnel (which flips
// upsell1Paid / downsell1Paid, upsell3Paid, upsell2Paid) but never had the
// sidebar columns (done_for_you_pack_paid, platinum_paid, portfolio_paid)
// set.
//
// After the read-time OR-merge in computePurchaseEntitlements() (portal.ts),
// access is already unlocked for these buyers, so these backfills are
// cosmetic / consistency only - they keep the stored columns aligned with
// what the funnel granted.
//
// Per the active prod gotcha on data backfills (replit.md), data UPDATE
// blocks are silently skipped by the Publish migration flow, so this ships
// as a standalone scripts/src helper the operator runs once against
// PROD_DATABASE_URL after publish.
//
// Usage (against prod):
//   DATABASE_URL=$PROD_DATABASE_URL \
//     pnpm --filter @workspace/scripts run backfill:task-757-dual-path
//
// Idempotent: each UPDATE only touches rows where the target column is not
// already true, so re-runs are no-ops.

import { db, ordersTable } from "@workspace/db";
import { and, eq, ne, or } from "drizzle-orm";

async function main() {
  // done_for_you_pack_paid := true where (upsell1_paid OR downsell1_paid)
  const dfy = await db
    .update(ordersTable)
    .set({ doneForYouPackPaid: true })
    .where(
      and(
        or(
          eq(ordersTable.upsell1Paid, true),
          eq(ordersTable.downsell1Paid, true),
        ),
        ne(ordersTable.doneForYouPackPaid, true),
      ),
    )
    .returning({ id: ordersTable.id });
  console.log(`[backfill] done_for_you_pack_paid: ${dfy.length} rows updated`);

  // platinum_paid := true where upsell3_paid
  const platinum = await db
    .update(ordersTable)
    .set({ platinumPaid: true })
    .where(
      and(eq(ordersTable.upsell3Paid, true), ne(ordersTable.platinumPaid, true)),
    )
    .returning({ id: ordersTable.id });
  console.log(`[backfill] platinum_paid: ${platinum.length} rows updated`);

  // portfolio_paid := true where upsell2_paid
  const portfolio = await db
    .update(ordersTable)
    .set({ portfolioPaid: true })
    .where(
      and(eq(ordersTable.upsell2Paid, true), ne(ordersTable.portfolioPaid, true)),
    )
    .returning({ id: ordersTable.id });
  console.log(`[backfill] portfolio_paid: ${portfolio.length} rows updated`);

  console.log(
    `[backfill] done. total rows updated: ${dfy.length + platinum.length + portfolio.length}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed", err);
    process.exit(1);
  });
