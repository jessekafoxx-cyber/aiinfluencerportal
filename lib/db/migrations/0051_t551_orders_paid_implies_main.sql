-- Task #551: enforce the funnel invariant that every non-main *Paid
-- flag implies the main product was actually paid for.
--
-- Background: every code path that flips bumpN/upsellN/downsellN Paid
-- (charge-upsell, the bundle branch of the payment.succeeded webhook,
-- the portal charge-addon path, the recovery scripts) is supposed to
-- only do so AFTER a confirmed Whop charge against a buyer who has
-- already paid for the $27 main product. If any of those code paths
-- regresses (e.g. a refactor flips the wrong column, a manual SQL
-- patch is written wrong, a recovery script reuses a stale row), the
-- buyer gets portal access to add-ons they were never charged for.
-- A database-level CHECK constraint catches that the next time it
-- happens, regardless of which code path tries to write it.
--
-- The constraint is INTENTIONALLY narrow: it covers the eight funnel
-- flags. Portal sidebar add-ons (done_for_you_pack_paid, portfolio_paid,
-- platinum_paid) are NOT in the predicate because the portal charge-addon
-- path legitimately fires before any main funnel purchase exists for that
-- email (e.g. a buyer who came in through a different SKU). Those have
-- their own ready-checks at their own charge sites.
--
-- Backfill: any historic violator rows (which would block the
-- constraint creation) are first unwound by setting the offending
-- *Paid flag back to false. This is consistent with the refund-revoke
-- path's own behaviour: a row with bumpN/upsellN Paid but no main
-- payment cannot have been a real charge, so it is safe to clear.
-- The cleanup runs in a single transaction with the constraint add
-- so an admin sees one atomic migration.

BEGIN;

UPDATE orders SET bump1_paid = false
  WHERE bump1_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET bump2_paid = false
  WHERE bump2_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET bump3_paid = false
  WHERE bump3_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET upsell1_paid = false
  WHERE upsell1_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET downsell1_paid = false
  WHERE downsell1_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET upsell2_paid = false
  WHERE upsell2_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);
UPDATE orders SET upsell3_paid = false
  WHERE upsell3_paid = true AND (main_product_paid IS NULL OR main_product_paid = false);

ALTER TABLE orders
  ADD CONSTRAINT orders_funnel_paid_implies_main_paid
  CHECK (
    main_product_paid = true
    OR (
      (bump1_paid IS NOT TRUE)
      AND (bump2_paid IS NOT TRUE)
      AND (bump3_paid IS NOT TRUE)
      AND (upsell1_paid IS NOT TRUE)
      AND (downsell1_paid IS NOT TRUE)
      AND (upsell2_paid IS NOT TRUE)
      AND (upsell3_paid IS NOT TRUE)
    )
  );

COMMIT;
