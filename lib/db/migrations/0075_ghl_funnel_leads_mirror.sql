-- GoHighLevel funnel-lead mirror. Caches the GHL contact id on first
-- upsert so tag add/remove calls go directly to /contacts/:id/tags
-- without a per-call email lookup. The two timestamp columns act as
-- one-shot idempotency gates for the `not-purchased` (5-min scheduler)
-- and `Purchased` (markStripeOrderPaid) tags.
--
-- ADD COLUMN only - publish handles this cleanly. No data backfill
-- needed: existing rows stay NULL and will pick up tags on their next
-- touch (purchase flip) or remain untagged (cold leads).
ALTER TABLE funnel_leads
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,
  ADD COLUMN IF NOT EXISTS ghl_not_purchased_tagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_purchased_tagged_at timestamptz;
