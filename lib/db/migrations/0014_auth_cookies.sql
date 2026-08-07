-- Task #155: authenticated scraping support for the media-download
-- queue. Two tables back the cookie jar storage and per-platform
-- auth-health probe outcomes. Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS auth_cookie_jars (
  id            serial PRIMARY KEY,
  platform      text NOT NULL,
  object_path   text NOT NULL,
  uploaded_by   text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz,
  status        text NOT NULL DEFAULT 'active',
  notes         text,
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS auth_cookie_jars_platform_active_idx
  ON auth_cookie_jars (platform, deleted_at, uploaded_at);

CREATE TABLE IF NOT EXISTS auth_health (
  platform         text PRIMARY KEY,
  status           text NOT NULL DEFAULT 'unknown',
  probe_url        text,
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  last_error       text,
  last_error_class text,
  last_probe_at    timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
