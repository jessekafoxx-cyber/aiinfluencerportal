-- T221: DFY template library + per-user favourites.
--
-- One row per imported tile in the Done For You Pack galleries
-- (Ad Swipe File, Canva Ad Templates, Advertorial Swipe File,
-- Funnel Templates, Landing Page Swipes, VSL Swipes). The
-- (category, source_display_id) pair is unique so re-running the
-- importer is idempotent. image_url is always a path on our own
-- object storage; external URLs (e.g. supabase) are never persisted.

CREATE TABLE IF NOT EXISTS "dfy_templates" (
  "id" serial PRIMARY KEY,
  "category" varchar(32) NOT NULL,
  "sub_category" varchar(32),
  "source_display_id" varchar(64),
  "title" text NOT NULL,
  "image_url" text,
  "media_kind" varchar(16) NOT NULL DEFAULT 'image',
  "canva_url" text,
  "industry" text,
  "awareness_stage" text,
  "ratio" varchar(16),
  "theme" text,
  "platform" varchar(32),
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "dfy_templates_category_idx"
  ON "dfy_templates" ("category");

CREATE INDEX IF NOT EXISTS "dfy_templates_sort_idx"
  ON "dfy_templates" ("category", "sort_order");

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_templates_source_uq"
  ON "dfy_templates" ("category", "source_display_id");

CREATE TABLE IF NOT EXISTS "dfy_template_favourites" (
  "user_id" integer NOT NULL
    REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "template_id" integer NOT NULL
    REFERENCES "dfy_templates"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "template_id")
);

CREATE INDEX IF NOT EXISTS "dfy_template_favourites_user_idx"
  ON "dfy_template_favourites" ("user_id");
