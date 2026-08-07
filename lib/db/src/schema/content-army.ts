import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Waitlist signups for the "Content Army Masterclass" coming-soon page
// (landing-page /contentarmy). Collects first name, email, and phone.
export const contentArmySignupsTable = pgTable("content_army_signups", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  source: text("source"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContentArmySignup = typeof contentArmySignupsTable.$inferSelect;
export type InsertContentArmySignup = typeof contentArmySignupsTable.$inferInsert;
