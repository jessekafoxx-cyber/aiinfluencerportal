-- Slice B: child scene jobs.
--
-- One row per scene generation slot, owned by a parent ai_influencer_job.
-- Each row leases independently, retries independently, fails independently,
-- and persists its own forensic payloads (provider response, webhook body,
-- poll snapshot). Parent's `scenes` jsonb stays as a legacy mirror so
-- in-flight jobs that pre-date Slice B keep finalizing through the existing
-- inline path; new jobs are seeded into BOTH and the canonical source of
-- truth for finalize aggregation is this table.
--
-- No UPDATE blocks — safe to apply via drizzle-kit push.

CREATE TABLE IF NOT EXISTS "ai_influencer_scene_jobs" (
  "id" serial PRIMARY KEY,
  "parent_job_id" integer NOT NULL REFERENCES "ai_influencer_jobs"("id") ON DELETE CASCADE,
  "influencer_id" integer REFERENCES "ai_influencers"("id") ON DELETE SET NULL,
  "scene_index" integer NOT NULL,
  "folder_name" text,
  "reference_file_id" text,
  "reference_file_name" text,
  "template_id" text,
  "label" text,
  "prompt" text,
  "provider" text NOT NULL DEFAULT 'gemini',
  "status" text NOT NULL DEFAULT 'queued',
  "progress" integer NOT NULL DEFAULT 0,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "retry_count" integer NOT NULL DEFAULT 0,
  "leased_by" text,
  "lease_expires_at" timestamptz,
  "stage_started_at" timestamptz,
  "next_attempt_at" timestamptz,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "last_error_code" text,
  "last_error_message" text,
  "last_error_payload" jsonb,
  "provider_job_id" text,
  "provider_payload_raw" jsonb,
  "webhook_payload_raw" jsonb,
  "poll_payload_raw" jsonb,
  "generated_asset_url" text,
  "generated_asset_path" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_influencer_scene_jobs_parent_idx_uniq" UNIQUE ("parent_job_id", "scene_index")
);

CREATE INDEX IF NOT EXISTS "ai_influencer_scene_jobs_parent_idx"
  ON "ai_influencer_scene_jobs" ("parent_job_id");
CREATE INDEX IF NOT EXISTS "ai_influencer_scene_jobs_status_idx"
  ON "ai_influencer_scene_jobs" ("status");
CREATE INDEX IF NOT EXISTS "ai_influencer_scene_jobs_lease_idx"
  ON "ai_influencer_scene_jobs" ("lease_expires_at")
  WHERE "lease_expires_at" IS NOT NULL;
