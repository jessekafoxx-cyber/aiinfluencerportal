import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const copywritingGuidelines = pgTable("copywriting_guidelines", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCopywritingGuidelineSchema = createInsertSchema(copywritingGuidelines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CopywritingGuideline = typeof copywritingGuidelines.$inferSelect;
export type InsertCopywritingGuideline = z.infer<typeof insertCopywritingGuidelineSchema>;
