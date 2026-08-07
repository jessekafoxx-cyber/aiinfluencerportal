import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const learnedExemplars = pgTable(
  "learned_exemplars",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id"),
    tool: text("tool").notNull(),
    kind: text("kind").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    originalContent: text("original_content"),
    userInstruction: text("user_instruction"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    toolKindIdx: index("learned_exemplars_tool_kind_idx").on(t.tool, t.kind),
  }),
);

export const insertLearnedExemplarSchema = createInsertSchema(learnedExemplars).omit({
  id: true,
  createdAt: true,
});

export type LearnedExemplar = typeof learnedExemplars.$inferSelect;
export type InsertLearnedExemplar = z.infer<typeof insertLearnedExemplarSchema>;
