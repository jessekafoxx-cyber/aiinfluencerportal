-- Task #608: Calendly sync into the CRM (calendar view + stage-change reactions).

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS calendly_scheduling_link JSONB;

CREATE TABLE IF NOT EXISTS crm_calendar_events (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
  calendly_event_uri TEXT NOT NULL,
  calendly_invitee_uri TEXT NOT NULL,
  event_type_uri TEXT,
  event_name TEXT,
  invitee_email TEXT,
  invitee_name TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  reschedule_url TEXT,
  cancel_url TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_calendar_events_event_uri_uq
  ON crm_calendar_events (calendly_event_uri);
CREATE UNIQUE INDEX IF NOT EXISTS crm_calendar_events_invitee_uri_uq
  ON crm_calendar_events (calendly_invitee_uri);
CREATE INDEX IF NOT EXISTS crm_calendar_events_contact_idx
  ON crm_calendar_events (contact_id);
CREATE INDEX IF NOT EXISTS crm_calendar_events_start_idx
  ON crm_calendar_events (start_time);

CREATE TABLE IF NOT EXISTS crm_calendly_settings (
  id SERIAL PRIMARY KEY,
  default_event_type_uri TEXT,
  send_link_stage_id INTEGER REFERENCES crm_pipeline_stages(id) ON DELETE SET NULL,
  cancel_on_stage_ids JSONB,
  webhook_subscription_uri TEXT,
  webhook_signing_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
