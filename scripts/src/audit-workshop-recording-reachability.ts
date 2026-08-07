/**
 * Task #774 - Audit: published workshop recordings with unreachable Wistia media.
 *
 * Read-only. A published recording whose wistia_media_id is typo'd / deleted
 * renders a dead player for every Platinum member. This script probes the
 * public Wistia media metadata endpoint (GET, read-only) for each published
 * recording and reports the ones that fail.
 *
 *   pnpm --filter @workspace/scripts run audit:workshop-reachability
 *   pnpm --filter @workspace/scripts run audit:workshop-reachability -- --all   # include unpublished
 *
 * Connection: uses PROD_DATABASE_URL if set, else DATABASE_URL. Both safe -
 * this script only runs SELECTs. No DB writes.
 */

import { Client } from "pg";

async function isReachable(mediaId: string): Promise<boolean> {
  const id = String(mediaId ?? "").trim();
  if (!id) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://fast.wistia.com/embed/medias/${encodeURIComponent(id)}.json`,
      { signal: controller.signal },
    );
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Set PROD_DATABASE_URL (preferred for live audits) or DATABASE_URL",
    );
    process.exit(1);
  }
  const includeAll = process.argv.includes("--all");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, title, wistia_media_id, published_at
       FROM workshop_recordings
       ${includeAll ? "" : "WHERE published_at IS NOT NULL"}
       ORDER BY recorded_at DESC`,
    );
    console.log(
      `Checking ${result.rows.length} recording(s)${includeAll ? " (incl. unpublished)" : " (published only)"}...`,
    );
    const bad: Array<{ id: number; title: string; mediaId: string }> = [];
    for (const row of result.rows) {
      const mediaId = String(row.wistia_media_id ?? "").trim();
      const ok = await isReachable(mediaId);
      if (!ok) {
        bad.push({ id: row.id, title: row.title, mediaId });
      }
    }
    if (bad.length === 0) {
      console.log("All recordings have a reachable Wistia media id.");
    } else {
      console.log(`\n${bad.length} recording(s) with UNREACHABLE Wistia media:`);
      for (const b of bad) {
        console.log(`  id=${b.id}  media="${b.mediaId}"  ${b.title}`);
      }
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
