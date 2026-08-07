-- Whop affiliate attribution on the orders table.
--
-- affiliate_code        : the affiliate's Whop username, captured at
--                         first-touch from the ?a= URL param on apexoffers.io
--                         and stamped on the order row when the checkout
--                         session is created. Once set, NEVER overwritten,
--                         which matches Whop's first-touch cookie rules.
--
-- affiliate_attributed_at: when the stamp landed. Useful for clawback
--                         windows, audits, and debugging attribution
--                         disputes ("when did this order pick up code X?").
--
-- Both columns are nullable: the vast majority of historical orders have
-- no affiliate, and orders placed without a referral cookie should
-- continue to have no affiliate (NOT a synthetic empty string).
--
-- Whop is the system of record for the actual commission ledger and
-- payouts. We only stamp the code here so we can (a) thread it through
-- to upsell / silent-charge calls and (b) self-derive referral counts
-- for the Promote tab inside the customer portal.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS affiliate_code         text,
  ADD COLUMN IF NOT EXISTS affiliate_attributed_at timestamp;
