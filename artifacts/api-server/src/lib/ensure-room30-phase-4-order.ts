import { db, coursePhasesTable, lessonsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

const ROOM30_P4_PHASE_SLUG = "room30-p4-creating-content";
const ROOM30_PORTAL_KEY = "room30";

const ROOM30_PHASE_4_LESSON_ORDER: Array<{ slug: string; sortOrder: number }> = [
  { slug: "r30-p4-intro-types-of-content",        sortOrder: 0 },
  { slug: "r30-p4-setting-up-social-media",       sortOrder: 1 },
  { slug: "r30-p4-setting-up-manychat",           sortOrder: 2 },
  { slug: "r30-p4-creating-green-screen",         sortOrder: 3 },
  { slug: "r30-p4-creating-hook-demo",            sortOrder: 4 },
  { slug: "r30-p4-creating-podcast-clips",        sortOrder: 5 },
  { slug: "r30-p4-creating-speaking-clips",       sortOrder: 6 },
  { slug: "r30-p4-creating-selfie-yapping-clips", sortOrder: 7 },
  { slug: "r30-p4-creating-viral-slideshows",     sortOrder: 8 },
  { slug: "r30-p4-creating-viral-carousels",      sortOrder: 9 },
  { slug: "r30-p4-creating-overlay-clips",        sortOrder: 10 },
  { slug: "r30-p4-creating-fastmotion-clips",     sortOrder: 11 },
];

export async function ensureRoom30Phase4Order(): Promise<void> {
  try {
    const [phase] = await db
      .select()
      .from(coursePhasesTable)
      .where(
        and(
          eq(coursePhasesTable.slug, ROOM30_P4_PHASE_SLUG),
          eq(coursePhasesTable.portalKey, ROOM30_PORTAL_KEY),
        ),
      );

    if (!phase) {
      logger.warn("ensureRoom30Phase4Order: phase row missing");
      return;
    }

    let updated = 0;
    for (const target of ROOM30_PHASE_4_LESSON_ORDER) {
      const [existing] = await db
        .select()
        .from(lessonsTable)
        .where(
          and(
            eq(lessonsTable.slug, target.slug),
            eq(lessonsTable.phaseId, phase.id),
            eq(lessonsTable.portalKey, ROOM30_PORTAL_KEY),
          ),
        );
      if (!existing) continue;
      if (existing.sortOrder === target.sortOrder) continue;
      await db
        .update(lessonsTable)
        .set({ sortOrder: target.sortOrder })
        .where(eq(lessonsTable.id, existing.id));
      updated++;
      logger.info(
        { slug: target.slug, from: existing.sortOrder, to: target.sortOrder },
        "ensureRoom30Phase4Order: lesson reordered",
      );
    }

    logger.info({ phaseId: phase.id, updated }, "ensureRoom30Phase4Order: done");
  } catch (err) {
    logger.error({ err }, "ensureRoom30Phase4Order: failed");
  }
}
