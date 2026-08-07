import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const contentCreators = pgTable("content_creators", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  profileUrl: text("profile_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const creatorVideos = pgTable("creator_videos", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull(),
  platform: text("platform").notNull(),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  duration: integer("duration"),
  hashtags: jsonb("hashtags").$type<string[]>(),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContentCreator = typeof contentCreators.$inferSelect;
export type CreatorVideo = typeof creatorVideos.$inferSelect;
