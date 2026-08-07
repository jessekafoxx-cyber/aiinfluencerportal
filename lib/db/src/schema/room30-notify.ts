import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const room30NotifySignupsTable = pgTable("room30_notify_signups", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Room30NotifySignup = typeof room30NotifySignupsTable.$inferSelect;
export type InsertRoom30NotifySignup = typeof room30NotifySignupsTable.$inferInsert;
