/**
 * One-off: manually create an AI Influencer job for
 * nutriliciouslife@gmail.com (app_user 233 / clerk_id
 * user_3E0bVuaYMWQnrbavfZPh5vcpgTb).
 *
 * Why this exists: the buyer reported (Intercom 215474386509060) that
 * the /your-influencers Generate modal would not submit. Multi-browser
 * confirmed. While the form fix ships, this script seeds her queued
 * job + influencer row from her requested spec:
 *   Female, 30-40, athletic sun-kissed, confident Australian beach
 *   lifestyle, well put together.
 *
 * After running --apply, ask Greg to open the super-admin console at
 *   /admin/influencer-generations?jobId=<id>
 * and click "Retry" — that re-fires Viktor (Slack) + Monday so Viktor
 * actually picks the job up. (We can't import those notifiers here
 * without dragging in the api-server runtime; the retry button is the
 * blessed admin recovery path and is already idempotent.)
 *
 * Usage (run against PROD_DATABASE_URL):
 *   DATABASE_URL=$PROD_DATABASE_URL \
 *     pnpm --filter @workspace/scripts run manual:nutriliciouslife-influencer
 *   DATABASE_URL=$PROD_DATABASE_URL \
 *     pnpm --filter @workspace/scripts run manual:nutriliciouslife-influencer -- --apply
 */
import "dotenv/config";
import { Pool } from "pg";

const EXPECTED_EMAIL = "nutriliciouslife@gmail.com";
const EXPECTED_CLERK_ID = "user_3E0bVuaYMWQnrbavfZPh5vcpgTb";
const APP_USER_ID = 233;

const PREFS = {
  ageRange: "33-40",
  ethnicity: "white",
  gender: "female",
  vibe: "Athletic, outdoors, sun-kissed",
  notes:
    "Australian beach lifestyle - confident, well put together, sun-kissed athletic vibe.",
  facialHair: null as string | null,
  hairstyle: null as string | null,
};

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Export PROD_DATABASE_URL first.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(
    `Target: app_user id=${APP_USER_ID} email=${EXPECTED_EMAIL} clerk=${EXPECTED_CLERK_ID}`,
  );

  // Identity assertion — refuse to run if the row we're about to write
  // against doesn't match the recorded buyer.
  const { rows: users } = await pool.query<{
    id: number;
    email: string;
    clerk_id: string;
  }>(`SELECT id, email, clerk_id FROM app_users WHERE id = $1`, [APP_USER_ID]);
  if (users.length === 0) {
    console.error(`ABORT: app_user ${APP_USER_ID} not found.`);
    await pool.end();
    process.exit(1);
  }
  const u = users[0];
  if (u.email !== EXPECTED_EMAIL || u.clerk_id !== EXPECTED_CLERK_ID) {
    console.error(
      `ABORT: identity mismatch. Found email=${u.email} clerk=${u.clerk_id}, expected ${EXPECTED_EMAIL} / ${EXPECTED_CLERK_ID}.`,
    );
    await pool.end();
    process.exit(1);
  }
  console.log(`Verified buyer.`);

  // Don't double-create. If she already has any non-failed job, bail —
  // means the form fix landed and she submitted on her own, or someone
  // else already ran this script.
  const { rows: jobs } = await pool.query<{
    id: number;
    status: string;
    created_at: string;
  }>(
    `SELECT id, status, created_at FROM ai_influencer_jobs
       WHERE client_id = $1
       ORDER BY created_at DESC`,
    [APP_USER_ID],
  );
  console.log(`Existing jobs: ${jobs.length}`);
  if (jobs.length > 0) {
    console.log(jobs);
    const liveJobs = jobs.filter((j) => j.status !== "failed");
    if (liveJobs.length > 0) {
      console.error(
        `ABORT: buyer already has ${liveJobs.length} non-failed job(s). Investigate before re-running.`,
      );
      await pool.end();
      process.exit(1);
    }
    console.log(
      `(All ${jobs.length} prior job(s) are failed — safe to seed a fresh one.)`,
    );
  }

  // Same shape the buyer-POST path persists. The worker / Viktor flow
  // will re-derive a fuller characterProfile, but we store the prefs
  // exactly as the modal would have sent them.
  const characterProfile = { ...PREFS };
  const prefs = { ...PREFS, characterProfile };
  const etaAt = new Date(Date.now() + 45 * 60 * 1000); // 45-min ETA

  console.log(`\nPrefs to seed:\n${JSON.stringify(prefs, null, 2)}`);
  console.log(`ETA: ${etaAt.toISOString()}`);

  if (!apply) {
    console.log(
      "\nDry-run — nothing written. Re-run with --apply to commit.\n",
    );
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert influencer first with a placeholder name; the worker /
    // finalize ON CONFLICT lookup keys off `Influencer <jobId>`, so we
    // rename after we know the job id.
    const {
      rows: [inf],
    } = await client.query<{ id: number }>(
      `INSERT INTO ai_influencers
         (client_id, name, gender, age_range, status)
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

    await client.query(
      `UPDATE ai_influencers SET name = $1 WHERE id = $2`,
      [`Influencer ${job.id}`, inf.id],
    );

    await client.query("COMMIT");

    console.log(`\nCreated:`);
    console.log(`  ai_influencers   #${inf.id}  (status=building)`);
    console.log(`  ai_influencer_jobs #${job.id} (status=queued, eta=${etaAt.toISOString()})`);
    console.log(
      `\nNext: open https://room30.ai/members/admin/influencer-generations?jobId=${job.id}`,
    );
    console.log(
      `      and click "Retry" — that fires the Viktor Slack + Monday handoff so Viktor actually picks it up.`,
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
