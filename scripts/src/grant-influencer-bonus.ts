/**
 * Grant N bonus AI Influencer generations to a buyer by email.
 *
 * Writes `portal_users.bonus_influencer_quota` directly. The portal's
 * computePurchaseEntitlements() sums this value onto the base
 * entitlement (1 free + 5 from upsell2Paid), so the buyer's total cap
 * becomes 1 + (upsell2 ? 5 : 0) + bonusInfluencerQuota.
 *
 * Mirrors `PATCH /api/portal/admin/users/:userId/influencer-bonus` and
 * `POST /api/admin/external/v1/user/influencer-bonus`. CLI form exists
 * so support can grant from the shell with an audit trail.
 *
 * Usage:
 *   # add N (negative allowed)
 *   DRY_RUN=1 pnpm --filter @workspace/scripts run grant:influencer-bonus -- \
 *     --email buyer@example.com --add 5
 *
 *   # or set to exactly N
 *   DRY_RUN=0 pnpm --filter @workspace/scripts run grant:influencer-bonus -- \
 *     --email buyer@example.com --set 10
 *
 * Against production:
 *   DATABASE_URL=$PROD_DATABASE_URL DRY_RUN=0 \
 *     pnpm --filter @workspace/scripts run grant:influencer-bonus -- \
 *       --email buyer@example.com --add 5
 *
 * Floor 0; never persists below zero. No upper cap.
 */

import { eq, sql } from "drizzle-orm";
import { db, portalUsersTable } from "@workspace/db";

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";

function parseArgs(): { email: string; add?: number; set?: number } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.findIndex((a) => a === flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = (get("--email") ?? get("-e") ?? process.env.EMAIL ?? "")
    .trim()
    .toLowerCase();
  const addRaw = get("--add");
  const setRaw = get("--set");
  const add = addRaw !== undefined ? Number.parseInt(addRaw, 10) : undefined;
  const set = setRaw !== undefined ? Number.parseInt(setRaw, 10) : undefined;
  if (!email || !email.includes("@")) {
    console.error(
      "Usage: pnpm --filter @workspace/scripts run grant:influencer-bonus -- --email buyer@example.com (--add N | --set N)",
    );
    process.exit(2);
  }
  if (add === undefined && set === undefined) {
    console.error("Must provide --add N or --set N");
    process.exit(2);
  }
  if (add !== undefined && Number.isNaN(add)) {
    console.error("--add must be an integer");
    process.exit(2);
  }
  if (set !== undefined && (Number.isNaN(set) || set < 0)) {
    console.error("--set must be a non-negative integer");
    process.exit(2);
  }
  return { email, add, set };
}

async function main() {
  const { email, add, set } = parseArgs();
  console.log(
    `[grant-influencer-bonus] email=${email} ${
      typeof set === "number" ? `set=${set}` : `add=${add}`
    } dryRun=${DRY_RUN ? "yes" : "no"}`,
  );

  const users = await db
    .select({
      id: portalUsersTable.id,
      email: portalUsersTable.email,
      bonusInfluencerQuota: portalUsersTable.bonusInfluencerQuota,
    })
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${email}`);

  if (users.length === 0) {
    console.error(`[grant-influencer-bonus] no portal_users row for ${email}`);
    process.exit(1);
  }
  if (users.length > 1) {
    console.log(
      `[grant-influencer-bonus] note: ${users.length} portal_users rows share this email; updating all`,
    );
  }

  for (const user of users) {
    const prior = user.bonusInfluencerQuota ?? 0;
    const nextRaw = typeof set === "number" ? set : prior + (add ?? 0);
    const next = Math.max(0, nextRaw);
    if (next === prior) {
      console.log(
        `[grant-influencer-bonus] portalUserId=${user.id} already at ${prior}; no change`,
      );
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `[grant-influencer-bonus] portalUserId=${user.id} would update bonusInfluencerQuota: ${prior} -> ${next} (DRY_RUN=1)`,
      );
      continue;
    }
    await db
      .update(portalUsersTable)
      .set({ bonusInfluencerQuota: next })
      .where(eq(portalUsersTable.id, user.id));
    console.log(
      `[grant-influencer-bonus] portalUserId=${user.id} updated bonusInfluencerQuota: ${prior} -> ${next}`,
    );
  }

  console.log(
    `[grant-influencer-bonus] done.${DRY_RUN ? " (DRY_RUN=1; re-run with DRY_RUN=0 to apply)" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
