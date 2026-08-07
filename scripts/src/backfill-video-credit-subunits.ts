// Task #837: backfill the fractional-credit sub-unit columns for the video
// credit ledger. The ADD COLUMN itself ships in migration 0097 (publish-safe);
// this UPDATE block runs once against PROD_DATABASE_URL after publish, per the
// active prod gotcha on data backfills (replit.md - Publish silently skips
// UPDATE blocks).
//
// 1 credit = 100 sub-units. For every row whose *_subunits column is still
// NULL, set it to the legacy integer value * 100. The app already treats NULL
// sub-units as legacy*100, so this is a normalization, not a correctness fix -
// but running it keeps the authoritative columns populated.
//
// Usage (against prod):
//   DATABASE_URL=$PROD_DATABASE_URL \
//     pnpm --filter @workspace/scripts run backfill:video-credit-subunits
//
// Idempotent: only touches rows where the sub-unit column is NULL.

import { db, videoCreditsTable, videoCreditTransactionsTable } from "@workspace/db";
import { isNull, sql } from "drizzle-orm";

async function main() {
  const wallets = await db
    .update(videoCreditsTable)
    .set({ balanceSubunits: sql`${videoCreditsTable.balance} * 100` })
    .where(isNull(videoCreditsTable.balanceSubunits))
    .returning({ id: videoCreditsTable.id });
  console.log(`[backfill] video_credits.balance_subunits set on ${wallets.length} wallets`);

  const txns = await db
    .update(videoCreditTransactionsTable)
    .set({
      amountSubunits: sql`${videoCreditTransactionsTable.amount} * 100`,
      balanceAfterSubunits: sql`${videoCreditTransactionsTable.balanceAfter} * 100`,
    })
    .where(isNull(videoCreditTransactionsTable.amountSubunits))
    .returning({ id: videoCreditTransactionsTable.id });
  console.log(
    `[backfill] video_credit_transactions sub-units set on ${txns.length} rows`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed", err);
    process.exit(1);
  });
