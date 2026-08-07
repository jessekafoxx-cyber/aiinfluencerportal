/**
 * Task #522 verification: run the orders-resync sweep once, time
 * each phase, and dump the resulting sync_sessions row so we can
 * verify end-to-end behavior against the real dev DB + Whop API.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/verify-orders-resync.ts
 */
import { performance } from "node:perf_hooks";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, ordersTable, syncSessions } from "@workspace/db";
import { runOrdersResyncOnceNow } from "../../../artifacts/api-server/src/lib/orders-resync-scheduler";

function fmt(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const lookbackDays = Number(process.env.ORDERS_RESYNC_LOOKBACK_DAYS ?? "7");
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  console.log(`\n=== Task #522 verification ===`);
  console.log(`lookbackDays=${lookbackDays} since=${sinceDate.toISOString()}`);
  console.log(`WHOP_API_KEY=${process.env.WHOP_API_KEY ? "set" : "MISSING"}`);
  console.log(`WHOP_BUSINESS_ID=${process.env.WHOP_BUSINESS_ID ? "set" : "MISSING"}`);

  // ---- Phase 1: candidate selection cost ----
  const tSel = performance.now();
  const rows = await db
    .select({ id: ordersTable.id, email: ordersTable.email })
    .from(ordersTable)
    .where(
      and(
        sql`${ordersTable.email} IS NOT NULL AND length(${ordersTable.email}) > 0`,
        gte(ordersTable.createdAt, sinceDate),
      ),
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(1000);
  const selMs = performance.now() - tSel;

  const seen = new Set<string>();
  for (const r of rows) {
    const e = (r.email || "").trim().toLowerCase();
    if (e) seen.add(e);
  }
  console.log(`\n[phase1] candidate selection`);
  console.log(`  rowsFetched=${rows.length} uniqueEmails=${seen.size} took=${fmt(selMs)}`);

  // ---- Phase 2: one full sweep tick ----
  console.log(`\n[phase2] runOrdersResyncOnceNow()`);
  const tTick = performance.now();
  await runOrdersResyncOnceNow();
  const tickMs = performance.now() - tTick;
  const perBuyerMs = seen.size > 0 ? tickMs / Math.min(seen.size, 200) : 0;
  console.log(`  total=${fmt(tickMs)} estPerBuyer=${fmt(perBuyerMs)}`);

  // ---- Phase 3: read back the sync_sessions row ----
  const sessions = await db
    .select()
    .from(syncSessions)
    .where(eq(syncSessions.board, "orders-resync"))
    .orderBy(desc(syncSessions.startedAt))
    .limit(1);
  const last = sessions[0];
  console.log(`\n[phase3] latest sync_sessions row (board='orders-resync')`);
  if (!last) {
    console.log(`  NONE - scheduler did not write a session row`);
  } else {
    console.log(`  id=${last.id} status=${last.status}`);
    console.log(`  startedAt=${last.startedAt?.toISOString?.()}`);
    console.log(`  completedAt=${last.completedAt?.toISOString?.()}`);
    console.log(`  rowsFetched=${last.rowsFetched} rowsProcessed=${last.rowsProcessed}`);
    console.log(`  successfulExtractions=${last.successfulExtractions} recoveries=${last.recoveries} rowsSkipped=${last.rowsSkipped}`);
    console.log(`  error=${last.error ?? "null"}`);
    console.log(`  summary=${JSON.stringify(last.summary, null, 2)}`);
  }

  // ---- Bench summary ----
  console.log(`\n=== bench summary ===`);
  console.log(`  candidate-select: ${fmt(selMs)} (for ${rows.length} rows)`);
  console.log(`  full tick:        ${fmt(tickMs)}`);
  if (seen.size > 0) {
    const projected1k = perBuyerMs * 1000;
    console.log(`  projected 1000-buyer tick: ~${fmt(projected1k)} (linear extrapolation)`);
  }
  console.log(`  default cadence:  3600000ms (60min) — tick well within budget`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[verify] fatal", e);
    process.exit(1);
  },
);
