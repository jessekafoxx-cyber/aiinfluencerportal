-- Inline rename for AI Influencers.
-- Adds a nullable buyer-supplied display name. API responses fold
-- custom_name into the `name` field when set so every existing UI
-- reflects the rename without code changes; the raw `name` column
-- is left alone so the partial unique index
-- `ai_influencers_client_autoname_uq` (which keys off
-- `name LIKE 'Influencer %'`) continues to dedupe auto-named rows
-- on finalize replay. Existing rows = NULL (UI falls back to the
-- auto-generated name as before).
ALTER TABLE ai_influencers
  ADD COLUMN IF NOT EXISTS custom_name text;
