-- Platinum Club "Agency Growth Blueprint" content library. Each row is one
-- downloadable (Drive-streamed) or openable (external link) resource shown in
-- the Platinum Club -> Blueprint tab once that month's drop goes live. Rows are
-- seeded idempotently at worker boot by ensure-platinum-club-resources.ts
-- (publish ships this table via ADD TABLE but skips data backfills, so the boot
-- loader owns the row content). ADD TABLE only - publish-safe.
CREATE TABLE IF NOT EXISTS "platinum_club_resources" (
  "id" serial PRIMARY KEY NOT NULL,
  "section" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "resource_type" text NOT NULL,
  "drive_file_id" text,
  "external_url" text,
  "cover_drive_file_id" text,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "platinum_club_resources_section_idx" ON "platinum_club_resources" ("section");
CREATE INDEX IF NOT EXISTS "platinum_club_resources_active_idx" ON "platinum_club_resources" ("is_active");
