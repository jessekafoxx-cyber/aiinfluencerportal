-- Task #584: persist FirstPromoter sale event ids on orders so refund /
-- subscription-cancellation paths can fire trackRefund with the exact
-- same event id that was sent on the original trackSale. Without this,
-- FP cannot match the refund to the sale and the commission clawback
-- silently no-ops.
--
-- Shape:
--   {
--     "<paidField>": "<eventId>",   -- one-time sales (mainProductPaid, upsell3Paid, ...)
--     "renewals": ["<invoice.id>", ...]   -- per-cycle recurring sales
--   }
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS firstpromoter_event_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Audit parity: funnel_leads + coaching_agreements get the promoter id
-- column too so we can reconcile attribution end-to-end without joining
-- back through orders.
ALTER TABLE funnel_leads
  ADD COLUMN IF NOT EXISTS firstpromoter_promoter_id text;

ALTER TABLE coaching_agreements
  ADD COLUMN IF NOT EXISTS firstpromoter_promoter_id text;
