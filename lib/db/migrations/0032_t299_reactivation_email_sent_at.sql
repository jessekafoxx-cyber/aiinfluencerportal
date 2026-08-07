-- Task #299: track when the one-time "haven't signed in yet" reactivation
-- reminder email was sent to a buyer. NULL means not yet sent. Backfill
-- every existing row to now() so the reminder only fires for accounts
-- created after this feature ships and we don't blast historical buyers
-- on first deploy.
ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS reactivation_email_sent_at timestamp;

UPDATE portal_users
  SET reactivation_email_sent_at = now()
  WHERE reactivation_email_sent_at IS NULL;
