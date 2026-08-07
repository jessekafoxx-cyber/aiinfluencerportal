import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// One-time Platinum Founder Code issued to every Platinum Club subscriber
// (i.e. anyone with an order row whose upsell3Paid flag is true, regardless
// of whether it was the standard $97/mo Upsell 3 or the 30-day-free-trial
// Downsell 3 - both flip the same orders.upsell3Paid column).
//
// Promised on /upsell3 + /downsell3: a unique single-use code that can be
// redeemed for free access to any future "main product" Greg releases
// under the Room30 AI portfolio. Issuance is keyed on owner_email (NOT
// the order id) because:
//   - The same buyer can have multiple synthetic admin-grant rows and
//     real Whop orders against the same email; we want exactly one code
//     per buyer, not one per order row.
//   - When Platinum is purchased the buyer's app_users row may not exist
//     yet (the post-purchase enrollment email creates the Clerk account),
//     so email is the only stable identifier we always have at issuance
//     time.
// owner_user_id is the canonical owner identifier (FK-style link to
// app_users.id) and is populated lazily: it may be NULL at issuance
// time (Platinum is purchased before the buyer's app_users row exists),
// then backfilled the first time the authenticated buyer hits any
// platinum-codes endpoint or admin code lookup. owner_email is the
// always-available fallback used during the pre-account window.
// owner_order_id is recorded for audit trail (which Platinum purchase
// triggered the issuance) but is intentionally NOT part of any unique
// constraint.
export const platinumFounderCodesTable = pgTable(
  "platinum_founder_codes",
  {
    code: text("code").primaryKey(),
    ownerEmail: text("owner_email").notNull().unique(),
    ownerUserId: text("owner_user_id"),
    ownerOrderId: text("owner_order_id"),
    // unredeemed | redeemed | revoked
    status: text("status").notNull().default("unredeemed"),
    redeemedForProductSlug: text("redeemed_for_product_slug"),
    redeemedForOrderId: text("redeemed_for_order_id"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusIdx: index("platinum_founder_codes_status_idx").on(t.status),
    ownerOrderIdx: index("platinum_founder_codes_owner_order_idx").on(t.ownerOrderId),
    ownerUserIdx: index("platinum_founder_codes_owner_user_idx").on(t.ownerUserId),
  }),
);

export type PlatinumFounderCode = typeof platinumFounderCodesTable.$inferSelect;
