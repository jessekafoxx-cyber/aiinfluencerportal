import { pgTable, serial, integer, text, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { portalUsersTable } from "./portal";

// Generic per-tool generation history. One row per successful AI generation
// for any of the lightweight portal generators that don't have their own
// bespoke history table (carousel-creator, prompt-generator, bio-generator,
// domain-name-generator, image-prompt-generator, etc).
//
// Tools with their own purpose-built history table keep it - this is for
// everything else where a user said "I want to see and copy my previous
// generations". The shape is deliberately wide-open jsonb so any tool can
// stash whatever it needs to re-render its own UI.
//
// toolSlug examples: "carousel", "prompt-generator", "bio-generator",
// "domain-name-generator", "image-prompt-generator".
//
// label is a short, list-friendly summary (the user's hook, offer, subject -
// whatever reads well in a 1-line history row). input/output store the full
// payloads so the page can fully restore the generation including any
// uploaded image URLs.
export const toolGenerationsTable = pgTable(
  "tool_generations",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    toolSlug: varchar("tool_slug", { length: 64 }).notNull(),
    label: text("label"),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userToolIdx: index("tool_generations_user_tool_idx").on(t.portalUserId, t.toolSlug, t.createdAt),
  }),
);

export type ToolGeneration = typeof toolGenerationsTable.$inferSelect;
export type InsertToolGeneration = typeof toolGenerationsTable.$inferInsert;
