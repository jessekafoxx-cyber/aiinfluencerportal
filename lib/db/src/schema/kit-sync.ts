import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

export const KIT_SYNC_OPS = [
  "upsert",
  "tag",
  "untag",
  // Task #599: push order revenue into Kit via the v3 Purchases API so
  // email-attributed revenue appears in Subscribers -> Purchases / broadcast
  // and sequence revenue reports. `purchase` pushes a paid line, and
  // `refund_purchase` pushes a negative-total line (transaction id suffixed
  // with `:refund`) so totals net out without needing a delete endpoint.
  "purchase",
  "refund_purchase",
] as const;
export type KitSyncOp = (typeof KIT_SYNC_OPS)[number];

export const KIT_SYNC_TAGS = [
  "not-purchased",
  "low-ticket-purchased",
  "platinum-club",
  "done-for-you",
  "a-list-coaching",
  "live-event",
  "refunded",
] as const;
export type KitSyncTag = (typeof KIT_SYNC_TAGS)[number];

export const KIT_SYNC_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "failed",
] as const;
export type KitSyncStatus = (typeof KIT_SYNC_STATUSES)[number];

export const kitSyncOutboxTable = pgTable(
  "kit_sync_outbox",
  {
    id: serial("id").primaryKey(),
    contactEmail: text("contact_email").notNull(),
    op: text("op").notNull(),
    tag: text("tag"),
    payload: jsonb("payload"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    statusRunAfterIdx: index("kit_sync_outbox_status_run_after_idx").on(t.status, t.runAfter),
    emailIdx: index("kit_sync_outbox_email_idx").on(t.contactEmail),
  }),
);

export type KitSyncOutboxRow = typeof kitSyncOutboxTable.$inferSelect;
export const selectKitSyncOutboxSchema = createSelectSchema(kitSyncOutboxTable);
