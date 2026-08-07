-- Task #309: per-row "media outcome changed at" timestamp.
--
-- Background: the Queue Health 24h-windowed dashboard tiles
-- (Success Rate, Failed, Total Processed, Failure Breakdown,
-- Recent Failures, Processing Latency, attempts histogram,
-- terminal/dismissed/retrying tiles, authFailures1h/24h) used
-- to clamp by `ad_research_board_items.updated_at >= MAX(now-24h,
-- analytics_window_cutoff_t237)`. But the ad-research-board sync
-- upsert sets `updated_at = now()` on every fetched row, so each
-- "Sync Now" silently dragged every previously-failed row's
-- updated_at past the operator's fresh-start cutoff and re-armed
-- the same old failure numbers - making the "Reset 24H Window"
-- button look like it had no effect.
--
-- Fix: introduce a dedicated `media_outcome_changed_at_t309`
-- column that ONLY the media downloader writes (on success,
-- failure, partial, dismiss, retry, lease release with status
-- change). The dashboard's 24h-windowed queries clamp by this
-- column instead, so the sheet upsert's `updated_at` bumps no
-- longer affect window membership.
--
-- The seed (`COALESCE(media_downloaded_at, updated_at)`) is a
-- safe approximation of the prior outcome timestamp for legacy
-- rows: media_downloaded_at is set whenever the downloader
-- persists a terminal-state row (ok / partial / failed), so for
-- rows the worker has touched, it matches the historical
-- "outcome time" exactly. For rows never reached by the worker
-- (pure pending / structurally-invalid pre-claim dismissals)
-- updated_at is the closest stable anchor we have.
--
-- This migration contains an UPDATE block (data backfill) so it
-- MUST be applied via the migration runner, not `drizzle-kit push`
-- (which silently skips UPDATE blocks - see replit.md).
--
-- Idempotent: safe to re-run.

ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS media_outcome_changed_at_t309 timestamptz;

CREATE INDEX IF NOT EXISTS ad_research_board_items_outcome_changed_at_idx_t309
  ON ad_research_board_items (media_outcome_changed_at_t309);

UPDATE ad_research_board_items
   SET media_outcome_changed_at_t309 = COALESCE(media_downloaded_at, updated_at)
 WHERE media_outcome_changed_at_t309 IS NULL;
