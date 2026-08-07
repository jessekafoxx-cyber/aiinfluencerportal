import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

// status pipeline buckets surfaced in the /roadmap page:
//   "next"          - planned, not started yet ("Coming Next")
//   "in_production" - actively being built ("In Production")
//   "shipped"       - live in the app ("Shipped")
// Stored as text (not a pg enum) so we can add buckets later without a
// migration. Default "next" matches the historical "coming soon" shape.
export const ROADMAP_STATUSES = ["next", "in_production", "shipped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export const roadmapItemsTable = pgTable("roadmap_items", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  status: text("status").notNull().default("next"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RoadmapItem = typeof roadmapItemsTable.$inferSelect;
export type InsertRoadmapItem = typeof roadmapItemsTable.$inferInsert;
