-- Task: External admin API for GetViktor (and future partner agents).
-- Adds three tables:
--   external_api_keys           - hashed API keys + revoke metadata
--   external_api_settings       - singleton row holding global kill switch
--   external_api_audit_log      - append-only log of every API call
--
-- This migration is schema-only (no UPDATE blocks) so it is safe to
-- apply via `pnpm db:push`. The singleton row in external_api_settings
-- is upserted lazily by the API code, so no INSERT is required here.

CREATE TABLE IF NOT EXISTS "external_api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "key_hash" text NOT NULL,
  "name" text NOT NULL,
  "last4" text NOT NULL,
  "created_by_clerk_id" text,
  "created_by_email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_clerk_id" text,
  "revoked_reason" text,
  "last_used_at" timestamp with time zone,
  "last_used_ip" text,
  CONSTRAINT "external_api_keys_key_hash_unique" UNIQUE("key_hash")
);

CREATE TABLE IF NOT EXISTS "external_api_settings" (
  "id" integer PRIMARY KEY NOT NULL,
  "kill_switch_enabled" boolean DEFAULT false NOT NULL,
  "kill_switch_reason" text,
  "kill_switch_toggled_at" timestamp with time zone,
  "kill_switch_toggled_by_email" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "external_api_audit_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "key_id" integer,
  "key_name" text,
  "key_last4" text,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "action" text NOT NULL,
  "target_email" text,
  "request_body" jsonb,
  "before_state" jsonb,
  "after_state" jsonb,
  "reason" text,
  "ip" text,
  "user_agent" text,
  "status_code" integer NOT NULL,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "external_api_audit_log_key_id_idx"
  ON "external_api_audit_log" ("key_id");
CREATE INDEX IF NOT EXISTS "external_api_audit_log_target_email_idx"
  ON "external_api_audit_log" ("target_email");
CREATE INDEX IF NOT EXISTS "external_api_audit_log_action_idx"
  ON "external_api_audit_log" ("action");
CREATE INDEX IF NOT EXISTS "external_api_audit_log_created_at_idx"
  ON "external_api_audit_log" ("created_at");
