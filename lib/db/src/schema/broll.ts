import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brollAssets = pgTable("broll_assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  fileType: text("file_type").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertBrollAssetSchema = createInsertSchema(brollAssets).omit({
  id: true,
  createdAt: true,
});

export type BrollAsset = typeof brollAssets.$inferSelect;
export type InsertBrollAsset = z.infer<typeof insertBrollAssetSchema>;
