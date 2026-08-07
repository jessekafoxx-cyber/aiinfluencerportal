-- AI Video Studio (Task #828): admin-only HeyGen talking-head generation
-- with optional Remotion auto-edit, gallery, and a dedicated video-credits
-- balance. Separate credit type from research / os-tool / influencer credits.

CREATE TABLE IF NOT EXISTS "video_credits" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "balance" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_credits_portal_user_unique" ON "video_credits" ("portal_user_id");

CREATE TABLE IF NOT EXISTS "video_credit_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "amount" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "reason" text,
  "ref_type" text,
  "ref_id" text,
  "stripe_payment_intent_id" text,
  "idempotency_key" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "video_credit_tx_portal_user_idx" ON "video_credit_transactions" ("portal_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "video_credit_tx_idempotency_key_unique" ON "video_credit_transactions" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "video_credit_tx_stripe_pi_unique" ON "video_credit_transactions" ("stripe_payment_intent_id") WHERE "stripe_payment_intent_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "heygen_avatars" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "influencer_id" integer,
  "source_image_url" text NOT NULL,
  "source_image_hash" text NOT NULL,
  "heygen_avatar_id" text,
  "heygen_group_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "heygen_avatars_user_hash_unique" ON "heygen_avatars" ("portal_user_id", "source_image_hash");
CREATE INDEX IF NOT EXISTS "heygen_avatars_portal_user_idx" ON "heygen_avatars" ("portal_user_id");

CREATE TABLE IF NOT EXISTS "video_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "portal_user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "influencer_id" integer,
  "heygen_avatar_id" text,
  "source_image_url" text,
  "script" text NOT NULL,
  "voice_id" text,
  "quality" text DEFAULT 'high' NOT NULL,
  "aspect_ratio" text DEFAULT '9:16' NOT NULL,
  "title" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "heygen_video_id" text,
  "raw_video_url" text,
  "thumbnail_url" text,
  "duration_seconds" integer,
  "generation_credits_cost" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "edit_style" text,
  "edit_status" text,
  "remotion_render_id" text,
  "edited_video_url" text,
  "edit_credits_cost" integer DEFAULT 0 NOT NULL,
  "edit_error_message" text,
  "refunded_credits" integer DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "video_jobs_portal_user_idx" ON "video_jobs" ("portal_user_id");
CREATE INDEX IF NOT EXISTS "video_jobs_status_idx" ON "video_jobs" ("status");
CREATE INDEX IF NOT EXISTS "video_jobs_heygen_video_idx" ON "video_jobs" ("heygen_video_id");
CREATE INDEX IF NOT EXISTS "video_jobs_remotion_render_idx" ON "video_jobs" ("remotion_render_id");
