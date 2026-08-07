/**
 * Task #483 backfill: recover buyers who Whop reports as active members
 * of the main product but for whom we have NO row in the `orders` table.
 *
 * These are the buyers who hit `no_paid_order` on /thankyou setup-account
 * because the /portal/setup-account lookups by `oid` and `whopReceiptId`
 * both miss when the orders row never existed (e.g. MAY2026 $0 promo
 * where the funnel POST never reached us but Whop's checkout webhook
 * still granted the membership).
 *
 * For each Whop-only main-product membership in the lookback window,
 * mints a synthetic orders row with id `whop-sync-{membershipId}` and
 * triggers `enrollPurchaserAndSendEmail({ portalKey: "room30" })` so the
 * buyer gets the canonical "set your password" email. Idempotent on
 * email+orderId via email_logs, so safe to re-run.
 *
 * Usage:
 *   DRY_RUN=1 pnpm --filter @workspace/scripts run recover:whop-only
 *   pnpm --filter @workspace/scripts run recover:whop-only
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID    (required)
 *   DATABASE_URL                       (required)
 *   CLERK_SECRET_KEY                   (required for enrollment)
 *   RESEND_API_KEY                     (required to send emails)
 *   PUBLIC_APP_URL=https://room30.ai   (required so emails route correctly)
 *   LOOKBACK_DAYS                      (default: 14)
 *   MAX_PAGES                          (default: 5)
 *   ONLY_EMAIL=foo@bar.com             (recover a single buyer)
 *   DRY_RUN=1                          (no writes, no emails)
 *   SKIP_EMAIL=1                       (DB writes only)
 */

import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { listWhopOnlyMainEnrollments } from "@workspace/api-server/lib/free-promo-reconcile";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || "14");
const MAX_PAGES = Number(process.env.MAX_PAGES || "5");
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_EMAIL = process.env.SKIP_EMAIL === "1";
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();

if (!process.env.WHOP_API_KEY || !process.env.WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  console.log(
    `[recover-whop-only] lookbackDays=${LOOKBACK_DAYS} maxPages=${MAX_PAGES} dryRun=${DRY_RUN} skipEmail=${SKIP_EMAIL} onlyEmail=${ONLY_EMAIL || "(none)"}`,
  );

  const enrollments = await listWhopOnlyMainEnrollments({
    lookbackDays: LOOKBACK_DAYS,
    maxPages: MAX_PAGES,
    perPage: 50,
  });
  console.log(
    `[recover-whop-only] considered=${enrollments.consideredMemberships} whopOnly=${enrollments.whopOnly.length} lookupErrors=${enrollments.lookupErrors}`,
  );

  const targets = ONLY_EMAIL
    ? enrollments.whopOnly.filter((w: { email: string }) => w.email === ONLY_EMAIL)
    : enrollments.whopOnly;
  if (ONLY_EMAIL && targets.length === 0) {
    console.log(`[recover-whop-only] ONLY_EMAIL=${ONLY_EMAIL} did not match any whop-only enrollment in the recent window.`);
    return;
  }

  let inserted = 0;
  let alreadyHad = 0;
  let enrolled = 0;
  let errors = 0;

  for (const w of targets) {
    const oid = `whop-sync-${w.membershipId}`;
    try {
      const existing = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(eq(ordersTable.id, oid))
        .limit(1);
      if (existing.length > 0) {
        alreadyHad++;
        console.log(`[recover-whop-only] skip ${w.email} - synthetic row ${oid} already exists`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`[recover-whop-only] DRY would insert ${oid} for ${w.email}`);
        continue;
      }

      await db.insert(ordersTable).values({
        id: oid,
        email: w.email,
        currentStep: "whop-sync",
        productSlugs: "main",
        mainProductPaid: true,
        whopMembershipId: w.membershipId,
        whopUserId: w.whopUserId ?? undefined,
        totalAmount: 0,
      });
      inserted++;
      console.log(`[recover-whop-only] inserted ${oid} for ${w.email}`);

      if (SKIP_EMAIL) continue;
      try {
        await enrollPurchaserAndSendEmail({
          orderId: oid,
          email: w.email,
          portalKey: "room30",
        });
        enrolled++;
        console.log(`[recover-whop-only] enrolled+emailed ${w.email}`);
      } catch (e) {
        errors++;
        console.error(`[recover-whop-only] enroll/email failed for ${w.email}:`, e);
      }
    } catch (e) {
      errors++;
      console.error(`[recover-whop-only] insert failed for ${w.email}:`, e);
    }
  }

  console.log(
    `[recover-whop-only] done. inserted=${inserted} alreadyHad=${alreadyHad} enrolled=${enrolled} errors=${errors}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[recover-whop-only] fatal:", e);
    process.exit(1);
  });
