import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "./clients";

export const aiInfluencersTable = pgTable("ai_influencers", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  name: text("name").notNull(),
  // Nullable buyer-supplied display name. When set, the API responses
  // surface customName in the `name` field so every existing UI picks
  // up the rename without code changes. The raw `name` column is left
  // alone so the partial unique index `ai_influencers_client_autoname_uq`
  // (which keys off `name LIKE 'Influencer %'`) continues to dedupe
  // auto-named rows on finalize replay. Validated to 1-50 trimmed chars
  // by the rename routes; the column itself is plain text so legacy
  // backfills don't have to migrate length constraints.
  customName: text("custom_name"),
  niche: text("niche"),
  gender: text("gender"),
  ageRange: text("age_range"),
  avatarUrl: text("avatar_url"),
  mainImagePrompt: jsonb("main_image_prompt"),
  status: text("status").notNull().default("building"),
  // 'generated' (default - AI pipeline output, scene-swappable) vs
  // 'manual' (buyer-uploaded gallery, free + uncapped, static only).
  // See migration 0077_influencer_source.sql.
  source: text("source").notNull().default("generated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  // Partial unique index targeted by finalizeJob's
  // INSERT ... ON CONFLICT (client_id, name) WHERE name LIKE 'Influencer %'
  // makes concurrent finalize replays duplicate-safe for auto-named jobs.
  // See migration 0036_t367_ai_influencers_client_autoname_uq.sql.
  clientAutonameUq: uniqueIndex("ai_influencers_client_autoname_uq")
    .on(t.clientId, t.name)
    .where(sql`name LIKE 'Influencer %'`),
}));

export const influencerAnglesTable = pgTable("influencer_angles", {
  id: serial("id").primaryKey(),
  influencerId: integer("influencer_id").notNull().references(() => aiInfluencersTable.id, { onDelete: "cascade" }),
  label: text("label"),
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const influencerSettingsTable = pgTable("influencer_settings", {
  id: serial("id").primaryKey(),
  influencerId: integer("influencer_id").notNull().references(() => aiInfluencersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingImagesTable = pgTable("setting_images", {
  id: serial("id").primaryKey(),
  settingId: integer("setting_id").notNull().references(() => influencerSettingsTable.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  label: text("label"),
  prompt: text("prompt"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiInfluencer = typeof aiInfluencersTable.$inferSelect;
export type InfluencerAngle = typeof influencerAnglesTable.$inferSelect;
export type InfluencerSetting = typeof influencerSettingsTable.$inferSelect;
export type SettingImage = typeof settingImagesTable.$inferSelect;
