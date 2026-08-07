import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

export const fbBotConfig = pgTable("fb_bot_config", {
  id: serial("id").primaryKey(),
  adAccountId: text("ad_account_id"),
  pageId: text("page_id"),
  pageName: text("page_name"),
  autoReplyEnabled: boolean("auto_reply_enabled").default(false).notNull(),
  replyDelay: integer("reply_delay_seconds").default(30).notNull(),
  replyRules: text("reply_rules"),
  toneGuide: text("tone_guide"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fbAdComments = pgTable("fb_ad_comments", {
  id: serial("id").primaryKey(),
  fbCommentId: text("fb_comment_id").notNull().unique(),
  fbPostId: text("fb_post_id").notNull(),
  adName: text("ad_name"),
  commenterName: text("commenter_name").notNull(),
  commenterId: text("commenter_id"),
  commentText: text("comment_text").notNull(),
  commentTime: timestamp("comment_time", { withTimezone: true }),
  replyText: text("reply_text"),
  replyStatus: text("reply_status").default("pending").notNull(),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  fbReplyId: text("fb_reply_id"),
  sentiment: text("sentiment"),
  flagged: boolean("flagged").default(false).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
