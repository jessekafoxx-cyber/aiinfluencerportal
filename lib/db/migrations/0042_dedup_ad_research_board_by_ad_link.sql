-- T402 follow-up: collapse legacy duplicate ad_research_board_items rows
-- created by row_key scheme drift (`auto-<hash>` vs sheet `#NNN`). Each
-- distinct ad_link in the visible cohort is reduced to one canonical
-- row by archiving the duplicates (library_visibility='archived').
--
-- Winner picker (priority, highest wins):
--   1. has_healthy_media (media_status IN ('ok','partial') AND media_object_path IS NOT NULL)
--      - protects the only working copy from being archived
--   2. source_present (currently in the sheet)
--   3. sheet-keyed row_key (NOT LIKE 'auto-%')
--   4. created_at DESC (most recent)
--   5. id DESC (final tiebreak)
--
-- Singletons (one row per ad_link) are untouched - durable legacy
-- orphans stay on the user board as designed in T402.

WITH visible AS (
  SELECT id, row_key, ad_link, media_object_path, media_status, source_present, created_at,
         (row_key NOT LIKE 'auto-%') AS sheet_keyed,
         (media_status IN ('ok','partial') AND media_object_path IS NOT NULL) AS has_healthy_media
  FROM ad_research_board_items
  WHERE library_visibility = 'visible'
), ranked AS (
  SELECT v.id, v.ad_link,
    ROW_NUMBER() OVER (
      PARTITION BY ad_link
      ORDER BY
        has_healthy_media DESC,
        source_present DESC,
        sheet_keyed DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM visible v
), losers AS (
  SELECT id FROM ranked WHERE rn > 1
)
UPDATE ad_research_board_items
SET library_visibility = 'archived',
    updated_at = now()
WHERE id IN (SELECT id FROM losers);
