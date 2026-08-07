-- Add the status pipeline column to roadmap_items so the new /roadmap
-- page can group items into "Coming Next", "In Production", and
-- "Shipped" buckets. Default "next" preserves the historical
-- "coming soon" behaviour for any rows that pre-date this migration.
ALTER TABLE "roadmap_items"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'next';
