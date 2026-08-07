-- T376: Remove the Curated Settings feature.
--
-- The PR 2 "Drive ingestion only" curated_settings table was never wired
-- into the AI Influencer pipeline (PR 3 never landed). Nothing in the app
-- reads from it outside of the now-removed admin UI / routes / importer.
-- Dropping the table and its indexes here. This migration is destructive
-- and must be applied via the migration runner or directly via psql -
-- drizzle-kit push will not handle DROP cleanly.

DROP INDEX IF EXISTS curated_settings_drive_file_id_idx;
DROP INDEX IF EXISTS curated_settings_active_approved_idx;
DROP INDEX IF EXISTS curated_settings_category_idx;
DROP TABLE IF EXISTS curated_settings;
