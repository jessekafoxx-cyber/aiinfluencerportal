-- T368 / Slice D: Provider Reliability Telemetry + Observability.
--
-- Three additive tables. No UPDATE blocks - safe for `drizzle-kit push`
-- and the migration runner alike. None of these rows feed orchestration
-- decisions; they are forensic and analytics infrastructure.

CREATE TABLE IF NOT EXISTS provider_execution_events (
  id              serial PRIMARY KEY,
  provider        text NOT NULL,
  operation       text NOT NULL,
  stage           text,
  job_id          integer,
  scene_job_id    integer,
  provider_job_id text,
  success         boolean NOT NULL,
  degraded        boolean NOT NULL DEFAULT false,
  webhook_used    boolean NOT NULL DEFAULT false,
  poll_used       boolean NOT NULL DEFAULT false,
  latency_ms      integer,
  output_bytes    integer,
  error_class     text,
  error_code      text,
  error_message   text,
  worker_id       text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_exec_events_provider_created_idx
  ON provider_execution_events (provider, created_at);
CREATE INDEX IF NOT EXISTS provider_exec_events_job_idx
  ON provider_execution_events (job_id);
CREATE INDEX IF NOT EXISTS provider_exec_events_created_idx
  ON provider_execution_events (created_at);

CREATE TABLE IF NOT EXISTS provider_health_snapshots (
  id                    serial PRIMARY KEY,
  provider              text NOT NULL,
  window_start          timestamptz NOT NULL,
  window_end            timestamptz NOT NULL,
  sample_size           integer NOT NULL,
  success_rate          real NOT NULL,
  avg_latency_ms        integer,
  p50_latency_ms        integer,
  p95_latency_ms        integer,
  p99_latency_ms        integer,
  timeout_rate          real NOT NULL,
  empty_output_rate     real NOT NULL,
  webhook_failure_rate  real NOT NULL,
  degraded_rate         real NOT NULL,
  breakdown             jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_health_snapshots_provider_window_idx
  ON provider_health_snapshots (provider, window_start);
CREATE UNIQUE INDEX IF NOT EXISTS provider_health_snapshots_provider_window_uq
  ON provider_health_snapshots (provider, window_start);

CREATE TABLE IF NOT EXISTS provider_recovery_events (
  id              serial PRIMARY KEY,
  job_id          integer NOT NULL,
  recovery_kind   text NOT NULL,
  from_provider   text,
  to_provider     text,
  stage           text,
  reason          text,
  success         boolean NOT NULL,
  delay_ms        integer,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_recovery_events_kind_created_idx
  ON provider_recovery_events (recovery_kind, created_at);
CREATE INDEX IF NOT EXISTS provider_recovery_events_job_idx
  ON provider_recovery_events (job_id);
