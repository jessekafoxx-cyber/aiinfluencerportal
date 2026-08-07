// Task #718: pure helper for the bonus AR influencer quota calc.
// Lives in its own module (no DB / no schema imports) so the stacking
// rule can be regression-tested without spinning up Postgres.
//
// Stacking rule (1 free build is added separately by the route):
//   - upsell2Paid (VSL Templates Pack) → +5
//   - portfolioPaid (Our Portfolio)    → +5
//   - admin                            → treated as holding every "extras" SKU
//   - portal_users.bonus_influencer_quota → +N (admin override / Buyer Access stamp)
//
// SKUs audited and excluded as NOT promising extra influencers:
// bump1/bump2/bump3, upsell1, upsell3, downsell1, tiktokSlideshow,
// hookDemo, doneForYouPack, platinum. If any of those start promising
// extras, sum them here so the cap stays in one place.
export function computeBonusInfluencerQuota(flags: {
  isAdmin?: boolean;
  upsell2Paid?: boolean;
  portfolioPaid?: boolean;
  bonusInfluencerQuota?: number | null;
}): number {
  const isAdmin = !!flags.isAdmin;
  const upsell2 = isAdmin || !!flags.upsell2Paid ? 5 : 0;
  const portfolio = isAdmin || !!flags.portfolioPaid ? 5 : 0;
  const override = Math.max(0, Number(flags.bonusInfluencerQuota ?? 0));
  return upsell2 + portfolio + override;
}
