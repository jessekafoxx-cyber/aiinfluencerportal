-- Task #607: Internal Sales CRM tables.

CREATE TABLE IF NOT EXISTS crm_users (
  id SERIAL PRIMARY KEY,
  clerk_id TEXT UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_users_email_lower_uq ON crm_users (lower(email));

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_won BOOLEAN NOT NULL DEFAULT false,
  is_lost BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_products (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  commission_pct INTEGER NOT NULL DEFAULT 0,
  commission_flat_cents INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  source TEXT,
  stage_id INTEGER REFERENCES crm_pipeline_stages(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES crm_users(id) ON DELETE SET NULL,
  value_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  properties JSONB,
  board_order INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_lower_uq ON crm_contacts (lower(email));
CREATE INDEX IF NOT EXISTS crm_contacts_stage_idx ON crm_contacts (stage_id);
CREATE INDEX IF NOT EXISTS crm_contacts_assigned_idx ON crm_contacts (assigned_to);

CREATE TABLE IF NOT EXISTS crm_deals (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES crm_products(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES crm_users(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_deals_contact_idx ON crm_deals (contact_id);
CREATE INDEX IF NOT EXISTS crm_deals_owner_idx ON crm_deals (owner_id);

CREATE TABLE IF NOT EXISTS crm_activities (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES crm_users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_activities_contact_idx ON crm_activities (contact_id);

CREATE TABLE IF NOT EXISTS crm_contact_events (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  source TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_contact_events_contact_idx ON crm_contact_events (contact_id);
