import { pgTable, serial, text, timestamp, boolean, integer, jsonb, real } from "drizzle-orm/pg-core";

export const staticAdTemplates = pgTable("static_ad_templates", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  name: text("name").notNull(),
  formatId: text("format_id"),
  description: text("description"),
  promptTemplate: text("prompt_template"),
  referenceImagePath: text("reference_image_path"),
  aspectRatio: text("aspect_ratio").default("1:1"),
  tone: text("tone"),
  targetAvatar: text("target_avatar"),
  conceptAngle: text("concept_angle"),
  offerCta: text("offer_cta"),
  tags: jsonb("tags"),
  usageCount: integer("usage_count").default(0),
  avgRating: real("avg_rating"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staticAdOffers = pgTable("static_ad_offers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  landingPageUrl: text("landing_page_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staticAdBrandKits = pgTable("static_ad_brand_kits", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  accentColor: text("accent_color"),
  backgroundColor: text("background_color"),
  fontHeadline: text("font_headline"),
  fontBody: text("font_body"),
  logoPath: text("logo_path"),
  typographyStyle: text("typography_style"),
  guidelines: text("guidelines"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staticAdAssets = pgTable("static_ad_assets", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  category: text("category").default("Other"),
  assetRole: text("asset_role").default("general"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staticAdGenerations = pgTable("static_ad_generations", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  referenceImagePath: text("reference_image_path"),
  productImagePath: text("product_image_path"),
  prompt: text("prompt"),
  conceptName: text("concept_name"),
  avatarName: text("avatar_name"),
  size: text("size").default("1:1"),
  usedBrandKit: boolean("used_brand_kit").default(false),
  generatedImages: jsonb("generated_images"),
  status: text("status").default("completed"),
  generationMode: text("generation_mode").default("remix"),
  formatId: text("format_id"),
  conceptIndex: integer("concept_index"),
  adDetailMeta: jsonb("ad_detail_meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staticAdBrandIntelligence = pgTable("static_ad_brand_intelligence", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  persona: text("persona").notNull(),
  angle: text("angle").notNull(),
  painPoint: text("pain_point"),
  emotion: text("emotion"),
  source: text("source").default("manual"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
