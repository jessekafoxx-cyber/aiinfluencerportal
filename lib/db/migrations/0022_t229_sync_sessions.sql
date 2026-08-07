-- Task #229: per-run sync session tracking for the Ad Research and
-- Funnels Research boards. Each manual / scheduled / boot-freshness
-- run creates exactly one sync_sessions row plus a stream of
-- sync_session_events. The Live tab reads the most-recent row per
-- board; the Historical tab reads the trailing window.
--
-- Idempotent: safe to re-run via the migration runner.

CREATE TABLE IF NOT EXISTS sync_sessions (
  id serial PRIMARY KEY,
  board text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  build_sha text,
  worker_pid text,
  worker_id text,
  error text,
  rows_fetched integer NOT NULL DEFAULT 0,
  rows_processed integer NOT NULL DEFAULT 0,
  successful_extractions integer NOT NULL DEFAULT 0,
  auth_failures integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  escalations integer NOT NULL DEFAULT 0,
  recoveries integer NOT NULL DEFAULT 0,
  invalid_urls integer NOT NULL DEFAULT 0,
  dead_content integer NOT NULL DEFAULT 0,
  extraction_rate_bp integer NOT NULL DEFAULT 0,
  throughput_per_min integer NOT NULL DEFAULT 0,
  queue_depth integer NOT NULL DEFAULT 0,
  summary jsonb
);

CREATE INDEX IF NOT EXISTS sync_sessions_board_started_idx
  ON sync_sessions (board, started_at);

CREATE INDEX IF NOT EXISTS sync_sessions_status_idx
  ON sync_sessions (status);

CREATE TABLE IF NOT EXISTS sync_session_events (
  id serial PRIMARY KEY,
  session_id integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  message text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS sync_session_events_session_idx
  ON sync_session_events (session_id, occurred_at);
