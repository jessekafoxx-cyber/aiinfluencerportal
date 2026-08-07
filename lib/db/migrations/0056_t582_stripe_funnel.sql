-- Task #582: switch funnel from Whop to Stripe end-to-end.
--
-- 1. Extend the orders.payment_source_type CHECK domain with the new
--    Stripe sources (verified payment, subscription active, reconciler).
-- 2. Add orders.stripe_default_payment_method_id so off-session upsell
--    charges can re-use the buyer's saved card without re-creating a
--    SetupIntent on every step.
-- 3. Create stripe_processed_events for webhook idempotency. Every event
--    we successfully process inserts a row keyed by Stripe event id.
--    Re-deliveries no-op via ON CONFLICT DO NOTHING.
--
-- Contains an UPDATE-free schema-only delta. Safe to apply via the
-- migration runner OR drizzle-kit push, but the migration runner is
-- still the canonical path because the next ones in the series may add
-- backfills that drizzle-kit silently skips (Task #512 trap).

-- ----- 1. Provenance enum extension --------------------------------------
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_source_type_chk;
ALTER TABLE orders ADD CONSTRAINT orders_payment_source_type_chk CHECK (
  payment_source_type IS NULL OR payment_source_type IN (
    'stripe_verified_payment',
    'stripe_subscription_active',
    'stripe_reconciler',
    'stripe_free_promo',
    'whop_verified_payment',
    'whop_free_promo',
    'whop_reconciler',
    'whop_setup_account_fallback',
    'whop_enrollment_sync',
    'platinum_founder_code',
    'admin_grant',
    'migration_backfill'
  )
);

-- The receipt-id invariant from 0052 was Whop-specific. Replace it with
-- the general "receipt_verified=true => some processor receipt id is on
-- the row" rule. For Stripe sources the receipt id lives in
-- orders.stripe_payment_intent_id. For Whop sources it lives in
-- orders.whop_receipt_id. Either satisfies the invariant.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_receipt_verified_implies_receipt_id;
ALTER TABLE orders ADD CONSTRAINT orders_receipt_verified_implies_receipt_id CHECK (
  receipt_verified = false
  OR whop_receipt_id IS NOT NULL
  OR stripe_payment_intent_id IS NOT NULL
);

-- The payment-verified invariant from 0052 required a whop_* source.
-- Now any verified source (stripe_* or whop_*) qualifies.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_verified_requires_processor;
ALTER TABLE orders ADD CONSTRAINT orders_payment_verified_requires_processor CHECK (
  payment_verified = false
  OR payment_source_type IN (
    'stripe_verified_payment',
    'stripe_subscription_active',
    'stripe_reconciler',
    'stripe_free_promo',
    'whop_verified_payment',
    'whop_free_promo',
    'whop_reconciler',
    'whop_setup_account_fallback',
    'whop_enrollment_sync'
  )
);

-- ----- 2. Saved card for off-session upsells -----------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Refresh the partial index from 0052 so the new sources are included.
DROP INDEX IF EXISTS orders_verified_payment_idx;
CREATE INDEX orders_verified_payment_idx ON orders (created_at DESC)
  WHERE main_product_paid = true
    AND payment_verified = true
    AND payment_source_type IN (
      'stripe_verified_payment',
      'stripe_subscription_active',
      'whop_verified_payment'
    );

-- ----- 3. Webhook idempotency table -------------------------------------
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  order_id text,
  livemode boolean NOT NULL,
  processed_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_processed_events_order_idx
  ON stripe_processed_events (order_id);
CREATE INDEX IF NOT EXISTS stripe_processed_events_processed_at_idx
  ON stripe_processed_events (processed_at DESC);
