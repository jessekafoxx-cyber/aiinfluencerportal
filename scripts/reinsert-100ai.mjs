import fs from "node:fs";
import pg from "pg";
const rows = JSON.parse(fs.readFileSync("/tmp/dfy/DFY-Pack-Portal-Export/data/dfy_drive_assets_full.json","utf8")).filter(r=>r.slug==="100-ai-influencers");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cols = Object.keys(rows[0]);
await c.query("BEGIN");
for (const r of rows) {
  const vals = cols.map(k=>r[k]);
  const ph = cols.map((_,i)=>`$${i+1}`).join(",");
  await c.query(`INSERT INTO dfy_drive_assets (${cols.map(k=>`"${k}"`).join(",")}) VALUES (${ph}) ON CONFLICT (id) DO NOTHING`, vals);
}
await c.query("SELECT setval(pg_get_serial_sequence('dfy_drive_assets','id'), (SELECT MAX(id) FROM dfy_drive_assets))");
await c.query("COMMIT");
const { rows:[a] } = await c.query("SELECT count(*) FROM dfy_drive_assets WHERE slug='100-ai-influencers' AND is_active");
console.log("active 100-ai rows now:", a.count);
await c.end();
