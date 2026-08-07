/**
 * Grant a super-admin app_users row for a Clerk identity.
 *
 * Why this exists: the admin console at /admin/influencer-generations
 * (and every other requireInfluencerAdmin-gated route) checks
 * `req.appUser.isSuperAdmin` first and falls back to a substring match
 * against `ADMIN_EMAILS`. The fallback only fires when
 * `req.appUser.email` is non-null. We have rows in production where
 * `email` was inserted as NULL because Clerk's session claims omitted
 * it AND the clerkClient fallback transiently 5xx'd at requireAuth
 * time - those users then get 403 forever and the page renders as
 * "No generations match the current filters." This script forcibly
 * upserts the row with the right email + clerk_id + is_super_admin=true
 * so the gate passes on the very next request.
 *
 * Usage (run against PROD_DATABASE_URL):
 *   CLERK_ID=user_xxx EMAIL=greg@cookemedia.io NAME="Greg Cooke" \
 *     DATABASE_URL=$PROD_DATABASE_URL \
 *     pnpm --filter @workspace/scripts run grant:super-admin
 *   # add --apply to commit
 *
 * Pull Greg's clerk_id off portal_users first:
 *   SELECT id, clerk_id, email FROM portal_users WHERE email='greg@cookemedia.io';
 */
import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  const clerkId = process.env.CLERK_ID?.trim();
  const email = process.env.EMAIL?.trim().toLowerCase();
  const name = process.env.NAME?.trim() || null;

  if (!url) {
    console.error("DATABASE_URL not set. Export PROD_DATABASE_URL first.");
    process.exit(1);
  }
  if (!clerkId || !clerkId.startsWith("user_")) {
    console.error("CLERK_ID env var required (must start with 'user_').");
    process.exit(1);
  }
  if (!email || !email.includes("@")) {
    console.error("EMAIL env var required.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Target: clerk_id=${clerkId} email=${email} name=${name ?? "-"}`);

  const { rows: existing } = await pool.query<{
    id: number;
    email: string | null;
    name: string | null;
    clerk_id: string;
    is_super_admin: boolean;
    role: string;
  }>(
    `SELECT id, email, name, clerk_id, is_super_admin, role
       FROM app_users WHERE clerk_id = $1 OR LOWER(email) = $2`,
    [clerkId, email],
  );

  if (existing.length > 1) {
    console.error(
      `ABORT: ${existing.length} app_users rows already match clerk_id OR email. Resolve manually before re-running:`,
    );
    for (const r of existing) {
      console.error(
        `  - id=${r.id} clerk_id=${r.clerk_id} email=${r.email ?? "<null>"} is_super_admin=${r.is_super_admin} role=${r.role}`,
      );
    }
    console.error(
      `  Hint: pick the row whose clerk_id matches the intended Clerk identity, delete the stale sibling(s), then re-run this script.`,
    );
    await pool.end();
    process.exit(1);
  }

  const current = existing[0];
  if (current) {
    console.log(`Found existing row #${current.id}:`, current);
    if (current.clerk_id !== clerkId) {
      console.error(
        `ABORT: existing row has clerk_id=${current.clerk_id} but you passed ${clerkId}. Refusing to overwrite another user's identity.`,
      );
      await pool.end();
      process.exit(1);
    }
  } else {
    console.log("No existing row - will insert fresh.");
  }

  if (!apply) {
    console.log("\nDry-run - nothing written. Re-run with --apply to commit.\n");
    await pool.end();
    return;
  }

  if (current) {
    const { rows: updated } = await pool.query(
      `UPDATE app_users
         SET email = $1,
             name = COALESCE(NULLIF($2, ''), name),
             is_super_admin = true,
             role = 'super_admin'
       WHERE id = $3
       RETURNING id, email, name, clerk_id, is_super_admin, role`,
      [email, name ?? "", current.id],
    );
    console.log("Updated:", updated[0]);
  } else {
    const { rows: inserted } = await pool.query(
      `INSERT INTO app_users (clerk_id, email, name, role, is_super_admin)
       VALUES ($1, $2, $3, 'super_admin', true)
       RETURNING id, email, name, clerk_id, is_super_admin, role`,
      [clerkId, email, name],
    );
    console.log("Inserted:", inserted[0]);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
