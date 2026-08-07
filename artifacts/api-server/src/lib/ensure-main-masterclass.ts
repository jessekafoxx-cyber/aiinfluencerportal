import { db, coursePhasesTable, lessonsTable, lessonProgressTable } from "@workspace/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { MASTERCLASS_PHASE, MASTERCLASS_LESSONS } from "./masterclass-course-data";

const PORTAL_KEY = "room30";

// Boot hook: the portal serves ONE main masterclass whose 8 lessons come
// from the attached "AI Influencer Masterclass" course doc. Idempotent:
//  - upserts the single "Masterclass" phase
//  - inserts any missing lessons (existing rows are left alone so admin
//    edits to notes / wistia_video_id are never clobbered on boot)
//  - removes any other room30 phases/lessons left over from the old course
export async function ensureMainMasterclass(): Promise<void> {
  try {
    // 1. Upsert the phase.
    let [phase] = await db
      .select()
      .from(coursePhasesTable)
      .where(
        and(
          eq(coursePhasesTable.slug, MASTERCLASS_PHASE.slug),
          eq(coursePhasesTable.portalKey, PORTAL_KEY),
        ),
      );
    if (!phase) {
      [phase] = await db
        .insert(coursePhasesTable)
        .values({
          slug: MASTERCLASS_PHASE.slug,
          title: MASTERCLASS_PHASE.title,
          description: null,
          sortOrder: MASTERCLASS_PHASE.sort_order,
          portalKey: PORTAL_KEY,
        })
        .returning();
      logger.info("ensureMainMasterclass: phase inserted");
    }

    // 1b. Reconcile kept lessons onto the canonical phase so deleting
    // stale phases below can never orphan a lesson we keep.
    const keepSlugList = MASTERCLASS_LESSONS.map((l) => l.slug);
    await db
      .update(lessonsTable)
      .set({ phaseId: phase.id })
      .where(
        and(eq(lessonsTable.portalKey, PORTAL_KEY), inArray(lessonsTable.slug, keepSlugList)),
      );

    // 2. Insert missing lessons.
    const keepSlugs = MASTERCLASS_LESSONS.map((l) => l.slug);
    const existing = await db
      .select({ slug: lessonsTable.slug })
      .from(lessonsTable)
      .where(eq(lessonsTable.portalKey, PORTAL_KEY));
    const existingSlugs = new Set(existing.map((r) => r.slug));

    let inserted = 0;
    for (const seed of MASTERCLASS_LESSONS) {
      if (existingSlugs.has(seed.slug)) continue;
      await db.insert(lessonsTable).values({
        slug: seed.slug,
        phaseId: phase.id,
        title: seed.title,
        sortOrder: seed.sort_order,
        notes: seed.notes,
        wistiaVideoId: seed.wistia_video_id ?? null,
        portalKey: PORTAL_KEY,
      });
      inserted++;
    }

    // 3. Remove old-course leftovers (lessons first, then empty phases).
    const stale = await db
      .select({ id: lessonsTable.id, slug: lessonsTable.slug })
      .from(lessonsTable)
      .where(
        and(eq(lessonsTable.portalKey, PORTAL_KEY), notInArray(lessonsTable.slug, keepSlugs)),
      );
    if (stale.length > 0) {
      const staleIds = stale.map((r) => r.id);
      await db.delete(lessonProgressTable).where(inArray(lessonProgressTable.lessonId, staleIds));
      await db.delete(lessonsTable).where(inArray(lessonsTable.id, staleIds));
      logger.info({ removed: stale.map((r) => r.slug) }, "ensureMainMasterclass: stale lessons removed");
    }
    // Only delete phases that no remaining lesson still points at.
    const referencedPhaseIds = (
      await db
        .select({ phaseId: lessonsTable.phaseId })
        .from(lessonsTable)
        .where(eq(lessonsTable.portalKey, PORTAL_KEY))
    ).map((r) => r.phaseId);
    const stalePhaseFilter = and(
      eq(coursePhasesTable.portalKey, PORTAL_KEY),
      notInArray(coursePhasesTable.slug, [MASTERCLASS_PHASE.slug]),
      ...(referencedPhaseIds.length > 0
        ? [notInArray(coursePhasesTable.id, referencedPhaseIds)]
        : []),
    );
    await db.delete(coursePhasesTable).where(stalePhaseFilter);

    logger.info({ inserted, total: keepSlugs.length }, "ensureMainMasterclass: done");
  } catch (err) {
    logger.error({ err }, "ensureMainMasterclass failed");
  }
}
