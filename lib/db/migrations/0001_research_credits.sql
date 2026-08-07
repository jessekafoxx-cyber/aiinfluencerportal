-- Credit-based research regeneration with $5 Stripe top-up (task #6)
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE portal_users
  ADD COLUMN IF NOT EXISTS research_generations_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_paid_credits          integer NOT NULL DEFAULT 0;

ALTER TABLE research_generation_jobs
  ADD COLUMN IF NOT EXISTS credit_type text; -- 'free' | 'paid'

CREATE TABLE IF NOT EXISTS research_credit_purchases (
  id                  serial PRIMARY KEY,
  user_id             integer NOT NULL,
  stripe_session_id   text NOT NULL UNIQUE,
  stripe_customer_id  text,
  amount_cents        integer NOT NULL,
  status              text NOT NULL DEFAULT 'pending', -- 'pending' | 'granted'
  granted_at          timestamp,
  created_at          timestamp DEFAULT now()
);

COMMIT;
