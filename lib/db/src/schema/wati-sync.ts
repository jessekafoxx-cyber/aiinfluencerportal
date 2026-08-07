import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

export const WATI_SYNC_OPS = [
  "upsert",
  "tag",
  "untag",
  // Task #603: revenue / purchase-state push. The drain handler reads
  // `wati_purchases` for this contact, recomputes lifetime totals, and
  // pushes them to WATI as custom contact attributes plus the matching
  // tag. Same op handles initial purchase and refund - the row in
  // wati_purchases is the source of truth.
  "purchase_sync",
  // WATI lead flow: send a WhatsApp message template directly to the
  // contact (e.g. the "questions" nurture or "purchase_thank_you"
  // welcome). The template name + broadcast name live in `payload`.
  "send_template",
] as const;
export type WatiSyncOp = (typeof WATI_SYNC_OPS)[number];

// Must mirror KIT_SYNC_TAGS so the contact mirror is consistent across
// channels. Task #598. Task #603 added `purchased` as the catch-all
// "bought anything from us" tag, used to segment buyers from leads in
// WATI broadcasts.
export const WATI_SYNC_TAGS = [
  "not-purchased",
  "low-ticket-purchased",
  "platinum-club",
  "done-for-you",
  "a-list-coaching",
  "live-event",
  "refunded",
  "purchased",
] as const;
export type WatiSyncTag = (typeof WATI_SYNC_TAGS)[number];

export const WATI_SYNC_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "failed",
] as const;
export type WatiSyncStatus = (typeof WATI_SYNC_STATUSES)[number];

export const watiSyncOutboxTable = pgTable(
  "wati_sync_outbox",
  {
    id: serial("id").primaryKey(),
    // E.164 phone (digits only, no leading +). WATI keys contacts by
    // whatsapp number so this is the required identifier; email is kept
    // alongside as best-effort metadata for the admin panel.
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
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
    statusRunAfterIdx: index("wati_sync_outbox_status_run_after_idx").on(t.status, t.runAfter),
    phoneIdx: index("wati_sync_outbox_phone_idx").on(t.contactPhone),
    emailIdx: index("wati_sync_outbox_email_idx").on(t.contactEmail),
  }),
);

export type WatiSyncOutboxRow = typeof watiSyncOutboxTable.$inferSelect;
export const selectWatiSyncOutboxSchema = createSelectSchema(watiSyncOutboxTable);

/**
 * Task #603: per-purchase ledger that backs the WATI revenue
 * attribution feature. Each (orderId, slug) is recorded exactly once
 * via INSERT ... ON CONFLICT DO NOTHING so a webhook re-delivery does
 * not double-count `lifetime_revenue` on the buyer's WATI contact.
 *
 * The drain handler for the `purchase_sync` outbox op recomputes the
 * contact's totals from this ledger and pushes them to WATI as custom
 * attributes (`lifetime_revenue`, `last_purchase_amount`,
 * `last_purchase_product`, `last_purchase_at`, `purchase_count`).
 *
 * Refunds set `refunded_at` + `refunded_amount_cents` instead of
 * deleting the row, so historical attribution + the `refunded` tag
 * still reflect what the buyer originally bought.
 */
export const watiPurchasesTable = pgTable(
  "wati_purchases",
  {
    // Order id from `orders.id`, or a synthetic id for non-orders revenue
    // rows (e.g. `coaching:<agreement_id>`, `credit:<purchase_id>`).
    orderId: text("order_id").notNull(),
    // Free-form slug identifying the line within the order. Examples:
    // "main", "bump2", "upsell1", "platinum", "dfy_build",
    // "coaching:portugal_gold", "research_credit", "os_tool_credit_pack".
    slug: text("slug").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
    amountCents: integer("amount_cents").notNull(),
    productName: text("product_name").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedAmountCents: integer("refunded_amount_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orderId, t.slug] }),
    phoneIdx: index("wati_purchases_phone_idx").on(t.contactPhone),
    emailIdx: index("wati_purchases_email_idx").on(t.contactEmail),
  }),
);

export type WatiPurchaseRow = typeof watiPurchasesTable.$inferSelect;
