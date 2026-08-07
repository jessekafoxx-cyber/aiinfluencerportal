-- Task #245: dedicated table for room30.ai contact-form submissions.
--
-- Mirrors the room30_notify_signups pattern, but stores the full free-form
-- message + sender name so support can triage submissions in the admin UI
-- (Room30 portal -> Room30 Contact Messages) instead of digging through
-- the generic email_logs table. handled_at is a soft-state marker an
-- admin flips when the message has been acted on; null = inbox-style
-- "needs attention".
--
-- Idempotent: safe to re-run via the migration runner.

CREATE TABLE IF NOT EXISTS room30_contact_submissions (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  email               text NOT NULL,
  message             text NOT NULL,
  client_ip_address   text,
  client_user_agent   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  handled_at          timestamptz
);

CREATE INDEX IF NOT EXISTS room30_contact_submissions_created_at_idx
  ON room30_contact_submissions (created_at);

CREATE INDEX IF NOT EXISTS room30_contact_submissions_email_idx
  ON room30_contact_submissions (email);
