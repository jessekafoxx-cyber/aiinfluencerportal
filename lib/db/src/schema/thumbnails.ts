import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const faceClones = pgTable("face_clones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  status: text("status").notNull().default("pending"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const thumbnailTemplates = pgTable("thumbnail_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  layoutConfig: text("layout_config").notNull(),
  previewUrl: text("preview_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const thumbnailProjects = pgTable("thumbnail_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  youtubeUrl: text("youtube_url"),
  templateId: text("template_id"),
  faceCloneId: text("face_clone_id"),
  headlineTop: text("headline_top"),
  headlineBottom: text("headline_bottom"),
  expression: text("expression"),
  generatedImagePath: text("generated_image_path"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertFaceCloneSchema = createInsertSchema(faceClones).omit({
  id: true,
  createdAt: true,
});

export const insertThumbnailTemplateSchema = createInsertSchema(thumbnailTemplates).omit({
  id: true,
  createdAt: true,
});

export const insertThumbnailProjectSchema = createInsertSchema(thumbnailProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type FaceClone = typeof faceClones.$inferSelect;
export type InsertFaceClone = z.infer<typeof insertFaceCloneSchema>;
export type ThumbnailTemplate = typeof thumbnailTemplates.$inferSelect;
export type InsertThumbnailTemplate = z.infer<typeof insertThumbnailTemplateSchema>;
export type ThumbnailProject = typeof thumbnailProjects.$inferSelect;
export type InsertThumbnailProject = z.infer<typeof insertThumbnailProjectSchema>;
