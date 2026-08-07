import { pgTable, serial, text, timestamp, integer, boolean, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const competitorVideos = pgTable(
  "competitor_videos",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id").notNull(),
    platform: text("platform").notNull(),
    videoId: text("video_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    thumbnailUrl: text("thumbnail_url"),
    durationSec: integer("duration_sec"),
    viewCount: integer("view_count"),
    likeCount: integer("like_count"),
    commentCount: integer("comment_count"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isShort: boolean("is_short").default(false).notNull(),
    isOutlier: boolean("is_outlier").default(false).notNull(),
    outlierMultiplier: real("outlier_multiplier"),
    channelMedianViews: integer("channel_median_views"),
    metadata: jsonb("metadata"),
    clerkId: text("clerk_id"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    chanIdx: index("competitor_videos_channel_idx").on(t.channelId),
    outlierIdx: index("competitor_videos_outlier_idx").on(t.isOutlier),
    pubIdx: index("competitor_videos_published_idx").on(t.publishedAt),
    chanVidUq: uniqueIndex("competitor_videos_channel_video_uq").on(t.channelId, t.videoId),
  }),
);

export const competitorVideoIdeas = pgTable("competitor_video_ideas", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id"),
  basedOnVideoIds: jsonb("based_on_video_ids"),
  brainStats: jsonb("brain_stats"),
  ideas: jsonb("ideas"),
  rawOutput: text("raw_output"),
  status: text("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CompetitorVideo = typeof competitorVideos.$inferSelect;
export type CompetitorVideoIdea = typeof competitorVideoIdeas.$inferSelect;
