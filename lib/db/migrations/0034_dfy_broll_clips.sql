-- T317: Hosted DFY 70K B-Roll library.
--
-- One row per video file imported from the curated Google Drive
-- folders linked from the Room30 portal's "70K Viral Video B-Roll"
-- page. The drive_file_id column is unique so the importer is
-- idempotent across re-runs. pack_numbers is an int[] because the
-- source list contains duplicate folders that appear under more than
-- one pack number (packs 7 & 8 share a folder, 14 & 18 share a
-- folder). Schema-only migration; no data backfills.

CREATE TABLE IF NOT EXISTS "dfy_broll_clips" (
  "id" serial PRIMARY KEY,
  "public_id" varchar(32) NOT NULL,
  "drive_file_id" text NOT NULL,
  "original_filename" text NOT NULL,
  "mime_type" varchar(64) NOT NULL DEFAULT 'video/mp4',
  "file_size" bigint,
  "object_key" text NOT NULL,
  "playback_url" text NOT NULL,
  "pack_numbers" integer[] NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'imported',
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_broll_clips_drive_uq"
  ON "dfy_broll_clips" ("drive_file_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_broll_clips_public_uq"
  ON "dfy_broll_clips" ("public_id");

CREATE INDEX IF NOT EXISTS "dfy_broll_clips_status_idx"
  ON "dfy_broll_clips" ("status");
