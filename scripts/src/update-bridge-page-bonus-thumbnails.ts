/**
 * Task #747 - Fix Bridge Pages bonus thumbnails.
 *
 * The five bonus rows on /members/dfy/bridge-pages render with broken
 * images because their `preview_image_url` values are stale Google
 * Drive hotlinks that now 403/404. This script:
 *
 *   1. Uploads the five attached Bonus_*.png assets to the same GCS
 *      bucket the portal serves at /api/portal/images/<file>, using
 *      deterministic filenames so re-runs overwrite the same object.
 *   2. UPDATEs `dfy_bridge_pages.preview_image_url` for each row with
 *      a matching `bonus_number` (1..5) to the new served URL.
 *
 * Idempotent. Logs the before/after URL for each row. No-ops cleanly
 * when a bonus row is missing and reports which numbers were skipped.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run fix:bridge-page-bonus-thumbnails             (dry-run)
 *   pnpm --filter @workspace/scripts run fix:bridge-page-bonus-thumbnails -- --apply  (write)
 *
 * Against prod, set DATABASE_URL=$PROD_DATABASE_URL in front. The GCS
 * upload always targets the bucket configured by
 * DEFAULT_OBJECT_STORAGE_BUCKET_ID / PRIVATE_OBJECT_DIR in the current
 * environment (shared between dev and prod in this project).
 */

import { eq } from "drizzle-orm";
import { db, dfyBridgePagesTable } from "@workspace/db";
import { objectStorageClient } from "../../artifacts/api-server/src/lib/objectStorage";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.resolve(__dirname, "../../attached_assets");

const BONUSES: Array<{ bonusNumber: number; file: string }> = [
  { bonusNumber: 1, file: "Bonus_1_1779714175679.png" },
  { bonusNumber: 2, file: "Bonus_2_1779714175684.png" },
  { bonusNumber: 3, file: "Bonus_3_1779714175684.png" },
  { bonusNumber: 4, file: "Bonus_4_1779714175685.png" },
  { bonusNumber: 5, file: "Bonus_5_1779714175685.png" },
];

async function uploadBonusImage(bonusNumber: number, sourcePath: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error(
      "Object storage not configured (need DEFAULT_OBJECT_STORAGE_BUCKET_ID + PRIVATE_OBJECT_DIR)",
    );
  }
  const fileName = `dfy-bridge-page-bonus-${bonusNumber}-t747.png`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  const buf = fs.readFileSync(sourcePath);
  await file.save(buf, {
    contentType: "image/png",
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  return `/api/portal/images/${fileName}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[task-747] mode=${apply ? "APPLY" : "DRY-RUN"}`);

  const missing: number[] = [];
  let updated = 0;
  let alreadyClean = 0;

  for (const { bonusNumber, file } of BONUSES) {
    const sourcePath = path.join(ASSETS_DIR, file);
    if (!fs.existsSync(sourcePath)) {
      console.warn(`[task-747] bonus #${bonusNumber}: source asset not found at ${sourcePath}, skipping`);
      missing.push(bonusNumber);
      continue;
    }

    const rows = await db
      .select({
        id: dfyBridgePagesTable.id,
        title: dfyBridgePagesTable.title,
        previewImageUrl: dfyBridgePagesTable.previewImageUrl,
      })
      .from(dfyBridgePagesTable)
      .where(eq(dfyBridgePagesTable.bonusNumber, bonusNumber));

    if (rows.length === 0) {
      console.warn(`[task-747] bonus #${bonusNumber}: no dfy_bridge_pages row found, skipping`);
      missing.push(bonusNumber);
      continue;
    }

    let newUrl: string;
    if (apply) {
      newUrl = await uploadBonusImage(bonusNumber, sourcePath);
      console.log(`[task-747] bonus #${bonusNumber}: uploaded asset -> ${newUrl}`);
    } else {
      newUrl = `/api/portal/images/dfy-bridge-page-bonus-${bonusNumber}-t747.png`;
      console.log(`[task-747] bonus #${bonusNumber}: would upload asset -> ${newUrl}`);
    }

    for (const row of rows) {
      const before = row.previewImageUrl;
      if (before === newUrl) {
        console.log(`[task-747]   row id=${row.id} "${row.title}": already clean (${before})`);
        alreadyClean++;
        continue;
      }
      console.log(`[task-747]   row id=${row.id} "${row.title}":`);
      console.log(`[task-747]     before: ${before ?? "(null)"}`);
      console.log(`[task-747]     after:  ${newUrl}`);
      if (apply) {
        await db
          .update(dfyBridgePagesTable)
          .set({ previewImageUrl: newUrl, updatedAt: new Date() })
          .where(eq(dfyBridgePagesTable.id, row.id));
      }
      updated++;
    }
  }

  console.log(
    `[task-747] done apply=${apply} updated=${updated} alreadyClean=${alreadyClean} missingBonuses=[${missing.join(",")}]`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[task-747] failed", err);
  process.exit(1);
});
