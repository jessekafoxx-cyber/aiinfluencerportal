-- Task #290: track when the one-time "Welcome to Room30 AI" email was
-- sent the first time a buyer actually signed in. NULL means not yet
-- sent. Backfill every existing row to now() so the welcome only ever
-- fires for accounts created after this feature ships.
ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamp;

UPDATE portal_users
  SET welcome_email_sent_at = now()
  WHERE welcome_email_sent_at IS NULL;
