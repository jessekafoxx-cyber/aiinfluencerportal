-- Leaderboard: enforce payment_provider allowed values at the DB layer.
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE leaderboard_profiles
  DROP CONSTRAINT IF EXISTS leaderboard_profiles_payment_provider_check;

ALTER TABLE leaderboard_profiles
  ADD CONSTRAINT leaderboard_profiles_payment_provider_check
  CHECK (payment_provider IN ('stripe', 'whop') OR payment_provider IS NULL);

COMMIT;
