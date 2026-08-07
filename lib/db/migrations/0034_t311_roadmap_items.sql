CREATE TABLE IF NOT EXISTS "roadmap_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_visible" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

INSERT INTO "roadmap_items" ("label", "sort_order", "is_visible")
SELECT v.label, v.sort_order, true
FROM (VALUES
  ('Advertorial ads and pages lessons', 10),
  ('Creating viral carousels with Claude Code and Higgsfield MCP', 20),
  ('More direct response ad lessons (one for each direct response ad type)', 30)
) AS v(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "roadmap_items");
