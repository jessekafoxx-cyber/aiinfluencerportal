-- Task #158: per-provider observability columns on the queue metrics
-- snapshot table. Additive only; the dashboard reads them via
-- getQueueHealth (live, in-process) and getQueueTrends (historical).
-- Idempotent; safe to re-run.

ALTER TABLE ad_research_board_queue_metrics
  ADD COLUMN IF NOT EXISTS apify_success_t158        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ytdlp_success_t158        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_count_t158     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_recovered_t158 integer NOT NULL DEFAULT 0;
