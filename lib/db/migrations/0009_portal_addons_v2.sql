-- Task #114: Refresh Room30 Portal Upgrades sidebar with new lineup.
-- Adds 5 new boolean paid-flag columns on the orders table — one per new
-- portal upgrade (TikTok AI Slideshow Masterclass, Hook + Demo Library,
-- Done For You Pack, Our Portfolio, Platinum Club). All default to false.
-- The columns are required even before the Stripe price IDs are wired in
-- because admins can grant entitlements manually via Admin → Users, and
-- the sidebar reads these flags to switch each row from "Coming soon" to
-- the unlocked / nav state.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tiktok_slideshow_paid    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hook_demo_paid           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS done_for_you_pack_paid   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portfolio_paid           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platinum_paid            boolean NOT NULL DEFAULT false;
