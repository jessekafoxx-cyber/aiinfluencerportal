-- Workshop reminder idempotency stamps. Set via atomic
-- UPDATE WHERE NULL pattern so two worker processes (rolling restart)
-- can never double-send a 24h or 15m reminder blast.
-- ADD COLUMN only - publish-safe.
ALTER TABLE live_workshops ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamp;
ALTER TABLE live_workshops ADD COLUMN IF NOT EXISTS reminder_15m_sent_at timestamp;
