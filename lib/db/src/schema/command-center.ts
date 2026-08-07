import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  date,
  uniqueIndex,
  index,
  real,
} from "drizzle-orm/pg-core";

/**
 * Command Center tracking + reporting tables.
 * Money stored as integer cents (bigint for revenue sums).
 * All tables prefixed cc_ to avoid collisions.
 */

export const ccVisitors = pgTable(
  "cc_visitors",
  {
    id: serial("id").primaryKey(),
    anonId: text("anon_id").notNull(),
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    mergedIntoId: integer("merged_into_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    anonIdUq: uniqueIndex("cc_visitors_anon_id_uq").on(t.anonId),
    emailIdx: index("cc_visitors_email_idx").on(t.email),
  }),
);

export const ccTouchpoints = pgTable(
  "cc_touchpoints",
  {
    id: serial("id").primaryKey(),
    visitorId: integer("visitor_id").notNull().references(() => ccVisitors.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    url: text("url"),
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    fbclid: text("fbclid"),
    gclid: text("gclid"),
    channel: text("channel"),
    campaignType: text("campaign_type"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    visitorIdx: index("cc_touchpoints_visitor_idx").on(t.visitorId),
    occurredIdx: index("cc_touchpoints_occurred_idx").on(t.occurredAt),
    channelIdx: index("cc_touchpoints_channel_idx").on(t.channel),
  }),
);

export const ccTrackerEvents = pgTable(
  "cc_tracker_events",
  {
    id: serial("id").primaryKey(),
    visitorId: integer("visitor_id").references(() => ccVisitors.id, { onDelete: "set null" }),
    anonId: text("anon_id"),
    eventName: text("event_name").notNull(),
    url: text("url"),
    properties: jsonb("properties"),
    sessionId: text("session_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    visitorIdx: index("cc_tracker_events_visitor_idx").on(t.visitorId),
    occurredIdx: index("cc_tracker_events_occurred_idx").on(t.occurredAt),
  }),
);

export const ccConversions = pgTable(
  "cc_conversions",
  {
    id: serial("id").primaryKey(),
    visitorId: integer("visitor_id").references(() => ccVisitors.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeCustomerId: text("stripe_customer_id"),
    amountCents: integer("amount_cents").notNull().default(0),
    productType: text("product_type").notNull().default("standard"),
    productSlugs: text("product_slugs"),
    channel: text("channel"),
    campaignType: text("campaign_type"),
    attributionModel: text("attribution_model").notNull().default("last_touch"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    fbclid: text("fbclid"),
    gclid: text("gclid"),
    metaCapiPushed: boolean("meta_capi_pushed").notNull().default(false),
    googleOfflinePushed: boolean("google_offline_pushed").notNull().default(false),
    isRefund: boolean("is_refund").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    piUq: uniqueIndex("cc_conversions_pi_uq").on(t.stripePaymentIntentId),
    visitorIdx: index("cc_conversions_visitor_idx").on(t.visitorId),
    emailIdx: index("cc_conversions_email_idx").on(t.email),
    occurredIdx: index("cc_conversions_occurred_idx").on(t.occurredAt),
    channelIdx: index("cc_conversions_channel_idx").on(t.channel),
  }),
);

export const ccDailyAttribution = pgTable(
  "cc_daily_attribution",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull(),
    channel: text("channel").notNull(),
    campaignType: text("campaign_type"),
    // NOT NULL + default '' so the unique index below can use plain columns.
    // A COALESCE(utm_campaign, '') expression index trips the publish-time
    // migration generator into emitting an invalid operator class
    // (date_ops on a text column), which blocks deploys.
    utmCampaign: text("utm_campaign").notNull().default(""),
    conversions: integer("conversions").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
    uniqueVisitors: integer("unique_visitors").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dayChannelUq: uniqueIndex("cc_daily_attr_day_channel_uq").on(
      t.day,
      t.channel,
      t.utmCampaign,
    ),
    dayIdx: index("cc_daily_attr_day_idx").on(t.day),
  }),
);

export const ccDailyProfit = pgTable(
  "cc_daily_profit",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull().unique(),
    revenueLowTicketCents: integer("revenue_low_ticket_cents").notNull().default(0),
    revenueHighTicketCents: integer("revenue_high_ticket_cents").notNull().default(0),
    revenueOtherCents: integer("revenue_other_cents").notNull().default(0),
    metaSpendCents: integer("meta_spend_cents").notNull().default(0),
    googleSpendCents: integer("google_spend_cents").notNull().default(0),
    stripeFeeCents: integer("stripe_fee_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    otherCostsCents: integer("other_costs_cents").notNull().default(0),
    notes: text("notes"),
    metaSpendSource: text("meta_spend_source").notNull().default("manual"),
    googleSpendSource: text("google_spend_source").notNull().default("manual"),
    revenueSource: text("revenue_source").notNull().default("stripe"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dayIdx: index("cc_daily_profit_day_idx").on(t.day),
  }),
);

export const ccTeamMembers = pgTable(
  "cc_team_members",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    email: text("email"),
    slackHandle: text("slack_handle"),
    timezone: text("timezone").notNull().default("UTC"),
    activeHoursStart: integer("active_hours_start").notNull().default(9),
    activeHoursEnd: integer("active_hours_end").notNull().default(18),
    avatarUrl: text("avatar_url"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export type CcVisitor = typeof ccVisitors.$inferSelect;
export type CcTouchpoint = typeof ccTouchpoints.$inferSelect;
export type CcTrackerEvent = typeof ccTrackerEvents.$inferSelect;
export type CcConversion = typeof ccConversions.$inferSelect;
export type CcDailyAttribution = typeof ccDailyAttribution.$inferSelect;
export type CcDailyProfit = typeof ccDailyProfit.$inferSelect;
export type CcTeamMember = typeof ccTeamMembers.$inferSelect;
