import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const episodes = pgTable("episodes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  youtubeTitle: text("youtube_title"),
  youtubeDescription: text("youtube_description"),
  audioPath: text("audio_path"),
  videoPath: text("video_path"),
  duration: integer("duration"),
  fileSize: integer("file_size"),
  status: text("status").notNull().default("processing"),
  podbeanEpisodeId: text("podbean_episode_id"),
  podbeanMediaKey: text("podbean_media_key"),
  podbeanUrl: text("podbean_url"),
  podbeanStatus: text("podbean_status").default("pending"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Episode = typeof episodes.$inferSelect;
