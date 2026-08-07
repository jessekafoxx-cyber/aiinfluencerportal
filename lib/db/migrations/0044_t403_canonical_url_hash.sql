-- Task #403: dedupe the Ads board so the same ad never appears twice.
--
-- Adds a `canonical_url_hash` column that mirrors md5(normalized URL),
-- backfills it for every existing row, collapses any pre-existing
-- duplicates within the visible cohort by archiving losers, and then
-- creates a partial unique index so the sheet sync can never insert
-- a second visible row for the same canonical URL.
--
-- NOTE: contains UPDATE blocks. Per replit.md gotcha
-- ("Migrations with UPDATE blocks must run via the migration runner,
-- not push"), this file MUST be executed by the migration runner or as
-- direct SQL against the DB. `drizzle-kit push` will silently skip it.

-- 1. Add the column. Nullable until the backfill completes; the sheet
--    sync sets it on every upsert going forward.
ALTER TABLE ad_research_board_items
  ADD COLUMN IF NOT EXISTS canonical_url_hash text;

-- 2. Backfill: prefer the cached normalized URL captured at ingest
--    (T197), fall back to the raw ad_link for legacy rows persisted
--    before the normalize-on-ingest path shipped. md5() ships with PG
--    natively (no pgcrypto extension required) and matches the JS
--    `crypto.createHash("md5")` digest the sync code uses, so JS-side
--    hashes and DB-side hashes are byte-equivalent.
UPDATE ad_research_board_items
SET canonical_url_hash = md5(COALESCE(NULLIF(normalized_url_t197, ''), ad_link))
WHERE canonical_url_hash IS NULL
  AND COALESCE(NULLIF(normalized_url_t197, ''), ad_link) IS NOT NULL;

-- 3. Collapse pre-existing duplicates inside the visible cohort.
--    Per task acceptance criteria: "keep the newest non-failed one".
--    Winner picker, highest priority first:
--      1. is_non_failed (media_status NOT IN ('failed','failed_permanent'))
--         - the task's primary contract: a failed row never wins over
--           a non-failed sibling, no matter how recent the failure is.
--      2. created_at DESC (newest among the non-failed cohort, or
--         newest among the all-failed cohort when no non-failed
--         duplicate exists).
--      3. id DESC (final deterministic tiebreak when created_at ties).
--    Losers flip library_visibility='archived' so the partial unique
--    index in step 4 can be created without violations. The dismiss
--    flag and operational state are left untouched - this is library
--    visibility, separate from moderation/operational state.
WITH visible AS (
  SELECT id, canonical_url_hash, media_status, created_at,
         -- COALESCE the status so NULL / unknown statuses count as
         -- non-failed (NOT IN returns NULL for NULL inputs and would
         -- otherwise sort ahead of `true` under ORDER BY ... DESC).
         (COALESCE(media_status, '') NOT IN ('failed','failed_permanent')) AS is_non_failed
  FROM ad_research_board_items
  WHERE library_visibility = 'visible'
    AND canonical_url_hash IS NOT NULL
), ranked AS (
  SELECT v.id,
    ROW_NUMBER() OVER (
      PARTITION BY canonical_url_hash
      ORDER BY
        is_non_failed DESC NULLS LAST,
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

-- 4. Partial unique index: enforce "one visible row per canonical
--    URL hash" going forward. Archived rows are intentionally outside
--    the constraint so duplicate audit history stays addressable and
--    so an admin can re-archive/restore freely without index churn.
CREATE UNIQUE INDEX IF NOT EXISTS ad_research_board_items_canonical_url_hash_visible_uq
  ON ad_research_board_items (canonical_url_hash)
  WHERE library_visibility = 'visible' AND canonical_url_hash IS NOT NULL;
