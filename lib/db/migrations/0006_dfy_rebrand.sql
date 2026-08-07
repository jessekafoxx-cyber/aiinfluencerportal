-- Done For You (DFY) rebrand of A-List clients (task #66).
-- Adds a recording URL to live workshops, and creates DFY build assets and
-- per-user Stripe connection tables. Existing a_list_* tables are preserved
-- (only the labels are reworded in the UI).
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE live_workshops
  ADD COLUMN IF NOT EXISTS recording_url text;

CREATE TABLE IF NOT EXISTS dfy_build_assets (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL,
  title       text NOT NULL,
  category    text NOT NULL DEFAULT 'general',
  asset_type  text NOT NULL DEFAULT 'link',
  url         text,
  notes       text,
  status      text NOT NULL DEFAULT 'ready',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamp DEFAULT now(),
  updated_at  timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dfy_build_assets_user_idx
  ON dfy_build_assets (user_id);

CREATE TABLE IF NOT EXISTS dfy_stripe_connections (
  id              serial PRIMARY KEY,
  user_id         integer NOT NULL UNIQUE,
  stripe_api_key  text NOT NULL,
  account_label   text,
  sync_status     text NOT NULL DEFAULT 'ok',
  last_sync_error text,
  last_sync_at    timestamp,
  created_at      timestamp DEFAULT now(),
  updated_at      timestamp DEFAULT now()
);

COMMIT;
