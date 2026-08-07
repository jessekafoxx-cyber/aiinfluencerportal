-- Ledger for "Buy more influencer generations" purchases ($29 each).
-- One row per successful Stripe PaymentIntent. The grant helper
-- INSERTs the row inside the same transaction that bumps
-- portal_users.bonus_influencer_quota by qty, so the UNIQUE on
-- stripe_payment_intent_id makes finalize + webhook + reconciler all
-- safe to replay concurrently (the second writer gets a uniqueness
-- conflict and short-circuits to a no-op).
--
-- status = 'paid' on insert. The Stripe refund webhook flips this to
-- 'refunded' and revokes any UNUSED credits (decrement bonus_quota by
-- min(qty, current_bonus)); credits already consumed by influencer
-- jobs are NOT clawed back, matching the existing portal-addon refund
-- posture.
CREATE TABLE IF NOT EXISTS "influencer_credit_purchases" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer NOT NULL,
  "qty" integer NOT NULL,
  "unit_amount_cents" integer NOT NULL,
  "total_amount_cents" integer NOT NULL,
  "stripe_payment_intent_id" text NOT NULL,
  "stripe_customer_id" text,
  "status" text DEFAULT 'paid' NOT NULL,
  "refunded_at" timestamp with time zone,
  "refunded_qty" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "influencer_credit_purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
  CONSTRAINT "influencer_credit_purchases_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "influencer_credit_purchases_portal_user_idx"
  ON "influencer_credit_purchases" USING btree ("portal_user_id");
