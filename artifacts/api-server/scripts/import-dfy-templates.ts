/* eslint-disable no-console */
// One-shot CLI driver for the DFY template library importer.
//
// All the heavy lifting (CSV parsing, manifest join, zip extraction,
// object-storage upload, idempotent upsert) lives in the shared
// importer module so the admin "re-import CSV" endpoint can reuse it.
//
// Run: pnpm --filter @workspace/api-server exec tsx scripts/import-dfy-templates.ts
// Or:  pnpm --filter @workspace/api-server exec tsx scripts/import-dfy-templates.ts --assets ./attached_assets --only ad_swipe --limit 200

import { runImportForCategory, type ImportReport } from "../src/lib/dfy-template-importer";
import { db } from "@workspace/db";
import { dfyTemplatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve <repo-root>/attached_assets relative to this file so the
// script works no matter what CWD it's invoked from (workspace root,
// scripts/, api-server/, etc.). This file lives at
// artifacts/api-server/scripts/import-dfy-templates.ts, so the repo
// root is three levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ASSETS_DIR = (() => {
  const idx = process.argv.indexOf("--assets");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return resolve(REPO_ROOT, "attached_assets");
})();

const ONLY = (() => {
  const idx = process.argv.indexOf("--only");
  return idx >= 0 ? process.argv[idx + 1] || null : null;
})();

const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  if (idx < 0) return undefined;
  const n = Number(process.argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();

if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || !process.env.PRIVATE_OBJECT_DIR) {
  console.error(
    "DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set.",
  );
  process.exit(1);
}

async function main() {
  const targets = ONLY
    ? ONLY.split(",").map((s) => s.trim()).filter(Boolean)
    : ["all"];
  const reports: ImportReport[] = [];
  for (const target of targets) {
    const sub = await runImportForCategory(target, {
      assetsDir: ASSETS_DIR,
      limit: LIMIT,
    });
    for (const r of sub) reports.push(r);
  }

  console.log("\n========= IMPORT REPORT =========");
  for (const r of reports) {
    console.log(
      `${r.category.padEnd(22)} inserted/updated=${r.inserted + r.updated} (new=${r.inserted}, upd=${r.updated}) skipped=${r.skipped} missingImage=${r.missingImage.length} failedDownload=${r.failedDownload.length}`,
    );
    if (r.missingImage.length) {
      console.log(`  missing image (first 5): ${r.missingImage.slice(0, 5).join(", ")}`);
    }
    if (r.failedDownload.length) {
      console.log(`  failed download (first 5): ${r.failedDownload.slice(0, 5).join(", ")}`);
    }
  }

  // Sanity totals from the DB.
  const totals = await db
    .select({ category: dfyTemplatesTable.category, n: sql<number>`count(*)::int` })
    .from(dfyTemplatesTable)
    .groupBy(dfyTemplatesTable.category);
  console.log("\nDB totals:");
  for (const t of totals) console.log(`  ${t.category.padEnd(22)} ${t.n}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[main]", err);
  process.exit(1);
});
