-- T257: DFY Background Reel Music library.
--
-- One row per track imported from the configured Google Drive folders.
-- The drive_file_id column is unique so the importer is idempotent;
-- modified_time lets us detect when the source file has changed and
-- re-process only what's needed. Original files and 30s preview clips
-- are persisted to our own object storage and served back through
-- /api/portal/dfy/background-music/:id/{preview,download}.

CREATE TABLE IF NOT EXISTS "dfy_background_tracks" (
  "id" serial PRIMARY KEY,
  "drive_file_id" text NOT NULL,
  "drive_modified_time" timestamptz,
  "display_title" text NOT NULL,
  "original_filename" text NOT NULL,
  "mime_type" varchar(64) NOT NULL DEFAULT 'audio/mpeg',
  "file_size" bigint,
  "duration_seconds" integer,
  "bitrate_bps" integer,
  "original_object_key" text NOT NULL,
  "preview_object_key" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_background_tracks_drive_uq"
  ON "dfy_background_tracks" ("drive_file_id");

CREATE INDEX IF NOT EXISTS "dfy_background_tracks_active_sort_idx"
  ON "dfy_background_tracks" ("is_active", "sort_order");

CREATE INDEX IF NOT EXISTS "dfy_background_tracks_title_idx"
  ON "dfy_background_tracks" (lower("display_title"));
