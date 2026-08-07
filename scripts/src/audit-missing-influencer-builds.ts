/**
 * Task #774 - Audit: paid buyers with no AI Influencer build job.
 *
 * Read-only. Every main-product buyer is owed one free AI Influencer build.
 * This script lists app_users who (a) have a paid order matched by email and
 * (b) have no ai_influencer_jobs row (excluding failed jobs). Those buyers
 * land on an empty "Your Influencers" page and never got their free build
 * queued.
 *
 * It also explicitly reports the state of a single user id when passed
 * --user-id, so the recurring "user 728 never got their build" case can be
 * checked directly:
 *
 *   pnpm --filter @workspace/scripts run audit:missing-influencer-builds
 *   pnpm --filter @workspace/scripts run audit:missing-influencer-builds -- --user-id 728
 *
 * Connection: uses PROD_DATABASE_URL if set, else DATABASE_URL. Both safe -
 * this script only runs SELECTs. No DB writes. Remediation (actually
 * queuing a build) is owned by the AI Influencer pipeline / Viktor, not a
 * direct DB write.
 */

import { Client } from "pg";

function parseUserId(): number | null {
  const idx = process.argv.indexOf("--user-id");
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Set PROD_DATABASE_URL (preferred for live audits) or DATABASE_URL",
    );
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const userId = parseUserId();
    if (userId !== null) {
      const single = await client.query(
        `SELECT u.id, u.email,
           EXISTS (
             SELECT 1 FROM orders o
             WHERE lower(o.email) = lower(u.email) AND o.main_product_paid = true
           ) AS has_paid_order,
           (SELECT count(*) FROM ai_influencer_jobs j WHERE j.client_id = u.id) AS total_jobs,
           (SELECT count(*) FROM ai_influencer_jobs j WHERE j.client_id = u.id AND j.status <> 'failed') AS active_jobs
         FROM app_users u WHERE u.id = $1`,
        [userId],
      );
      if (single.rows.length === 0) {
        console.log(`No app_users row for id=${userId}`);
      } else {
        const r = single.rows[0];
        console.log(`User id=${r.id} email=${r.email}`);
        console.log(`  has paid order:   ${r.has_paid_order}`);
        console.log(`  total jobs:       ${r.total_jobs}`);
        console.log(`  non-failed jobs:  ${r.active_jobs}`);
        const owed = r.has_paid_order && Number(r.active_jobs) === 0;
        console.log(
          owed
            ? "  => OWED a free build: paid order with no non-failed job. Queue a build via the pipeline."
            : "  => OK or not owed (either no paid order, or a build already exists).",
        );
      }
      console.log("");
    }

    const result = await client.query(
      `SELECT u.id AS user_id, lower(u.email) AS email
       FROM app_users u
       WHERE u.email IS NOT NULL AND u.email <> ''
         AND EXISTS (
           SELECT 1 FROM orders o
           WHERE lower(o.email) = lower(u.email) AND o.main_product_paid = true
         )
         AND NOT EXISTS (
           SELECT 1 FROM ai_influencer_jobs j
           WHERE j.client_id = u.id AND j.status <> 'failed'
         )
       ORDER BY u.id DESC`,
    );
    console.log(
      `Paid buyers with no (non-failed) AI Influencer build: ${result.rows.length}`,
    );
    for (const row of result.rows) {
      console.log(`  user_id=${row.user_id}  ${row.email}`);
    }
    if (result.rows.length === 0) {
      console.log("  (none - every paid buyer has at least one build job)");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
