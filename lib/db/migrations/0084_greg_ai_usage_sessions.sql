-- Task #762: Platinum Club Greg AI per-session voice/chat duration log.
-- Monthly usage is summed per calendar month from started_at so the
-- 120-minute (7200s) allowance resets automatically on the 1st.
-- CREATE TABLE + CREATE INDEX only - publish-safe (no UPDATE backfill).
CREATE TABLE IF NOT EXISTS greg_ai_usage_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  channel text NOT NULL,
  duration_seconds integer NOT NULL,
  started_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS greg_ai_usage_sessions_user_started_idx
  ON greg_ai_usage_sessions (user_id, started_at);
