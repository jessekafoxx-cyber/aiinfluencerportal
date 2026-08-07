import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const room30ContactSubmissionsTable = pgTable(
  "room30_contact_submissions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    clientIpAddress: text("client_ip_address"),
    clientUserAgent: text("client_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => ({
    createdAtIdx: index("room30_contact_submissions_created_at_idx").on(
      t.createdAt,
    ),
    emailIdx: index("room30_contact_submissions_email_idx").on(t.email),
  }),
);

export type Room30ContactSubmission =
  typeof room30ContactSubmissionsTable.$inferSelect;
export type InsertRoom30ContactSubmission =
  typeof room30ContactSubmissionsTable.$inferInsert;
