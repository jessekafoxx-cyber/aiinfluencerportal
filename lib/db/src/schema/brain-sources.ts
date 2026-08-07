import { pgTable, serial, text, varchar, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";

export const brainSources = pgTable(
  "brain_sources",
  {
    id: serial("id").primaryKey(),
    clerkId: varchar("clerk_id", { length: 255 }),
    kind: varchar("kind", { length: 32 }).notNull(),
    label: text("label").notNull(),
    sourceUrl: text("source_url"),
    externalId: varchar("external_id", { length: 255 }),
    content: text("content"),
    focusNotes: text("focus_notes"),
    ignoreNotes: text("ignore_notes"),
    status: varchar("status", { length: 16 }).notNull().default("ready"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    contentChars: integer("content_chars").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clerkIdx: index("brain_sources_clerk_idx").on(t.clerkId),
    kindIdx: index("brain_sources_kind_idx").on(t.kind),
  }),
);

export type BrainSource = typeof brainSources.$inferSelect;
