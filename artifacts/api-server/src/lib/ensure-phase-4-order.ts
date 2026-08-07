import { db, coursePhasesTable, lessonsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

const PHASE_4_SLUG = "phase-4-sales-machine";

const PHASE_4_LESSON_ORDER: Array<{ slug: string; sortOrder: number }> = [
  { slug: "intro-mindset-shift",        sortOrder: 0 },
  { slug: "our-strategy",               sortOrder: 1 },
  { slug: "daily-youtube-video",        sortOrder: 2 },
  { slug: "30-content-pieces",          sortOrder: 3 },
  { slug: "3-second-audience-segment",  sortOrder: 4 },
  { slug: "engagement-ad-campaign",     sortOrder: 5 },
  { slug: "correct-profile-setup",      sortOrder: 6 },
  { slug: "direct-response-campaign",   sortOrder: 7 },
  { slug: "ig-tiktok-story-sequence",   sortOrder: 8 },
  { slug: "daily-4-hour-structure",     sortOrder: 9 },
  { slug: "reposting-content-90-days",  sortOrder: 10 },
];

export async function ensurePhase4Order(): Promise<void> {
  try {
    const [phase] = await db
      .select()
      .from(coursePhasesTable)
      .where(eq(coursePhasesTable.slug, PHASE_4_SLUG));

    if (!phase) {
      logger.warn("ensurePhase4Order: phase row missing");
      return;
    }

    let updated = 0;
    for (const target of PHASE_4_LESSON_ORDER) {
      const [existing] = await db
        .select()
        .from(lessonsTable)
        .where(and(eq(lessonsTable.slug, target.slug), eq(lessonsTable.phaseId, phase.id)));
      if (!existing) continue;
      if (existing.sortOrder === target.sortOrder) continue;
      await db
        .update(lessonsTable)
        .set({ sortOrder: target.sortOrder })
        .where(eq(lessonsTable.id, existing.id));
      updated++;
      logger.info(
        { slug: target.slug, from: existing.sortOrder, to: target.sortOrder },
        "ensurePhase4Order: lesson reordered",
      );
    }

    logger.info({ phaseId: phase.id, updated }, "ensurePhase4Order: done");
  } catch (err) {
    logger.error({ err }, "ensurePhase4Order: failed");
  }
}
