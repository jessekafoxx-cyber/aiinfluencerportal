import { pgTable, serial, text, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const shortFormScripts = pgTable(
  "short_form_scripts",
  {
    id: serial("id").primaryKey(),
    clerkId: varchar("clerk_id", { length: 255 }),
    topic: text("topic").notNull(),
    niche: text("niche"),
    audience: text("audience"),
    result: text("result"),
    proof: text("proof"),
    cta: text("cta"),
    idea: text("idea"),
    exampleTranscript: text("example_transcript"),
    awarenessStage: varchar("awareness_stage", { length: 32 }),
    variationCount: varchar("variation_count", { length: 4 }).notNull().default("1"),
    variations: jsonb("variations"),
    brainStats: jsonb("brain_stats"),
    status: varchar("status", { length: 16 }).notNull().default("processing"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clerkIdx: index("short_form_scripts_clerk_idx").on(t.clerkId),
  }),
);

export type ShortFormScript = typeof shortFormScripts.$inferSelect;
