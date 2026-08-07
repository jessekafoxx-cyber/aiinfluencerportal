// One-off import of the DFY-Pack-Portal-Export JSON dumps into the dev DB.
// Inserts verbatim (keeps ids), skips tables that already have rows, and
// resets each table's id sequence afterwards.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DATA_DIR = "/tmp/dfy/DFY-Pack-Portal-Export/data";
const TABLES = [
  "dfy_templates",
  "dfy_drive_assets",
  "dfy_bridge_pages",
  "dfy_advertorial_pages",
  "dfy_background_tracks",
  "dfy_build_assets",
  "dfy_highlight_covers",
  // dfy_scripts intentionally skipped — code-seeded and already in sync (1634 rows)
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const table of TABLES) {
  const file = path.join(DATA_DIR, `${table}_full.json`);
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows)) { console.log(`${table}: not an array, skipping`); continue; }
  const { rows: [{ c }] } = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
  if (c > 0) { console.log(`${table}: already has ${c} rows, skipping`); continue; }
  if (rows.length === 0) { console.log(`${table}: 0 rows in export, nothing to do`); continue; }

  const { rows: colRows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  const dbCols = new Set(colRows.map((r) => r.column_name));
  const jsonCols = Object.keys(rows[0]);
  const cols = jsonCols.filter((k) => dbCols.has(k));
  const missing = jsonCols.filter((k) => !dbCols.has(k));
  if (missing.length) console.log(`${table}: export columns not in DB (dropped): ${missing.join(", ")}`);

  await client.query("BEGIN");
  try {
    const colSql = cols.map((c2) => `"${c2}"`).join(",");
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let p = 1;
      for (const row of batch) {
        const ph = [];
        for (const c2 of cols) {
          let v = row[c2];
          if (v !== null && typeof v === "object") v = JSON.stringify(v);
          params.push(v);
          ph.push(`$${p++}`);
        }
        values.push(`(${ph.join(",")})`);
      }
      await client.query(`INSERT INTO ${table} (${colSql}) VALUES ${values.join(",")}`, params);
    }
    if (dbCols.has("id")) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}','id'), (SELECT COALESCE(MAX(id),1) FROM ${table}))`,
      );
    }
    await client.query("COMMIT");
    console.log(`${table}: imported ${rows.length} rows`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`${table}: FAILED — ${e.message}`);
  }
}
await client.end();
