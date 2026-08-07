-- Task #200: legacy failed-row reopen policy.
-- One-shot, idempotent backfill that reactivates every legacy
-- `media_status='failed'` ad_research_board_items row whose error
-- class is NOT in the permanent-dismiss buckets (invalid-input or
-- dead-content). Rows are reset to a clean pending state, lease
-- columns are cleared, attempts is reset to 0, dismissal is lifted,
-- and `reopened_at_t197` is stamped so the verification cohort is
-- distinguishable from baseline traffic and from the T187
-- `media_reopened_at_t187` auth-failure cohort.
--
-- The recovery_class_t197 / recovery_strategy_t197 / retry_after_at_t197
-- columns are reset to NULL so the worker's `persistResult` becomes
-- the single writer of the new pipeline state for these rows; the
-- T197 backfill UPDATE blocks already guaranteed raw_url_t197 +
-- normalized_url_t197 are populated so the pre-extraction normalizer
-- has data to act on.
--
-- This file is the canonical, committed record of the reopen policy
-- that was executed in dev as part of the T200 verification. Re-running
-- against a clean DB is a no-op for rows that no longer match the
-- predicate.
UPDATE ad_research_board_items
   SET media_status = 'pending',
       media_error = NULL,
       media_error_class = NULL,
       media_attempts = 0,
       dismissed = false,
       media_lease_owner = NULL,
       media_lease_until = NULL,
       retry_after_at_t197 = NULL,
       recovery_class_t197 = NULL,
       recovery_strategy_t197 = NULL,
       reopened_at_t197 = COALESCE(reopened_at_t197, now()),
       updated_at = now()
 WHERE media_status = 'failed'
   AND (
     media_error_class IS NULL
     OR media_error_class NOT IN (
       'unsupported-url',
       'invalid-url',
       'dead-media',
       'private-content'
     )
   )
   -- Exclude permanently exhausted rows. The retry ceiling is
   -- `MAX_ATTEMPTS = 4` in
   -- artifacts/api-server/src/lib/media-downloader-helpers.ts;
   -- rows at or above the cap have already exhausted the configured
   -- 10m / 30m / 1h / 6h ladder (`computeRetrySchedule` returns
   -- `exhausted: true` and a permanent-dismiss strategy at that
   -- point). Reopening them would reintroduce retry churn against
   -- URLs the pipeline has already deemed terminally unrecoverable.
   AND COALESCE(media_attempts, 0) < 4;
