-- Room30 Command Center: attribution tracking + P&L tables.
-- cc_visitors      — anon visitor identity, merged by email on /api/identify
-- cc_touchpoints   — UTM/fbclid/gclid pageview events from /api/track
-- cc_tracker_events — custom named events from /api/event
-- cc_conversions   — paid purchase records, linked to visitor attribution
-- cc_daily_attribution — nightly channel rollup (populated by scheduler)
-- cc_daily_profit  — daily P&L rows (Stripe revenue + manual ad spend)
-- cc_team_members  — Team Hub members (name, role, timezone, active hours)

CREATE TABLE IF NOT EXISTS "cc_visitors" (
  "id" serial PRIMARY KEY NOT NULL,
  "anon_id" text NOT NULL,
  "email" text,
  "first_name" text,
  "last_name" text,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "merged_into_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cc_visitors_anon_id_uq" UNIQUE("anon_id")
);

CREATE INDEX IF NOT EXISTS "cc_visitors_email_idx" ON "cc_visitors" ("email");

CREATE TABLE IF NOT EXISTS "cc_touchpoints" (
  "id" serial PRIMARY KEY NOT NULL,
  "visitor_id" integer NOT NULL REFERENCES "cc_visitors"("id") ON DELETE CASCADE,
  "session_id" text,
  "url" text,
  "referrer" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "utm_term" text,
  "fbclid" text,
  "gclid" text,
  "channel" text,
  "campaign_type" text,
  "ip_address" text,
  "user_agent" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cc_touchpoints_visitor_idx" ON "cc_touchpoints" ("visitor_id");
CREATE INDEX IF NOT EXISTS "cc_touchpoints_occurred_idx" ON "cc_touchpoints" ("occurred_at");
CREATE INDEX IF NOT EXISTS "cc_touchpoints_channel_idx" ON "cc_touchpoints" ("channel");

CREATE TABLE IF NOT EXISTS "cc_tracker_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "visitor_id" integer REFERENCES "cc_visitors"("id") ON DELETE SET NULL,
  "anon_id" text,
  "event_name" text NOT NULL,
  "url" text,
  "properties" jsonb,
  "session_id" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cc_tracker_events_visitor_idx" ON "cc_tracker_events" ("visitor_id");
CREATE INDEX IF NOT EXISTS "cc_tracker_events_occurred_idx" ON "cc_tracker_events" ("occurred_at");

CREATE TABLE IF NOT EXISTS "cc_conversions" (
  "id" serial PRIMARY KEY NOT NULL,
  "visitor_id" integer REFERENCES "cc_visitors"("id") ON DELETE SET NULL,
  "email" text NOT NULL,
  "stripe_payment_intent_id" text,
  "stripe_customer_id" text,
  "amount_cents" integer NOT NULL DEFAULT 0,
  "product_type" text NOT NULL DEFAULT 'standard',
  "product_slugs" text,
  "channel" text,
  "campaign_type" text,
  "attribution_model" text NOT NULL DEFAULT 'last_touch',
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "fbclid" text,
  "gclid" text,
  "meta_capi_pushed" boolean NOT NULL DEFAULT false,
  "google_offline_pushed" boolean NOT NULL DEFAULT false,
  "is_refund" boolean NOT NULL DEFAULT false,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cc_conversions_pi_uq" UNIQUE("stripe_payment_intent_id")
);

CREATE INDEX IF NOT EXISTS "cc_conversions_visitor_idx" ON "cc_conversions" ("visitor_id");
CREATE INDEX IF NOT EXISTS "cc_conversions_email_idx" ON "cc_conversions" ("email");
CREATE INDEX IF NOT EXISTS "cc_conversions_occurred_idx" ON "cc_conversions" ("occurred_at");
CREATE INDEX IF NOT EXISTS "cc_conversions_channel_idx" ON "cc_conversions" ("channel");

CREATE TABLE IF NOT EXISTS "cc_daily_attribution" (
  "id" serial PRIMARY KEY NOT NULL,
  "day" date NOT NULL,
  "channel" text NOT NULL,
  "campaign_type" text,
  "utm_campaign" text,
  "conversions" integer NOT NULL DEFAULT 0,
  "revenue_cents" integer NOT NULL DEFAULT 0,
  "unique_visitors" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "cc_daily_attr_day_channel_uq"
  ON "cc_daily_attribution" ("day", "channel", COALESCE("utm_campaign", ''));
CREATE INDEX IF NOT EXISTS "cc_daily_attr_day_idx" ON "cc_daily_attribution" ("day");

CREATE TABLE IF NOT EXISTS "cc_daily_profit" (
  "id" serial PRIMARY KEY NOT NULL,
  "day" date NOT NULL,
  "revenue_low_ticket_cents" integer NOT NULL DEFAULT 0,
  "revenue_high_ticket_cents" integer NOT NULL DEFAULT 0,
  "revenue_other_cents" integer NOT NULL DEFAULT 0,
  "meta_spend_cents" integer NOT NULL DEFAULT 0,
  "google_spend_cents" integer NOT NULL DEFAULT 0,
  "stripe_fee_cents" integer NOT NULL DEFAULT 0,
  "vat_cents" integer NOT NULL DEFAULT 0,
  "other_costs_cents" integer NOT NULL DEFAULT 0,
  "notes" text,
  "meta_spend_source" text NOT NULL DEFAULT 'manual',
  "google_spend_source" text NOT NULL DEFAULT 'manual',
  "revenue_source" text NOT NULL DEFAULT 'stripe',
  "refreshed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cc_daily_profit_day_unique" UNIQUE("day")
);

CREATE INDEX IF NOT EXISTS "cc_daily_profit_day_idx" ON "cc_daily_profit" ("day");

CREATE TABLE IF NOT EXISTS "cc_team_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "email" text,
  "slack_handle" text,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "active_hours_start" integer NOT NULL DEFAULT 9,
  "active_hours_end" integer NOT NULL DEFAULT 18,
  "avatar_url" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
