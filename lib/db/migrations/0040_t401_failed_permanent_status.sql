-- Task #401: separate live vs historical health metrics for the Ads
-- research board. Introduces a `failed_permanent` media_status so rows
-- that have exhausted retries stop polluting the live health badge.
--
-- Old failures from deprecated extraction code currently stay as
-- mediaStatus='failed' with mediaAttempts >= MAX_ATTEMPTS forever, and
-- the 24h terminalLive query keeps flagging them every time the worker
-- restamps mediaOutcomeChangedAt during a sweep. After this migration
-- all exhausted-retry rows live under `failed_permanent`, which the
-- live-health computation ignores. New extraction failures keep using
-- `failed` while attempts < MAX_ATTEMPTS, then write `failed_permanent`
-- on the terminal attempt (see persistResult in media-downloader.ts).
--
-- NOTE: contains an UPDATE block. Per replit.md gotcha
-- ("Migrations with UPDATE blocks must run via the migration runner,
-- not push"), this file MUST be executed by the migration runner or as
-- direct SQL against the DB. `drizzle-kit push` will silently skip it.

-- 1. Backfill: any row that already exhausted its retry budget moves to
--    `failed_permanent`. The mediaOutcomeChangedAt timestamp is left
--    intact so the historical analytics view (24h window) still shows
--    when the row originally died, even though the live view stops
--    counting it.
UPDATE ad_research_board_items
SET media_status = 'failed_permanent'
WHERE media_status = 'failed'
  AND media_attempts >= 5; -- MAX_ATTEMPTS (see media-downloader-helpers)

-- 2. Helpful index for the live-health query: counting rows by status
--    excluding terminal/archived states. Existing media_status index
--    likely covers this, but an explicit partial index keeps the live
--    badge query fast even on a large table.
CREATE INDEX IF NOT EXISTS ad_research_board_items_live_status_idx
  ON ad_research_board_items (media_status)
  WHERE media_status IN ('pending', 'downloading', 'failed', 'partial');
