import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ordersTable } from "./orders";

// Captures every email + phone typed into the low-ticket funnel form
// (HeroLeadForm on /offer, etc.) at the moment of
// submit, BEFORE the visitor is redirected to /checkout. Persists the
// lead even when the visitor never reaches checkout, never starts a
// Whop session, and never pays - so we can later push these to a CRM /
// SMS provider without losing the entries we have already shown intent
// for.
//
// Email is the natural key (lowercased + unique). Re-submits update the
// existing row in place: phone, country, affiliate, source page, and
// `last_seen_at` are refreshed; `created_at` stays at the first touch.
//
// `order_id` is filled in once the visitor reaches /checkout and the
// Whop checkout session is created (lookup by email). Stays NULL for
// leads that abandoned before checkout.
export const funnelLeadsTable = pgTable("funnel_leads", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  // Task #607 follow-on: first name typed into the lead form / checkout.
  // Mirrors what we already pass to KIT/WATI as a custom field so the
  // raw lead row carries the same identity without joining outboxes.
  firstName: text("first_name"),
  country: text("country"),
  affiliateCode: text("affiliate_code"),
  // Task #584: FirstPromoter referral id (tid) captured from the
  // `_fprom_tid` cookie at lead-form submit. Lets us reconstruct
  // attribution even for leads that abandoned before checkout.
  firstpromoterReferralId: text("firstpromoter_referral_id"),
  // Promoter id resolved opportunistically when FP confirms the
  // referral. Filled in by the same code path that updates the order;
  // keeps audit parity between funnel_leads and orders.
  firstpromoterPromoterId: text("firstpromoter_promoter_id"),
  sourcePage: text("source_page"),
  referrer: text("referrer"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  // Linked once /whop/create-checkout-session creates an order for this
  // email. Nullable so the lead row stands on its own for visitors who
  // never reach checkout. ON DELETE SET NULL so deleting an order
  // preserves the lead row (we still want the marketing record).
  orderId: text("order_id").references(() => ordersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  // GoHighLevel mirror (added post-Task #587 GHL relaunch). The contact
  // id is cached on first successful upsert so subsequent tag add /
  // remove calls go directly to /contacts/:id/tags without re-resolving
  // by email. `ghl_not_purchased_tagged_at` is stamped by the 5-minute
  // scheduler the first time the lead is tagged `not-purchased`;
  // `ghl_purchased_tagged_at` is stamped by markStripeOrderPaid the
  // first time the buyer's main product flips paid. Both columns also
  // serve as one-shot idempotency gates so the same tag is never
  // re-pushed for the same lead.
  ghlContactId: text("ghl_contact_id"),
  ghlNotPurchasedTaggedAt: timestamp("ghl_not_purchased_tagged_at", { withTimezone: true }),
  ghlPurchasedTaggedAt: timestamp("ghl_purchased_tagged_at", { withTimezone: true }),
  // WATI WhatsApp lead flow (mirrors the GHL columns above).
  // `wati_questions_sent_at` is stamped by the 5-minute WATI scheduler
  // the first time the "questions" template is sent to a lead that has
  // not purchased; `wati_thank_you_sent_at` is stamped by
  // markStripeOrderPaid the first time the buyer's main product flips
  // paid and the "purchase_thank_you" template is sent. Both serve as
  // one-shot idempotency gates so the same WhatsApp template is never
  // re-sent for the same lead.
  watiQuestionsSentAt: timestamp("wati_questions_sent_at", { withTimezone: true }),
  watiThankYouSentAt: timestamp("wati_thank_you_sent_at", { withTimezone: true }),
});

export const insertFunnelLeadSchema = createInsertSchema(funnelLeadsTable).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
});
export const selectFunnelLeadSchema = createSelectSchema(funnelLeadsTable);
export type InsertFunnelLead = z.infer<typeof insertFunnelLeadSchema>;
export type FunnelLead = typeof funnelLeadsTable.$inferSelect;
