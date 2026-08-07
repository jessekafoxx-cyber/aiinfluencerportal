-- Task: configurable GHL purchase links for locked upgrade surfaces.
-- GHL-hosted sales page per product; when set, locked portal surfaces open
-- it in a new tab instead of the "purchasing has moved" contact notice.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS purchase_url text;
