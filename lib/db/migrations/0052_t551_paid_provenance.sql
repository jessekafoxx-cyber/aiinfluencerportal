-- Task #551 followup: paid-state provenance tracking.
--
-- Background: a verification audit found that ZERO rows in production
-- `orders` have a real `whop_receipt_id` after excluding admin/recovery/
-- portugal/room30 grants, yet 1090 organic orders had `main_product_paid
-- = true` in a 24h window. The cause: at least 8 separate code paths
-- across 4 files flip the paid flag, and most of them do not require
-- (or even have) a verified Whop receipt:
--
--   * whopWebhookHandlers.ts (lines 518, 629)   - canonical verified
--   * lib/free-promo-reconcile.ts (line 210)    - API-poll reconciler
--   * routes/portal.ts (lines 1447, 1670, 1682) - setup-account fallback
--                                                 + Whop-only enrollment
--                                                 synthetic-row sync
--   * lib/platinum-founder-codes.ts (lines 282, 292) - founder code
--                                                     redemption
--
-- They all wrote the same column with the same value, so the system
-- could not distinguish a real Whop-charged buyer from a $0 promo
-- recovery from a founder-code redeem from a manual admin grant.
-- That contaminated revenue analytics, zero-conversion alerting, and
-- (most importantly) the answer to the question "how many people
-- actually paid us money this week?".
--
-- This migration introduces four columns:
--
--   payment_source_type  - which code path flipped paid state (enum)
--   grant_reason         - free-form sub-reason within that source
--   payment_verified     - boolean: was provenance actually verified?
--   receipt_verified     - boolean: do we have a Whop receipt id on file?
--
-- Plus two CHECK constraints that lock the invariants:
--
--   receipt_verified=true  =>  whop_receipt_id IS NOT NULL
--   payment_verified=true  =>  payment_source_type IN (whop_*)
--
-- The application code refuses to write `main_product_paid=true`
-- without ALSO stamping a `payment_source_type` (enforced in TypeScript
-- by a shared helper). The constraints below are belt-and-suspenders
-- in case a future hand-written UPDATE or migration tries to flip the
-- flag without provenance.
--
-- Backfill heuristic (applied in one transaction at the bottom):
--
--   id LIKE 'admin-grant-%'       -> admin_grant
--   id LIKE 'room30-admin-grant-%' -> admin_grant
--   id LIKE 'portugal-grant-%'    -> admin_grant (reason=portugal_csv)
--   id LIKE 'recovery-%'          -> whop_reconciler (reason=backfill_recovery_id_prefix)
--   id LIKE 'whop-sync-%'         -> whop_enrollment_sync
--   whop_receipt_id IS NOT NULL   -> whop_verified_payment (payment_verified=true, receipt_verified=true)
--   whop_membership_id IS NOT NULL -> whop_free_promo (payment_verified=true)
--   else paid=true                -> migration_backfill (payment_verified=false, receipt_verified=false)
--
-- IMPORTANT: this migration contains UPDATE blocks (data backfill) and
-- MUST be applied via the migration runner OR executed directly as SQL
-- against the database. `drizzle-kit push` would silently skip the
-- UPDATE block, leaving the columns added but unbackfilled - the same
-- failure mode that gated the recovery from Task #197 and surfaced
-- again in Task #512.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_source_type text,
  ADD COLUMN IF NOT EXISTS grant_reason text,
  ADD COLUMN IF NOT EXISTS payment_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_verified boolean NOT NULL DEFAULT false;

-- Domain check on the source enum. Keeps the column free-form text in
-- the schema (no PG enum type rename headache later) but rejects typos
-- at write time.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_source_type_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_source_type_check
    CHECK (
      payment_source_type IS NULL
      OR payment_source_type IN (
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

-- Backfill before adding the receipt_verified / payment_verified
-- constraints so historic rows do not block them.
UPDATE orders SET
  payment_source_type = CASE
    WHEN id LIKE 'admin-grant-%' THEN 'admin_grant'
    WHEN id LIKE 'room30-admin-grant-%' THEN 'admin_grant'
    WHEN id LIKE 'portugal-grant-%' THEN 'admin_grant'
    WHEN id LIKE 'recovery-%' THEN 'whop_reconciler'
    WHEN id LIKE 'whop-sync-%' THEN 'whop_enrollment_sync'
    WHEN whop_receipt_id IS NOT NULL THEN 'whop_verified_payment'
    WHEN whop_membership_id IS NOT NULL THEN 'whop_free_promo'
    WHEN main_product_paid = true THEN 'migration_backfill'
    ELSE NULL
  END,
  grant_reason = CASE
    WHEN id LIKE 'portugal-grant-%' THEN 'portugal_csv_backfill'
    WHEN id LIKE 'admin-grant-%' THEN 'admin_grant_backfill'
    WHEN id LIKE 'room30-admin-grant-%' THEN 'room30_admin_grant_backfill'
    WHEN id LIKE 'recovery-%' THEN 'backfill_recovery_id_prefix'
    WHEN id LIKE 'whop-sync-%' THEN 'whop_only_enrollment_setup_account'
    WHEN main_product_paid = true
      AND whop_receipt_id IS NULL
      AND whop_membership_id IS NULL
      AND id NOT LIKE 'admin-grant-%'
      AND id NOT LIKE 'room30-admin-grant-%'
      AND id NOT LIKE 'portugal-grant-%'
      AND id NOT LIKE 'recovery-%'
      AND id NOT LIKE 'whop-sync-%'
      THEN 'pre_provenance_unverified'
    ELSE NULL
  END,
  payment_verified = CASE
    WHEN whop_receipt_id IS NOT NULL THEN true
    WHEN whop_membership_id IS NOT NULL THEN true
    WHEN id LIKE 'recovery-%' THEN true
    WHEN id LIKE 'whop-sync-%' THEN true
    ELSE false
  END,
  receipt_verified = (whop_receipt_id IS NOT NULL)
WHERE payment_source_type IS NULL;

-- Invariant 1: a row with receipt_verified=true MUST have a
-- whop_receipt_id. Prevents a future "I marked it verified but did not
-- write the id" regression.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_receipt_verified_implies_receipt_id;
ALTER TABLE orders
  ADD CONSTRAINT orders_receipt_verified_implies_receipt_id
    CHECK (NOT receipt_verified OR whop_receipt_id IS NOT NULL);

-- Invariant 2: a row with payment_verified=true MUST have a whop_*
-- source set (i.e. a Whop-side artefact was actually validated).
-- platinum_founder_code, admin_grant, and migration_backfill are NOT
-- considered "verified payment"; they are auditable grants.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_verified_implies_whop_source;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_verified_implies_whop_source
    CHECK (
      NOT payment_verified
      OR payment_source_type IN (
        'whop_verified_payment',
        'whop_free_promo',
        'whop_reconciler',
        'whop_setup_account_fallback',
        'whop_enrollment_sync'
      )
    );

-- Reporting index: revenue/conversion analytics filter exclusively on
-- (main_product_paid=true AND payment_source_type='whop_verified_payment')
-- and on (receipt_verified=true). Partial index keeps it small.
CREATE INDEX IF NOT EXISTS orders_verified_payment_idx
  ON orders (created_at DESC)
  WHERE main_product_paid = true
    AND payment_source_type = 'whop_verified_payment';

COMMIT;
