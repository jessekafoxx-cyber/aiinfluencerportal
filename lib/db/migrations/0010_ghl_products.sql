-- GHL-driven product catalog + purchase ledger + webhook delivery log.
-- Mirrors lib/db/src/schema/ghl-products.ts. Environments that use
-- `drizzle-kit push` get these automatically; this file makes deploys that
-- apply migration SQL deterministic. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'main',
  description text,
  grants_full_portal boolean NOT NULL DEFAULT false,
  entitlements jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  ghl_product_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'webhook',
  revoked_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases (user_id);
CREATE INDEX IF NOT EXISTS purchases_product_idx ON purchases (product_id);
-- One ACTIVE purchase per user+product; revoked rows are kept as history.
-- The grant path relies on this as its idempotency/concurrency gate.
CREATE UNIQUE INDEX IF NOT EXISTS purchases_active_unique
  ON purchases (user_id, product_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webhook_events (
  id serial PRIMARY KEY,
  source text NOT NULL DEFAULT 'ghl',
  status text NOT NULL,
  email text,
  product_slug text,
  payload jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_created_idx ON webhook_events (created_at);
