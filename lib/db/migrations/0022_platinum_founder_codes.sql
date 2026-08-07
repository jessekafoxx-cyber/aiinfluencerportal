-- Task #227: Platinum Founder Codes
--
-- One row per Platinum Club subscriber. Issuance is triggered by the Whop
-- webhook handler when orders.upsell3Paid flips true. Pure schema-only
-- migration (no UPDATE blocks) so it is safe to apply via either the
-- migration runner or `drizzle-kit push`.

CREATE TABLE IF NOT EXISTS "platinum_founder_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "owner_email" text NOT NULL UNIQUE,
  "owner_user_id" text,
  "owner_order_id" text,
  "status" text NOT NULL DEFAULT 'unredeemed',
  "redeemed_for_product_slug" text,
  "redeemed_for_order_id" text,
  "redeemed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "platinum_founder_codes_status_idx"
  ON "platinum_founder_codes" ("status");
CREATE INDEX IF NOT EXISTS "platinum_founder_codes_owner_order_idx"
  ON "platinum_founder_codes" ("owner_order_id");
CREATE INDEX IF NOT EXISTS "platinum_founder_codes_owner_user_idx"
  ON "platinum_founder_codes" ("owner_user_id");

-- For pre-existing deployments: ensure the column exists if the table
-- was already created without it (e.g. via a partial earlier push).
ALTER TABLE "platinum_founder_codes"
  ADD COLUMN IF NOT EXISTS "owner_user_id" text;
