import { db, lessonsTable, lessonProgressTable, userAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const REMOVED_SLUG = "r30-p5-direct-sales-campaign";

export async function ensureDirectSalesLessonRemoved(): Promise<void> {
  try {
    const [lesson] = await db
      .select()
      .from(lessonsTable)
      .where(eq(lessonsTable.slug, REMOVED_SLUG));

    if (lesson) {
      await db
        .delete(lessonProgressTable)
        .where(eq(lessonProgressTable.lessonId, lesson.id));
      await db
        .delete(userAssetsTable)
        .where(eq(userAssetsTable.lessonSlug, REMOVED_SLUG));
      await db.delete(lessonsTable).where(eq(lessonsTable.id, lesson.id));
      logger.info(
        { lessonId: lesson.id, slug: REMOVED_SLUG, phaseId: lesson.phaseId },
        "ensureDirectSalesLessonRemoved: deleted direct sales campaign lesson",
      );
    }

    logger.info("ensureDirectSalesLessonRemoved: done");
  } catch (err) {
    logger.error({ err }, "ensureDirectSalesLessonRemoved: failed");
  }
}
