-- Influencer overdue watchdog (external Viktor-delivery SLA).
-- Adds a dedupe stamp so the watchdog re-alerts the team exactly once when a
-- job sits undelivered past its 24h promise window. Distinct from
-- stuck_alert_sent_at (the internal-pipeline #ops stuck alert).
ALTER TABLE "ai_influencer_jobs" ADD COLUMN IF NOT EXISTS "overdue_alerted_at" timestamp with time zone;
