import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const onboardingProfilesTable = pgTable("onboarding_profiles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id).unique(),
  gender: text("gender").notNull(),
  ageRange: text("age_range").notNull(),
  ethnicity: text("ethnicity").notNull(),
  brandColorTheme: text("brand_color_theme").notNull(),
  generatedName: text("generated_name").notNull(),
  generatedSlug: text("generated_slug").notNull().unique(),
  logoLightUrl: text("logo_light_url"),
  logoDarkUrl: text("logo_dark_url"),
  avatarProfileUrl: text("avatar_profile_url"),
  characterIdentity: text("character_identity"),
  higgsFieldJobId: text("higgs_field_job_id"),
  status: text("status").notNull().default("pending"),
  buildProgress: integer("build_progress").notNull().default(0),
  buildLog: jsonb("build_log").$type<string[]>().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type OnboardingProfile = typeof onboardingProfilesTable.$inferSelect;
export type InsertOnboardingProfile = typeof onboardingProfilesTable.$inferInsert;
