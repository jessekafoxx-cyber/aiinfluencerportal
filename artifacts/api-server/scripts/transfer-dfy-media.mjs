// Streams every DFY template media file from the live room30.ai portal
// directly into this project's object storage bucket (no local disk copy).
// Resumable: existing objects are skipped. Run from repo root:
//   node scripts/transfer-dfy-media.mjs
import { readFileSync, appendFileSync } from "node:fs";
import { Storage } from "@google-cloud/storage";

const BASE = "https://room30.ai";
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const privateDir = (process.env.PRIVATE_OBJECT_DIR || "").replace(/^\/[^/]+\//, "").replace(/\/$/, "");
if (!bucketId || !privateDir) throw new Error("object storage env not set");

// Replit sidecar auth (mirrors artifacts/api-server/src/lib/objectStorage.ts)
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const bucket = storage.bucket(bucketId);

const rows = JSON.parse(readFileSync("/tmp/dfy/DFY-Pack-Portal-Export/data/dfy_templates_full.json", "utf8"));
const names = new Set();
for (const r of rows) {
  for (const u of [r.image_url, r.poster_url]) {
    if (u && u.startsWith("/api/portal/images/")) names.add(u.slice("/api/portal/images/".length));
  }
}
console.log(`unique files: ${names.size}, target prefix: ${privateDir}/`);

// List existing objects once so resume is cheap
const existing = new Set();
const [files] = await bucket.getFiles({ prefix: `${privateDir}/` });
for (const f of files) existing.add(f.name.slice(privateDir.length + 1));
console.log(`already in bucket: ${existing.size}`);

let done = 0, skipped = 0, failed = 0;
const queue = [...names];
const CONCURRENCY = 12;
async function worker() {
  while (queue.length) {
    const name = queue.pop();
    if (existing.has(name)) { skipped++; continue; }
    try {
      let res = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          const r = await fetch(`${BASE}/api/portal/images/${encodeURIComponent(name)}`, {
            signal: AbortSignal.timeout(45_000),
          });
          if (r.ok) { res = r; break; }
          lastErr = new Error(`HTTP ${r.status}`);
        } catch (e) {
          lastErr = e;
        }
      }
      if (!res) throw lastErr;
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "application/octet-stream";
      await bucket.file(`${privateDir}/${name}`).save(buf, {
        contentType: ct,
        resumable: buf.length > 8 * 1024 * 1024,
      });
      done++;
    } catch (e) {
      failed++;
      appendFileSync("/tmp/dfy-transfer-failed.log", `${name}: ${e.message}\n`);
    }
    if ((done + skipped + failed) % 100 === 0) {
      console.log(`progress: ${done + skipped + failed}/${names.size} (done=${done} skipped=${skipped} failed=${failed})`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`FINISHED. done=${done} skipped=${skipped} failed=${failed}`);
