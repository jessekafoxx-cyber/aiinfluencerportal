-- Persist the effective (post-promo) MAIN-line cents on each order so the
-- thank-you browser Meta pixel and the server-side CAPI main Purchase event
-- carry an identical value under the shared event_id `order_<id>_main`, even
-- for promo-discounted mains. Stamped by markStripeOrderPaid on the
-- mainProductPaid flip; NULL on legacy rows (the GET /funnel/order/:oid
-- endpoint falls back to a row-derived heuristic). ADD COLUMN only -
-- publish-safe (no UPDATE backfill).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS effective_main_amount_cents integer;
