// Task #564: backfill stranded paying customers whose
// portal_users.whop_affiliate_username is NULL.
//
// Why this exists:
//   Until Task #564, the /portal/affiliate/me endpoint resolved the
//   buyer's Whop username live on every request. Buyers whose orders
//   row was missing whopUserId (Whop iframe shipped payment.succeeded
//   without data.user_id) silently dropped to enrolled:false and never
//   saw the My Links sidebar entry. Vincentframularo@gmail.com (Vin)
//   was the canonical reproducer.
//
// What this does:
//   For every paying portal_users row with whop_affiliate_username
//   NULL/empty, look up Whop memberships by email, take the first
//   user_id that comes back, resolve the username, and write it back
//   onto portal_users. If we also find an orders row that was missing
//   whopUserId we patch that too so the next webhook flip / scheduler
//   pass has a stable id to anchor on.
//
// Usage (run from the workspace root with PROD_DATABASE_URL exported):
//   pnpm --filter @workspace/scripts run backfill:task-564                 # dry-run, every paying user
//   pnpm --filter @workspace/scripts run backfill:task-564 -- --apply      # actually write
//   pnpm --filter @workspace/scripts run backfill:task-564 -- --email=foo@bar.com --apply
//
// Per replit.md: the agent prepares this script. The user runs it
// against PROD_DATABASE_URL. The agent does not run it from the
// sandbox (executeSql({environment:"production"}) is read-only).

import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  portalUsersTable,
  ordersTable,
} from "@workspace/db";
import {
  listValidMembershipsByEmail,
} from "../../../artifacts/api-server/src/lib/free-promo-reconcile";
import { getUser } from "../../../artifacts/api-server/src/whopClient";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const emailFlag = args.find((a) => a.startsWith("--email="));
const ONLY_EMAIL = emailFlag ? emailFlag.slice("--email=".length).trim().toLowerCase() : null;

interface Row {
  id: number;
  email: string;
  whopAffiliateUsername: string | null;
}

interface CandidateRowDb extends Record<string, unknown> {
  id: number;
  email: string;
  whop_affiliate_username: string | null;
}

async function findCandidates(): Promise<Row[]> {
  // Paying = has at least one orders row with mainProductPaid=true OR
  // is_a_list=true on portal_users OR a paid coaching agreement. Keep
  // the query simple and resilient to schema drift; we filter further
  // once we have the email.
  const rows = await db.execute<CandidateRowDb>(sql`
    SELECT pu.id, pu.email, pu.whop_affiliate_username
      FROM portal_users pu
     WHERE (pu.whop_affiliate_username IS NULL OR pu.whop_affiliate_username = '')
       AND (
         pu.is_a_list = true
         OR EXISTS (
           SELECT 1 FROM orders o
            WHERE lower(o.email) = lower(pu.email)
              AND o.main_product_paid = true
         )
         OR EXISTS (
           -- Paid coaching agreements (DFY, Portugal Gold/VIP, AI Influencer, etc.)
           -- mirror the /portal/affiliate/me eligibility gate so coaching-only
           -- buyers also get their links resolved.
           SELECT 1 FROM coaching_agreements ca
            WHERE lower(ca.email) = lower(pu.email)
              AND (ca.status = 'active' OR ca.paid_at IS NOT NULL)
              AND (ca.whop_session_id IS NOT NULL OR ca.whop_membership_id IS NOT NULL)
         )
       )
       ${ONLY_EMAIL ? sql`AND lower(pu.email) = ${ONLY_EMAIL}` : sql``}
     ORDER BY pu.id
  `);
  return rows.rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email ?? ""),
    whopAffiliateUsername: r.whop_affiliate_username,
  }));
}

async function main() {
  console.log(`[backfill-task-564] mode=${APPLY ? "APPLY" : "DRY-RUN"}${ONLY_EMAIL ? ` email=${ONLY_EMAIL}` : ""}`);
  const candidates = await findCandidates();
  console.log(`[backfill-task-564] found ${candidates.length} stranded paying user(s)`);

  let resolved = 0;
  let skipped = 0;
  let failed = 0;
  let ordersPatched = 0;

  for (const row of candidates) {
    const email = row.email.trim().toLowerCase();
    if (!email) {
      skipped += 1;
      continue;
    }

    let whopUserId: string | null = null;
    let username: string | null = null;

    try {
      const memberships = await listValidMembershipsByEmail(email);
      whopUserId = memberships[0]?.user_id || null;
    } catch (e) {
      console.warn(`[backfill-task-564] memberships lookup failed for ${email}: ${(e as Error).message}`);
    }

    if (!whopUserId) {
      console.log(`[backfill-task-564] SKIP ${email} (no whop membership found)`);
      skipped += 1;
      continue;
    }

    try {
      const u = await getUser(whopUserId);
      username = (u?.username || "").trim().toLowerCase() || null;
    } catch (e) {
      console.warn(`[backfill-task-564] getUser failed for ${email} / ${whopUserId}: ${(e as Error).message}`);
    }

    if (!username) {
      console.log(`[backfill-task-564] SKIP ${email} (whop user ${whopUserId} has no username yet)`);
      failed += 1;
      continue;
    }

    console.log(`[backfill-task-564] ${APPLY ? "APPLY" : "DRY"}  ${email} -> ${username} (whopUserId=${whopUserId})`);

    if (APPLY) {
      try {
        const r = await db
          .update(portalUsersTable)
          .set({ whopAffiliateUsername: username, updatedAt: new Date() })
          .where(
            and(
              eq(portalUsersTable.id, row.id),
              or(
                isNull(portalUsersTable.whopAffiliateUsername),
                eq(portalUsersTable.whopAffiliateUsername, ""),
              ),
            ),
          )
          .returning({ id: portalUsersTable.id });
        if (r.length > 0) resolved += 1;

        // Also patch any orders rows missing whopUserId. The next
        // webhook flip / scheduler pass benefits from having a stable
        // id to anchor on.
        const patched = await db
          .update(ordersTable)
          .set({ whopUserId, updatedAt: new Date() })
          .where(
            and(
              sql`lower(${ordersTable.email}) = ${email}`,
              isNull(ordersTable.whopUserId),
            ),
          )
          .returning({ id: ordersTable.id });
        ordersPatched += patched.length;
      } catch (e) {
        console.error(`[backfill-task-564] write failed for ${email}: ${(e as Error).message}`);
        failed += 1;
      }
    } else {
      resolved += 1;
    }
  }

  console.log(
    `[backfill-task-564] done. resolved=${resolved} skipped=${skipped} failed=${failed} ordersPatched=${ordersPatched} mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );
  if (!APPLY) {
    console.log(`[backfill-task-564] re-run with --apply to actually write changes.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-task-564] fatal", err);
  process.exit(1);
});
