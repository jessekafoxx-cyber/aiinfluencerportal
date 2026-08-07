-- Task #837: fractional video-credit ledger via 1/100-credit sub-units.
-- Nullable for publish-safe rollout; backfilled by a standalone script.
ALTER TABLE "video_credits" ADD COLUMN IF NOT EXISTS "balance_subunits" integer;
ALTER TABLE "video_credit_transactions" ADD COLUMN IF NOT EXISTS "amount_subunits" integer;
ALTER TABLE "video_credit_transactions" ADD COLUMN IF NOT EXISTS "balance_after_subunits" integer;
