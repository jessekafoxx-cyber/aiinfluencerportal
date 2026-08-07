/**
 * Task #501 - Backfill stuck `portal_key='main'` rows in portal_users.
 *
 * Background: 46 production portal_users rows landed with portal_key='main'
 * because `ensurePortalUserByEmail()` in the external-api router used to
 * insert without an explicit portalKey, and the historical column default
 * was 'main'. After Task #491 the Apex/course-portal frontend (the only
 * legitimate 'main' consumer) was removed; every remaining 'main' row is
 * a stuck Room30 buyer who now hits HTTP 403 in `requireAuth` whenever
 * they call `/api/portal/*` in the Room30 portal.
 *
 * This script:
 *   1. SELECTs every portal_users row with portal_key='main'.
 *   2. Skips rows whose email is listed in ADMIN_EMAILS (defensive -
 *      admins are explicitly allowed to be cross-portal in requireAuth,
 *      so we never mutate their portalKey).
 *   3. UPDATEs the remaining rows to portal_key='room30', logging the
 *      before/after counts.
 *   4. Defaults to dry-run. Pass `--apply` (or `APPLY=1`) to write.
 *
 * The same UPDATE ships in migration `0048_t501_room30_portal_key_backfill.sql`
 * and will be applied automatically by the migration runner. This script
 * exists for two reasons:
 *   - To run the backfill ad-hoc against the production DB when the
 *     migration runner has not been triggered yet.
 *   - To preserve the ADMIN_EMAILS skip - the SQL migration unconditionally
 *     converts every 'main' row, but in any environment where an admin row
 *     might still be parked on 'main' for cross-portal work this script
 *     gives the operator a safer, auditable path.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run fix:room30-main-portal-key
 *     # dry-run: prints affected rows, does nothing
 *   pnpm --filter @workspace/scripts run fix:room30-main-portal-key -- --apply
 *     # writes: flips 'main' -> 'room30'
 *
 * Env:
 *   DATABASE_URL (required)
 *   ADMIN_EMAILS (optional, comma-separated; falls back to ADMIN_EMAIL,
 *                 finally `greg@cookemedia.io` - mirrors requireAuth.ts)
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, portalUsersTable } from "@workspace/db";

const DRY_RUN = !(process.argv.includes("--apply") || process.env.APPLY === "1");

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "greg@cookemedia.io")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function main(): Promise<void> {
  console.log(
    `[fix-room30-main-portal-key] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} adminEmails=${ADMIN_EMAILS.length}`,
  );

  const stuckRows = await db
    .select({
      id: portalUsersTable.id,
      email: portalUsersTable.email,
      clerkId: portalUsersTable.clerkId,
      role: portalUsersTable.role,
      portalKey: portalUsersTable.portalKey,
    })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.portalKey, "main"));

  console.log(`[fix-room30-main-portal-key] found ${stuckRows.length} portal_users rows with portal_key='main'`);

  const adminSet = new Set(ADMIN_EMAILS);
  const skipped: typeof stuckRows = [];
  const toFix: typeof stuckRows = [];
  for (const row of stuckRows) {
    const e = (row.email || "").toLowerCase();
    if (adminSet.has(e)) {
      skipped.push(row);
    } else {
      toFix.push(row);
    }
  }

  console.log(`[fix-room30-main-portal-key] skipping ${skipped.length} admin row(s):`);
  for (const row of skipped) {
    console.log(`  - id=${row.id} email=${row.email} role=${row.role}`);
  }

  console.log(`[fix-room30-main-portal-key] will fix ${toFix.length} row(s):`);
  for (const row of toFix) {
    console.log(
      `  - id=${row.id} email=${row.email} clerkId=${row.clerkId ?? "<null>"} role=${row.role}`,
    );
  }

  if (DRY_RUN) {
    console.log("[fix-room30-main-portal-key] dry-run; no writes performed. Re-run with --apply to commit.");
    return;
  }

  if (toFix.length === 0) {
    console.log("[fix-room30-main-portal-key] nothing to update.");
    return;
  }

  const ids = toFix.map((r) => r.id);
  const updated = await db
    .update(portalUsersTable)
    .set({ portalKey: "room30" })
    .where(
      and(
        eq(portalUsersTable.portalKey, "main"),
        inArray(portalUsersTable.id, ids),
      ),
    )
    .returning({ id: portalUsersTable.id });
  console.log(`[fix-room30-main-portal-key] updated ${updated.length} row(s).`);

  const [{ count: remaining = 0 } = { count: 0 }] = (await db.execute<{ count: number }>(
    sql`select count(*)::int as count from portal_users where portal_key = 'main'`,
  )).rows as Array<{ count: number }>;
  console.log(`[fix-room30-main-portal-key] remaining portal_key='main' rows: ${remaining}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fix-room30-main-portal-key] failed:", err);
    process.exit(1);
  });

