import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pageNotesTable = pgTable("page_notes", {
  id: serial("id").primaryKey(),
  pageSlug: text("page_slug").unique().notNull(),
  pageTitle: text("page_title").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PageNotes = typeof pageNotesTable.$inferSelect;
