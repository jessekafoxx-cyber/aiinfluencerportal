-- Task #315: Live Whop affiliate leaderboard.
-- Adds the per-student Whop affiliate username mapping, the synced
-- affiliate commissions store, the manual (off-Whop) commissions store,
-- and a tiny key/value app_settings table that backs the admin-only
-- feature flag for flipping the leaderboard live to all users.

ALTER TABLE "portal_users"
  ADD COLUMN IF NOT EXISTS "whop_affiliate_username" text;

CREATE TABLE IF NOT EXISTS "affiliate_commissions" (
  "id" serial PRIMARY KEY,
  "affiliate_username" text NOT NULL,
  "whop_payment_id" text NOT NULL,
  "whop_product_id" text,
  "product_label" text NOT NULL,
  "sale_amount" integer NOT NULL,
  "commission_amount" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'usd',
  "refunded" boolean NOT NULL DEFAULT false,
  "refunded_amount" integer NOT NULL DEFAULT 0,
  "sale_at" timestamp NOT NULL,
  "raw" jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_payment_product_idx"
  ON "affiliate_commissions" ("whop_payment_id", COALESCE("whop_product_id", ''));

CREATE INDEX IF NOT EXISTS "affiliate_commissions_username_idx"
  ON "affiliate_commissions" (lower("affiliate_username"));

CREATE INDEX IF NOT EXISTS "affiliate_commissions_sale_at_idx"
  ON "affiliate_commissions" ("sale_at");

CREATE TABLE IF NOT EXISTS "manual_commissions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "product_label" text NOT NULL,
  "commission_amount" integer NOT NULL,
  "sale_date" timestamp NOT NULL,
  "note" text,
  "created_by_user_id" integer,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "manual_commissions_user_idx"
  ON "manual_commissions" ("user_id");

CREATE INDEX IF NOT EXISTS "manual_commissions_sale_date_idx"
  ON "manual_commissions" ("sale_date");

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" text,
  "updated_at" timestamp DEFAULT now()
);

INSERT INTO "app_settings" ("key", "value")
  VALUES ('affiliate_leaderboard_public', 'false')
  ON CONFLICT ("key") DO NOTHING;
