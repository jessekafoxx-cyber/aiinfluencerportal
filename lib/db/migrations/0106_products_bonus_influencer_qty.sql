-- Wire influencer credit grants to the GHL product webhook.
-- Products can now declare how many bonus influencer generations they grant on
-- purchase (bonus_influencer_qty). When set, grantProductToUser increments
-- portal_users.bonus_influencer_quota atomically; on revoke, unused credits
-- are clawed back (mirrors the revokeInfluencerCreditsForPaymentIntent logic).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bonus_influencer_qty integer NOT NULL DEFAULT 0;
