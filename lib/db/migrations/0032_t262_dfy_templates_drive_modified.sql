-- T262 followup: track the source Drive file's modifiedTime per row so
-- the seed-dfy-ad-swipes importer can detect when a Drive file has
-- changed and re-download it, rather than relying solely on "imageUrl
-- already lives on our object storage". Without this column the
-- importer cannot tell a refreshed Drive file apart from one we've
-- already imported, so a content edit upstream would silently never
-- propagate.
--
-- Nullable + IF NOT EXISTS so the migration is safe to re-apply.

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "drive_modified_time" timestamptz;
