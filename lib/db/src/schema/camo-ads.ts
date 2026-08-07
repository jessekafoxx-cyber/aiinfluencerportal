import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const camoAds = pgTable("camo_ads", {
  id: serial("id").primaryKey(),
  adType: text("ad_type").notNull(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  awarenessStage: text("awareness_stage").notNull(),
  hook: text("hook"),
  bodyCopy: text("body_copy"),
  cta: text("cta"),
  imagePrompt: text("image_prompt"),
  videoScript: text("video_script"),
  sceneSetting: text("scene_setting"),
  metadata: jsonb("metadata"),
  status: text("status").default("generated").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
