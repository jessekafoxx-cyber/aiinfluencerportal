// Task #742 one-shot backfill.
//
// Rewrites `dfy_bridge_pages.preview_image_url` in place for every row
// whose stored value is a Google Drive share URL, replacing it with
// the direct-image CDN URL that the `<img>` tag can actually render.
// Also stamps `https://` on bare-host `url` / `download_url` values so
// the Preview / Download buttons stop landing on the portal's own 404.
//
// Idempotent + dry-run by default. Re-run with `--apply` to write.
//
//   pnpm --filter @workspace/scripts exec tsx ./src/normalize-bridge-page-drive-urls.ts
//   pnpm --filter @workspace/scripts exec tsx ./src/normalize-bridge-page-drive-urls.ts --apply
//
// Run against prod with `DATABASE_URL=$PROD_DATABASE_URL` in front.

import { db, dfyBridgePagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  normalizeDriveImageUrl,
  ensureAbsoluteUrl,
} from "../../artifacts/api-server/src/lib/drive-image-url";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({
      id: dfyBridgePagesTable.id,
      title: dfyBridgePagesTable.title,
      url: dfyBridgePagesTable.url,
      downloadUrl: dfyBridgePagesTable.downloadUrl,
      previewImageUrl: dfyBridgePagesTable.previewImageUrl,
    })
    .from(dfyBridgePagesTable);

  let touched = 0;
  for (const r of rows) {
    const nextPreview = normalizeDriveImageUrl(r.previewImageUrl);
    const nextUrl = ensureAbsoluteUrl(r.url) ?? r.url;
    const nextDownload = ensureAbsoluteUrl(r.downloadUrl);

    const previewChanged = (r.previewImageUrl || null) !== (nextPreview || null);
    const urlChanged = (r.url || null) !== (nextUrl || null);
    const downloadChanged = (r.downloadUrl || null) !== (nextDownload || null);
    if (!previewChanged && !urlChanged && !downloadChanged) continue;

    touched += 1;
    console.log(`[${APPLY ? "APPLY" : "DRY"}] #${r.id} ${r.title}`);
    if (previewChanged) {
      console.log(`  previewImageUrl: ${r.previewImageUrl} -> ${nextPreview}`);
    }
    if (urlChanged) console.log(`  url: ${r.url} -> ${nextUrl}`);
    if (downloadChanged) {
      console.log(`  downloadUrl: ${r.downloadUrl} -> ${nextDownload}`);
    }

    if (APPLY) {
      await db
        .update(dfyBridgePagesTable)
        .set({
          previewImageUrl: nextPreview,
          url: nextUrl,
          downloadUrl: nextDownload,
          updatedAt: new Date(),
        })
        .where(eq(dfyBridgePagesTable.id, r.id));
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"} updates to ${touched} of ${rows.length} rows.`,
  );
  if (!APPLY && touched > 0) {
    console.log("Re-run with --apply to persist.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
