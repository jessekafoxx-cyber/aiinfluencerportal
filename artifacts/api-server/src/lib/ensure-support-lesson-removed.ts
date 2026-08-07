import { db, lessonsTable, lessonProgressTable, userAssetsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

const ORPHAN_SLUG = "building-support-ai";
const PHASE_2_SLUG = "phase-2-creation-delivery-experience";
const EXPERIENCE_SLUG = "the-experience";
const EXPERIENCE_TARGET_SORT = 4;

export async function ensureSupportLessonRemoved(): Promise<void> {
  try {
    const [orphan] = await db
      .select()
      .from(lessonsTable)
      .where(eq(lessonsTable.slug, ORPHAN_SLUG));

    if (orphan) {
      await db
        .delete(lessonProgressTable)
        .where(eq(lessonProgressTable.lessonId, orphan.id));
      await db
        .delete(userAssetsTable)
        .where(eq(userAssetsTable.lessonSlug, ORPHAN_SLUG));
      await db.delete(lessonsTable).where(eq(lessonsTable.id, orphan.id));
      logger.info(
        { lessonId: orphan.id, slug: ORPHAN_SLUG, phaseId: orphan.phaseId },
        "ensureSupportLessonRemoved: deleted orphan support-ai lesson",
      );
    }

    const [experience] = await db
      .select()
      .from(lessonsTable)
      .where(eq(lessonsTable.slug, EXPERIENCE_SLUG));

    if (experience && experience.sortOrder !== EXPERIENCE_TARGET_SORT) {
      await db
        .update(lessonsTable)
        .set({ sortOrder: EXPERIENCE_TARGET_SORT })
        .where(eq(lessonsTable.id, experience.id));
      logger.info(
        {
          lessonId: experience.id,
          from: experience.sortOrder,
          to: EXPERIENCE_TARGET_SORT,
        },
        "ensureSupportLessonRemoved: bumped the-experience sortOrder",
      );
    }

    logger.info("ensureSupportLessonRemoved: done");
  } catch (err) {
    logger.error({ err }, "ensureSupportLessonRemoved: failed");
  }
}
