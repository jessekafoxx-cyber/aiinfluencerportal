-- Task #584: migrate affiliate tracking from Whop Affiliate Program (WAP)
-- to FirstPromoter (account m7q449xz).
--
-- Schema-only delta. Adds nullable columns so existing inserts and
-- selects continue to compile/run untouched. No UPDATE/DELETE blocks,
-- so this migration is safe via either drizzle-kit push OR the
-- migration runner.
--
-- Columns added:
--   orders.firstpromoter_referral_id        -- tid captured from ?fpr= cookie at checkout
--   orders.firstpromoter_promoter_id        -- FP promoter id (resolved later, optional)
--   orders.firstpromoter_attributed_at      -- when the referral was stamped on the order
--
--   funnel_leads.firstpromoter_referral_id  -- tid captured at lead-form submit
--
--   coaching_agreements.firstpromoter_referral_id  -- tid captured on /coaching/create
--
--   portal_users.firstpromoter_promoter_id   -- FP promoter id once auto-provisioned
--   portal_users.firstpromoter_referral_code -- FP cust_id / referral code (the ?fpr= value)

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS firstpromoter_referral_id   TEXT,
  ADD COLUMN IF NOT EXISTS firstpromoter_promoter_id   TEXT,
  ADD COLUMN IF NOT EXISTS firstpromoter_attributed_at TIMESTAMP;

ALTER TABLE funnel_leads
  ADD COLUMN IF NOT EXISTS firstpromoter_referral_id TEXT;

ALTER TABLE coaching_agreements
  ADD COLUMN IF NOT EXISTS firstpromoter_referral_id TEXT;

ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS firstpromoter_promoter_id   TEXT,
  ADD COLUMN IF NOT EXISTS firstpromoter_referral_code TEXT;

-- Helpful lookups: find the order by FP referral id (used by the
-- admin visibility page and by the FP sale-event idempotency guard).
CREATE INDEX IF NOT EXISTS orders_firstpromoter_referral_idx
  ON orders (firstpromoter_referral_id)
  WHERE firstpromoter_referral_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS portal_users_firstpromoter_promoter_idx
  ON portal_users (firstpromoter_promoter_id)
  WHERE firstpromoter_promoter_id IS NOT NULL;
