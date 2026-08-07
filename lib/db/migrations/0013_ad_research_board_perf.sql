-- Task #137 (next-stage scaling pass): DB efficiency, throughput control,
-- prioritization, and historical metrics for the Daily Ad Research Board
-- queue. All changes are idempotent and safe to re-run.
--
-- 1. Indexes that accelerate the hot queue paths (claim, recover, health)
--    so adding rows scales linearly instead of forcing full table scans.
-- 2. media_priority column for lightweight job prioritization. Lower
--    numbers = higher priority. Manual refetch / fresh sync rows are
--    inserted with priority 10 / 20; retries default to 50; stale lease
--    recoveries to 80.
-- 3. queue_metrics table that the downloader writes a snapshot row to
--    every 5 minutes, powering the dashboard's trend charts without
--    needing a separate metrics service.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS media_priority integer NOT NULL DEFAULT 50;

-- Composite index that matches the candidate-selection WHERE clause.
-- Postgres can use it for both the "claimable lease" and "claimable
-- status" branches because it leads with dismissed (the most selective
-- filter for the dashboard) and includes the two queue-relevant cols.
CREATE INDEX IF NOT EXISTS ad_research_board_items_queue_idx
  ON ad_research_board_items (dismissed, media_status, media_priority, media_attempts);

-- Partial index that targets only the "lease in flight" rows. Most rows
-- have NULL media_lease_until (terminal state), so a partial index keeps
-- the index small (one entry per active lease) and makes the lease-recovery
-- predicate cheap regardless of total table size.
CREATE INDEX IF NOT EXISTS ad_research_board_items_lease_until_idx
  ON ad_research_board_items (media_lease_until)
  WHERE media_lease_until IS NOT NULL;

-- Partial index for the "active worker" group-by in queue-health. Rows
-- without a live lease are excluded, keeping this index minimal.
CREATE INDEX IF NOT EXISTS ad_research_board_items_lease_owner_idx
  ON ad_research_board_items (media_lease_owner)
  WHERE media_lease_owner IS NOT NULL;

-- Powers the recent-failures and processing-latency selects in
-- getQueueHealth (they sort by updated_at desc with a media_status
-- filter). Composite (status, updated_at desc) so Postgres can do an
-- index-only scan for both branches.
CREATE INDEX IF NOT EXISTS ad_research_board_items_status_updated_idx
  ON ad_research_board_items (media_status, updated_at DESC);

-- Powers the throughput counters (mediaStatus='ok' AND mediaDownloadedAt
-- >= cutoff). Partial index because we only ever count rows that have
-- a downloaded_at, and only the 'ok' branch matters for throughput.
CREATE INDEX IF NOT EXISTS ad_research_board_items_downloaded_at_idx
  ON ad_research_board_items (media_downloaded_at)
  WHERE media_status = 'ok';

-- Historical queue-metrics snapshots. Written every 5 minutes by the
-- downloader's recordQueueMetricsSnapshot loop. Powers the dashboard's
-- trend charts (throughput, error rate, queue depth, processing time)
-- without re-aggregating raw rows on every poll.
CREATE TABLE IF NOT EXISTS ad_research_board_queue_metrics (
  id bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  status_pending integer NOT NULL DEFAULT 0,
  status_downloading integer NOT NULL DEFAULT 0,
  status_ok integer NOT NULL DEFAULT 0,
  status_failed integer NOT NULL DEFAULT 0,
  status_partial integer NOT NULL DEFAULT 0,
  stuck integer NOT NULL DEFAULT 0,
  active_leases integer NOT NULL DEFAULT 0,
  throughput_1h integer NOT NULL DEFAULT 0,
  throughput_24h integer NOT NULL DEFAULT 0,
  failures_1h integer NOT NULL DEFAULT 0,
  avg_processing_ms integer,
  p95_processing_ms integer
);

CREATE INDEX IF NOT EXISTS ad_research_board_queue_metrics_captured_at_idx
  ON ad_research_board_queue_metrics (captured_at DESC);
