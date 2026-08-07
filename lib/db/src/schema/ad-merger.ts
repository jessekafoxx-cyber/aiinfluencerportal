import { pgTable, serial, text, varchar, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const adMergerProjects = pgTable("ad_merger_projects", {
  id: serial("id").primaryKey(),
  clerkId: varchar("clerk_id", { length: 255 }),
  name: text("name").notNull(),
  aspectRatio: varchar("aspect_ratio", { length: 16 }).notNull().default("9:16"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const adMergerClips = pgTable(
  "ad_merger_clips",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull(),
    role: varchar("role", { length: 16 }).notNull(), // hook | body | cta
    label: text("label").notNull(),
    sourceObjectPath: text("source_object_path").notNull(),
    normalizedObjectPath: text("normalized_object_path"),
    originalName: text("original_name"),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("processing"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("ad_merger_clips_project_idx").on(t.projectId),
  }),
);

export const adMergerOutputs = pgTable(
  "ad_merger_outputs",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull(),
    hookClipId: integer("hook_clip_id").notNull(),
    bodyClipId: integer("body_clip_id").notNull(),
    ctaClipId: integer("cta_clip_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    objectPath: text("object_path"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("ad_merger_outputs_project_idx").on(t.projectId),
    comboUnique: uniqueIndex("ad_merger_outputs_combo_unique").on(
      t.projectId,
      t.hookClipId,
      t.bodyClipId,
      t.ctaClipId,
    ),
  }),
);

export type AdMergerProject = typeof adMergerProjects.$inferSelect;
export type AdMergerClip = typeof adMergerClips.$inferSelect;
export type AdMergerOutput = typeof adMergerOutputs.$inferSelect;
