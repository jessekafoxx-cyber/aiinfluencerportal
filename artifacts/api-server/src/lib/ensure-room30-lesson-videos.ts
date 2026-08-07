import { db, lessonsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

const ROOM30 = "room30";

// One-time installer for the Room30 AI Influencer Masterclass Wistia
// videos. Mirrors ensure-lesson-videos.ts (which is scoped to portal_key
// 'main') but operates on portal_key 'room30'. Runs on boot. Only
// touches rows where wistia_video_id IS NULL - any non-null value
// (including the empty-string sentinel an admin writes via PUT
// /portal/admin/lessons/:slug/wistia) means an admin has taken
// ownership and we leave it alone.
const ROOM30_LESSON_VIDEOS: { slug: string; wistiaVideoId: string }[] = [
  // Phase 1: Intro & Strategy
  { slug: "r30-p1-intro", wistiaVideoId: "cvz37mi3rm" },
  { slug: "r30-p1-strategy", wistiaVideoId: "gu4s4kx81c" },
  { slug: "r30-p1-tool-stack", wistiaVideoId: "t8v2c8gver" },

  // Phase 2: Select Your Offer
  { slug: "r30-p2-intro", wistiaVideoId: "7e4dwmq5zg" },
  { slug: "r30-p2-selecting-offer", wistiaVideoId: "ts0ni48x34" },
  { slug: "r30-p2-bridge-page-build", wistiaVideoId: "2n8skx5hkn" },
  { slug: "r30-p2-bridge-page-copy", wistiaVideoId: "i67xjgr4pj" },
  { slug: "r30-p2-domain-setup", wistiaVideoId: "6xs6ceq0hb" },

  // Phase 3: Creating Your Influencer
  { slug: "r30-p3-intro", wistiaVideoId: "riqb2f05ql" },
  { slug: "r30-p3-finding-reference-image", wistiaVideoId: "iumsq1vpz8" },
  { slug: "r30-p3-creating-unique-avatar", wistiaVideoId: "gn3eu4sfn7" },
  { slug: "r30-p3-different-scenarios", wistiaVideoId: "vc2smcr1fy" },
  { slug: "r30-p3-crafting-unique-voice", wistiaVideoId: "wx3jtk2qqa" },
  { slug: "r30-p3-videos-heygen", wistiaVideoId: "dlhudeh4e3" },

  // Phase 4: Creating Content
  { slug: "r30-p4-intro-types-of-content", wistiaVideoId: "z574mn0waq" },
  { slug: "r30-p4-setting-up-social-media", wistiaVideoId: "d05h6vequ8" },
  { slug: "r30-p4-setting-up-manychat", wistiaVideoId: "n7nkhnsbxf" },
  { slug: "r30-p4-creating-green-screen", wistiaVideoId: "nqbrsyu2ga" },
  { slug: "r30-p4-creating-hook-demo", wistiaVideoId: "ozwnhbuyjb" },
  { slug: "r30-p4-creating-podcast-clips", wistiaVideoId: "sep5ok2ybj" },
  { slug: "r30-p4-creating-speaking-clips", wistiaVideoId: "edmxj070dc" },

  // Phase 5: Scaling With Ads
  { slug: "r30-p5-intro", wistiaVideoId: "wvko0730ll" },
  { slug: "r30-p5-engagement-campaign", wistiaVideoId: "8437xq36b3" },

  // Summary
  { slug: "r30-summary-next-steps", wistiaVideoId: "jttzyz7vy5" },
];

export async function ensureRoom30LessonVideos(): Promise<void> {
  try {
    let updated = 0;
    let alreadySet = 0;
    let missing = 0;

    for (const { slug, wistiaVideoId } of ROOM30_LESSON_VIDEOS) {
      const [row] = await db
        .select({ id: lessonsTable.id, wistiaVideoId: lessonsTable.wistiaVideoId })
        .from(lessonsTable)
        .where(and(eq(lessonsTable.slug, slug), eq(lessonsTable.portalKey, ROOM30)));

      if (!row) {
        missing++;
        logger.warn({ slug }, "ensureRoom30LessonVideos: lesson not found");
        continue;
      }

      if (row.wistiaVideoId !== null) {
        alreadySet++;
        continue;
      }

      await db
        .update(lessonsTable)
        .set({ wistiaVideoId })
        .where(eq(lessonsTable.id, row.id));
      updated++;
      logger.info({ slug, wistiaVideoId }, "ensureRoom30LessonVideos: video installed");
    }

    logger.info(
      { updated, alreadySet, missing, total: ROOM30_LESSON_VIDEOS.length },
      "ensureRoom30LessonVideos: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureRoom30LessonVideos: failed");
  }
}
