/* eslint-disable no-console */
// Task #534: One-shot CLI driver to repopulate the dfy_bridge_pages
// table from Greg's curated Google Sheet. Wraps the existing
// `syncBridgePagesFromSheet()` importer so we can re-seed the catalog
// without booting the full worker process or hitting the admin route.
//
// Run: pnpm --filter @workspace/api-server exec tsx scripts/run-bridge-pages-sync.ts
import { syncBridgePagesFromSheet } from "../src/lib/dfy-bridge-pages-importer";

async function main() {
  console.log("bridge-pages-sync: starting one-shot run");
  const t0 = Date.now();
  const r = await syncBridgePagesFromSheet();
  const ms = Date.now() - t0;
  console.log(JSON.stringify(r, null, 2));
  console.log(`done in ${ms}ms`);
  if (!r.ok) process.exit(1);
}

main().catch((err) => {
  console.error("bridge-pages-sync: fatal", err);
  process.exit(1);
});
