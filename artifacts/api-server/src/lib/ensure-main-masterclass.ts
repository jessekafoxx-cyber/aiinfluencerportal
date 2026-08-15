import { db, coursePhasesTable, lessonsTable, lessonProgressTable } from "@workspace/db";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { MASTERCLASS_PHASES, MASTERCLASS_LESSONS } from "./masterclass-course-data";

const PORTAL_KEY = "room30";

// Boot hook: seeds the AiIP Masterclass as 6 ordered steps with 29 lessons.
// Idempotent rules:
//  - Upserts each phase (inserts if missing; title/sort_order updated if changed)
//  - For each lesson:
//      • INSERT if slug does not exist yet
//      • UPDATE only phaseId + sortOrder + title on existing rows
//        (wistiaVideoId, notes, brief, actionTasks, promptTemplate are
//         deliberately NOT overwritten so admin edits survive restarts)
//  - Deletes any room30 lessons whose slugs are no longer in the canonical
//    list (progress rows removed first so FK constraints are satisfied)
//  - Deletes room30 phases that have no remaining lesson
export async function ensureMainMasterclass(): Promise<void> {
  try {
    // ── 1. Upsert all 6 phases ───────────────────────────────────────────────
    const phaseIdBySlug = new Map<string, number>();

    for (const phaseDef of MASTERCLASS_PHASES) {
      const [existing] = await db
        .select()
        .from(coursePhasesTable)
        .where(
          and(
            eq(coursePhasesTable.slug, phaseDef.slug),
            eq(coursePhasesTable.portalKey, PORTAL_KEY),
          ),
        );

      if (existing) {
        // Update title and sort_order in case they changed.
        await db
          .update(coursePhasesTable)
          .set({ title: phaseDef.title, sortOrder: phaseDef.sort_order })
          .where(eq(coursePhasesTable.id, existing.id));
        phaseIdBySlug.set(phaseDef.slug, existing.id);
      } else {
        const [inserted] = await db
          .insert(coursePhasesTable)
          .values({
            slug: phaseDef.slug,
            title: phaseDef.title,
            description: null,
            sortOrder: phaseDef.sort_order,
            portalKey: PORTAL_KEY,
          })
          .returning();
        phaseIdBySlug.set(phaseDef.slug, inserted.id);
        logger.info({ slug: phaseDef.slug }, "ensureMainMasterclass: phase inserted");
      }
    }

    // ── 2. Upsert all 29 lessons ─────────────────────────────────────────────
    const keepSlugs = MASTERCLASS_LESSONS.map((l) => l.slug);

    // Load all existing room30 lesson slugs in one query.
    const existingRows = await db
      .select({ id: lessonsTable.id, slug: lessonsTable.slug })
      .from(lessonsTable)
      .where(eq(lessonsTable.portalKey, PORTAL_KEY));
    const existingBySlug = new Map(existingRows.map((r) => [r.slug, r.id]));

    let inserted = 0;
    let updated = 0;

    for (const lesson of MASTERCLASS_LESSONS) {
      const phaseId = phaseIdBySlug.get(lesson.phase_slug);
      if (!phaseId) {
        logger.error({ slug: lesson.slug, phase_slug: lesson.phase_slug }, "ensureMainMasterclass: phase missing for lesson");
        continue;
      }

      const existingId = existingBySlug.get(lesson.slug);
      if (existingId) {
        // Update structural fields only — never overwrite video/notes/brief/tasks.
        await db
          .update(lessonsTable)
          .set({
            phaseId,
            sortOrder: lesson.sort_order,
            title: lesson.title,
          })
          .where(eq(lessonsTable.id, existingId));
        updated++;
      } else {
        // New lesson: insert with all seed data. Status derived from video presence —
        // never set status on UPDATE so admin changes survive restarts.
        const seedStatus = lesson.wistia_video_id ? "published" : "coming_soon";
        await db.insert(lessonsTable).values({
          slug: lesson.slug,
          phaseId,
          title: lesson.title,
          sortOrder: lesson.sort_order,
          wistiaVideoId: lesson.wistia_video_id ?? null,
          notes: lesson.notes ?? null,
          status: seedStatus,
          portalKey: PORTAL_KEY,
        });
        inserted++;
      }
    }

    // ── 2b. Backfill status for lessons that existed before the status column
    //        was added. Rule: if a lesson has no video AND is currently 'published'
    //        (the column DEFAULT), flip it to 'coming_soon'. Lessons already set
    //        to 'draft' or explicitly 'coming_soon' by an admin are left alone.
    await db.execute(
      sql`
        UPDATE "lessons"
           SET "status" = 'coming_soon'
         WHERE "portal_key" = ${PORTAL_KEY}
           AND ("wistia_video_id" IS NULL OR "wistia_video_id" = '')
           AND "status" = 'published'
      `,
    );

    // ── 3. Remove stale lessons (not in canonical list) ──────────────────────
    const stale = await db
      .select({ id: lessonsTable.id, slug: lessonsTable.slug })
      .from(lessonsTable)
      .where(
        and(
          eq(lessonsTable.portalKey, PORTAL_KEY),
          notInArray(lessonsTable.slug, keepSlugs),
        ),
      );

    if (stale.length > 0) {
      const staleIds = stale.map((r) => r.id);
      // Delete progress rows first to avoid FK violations.
      await db.delete(lessonProgressTable).where(inArray(lessonProgressTable.lessonId, staleIds));
      await db.delete(lessonsTable).where(inArray(lessonsTable.id, staleIds));
      logger.info(
        { removed: stale.map((r) => r.slug) },
        "ensureMainMasterclass: stale lessons removed",
      );
    }

    // ── 4. Remove phases that no remaining lesson references ─────────────────
    const canonicalPhaseSlugs = MASTERCLASS_PHASES.map((p) => p.slug);
    const referencedPhaseIds = (
      await db
        .select({ phaseId: lessonsTable.phaseId })
        .from(lessonsTable)
        .where(eq(lessonsTable.portalKey, PORTAL_KEY))
    ).map((r) => r.phaseId);

    const stalePhaseWhere = and(
      eq(coursePhasesTable.portalKey, PORTAL_KEY),
      notInArray(coursePhasesTable.slug, canonicalPhaseSlugs),
      ...(referencedPhaseIds.length > 0
        ? [notInArray(coursePhasesTable.id, referencedPhaseIds)]
        : []),
    );
    await db.delete(coursePhasesTable).where(stalePhaseWhere);

    logger.info(
      { inserted, updated, staleRemoved: stale.length, total: keepSlugs.length },
      "ensureMainMasterclass: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureMainMasterclass failed");
  }
}
