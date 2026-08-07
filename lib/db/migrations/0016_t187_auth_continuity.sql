-- Task #187: auth-extraction continuity for the Research Boards.
-- Two additive columns; idempotent so this is safe to re-run.
--
-- 1) ad_research_board_items.media_reopened_at_t187:
--    Stamped by the admin "Reopen auth-failure rows" action on the
--    queue-health panel. Powers the cohort-based
--    `authFailureRecoveryRate` metric (rows reopened in last 24h that
--    later succeeded / total reopened in last 24h).
--
-- 2) ad_research_board_queue_metrics.ytdlp_auth_recoveries_t187:
--    Per-snapshot counter of yt-dlp successes that consumed an
--    authenticated cookie jar (IG/FB DB jar or env cookies file).
--    Surfaced on the dashboard as `ytDlpAuthenticatedRecoveries`.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS media_reopened_at_t187 timestamptz;

ALTER TABLE ad_research_board_queue_metrics
  ADD COLUMN IF NOT EXISTS ytdlp_auth_recoveries_t187 integer NOT NULL DEFAULT 0;
