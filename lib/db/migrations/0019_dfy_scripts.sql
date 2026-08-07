CREATE TABLE IF NOT EXISTS "dfy_scripts" (
  "id" serial PRIMARY KEY NOT NULL,
  "type" varchar(32) NOT NULL,
  "hook" text NOT NULL,
  "body" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "dfy_scripts_type_idx" ON "dfy_scripts" ("type");
CREATE INDEX IF NOT EXISTS "dfy_scripts_sort_idx" ON "dfy_scripts" ("sort_order");
