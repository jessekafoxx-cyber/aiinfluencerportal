import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const competitorSites = pgTable("competitor_sites", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id"),
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  urls: jsonb("urls").$type<string[]>().default([]).notNull(),
  fbPageId: text("fb_page_id"),
  fbPageName: text("fb_page_name"),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  lastAdScrapedAt: timestamp("last_ad_scraped_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const competitorScrapedPages = pgTable("competitor_scraped_pages", {
  id: serial("id").primaryKey(),
  competitorId: integer("competitor_id").notNull(),
  url: text("url").notNull(),
  pageTitle: text("page_title"),
  pageContent: text("page_content"),
  pageType: text("page_type"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CompetitorSite = typeof competitorSites.$inferSelect;
export type CompetitorScrapedPage = typeof competitorScrapedPages.$inferSelect;
