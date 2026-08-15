-- Task #14: add the two columns the stale-failure terminalization sweep
-- writes but that were never added to the schema or a migration.  Without
-- these columns every sweep attempt throws a DB error and logs a WARN every
-- ~5 minutes in both dev and production.
--
-- dismissed_reason  TEXT NULL
--   Short machine-readable tag: 'media_retry_exhausted' (sweep) or
--   'admin_skip' (manual). Nullable so pre-existing dismissed rows do not
--   require a backfill to remain valid.
--
-- dismissed_at  TIMESTAMPTZ NULL
--   Wall-clock timestamp of when the row was first dismissed.  The sweep
--   uses COALESCE so the original timestamp survives re-sweeps on rows that
--   were partially written before this column existed.

ALTER TABLE "ad_research_board_items"
  ADD COLUMN IF NOT EXISTS "dismissed_reason" text,
  ADD COLUMN IF NOT EXISTS "dismissed_at"     timestamptz;
