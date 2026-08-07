-- Generic per-tool generation history for lightweight AI generators that
-- don't have their own bespoke history table. Lets users see, restore,
-- and copy previous outputs across carousel-creator, prompt-generator,
-- bio-generator, domain-name-generator, image-prompt-generator, etc.
CREATE TABLE IF NOT EXISTS "tool_generations" (
  "id" serial PRIMARY KEY,
  "portal_user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "tool_slug" varchar(64) NOT NULL,
  "label" text,
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tool_generations_user_tool_idx"
  ON "tool_generations" ("portal_user_id", "tool_slug", "created_at");
