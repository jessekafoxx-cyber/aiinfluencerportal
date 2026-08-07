-- T262: extend dfy_templates with ad_copy + extra theme tags + brand_name
-- so the new Ad Swipe File detail dialog can render the full multi-line
-- ad copy with a copy-to-clipboard button, and so the importer can store
-- up to three theme facets per row (theme/theme2/theme3) the way the new
-- 321-row ad-swipe export ships them.
--
-- All columns are nullable so the migration is safe to apply against
-- existing rows. Use IF NOT EXISTS so re-running is a no-op.

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "ad_copy" text;

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "theme2" text;

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "theme3" text;

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "brand_name" text;
