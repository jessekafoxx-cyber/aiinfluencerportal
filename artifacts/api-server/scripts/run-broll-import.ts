/* eslint-disable no-console */
// T317: One-shot CLI driver for the DFY 70K B-Roll bulk importer.
//
// All the heavy lifting (Drive enumeration, dedup-by-pack, streaming
// download, GCS upload, idempotent DB upsert) lives in the shared
// importer module. This script just runs it once and prints the
// final per-pack summary table to stdout. Safe to re-run: rows in
// 'imported' status are skipped, only failures retry.
//
// Run: pnpm --filter @workspace/api-server exec tsx scripts/run-broll-import.ts
// Or:  pnpm --filter @workspace/api-server exec tsx scripts/run-broll-import.ts --limit 50

import { runBrollImport, BROLL_DRIVE_PACKS } from "../src/lib/dfy-broll-importer";
import { db, dfyBrollClipsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  if (idx < 0) return undefined;
  const n = Number(process.argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();

async function main() {
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !process.env.PRIVATE_OBJECT_DIR) {
    console.error("DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set.");
    process.exit(1);
  }

  console.log(`broll-import: starting${LIMIT ? ` (limit=${LIMIT})` : ""}`);
  const t0 = Date.now();
  const report = await runBrollImport({ limit: LIMIT });
  const elapsedMs = Date.now() - t0;

  const gb = (report.bytesUploaded / 1024 / 1024 / 1024).toFixed(2);
  console.log("\n========= BROLL IMPORT REPORT =========");
  console.log(`unique discovered: ${report.uniqueDiscovered}`);
  console.log(`imported: ${report.imported}  skipped: ${report.skipped}  failed: ${report.failed}`);
  console.log(`bytes uploaded: ${report.bytesUploaded} (${gb} GiB)`);
  console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  console.log("\n--- per pack discovered ---");
  for (const { pack } of BROLL_DRIVE_PACKS) {
    const n = report.perPackDiscovered[pack] ?? 0;
    console.log(`  pack ${String(pack).padStart(2, "0")}: ${n}`);
  }

  if (report.failures.length) {
    console.log("\n--- failures ---");
    for (const f of report.failures.slice(0, 50)) {
      console.log(`  ${f.driveFileId}: ${f.reason}`);
    }
    if (report.failures.length > 50) {
      console.log(`  ... and ${report.failures.length - 50} more`);
    }
  }

  // Sanity totals from the DB: rows per pack (using array unnest).
  const perPack = await db.execute(sql`
    SELECT pack::int AS pack, COUNT(*)::int AS n
    FROM "dfy_broll_clips", unnest(pack_numbers) AS pack
    WHERE status = 'imported'
    GROUP BY pack
    ORDER BY pack
  `);
  console.log("\n--- DB rows per pack (status=imported) ---");
  for (const row of perPack.rows as Array<{ pack: number; n: number }>) {
    console.log(`  pack ${String(row.pack).padStart(2, "0")}: ${row.n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  });
