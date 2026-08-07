-- Stamp affiliate attribution on the coaching_agreements table so DFY
-- $15k high-ticket purchases carry the same first-touch affiliate the
-- front-end orders table already carries (migration 0010).
--
-- Backfill rule (handled in code, not here): when /coaching/create runs
-- and the agreement has no affiliate from body or cookie, we look up the
-- buyer's most recent order with affiliate_code stamped within the last
-- 365 days and inherit it. That delivers the 12-month attribution window
-- even when the buyer returns on a different device or after their cookie
-- has expired.
--
-- Both columns are nullable so existing rows stay untouched.
ALTER TABLE coaching_agreements
  ADD COLUMN IF NOT EXISTS affiliate_code text,
  ADD COLUMN IF NOT EXISTS affiliate_attributed_at timestamp;
