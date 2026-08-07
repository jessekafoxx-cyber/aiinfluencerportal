-- Task #719 - Real impression tracking for portal announcements.
--
-- New table only; no UPDATE blocks. Publish-safe (CREATE TABLE +
-- CREATE INDEX). Replaces the dismiss-only "Seen" approximation with
-- a true per-user impression count.

CREATE TABLE IF NOT EXISTS "announcement_impressions" (
  "id" serial PRIMARY KEY NOT NULL,
  "announcement_id" integer NOT NULL,
  "portal_user_id" integer NOT NULL,
  "first_seen_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "announcement_impressions"
    ADD CONSTRAINT "announcement_impressions_announcement_id_announcements_id_fk"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "announcement_impressions_uq"
  ON "announcement_impressions" ("announcement_id", "portal_user_id");

CREATE INDEX IF NOT EXISTS "announcement_impressions_user_idx"
  ON "announcement_impressions" ("portal_user_id");
