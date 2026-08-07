/**
 * One-off data sync: copy `lessons.notes` (and `is_published` when it differs)
 * from the development portal database to the production portal database,
 * matched by `slug`.
 *
 * This was originally executed on 2026-04-17 as part of task #11. The script
 * is kept in the repo for auditability and so the sync can be re-run if
 * needed (e.g. against a staging environment).
 *
 * Usage:
 *   # dry run (default) — prints diff and exits without writing
 *   PROD_DATABASE_URL="postgresql://..." pnpm tsx scripts/src/sync-lessons-dev-to-prod.ts
 *
 *   # apply changes — wraps all UPDATEs in a single transaction
 *   PROD_DATABASE_URL="postgresql://..." pnpm tsx scripts/src/sync-lessons-dev-to-prod.ts --apply
 *
 * Behaviour:
 *   - Reads all rows from dev (DATABASE_URL) and prod (PROD_DATABASE_URL).
 *   - Matches by `slug` and produces three lists:
 *       a) present in both, notes/is_published differ  -> update prod
 *       b) present in dev only                         -> reported, NOT created
 *       c) present in prod only                        -> reported, left alone
 *   - Verifies post-sync by re-hashing notes on both sides.
 *   - Prints a human + machine-readable summary at the end.
 */

import { Client } from "pg";
import { createHash } from "node:crypto";

type Row = {
  slug: string;
  notes: string | null;
  is_published: boolean | null;
  wistia_video_id: string | null;
};

const md5 = (s: string | null) => createHash("md5").update(s ?? "").digest("hex");

async function fetchAll(url: string, ssl: boolean): Promise<Row[]> {
  const c = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  const r = await c.query<Row>("SELECT slug, notes, is_published, wistia_video_id FROM lessons");
  await c.end();
  return r.rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const devUrl = process.env.DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!devUrl) throw new Error("DATABASE_URL is not set (development DB).");
  if (!prodUrl) throw new Error("PROD_DATABASE_URL is not set (production DB).");

  const [dev, prod] = await Promise.all([
    fetchAll(devUrl, /*ssl*/ false),
    fetchAll(prodUrl, /*ssl*/ true),
  ]);

  const prodMap = new Map(prod.map((r) => [r.slug, r]));
  const devMap = new Map(dev.map((r) => [r.slug, r]));

  const toUpdate: Row[] = [];
  const identical: string[] = [];
  const devOnly: string[] = [];
  const prodOnly: string[] = [];

  for (const d of dev) {
    const p = prodMap.get(d.slug);
    if (!p) { devOnly.push(d.slug); continue; }
    const sameNotes = md5(p.notes) === md5(d.notes);
    const samePublished = p.is_published === d.is_published;
    const sameVideo = (p.wistia_video_id ?? null) === (d.wistia_video_id ?? null);
    if (sameNotes && samePublished && sameVideo) identical.push(d.slug);
    else toUpdate.push(d);
  }
  for (const p of prod) if (!devMap.has(p.slug)) prodOnly.push(p.slug);

  console.log("=== DIFF ===");
  console.log("dev rows:                ", dev.length);
  console.log("prod rows:               ", prod.length);
  console.log("would update:            ", toUpdate.length);
  console.log("already identical:       ", identical.length);
  console.log("dev-only (skipped):      ", devOnly.length, devOnly);
  console.log("prod-only (left alone):  ", prodOnly.length, prodOnly);
  console.log("first 10 slugs to update:", toUpdate.slice(0, 10).map((r) => r.slug));

  if (!apply) {
    console.log("\nDry run. Pass --apply to write changes to production.");
    return;
  }

  const prodClient = new Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
  await prodClient.connect();
  await prodClient.query("BEGIN");
  try {
    for (const u of toUpdate) {
      await prodClient.query(
        "UPDATE lessons SET notes = $1, is_published = $2, wistia_video_id = $3 WHERE slug = $4",
        [u.notes, u.is_published, u.wistia_video_id, u.slug],
      );
    }
    await prodClient.query("COMMIT");
  } catch (e) {
    await prodClient.query("ROLLBACK");
    await prodClient.end();
    throw e;
  }

  // Verify
  const verify = await prodClient.query<Row>(
    "SELECT slug, notes, is_published, wistia_video_id FROM lessons",
  );
  await prodClient.end();
  const verifyMap = new Map(verify.rows.map((r) => [r.slug, r]));
  const mismatches: string[] = [];
  for (const d of dev) {
    if (!prodMap.has(d.slug)) continue;
    const v = verifyMap.get(d.slug)!;
    if (
      md5(v.notes) !== md5(d.notes) ||
      v.is_published !== d.is_published ||
      (v.wistia_video_id ?? null) !== (d.wistia_video_id ?? null)
    ) {
      mismatches.push(d.slug);
    }
  }

  const summary = {
    updated: toUpdate.length,
    unchanged: identical.length,
    devOnly,
    prodOnly,
    postSyncMismatches: mismatches,
  };
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
