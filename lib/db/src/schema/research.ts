import { pgTable, serial, text, timestamp, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clerkId: text("clerk_id"),
  highTicketDetails: text("high_ticket_details"),
  lowTicketDetails: text("low_ticket_details"),
  premiumDetails: text("premium_details"),
  hundredKDetails: text("hundred_k_details"),
  upsellDetails: text("upsell_details"),
  vslSummary: text("vsl_summary"),
  urls: jsonb("urls").$type<string[]>(),
  positioning: text("positioning"),
  mechanism: text("mechanism"),
  bonuses: text("bonuses"),
  guarantees: text("guarantees"),
  pricing: text("pricing"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const researchDocs = pgTable("research_docs", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags"),
  metadata: jsonb("metadata"),
  clerkId: text("clerk_id"),
  offerId: integer("offer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertOfferSchema = createInsertSchema(offers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertResearchDocSchema = createInsertSchema(researchDocs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const redditPosts = pgTable("reddit_posts", {
  id: serial("id").primaryKey(),
  postId: text("post_id").notNull(),
  subreddit: text("subreddit").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  url: text("url"),
  score: integer("score").default(0),
  numComments: integer("num_comments").default(0),
  dimension: text("dimension"),
  offerId: integer("offer_id"),
  clerkId: text("clerk_id"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reddit_posts_post_id_offer_id_idx").on(table.postId, table.offerId),
]);

export const redditComments = pgTable("reddit_comments", {
  id: serial("id").primaryKey(),
  commentId: text("comment_id").notNull(),
  postId: text("post_id").notNull(),
  subreddit: text("subreddit").notNull(),
  body: text("body").notNull(),
  score: integer("score").default(0),
  author: text("author"),
  dimension: text("dimension"),
  offerId: integer("offer_id"),
  clerkId: text("clerk_id"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reddit_comments_comment_id_offer_id_idx").on(table.commentId, table.offerId),
]);

export type Offer = typeof offers.$inferSelect;
export type InsertOffer = z.infer<typeof insertOfferSchema>;
export type ResearchDoc = typeof researchDocs.$inferSelect;
export type InsertResearchDoc = z.infer<typeof insertResearchDocSchema>;
export const socialComments = pgTable("social_comments", {
  id: serial("id").primaryKey(),
  commentId: text("comment_id").notNull(),
  platform: text("platform").notNull(),
  sourceUrl: text("source_url"),
  videoTitle: text("video_title"),
  channelName: text("channel_name"),
  commentText: text("comment_text").notNull(),
  author: text("author"),
  likeCount: integer("like_count").default(0),
  replyCount: integer("reply_count").default(0),
  offerId: integer("offer_id").notNull(),
  clerkId: text("clerk_id"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("social_comments_comment_id_platform_offer_id_idx").on(table.commentId, table.platform, table.offerId),
]);

export type RedditPost = typeof redditPosts.$inferSelect;
export type RedditComment = typeof redditComments.$inferSelect;
export type SocialComment = typeof socialComments.$inferSelect;
