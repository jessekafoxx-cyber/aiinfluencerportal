-- Task #764: heartbeat-based Greg AI time accounting that survives closed
-- tabs / crashes. Adds a client-generated session_key so periodic heartbeats
-- (cumulative elapsed seconds) upsert ONE row per in-progress session instead
-- of only recording on a clean session end.
-- ADD COLUMN + CREATE UNIQUE INDEX only - publish-safe (no UPDATE backfill).
ALTER TABLE greg_ai_usage_sessions
  ADD COLUMN IF NOT EXISTS session_key text;

-- One row per (user, session). NULLs are distinct in Postgres, so legacy
-- one-shot rows (session_key IS NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS greg_ai_usage_sessions_user_session_key_idx
  ON greg_ai_usage_sessions (user_id, session_key);
