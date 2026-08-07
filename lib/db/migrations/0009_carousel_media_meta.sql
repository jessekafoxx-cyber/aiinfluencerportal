-- Track carousel-aware download diagnostics on the ad research board so the
-- portal can surface "captured X of Y slides" badges and the admin tools
-- can triage rows that silently downgraded a carousel to a single item.
ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS media_meta jsonb;
