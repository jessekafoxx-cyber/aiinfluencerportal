-- Task #402: Durable Media Library refactor.
--
-- Decouple SOURCE lifecycle (is this row currently in the upstream Google
-- Sheet?) from ASSET lifecycle (is the cached media healthy?). Before this
-- migration, a row that fell out of the sheet was flipped to
-- hidden_from_sheet=true, which pushed it into the admin "Needs Fixing"
-- bucket even though the cached video in GCS still played fine. The board
-- now behaves like a permanent research/media library: once media is
-- successfully extracted, the row stays on the user board unless an admin
-- explicitly archives it - regardless of whether the source row is still
-- in the sheet.
--
-- New columns:
--   source_present          : true while the row is in the latest sheet snapshot
--   source_removed_at       : when source_present first flipped to false
--   last_seen_in_source_at  : bumped on every sync where the row is present
--   times_seen_in_source    : cumulative counter (powers trend / recurrence)
--   library_visibility      : admin-controlled inventory state
--                             ('visible' | 'archived')
--   asset_retention_status  : GENERATED column derived from media_status +
--                             media_object_path - read-only label for
--                             dashboards. The user-board and "Needs Fixing"
--                             filters use explicit media_status conditions
--                             so the SQL stays index-friendly.
--
-- The legacy `hidden_from_sheet` column is KEPT for one release as a
-- compat shadow column (sync mirrors it from NOT source_present) so the
-- admin "Hidden rows" listing and any downstream readers keep working
-- while the new fields roll out. It can be dropped in a follow-up migration.
--
-- NOTE: contains UPDATE blocks (backfill). Per replit.md gotcha
-- ("Migrations with UPDATE blocks must run via the migration runner,
-- not push"), this file MUST be applied as direct SQL against the DB.
-- `drizzle-kit push` will silently skip the backfill.

-- 1. Add the source-lifecycle and visibility columns.
ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS source_present BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_in_source_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS times_seen_in_source INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS library_visibility TEXT NOT NULL DEFAULT 'visible';

-- 2. Generated column: derived 4-bucket retention label. Read-only.
--    Order matters - earlier WHENs win.
ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS asset_retention_status TEXT GENERATED ALWAYS AS (
    CASE
      WHEN media_status = 'failed_permanent' THEN 'archived'
      WHEN media_status = 'silent-source' THEN 'durable'
      WHEN media_status IN ('pending', 'downloading') OR media_status IS NULL THEN 'pending'
      WHEN media_status IN ('ok', 'partial') AND media_object_path IS NOT NULL THEN 'durable'
      WHEN media_status IN ('ok', 'partial') AND media_object_path IS NULL THEN 'broken'
      WHEN media_status IN ('failed', 'invalid') THEN 'broken'
      ELSE 'pending'
    END
  ) STORED;

-- 3. CHECK constraint on library_visibility (idempotent guard).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_research_board_items_library_visibility_chk'
  ) THEN
    ALTER TABLE ad_research_board_items
      ADD CONSTRAINT ad_research_board_items_library_visibility_chk
      CHECK (library_visibility IN ('visible', 'archived'));
  END IF;
END $$;

-- 4. Backfill freshness counters from existing data. updated_at is the
--    best available approximation of "last touched by sync" for legacy
--    rows; new syncs will overwrite this with sql`now()` precisely.
UPDATE ad_research_board_items
SET last_seen_in_source_at = COALESCE(last_seen_in_source_at, updated_at, created_at),
    times_seen_in_source = GREATEST(times_seen_in_source, 1)
WHERE last_seen_in_source_at IS NULL OR times_seen_in_source < 1;

-- 5. Backfill source-presence from the legacy hidden_from_sheet column.
--    Any row currently flagged hidden_from_sheet=true is treated as
--    source_present=false with source_removed_at populated from
--    updated_at (best approximation of when it left the sheet).
UPDATE ad_research_board_items
SET source_present = (NOT hidden_from_sheet),
    source_removed_at = CASE
      WHEN hidden_from_sheet AND source_removed_at IS NULL THEN updated_at
      ELSE source_removed_at
    END;

-- 6. The headline backfill: restore the 153 orphaned-but-durable rows.
--    Rows where dismissed=false (admin hasn't manually archived them) get
--    library_visibility='visible' regardless of hidden_from_sheet, which
--    re-exposes every row whose cached media is still healthy. Dismissed
--    rows (manual admin skip, failed_permanent, invalid) go to 'archived'
--    so they stay off the user board.
UPDATE ad_research_board_items
SET library_visibility = CASE WHEN dismissed THEN 'archived' ELSE 'visible' END;

-- 7. Indexes for the new filter shapes.
CREATE INDEX IF NOT EXISTS ad_research_board_items_library_visibility_idx
  ON ad_research_board_items (library_visibility);
CREATE INDEX IF NOT EXISTS ad_research_board_items_source_present_idx
  ON ad_research_board_items (source_present, last_seen_in_source_at);
CREATE INDEX IF NOT EXISTS ad_research_board_items_retention_idx
  ON ad_research_board_items (asset_retention_status);
