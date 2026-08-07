import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const storySequences = pgTable("story_sequences", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  awarenessStage: text("awareness_stage").notNull(),
  ctaType: text("cta_type").notNull(),
  ctaText: text("cta_text").notNull(),
  ctaLink: text("cta_link"),
  slideCount: integer("slide_count").notNull(),
  status: text("status").default("generated").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storySlides = pgTable("story_slides", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => storySequences.id, { onDelete: "cascade" }),
  slideNumber: integer("slide_number").notNull(),
  slideType: text("slide_type").notNull(),
  copyLines: jsonb("copy_lines").$type<string[]>().notNull(),
  imagePrompt: text("image_prompt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
