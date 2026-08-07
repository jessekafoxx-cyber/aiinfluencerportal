-- Task #701: dedupe column for the #ops Slack "stuck job" alert.
-- Stamped once the alert has been posted (or attempted) so a finalize
-- re-entry on the next tick never re-fires the same alert. Nullable;
-- legacy rows = never alerted, which matches the desired behaviour.
ALTER TABLE ai_influencer_jobs
  ADD COLUMN IF NOT EXISTS stuck_alert_sent_at timestamptz;
