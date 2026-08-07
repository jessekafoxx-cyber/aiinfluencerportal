import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { aiInfluencersTable } from "./influencers";

export const extraInfluencerBuildsTable = pgTable("extra_influencer_builds", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  influencerId: integer("influencer_id").references(() => aiInfluencersTable.id),
  gender: text("gender").notNull(),
  ageRange: text("age_range").notNull(),
  ethnicity: text("ethnicity").notNull(),
  influencerName: text("influencer_name").notNull(),
  slug: text("slug").notNull(),
  avatarUrl: text("avatar_url"),
  logoLightUrl: text("logo_light_url"),
  logoDarkUrl: text("logo_dark_url"),
  characterIdentity: text("character_identity"),
  status: text("status").notNull().default("pending"),
  buildProgress: integer("build_progress").notNull().default(0),
  buildLog: jsonb("build_log").$type<string[]>().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExtraInfluencerBuild = typeof extraInfluencerBuildsTable.$inferSelect;
export type InsertExtraInfluencerBuild = typeof extraInfluencerBuildsTable.$inferInsert;
