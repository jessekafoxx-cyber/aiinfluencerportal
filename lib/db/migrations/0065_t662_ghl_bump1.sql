-- Task #662 (follow-up): GoHighLevel order bump 1 webhook.
--
-- The AI Influencer Masterclass funnel in GoHighLevel can sell an
-- additional "IG Follower / TikTok Slideshow Masterclass" order bump
-- (legacy slug `bump1`). When a buyer takes that bump, GHL fires a
-- second workflow that POSTs to `/api/portal/ghl/grant-bump1`. The
-- backend looks up the buyer's existing `orders` row (created moments
-- earlier by the masterclass enrollment webhook) and flips
-- `bump1_paid=true`.
--
-- Schema delta:
--
--   * Add `orders.ghl_bump1_order_id` so the per-bump GHL receipt id
--     is recorded separately from the main `ghl_order_id`. Lets us
--     audit / replay each bump independently.
--
-- No CHECK constraint changes - the order row's payment_source_type +
-- receipt_verified are already satisfied by the masterclass enrollment
-- (ghl_verified_payment + ghl_order_id IS NOT NULL from migration 0064).
-- The bump1 webhook only updates the bump flag, never the provenance
-- columns or paid_verified state.
--
-- Schema-only delta (no UPDATE). Safe to apply via the migration runner
-- OR via Publish (drizzle-kit push).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ghl_bump1_order_id text;

CREATE INDEX IF NOT EXISTS orders_ghl_bump1_order_id_idx ON orders (ghl_bump1_order_id);
