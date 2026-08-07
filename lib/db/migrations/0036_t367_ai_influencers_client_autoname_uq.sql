-- T367: Add the missing partial unique index that finalizeJob's
-- ON CONFLICT (client_id, name) WHERE name LIKE 'Influencer %' targets.
-- The Drizzle schema previously did not declare it, so production drifted
-- without this index. Slice B verification surfaced the resulting
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- error during finalize replay for any auto-named influencer.
--
-- Pre-flight verified zero duplicate (client_id, name) rows where name
-- matches the predicate, so this index can be created without a backfill.

CREATE UNIQUE INDEX IF NOT EXISTS ai_influencers_client_autoname_uq
  ON ai_influencers (client_id, name)
  WHERE name LIKE 'Influencer %';
