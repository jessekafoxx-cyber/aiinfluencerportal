-- Task #250 round-3 fix: duplicate-proof influencer materialization.
-- The finalize path looks up an existing ai_influencer by stable name
-- "Influencer {jobId}" before inserting one, but two concurrent
-- finalize replays can both miss the lookup and both insert. Add a
-- unique partial index covering only the auto-generated names so
-- finalize's INSERT can use ON CONFLICT DO NOTHING and a follow-up
-- SELECT to deterministically resolve to a single row.
--
-- Round-9 follow-up (in-place fix, safe to re-run): pre-dedupe any
-- historical duplicate auto-named rows BEFORE creating the unique
-- partial index, otherwise the CREATE INDEX would fail at apply time
-- on a dirty DB. Keep the oldest row (lowest created_at, ties broken
-- by id) and append " (dup-{n})" to siblings — the kept row remains
-- the canonical "Influencer {jobId}" target for future finalize
-- lookups; renamed siblings still match the partial predicate but
-- become unique within the index. Migration 0029 is retained as a
-- defensive no-op for environments that already applied this file
-- before the dedupe block was added.
WITH ranked AS (
  SELECT
    id,
    client_id,
    name,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, name
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM ai_influencers
  WHERE name LIKE 'Influencer %'
)
UPDATE ai_influencers AS i
SET name = i.name || ' (dup-' || ranked.rn || ')'
FROM ranked
WHERE i.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ai_influencers_client_autoname_uq
  ON ai_influencers (client_id, name)
  WHERE name LIKE 'Influencer %';
