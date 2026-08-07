/**
 * crm-ingest-health-check (Task #647)
 *
 * One-shot CLI version of the worker's CRM ingest health alarm
 * (`artifacts/api-server/src/lib/crm-ingest-health-alarm.ts`). Counts
 * buyer/portal emails in the trailing window vs. how many are present
 * in crm_contacts, and exits non-zero if the missing delta exceeds the
 * threshold. SQL is intentionally duplicated from the worker module so
 * scripts/ stays free of cross-artifact imports.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run crm:ingest-health
 *   pnpm --filter @workspace/scripts run crm:ingest-health -- --window-min=60 --threshold=5
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const argv = process.argv.slice(2);

function flag(name: string, fallback: number): number {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=", 2)[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const windowMin = flag("window-min", 60);
  const threshold = flag("threshold", 5);
  const sampleLimit = flag("sample-limit", 25);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowMin * 60 * 1000);

  const rows = await db.execute(sql`
    WITH expected AS (
      SELECT lower(email) AS email, 'coaching'::text AS src
        FROM coaching_agreements
       WHERE email IS NOT NULL AND paid_at IS NOT NULL
         AND paid_at >= ${windowStart} AND paid_at < ${windowEnd}
      UNION
      SELECT lower(email) AS email, 'portal_users'::text AS src
        FROM portal_users
       WHERE email IS NOT NULL AND is_active = true
         AND created_at >= ${windowStart} AND created_at < ${windowEnd}
      UNION
      SELECT lower(email) AS email, 'orders'::text AS src
        FROM orders
       WHERE email IS NOT NULL AND main_product_paid = true
         AND created_at >= ${windowStart} AND created_at < ${windowEnd}
    ),
    distinct_expected AS (SELECT DISTINCT email FROM expected),
    joined AS (
      SELECT e.email,
             EXISTS (SELECT 1 FROM crm_contacts c WHERE lower(c.email) = e.email) AS present
        FROM distinct_expected e
    )
    SELECT
      (SELECT count(*)::int FROM distinct_expected)                                 AS expected,
      (SELECT count(*)::int FROM joined WHERE present)                              AS present,
      (SELECT coalesce(array_agg(email ORDER BY email), ARRAY[]::text[])
         FROM (SELECT email FROM joined WHERE NOT present ORDER BY email LIMIT ${sampleLimit}) s
      )                                                                              AS missing_sample,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'coaching')      AS coaching,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'portal_users')  AS portal_users,
      (SELECT count(DISTINCT email)::int FROM expected WHERE src = 'orders')        AS orders
  `);

  const r = (rows.rows as Array<Record<string, unknown>>)[0] ?? {};
  const expected = Number(r.expected || 0);
  const present = Number(r.present || 0);
  const missing = Math.max(0, expected - present);
  const missingSample = Array.isArray(r.missing_sample) ? (r.missing_sample as string[]) : [];

  console.log(
    `[crm-ingest-health] window=${windowMin}m  ` +
      `${windowStart.toISOString()} -> ${windowEnd.toISOString()}`,
  );
  console.log(
    `[crm-ingest-health] expected=${expected} present=${present} missing=${missing}`,
  );
  console.log(
    `[crm-ingest-health] per-source: coaching=${Number(r.coaching || 0)} ` +
      `portal_users=${Number(r.portal_users || 0)} ` +
      `orders=${Number(r.orders || 0)}`,
  );
  if (missingSample.length > 0) {
    console.log(`[crm-ingest-health] sample of missing emails:`);
    for (const e of missingSample) console.log(`  - ${e}`);
  }

  if (missing >= threshold) {
    console.error(
      `[crm-ingest-health] FAIL: missing ${missing} >= threshold ${threshold}`,
    );
    process.exit(2);
  }
  console.log(`[crm-ingest-health] OK: missing ${missing} < threshold ${threshold}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[crm-ingest-health] failed:", err);
  process.exit(1);
});
