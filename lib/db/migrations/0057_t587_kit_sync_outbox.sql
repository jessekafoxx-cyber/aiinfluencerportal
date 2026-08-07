-- Task #587: KIT (ConvertKit) sync outbox.
--
-- Durable queue of upsert / tag / untag operations to apply against KIT.
-- A worker drains the table with exponential backoff so a flaky KIT API
-- never blocks the writing path (funnel lead capture, paid-state flip,
-- admin grant, refund). Schema-only - no UPDATE blocks.

CREATE TABLE IF NOT EXISTS "kit_sync_outbox" (
  "id" serial PRIMARY KEY,
  "contact_email" text NOT NULL,
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

CREATE INDEX IF NOT EXISTS "kit_sync_outbox_status_run_after_idx"
  ON "kit_sync_outbox" ("status", "run_after");

CREATE INDEX IF NOT EXISTS "kit_sync_outbox_email_idx"
  ON "kit_sync_outbox" ("contact_email");
