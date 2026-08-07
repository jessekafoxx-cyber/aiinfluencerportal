// Task #718: regression test for the bonus AR influencer quota
// stacking rule. Buyers of the "Our Portfolio" add-on were marketed
// 5 extra influencers but `computePurchaseEntitlements` only granted
// the +5 for `upsell2Paid`, so Portfolio-only buyers saw
// "Generations used: 1 of 1 - CAP REACHED" despite paying.
//
// Stacking rule (1 free build is added separately in the route):
//   - upsell2Paid (VSL Templates Pack) → +5
//   - portfolioPaid (Our Portfolio)    → +5
//   - admin                            → treated as holding all SKUs
//   - portal_users.bonus_influencer_quota → +N (admin override)
//
// Total user cap surfaced by `/influencer-jobs/quota` =
// 1 + computeBonusInfluencerQuota({...}).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBonusInfluencerQuota } from "../lib/influencer-quota.ts";

test("portfolioPaid-only buyer gets +5 bonus (total cap 6)", () => {
  const bonus = computeBonusInfluencerQuota({ portfolioPaid: true });
  assert.equal(bonus, 5);
  assert.equal(1 + bonus, 6);
});

test("upsell2Paid-only buyer gets +5 bonus (total cap 6)", () => {
  const bonus = computeBonusInfluencerQuota({ upsell2Paid: true });
  assert.equal(bonus, 5);
});

test("upsell2 + portfolio stacks to +10 (total cap 11)", () => {
  const bonus = computeBonusInfluencerQuota({
    upsell2Paid: true,
    portfolioPaid: true,
  });
  assert.equal(bonus, 10);
  assert.equal(1 + bonus, 11);
});

test("no paid SKU and no override returns 0", () => {
  assert.equal(computeBonusInfluencerQuota({}), 0);
  assert.equal(computeBonusInfluencerQuota({ bonusInfluencerQuota: 0 }), 0);
});

test("per-user override stacks on top of paid SKUs", () => {
  const bonus = computeBonusInfluencerQuota({
    portfolioPaid: true,
    bonusInfluencerQuota: 3,
  });
  assert.equal(bonus, 8);
});

test("per-user override never goes negative", () => {
  assert.equal(
    computeBonusInfluencerQuota({ bonusInfluencerQuota: -10 }),
    0,
  );
});

test("admin is treated as holding every extras SKU (+10)", () => {
  assert.equal(computeBonusInfluencerQuota({ isAdmin: true }), 10);
});

test("admin + per-user override stacks", () => {
  assert.equal(
    computeBonusInfluencerQuota({ isAdmin: true, bonusInfluencerQuota: 2 }),
    12,
  );
});
