import { Storage } from "@google-cloud/storage";
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const target = process.env.PRIVATE_OBJECT_DIR; // "/<bucket>/.private"
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});
const bucket = storage.bucket(bucketId);
const [files] = await bucket.getFiles({ prefix: ".private/" });
console.log("to rename:", files.length);
let n = 0;
const queue = [...files];
await Promise.all(Array.from({ length: 16 }, async () => {
  while (queue.length) {
    const f = queue.pop();
    const name = f.name.slice(".private/".length);
    await f.move(`${target}/${name}`);
    if (++n % 500 === 0) console.log("renamed", n);
  }
}));
console.log("DONE", n);
