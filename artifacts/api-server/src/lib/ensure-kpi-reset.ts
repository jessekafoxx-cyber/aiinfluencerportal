import { db, userAssetsTable, osToolGenerationJobsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Idempotent reset: removes any saved "KPI Dashboard" assets and any completed
 * kpi-generator generation jobs whose content was produced under the old
 * 9-section dashboard format (i.e. does NOT contain the new ".kpi-grid"
 * marker class). Once a user regenerates under the new format, the new
 * content has the marker and will not be re-deleted.
 */
export async function ensureKpiReset(): Promise<void> {
  try {
    const deletedAssets = await db
      .delete(userAssetsTable)
      .where(and(
        eq(userAssetsTable.category, "marketing-assets"),
        eq(userAssetsTable.title, "KPI Dashboard"),
        sql`${userAssetsTable.content} NOT LIKE '%kpi-grid%'`,
      ))
      .returning({ id: userAssetsTable.id });

    const deletedJobs = await db
      .delete(osToolGenerationJobsTable)
      .where(and(
        eq(osToolGenerationJobsTable.slug, "kpi-generator"),
        sql`(${osToolGenerationJobsTable.content} IS NULL OR ${osToolGenerationJobsTable.content} NOT LIKE '%kpi-grid%')`,
      ))
      .returning({ id: osToolGenerationJobsTable.id });

    logger.info(
      { deletedAssets: deletedAssets.length, deletedJobs: deletedJobs.length },
      "ensureKpiReset: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureKpiReset: failed");
  }
}
