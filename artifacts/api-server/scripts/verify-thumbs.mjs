import { Storage } from "@google-cloud/storage";
import pg from "pg";
const storage = new Storage({credentials:{audience:"replit",subject_token_type:"access_token",token_url:"http://127.0.0.1:1106/token",type:"external_account",credential_source:{url:"http://127.0.0.1:1106/credential",format:{type:"json",subject_token_field_name:"access_token"}},universe_domain:"googleapis.com"},projectId:""});
const bucket = storage.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query("SELECT slug, thumb_object_key, original_object_key FROM dfy_drive_assets WHERE is_active ORDER BY random() LIMIT 12");
let ok = 0, miss = 0;
for (const r of rows) {
  const [t] = await bucket.file(`${process.env.PRIVATE_OBJECT_DIR}/${r.thumb_object_key}`).exists();
  const [o] = await bucket.file(`${process.env.PRIVATE_OBJECT_DIR}/${r.original_object_key}`).exists();
  if (t && o) ok++; else { miss++; console.log("MISSING", r.slug, r.thumb_object_key, t, o); }
}
console.log(`sampled 12: ok=${ok} missing=${miss}`);
const { rows: sub } = await c.query("SELECT count(DISTINCT subfolder_drive_id) FROM dfy_drive_assets WHERE slug='250-scenes' AND subfolder_drive_id IS NOT NULL");
console.log("250-scenes subfolders:", sub[0].count);
await c.end();
