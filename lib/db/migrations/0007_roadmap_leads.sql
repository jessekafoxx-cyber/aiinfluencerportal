-- Personalized Apex Roadmap lead magnet (task #103).
-- Adds a public lead-capture table for the /roadmap opt-in funnel.
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS roadmap_leads (
  id                  serial PRIMARY KEY,
  first_name          text NOT NULL,
  last_name           text,
  email               text NOT NULL,
  phone               text,
  country             text,
  niche               text NOT NULL,
  revenue_band        text NOT NULL,
  audience_size       text,
  current_offer       text,
  bottleneck          text,
  generated_offers    jsonb,
  generation_status   text NOT NULL DEFAULT 'pending',
  generation_error    text,
  email_sent_at       timestamptz,
  email_message_id    text,
  fbp                 text,
  fbc                 text,
  client_ip_address   text,
  client_user_agent   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roadmap_leads_email_idx
  ON roadmap_leads (lower(email));

CREATE INDEX IF NOT EXISTS roadmap_leads_created_at_idx
  ON roadmap_leads (created_at DESC);

COMMIT;
