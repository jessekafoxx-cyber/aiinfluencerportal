/**
 * Task #558 - Prod backfill helper for legacy `portal_key='main'` (and any
 * other non-`'room30'`) rows across all four single-tenant tables.
 *
 * Why this exists
 * ---------------
 * Migration `0053_t558_portal_key_room30_defaults.sql` does two things:
 *   1. `UPDATE ... SET portal_key='room30'` against portal_users,
 *      course_phases, lessons, and invites (data backfill).
 *   2. `ALTER TABLE ... ALTER COLUMN portal_key SET DEFAULT 'room30'`
 *      against the same four tables (schema change).
 *
 * Replit's Publish flow applies (2) automatically because it shows up in
 * the schema diff, but it silently skips (1) - the same UPDATE-block trap
 * documented in replit.md (Task #200 / #432 / #512 gotcha). On prod the
 * column defaults will flip the moment Publish runs, but any legacy rows
 * still parked on `portal_key='main'` (or anything else) will stay put
 * until something rewrites them.
 *
 * Tolerance, not blockage
 * -----------------------
 * The runtime is already safe pre-backfill:
 *   - `shouldDenyCrossPortal()` (requireAuth-helpers.ts) short-circuits
 *     to `false` whenever the request's portalKey is "room30", so legacy
 *     rows can never produce a 403 in the single-tenant world.
 *   - `requireAuth()` heals each legacy row to `'room30'` on first login.
 * So users will never hit the original Task #558 403. This script just
 * cleans up dormant rows whose owners have not logged in yet, so admin
 * dashboards and `SELECT ... GROUP BY portal_key` queries show a single
 * tenant.
 *
 * Why we did not extend `fix-room30-main-portal-key.ts` (Task #501)
 * ----------------------------------------------------------------
 * That script only touches portal_users and intentionally skips admin
 * emails (admins were historically allowed to be cross-portal). After
 * Task #491 the project is single-tenant, so admins on `portal_key='main'`
 * are no longer special - they are just stuck rows like everyone else.
 * Keeping a dedicated script for #558 preserves the #501 audit trail.
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run fix:task-558-portal-key
 *     # dry-run: prints the counts that would change, does nothing
 *   pnpm --filter @workspace/scripts run fix:task-558-portal-key -- --apply
 *     # writes: flips every non-room30 portal_key to 'room30'
 *
 * Env
 * ---
 *   DATABASE_URL (required) - point at prod via PROD_DATABASE_URL or by
 *   exporting DATABASE_URL=$PROD_DATABASE_URL for the invocation.
 *
 * Safety
 * ------
 * The script also re-asserts the column default on all four tables. That
 * step is idempotent and a no-op if Publish has already flipped them.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1";

type TableName = "portal_users" | "course_phases" | "lessons" | "invites";
const TABLES: TableName[] = ["portal_users", "course_phases", "lessons", "invites"];

async function countNonRoom30(table: TableName): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql.raw(`SELECT count(*)::text AS count FROM "${table}" WHERE portal_key <> 'room30'`),
  );
  const rows = (result as unknown as { rows: { count: string }[] }).rows ?? (result as unknown as { count: string }[]);
  const row = Array.isArray(rows) ? rows[0] : (rows as { count: string });
  return Number(row?.count ?? 0);
}

async function backfill(table: TableName): Promise<number> {
  const result = await db.execute(
    sql.raw(`UPDATE "${table}" SET portal_key = 'room30' WHERE portal_key <> 'room30'`),
  );
  const rowCount =
    (result as unknown as { rowCount?: number }).rowCount ??
    (result as unknown as { count?: number }).count ??
    0;
  return Number(rowCount);
}

async function ensureDefault(table: TableName): Promise<void> {
  await db.execute(sql.raw(`ALTER TABLE "${table}" ALTER COLUMN portal_key SET DEFAULT 'room30'`));
}

async function main() {
  console.log(`[task-558] mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log("[task-558] step 1: counting non-room30 rows");

  const before: Record<TableName, number> = {} as Record<TableName, number>;
  for (const t of TABLES) {
    before[t] = await countNonRoom30(t);
    console.log(`  - ${t}: ${before[t]} legacy row(s)`);
  }

  const total = Object.values(before).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log("[task-558] nothing to backfill - all rows already on 'room30'");
  } else if (!APPLY) {
    console.log(`[task-558] would update ${total} row(s) total. Re-run with --apply to write.`);
  } else {
    console.log("[task-558] step 2: applying UPDATE");
    for (const t of TABLES) {
      if (before[t] === 0) continue;
      const updated = await backfill(t);
      console.log(`  - ${t}: updated ${updated} row(s)`);
    }
  }

  console.log("[task-558] step 3: re-asserting column default 'room30' (idempotent)");
  if (APPLY) {
    for (const t of TABLES) {
      await ensureDefault(t);
      console.log(`  - ${t}: default set`);
    }
  } else {
    console.log("  (dry-run; skipping)");
  }

  console.log("[task-558] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[task-558] failed", err);
  process.exit(1);
});
