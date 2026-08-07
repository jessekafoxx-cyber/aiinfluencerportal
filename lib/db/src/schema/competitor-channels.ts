import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const competitorChannels = pgTable("competitor_channels", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  profileUrl: text("profile_url"),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  clerkId: text("clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CompetitorChannel = typeof competitorChannels.$inferSelect;
