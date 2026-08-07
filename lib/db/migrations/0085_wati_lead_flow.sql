-- WATI WhatsApp lead flow. Mirrors the GHL 5-minute not-purchased flow.
-- One-shot idempotency gates on funnel_leads for the two templates:
--   wati_questions_sent_at  -> "questions" nurture (5 min, not purchased)
--   wati_thank_you_sent_at  -> "purchase_thank_you" (main product paid)
-- ADD COLUMN only - publish-safe (no UPDATE backfill).
ALTER TABLE funnel_leads
  ADD COLUMN IF NOT EXISTS wati_questions_sent_at timestamptz;

ALTER TABLE funnel_leads
  ADD COLUMN IF NOT EXISTS wati_thank_you_sent_at timestamptz;
