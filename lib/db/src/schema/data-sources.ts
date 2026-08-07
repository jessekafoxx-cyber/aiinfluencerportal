import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataSources = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  apiKey: text("api_key").notNull(),
  status: text("status").notNull().default("pending"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncResult: jsonb("last_sync_result"),
  syncedData: jsonb("synced_data"),
  clerkId: text("clerk_id"),
  offerId: integer("offer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDataSourceSchema = createInsertSchema(dataSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DataSource = typeof dataSources.$inferSelect;
export type InsertDataSource = z.infer<typeof insertDataSourceSchema>;
