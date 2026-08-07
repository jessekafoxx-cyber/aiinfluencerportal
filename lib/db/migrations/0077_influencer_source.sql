-- Add a `source` column to ai_influencers so the portal can distinguish
-- AI-generated influencers (the default, fed by the queue + Viktor
-- pipeline) from buyer-uploaded "manual" rows. Manual rows skip the
-- generation cap, skip payment, and are NOT eligible for scene swaps
-- / Viktor pipeline runs. Publish-safe: ADD COLUMN with a default so
-- existing rows backfill to 'generated' transparently.
ALTER TABLE ai_influencers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'generated';
