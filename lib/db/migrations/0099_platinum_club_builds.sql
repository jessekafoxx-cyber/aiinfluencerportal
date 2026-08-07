-- Platinum Club "DFY Builds" - a build is a self-contained done-for-you library
-- (e.g. "May 2026 - Agency Growth Blueprint"). Admins create / rename / reorder
-- / hide builds at runtime. Each build owns a list of section keys (jsonb);
-- platinum_club_resources rows bucket into a build via their `section` column.
-- Rows are seeded idempotently at worker boot by ensure-platinum-club-builds.ts
-- (publish ships this table via ADD TABLE but skips data backfills, so the boot
-- loader owns the initial row content). ADD TABLE only - publish-safe.
CREATE TABLE IF NOT EXISTS "platinum_club_builds" (
  "id" serial PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "slug" text NOT NULL,
  "sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platinum_club_builds_slug_unique" UNIQUE("slug")
);

CREATE INDEX IF NOT EXISTS "platinum_club_builds_active_idx" ON "platinum_club_builds" ("is_active");
CREATE INDEX IF NOT EXISTS "platinum_club_builds_order_idx" ON "platinum_club_builds" ("display_order");
