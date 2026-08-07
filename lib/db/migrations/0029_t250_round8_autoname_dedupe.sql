-- Task #250 round-8 fix: pre-dedupe before applying the round-3
-- ai_influencers_client_autoname_uq unique partial index on prod.
-- Migration 0027 added the index assuming no historical duplicates;
-- if a prior bug or replayed finalize created two "Influencer {jobId}"
-- rows for the same client, the index creation will fail at apply time.
--
-- Strategy: keep the oldest row (lowest created_at, ties broken by id)
-- and rename duplicate siblings by appending " (dup-{n})". Renamed
-- rows STILL match the partial predicate `name LIKE 'Influencer %'`
-- (the suffix is appended, the prefix is unchanged), but the new
-- name is unique within (client_id, name) so the partial unique
-- index can be created without collision. Future finalize calls
-- look up by the canonical "Influencer {jobId}" name and will hit
-- the kept (rn=1) row.
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

-- Idempotent re-create. The CREATE in 0027 used IF NOT EXISTS so a
-- partial-failed apply (index missing) will now succeed; if the index
-- already exists, this is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS ai_influencers_client_autoname_uq
  ON ai_influencers (client_id, name)
  WHERE name LIKE 'Influencer %';
