import { db, coursePhasesTable, lessonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const PHASE_5 = {
  slug: "phase-5-high-ticket",
  title: "Phase 5: High Ticket Conversion",
  description: "Convert your audience into high-ticket buyers",
  sortOrder: 5,
};

const SUMMARY_PHASE_SLUG = "summary-scaling";
const SUMMARY_PHASE_SORT_ORDER = 6;

const PHASE_5_LESSONS = [
  { slug: "p5-intro-strategy",   title: "Intro & Strategy",     brief: "How the high-ticket conversion machine plugs into your low-ticket offer and turns existing buyers into $5K-$100K clients", sortOrder: 0 },
  { slug: "offer-page-build",    title: "Offer Page Build",     brief: "Build your high-ticket offer page that pre-frames, qualifies and pre-sells before the call ever happens",                  sortOrder: 1 },
  { slug: "vsl-offer",           title: "VSL Offer",            brief: "Script and structure the high-ticket VSL that does the heavy selling so the call is just a confirmation",                   sortOrder: 2 },
  { slug: "sunday-story-pitch",  title: "Sunday Story Pitch",   brief: "The weekly long-form story email that turns your list into qualified high-ticket applicants every Sunday",                  sortOrder: 3 },
  { slug: "daily-email",         title: "Daily Email",          brief: "Writing and sending a daily email to your list",                                                                            sortOrder: 4 },
  { slug: "whatsapp-remarketing",title: "WhatsApp Remarketing", brief: "Using WhatsApp for remarketing and follow-ups",                                                                             sortOrder: 5 },
];

const LESSONS_TO_FORCE_INTO_PHASE_5 = ["daily-email", "whatsapp-remarketing"];

export async function ensurePhase5(): Promise<void> {
  try {
    await db.insert(coursePhasesTable).values(PHASE_5).onConflictDoNothing();

    const [phase] = await db
      .select()
      .from(coursePhasesTable)
      .where(eq(coursePhasesTable.slug, PHASE_5.slug));

    if (!phase) {
      logger.warn("ensurePhase5: phase row missing after insert");
      return;
    }

    if (phase.sortOrder !== PHASE_5.sortOrder) {
      await db
        .update(coursePhasesTable)
        .set({ sortOrder: PHASE_5.sortOrder })
        .where(eq(coursePhasesTable.id, phase.id));
    }

    await db
      .update(coursePhasesTable)
      .set({ sortOrder: SUMMARY_PHASE_SORT_ORDER })
      .where(eq(coursePhasesTable.slug, SUMMARY_PHASE_SLUG));

    for (const lesson of PHASE_5_LESSONS) {
      const [existing] = await db
        .select()
        .from(lessonsTable)
        .where(eq(lessonsTable.slug, lesson.slug));

      if (!existing) {
        await db.insert(lessonsTable).values({
          phaseId: phase.id,
          slug: lesson.slug,
          title: lesson.title,
          brief: lesson.brief,
          sortOrder: lesson.sortOrder,
          isPublished: true,
        });
        continue;
      }

      const updates: Partial<typeof lessonsTable.$inferInsert> = {};
      const mustMove = LESSONS_TO_FORCE_INTO_PHASE_5.includes(lesson.slug);
      if (mustMove && existing.phaseId !== phase.id) {
        updates.phaseId = phase.id;
        logger.info({ slug: lesson.slug, from: existing.phaseId, to: phase.id }, "ensurePhase5: relocating lesson");
      }
      if (existing.sortOrder !== lesson.sortOrder && (mustMove || existing.phaseId === phase.id)) {
        updates.sortOrder = lesson.sortOrder;
      }
      if (lesson.brief && !existing.brief && (mustMove || existing.phaseId === phase.id)) {
        updates.brief = lesson.brief;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(lessonsTable).set(updates).where(eq(lessonsTable.id, existing.id));
      }
    }

    logger.info({ phaseId: phase.id }, "ensurePhase5: Phase 5 verified");
  } catch (err) {
    logger.error({ err }, "ensurePhase5: failed");
  }
}
