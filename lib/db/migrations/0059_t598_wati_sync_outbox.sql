-- Task #598: WATI (WhatsApp) sync outbox.
--
-- Mirrors the KIT outbox pattern (migration 0057). Durable queue of
-- upsert / tag / untag operations to apply against WATI. A worker
-- drains the table with exponential backoff so a flaky WATI API
-- never blocks the writing path. Schema-only - no UPDATE blocks.

CREATE TABLE IF NOT EXISTS "wati_sync_outbox" (
  "id" serial PRIMARY KEY,
  "contact_phone" text NOT NULL,
  "contact_email" text,
  "op" text NOT NULL,
  "tag" text,
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "run_after" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "wati_sync_outbox_status_run_after_idx"
  ON "wati_sync_outbox" ("status", "run_after");

CREATE INDEX IF NOT EXISTS "wati_sync_outbox_phone_idx"
  ON "wati_sync_outbox" ("contact_phone");

CREATE INDEX IF NOT EXISTS "wati_sync_outbox_email_idx"
  ON "wati_sync_outbox" ("contact_email");
