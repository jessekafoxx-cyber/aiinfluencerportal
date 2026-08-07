-- Task #115: permanent dismissal for unrescuable Daily Research Board rows.
-- Adds a dismissed flag so rows that can't be downloaded after the full
-- retry/fallback chain (or that an admin manually skips) drop out of the
-- user view, the admin "Needs Fixing" list, and the failed counter — so
-- the "Retry Failed (N)" badge can actually reach zero.
-- Idempotent — safe to re-run.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS dismissed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ad_research_board_items_dismissed_idx
  ON ad_research_board_items (dismissed);
