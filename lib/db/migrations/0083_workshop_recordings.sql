-- Platinum Club workshop recordings. Separate from `live_workshops`
-- (which schedules upcoming live calls); this table holds the rich
-- recording artifact a member opens after the call: Wistia video,
-- pasted VTT transcript, AI-generated summary / key mentions / links
-- / action points, plus admin free-form notes. Published recordings
-- trigger a one-shot email blast to every Platinum member; `notifiedAt`
-- stamps the blast so re-publishing never double-sends.
-- ADD COLUMN / CREATE TABLE IF NOT EXISTS only - publish-safe.
CREATE TABLE IF NOT EXISTS "workshop_recordings" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "wistia_media_id" text NOT NULL,
  "duration_minutes" integer,
  "transcript_vtt" text,
  "summary" text,
  "key_mentions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "links" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "action_points" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "additional_notes" text,
  "published_at" timestamp with time zone,
  "notified_at" timestamp with time zone,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "workshop_recordings_published_idx"
  ON "workshop_recordings" ("published_at", "recorded_at");
