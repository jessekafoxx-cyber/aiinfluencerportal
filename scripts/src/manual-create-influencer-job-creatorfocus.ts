/**
 * Task #774 - One-off: manually queue the owed free AI Influencer build for
 * creatorfocus.will@gmail.com (app_user id 728).
 *
 * Why this exists: this buyer paid for the main product (which includes one
 * free AI Influencer build) but never got a job queued, so /your-influencers
 * shows an empty page. While the empty-state Build CTA + daily audit ship to
 * prevent this going forward, this script seeds the missing queued job so
 * Viktor can pick it up.
 *
 * Defaults are NEUTRAL because we do not have a recorded spec for this buyer.
 * Override them on the CLI if the buyer supplied preferences:
 *   --gender female|male  --age 25-35  --ethnicity white
 *   --vibe "Confident lifestyle"  --notes "..."
 *
 * After running --apply, open the super-admin console at
 *   https://room30.ai/members/admin/influencer-generations?jobId=<id>
 * and click "Retry" - that re-fires the Viktor Slack + Monday handoff so
 * Viktor actually picks the job up. (We can't import those notifiers here
 * without dragging in the api-server runtime; the retry button is the
 * blessed, idempotent admin recovery path.)
 *
 * Usage (run against PROD_DATABASE_URL):
 *   DATABASE_URL=$PROD_DATABASE_URL \
 *     pnpm --filter @workspace/scripts run manual:creatorfocus-influencer
 *   DATABASE_URL=$PROD_DATABASE_URL \
 *     pnpm --filter @workspace/scripts run manual:creatorfocus-influencer -- --apply
 *
 * Connection: uses PROD_DATABASE_URL if set, else DATABASE_URL. Read-only in
 * dry-run; only --apply writes (one ai_influencers + one ai_influencer_jobs
 * row, in a transaction, guarded by an identity assertion).
 */
import "dotenv/config";
import { Pool } from "pg";

const EXPECTED_EMAIL = "creatorfocus.will@gmail.com";
const APP_USER_ID = 728;

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set PROD_DATABASE_URL or DATABASE_URL first.");
    process.exit(1);
  }
  const PREFS = {
    gender: arg("gender", "female"),
    ageRange: arg("age", "25-35"),
    ethnicity: arg("ethnicity", "white"),
    vibe: arg("vibe", "Confident, modern lifestyle"),
    notes: arg("notes", "Free build owed to paid buyer (Task #774 remediation)."),
    facialHair: null as string | null,
    hairstyle: null as string | null,
  };

  const pool = new Pool({ connectionString: url });
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Target: app_user id=${APP_USER_ID} email=${EXPECTED_EMAIL}`);

  // Identity assertion - refuse to run if the row doesn't match the buyer.
  const { rows: users } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM app_users WHERE id = $1`,
    [APP_USER_ID],
  );
  if (users.length === 0) {
    console.error(`ABORT: app_user ${APP_USER_ID} not found.`);
    await pool.end();
    process.exit(1);
  }
  const u = users[0];
  if (u.email?.toLowerCase() !== EXPECTED_EMAIL) {
    console.error(
      `ABORT: identity mismatch. Found email=${u.email}, expected ${EXPECTED_EMAIL}.`,
    );
    await pool.end();
    process.exit(1);
  }
  console.log("Verified buyer.");

  // Confirm the buyer actually has a paid order (don't grant a free build to
  // someone who never paid).
  const { rows: paid } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders
       WHERE lower(email) = lower($1) AND main_product_paid = true`,
    [EXPECTED_EMAIL],
  );
  if (!paid[0] || paid[0].n === 0) {
    console.error(
      `ABORT: no paid order found for ${EXPECTED_EMAIL}. Not owed a free build.`,
    );
    await pool.end();
    process.exit(1);
  }
  console.log(`Paid orders for buyer: ${paid[0].n}`);

  // Don't double-create. If they already have any non-failed job, bail.
  const { rows: jobs } = await pool.query<{ id: number; status: string }>(
    `SELECT id, status FROM ai_influencer_jobs WHERE client_id = $1 ORDER BY created_at DESC`,
    [APP_USER_ID],
  );
  console.log(`Existing jobs: ${jobs.length}`);
  if (jobs.length > 0) {
    console.log(jobs);
    const live = jobs.filter((j) => j.status !== "failed");
    if (live.length > 0) {
      console.error(
        `ABORT: buyer already has ${live.length} non-failed job(s). Investigate before re-running.`,
      );
      await pool.end();
      process.exit(1);
    }
    console.log(`(All ${jobs.length} prior job(s) are failed - safe to seed a fresh one.)`);
  }

  const characterProfile = { ...PREFS };
  const prefs = { ...PREFS, characterProfile };
  const etaAt = new Date(Date.now() + 45 * 60 * 1000);
  console.log(`\nPrefs to seed:\n${JSON.stringify(prefs, null, 2)}`);
  console.log(`ETA: ${etaAt.toISOString()}`);

  if (!apply) {
    console.log("\nDry-run - nothing written. Re-run with --apply to commit.\n");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [inf],
    } = await client.query<{ id: number }>(
      `INSERT INTO ai_influencers (client_id, name, gender, age_range, status)
       VALUES ($1, $2, $3, $4, 'building')
       RETURNING id`,
      [APP_USER_ID, `Influencer (pending)`, PREFS.gender, PREFS.ageRange],
    );
    const {
      rows: [job],
    } = await client.query<{ id: number; created_at: string }>(
      `INSERT INTO ai_influencer_jobs
         (client_id, influencer_id, prefs, status, eta_at, is_free_tier, progress)
       VALUES ($1, $2, $3::jsonb, 'queued', $4, true, 0)
       RETURNING id, created_at`,
      [APP_USER_ID, inf.id, JSON.stringify(prefs), etaAt.toISOString()],
    );
    await client.query(`UPDATE ai_influencers SET name = $1 WHERE id = $2`, [
      `Influencer ${job.id}`,
      inf.id,
    ]);
    await client.query("COMMIT");
    console.log(`\nCreated:`);
    console.log(`  ai_influencers     #${inf.id}  (status=building)`);
    console.log(`  ai_influencer_jobs #${job.id} (status=queued, eta=${etaAt.toISOString()})`);
    console.log(
      `\nNext: open https://room30.ai/members/admin/influencer-generations?jobId=${job.id}`,
    );
    console.log(
      `      and click "Retry" - that fires the Viktor Slack + Monday handoff so Viktor picks it up.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
