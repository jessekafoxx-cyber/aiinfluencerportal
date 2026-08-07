-- T313: persist DFY Drive folder listings + mirror originals/thumbnails to GCS
-- so the 250+ Scenes / 100 AI Influencers grids can serve from Postgres + GCS
-- instead of proxying every thumbnail through Drive on every page load.

CREATE TABLE IF NOT EXISTS "dfy_drive_assets" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "drive_file_id" text NOT NULL,
  "name" text NOT NULL,
  "mime_type" text NOT NULL DEFAULT 'image/jpeg',
  "width" integer,
  "height" integer,
  "file_size" bigint,
  "original_object_key" text,
  "thumb_object_key" text,
  "drive_modified_time" timestamptz,
  "synced_at" timestamptz NOT NULL DEFAULT now(),
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_key" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_drive_assets_slug_file_uq"
  ON "dfy_drive_assets" ("slug", "drive_file_id");

CREATE INDEX IF NOT EXISTS "dfy_drive_assets_slug_active_sort_idx"
  ON "dfy_drive_assets" ("slug", "is_active", "sort_key");

-- Track each successful or failed sync run per slug. The latest row per slug
-- powers the admin "last synced at" line and lets us skip a tick when one
-- is already in flight.
CREATE TABLE IF NOT EXISTS "dfy_drive_sync_runs" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "added" integer NOT NULL DEFAULT 0,
  "updated" integer NOT NULL DEFAULT 0,
  "removed" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "total" integer NOT NULL DEFAULT 0,
  "error" text,
  "lease_expires_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "dfy_drive_sync_runs_slug_started_idx"
  ON "dfy_drive_sync_runs" ("slug", "started_at" DESC);
