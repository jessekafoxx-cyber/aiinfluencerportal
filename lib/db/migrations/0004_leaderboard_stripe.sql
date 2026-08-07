-- Leaderboard: support Stripe restricted keys alongside Whop (task #56).
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE leaderboard_profiles
  ADD COLUMN IF NOT EXISTS stripe_api_key   text,
  ADD COLUMN IF NOT EXISTS payment_provider text;

UPDATE leaderboard_profiles
   SET payment_provider = 'whop'
 WHERE payment_provider IS NULL
   AND whop_api_key IS NOT NULL
   AND is_connected = true;

COMMIT;
