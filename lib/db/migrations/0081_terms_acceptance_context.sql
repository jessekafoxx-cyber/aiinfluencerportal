-- Task: dispute hardening + consent infrastructure.
-- Adds a `context` column to terms_acceptances so we can tell apart
-- consent collected at the main funnel checkout vs the various upsells,
-- downsells and portal sidebar add-ons. Nullable to keep existing rows
-- (and any in-flight writers that have not been redeployed yet) valid.
ALTER TABLE "terms_acceptances" ADD COLUMN IF NOT EXISTS "context" text;
