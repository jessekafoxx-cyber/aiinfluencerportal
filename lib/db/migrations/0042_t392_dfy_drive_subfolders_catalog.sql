CREATE TABLE IF NOT EXISTS "dfy_drive_subfolders" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "drive_subfolder_id" text NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_drive_subfolders_slug_drive_id_idx"
  ON "dfy_drive_subfolders" ("slug", "drive_subfolder_id");

CREATE INDEX IF NOT EXISTS "dfy_drive_subfolders_slug_active_idx"
  ON "dfy_drive_subfolders" ("slug", "is_active");
