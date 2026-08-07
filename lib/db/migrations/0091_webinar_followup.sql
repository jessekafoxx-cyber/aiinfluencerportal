-- Task #798: Webinar Follow-Up Sequence Engine.
-- In-app E1-E17 email queue + WhatsApp idempotency ledger + unsubscribe
-- list + Slack ops-notification idempotency ledger.

CREATE TABLE IF NOT EXISTS "webinar_email_queue" (
  "id" serial PRIMARY KEY NOT NULL,
  "registrant_id" integer NOT NULL,
  "email_type" text NOT NULL,
  "track" text DEFAULT 'warmup' NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webinar_email_queue_registrant_id_webinar_registrants_id_fk"
    FOREIGN KEY ("registrant_id") REFERENCES "webinar_registrants"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "webinar_email_queue_reg_type_uq"
  ON "webinar_email_queue" ("registrant_id", "email_type");
CREATE INDEX IF NOT EXISTS "webinar_email_queue_status_sched_idx"
  ON "webinar_email_queue" ("status", "scheduled_at");

CREATE TABLE IF NOT EXISTS "webinar_whatsapp_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "registrant_id" integer NOT NULL,
  "message_type" text NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webinar_whatsapp_log_registrant_id_webinar_registrants_id_fk"
    FOREIGN KEY ("registrant_id") REFERENCES "webinar_registrants"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "webinar_whatsapp_log_reg_type_uq"
  ON "webinar_whatsapp_log" ("registrant_id", "message_type");

CREATE TABLE IF NOT EXISTS "webinar_email_optouts" (
  "email" text PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "webinar_ops_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "dedupe_key" text NOT NULL,
  "kind" text NOT NULL,
  "session_id" integer,
  "registrant_id" integer,
  "detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "webinar_ops_notif_dedupe_uq"
  ON "webinar_ops_notifications" ("dedupe_key");
