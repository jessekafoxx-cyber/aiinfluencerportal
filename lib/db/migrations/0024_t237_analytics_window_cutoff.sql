-- Task #237 (window-only reset): operator-set "fresh start" cutoff for
-- the 24h-windowed Queue Health views.
--
-- When this column is non-NULL, every query in `getQueueHealth()` that
-- would otherwise floor at `now() - 24h` is clamped to MAX(now-24h,
-- analytics_window_cutoff_t237). The underlying ad_research_board_items
-- rows are NEVER touched - only the rolling-window views (Failure
-- Breakdown, Recent Failures, Processing Latency, throughput,
-- terminalFailures / dismissed24h / retrying tiles) start fresh from
-- this timestamp.
--
-- Idempotent: safe to re-run via the migration runner.

ALTER TABLE ad_research_board_sync_status
  ADD COLUMN IF NOT EXISTS analytics_window_cutoff_t237 timestamptz;
