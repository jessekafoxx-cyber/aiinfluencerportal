-- Task #432: Fix dev DB drift where the `orders` table was missing the
-- `phone` column declared in lib/db/src/schema/orders.ts. Production
-- already has the column, so `IF NOT EXISTS` makes this a no-op there.
--
-- Without this column, `computePurchaseEntitlements` in
-- artifacts/api-server/src/routes/portal.ts (which runs a SELECT *
-- against `orders`) throws `column "phone" does not exist` and every
-- GET /api/portal/me returns 500. That cascades into the Room30 portal
-- sidebar treating real admins as non-admins, hiding the Admin link and
-- showing locked / "COMING SOON" pills on admin-only entries.
--
-- Nullable text matches the schema definition. No backfill - new orders
-- will populate it from the checkout phone field going forward; legacy
-- rows stay NULL.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "phone" text;
