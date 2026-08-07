-- Task #695: track manual super-admin deliveries / cleanups of AI
-- influencer generations from the new /admin/influencer-generations
-- console. Both columns are nullable; populated only when an admin
-- intervenes (mark-failed or manual-deliver). Backfill is intentional
-- no-op (legacy rows = never manually touched).
ALTER TABLE ai_influencer_jobs
  ADD COLUMN IF NOT EXISTS manually_delivered_by_clerk_id text,
  ADD COLUMN IF NOT EXISTS manually_delivered_at timestamptz;
