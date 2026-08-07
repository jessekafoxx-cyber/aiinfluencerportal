import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const editingStyles = pgTable("editing_styles", {
  id: serial("id").primaryKey(),
  styleKey: text("style_key").notNull().unique(),
  label: text("label").notNull(),
  sourceType: text("source_type").default("manual").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  preferences: jsonb("preferences").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EditingStyle = typeof editingStyles.$inferSelect;
