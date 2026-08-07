-- Task #283: per-user flag tracking whether the buyer has seen the
-- one-time celebratory popup that announces the 5 bonus AR influencer
-- generations unlocked by Upsell 2. Default false so existing Upsell 2
-- buyers also see the popup on their next visit.
ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS upsell2_influencer_unlock_seen boolean NOT NULL DEFAULT false;

-- Task #283: drop the "1 free per client" partial unique index. Upsell 2
-- buyers now get up to 6 free-tier rows; the quota is enforced in the
-- route handler (resolveInfluencerQuota in routes/influencer-jobs.ts).
DROP INDEX IF EXISTS ai_influencer_jobs_free_tier_one_per_client_idx;
