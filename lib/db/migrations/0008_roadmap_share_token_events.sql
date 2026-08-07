CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE roadmap_leads
  ADD COLUMN IF NOT EXISTS share_token text;

UPDATE roadmap_leads SET share_token = encode(gen_random_bytes(18), 'hex') WHERE share_token IS NULL;

ALTER TABLE roadmap_leads ALTER COLUMN share_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roadmap_leads_share_token_idx ON roadmap_leads (share_token);

CREATE TABLE IF NOT EXISTS roadmap_lead_events (
  id serial PRIMARY KEY,
  lead_id integer REFERENCES roadmap_leads(id) ON DELETE SET NULL,
  share_token text,
  event_name text NOT NULL,
  step text,
  cta text,
  context jsonb,
  client_ip_address text,
  client_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roadmap_lead_events_lead_id_idx ON roadmap_lead_events (lead_id);
CREATE INDEX IF NOT EXISTS roadmap_lead_events_event_name_idx ON roadmap_lead_events (event_name);
CREATE INDEX IF NOT EXISTS roadmap_lead_events_created_at_idx ON roadmap_lead_events (created_at);
