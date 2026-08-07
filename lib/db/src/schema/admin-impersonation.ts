import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const adminImpersonationSessionsTable = pgTable(
  "admin_impersonation_sessions",
  {
    id: serial("id").primaryKey(),
    adminClerkId: text("admin_clerk_id").notNull(),
    adminEmail: text("admin_email"),
    targetPortalUserId: integer("target_portal_user_id").notNull(),
    targetEmail: text("target_email"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
);

export type AdminImpersonationSession = typeof adminImpersonationSessionsTable.$inferSelect;
