import { pgTable, serial, text, timestamp, date, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarEntries = pgTable("calendar_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  slotNumber: integer("slot_number").notNull(),
  contentType: text("content_type").notNull(),
  awarenessStage: text("awareness_stage").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  caption: text("caption"),
  clipProjectId: text("clip_project_id"),
  clipId: text("clip_id"),
  youtubeUrl: text("youtube_url"),
  referenceVideoUrl: text("reference_video_url"),
  referenceNote: text("reference_note"),
  platforms: jsonb("platforms").$type<string[]>().default(["tiktok", "youtube_shorts", "instagram", "facebook"]),
  status: text("status").default("planned").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCalendarEntrySchema = createInsertSchema(calendarEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CalendarEntry = typeof calendarEntries.$inferSelect;
export type InsertCalendarEntry = z.infer<typeof insertCalendarEntrySchema>;
