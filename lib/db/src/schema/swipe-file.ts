import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// One configured Google Sheet source per user. The sheet is expected to have a
// single column of social URLs (Instagram / TikTok / Facebook). The system
// polls it on demand (and on a daily cron) and ingests new rows.
export const swipeFileSources = pgTable("swipe_file_sources", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  sheetUrl: text("sheet_url").notNull(),
  sheetId: text("sheet_id").notNull(),
  sheetTab: text("sheet_tab").default("Sheet1").notNull(),
  urlColumn: text("url_column").default("A").notNull(),
  startRow: integer("start_row").default(2).notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncSummary: jsonb("last_sync_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Each row = one saved social post / ad.
// status: pending → scraping → ready | error
// transcriptionStatus: idle | running | done | error  (only for video items)
export const swipeFileItems = pgTable("swipe_file_items", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  platform: text("platform").notNull(), // instagram | tiktok | facebook | unknown
  status: text("status").default("pending").notNull(),
  errorMsg: text("error_msg"),

  // Media
  mediaType: text("media_type"), // video | image | carousel | unknown
  localMediaFile: text("local_media_file"), // filename in /tmp/swipe-file
  localThumbFile: text("local_thumb_file"),
  externalMediaUrl: text("external_media_url"), // fallback if download failed

  // Captured content
  caption: text("caption"),
  authorName: text("author_name"),
  authorHandle: text("author_handle"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  metricsJson: jsonb("metrics_json"), // likes, comments, views, etc.

  // Transcript (for videos)
  transcriptionStatus: text("transcription_status").default("idle").notNull(),
  transcript: text("transcript"),

  // AI-generated
  aiConcepts: text("ai_concepts"),
  aiConceptsAt: timestamp("ai_concepts_at", { withTimezone: true }),

  // Tagging / org
  tags: jsonb("tags"),
  notes: text("notes"),

  scrapedAt: timestamp("scraped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
