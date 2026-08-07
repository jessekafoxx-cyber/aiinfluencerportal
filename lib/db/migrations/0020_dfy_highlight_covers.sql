-- Task #210: DFY Pack Instagram Highlight Covers library.
-- Backs the new "Instagram Highlight Covers" section on the Done For You
-- Pack page. Object bytes live in GCS under ${PRIVATE_OBJECT_DIR}/<object_name>
-- (same convention as the carousel image upload flow in portal.ts) and are
-- served back through the existing /portal/images/:fileName route.
CREATE TABLE IF NOT EXISTS dfy_highlight_covers (
  id serial PRIMARY KEY,
  title text NOT NULL,
  object_name text NOT NULL,
  content_type text NOT NULL,
  file_size integer NOT NULL DEFAULT 0,
  original_filename text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by integer,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dfy_highlight_covers_sort_idx
  ON dfy_highlight_covers (sort_order, id);
