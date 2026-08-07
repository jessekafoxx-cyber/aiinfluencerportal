-- Task #662 follow-up: GoHighLevel grant webhooks for bump2, bump3,
-- upsell1, upsell2, upsell3, downsell1, downsell3.
--
-- Each per-product GHL workflow POSTs a unique receipt id (the GHL
-- order/contact id at the moment that bump/upsell completes). We
-- store one column per product so partial-refund / audit tooling can
-- trace each entitlement back to the exact GHL row that granted it.
-- bump1 already had ghl_bump1_order_id from migration 0065.
--
-- downsell3 shares the upsell3_paid flag (mutual exclusion) but gets
-- its own receipt column so we can tell which path the buyer took.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_bump2_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_bump3_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_upsell1_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_upsell2_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_upsell3_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_downsell1_order_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ghl_downsell3_order_id" text;
