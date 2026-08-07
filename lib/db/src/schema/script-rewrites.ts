import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const scriptRewrites = pgTable("script_rewrites", {
  id: serial("id").primaryKey(),
  clerkId: varchar("clerk_id", { length: 255 }),
  sourceUrl: text("source_url").notNull(),
  platform: varchar("platform", { length: 32 }).notNull(),
  sourceTitle: text("source_title"),
  sourceAuthor: text("source_author"),
  sourceThumbnail: text("source_thumbnail"),
  videoUrl: text("video_url"),
  transcript: text("transcript"),
  userPrompt: text("user_prompt"),
  ownVersion: text("own_version"),
  rewrittenScript: text("rewritten_script"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScriptRewrite = typeof scriptRewrites.$inferSelect;
export type InsertScriptRewrite = typeof scriptRewrites.$inferInsert;
