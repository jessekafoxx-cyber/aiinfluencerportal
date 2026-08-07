-- T392: 250+ Scenes - subfolder UI + weekly Drive sync.
--
-- The Drive folder backing 250-scenes was reorganised into per-setting
-- subfolders (office, beach, gym, etc.). The portal now mirrors that
-- structure: a folder grid first, then drill-in to each folder's images.
-- We persist which Drive subfolder each row came from so the listing API
-- can group by folder and the per-folder drill-in can filter.
--
-- Slugs that stay on the flat lister (e.g. 100-ai-influencers) leave both
-- columns null and behave exactly as before.

ALTER TABLE "dfy_drive_assets"
  ADD COLUMN IF NOT EXISTS "subfolder_drive_id" text,
  ADD COLUMN IF NOT EXISTS "subfolder_name" text;

CREATE INDEX IF NOT EXISTS "dfy_drive_assets_slug_subfolder_idx"
  ON "dfy_drive_assets" ("slug", "subfolder_drive_id", "is_active", "sort_key");

-- Reset the existing 250-scenes catalog so the page only shows the new
-- subfolder-organised library after the first subfolder-aware sync runs.
-- Originals + thumbnails in object storage stay; only the active flag is
-- flipped. The next sync re-activates rows it still finds (now with their
-- subfolder metadata populated) and leaves anything that's truly gone
-- soft-deleted via the existing sweep.
UPDATE "dfy_drive_assets"
   SET "is_active" = false,
       "updated_at" = now()
 WHERE "slug" = '250-scenes'
   AND "is_active" = true;
