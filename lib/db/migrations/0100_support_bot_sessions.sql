CREATE TABLE IF NOT EXISTS "support_bot_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text,
  "messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "support_bot_sessions_email_idx" ON "support_bot_sessions" ("email");
CREATE INDEX IF NOT EXISTS "support_bot_sessions_created_at_idx" ON "support_bot_sessions" ("created_at");
