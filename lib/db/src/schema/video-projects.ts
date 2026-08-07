import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoProjects = pgTable("video_projects", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  objectPath: text("object_path").notNull(),
  projectDirId: text("project_dir_id").notNull(),
  duration: integer("duration").default(0).notNull(),
  width: integer("width").default(1920).notNull(),
  height: integer("height").default(1080).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").default("uploaded").notNull(),
  transcriptSegments: jsonb("transcript_segments"),
  overlays: jsonb("overlays"),
  chatMessages: jsonb("chat_messages"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertVideoProjectSchema = createInsertSchema(videoProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type VideoProject = typeof videoProjects.$inferSelect;
export type InsertVideoProject = z.infer<typeof insertVideoProjectSchema>;
