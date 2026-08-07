-- Task #366: persist source-row-skipped count on sync_sessions so the
-- Ad Research Board "X of Y ready" header and breakdown popover can
-- surface the gap between sheet rows and board rows. Pure schema add
-- with a default of 0; no UPDATE backfill required (every existing
-- session is historical and we don't reconstruct the value
-- retroactively - new sessions populate it going forward).
ALTER TABLE sync_sessions
  ADD COLUMN IF NOT EXISTS rows_skipped integer NOT NULL DEFAULT 0;
