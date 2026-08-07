import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));

type AppliedProbe = () => Promise<boolean>;

async function hasTable(name: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [name],
  );
  return r.rowCount! > 0;
}
async function hasColumn(table: string, column: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
    [table, column],
  );
  return r.rowCount! > 0;
}
async function hasIndex(name: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1",
    [name],
  );
  return r.rowCount! > 0;
}

const MIGRATIONS: Array<{ name: string; applied: AppliedProbe }> = [
  { name: "0040_funnel_leads", applied: () => hasTable("funnel_leads") },
  {
    name: "0040_t396_dfy_bgm_track_codes",
    applied: () => hasColumn("dfy_background_tracks", "track_code"),
  },
  {
    name: "0041_t402_durable_media_library",
    applied: () => hasColumn("ad_research_board_items", "source_present"),
  },
  {
    // 0042 is a pure dedupe operation against historical dupes; once 0041 is
    // in place and the sheet sync owns the dedupe going forward, re-running
    // is a no-op but still safe. Gate it on 0041's column so we only run it
    // the same time we run 0041 (the cohort it was written against).
    name: "0042_dedup_ad_research_board_by_ad_link",
    applied: () => hasColumn("ad_research_board_items", "source_present"),
  },
  {
    name: "0043_t403_separate_moderation_from_operational_state",
    applied: () => hasColumn("ad_research_board_items", "library_visibility"),
  },
  {
    name: "0044_t403_canonical_url_hash",
    applied: () => hasIndex("ad_research_board_items_canonical_url_hash_visible_uq"),
  },
  {
    // Task #550: insert the canonical AI Influencer Portfolio brain row.
    // Pure data INSERT ... ON CONFLICT DO NOTHING; safe to re-run, treated
    // as applied once the row exists. drizzle-kit push silently skips
    // data-only migrations, so the runner has to apply this one.
    name: "0054_t550_seed_ai_influencer_portfolio",
    applied: async () => {
      if (!(await hasTable("prebuilt_brains"))) return false;
      const r = await pool.query(
        "SELECT 1 FROM prebuilt_brains WHERE id = 'ai-influencer-portfolio'",
      );
      return r.rowCount! > 0;
    },
  },
  {
    // Task #20: remove the carried-over yddecasas21@gmail.com account and its
    // synthetic full-access order. Pure data DELETEs; "applied" once no
    // matching rows remain (re-running is a harmless no-op either way).
    name: "0104_delete_carryover_room30_admin_account",
    applied: async () => {
      if (!(await hasTable("portal_users")) || !(await hasTable("orders"))) return false;
      const r = await pool.query(
        "SELECT 1 FROM portal_users WHERE email = 'yddecasas21@gmail.com' AND portal_key = 'room30' UNION ALL SELECT 1 FROM orders WHERE id = 'room30-admin-grant-0cb82278b15d2d87' LIMIT 1",
      );
      return r.rowCount! === 0;
    },
  },
];

async function main() {
  const migrationsDir = resolve(__dirname, "../../lib/db/migrations");
  for (const { name, applied } of MIGRATIONS) {
    process.stdout.write(`[apply-data-migrations] ${name} ... `);
    if (await applied()) {
      console.log("skip (already applied)");
      continue;
    }
    const path = `${migrationsDir}/${name}.sql`;
    const sql = readFileSync(path, "utf8").replace(/--> statement-breakpoint/g, "");
    try {
      await pool.query(sql);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      process.exitCode = 1;
      return;
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
