-- T441: Advertorial page templates catalog (mirrors dfy_bridge_pages).
--
-- Backs the new /done-for-you-pack/advertorial-pages portal page.
-- Rows can be either admin-managed (`source = 'manual'`) or imported
-- from Greg's curated Google Sheet (`source = 'sheet'`). The weekly
-- importer never touches manual rows, so admin edits are preserved.

CREATE TABLE IF NOT EXISTS "dfy_advertorial_pages" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "description" text,
  "template_number" integer,
  "preview_url" text NOT NULL,
  "install_url" text,
  "preview_image_url" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "source" text NOT NULL DEFAULT 'manual',
  "source_row_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "dfy_advertorial_pages_source_key_uq"
  ON "dfy_advertorial_pages" ("source", "source_row_key")
  WHERE "source_row_key" IS NOT NULL;
