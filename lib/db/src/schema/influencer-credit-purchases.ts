import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { portalUsersTable } from "./portal";

export const influencerCreditPurchasesTable = pgTable(
  "influencer_credit_purchases",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    totalAmountCents: integer("total_amount_cents").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id"),
    status: text("status").notNull().default("paid"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedQty: integer("refunded_qty").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    portalUserIdx: index("influencer_credit_purchases_portal_user_idx").on(table.portalUserId),
  }),
);

export type InfluencerCreditPurchase = typeof influencerCreditPurchasesTable.$inferSelect;
export type InsertInfluencerCreditPurchase = typeof influencerCreditPurchasesTable.$inferInsert;
