import { readFileSync } from "node:fs";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
const privateDir = process.env.PRIVATE_OBJECT_DIR;
const storage = new Storage({credentials:{audience:"replit",subject_token_type:"access_token",token_url:"http://127.0.0.1:1106/token",type:"external_account",credential_source:{url:"http://127.0.0.1:1106/credential",format:{type:"json",subject_token_field_name:"access_token"}},universe_domain:"googleapis.com"},projectId:""});
const bucket = storage.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
const rows = JSON.parse(readFileSync("/tmp/dfy/DFY-Pack-Portal-Export/data/dfy_drive_assets_full.json","utf8"));
const ids = process.argv.slice(2);
for (const fid of ids) {
  const r = rows.find(x => x.drive_file_id === fid);
  if (!r) { console.log("no row", fid); continue; }
  const res = await fetch(`https://drive.usercontent.google.com/download?id=${fid}&export=download&confirm=t`, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!res.ok || (res.headers.get("content-type")||"").includes("text/html")) { console.log("FAIL fetch", fid, res.status); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  await bucket.file(`${privateDir}/${r.original_object_key}`).save(buf, { contentType: r.mime_type || "application/octet-stream" });
  const thumb = await sharp(buf,{failOn:"none"}).rotate().resize({width:600,withoutEnlargement:true}).webp({quality:78}).toBuffer();
  await bucket.file(`${privateDir}/${r.thumb_object_key}`).save(thumb, { contentType: "image/webp" });
  console.log("uploaded", fid, r.name, buf.length);
}
