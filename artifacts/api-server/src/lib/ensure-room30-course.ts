import { db, coursePhasesTable, lessonsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { ROOM30_COURSE_DATA } from "./room30-course-data";

const ROOM30_PORTAL_KEY = "room30";

// Bumped whenever the seed copy in room30-course-data.ts changes in a way
// that MUST reach rows already in the database (e.g. the white-label
// rebrand that stripped the old founder/brand names out of lesson notes).
// Rows whose stored copy still contains one of the legacy brand tokens
// below are rewritten from the seed; everything else is left untouched so
// genuine admin edits are never clobbered.
const SEED_BRANDING_REVISION = 2;

// Case-insensitive markers of pre-rebrand copy. Kept deliberately narrow so
// an admin edit that happens to mention nothing branded is never rewritten.
const LEGACY_BRAND_MARKERS = [
  "room 30",
  "room30ai",
  "room30.ai",
  "gregory",
  "greg cooke",
];

function hasLegacyBranding(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => {
    if (!v) return false;
    const lower = v.toLowerCase();
    return LEGACY_BRAND_MARKERS.some((marker) => lower.includes(marker));
  });
}

// Idempotently hydrate room30 phases + lessons. This was originally added
// 2026-05-07 because production was missing every room30-keyed row, which
// made the masterclass page render an empty list. New rows are inserted
// from ROOM30_COURSE_DATA; existing rows are left alone (so admin edits
// to notes / wistia_video_id in production are not clobbered on every
// boot) EXCEPT when their stored copy still contains pre-rebrand branding,
// in which case title/brief/notes are refreshed from the seed - see
// SEED_BRANDING_REVISION below.
export async function ensureRoom30Course(): Promise<void> {
  try {
    const phaseIdBySlug = new Map<string, number>();

    for (const seed of ROOM30_COURSE_DATA.phases) {
      const [existing] = await db
        .select()
        .from(coursePhasesTable)
        .where(
          and(
            eq(coursePhasesTable.slug, seed.slug),
            eq(coursePhasesTable.portalKey, ROOM30_PORTAL_KEY),
          ),
        );
      if (existing) {
        phaseIdBySlug.set(seed.slug, existing.id);
        continue;
      }
      const [inserted] = await db
        .insert(coursePhasesTable)
        .values({
          slug: seed.slug,
          title: seed.title,
          description: seed.description ?? null,
          sortOrder: seed.sort_order,
          portalKey: ROOM30_PORTAL_KEY,
        })
        .returning();
      phaseIdBySlug.set(seed.slug, inserted.id);
      logger.info({ slug: seed.slug }, "ensureRoom30Course: phase inserted");
    }

    let inserted = 0;
    let skipped = 0;
    let rebranded = 0;
    for (const seed of ROOM30_COURSE_DATA.lessons) {
      const phaseId = phaseIdBySlug.get(seed.phase_slug);
      if (!phaseId) {
        logger.warn(
          { lessonSlug: seed.slug, phaseSlug: seed.phase_slug },
          "ensureRoom30Course: phase not found for lesson, skipping",
        );
        continue;
      }
      const [existing] = await db
        .select()
        .from(lessonsTable)
        .where(
          and(
            eq(lessonsTable.slug, seed.slug),
            eq(lessonsTable.portalKey, ROOM30_PORTAL_KEY),
          ),
        );
      if (existing) {
        // Re-seed branding: if the stored title/brief/notes still carry
        // pre-rebrand copy, overwrite those three fields from the seed so
        // existing databases pick up the neutral wording on next boot.
        if (hasLegacyBranding(existing.title, existing.brief, existing.notes)) {
          await db
            .update(lessonsTable)
            .set({
              title: seed.title,
              brief: seed.brief ?? null,
              notes: seed.notes ?? null,
            })
            .where(eq(lessonsTable.id, existing.id));
          rebranded++;
          logger.info(
            { slug: seed.slug, revision: SEED_BRANDING_REVISION },
            "ensureRoom30Course: lesson copy re-seeded (branding refresh)",
          );
        } else {
          skipped++;
        }
        continue;
      }
      await db.insert(lessonsTable).values({
        phaseId,
        slug: seed.slug,
        title: seed.title,
        brief: seed.brief ?? null,
        wistiaVideoId: seed.wistia_video_id ?? null,
        promptTemplate: seed.prompt_template ?? null,
        downloadFiles: seed.download_files as never,
        sortOrder: seed.sort_order,
        durationMinutes: seed.duration_minutes ?? null,
        isPublished: seed.is_published,
        actionTask: seed.action_task ?? null,
        notes: seed.notes ?? null,
        actionTasks: (seed.action_tasks as string[] | null) ?? null,
        portalKey: ROOM30_PORTAL_KEY,
      });
      inserted++;
      logger.info({ slug: seed.slug }, "ensureRoom30Course: lesson inserted");
    }

    logger.info(
      {
        phaseCount: ROOM30_COURSE_DATA.phases.length,
        lessonsInserted: inserted,
        lessonsSkipped: skipped,
        lessonsRebranded: rebranded,
        brandingRevision: SEED_BRANDING_REVISION,
      },
      "ensureRoom30Course: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureRoom30Course: failed");
  }
}
