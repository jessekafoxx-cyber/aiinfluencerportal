-- Task #662: GoHighLevel direct enrollment webhook.
--
-- GoHighLevel now owns checkout / upsell / thank-you for the
-- AI Influencer Masterclass ($27 main offer). When a buyer completes
-- purchase inside GHL, GHL POSTs to `/api/portal/ghl/enroll` and our
-- backend (a) creates an `orders` row with `main_product_paid=true`,
-- (b) sends the Clerk invitation + welcome email so the buyer can
-- sign into the portal.
--
-- To keep paid-state provenance honest (Tasks #551 / #582):
--
--   1. Add `orders.ghl_order_id` to store the GHL invoice / contact id
--      that the webhook arrives with. This is the "receipt id" for the
--      GHL provenance source - the analogue of `stripe_payment_intent_id`
--      or the legacy `whop_receipt_id`.
--
--   2. Extend `orders_payment_source_type_chk` with `ghl_verified_payment`
--      so the provenance helper can stamp it.
--
--   3. Extend `orders_receipt_verified_implies_receipt_id` so a row with
--      `receipt_verified=true` is satisfied by `ghl_order_id IS NOT NULL`
--      in addition to the existing Stripe / Whop receipt id columns.
--
--   4. Extend `orders_payment_verified_requires_processor` so a row with
--      `payment_verified=true` may carry source `ghl_verified_payment`.
--
-- Schema-only delta (no UPDATE). Safe to apply via the migration runner
-- OR via Publish (drizzle-kit push). No backfill needed - existing rows
-- continue to use the existing provenance sources.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ghl_order_id text;

CREATE INDEX IF NOT EXISTS orders_ghl_order_id_idx ON orders (ghl_order_id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_source_type_chk;
ALTER TABLE orders ADD CONSTRAINT orders_payment_source_type_chk CHECK (
  payment_source_type IS NULL OR payment_source_type IN (
    'stripe_verified_payment',
    'stripe_subscription_active',
    'stripe_reconciler',
    'stripe_free_promo',
    'ghl_verified_payment',
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

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_receipt_verified_implies_receipt_id;
ALTER TABLE orders ADD CONSTRAINT orders_receipt_verified_implies_receipt_id CHECK (
  receipt_verified = false
  OR whop_receipt_id IS NOT NULL
  OR stripe_payment_intent_id IS NOT NULL
  OR ghl_order_id IS NOT NULL
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_verified_requires_processor;
ALTER TABLE orders ADD CONSTRAINT orders_payment_verified_requires_processor CHECK (
  payment_verified = false
  OR payment_source_type IN (
    'stripe_verified_payment',
    'stripe_subscription_active',
    'stripe_reconciler',
    'stripe_free_promo',
    'ghl_verified_payment',
    'whop_verified_payment',
    'whop_free_promo',
    'whop_reconciler',
    'whop_setup_account_fallback',
    'whop_enrollment_sync'
  )
);
