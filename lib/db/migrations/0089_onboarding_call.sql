-- 1-1 Onboarding Call (GHL booking calendar). Two nullable timestamps on
-- portal_users. No data backfill: existing accounts are excluded from the
-- one-time first-login popup by a createdAt launch-cutoff check in app code,
-- so the Publish ADD COLUMN is sufficient (no skipped UPDATE block).
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "onboarding_call_prompt_seen_at" timestamp;
ALTER TABLE "portal_users" ADD COLUMN IF NOT EXISTS "onboarding_call_booked_at" timestamp;
