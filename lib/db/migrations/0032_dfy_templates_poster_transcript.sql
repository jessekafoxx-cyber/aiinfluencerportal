-- VSL Ad Swipes preview UX: add poster (thumbnail) and transcript
-- columns to dfy_templates so the gallery can render a static
-- thumbnail (instead of an autoplaying <video> that often shows a
-- blank/cutoff first frame) and the preview dialog can show a copyable
-- transcript. Both columns are populated by the worker's VSL poster +
-- transcript backfill hooks for any video row that doesn't already
-- have them.

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "poster_url" text;

ALTER TABLE "dfy_templates"
  ADD COLUMN IF NOT EXISTS "transcript" text;
