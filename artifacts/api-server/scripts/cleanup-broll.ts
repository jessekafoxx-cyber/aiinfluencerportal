/* eslint-disable no-console */
// One-shot recovery tool used during T398 to wipe the bogus rows + the
// misplaced GCS objects produced by the buggy first run of the importer
// (object names included the bucket prefix, so they were unreachable).
//
// Hard-destructive: deletes every object under the broken GCS prefix
// AND truncates dfy_broll_clips. Requires explicit --confirm to run,
// and refuses to truncate the table unless --truncate is also passed.
//
// Examples (intentionally verbose):
//   pnpm exec tsx scripts/cleanup-broll.ts --confirm           # delete bad GCS objects only
//   pnpm exec tsx scripts/cleanup-broll.ts --confirm --truncate # also TRUNCATE dfy_broll_clips
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { objectStorageClient } from "../src/lib/objectStorage";

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const TRUNCATE = argv.includes("--truncate");

async function main() {
  if (!CONFIRM) {
    console.error(
      "REFUSING TO RUN: this script is destructive. Pass --confirm to delete the\n" +
        "broken GCS objects under '/<bucket>/.private/dfy-broll/...'. Pass\n" +
        "--truncate as well to also TRUNCATE the dfy_broll_clips table.",
    );
    process.exit(2);
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    console.error("DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must be set.");
    process.exit(1);
  }
  const bucket = objectStorageClient.bucket(bucketId);
  // The bug stored objects under "/<bucket>/.private/dfy-broll/..."
  // (note the leading slash + bucket name baked into the object name).
  // We scope the delete to exactly that prefix - never the modern
  // ".private/dfy-broll/..." prefix where good objects live.
  const badPrefix = (privateDir.startsWith("/") ? "" : "/") + privateDir + "/dfy-broll/";
  if (!badPrefix.startsWith(`/${bucketId}/`)) {
    console.error(`refusing: computed prefix '${badPrefix}' does not start with '/${bucketId}/'`);
    process.exit(1);
  }
  console.log("listing GCS bad prefix:", badPrefix);
  const [files] = await bucket.getFiles({ prefix: badPrefix });
  console.log("found", files.length);
  let n = 0;
  const CONC = 20;
  let i = 0;
  async function w() {
    while (true) {
      const idx = i++;
      if (idx >= files.length) return;
      try {
        await files[idx].delete({ ignoreNotFound: true });
      } catch {}
      n++;
      if (n % 50 === 0) console.log("deleted", n, "/", files.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => w()));
  console.log("done deleting", n);
  if (TRUNCATE) {
    await db.execute(sql`DELETE FROM dfy_broll_clips`);
    console.log("db rows deleted");
  } else {
    console.log("skipping table truncate (pass --truncate to wipe dfy_broll_clips)");
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
