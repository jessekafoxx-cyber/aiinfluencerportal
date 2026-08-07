-- Task #197: production-hardening of the Ad Research extraction
-- pipeline. All columns added here are additive and idempotent so
-- this migration is safe to re-run and matches the schema produced
-- by `drizzle-kit push` against `lib/db/src/schema/ad-research-board.ts`.
--
-- 1) ad_research_board_items: normalized recovery taxonomy + delayed
--    retry gate + dual raw/normalized URL persistence.
-- 2) ad_research_board_queue_metrics: 7 new operational counters
--    powering the Recovery Pipeline panel + per-actor success map.
-- 3) ad_research_board_sync_status: persisted verification benchmark
--    surfaced on the dashboard so the operator can prove the
--    recovery pipeline produced a real before/after delta.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS recovery_class_t197 text,
  ADD COLUMN IF NOT EXISTS recovery_strategy_t197 text,
  ADD COLUMN IF NOT EXISTS retry_after_at_t197 timestamptz,
  ADD COLUMN IF NOT EXISTS raw_url_t197 text,
  ADD COLUMN IF NOT EXISTS normalized_url_t197 text;

ALTER TABLE ad_research_board_queue_metrics
  ADD COLUMN IF NOT EXISTS invalid_urls_blocked_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_content_dismissed_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delayed_retries_scheduled_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS temporary_recoveries_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auth_recoveries_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extractor_recoveries_t197 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_recovery_latency_ms_t197 integer,
  ADD COLUMN IF NOT EXISTS per_actor_success_t197 jsonb;

ALTER TABLE ad_research_board_sync_status
  ADD COLUMN IF NOT EXISTS last_verification_benchmark_t197 jsonb,
  ADD COLUMN IF NOT EXISTS last_verification_benchmark_at_t197 timestamptz;

-- Task #197: backfill - any pre-existing row that was marked
-- failed+dismissed because the URL was structurally unsupported
-- gets transitioned to the new dedicated `invalid` mediaStatus AND
-- stamped with recovery_class='invalid-input'/strategy so the
-- dashboard counters, the pre-claim SELECT, and the sync-upsert
-- "corrected URL re-opens the row" path all see a single
-- consistent representation.
UPDATE ad_research_board_items
   SET media_status = 'invalid',
       recovery_class_t197 = COALESCE(recovery_class_t197, 'invalid-input'),
       recovery_strategy_t197 = COALESCE(recovery_strategy_t197, 'permanent-dismiss-invalid')
 WHERE dismissed = true
   AND media_error_class = 'unsupported-url'
   AND media_status IN ('failed', 'invalid');

-- Task #197: dual raw + normalized URL backfill for pre-existing
-- rows. Until the next sheet sync runs, every legacy row has NULL
-- raw_url/normalized_url even though the queue worker now reads
-- COALESCE(normalized_url, ad_link). Seed both columns from the
-- existing ad_link so canonicalization works out of the gate. The
-- next sync will overwrite normalized_url with the properly
-- normalized form for any row whose ad_link has changed.
UPDATE ad_research_board_items
   SET raw_url_t197 = ad_link
 WHERE raw_url_t197 IS NULL
   AND ad_link IS NOT NULL;
UPDATE ad_research_board_items
   SET normalized_url_t197 = ad_link
 WHERE normalized_url_t197 IS NULL
   AND ad_link IS NOT NULL;
