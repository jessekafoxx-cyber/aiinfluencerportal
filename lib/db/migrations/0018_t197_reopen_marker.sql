-- Task #200: legacy migration + fresh cohort verification.
-- Adds a dedicated reopen-cohort marker for the T197 backfill so the
-- dashboard can distinguish a T200-style verification reopen (legacy
-- failed/dismissed rows reactivated to flow through the new recovery
-- pipeline) from a regular auth-failure requeue tracked by
-- media_reopened_at_t187. Idempotent and additive.
ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS reopened_at_t197 timestamptz;
