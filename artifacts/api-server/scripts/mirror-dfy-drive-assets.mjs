// Mirrors the 650 DFY drive assets (100-ai-influencers + 250-scenes) from
// their public Google Drive files into this project's object storage, using
// the exact original/thumb object keys already present in dfy_drive_assets.
// Thumbs are regenerated locally (600px webp q78, same as the importer).
// Resumable: objects already present in the bucket are skipped.
import { readFileSync, appendFileSync } from "node:fs";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const privateDir = process.env.PRIVATE_OBJECT_DIR; // "/<bucket>/.private" — keys include this verbatim
if (!bucketId || !privateDir) throw new Error("object storage env not set");

const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});
const bucket = storage.bucket(bucketId);

const rows = JSON.parse(readFileSync("/tmp/dfy/DFY-Pack-Portal-Export/data/dfy_drive_assets_full.json", "utf8"))
  .filter((r) => r.is_active && r.original_object_key && r.thumb_object_key);
console.log("assets to mirror:", rows.length);

const existing = new Set();
const [files] = await bucket.getFiles({ prefix: `${privateDir}/dfy/drive/` });
for (const f of files) existing.add(f.name);
console.log("already in bucket:", existing.size);

async function fetchDrive(fileId) {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) { lastErr = new Error("got html (scan page?)"); continue; }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr;
}

let done = 0, skipped = 0, failed = 0;
const queue = [...rows];
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);
async function worker() {
  while (queue.length) {
    const r = queue.pop();
    const origKey = `${privateDir}/${r.original_object_key}`;
    const thumbKey = `${privateDir}/${r.thumb_object_key}`;
    const needOrig = !existing.has(origKey);
    const needThumb = !existing.has(thumbKey);
    if (!needOrig && !needThumb) { skipped++; continue; }
    try {
      const buf = await withTimeout(fetchDrive(r.drive_file_id), 420_000, "download");
      if (needOrig) {
        await withTimeout(
          bucket.file(origKey).save(buf, {
            contentType: r.mime_type || "application/octet-stream",
            resumable: buf.length > 8 * 1024 * 1024,
          }),
          300_000,
          "upload-orig",
        );
      }
      if (needThumb) {
        const thumb = await sharp(buf, { failOn: "none" })
          .rotate()
          .resize({ width: 600, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        await withTimeout(
          bucket.file(thumbKey).save(thumb, { contentType: "image/webp", resumable: false }),
          120_000,
          "upload-thumb",
        );
      }
      done++;
    } catch (e) {
      failed++;
      appendFileSync("/tmp/dfy-drive-mirror-failed.log", `${r.slug}/${r.drive_file_id} (${r.name}): ${e.message}\n`);
    }
    if ((done + skipped + failed) % 25 === 0) {
      console.log(`progress: ${done + skipped + failed}/${rows.length} (done=${done} skipped=${skipped} failed=${failed})`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`FINISHED. done=${done} skipped=${skipped} failed=${failed}`);
if (failed > 0) process.exitCode = 1;
