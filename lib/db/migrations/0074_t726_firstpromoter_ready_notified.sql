-- Task #726: one-shot gate column for the "your affiliate links are
-- live" portal notification + Resend email fired the first time a
-- buyer's FirstPromoter promoter resolves via getPromoterByEmail.
--
-- ADD COLUMN only - publish handles this cleanly. The data backfill
-- (set notified_at = now() for every row whose firstpromoter_referral_code
-- is already cached, so historical users don't get a retroactive email
-- blast) ships as a separate scripts/src helper:
--   pnpm --filter @workspace/scripts run backfill:firstpromoter-ready-notified
-- which must be run against PROD_DATABASE_URL after publish. The route
-- handlers are also defensive: maybeNotifyAffiliateReady() only fires
-- on the first cache write (was-null -> now-populated transition), so
-- a forgotten backfill cannot accidentally spam users with cached codes.
ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS firstpromoter_ready_notified_at timestamptz;
