import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adConcepts = pgTable("ad_concepts", {
  id: serial("id").primaryKey(),
  awarenessStage: text("awareness_stage").notNull(),
  conceptType: text("concept_type").notNull(),
  funnelPosition: text("funnel_position").notNull(),
  format: text("format").notNull(),
  headline: text("headline").notNull(),
  hook: text("hook").notNull(),
  bodyCopy: text("body_copy").notNull(),
  cta: text("cta").notNull(),
  angle: text("angle").notNull(),
  targetAvatar: text("target_avatar"),
  visualDirection: text("visual_direction"),
  funnelType: text("funnel_type"),
  landingPage: text("landing_page"),
  notes: text("notes"),
  status: text("status").notNull().default("generated"),
  metadata: jsonb("metadata"),
  batchId: text("batch_id"),
  clerkId: text("clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAdConceptSchema = createInsertSchema(adConcepts).omit({
  id: true,
  createdAt: true,
});

export type AdConcept = typeof adConcepts.$inferSelect;
export type InsertAdConcept = z.infer<typeof insertAdConceptSchema>;
