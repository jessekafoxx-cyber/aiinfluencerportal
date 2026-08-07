import { pgTable, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  // Buyer's phone number, captured at /checkout (E.164 or as-typed). Mirrors
  // what the lead capture flow already wrote to funnel_leads.phone so the
  // order row is self-contained for support, refunds, and CRM exports.
  phone: text("phone"),
  // Legacy Whop fields kept nullable for historical orders. Live funnel now
  // uses Stripe (see stripe* fields below). Do not write to whop_* on new orders.
  whopUserId: text("whop_user_id"),
  whopReceiptId: text("whop_receipt_id"),
  whopMembershipId: text("whop_membership_id"),
  whopBundlePlanId: text("whop_bundle_plan_id"),
  // Stripe identifiers for the live funnel (Task #582).
  stripeCustomerId: text("stripe_customer_id"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  // Saved PaymentMethod id captured on the main checkout via
  // setup_future_usage='off_session'. Reused by the upsell/downsell
  // pages to charge silently in one click without remounting Elements.
  stripeDefaultPaymentMethodId: text("stripe_default_payment_method_id"),
  // Set when the upsell-3 / standalone Platinum subscription is created.
  // Watched by the customer.subscription.deleted + invoice.payment_failed
  // webhook handlers to revoke platinumPaid when the sub lapses.
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Task #662: GoHighLevel order/invoice/contact id for buyers enrolled
  // via the POST /api/portal/ghl/enroll webhook. Acts as the "receipt id"
  // for the `ghl_verified_payment` provenance source (analogous to
  // `stripe_payment_intent_id` / `whop_receipt_id`). The CHECK constraint
  // added in migration 0064 lets `receipt_verified=true` be satisfied by
  // a non-null value here. Also used as the per-buyer idempotency key:
  // the webhook upserts `orders.id = 'ghl:<ghl_order_id>'` and short-
  // circuits replays via the existing already-paid check.
  ghlOrderId: text("ghl_order_id"),
  mainProductPaid: boolean("main_product_paid").default(false),
  bump1Paid: boolean("bump1_paid").default(false),
  ghlBump1OrderId: text("ghl_bump1_order_id"),
  bump2Paid: boolean("bump2_paid").default(false),
  ghlBump2OrderId: text("ghl_bump2_order_id"),
  bump3Paid: boolean("bump3_paid").default(false),
  ghlBump3OrderId: text("ghl_bump3_order_id"),
  upsell1Paid: boolean("upsell1_paid").default(false),
  ghlUpsell1OrderId: text("ghl_upsell1_order_id"),
  downsell1Paid: boolean("downsell1_paid").default(false),
  ghlDownsell1OrderId: text("ghl_downsell1_order_id"),
  upsell2Paid: boolean("upsell2_paid").default(false),
  ghlUpsell2OrderId: text("ghl_upsell2_order_id"),
  upsell3Paid: boolean("upsell3_paid").default(false),
  // Receipt id stamped when the upsell-3 (Platinum trial sub) row was
  // granted via GHL. Distinct from ghl_downsell3_order_id below
  // because downsell-3 shares the upsell3Paid flag (mutual exclusion)
  // but has its own GHL workflow + receipt id for audit.
  ghlUpsell3OrderId: text("ghl_upsell3_order_id"),
  ghlDownsell3OrderId: text("ghl_downsell3_order_id"),
  // New paid-upsell entitlement flags surfaced in the Room30 Portal sidebar.
  // Pricing + Stripe price IDs will be wired in later; until then the
  // /portal/charge-addon endpoint refuses these slugs so we never run a
  // silent $0 charge. See PORTAL_ADDON_SLUG_TO_PAID_FIELD in
  // artifacts/api-server/src/routes/portal.ts.
  tiktokSlideshowPaid: boolean("tiktok_slideshow_paid").default(false),
  hookDemoPaid: boolean("hook_demo_paid").default(false),
  doneForYouPackPaid: boolean("done_for_you_pack_paid").default(false),
  portfolioPaid: boolean("portfolio_paid").default(false),
  platinumPaid: boolean("platinum_paid").default(false),
  totalAmount: integer("total_amount").default(0),
  // Effective (post-promo) cents of the MAIN line, stamped by
  // markStripeOrderPaid on the mainProductPaid flip. This is the exact value
  // the server-side Meta CAPI main Purchase event sends, so the thank-you
  // browser pixel reads it back (GET /funnel/order/:oid -> main_amount_cents)
  // and the deduped `order_<id>_main` pair carries an identical value even
  // under promo discounts. NULL on legacy rows flipped before this column
  // existed - the endpoint falls back to a row-derived heuristic.
  effectiveMainAmountCents: integer("effective_main_amount_cents"),
  currentStep: text("current_step").default("checkout"),
  productSlugs: text("product_slugs"),
  // Task #551 provenance tracking. Every code path that flips
  // mainProductPaid=true MUST also stamp paymentSourceType. The DB-level
  // CHECK constraint in migration 0052 enforces the enum domain and the
  // (receiptVerified=true => whopReceiptId IS NOT NULL) invariant.
  //
  // payment_source_type values (kept in lockstep with PAYMENT_SOURCE_TYPES
  // in artifacts/api-server/src/lib/payment-provenance.ts):
  //
  //   whop_verified_payment        - Whop payment.succeeded with a receipt id
  //   whop_free_promo              - Whop membership.went_valid for a $0 plan
  //   whop_reconciler              - free-promo-reconcile.ts API-poll match
  //   whop_setup_account_fallback  - portal.ts setup-account live-Whop fallback
  //   whop_enrollment_sync         - portal.ts Whop-only enrollment synthetic row
  //   platinum_founder_code        - platinum-founder-codes.ts redeem
  //   admin_grant                  - manual admin grant / CSV import
  //   migration_backfill           - pre-provenance row, retroactively classified
  //
  // payment_verified=true  => the source is one of whop_*. Used by revenue
  //                           analytics to exclude non-Whop grants.
  // receipt_verified=true  => whop_receipt_id IS NOT NULL (a real Whop
  //                           receipt was persisted). Used to count "real"
  //                           paid revenue for the zero-conversion alert
  //                           and weekly accounting.
  paymentSourceType: text("payment_source_type"),
  grantReason: text("grant_reason"),
  paymentVerified: boolean("payment_verified").notNull().default(false),
  receiptVerified: boolean("receipt_verified").notNull().default(false),
  fbp: text("fbp"),
  fbc: text("fbc"),
  clientIpAddress: text("client_ip_address"),
  clientUserAgent: text("client_user_agent"),
  // Affiliate attribution. Stamped at first-touch (the affiliate URL param
  // captured in a 60-day cookie on the sales page) and threaded through
  // every Whop call in the funnel: the initial checkout session, the
  // bundle update, every silent upsell/downsell chargeUser. Whop reads
  // affiliate_code on both /checkout_sessions and /memberships and
  // attributes commission natively, so we never compute or pay commission
  // ourselves. First-touch wins: once stamped on an order, this column is
  // never overwritten by a later visit.
  affiliateCode: text("affiliate_code"),
  affiliateAttributedAt: timestamp("affiliate_attributed_at"),
  // Task #584: FirstPromoter referral attribution. `firstpromoter_referral_id`
  // is the `tid` returned by the FP `fpr.js` snippet (the cust_id of the
  // referring promoter, captured into the `_fprom_tid` cookie on the
  // landing page and forwarded into POST /api/whop/create-checkout-session
  // and POST /api/coaching/create as `firstpromoterReferralId`). It is
  // also passed straight back to FP on the sale-tracking call so FP
  // can attribute the commission to the correct promoter. The
  // `firstpromoter_promoter_id` column is filled in opportunistically
  // when the response from FP includes it. First-touch wins; once set
  // these columns are not overwritten by a later visit.
  firstpromoterReferralId: text("firstpromoter_referral_id"),
  firstpromoterPromoterId: text("firstpromoter_promoter_id"),
  firstpromoterAttributedAt: timestamp("firstpromoter_attributed_at"),
  // Map of paidField -> FP sale event id, plus a `renewals` array of
  // per-cycle invoice ids. Used by refund / subscription-cancel /
  // terminal-invoice-failure handlers to fire trackRefund with the
  // exact event id that was sent on the original trackSale.
  firstpromoterEventIds: jsonb("firstpromoter_event_ids")
    .$type<{ renewals?: string[] } & Partial<Record<string, string>>>()
    .notNull()
    .default({}),
  // One-shot idempotency stamp for the #low-ticket Slack summary
  // posted by GET /api/funnel/order/:oid. Set via atomic UPDATE WHERE
  // NULL so concurrent refresh + multi-device thank-you visits can
  // never double-post. Only ever set, never cleared.
  lowTicketSlackPostedAt: timestamp("low_ticket_slack_posted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Cache of dynamic Whop plans we have created on demand to drive the
// embedded checkout iframe at the correct combined price for a given cart
// combo (main + selected bumps). Keyed by a deterministic comboKey
// (sorted slug list joined by "+", e.g. "main+bump2+bump3") so that two
// buyers with the same cart combo share the same Whop plan instead of
// flooding the dashboard with one plan per checkout. When the buyer pays
// via this plan, the payment.succeeded webhook recognises the bundle and
// grants every selected bump from order.productSlugs in one go.
export const whopBundlePlansTable = pgTable("whop_bundle_plans", {
  comboKey: text("combo_key").primaryKey(),
  whopPlanId: text("whop_plan_id").notNull(),
  priceCents: integer("price_cents").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const metaCapiEventsTable = pgTable("meta_capi_events", {
  eventId: text("event_id").primaryKey(),
  eventName: text("event_name").notNull(),
  pixelId: text("pixel_id").notNull(),
  status: text("status").notNull(),
  responseBody: text("response_body"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
