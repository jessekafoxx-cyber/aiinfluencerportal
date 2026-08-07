import { db, dfyTemplatesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { DFY_TEMPLATE_BLOCKLIST } from "./dfy-template-importer";

// Boot-time companion to DFY_TEMPLATE_BLOCKLIST in
// dfy-template-importer.ts. The importer skips writes for blocked
// (category, sourceDisplayId) pairs, but any row already in the DB
// from a prior import would persist - this hook deletes those rows on
// every boot so the gallery reflects the current blocklist.
//
// Idempotent: a hard delete that no-ops when nothing matches. Cascades
// to dfy_template_favourites via the FK ON DELETE CASCADE, so any
// users who had favourited a now-blocked template lose only that
// favourite.
export async function ensureDfyTemplatesBlocklist(): Promise<void> {
  try {
    let removed = 0;
    for (const { category, sourceDisplayId } of DFY_TEMPLATE_BLOCKLIST) {
      const deleted = await db
        .delete(dfyTemplatesTable)
        .where(
          and(
            eq(dfyTemplatesTable.category, category),
            eq(dfyTemplatesTable.sourceDisplayId, sourceDisplayId),
          ),
        )
        .returning({ id: dfyTemplatesTable.id });
      if (deleted.length > 0) {
        removed += deleted.length;
        logger.info(
          { category, sourceDisplayId, ids: deleted.map((r) => r.id) },
          "ensureDfyTemplatesBlocklist: removed blocked template row",
        );
      }
    }
    logger.info(
      { removed, blocklistSize: DFY_TEMPLATE_BLOCKLIST.length },
      "ensureDfyTemplatesBlocklist: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureDfyTemplatesBlocklist: failed");
  }
}
