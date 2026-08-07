import { pgTable, text, integer, timestamp, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const workshopRecordingsTable = pgTable("workshop_recordings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  wistiaMediaId: text("wistia_media_id").notNull(),
  durationMinutes: integer("duration_minutes"),
  transcriptVtt: text("transcript_vtt"),
  summary: text("summary"),
  keyMentions: jsonb("key_mentions").default([]).notNull(),
  links: jsonb("links").default([]).notNull(),
  actionPoints: jsonb("action_points").default([]).notNull(),
  additionalNotes: text("additional_notes"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WorkshopRecording = typeof workshopRecordingsTable.$inferSelect;
export const insertWorkshopRecordingSchema = createInsertSchema(workshopRecordingsTable);

export type WorkshopRecordingKeyMention = {
  name: string;
  context?: string;
};

export type WorkshopRecordingLink = {
  url: string;
  label?: string;
  context?: string;
};

export type WorkshopRecordingActionPoint = {
  text: string;
};
