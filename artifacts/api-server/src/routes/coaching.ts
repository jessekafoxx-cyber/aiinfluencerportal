import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { coachingAgreementsTable, portalUsersTable, invitesTable, emailLogsTable } from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";
import { getBrandHost, getBrandBaseUrl } from "../lib/brand-url";
import { sendMetaPurchaseEvent, getClientIp as getMetaIp, getClientUserAgent as getMetaUa, readFbpFbcFromCookies } from "../services/metaCapi";

const DFY_PRICE_CENTS = 1500000;
const DFY_PRODUCT_NAME = "Apex Offers Done-For-You Build";

// DFY AI Influencer ($2,997 one-time) - pre-made AI influencer business build
const DFY_AI_INFLUENCER_PRICE_CENTS = 299700;
const DFY_AI_INFLUENCER_PRODUCT_NAME = "DFY AI Influencer - Pre-Made Business";

// DFY AI Influencer high-ticket Gold & Diamond tiers - Stripe-only embedded
// checkout on /dfy-ai-influencer (no Whop / GHL hosted page involved). Price
// IDs match the live products in the Room30 Stripe account.
const DFY_AI_INFLUENCER_GOLD_PRICE_CENTS = 499700;
const DFY_AI_INFLUENCER_GOLD_PRODUCT_NAME = "DFY AI Influencer - Gold";
const DFY_AI_INFLUENCER_GOLD_STRIPE_PRICE_ID = "price_1Tb2KRDkijFZD39kUtLgKa8P";
const DFY_AI_INFLUENCER_DIAMOND_PRICE_CENTS = 999700;
const DFY_AI_INFLUENCER_DIAMOND_PRODUCT_NAME = "DFY AI Influencer - Diamond";
const DFY_AI_INFLUENCER_DIAMOND_STRIPE_PRICE_ID = "price_1Tb2KuDkijFZD39kfpvbInMB";

// Standalone $2,997 variant of the Gold build, served as a sign-only service
// agreement on its own page (room30.ai/dfy-ai-influencer-gold-special). No
// payment is collected on the page - the Fee is arranged directly between the
// Parties - so the stored agreement text omits the Stripe-at-signing clauses.
// Identical to Gold except for the price and that it does NOT include the
// weekly group coaching calls (the Section 1.4 mentorship workshops). The price
// is retained for records only (the agreement's packagePriceCents).
const DFY_AI_INFLUENCER_GOLD_SPECIAL_PRICE_CENTS = 299700;
const DFY_AI_INFLUENCER_GOLD_SPECIAL_PRODUCT_NAME = "DFY AI Influencer - Gold (Special)";

type DfyAiInfluencerHighTicketTier = "gold" | "diamond" | "gold_special";

function buildDfyAiInfluencerHighTicketAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  tier: DfyAiInfluencerHighTicketTier;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const isDiamond = input.tier === "diamond";
  const isGoldSpecial = input.tier === "gold_special";
  const tierLabel = isDiamond ? "DIAMOND" : "GOLD";
  const feeUsd = isDiamond ? "$9,997 USD" : isGoldSpecial ? "$2,997 USD" : "$4,997 USD";
  const diamondExtras = isDiamond
    ? `\n\n1.6 Diamond Tier Extras. The Client receives, in addition to the Gold deliverables: (a) one additional 10,000-follower Done-For-You AI Influencer with another 90 days of scheduled content for that second influencer; (b) a 1:1 Slack channel with a dedicated mentor for twelve (12) months; (c) twelve (12) monthly 1:1 Zoom calls (30 minutes each) with the dedicated mentor; and (d) 10% off any live event ticket for the Client and one (1) guest during the twelve (12) month engagement.`
    : "";
  // The standalone Gold (Special) variant excludes the weekly group coaching
  // calls, so Section 1.4 (Mentorship & Scaling) is omitted entirely and the
  // A-List Portal Access clause is renumbered from 1.5 to 1.4.
  const mentorshipClause = isGoldSpecial
    ? ""
    : `\n\n1.4 Mentorship & Scaling. The Client receives weekly 2-hour live workshops with Gregory Cooke for twelve (12) months from the Effective Date.`;
  const aListClause = `\n\n${isGoldSpecial ? "1.4" : "1.5"} A-List Portal Access. A-List portal access auto-unlocked on payment, including the supporting curriculum and resource library at room30.ai.${diamondExtras}`;
  // The standalone Gold (Special) flow is a sign-only agreement - no payment is
  // collected on the page; the Fee is arranged directly between the Parties.
  // The non-special tiers are charged in full via Stripe at signing, so the
  // payment clauses below are swapped to match the actual flow.
  const paymentTermsClause = isGoldSpecial
    ? "Payment of the Fee is arranged directly between the Parties by invoice or another method agreed in writing; no payment is collected through this Agreement. The Services and the Effective Date commence once payment arrangements have been agreed between the Parties."
    : "The Fee is due in full upon signing this Agreement and is processed via Stripe. The Services and the Effective Date commence only once the Fee has cleared in full.";
  const paymentMechanicsSection = isGoldSpecial
    ? `4. PAYMENT MECHANICS

4.1 Method. Payment of the Fee is arranged directly between the Parties by invoice or another method agreed in writing. The Client agrees to settle the Fee in full in accordance with the agreed terms.

4.2 Non-Payment. If the Fee is not paid in accordance with the agreed terms, this Agreement is voidable at the Company's sole discretion and Services may be paused or terminated until payment is fully restored.`
    : `4. PAYMENT MECHANICS

4.1 Processor. Payment is processed via Stripe. The Client authorises Stripe to charge the payment method provided at checkout for the full Fee.

4.2 Failed or Reversed Payment. If the Fee fails to clear, is reversed, refunded by the processor, or otherwise becomes uncollected for any reason, this Agreement is voidable at the Company's sole discretion and Services may be paused or terminated until payment is fully restored.`;
  return `SERVICE AGREEMENT - DFY AI INFLUENCER (${tierLabel} TIER)

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a one-time, fixed-fee Done-For-You ("DFY") AI Influencer build at the ${tierLabel} tier.

1. SERVICES

1.1 Persona Creation & Positioning. The Company will pick or confirm the niche, design the influencer's look, voice, personality, and brand identity.

1.2 Account Build & Audience Growth. The Company will set up and fully optimise the Instagram and TikTok accounts and supply pre-warmed accounts with 10,000+ real followers.

1.3 Content Engine & Hand-Off. The Company will create and schedule 90 days of original content (posts, reels, carousels), write all captions, hooks, and hashtags, and run a private hand-off call to walk the Client through everything.${mentorshipClause}${aListClause}

2. COMPENSATION

2.1 Fee. The Client agrees to pay the Company a one-time fee of ${feeUsd} (the "Fee") for the Services described in Section 1.

2.2 Payment Terms. ${paymentTermsClause}

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. CLIENT COMMITMENT

3.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, or AI assets provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

3.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

3.3 Licence to Deliverables. On full payment of the Fee and subject to Section 3.1, the Client receives a perpetual, worldwide, non-exclusive licence to use the finalised AI influencer assets and supporting materials in the Client's own business.

${paymentMechanicsSection}

5. NO REFUNDS

5.1 Acknowledgement. The Client acknowledges that the Services are delivered digitally and that substantial Company time, AI compute, and team coordination commence within twenty-four (24) hours of the Effective Date, and that the Fee is non-refundable in whole or in part for any reason.

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 8 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. RELATIONSHIP OF THE PARTIES

7.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

7.2 No Guarantee of Results. The Services are a build engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

8. DISPUTE RESOLUTION

8.1 Governing Law. This Agreement is governed by the laws of England and Wales.

8.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

9. GENERAL

9.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

9.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

9.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

9.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

10. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// Exported so stripe-funnel.ts can stamp the Stripe price id into PI
// metadata for revenue attribution / dashboard filtering by product.
// Covers both the DFY AI Influencer high-ticket tiers and the Portugal
// Retreat 2026 Gold/VIP passes (sep2026 embedded Stripe flow).
export function getCoachingAgreementStripePriceId(
  agreementType: string,
): string | null {
  if (agreementType === "dfy_ai_influencer_gold") return DFY_AI_INFLUENCER_GOLD_STRIPE_PRICE_ID;
  if (agreementType === "dfy_ai_influencer_diamond") return DFY_AI_INFLUENCER_DIAMOND_STRIPE_PRICE_ID;
  if (agreementType === "portugal_gold") return PORTUGAL_GOLD_STRIPE_PRICE_ID;
  if (agreementType === "portugal_vip") return PORTUGAL_VIP_STRIPE_PRICE_ID;
  const dfyContentPlan = parseDfyContentPlan(agreementType);
  if (dfyContentPlan) return dfyContentPlan.priceId;
  const dfyAdsPlan = parseDfyAdsPlan(agreementType);
  if (dfyAdsPlan) return dfyAdsPlan.priceId;
  return null;
}

// ---------------------------------------------------------------------------
// AI Influencer Account Rental (recurring monthly subscriptions)
// ---------------------------------------------------------------------------
// Three tiers billed as TRUE monthly Stripe subscriptions (auto-billed). The
// signed service agreement carries a 90-day minimum term. Unlike the other
// coaching/high-ticket flows these grant NO portal entitlement - fulfilment is
// the managed AI-influencer rental service. Prices mirror STRIPE_PRODUCTS
// (rent_p1/p2/p3); the Stripe Price ids are resolved at subscription-create
// time via the lookup keys (created by scripts/seed-stripe-catalog.ts).
type RentTier = "p1" | "p2" | "p3";
const RENT_P1_PRICE_CENTS = 99700;
const RENT_P2_PRICE_CENTS = 149700;
const RENT_P3_PRICE_CENTS = 249700;
const RENT_P1_PRODUCT_NAME = "AI Influencer Account Rental - Starter";
const RENT_P2_PRODUCT_NAME = "AI Influencer Account Rental - Growth";
const RENT_P3_PRODUCT_NAME = "AI Influencer Account Rental - Scale";
const RENT_LOOKUP_KEYS: Record<RentTier, string> = {
  p1: "rent_p1_v1",
  p2: "rent_p2_v1",
  p3: "rent_p3_v1",
};
const RENT_MINIMUM_TERM_MONTHS = 3;

function rentTierFromType(agreementType: string): RentTier | null {
  if (agreementType === "rent_p1") return "p1";
  if (agreementType === "rent_p2") return "p2";
  if (agreementType === "rent_p3") return "p3";
  return null;
}

function rentPriceCents(tier: RentTier): number {
  return tier === "p3" ? RENT_P3_PRICE_CENTS : tier === "p2" ? RENT_P2_PRICE_CENTS : RENT_P1_PRICE_CENTS;
}

function rentProductName(tier: RentTier): string {
  return tier === "p3" ? RENT_P3_PRODUCT_NAME : tier === "p2" ? RENT_P2_PRODUCT_NAME : RENT_P1_PRODUCT_NAME;
}

// ---------------------------------------------------------------------------
// AI Influencer Account Rental v2 matrix
// ---------------------------------------------------------------------------
// Bronze/Silver/Gold/Diamond x With/Without Ads x Monthly/Annual. The
// agreementType is encoded as `rent_<tier>[_ads]_<monthly|annual>`, e.g.
// `rent_gold_ads_annual`. Annual price = monthly x 10 (two months free). Each
// plan maps to a Stripe Price by lookup key (created by seed-stripe-catalog)
// and is billed as a TRUE recurring Stripe subscription. Like the legacy
// rent_p* tiers these grant NO portal entitlement - fulfilment is the managed
// rental service. Monthly plans carry a 90-day minimum term; annual plans are
// prepaid for a 12-month minimum term.
type RentPlanTier = "bronze" | "silver" | "gold" | "diamond";
type RentPlanBilling = "monthly" | "annual";

interface RentPlan {
  tier: RentPlanTier;
  ads: boolean;
  billing: RentPlanBilling;
  lookupKey: string;
  priceCents: number;
  monthlyPriceCents: number;
  tierLabel: string;
  postsPerDay: number;
  productName: string;
  /** Query string that reconstructs the checkout deep-link for this plan. */
  checkoutQuery: string;
}

const RENT_PLAN_MONTHLY_CENTS: Record<RentPlanTier, { noAds: number; ads: number }> = {
  bronze: { noAds: 49700, ads: 79700 },
  silver: { noAds: 99700, ads: 149700 },
  gold: { noAds: 149700, ads: 249700 },
  diamond: { noAds: 249700, ads: 499700 },
};
const RENT_PLAN_POSTS_PER_DAY: Record<RentPlanTier, number> = {
  bronze: 1,
  silver: 3,
  gold: 5,
  diamond: 10,
};
const RENT_PLAN_TIER_LABEL: Record<RentPlanTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};

function parseRentPlan(agreementType: string): RentPlan | null {
  const m = /^rent_(bronze|silver|gold|diamond)(_ads)?_(monthly|annual)$/.exec(agreementType);
  if (!m) return null;
  const tier = m[1] as RentPlanTier;
  const ads = m[2] === "_ads";
  const billing = m[3] as RentPlanBilling;
  const monthly = ads ? RENT_PLAN_MONTHLY_CENTS[tier].ads : RENT_PLAN_MONTHLY_CENTS[tier].noAds;
  const priceCents = billing === "annual" ? monthly * 10 : monthly;
  const lookupKey = `rent_${tier}${ads ? "_ads" : ""}_${billing === "annual" ? "y" : "m"}_v1`;
  const slug = `${tier}${ads ? "_ads" : ""}`;
  const tierLabel = RENT_PLAN_TIER_LABEL[tier];
  const productName = `AI Influencer Rental - ${tierLabel}${ads ? " + Ads" : ""} (${billing === "annual" ? "Annual" : "Monthly"})`;
  return {
    tier,
    ads,
    billing,
    lookupKey,
    priceCents,
    monthlyPriceCents: monthly,
    tierLabel,
    postsPerDay: RENT_PLAN_POSTS_PER_DAY[tier],
    productName,
    checkoutQuery: `tier=${slug}&billing=${billing}`,
  };
}

// ---------------------------------------------------------------------------
// Done-For-You Content (one-time content packs + monthly content subscriptions)
// ---------------------------------------------------------------------------
// Bronze/Silver/Gold/Diamond x one-time | monthly. The agreementType is encoded
// as `dfy_content_<tier>_<onetime|monthly>`. Like the rent_* tiers this flow is
// Stripe-only, pay-first (signature deferred), and grants NO portal entitlement
// - fulfilment is the managed content-creation service delivered within 48 hours
// (two business days) via a Google Drive link. One-time packs are a single
// PaymentIntent; monthly plans are TRUE recurring Stripe subscriptions billed
// against the price id below. Prices mirror the published /dfycontent matrix.
type DfyContentTier = "bronze" | "silver" | "gold" | "diamond";
type DfyContentBilling = "onetime" | "monthly";

interface DfyContentPlan {
  tier: DfyContentTier;
  billing: DfyContentBilling;
  priceCents: number;
  priceId: string;
  tierLabel: string;
  postsPerDay: number;
  postsPerMonth: number;
  productName: string;
  recurring: boolean;
  /** Query string that reconstructs the checkout deep-link for this plan. */
  checkoutQuery: string;
}

const DFY_CONTENT_ONETIME_CENTS: Record<DfyContentTier, number> = {
  bronze: 29700,
  silver: 69700,
  gold: 99700,
  diamond: 149700,
};
const DFY_CONTENT_MONTHLY_CENTS: Record<DfyContentTier, number> = {
  bronze: 24700,
  silver: 49700,
  gold: 79700,
  diamond: 129700,
};
const DFY_CONTENT_ONETIME_PRICE_IDS: Record<DfyContentTier, string> = {
  bronze: "price_1TlaRkDkijFZD39kwQuMXiM6",
  silver: "price_1TlaRqDkijFZD39kenUw7osD",
  gold: "price_1TlaRvDkijFZD39koCxeMoSV",
  diamond: "price_1TlaS0DkijFZD39koRWn0KOT",
};
const DFY_CONTENT_MONTHLY_PRICE_IDS: Record<DfyContentTier, string> = {
  bronze: "price_1TlaS5DkijFZD39k0d4c61Qu",
  silver: "price_1TlaS9DkijFZD39kPILmTFcm",
  gold: "price_1TlaSFDkijFZD39kIHRcg9e6",
  diamond: "price_1TlaSLDkijFZD39ky9C19hla",
};
const DFY_CONTENT_TIER_LABEL: Record<DfyContentTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};
const DFY_CONTENT_POSTS_PER_DAY: Record<DfyContentTier, number> = {
  bronze: 1,
  silver: 3,
  gold: 5,
  diamond: 10,
};

function parseDfyContentPlan(agreementType: string): DfyContentPlan | null {
  const m = /^dfy_content_(bronze|silver|gold|diamond)_(onetime|monthly)$/.exec(agreementType);
  if (!m) return null;
  const tier = m[1] as DfyContentTier;
  const billing = m[2] as DfyContentBilling;
  const recurring = billing === "monthly";
  const priceCents = recurring ? DFY_CONTENT_MONTHLY_CENTS[tier] : DFY_CONTENT_ONETIME_CENTS[tier];
  const priceId = recurring ? DFY_CONTENT_MONTHLY_PRICE_IDS[tier] : DFY_CONTENT_ONETIME_PRICE_IDS[tier];
  const tierLabel = DFY_CONTENT_TIER_LABEL[tier];
  const postsPerDay = DFY_CONTENT_POSTS_PER_DAY[tier];
  const productName = `Done-For-You Content - ${tierLabel} (${recurring ? "Monthly" : "One-Time"})`;
  return {
    tier,
    billing,
    priceCents,
    priceId,
    tierLabel,
    postsPerDay,
    postsPerMonth: postsPerDay * 30,
    productName,
    recurring,
    checkoutQuery: `tier=${tier}&billing=${billing}`,
  };
}

function buildDfyContentAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  plan: DfyContentPlan;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const plan = input.plan;
  const recurring = plan.recurring;
  const feeUsd = `$${(plan.priceCents / 100).toLocaleString("en-US")} USD`;
  const pieceWord = plan.postsPerDay === 1 ? "piece" : "pieces";
  const postsLine = `${plan.postsPerDay} ${pieceWord} of content per day (approximately ${plan.postsPerMonth} pieces of content per month)`;
  // Section 1.2 (Delivery) language.
  const deliveryBody = recurring
    ? `The Company will produce and deliver the Content on a rolling basis for each monthly cycle, delivered via a Google Drive link sent to the Client's email of record. New content for each cycle is typically delivered within 48 hours (two business days) of the start of that cycle.`
    : `The Content will be delivered within 48 hours (two business days) of the Effective Date via a Google Drive link sent to the Client's email of record.`;
  // Section 2 (Compensation) language.
  const feeHeading = recurring ? "2.1 Monthly Fee" : "2.1 One-Time Fee";
  const feeBody = recurring
    ? `The Client agrees to pay the Company a recurring monthly fee of ${feeUsd} (the "Fee") for the Services described in Section 1.`
    : `The Client agrees to pay the Company a one-time fee of ${feeUsd} (the "Fee") for the Services described in Section 1.`;
  const billingHeading = "2.2 Payment";
  const billingBody = recurring
    ? `The Fee is billed automatically each month to the payment method provided at checkout via Stripe, on the same day of each month as the Effective Date, until this Agreement is cancelled in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring basis.`
    : `The Fee is charged once at checkout via Stripe for the Content described in Section 1. There is no recurring billing.`;
  // Section 3 (Term) language.
  const termHeading = recurring ? "3.1 Rolling Monthly Term" : "3.1 Delivery-Based Engagement";
  const termBody = recurring
    ? `This Agreement runs on a rolling month-to-month basis and renews automatically each month until cancelled under Section 4. There is no long-term lock-in and no minimum number of months.`
    : `This is a one-time content production engagement. The Agreement is completed on delivery of the Content; there is no minimum term and no recurring billing.`;
  // Section 4 (Cancellation) language.
  const cancelHeading = recurring ? "4.1 Cancellation" : "4.1 Completion";
  const cancelBody = recurring
    ? `The Client may cancel at any time by giving the Company written notice by email to dfy@room30.ai at least seven (7) days before the next monthly billing date. Cancellation stops future renewals; the Client keeps any Content already delivered. The Client's access continues until the close of the then-current paid month.`
    : `As a one-time engagement there is nothing to cancel once the Content is delivered. The Client keeps the delivered Content.`;
  const cancelRefundHeading = recurring ? "4.2 No Partial-Month Refunds" : "4.2 No Refunds On Delivered Work";
  const cancelRefundBody = recurring
    ? `Fees already charged for any billing cycle, including the current cycle at the time of cancellation, are non-refundable.`
    : `Once production of the Content has begun the Fee is non-refundable, as the Content is bespoke and made to order for the Client.`;
  // Section 5 (No Refunds) language.
  const noRefundBody = recurring
    ? `The Client acknowledges that the Content is bespoke and made to order, that substantial Company time and team coordination commence promptly after each monthly cycle begins, and that each monthly Fee is non-refundable in whole or in part for any reason.`
    : `The Client acknowledges that the Content is bespoke and made to order, that substantial Company time and team coordination commence promptly after the Effective Date, and that the Fee is non-refundable in whole or in part once production has begun.`;
  return `DONE-FOR-YOU CONTENT SERVICE AGREEMENT (${plan.tierLabel.toUpperCase()} ${recurring ? "MONTHLY" : "ONE-TIME"})

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a fully-managed, done-for-you content creation service at the ${plan.tierLabel} tier.

1. SERVICES

1.1 Content Production. The Company will script, create, and edit ${postsLine} for the Client (the "Content"). The Content is short-form social media content such as podcast clips, hook and demo videos, and similar formats.

1.2 Delivery. ${deliveryBody}

1.3 Client Posting. The Content is produced for the Client to post to the Client's own social media accounts. The Company does not post on the Client's behalf and does not operate or manage the Client's accounts.

1.4 Ownership. On full payment for the relevant Content, the Client owns the delivered Content and may use it freely on the Client's own channels.

2. COMPENSATION

${feeHeading}. ${feeBody}

${billingHeading}. ${billingBody}

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. TERM

${termHeading}. ${termBody}

4. CANCELLATION

${cancelHeading}. ${cancelBody}

${cancelRefundHeading}. ${cancelRefundBody}

5. NO REFUNDS

5.1 Acknowledgement. ${noRefundBody}

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 9 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. CLIENT COMMITMENT

7.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, or AI assets provided by the Company beyond the Client's own use of the delivered Content, and not to use the Company's materials to deliver services to third parties without prior written consent.

7.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

8. RELATIONSHIP OF THE PARTIES

8.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

8.2 No Guarantee of Results. The Services are a content production engagement, not a guarantee of revenue, traffic, followers, conversion, or commercial outcome. Outcomes depend on the Client's market, posting, offer, and external factors outside the Company's control.

9. DISPUTE RESOLUTION

9.1 Governing Law. This Agreement is governed by the laws of England and Wales.

9.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

10. GENERAL

10.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

10.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

10.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

10.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

11. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// Done-For-You Ads (Task: /dfyads). Mirrors the Done-For-You Content flow:
// Bronze/Silver/Gold/Diamond x one-time | monthly, encoded as
// `dfy_ads_<tier>_<onetime|monthly>`. Stripe-only, pay-first (signature
// deferred), grants NO portal entitlement - fulfilment is the managed ad
// creative service delivered within 48 hours (two business days) via a Google
// Drive link. One-time packs are a single PaymentIntent; monthly plans are TRUE
// recurring Stripe subscriptions billed against the price id below. Prices
// mirror the published /dfyads matrix and match the content matrix dollar for
// dollar; only the Stripe price ids and the ad-count copy differ.
type DfyAdsTier = "bronze" | "silver" | "gold" | "diamond";
type DfyAdsBilling = "onetime" | "monthly";

interface DfyAdsPlan {
  tier: DfyAdsTier;
  billing: DfyAdsBilling;
  priceCents: number;
  priceId: string;
  tierLabel: string;
  adsPerMonth: number;
  productName: string;
  recurring: boolean;
  /** Query string that reconstructs the checkout deep-link for this plan. */
  checkoutQuery: string;
}

const DFY_ADS_ONETIME_CENTS: Record<DfyAdsTier, number> = {
  bronze: 29700,
  silver: 69700,
  gold: 99700,
  diamond: 149700,
};
const DFY_ADS_MONTHLY_CENTS: Record<DfyAdsTier, number> = {
  bronze: 24700,
  silver: 49700,
  gold: 79700,
  diamond: 129700,
};
const DFY_ADS_ONETIME_PRICE_IDS: Record<DfyAdsTier, string> = {
  bronze: "price_1TlaWTDkijFZD39kLDnc6eso",
  silver: "price_1TlaWaDkijFZD39knbeWo8Vo",
  gold: "price_1TlaWeDkijFZD39kwtrEsiEI",
  diamond: "price_1TlaWjDkijFZD39kXP5ZsZYd",
};
const DFY_ADS_MONTHLY_PRICE_IDS: Record<DfyAdsTier, string> = {
  bronze: "price_1TlaWoDkijFZD39kJzEAcmHW",
  silver: "price_1TlaWuDkijFZD39kCJSh4quj",
  gold: "price_1TlaX3DkijFZD39kkZPspo24",
  diamond: "price_1TlaX8DkijFZD39kjTyAUrbh",
};
const DFY_ADS_TIER_LABEL: Record<DfyAdsTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};
const DFY_ADS_PER_MONTH: Record<DfyAdsTier, number> = {
  bronze: 30,
  silver: 90,
  gold: 150,
  diamond: 300,
};

// Intake forms the buyer must complete after checkout so the team can start the
// 48-hour delivery. Content and ads have separate, format-specific forms.
const DFY_CONTENT_INTAKE_FORM_URL = "https://wkf.ms/4vxyWe4";
const DFY_ADS_INTAKE_FORM_URL = "https://wkf.ms/4waRa56";

function parseDfyAdsPlan(agreementType: string): DfyAdsPlan | null {
  const m = /^dfy_ads_(bronze|silver|gold|diamond)_(onetime|monthly)$/.exec(agreementType);
  if (!m) return null;
  const tier = m[1] as DfyAdsTier;
  const billing = m[2] as DfyAdsBilling;
  const recurring = billing === "monthly";
  const priceCents = recurring ? DFY_ADS_MONTHLY_CENTS[tier] : DFY_ADS_ONETIME_CENTS[tier];
  const priceId = recurring ? DFY_ADS_MONTHLY_PRICE_IDS[tier] : DFY_ADS_ONETIME_PRICE_IDS[tier];
  const tierLabel = DFY_ADS_TIER_LABEL[tier];
  const adsPerMonth = DFY_ADS_PER_MONTH[tier];
  const productName = `Done-For-You Ads - ${tierLabel} (${recurring ? "Monthly" : "One-Time"})`;
  return {
    tier,
    billing,
    priceCents,
    priceId,
    tierLabel,
    adsPerMonth,
    productName,
    recurring,
    checkoutQuery: `tier=${tier}&billing=${billing}`,
  };
}

function buildDfyAdsAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  plan: DfyAdsPlan;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const plan = input.plan;
  const recurring = plan.recurring;
  const feeUsd = `$${(plan.priceCents / 100).toLocaleString("en-US")} USD`;
  const adWord = plan.adsPerMonth === 1 ? "ad" : "ads";
  const adsLine = recurring
    ? `approximately ${plan.adsPerMonth} ${adWord} per month`
    : `${plan.adsPerMonth} ${adWord}`;
  // Section 1.2 (Delivery) language.
  const deliveryBody = recurring
    ? `The Company will produce and deliver the Ads on a rolling basis for each monthly cycle, delivered via a Google Drive link sent to the Client's email of record. New Ads for each cycle are typically delivered within 48 hours (two business days) of the start of that cycle.`
    : `The Ads will be delivered within 48 hours (two business days) of the Effective Date via a Google Drive link sent to the Client's email of record.`;
  // Section 2 (Compensation) language.
  const feeHeading = recurring ? "2.1 Monthly Fee" : "2.1 One-Time Fee";
  const feeBody = recurring
    ? `The Client agrees to pay the Company a recurring monthly fee of ${feeUsd} (the "Fee") for the Services described in Section 1.`
    : `The Client agrees to pay the Company a one-time fee of ${feeUsd} (the "Fee") for the Services described in Section 1.`;
  const billingHeading = "2.2 Payment";
  const billingBody = recurring
    ? `The Fee is billed automatically each month to the payment method provided at checkout via Stripe, on the same day of each month as the Effective Date, until this Agreement is cancelled in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring basis.`
    : `The Fee is charged once at checkout via Stripe for the Ads described in Section 1. There is no recurring billing.`;
  // Section 3 (Term) language.
  const termHeading = recurring ? "3.1 Rolling Monthly Term" : "3.1 Delivery-Based Engagement";
  const termBody = recurring
    ? `This Agreement runs on a rolling month-to-month basis and renews automatically each month until cancelled under Section 4. There is no long-term lock-in and no minimum number of months.`
    : `This is a one-time ad creative production engagement. The Agreement is completed on delivery of the Ads; there is no minimum term and no recurring billing.`;
  // Section 4 (Cancellation) language.
  const cancelHeading = recurring ? "4.1 Cancellation" : "4.1 Completion";
  const cancelBody = recurring
    ? `The Client may cancel at any time by giving the Company written notice by email to dfy@room30.ai at least seven (7) days before the next monthly billing date. Cancellation stops future renewals; the Client keeps any Ads already delivered. The Client's access continues until the close of the then-current paid month.`
    : `As a one-time engagement there is nothing to cancel once the Ads are delivered. The Client keeps the delivered Ads.`;
  const cancelRefundHeading = recurring ? "4.2 No Partial-Month Refunds" : "4.2 No Refunds On Delivered Work";
  const cancelRefundBody = recurring
    ? `Fees already charged for any billing cycle, including the current cycle at the time of cancellation, are non-refundable.`
    : `Once production of the Ads has begun the Fee is non-refundable, as the Ads are bespoke and made to order for the Client.`;
  // Section 5 (No Refunds) language.
  const noRefundBody = recurring
    ? `The Client acknowledges that the Ads are bespoke and made to order, that substantial Company time and team coordination commence promptly after each monthly cycle begins, and that each monthly Fee is non-refundable in whole or in part for any reason.`
    : `The Client acknowledges that the Ads are bespoke and made to order, that substantial Company time and team coordination commence promptly after the Effective Date, and that the Fee is non-refundable in whole or in part once production has begun.`;
  return `DONE-FOR-YOU ADS SERVICE AGREEMENT (${plan.tierLabel.toUpperCase()} ${recurring ? "MONTHLY" : "ONE-TIME"})

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a fully-managed, done-for-you ad creative service at the ${plan.tierLabel} tier.

1. SERVICES

1.1 Ad Creative Production. The Company will concept, create, and edit ${adsLine} for the Client (the "Ads"). The Ads are static (image-based) paid social advertising creatives such as hook-driven static ads, humour ads, meme-style ads, and similar static formats. For the avoidance of doubt, the Ads are static image creatives and do not include video ads.

1.2 Delivery. ${deliveryBody}

1.3 Client Use. The Ads are produced for the Client to run on the Client's own advertising accounts. The Company does not run, manage, or optimise the Client's ad campaigns and does not operate the Client's ad accounts.

1.4 Ownership. On full payment for the relevant Ads, the Client owns the delivered Ads and may use them freely in the Client's own advertising.

2. COMPENSATION

${feeHeading}. ${feeBody}

${billingHeading}. ${billingBody}

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. TERM

${termHeading}. ${termBody}

4. CANCELLATION

${cancelHeading}. ${cancelBody}

${cancelRefundHeading}. ${cancelRefundBody}

5. NO REFUNDS

5.1 Acknowledgement. ${noRefundBody}

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 9 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. CLIENT COMMITMENT

7.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, or AI assets provided by the Company beyond the Client's own use of the delivered Ads, and not to use the Company's materials to deliver services to third parties without prior written consent.

7.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

8. RELATIONSHIP OF THE PARTIES

8.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

8.2 No Guarantee of Results. The Services are an ad creative production engagement, not a guarantee of revenue, traffic, leads, conversion, or commercial outcome. Outcomes depend on the Client's market, ad spend, targeting, offer, and external factors outside the Company's control.

9. DISPUTE RESOLUTION

9.1 Governing Law. This Agreement is governed by the laws of England and Wales.

9.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

10. GENERAL

10.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

10.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

10.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

10.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

11. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// 1:1 Mentorship (recurring subscription, two billing options). Like the rent_*
// tiers it is Stripe-only, grants NO portal entitlement, and is billed via a
// true Stripe subscription. The mentorship is delivered by the team AND Greg.
//   - "mentorship" (annual): $4,997/yr, 12-month minimum term.
//   - "mentorship_quarterly": $1,497 every 3 months, 3-month minimum term,
//     then auto-renews each quarter (one Stripe price, interval=month x3).
// Prices mirror STRIPE_PRODUCTS; the Stripe Price id is resolved at
// subscription-create time via the lookup key.
const MENTORSHIP_PRICE_CENTS = 499700;
const MENTORSHIP_PRODUCT_NAME = "1:1 Mentorship - Annual";
const MENTORSHIP_LOOKUP_KEY = "mentorship_annual_v2";
const MENTORSHIP_MINIMUM_TERM_MONTHS = 12;
const MENTORSHIP_QUARTERLY_PRICE_CENTS = 149700;
const MENTORSHIP_QUARTERLY_PRODUCT_NAME = "1:1 Mentorship - Quarterly";
const MENTORSHIP_QUARTERLY_LOOKUP_KEY = "mentorship_quarterly_v1";

type MentorshipBilling = "annual" | "quarterly";

function isMentorshipType(agreementType: string): boolean {
  return agreementType === "mentorship" || agreementType === "mentorship_quarterly";
}

// Returns the billing cadence for a mentorship agreement type, or null when the
// type is not a mentorship type.
function mentorshipBillingFromType(agreementType: string): MentorshipBilling | null {
  if (agreementType === "mentorship") return "annual";
  if (agreementType === "mentorship_quarterly") return "quarterly";
  return null;
}

function mentorshipPriceCents(billing: MentorshipBilling): number {
  return billing === "quarterly" ? MENTORSHIP_QUARTERLY_PRICE_CENTS : MENTORSHIP_PRICE_CENTS;
}

function mentorshipLookupKey(billing: MentorshipBilling): string {
  return billing === "quarterly" ? MENTORSHIP_QUARTERLY_LOOKUP_KEY : MENTORSHIP_LOOKUP_KEY;
}

function mentorshipProductName(billing: MentorshipBilling): string {
  return billing === "quarterly" ? MENTORSHIP_QUARTERLY_PRODUCT_NAME : MENTORSHIP_PRODUCT_NAME;
}

// Exported so stripe-funnel.ts can create the recurring subscription against
// the right Stripe Price (resolved by lookup key) when a recurring agreement is
// paid. Covers the monthly rent_* tiers and the annual mentorship plan. Returns
// null for non-recurring agreement types so the caller falls back to the
// one-time PaymentIntent path.
export function getCoachingAgreementSubscriptionConfig(
  agreementType: string,
): { lookupKey?: string; priceCents: number; priceId?: string } | null {
  const tier = rentTierFromType(agreementType);
  if (tier) return { lookupKey: RENT_LOOKUP_KEYS[tier], priceCents: rentPriceCents(tier) };
  const plan = parseRentPlan(agreementType);
  if (plan) return { lookupKey: plan.lookupKey, priceCents: plan.priceCents };
  const mentorshipBilling = mentorshipBillingFromType(agreementType);
  if (mentorshipBilling) {
    return {
      lookupKey: mentorshipLookupKey(mentorshipBilling),
      priceCents: mentorshipPriceCents(mentorshipBilling),
    };
  }
  // DFY Content monthly plans are recurring subscriptions billed against a
  // hard-coded Stripe Price id (no lookup-key indirection). One-time DFY
  // Content packs are NOT subscriptions and fall through to the PI path.
  const dfyContentPlan = parseDfyContentPlan(agreementType);
  if (dfyContentPlan && dfyContentPlan.recurring) {
    return { priceId: dfyContentPlan.priceId, priceCents: dfyContentPlan.priceCents };
  }
  // DFY Ads monthly plans mirror the DFY Content recurring-subscription path:
  // billed against a hard-coded Stripe Price id. One-time packs fall through.
  const dfyAdsPlan = parseDfyAdsPlan(agreementType);
  if (dfyAdsPlan && dfyAdsPlan.recurring) {
    return { priceId: dfyAdsPlan.priceId, priceCents: dfyAdsPlan.priceCents };
  }
  return null;
}

function buildMentorshipAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  billing: MentorshipBilling;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const isQuarterly = input.billing === "quarterly";
  const engagementTermWord = isQuarterly ? "three (3) month minimum" : "twelve (12) month";
  // Section 2 (Compensation) language.
  const feeHeading = isQuarterly ? "2.1 Quarterly Fee" : "2.1 Annual Fee";
  const feeAmount = isQuarterly ? "$1,497 USD" : "$4,997 USD";
  const feeCadenceWord = isQuarterly ? "quarterly" : "annual";
  const recurringCadence = isQuarterly
    ? "every three (3) months"
    : "each year";
  const recurringAnchor = isQuarterly
    ? "on the same day of the third month after each billing date"
    : "on the same date each year as the Effective Date";
  // Section 3 (Minimum Term) language.
  const minimumHeading = isQuarterly ? "3.1 Three-Month Minimum" : "3.1 Twelve-Month Minimum";
  const minimumBody = isQuarterly
    ? `This Agreement has a minimum term of three (3) months from the Effective Date (the "Minimum Term"). The Client commits to the full first quarter and may not terminate this Agreement before the end of the Minimum Term.`
    : `This Agreement has a minimum term of ${MENTORSHIP_MINIMUM_TERM_MONTHS} months from the Effective Date (the "Minimum Term"). The Client commits to the full Minimum Term and may not terminate this Agreement before its end.`;
  const autoRenewBody = isQuarterly
    ? `After the Minimum Term this Agreement renews automatically for successive three (3) month terms until cancelled under Section 4. The Client may cancel any time after the first quarter.`
    : `After the Minimum Term this Agreement renews automatically for successive twelve (12) month terms until cancelled under Section 4.`;
  // Section 4 (Cancellation) language.
  const cancelNoticeDays = isQuarterly ? "seven (7)" : "fourteen (14)";
  const cancelBillingWord = isQuarterly ? "quarterly" : "annual";
  return `1:1 MENTORSHIP AGREEMENT

This Mentorship Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a private ${engagementTermWord} 1:1 mentorship engagement delivered by the Company's team and Gregory Cooke.

1. SERVICES

1.1 Private 1:1 Slack Channel. The Company will provide the Client with a private, direct 1:1 Slack channel for the duration of this Agreement for ongoing guidance, questions, and support from the Company's team and Gregory Cooke.

1.2 Monthly 1:1 Calls. The Company will provide the Client with one (1) one-to-one call of approximately thirty (30) minutes each month for the duration of this Agreement, scheduled by mutual agreement.

1.3 Advanced Masterclass. The Company will provide the Client with access to its advanced masterclass on building and managing an autonomous AI influencer operation end-to-end, including the systems used to run large-scale AI influencer portfolios with autonomous agents.

1.4 Nature of Services. The Services are advisory mentorship and education. The Company provides guidance, frameworks, and materials; it does not operate the Client's business or guarantee any specific outcome.

2. COMPENSATION

${feeHeading}. The Client agrees to pay the Company a recurring ${feeCadenceWord} fee of ${feeAmount} (the "Fee") for the Services described in Section 1.

2.2 Recurring Billing. The Fee is billed automatically ${recurringCadence} to the payment method provided at checkout via Stripe, ${recurringAnchor}, until this Agreement is terminated in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring basis.

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. MINIMUM TERM

${minimumHeading}. ${minimumBody}

3.2 Auto-Renewal. ${autoRenewBody}

4. CANCELLATION

4.1 Cancellation At Renewal. The Client may cancel future renewals at any time by giving the Company written notice by email to greg@cookemedia.io at least ${cancelNoticeDays} days before the next ${cancelBillingWord} billing date. Cancellation stops future renewals; the Client's access continues until the close of the then-current paid term.

4.2 No Partial-Term Refunds. Fees already charged for any term, including the current term at the time of cancellation, are non-refundable.

5. NO REFUNDS

5.1 Acknowledgement. The Client acknowledges that the Services are delivered as a personal, time-based mentorship and that substantial Company time and access commence promptly after the Effective Date, and that the Fee is non-refundable in whole or in part for any reason.

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 9 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. CLIENT COMMITMENT

7.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, AI assets, or masterclass content provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

7.2 Good Faith. The Client agrees to engage in good faith and to attend scheduled calls and act on guidance in a timely manner.

8. RELATIONSHIP OF THE PARTIES

8.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

8.2 No Guarantee of Results. The Services are a mentorship and education engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

9. DISPUTE RESOLUTION

9.1 Governing Law. This Agreement is governed by the laws of England and Wales.

9.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

10. GENERAL

10.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

10.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

10.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

10.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

11. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

function buildRentAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  tier: RentTier;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const tier = input.tier;
  const tierLabel = tier === "p3" ? "SCALE" : tier === "p2" ? "GROWTH" : "STARTER";
  const accounts = tier === "p3" ? 3 : tier === "p2" ? 2 : 1;
  const accountWord = accounts === 1 ? "account" : "accounts";
  const feeUsd =
    tier === "p3" ? "$2,497 USD" : tier === "p2" ? "$1,497 USD" : "$997 USD";
  return `AI INFLUENCER ACCOUNT RENTAL AGREEMENT (${tierLabel} TIER)

This Rental Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for the monthly rental of fully-managed AI influencer ${accountWord} at the ${tierLabel} tier.

1. SERVICES

1.1 Rented AI Influencer ${accounts === 1 ? "Property" : "Properties"}. For the duration of this Agreement the Company grants the Client a non-exclusive, non-transferable right to access and earn from ${accounts} fully-managed AI influencer ${accountWord} (the "Rented ${accounts === 1 ? "Property" : "Properties"}"). The Rented ${accounts === 1 ? "Property" : "Properties"} remain at all times the property of the Company.

1.2 Management & Content. The Company will operate the Rented ${accountWord}, including persona upkeep, content creation and scheduling, captions, hooks, and ongoing optimisation, on the Client's behalf for the duration of the rental.

1.3 Reporting. The Company will provide the Client with a monthly performance summary for each Rented Property.

1.4 No Ownership Transfer. Nothing in this Agreement transfers ownership of the Rented ${accountWord}, the underlying personas, or any associated intellectual property to the Client. On termination the Client's right of access ends and the Rented ${accountWord} revert fully to the Company.

2. COMPENSATION

2.1 Monthly Fee. The Client agrees to pay the Company a recurring monthly fee of ${feeUsd} (the "Fee") for the Services described in Section 1.

2.2 Recurring Billing. The Fee is billed automatically each month to the payment method provided at checkout via Stripe, on the same day of each month as the Effective Date, until this Agreement is terminated in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring basis.

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. MINIMUM TERM

3.1 Ninety-Day Minimum. This Agreement has a minimum term of ${RENT_MINIMUM_TERM_MONTHS} months (90 days) from the Effective Date (the "Minimum Term"). The Client commits to pay the Fee for each of the first three (3) monthly billing cycles regardless of cancellation, and may not terminate this Agreement before the end of the Minimum Term.

3.2 Auto-Renewal. After the Minimum Term this Agreement continues on a rolling month-to-month basis and renews automatically each month until cancelled under Section 4.

4. CANCELLATION

4.1 Cancellation After Minimum Term. After the Minimum Term the Client may cancel at any time by giving the Company written notice by email to greg@cookemedia.io at least seven (7) days before the next billing date. Cancellation stops future renewals; the Client's access to the Rented ${accountWord} ends at the close of the then-current paid month.

4.2 No Partial-Month Refunds. Fees already charged for any billing cycle, including the current cycle at the time of cancellation, are non-refundable.

5. NO REFUNDS

5.1 Acknowledgement. The Client acknowledges that the Services are delivered digitally and that substantial Company time, AI compute, and team coordination commence within twenty-four (24) hours of the Effective Date, and that each monthly Fee is non-refundable in whole or in part for any reason.

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 9 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. CLIENT COMMITMENT

7.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, AI assets, or Rented ${accountWord} provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

7.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

8. RELATIONSHIP OF THE PARTIES

8.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

8.2 No Guarantee of Results. The Services are a managed-rental engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

9. DISPUTE RESOLUTION

9.1 Governing Law. This Agreement is governed by the laws of England and Wales.

9.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

10. GENERAL

10.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

10.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

10.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

10.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

11. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// AI Influencer Account Rental v2 agreement text (Bronze/Silver/Gold/Diamond x
// With/Without Ads x Monthly/Annual). Parametrised off the parsed RentPlan so a
// single template covers all 16 SKUs. Mirrors the legacy buildRentAgreementText
// terms but is plan-aware: posts-per-day, ads management, fee, billing cadence,
// and minimum term all flex with the plan.
function buildRentPlanAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  plan: RentPlan;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const { plan } = input;
  const tierLabel = plan.tierLabel.toUpperCase();
  const feeUsd = `$${(plan.priceCents / 100).toLocaleString("en-US")} USD`;
  const isAnnual = plan.billing === "annual";
  const cadenceWord = isAnnual ? "annual" : "monthly";
  const cycleWord = isAnnual ? "year" : "month";
  const adsClause = plan.ads
    ? " The Company will additionally plan, run, and manage paid advertising for the Rented Property as part of the Services."
    : "";
  const billingClause = isAnnual
    ? `2.2 Recurring Billing. The Fee is billed automatically once per year to the payment method provided at checkout via Stripe, on the anniversary of the Effective Date, until this Agreement is terminated in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring annual basis.`
    : `2.2 Recurring Billing. The Fee is billed automatically each month to the payment method provided at checkout via Stripe, on the same day of each month as the Effective Date, until this Agreement is terminated in accordance with Section 4. The Client authorises Stripe to charge the payment method on this recurring basis.`;
  const minTermClause = isAnnual
    ? `3.1 Twelve-Month Minimum. This Agreement has a minimum term of twelve (12) months from the Effective Date (the "Minimum Term"). The annual Fee is paid in advance for the full Minimum Term, and the Client may not terminate this Agreement before the end of the Minimum Term.`
    : `3.1 Ninety-Day Minimum. This Agreement has a minimum term of ${RENT_MINIMUM_TERM_MONTHS} months (90 days) from the Effective Date (the "Minimum Term"). The Client commits to pay the Fee for each of the first three (3) monthly billing cycles regardless of cancellation, and may not terminate this Agreement before the end of the Minimum Term.`;
  const renewalClause = isAnnual
    ? `3.2 Auto-Renewal. After the Minimum Term this Agreement renews automatically each year until cancelled under Section 4.`
    : `3.2 Auto-Renewal. After the Minimum Term this Agreement continues on a rolling month-to-month basis and renews automatically each month until cancelled under Section 4.`;
  return `AI INFLUENCER ACCOUNT RENTAL AGREEMENT (${tierLabel} TIER${plan.ads ? " - WITH ADS" : ""})

This Rental Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}${input.address && input.address.trim() ? `\nClient Address: ${input.address}` : ""}

This agreement is between the Company and the Client (collectively the "Parties") for the ${cadenceWord} rental of one fully-managed AI influencer account at the ${tierLabel} tier.

1. SERVICES

1.1 Rented AI Influencer Property. For the duration of this Agreement the Company grants the Client a non-exclusive, non-transferable right to access and earn from one fully-managed AI influencer account (the "Rented Property"). The Rented Property remains at all times the property of the Company.

1.2 Management & Content. The Company will operate the Rented Property, including persona upkeep, content creation and scheduling, captions, hooks, and ongoing optimisation, on the Client's behalf for the duration of the rental.${adsClause}

1.3 Reporting. The Company will provide the Client with a ${cadenceWord} performance summary for the Rented Property.

1.4 No Ownership Transfer. Nothing in this Agreement transfers ownership of the Rented Property, the underlying persona, or any associated intellectual property to the Client. On termination the Client's right of access ends and the Rented Property reverts fully to the Company.

2. COMPENSATION

2.1 ${isAnnual ? "Annual" : "Monthly"} Fee. The Client agrees to pay the Company a recurring ${cadenceWord} fee of ${feeUsd} (the "Fee") for the Services described in Section 1.

${billingClause}

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. MINIMUM TERM

${minTermClause}

${renewalClause}

4. CANCELLATION

4.1 Cancellation After Minimum Term. After the Minimum Term the Client may cancel at any time by giving the Company written notice by email to greg@cookemedia.io at least seven (7) days before the next billing date. Cancellation stops future renewals; the Client's access to the Rented Property ends at the close of the then-current paid ${cycleWord}.

4.2 No Partial-Period Refunds. Fees already charged for any billing cycle, including the current cycle at the time of cancellation, are non-refundable.

5. NO REFUNDS

5.1 Acknowledgement. The Client acknowledges that the Services are delivered digitally and that substantial Company time, AI compute, and team coordination commence within twenty-four (24) hours of the Effective Date, and that each Fee is non-refundable in whole or in part for any reason.

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 9 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. CLIENT COMMITMENT

7.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, AI assets, or the Rented Property provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

7.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

8. RELATIONSHIP OF THE PARTIES

8.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

8.2 No Guarantee of Results. The Services are a managed-rental engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

9. DISPUTE RESOLUTION

9.1 Governing Law. This Agreement is governed by the laws of England and Wales.

9.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

10. GENERAL

10.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

10.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

10.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

10.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

11. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// Internal address that receives a notification email every time a high-ticket
// agreement is paid in full. This is what backs the "our team will be in touch
// within 24 hours" promise on the AI Influencer thank-you screen and on the
// $15k DFY thank-you screen. Override per-environment via env var if needed.
const HIGH_TICKET_NOTIFY_EMAIL =
  process.env.HIGH_TICKET_NOTIFY_EMAIL || "greg@cookemedia.io";

// Buyer-facing email identity for AI Influencer account rentals (the /rent
// matrix). Sends from the Resend-verified `dfy.room30.ai` domain and routes
// replies to the human-monitored Done For You inbox (dfy@room30.ai). Both are
// env-overridable in case the verified sending domain or contact mailbox
// changes. The local part of the From only needs the domain to be verified in
// Resend - it does not need to be a real mailbox; replies land on RENT_REPLY_TO.
const RENT_FROM_EMAIL =
  process.env.RENT_FROM_EMAIL?.trim() ||
  "AI Influencer Portfolio <team@dfy.room30.ai>";
const RENT_REPLY_TO = process.env.RENT_REPLY_TO?.trim() || "dfy@room30.ai";

// 1:1 Mentorship welcome/receipt emails send from the verified room30.ai domain
// with replies routed to the mentorship inbox. The local part only needs the
// domain verified in Resend; replies land on MENTORSHIP_REPLY_TO.
const MENTORSHIP_FROM_EMAIL =
  process.env.MENTORSHIP_FROM_EMAIL?.trim() ||
  "AI Influencer Portfolio <mentorship@room30.ai>";
const MENTORSHIP_REPLY_TO =
  process.env.MENTORSHIP_REPLY_TO?.trim() || "mentorship@room30.ai";

// Portugal AI Portfolio Retreat 2026 (Sept 4-6, Pine Cliffs, Algarve)
const PORTUGAL_GOLD_PRICE_CENTS = 499700;
const PORTUGAL_VIP_PRICE_CENTS = 749700;
const PORTUGAL_GOLD_PRODUCT_NAME = "AI Portfolio Portugal Retreat 2026 - Gold Pass";
const PORTUGAL_VIP_PRODUCT_NAME = "AI Portfolio Portugal Retreat 2026 - VIP Pass";
// Stripe price ids for the Portugal Retreat 2026 passes. Stamped into
// PI metadata by stripe-funnel.ts at create-coaching-intent time so the
// Stripe dashboard can filter/report by product without joining back to
// the coaching_agreements row.
const PORTUGAL_GOLD_STRIPE_PRICE_ID = "price_1TXc9JDkijFZD39kOH3BDcql";
const PORTUGAL_VIP_STRIPE_PRICE_ID = "price_1TXc9KDkijFZD39kgPYnlMEA";

// Hard inventory cap for the Portugal Retreat 2026 Gold Pass. Real sales run
// through Stripe (coaching_agreements rows), so we count the agreements that
// have reached a paid/fulfilled state. Once that count hits the cap, no new
// Gold agreement can be signed and no new PaymentIntent can be minted, so an
// 8th Gold seat can never be charged. VIP is sold out entirely (see the
// portugal_vip guards). Keep this in lockstep with SEP2026_SEATS_LEFT in
// lib/sep2026-config (the public scarcity counter).
const PORTUGAL_GOLD_MAX_TICKETS = 7;
// coaching_agreements statuses that count as a confirmed, paid seat. claimDfy
// flips a row to "active"; "paid"/"completed" are later fulfilment states.
const PORTUGAL_PAID_STATUSES = ["active", "paid", "completed"] as const;

// Counts Gold Pass seats that have been paid for. Used by the create +
// create-coaching-intent guards to enforce PORTUGAL_GOLD_MAX_TICKETS.
export async function countPaidPortugalGold(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(coachingAgreementsTable)
    .where(
      and(
        eq(coachingAgreementsTable.agreementType, "portugal_gold"),
        inArray(coachingAgreementsTable.status, [...PORTUGAL_PAID_STATUSES]),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function isPortugalGoldSoldOut(): Promise<boolean> {
  return (await countPaidPortugalGold()) >= PORTUGAL_GOLD_MAX_TICKETS;
}

export { PORTUGAL_GOLD_MAX_TICKETS };

type PortugalTier = "gold" | "vip";

function buildPortugalAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
  tier: PortugalTier;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  const tierLabel = input.tier === "vip" ? "VIP PASS" : "GOLD PASS";
  const feeUsd = input.tier === "vip" ? "$7,497 USD" : "$4,997 USD";
  const vipExtras =
    input.tier === "vip"
      ? `\n\n1.10 VIP Day. The Client receives an exclusive VIP day on Thursday 3 September 2026 with intimate small-group access to Gregory Cooke, including a private welcome dinner with the VIP cohort, an off-itinerary 1:1 portfolio audit, off-itinerary Q&A with Gregory Cooke outside the public room, priority front-row seating across all four event days (Thursday to Sunday), priority hot-seat slots throughout the weekend, and a direct WhatsApp line to Gregory Cooke's team for the full twelve (12) month implementation window. The VIP Pass is offered exclusively for the first edition of the Retreat (4-6 September 2026) and will not be made available for any subsequent Retreats at this price or scope.\n\n1.11 Guaranteed YouTube Consult (VIP Only). The Client is guaranteed one (1) sixty-minute (60-min) one-to-one consultation with Gregory Cooke, scheduled within twelve (12) months of the Retreat closing date. The consultation will, where reasonably practicable, be conducted in person (with Gregory Cooke either flying the Client out or travelling to the Client at AI Influencer Portfolio's discretion and cost) and otherwise conducted virtually. The Client acknowledges and agrees that the consultation will be recorded in full and the recording (including the Client's voice, name, business, and on-screen likeness where applicable) may be edited, published, and distributed by AI Influencer Portfolio on the Gregory Cooke YouTube channel and any associated social or marketing channels in perpetuity. The Client grants AI Influencer Portfolio a worldwide, royalty-free, perpetual licence to use such recordings for these purposes.`
      : "";

  return `SERVICE AGREEMENT - AI PORTFOLIO PORTUGAL RETREAT 2026 (${tierLabel}) WITH GREGORY COOKE

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for the Client's attendance at the AI Portfolio Portugal Retreat 2026, a 3-day in-person event held at Pine Cliffs Resort, Albufeira, Algarve, Portugal from Friday 4 September 2026 to Sunday 6 September 2026 (the "Retreat").

1. SERVICES

1.1 Retreat Attendance. One (1) Client seat at the AI Portfolio Portugal Retreat 2026 (3 days, Friday 4 to Sunday 6 September 2026), capped at thirty (30) attendees in total. Sessions cover the AI faceless portfolio offer build, paid acquisition, monetisation stack, and live workshops with Gregory Cooke and the AI Influencer Portfolio team.

1.2 On-Site Accommodation. Three (3) nights of on-property accommodation at Pine Cliffs Resort (check-in Friday 4 September 2026, check-out Monday 7 September 2026), single occupancy in the room class allocated by the Company.

1.3 Catering. Daily breakfast and lunch on each of the three Retreat days, plus the welcome reception and the closing dinner.

1.4 Workshop Materials. All workshop slides, frameworks, prompt libraries, and template files used during the Retreat, delivered via the Client's portal account.

1.5 Recordings. Lifetime access to the recorded keynotes and workshop sessions from the Retreat, delivered via the Client's portal account within thirty (30) days of the Retreat closing.

1.6 12-Month Mentorship Window. Following the Retreat, the Client receives a twelve (12) month implementation window with monthly thirty (30) minute 1:1 Zoom calls hosted by the AI Influencer Portfolio coaching team and 24/7 asynchronous chat access to the coaching team via Slack or WhatsApp (selected by the Client). The Client may also be invited to participate, on a hot-seat basis, in live audits of attendees' funnels, ad accounts, and offers conducted in front of the room during the Retreat itself.

1.7 AI Investor Platform. Lifetime access to the GREGORY. AI Investor Platform, the Company's internal operating system for managing AI faceless portfolios, social accounts, and standard operating procedures, provisioned to the Client's portal account. Access to the AI Investor Platform under this Agreement is reserved exclusively for Retreat attendees and is not generally available outside this engagement.

1.8 Travel. International and domestic flights, airport transfers, ground transport, travel insurance, and any pre-arrival or post-departure nights are NOT included in the Fee and are the Client's responsibility.

1.9 Optional Excursions. Optional off-itinerary excursions (golf, spa, boat days) may be offered at cost; pricing is confirmed in the pre-Retreat brief and is NOT included in the Fee.${vipExtras}

2. COMPENSATION

2.1 Fee. The Client agrees to pay the Company a one-time fee of ${feeUsd} (the "Fee") for the Services described in Section 1.

2.2 Payment Terms. The Fee is due in full upon signing this Agreement and is processed via Whop. The Client's seat is reserved only once the Fee has cleared in full.

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. CLIENT COMMITMENT

3.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, recordings, or strategies provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

3.2 Conduct. The Client agrees to engage in good faith, to respect other attendees and Pine Cliffs Resort staff, and to comply with the Resort's house rules at all times. The Company may remove any attendee whose conduct materially disrupts the Retreat without refund.

3.3 Travel Documents. The Client is solely responsible for ensuring valid passports, visas, and travel insurance are in place ahead of the Retreat.

4. PAYMENT MECHANICS

4.1 Processor. Payment is processed via Whop. The Client authorises Whop to charge the payment method provided at checkout for the full Fee.

4.2 Failed Or Reversed Payment. If the Fee fails to clear, is reversed, refunded by the processor, or otherwise becomes uncollected for any reason, this Agreement is voidable at the Company's sole discretion and the Client's seat may be released until payment is fully restored.

5. TERM

This Agreement commences on the Effective Date (defined in Section 2.2) and continues until the close of the Retreat on Sunday 6 September 2026, save that the obligations under Sections 1.5, 1.6, 1.7, 1.10, 1.11, 8, 9, 10, and 11 survive the close of the Retreat (with Sections 1.10 and 1.11 surviving only where the Client holds a VIP Pass).

6. TERMINATION & RESCHEDULE

6.1 By The Client. The Client acknowledges that the Retreat is a fixed-date in-person event with non-recoverable Company costs (venue, accommodation, catering, talent) committed well in advance, and that the Fee is non-refundable in whole or in part for any reason (see Section 8).

6.2 Substitution. The Client may transfer their seat to a substitute attendee at no charge by providing the substitute's full name and email to greg@cookemedia.io no later than fourteen (14) days before the Retreat start date. The substitute is bound by this Agreement.

6.3 Force Majeure Reschedule. If the Company is unable to host the Retreat on the scheduled dates due to a Force Majeure event under Section 12.5, the Company will reschedule the Retreat to a comparable date and venue and credit the Client's Fee in full to the rescheduled Retreat. No cash refund is owed under Section 8.

7. RELATIONSHIP OF THE PARTIES

7.1 No Exclusivity. This is not an exclusive arrangement. The Company may serve other clients, including in similar markets.

7.2 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

7.3 No Guarantee Of Results. The Retreat and 12-month mentorship window are an education and access engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

8. NO REFUNDS

8.1 Acknowledgement. The Client acknowledges that the Retreat carries non-recoverable third-party costs (venue, accommodation, catering, talent, production) committed within hours of the Effective Date, and that the Fee is non-refundable in whole or in part for any reason.

8.2 No Refund Triggers. Without limitation, the Client agrees that no refund, credit, or chargeback is owed in any of the following circumstances: change of mind, loss of interest, change in the Client's business model or market, dissatisfaction with results, dissatisfaction with the venue, accommodation, catering, or curriculum, the Client's failure to travel, the Client's failure to attend any session, the Client's failure to obtain valid travel documents, illness preventing travel (the Client's travel insurance is the correct remedy), or termination by either Party under Section 6.

8.3 Survival. This Section 8 survives termination of this Agreement.

9. CHARGEBACK WAIVER

9.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Retreat.

9.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 11 is the Client's sole and exclusive remedy in respect of any dispute arising under this Agreement, and that initiating a chargeback or processor dispute in violation of this Section 9 constitutes a material breach of this Agreement.

9.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 9.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full. The Company may also report any unpaid amounts to credit reference and collection agencies.

9.4 Acknowledgement. The Client confirms that this Section 9 has been read, understood, and accepted as a fundamental commercial term of this Agreement, and that the Fee under Section 2 has been priced on the basis of this waiver.

10. CONFIDENTIALITY

Each Party agrees to keep confidential all non-public information disclosed by the other Party in connection with this Agreement and the Retreat, including offer economics, financial data, frameworks, strategies, prompts, recordings, and other attendees' identities and businesses. This obligation continues for three (3) years after the close of the Retreat.

11. DISPUTE RESOLUTION

11.1 Governing Law. This Agreement is governed by the laws of England and Wales.

11.2 Negotiation. The Parties agree to first attempt to resolve any dispute by good-faith written negotiation between the Parties for at least thirty (30) days from the date the dispute is raised in writing.

11.3 Mediation. If negotiation fails, the Parties agree to attempt mediation through a mutually agreed mediator before commencing arbitration.

11.4 Binding Arbitration. Any dispute not resolved through negotiation or mediation will be finally resolved by binding arbitration seated in London, England, conducted in English under the rules of the London Court of International Arbitration ("LCIA") by a single arbitrator. The arbitral award is final and enforceable in any court of competent jurisdiction.

11.5 Legal Fees. The prevailing Party in any dispute, arbitration, collection, or enforcement action arising under this Agreement is entitled to recover its reasonable legal fees and costs from the other Party.

12. GENERAL

12.1 No Assignment. Neither Party may assign this Agreement without the other Party's prior written consent, except that the Company may assign to a successor entity in connection with a sale or reorganisation, and the Client may transfer the seat under Section 6.2.

12.2 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions, proposals, and agreements.

12.3 Severability. If any provision of this Agreement is held invalid or unenforceable, the remaining provisions remain in full force.

12.4 No Waiver. No waiver of any term is effective unless in writing and signed by the waiving Party.

12.5 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control, including acts of God, war, civil unrest, pandemic, natural disaster, government travel restrictions, venue closure, or processor or platform outage, provided the affected Party gives prompt notice and uses reasonable efforts to mitigate. Section 6.3 governs the Retreat reschedule remedy.

12.6 Counterparts & Electronic Signature. This Agreement may be executed electronically and in counterparts, each of which is deemed an original. The Parties agree that an electronic signature has the same legal effect as a handwritten signature.

13. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

const router: IRouter = Router();
function getClientIp(req: any): string {
  return req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.headers["x-real-ip"]?.toString() ||
    req.socket?.remoteAddress || "unknown";
}

function buildDfyAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  return `SERVICE AGREEMENT - DONE-FOR-YOU BUILD WITH GREGORY COOKE

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a one-time, fixed-fee Done-For-You ("DFY") build engagement.

1. SERVICES

1.1 Onboarding & War Map. Within seven (7) days of the Effective Date, the Company will deliver a 60-minute private 1:1 onboarding and "War Map" call with the Client to capture brand voice, market, offer economics, asset inventory, and the launch milestone for the build.

1.2 Direct Access & Communication. Direct 1:1 access to the Company via Slack or WhatsApp (selected by the Client), available Monday to Friday, 08:00 to 20:00 UK time, throughout the active build window. Members of the Company team may participate in the channel to support delivery and response times.

1.3 Build Cadence Calls. Biweekly (every two weeks) 1:1 build review calls of 30 minutes each during the active build window. The Company reserves the right to have qualified team members conduct these calls where appropriate.

1.4 Private Client Portal. A branded, password-protected client portal containing build progress, deliverables, recordings of all calls, KPI dashboards, and an asset approval workflow. Lifetime access to recordings and finalised assets.

1.5 Build Deliverables. The Company will design, write, and build the assets defined on the apexoffers.io done-for-you page at the Effective Date, including but not limited to: branded client portal experience, low-ticket and high-ticket funnel pages, paid ad creative briefs, organic content scripts and shot lists, video sales letter ("VSL") scripts, sales copy, order bumps and upsell stack, thank-you and onboarding sequences, and the supporting tracker tooling. Specific deliverables, formats, and acceptance criteria are confirmed in writing during the War Map call (Section 1.1).

1.6 Implementation Support. Where required, the Company will integrate into the Client's tools, systems, or platforms (Stripe, Whop, Klaviyo, ad accounts, hosting, analytics, and similar) to publish and connect deliverables. Third-party platform fees are not included.

1.7 Optional Workshop Attendance. The Client may attend Company-hosted in-person workshops held quarterly in Portugal, Miami, or other locations at the Company's discretion. Travel and accommodation are not included in the fee under Section 2.

1.8 Lifetime Materials Access. Lifetime access to all training materials, frameworks, and recordings produced during this engagement.

2. COMPENSATION

2.1 Fee. The Client agrees to pay the Company a one-time fee of $15,000 USD (the "Fee") for the Services described in Section 1.

2.2 Payment Terms. The Fee is due in full upon signing this Agreement and is processed via Whop. The Services and the Effective Date commence only once the Fee has cleared in full.

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. CLIENT COMMITMENT

3.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, or strategies provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

3.2 Good Faith. The Client agrees to engage in good faith, to respond to asset approval requests within five (5) business days, and to provide accurate brand assets, copy inputs, and platform credentials reasonably required for delivery.

3.3 Licence to Deliverables. On full payment of the Fee and subject to Section 3.1, the Client receives a perpetual, worldwide, non-exclusive licence to use the finalised deliverables produced under this Agreement in the Client's own business.

4. PAYMENT MECHANICS

4.1 Processor. Payment is processed via Whop. The Client authorises Whop to charge the payment method provided at checkout for the full Fee.

4.2 Failed or Reversed Payment. If the Fee fails to clear, is reversed, refunded by the processor, or otherwise becomes uncollected for any reason, this Agreement is voidable at the Company's sole discretion and Services may be paused or terminated until payment is fully restored.

5. TERM

This Agreement commences on the Effective Date (defined in Section 2.2) and continues until the earlier of: (a) acceptance by the Client of all Build Deliverables under Section 1.5; or (b) ninety (90) days after the Effective Date, subject to extension by mutual written agreement to accommodate Client-side delays in approvals or asset delivery.

6. TERMINATION

6.1 By the Client. The Client may terminate this Agreement at any time by providing thirty (30) days written notice to greg@cookemedia.io. Termination by the Client does not entitle the Client to a refund of any portion of the Fee already paid (see Section 8).

6.2 By the Company. The Company may terminate or suspend this Agreement immediately on written notice if the Client materially breaches this Agreement (including any breach of Sections 3, 8, or 9) or if the Fee is reversed under Section 4.2. The Company may retain the full Fee paid to date as liquidated damages and is released from any further obligation under Section 1.

7. RELATIONSHIP OF THE PARTIES

7.1 No Exclusivity. This is not an exclusive arrangement. The Company may serve other clients, including in similar markets.

7.2 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

7.3 No Guarantee of Results. The Services are a build engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

8. NO REFUNDS

8.1 Acknowledgement. The Client acknowledges that the Services are bespoke, that substantial Company time, planning, scheduling, creative work, and third-party coordination commence within twenty-four (24) hours of the Effective Date, and that the Fee is non-refundable in whole or in part for any reason.

8.2 No Refund Triggers. Without limitation, the Client agrees that no refund, credit, or chargeback is owed in any of the following circumstances: change of mind, loss of interest, change in the Client's business model or market, dissatisfaction with results, dissatisfaction with stylistic or creative choices delivered within scope, the Client's failure to attend calls or approve assets, the Client's failure to provide required inputs, the Client's failure to launch or to spend on traffic, or termination by either Party under Section 6.

8.3 Survival. This Section 8 survives termination of this Agreement.

9. CHARGEBACK WAIVER

9.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

9.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 11 is the Client's sole and exclusive remedy in respect of any dispute arising under this Agreement, and that initiating a chargeback or processor dispute in violation of this Section 9 constitutes a material breach of this Agreement.

9.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 9.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full. The Company may also report any unpaid amounts to credit reference and collection agencies.

9.4 Acknowledgement. The Client confirms that this Section 9 has been read, understood, and accepted as a fundamental commercial term of this Agreement, and that the Fee under Section 2 has been priced on the basis of this waiver.

10. CONFIDENTIALITY

Each Party agrees to keep confidential all non-public information disclosed by the other Party in connection with this Agreement, including offer economics, financial data, frameworks, strategies, prompts, deliverables, and access credentials. This obligation continues for three (3) years after termination of this Agreement.

11. DISPUTE RESOLUTION

11.1 Governing Law. This Agreement is governed by the laws of England and Wales.

11.2 Negotiation. The Parties agree to first attempt to resolve any dispute by good-faith written negotiation between the Parties for at least thirty (30) days from the date the dispute is raised in writing.

11.3 Mediation. If negotiation fails, the Parties agree to attempt mediation through a mutually agreed mediator before commencing arbitration.

11.4 Binding Arbitration. Any dispute not resolved through negotiation or mediation will be finally resolved by binding arbitration seated in London, England, conducted in English under the rules of the London Court of International Arbitration ("LCIA") by a single arbitrator. The arbitral award is final and enforceable in any court of competent jurisdiction.

11.5 Legal Fees. The prevailing Party in any dispute, arbitration, collection, or enforcement action arising under this Agreement is entitled to recover its reasonable legal fees and costs from the other Party.

12. GENERAL

12.1 No Assignment. Neither Party may assign this Agreement without the other Party's prior written consent, except that the Company may assign to a successor entity in connection with a sale or reorganisation.

12.2 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions, proposals, and agreements.

12.3 Severability. If any provision of this Agreement is held invalid or unenforceable, the remaining provisions remain in full force.

12.4 No Waiver. No waiver of any term is effective unless in writing and signed by the waiving Party.

12.5 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control, including acts of God, war, civil unrest, pandemic, or processor or platform outage, provided the affected Party gives prompt notice and uses reasonable efforts to mitigate.

12.6 Counterparts & Electronic Signature. This Agreement may be executed electronically and in counterparts, each of which is deemed an original. The Parties agree that an electronic signature has the same legal effect as a handwritten signature.

13. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// buildAgreementText (legacy 1-1 coaching agreement) was removed in the
// Stripe migration along with the $5k/mo coaching subscription. Only the
// DFY $15k agreement (buildDfyAgreementText above) remains.

function buildDfyAiInfluencerAgreementText(input: {
  fullName: string;
  companyName?: string | null;
  email: string;
  address: string;
  signedDate: string;
}): string {
  const company = input.companyName ? ` (${input.companyName})` : "";
  return `SERVICE AGREEMENT - DFY AI INFLUENCER (PRE-MADE BUSINESS)

This Service Agreement is entered into on: ${input.signedDate}

COMPANY: AI Influencer Portfolio
Company Email: greg@cookemedia.io
Company Number: 15100830

CLIENT: ${input.fullName}${company}
Client Email: ${input.email}
Client Address: ${input.address}

This agreement is between the Company and the Client (collectively the "Parties") for a one-time, fixed-fee Done-For-You ("DFY") AI Influencer pre-made business build.

1. SERVICES

1.1 AI Influencer Build. Within twenty-four (24) hours of the Effective Date, the Company team will personalise and build the Client's AI influencer (face, look, vibe, name, niche) inside the Client's private portal at room30.ai.

1.2 Pre-Built Business Assets. The Client receives the full DFY AI Influencer pre-made business package as advertised on the Company's sales page at the Effective Date, including but not limited to: a fully built AI influencer with starter scene library, content scripts and prompts, monetisation playbook, low-ticket offer template, and the supporting tracker tooling.

1.3 Onboarding Communication. A team member will contact the Client by email at ${input.email} within twenty-four (24) hours of the Effective Date to confirm preferences and walk the Client through the personalisation flow inside the room30.ai portal.

1.4 Portal Access. Lifetime access to the Client's AI influencer portal, including the influencer master, generated scenes, scripts, and any future updates the Company ships to the pre-made business package.

1.5 A-List Portal Access. A-List portal access auto-unlocked on payment, including the supporting curriculum and resource library.

2. COMPENSATION

2.1 Fee. The Client agrees to pay the Company a one-time fee of $2,997 USD (the "Fee") for the Services described in Section 1.

2.2 Payment Terms. The Fee is due in full upon signing this Agreement and is processed via Whop. The Services and the Effective Date commence only once the Fee has cleared in full.

2.3 Currency & Taxes. All amounts are in US Dollars. The Client is responsible for any taxes, duties, or levies imposed by any jurisdiction in connection with the Fee, except for taxes on the Company's net income.

3. CLIENT COMMITMENT

3.1 Intellectual Property. The Client agrees not to misuse, replicate, repackage, distribute, or resell any intellectual property, frameworks, materials, scripts, prompts, or AI assets provided by the Company, and not to use the Company's materials to deliver services to third parties without prior written consent.

3.2 Good Faith. The Client agrees to engage in good faith and to provide accurate brand and personalisation inputs reasonably required for delivery.

3.3 Licence to Deliverables. On full payment of the Fee and subject to Section 3.1, the Client receives a perpetual, worldwide, non-exclusive licence to use the finalised AI influencer assets and supporting materials in the Client's own business.

4. PAYMENT MECHANICS

4.1 Processor. Payment is processed via Whop. The Client authorises Whop to charge the payment method provided at checkout for the full Fee.

4.2 Failed or Reversed Payment. If the Fee fails to clear, is reversed, refunded by the processor, or otherwise becomes uncollected for any reason, this Agreement is voidable at the Company's sole discretion and Services may be paused or terminated until payment is fully restored.

5. NO REFUNDS

5.1 Acknowledgement. The Client acknowledges that the Services are delivered digitally and that substantial Company time, AI compute, and team coordination commence within twenty-four (24) hours of the Effective Date, and that the Fee is non-refundable in whole or in part for any reason.

5.2 Survival. This Section 5 survives termination of this Agreement.

6. CHARGEBACK WAIVER

6.1 Express Waiver. The Client expressly waives the right to initiate, file, or pursue any chargeback, payment dispute, payment reversal, refund request through the card issuer, bank dispute, or processor dispute against the Company in connection with the Fee or the Services.

6.2 Sole Remedy. The Client agrees that the dispute resolution process in Section 8 is the Client's sole and exclusive remedy in respect of any dispute, and that initiating a chargeback in violation of this Section 6 constitutes a material breach.

6.3 Recovery. If the Client initiates a chargeback or payment dispute in violation of Section 6.1, the Client agrees to indemnify the Company on demand for: (a) the full disputed amount; (b) all chargeback, processor, and bank fees incurred; (c) reasonable legal, collection, and administration costs; and (d) interest on the recovered amount at the rate of 1.5% per month, accruing daily, from the date of the chargeback until paid in full.

7. RELATIONSHIP OF THE PARTIES

7.1 Independent Contractor. The Company is engaged as an independent contractor. Nothing in this Agreement creates a partnership, employment, joint venture, or agency relationship between the Parties.

7.2 No Guarantee of Results. The Services are a build engagement, not a guarantee of revenue, traffic, conversion, or commercial outcome. Outcomes depend on the Client's market, execution, ad spend, offer, and external factors outside the Company's control.

8. DISPUTE RESOLUTION

8.1 Governing Law. This Agreement is governed by the laws of England and Wales.

8.2 Negotiation, Mediation, Arbitration. The Parties will first attempt good-faith written negotiation for thirty (30) days, then mediation, and finally binding arbitration seated in London, England under the rules of the LCIA by a single arbitrator.

9. GENERAL

9.1 Entire Agreement. This Agreement is the entire agreement between the Parties on its subject matter and supersedes all prior discussions.

9.2 Severability. If any provision is held invalid, the remaining provisions remain in full force.

9.3 Force Majeure. Neither Party is liable for any delay or failure to perform caused by an event outside its reasonable control.

9.4 Counterparts & Electronic Signature. This Agreement may be executed electronically. An electronic signature has the same legal effect as a handwritten signature.

10. NOTICES

All formal notices under this Agreement must be sent by email to greg@cookemedia.io for the Company and to ${input.email} for the Client, and are deemed received on the next business day after sending.

SIGNED - AI Influencer Portfolio (signed by Gregory Cooke)
SIGNED - ${input.fullName} on ${input.signedDate}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public live-stock endpoint for the Portugal Retreat 2026 sales page.
// Returns remaining seats per tier (gold + vip) by querying Whop's plan
// API. Cached server-side for 30 seconds so a popular page does not
// hammer Whop. Falls back to `null` per tier when Whop has not been
// configured for that plan, so the frontend can hide the live counter
// gracefully without breaking the page.
// ─────────────────────────────────────────────────────────────────────────────
type Sep2026StockTier = {
  remaining: number | null;
  isLive: boolean;
};
type Sep2026StockPayload = {
  gold: Sep2026StockTier;
  vip: Sep2026StockTier;
  totalRemaining: number | null;
};
let sep2026StockCache: { fetchedAt: number; payload: Sep2026StockPayload } | null = null;
let sep2026StockInflight: Promise<Sep2026StockPayload> | null = null;
const SEP2026_STOCK_TTL_MS = 5 * 60_000;

// Monotonic floor per tier. Whop's plan API can briefly report a HIGHER
// stock than its previous value (refunds, plan edits in the dashboard,
// transient API inconsistencies), which causes the live "X seats left"
// counter on the sales page to bounce up and down. We clamp the
// displayed value so it can only ever decrease over the lifetime of the
// process - matching what a customer expects ("seats sell, count goes
// down, never back up"). The floor resets on server restart, at which
// point we trust whatever Whop reports as the new starting point.
const sep2026StockFloor: { gold: number | null; vip: number | null } = {
  gold: null,
  vip: null,
};

function clampMonotonic(tier: "gold" | "vip", incoming: Sep2026StockTier): Sep2026StockTier {
  if (incoming.remaining == null) return incoming;
  const floor = sep2026StockFloor[tier];
  const next = floor == null ? incoming.remaining : Math.min(floor, incoming.remaining);
  sep2026StockFloor[tier] = next;
  return { remaining: next, isLive: incoming.isLive };
}

async function loadSep2026Stock(): Promise<Sep2026StockPayload> {
  if (sep2026StockInflight) return sep2026StockInflight;
  sep2026StockInflight = (async () => {
    // Live per-tier stock came from the Whop plan API, which is retired
    // with the legacy purchasing stack. Report unknown stock so the UI
    // hides the "X of 30 left" counter rather than showing a stale value.
    const gold = clampMonotonic("gold", { remaining: null, isLive: false });
    const vip = clampMonotonic("vip", { remaining: null, isLive: false });
    const totalRemaining =
      gold.remaining != null && vip.remaining != null
        ? gold.remaining + vip.remaining
        : null;
    const payload: Sep2026StockPayload = { gold, vip, totalRemaining };
    sep2026StockCache = { fetchedAt: Date.now(), payload };
    return payload;
  })();
  try {
    return await sep2026StockInflight;
  } finally {
    sep2026StockInflight = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sep2026/recent-purchases
// Returns the most recent real Whop ticket purchases for the Portugal Retreat
// (portugal_gold + portugal_vip product IDs). Used by the live sales-pop on
// the /sep2026 VSL. We deliberately surface only first name + last initial -
// no email, no city - and we cache server-side for 2 minutes so a popular
// page does not hammer Whop. Returns { purchases: [] } when Whop is not
// configured or no real purchases exist yet, and the frontend hides the pop.
// ─────────────────────────────────────────────────────────────────────────────
type Sep2026RecentPurchase = {
  id: string;
  firstName: string;
  lastInitial: string;
  tier: "gold" | "vip";
  paidAt: number; // unix seconds
};
type Sep2026RecentPayload = { purchases: Sep2026RecentPurchase[] };
let sep2026RecentCache: { fetchedAt: number; payload: Sep2026RecentPayload } | null = null;
let sep2026RecentInflight: Promise<Sep2026RecentPayload> | null = null;
const SEP2026_RECENT_TTL_MS = 120_000;
const SEP2026_RECENT_MAX = 20;

function splitDisplayName(raw: string | null | undefined): { firstName: string; lastInitial: string } | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const parts = cleaned.split(" ");
  const first = parts[0];
  if (!first || !/[A-Za-z]/.test(first)) return null;
  const firstName = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  let lastInitial = "";
  for (let i = parts.length - 1; i >= 1; i--) {
    const ch = parts[i].replace(/[^A-Za-z]/g, "").charAt(0);
    if (ch) { lastInitial = ch.toUpperCase(); break; }
  }
  return { firstName, lastInitial };
}

async function loadSep2026RecentPurchases(): Promise<Sep2026RecentPayload> {
  if (sep2026RecentInflight) return sep2026RecentInflight;
  sep2026RecentInflight = (async () => {
    // The live sales-pop was sourced from the Whop receipts API, which is
    // retired with the legacy purchasing stack. Return no purchases so the
    // frontend hides the pop cleanly.
    const empty: Sep2026RecentPayload = { purchases: [] };
    sep2026RecentCache = { fetchedAt: Date.now(), payload: empty };
    return empty;
  })();
  try {
    return await sep2026RecentInflight;
  } finally {
    sep2026RecentInflight = null;
  }
}

router.get("/sep2026/recent-purchases", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=180");
  const now = Date.now();
  if (sep2026RecentCache && now - sep2026RecentCache.fetchedAt < SEP2026_RECENT_TTL_MS) {
    res.json(sep2026RecentCache.payload); return;
  }
  try {
    const payload = await loadSep2026RecentPurchases();
    res.json(payload); return;
  } catch {
    res.json({ purchases: [] } satisfies Sep2026RecentPayload); return;
  }
});

router.get("/sep2026/stock", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
  const now = Date.now();
  if (sep2026StockCache && now - sep2026StockCache.fetchedAt < SEP2026_STOCK_TTL_MS) {
    res.json(sep2026StockCache.payload); return;
  }
  const payload = await loadSep2026Stock();
  res.json(payload); return;
});

router.post("/coaching/create", async (req, res) => {
  try {
    const { fullName, companyName, email, phone, address: rawAddress, signatureDataUrl, acceptedTerms, fingerprintHash, agreementType: bodyAgreementType } = req.body || {};

    // Pay-first flows (AI Influencer Account Rental on /rent/checkout) create
    // the agreement row BEFORE the buyer signs. The signature + acceptance are
    // captured on a dedicated step AFTER payment and attached via the
    // POST /coaching/sign endpoint below. When deferSignature is set we skip the
    // signature/acceptedTerms/address requirements and stamp the row
    // status:"unsigned"; address is optional for these flows.
    const deferSignature = req.body?.deferSignature === true;
    const address = typeof rawAddress === "string" ? rawAddress.trim() : "";

    if (!fullName || !email) {
      res.status(400).json({ error: "Missing required fields" }); return;
    }
    if (!deferSignature && (!address || !signatureDataUrl || !acceptedTerms)) {
      res.status(400).json({ error: "Missing required fields" }); return;
    }
    // The DFY AI Influencer pages (regular $2,997 + Gold $4,997 + Diamond
    // $9,997) use a TYPED full-name signature, not a canvas drawing, so
    // signatureDataUrl is the typed name string, not a data: URL. All other
    // high-ticket flows (legacy DFY $15k, Portugal Gold/VIP) still mount a
    // signature pad and POST a real `data:image/...` payload. Reject
    // anything else only for those canvas-based flows; for the typed-
    // signature flows just require a non-empty string (full-name match is
    // already enforced client-side and the agreement text below stamps the
    // typed name into the legal record).
    const TYPED_SIGNATURE_AGREEMENT_TYPES = new Set([
      "dfy_ai_influencer",
      "dfy_ai_influencer_gold",
      "dfy_ai_influencer_diamond",
      "dfy_ai_influencer_gold_special",
    ]);
    const usesTypedSignature = TYPED_SIGNATURE_AGREEMENT_TYPES.has(bodyAgreementType);
    if (!deferSignature) {
      if (usesTypedSignature) {
        if (typeof signatureDataUrl !== "string" || !signatureDataUrl.trim()) {
          res.status(400).json({ error: "Invalid signature data" }); return;
        }
      } else if (!signatureDataUrl.startsWith("data:image/")) {
        res.status(400).json({ error: "Invalid signature data" }); return;
      }
    }

    // Supported high-ticket flows on this endpoint:
    //   - "dfy" (default): $15k one-time DFY build via Whop iframe
    //   - "dfy_ai_influencer": $2,997 one-time DFY AI Influencer pre-made business
    //   - "portugal_gold": $4,997 one-time Portugal Retreat 2026 - Gold Pass
    //   - "portugal_vip": $7,497 one-time Portugal Retreat 2026 - VIP Pass
    // Anything else falls back to "dfy" for backwards compatibility with the
    // existing /work-with-me/checkout flow.
    type SupportedAgreementType =
      | "dfy"
      | "dfy_ai_influencer"
      | "dfy_ai_influencer_gold"
      | "dfy_ai_influencer_diamond"
      | "dfy_ai_influencer_gold_special"
      | "portugal_gold"
      | "portugal_vip"
      | "rent_p1"
      | "rent_p2"
      | "rent_p3"
      | "mentorship"
      | "mentorship_quarterly";
    // AI Influencer Account Rental v2 (Bronze/Silver/Gold/Diamond x ads x
    // monthly/annual). Parsed from the dynamic `rent_<tier>[_ads]_<billing>`
    // agreementType. When it parses, the type is accepted verbatim; otherwise
    // we fall back to the fixed SupportedAgreementType set.
    const rentPlan = parseRentPlan(typeof bodyAgreementType === "string" ? bodyAgreementType : "");
    // Done-For-You Content (Bronze/Silver/Gold/Diamond x one-time | monthly).
    // Parsed from the dynamic `dfy_content_<tier>_<onetime|monthly>`
    // agreementType. When it parses, the type is accepted verbatim (alongside
    // rentPlan) over the fixed SupportedAgreementType set.
    const dfyContentPlan = parseDfyContentPlan(typeof bodyAgreementType === "string" ? bodyAgreementType : "");
    // Done-For-You Ads (Bronze/Silver/Gold/Diamond x one-time | monthly).
    // Parsed from `dfy_ads_<tier>_<onetime|monthly>`; same pay-first, Stripe-only,
    // no-portal flow as DFY Content.
    const dfyAdsPlan = parseDfyAdsPlan(typeof bodyAgreementType === "string" ? bodyAgreementType : "");
    const nonRentType: SupportedAgreementType =
      bodyAgreementType === "portugal_gold"
        || bodyAgreementType === "portugal_vip"
        || bodyAgreementType === "dfy_ai_influencer"
        || bodyAgreementType === "dfy_ai_influencer_gold"
        || bodyAgreementType === "dfy_ai_influencer_diamond"
        || bodyAgreementType === "dfy_ai_influencer_gold_special"
        || bodyAgreementType === "rent_p1"
        || bodyAgreementType === "rent_p2"
        || bodyAgreementType === "rent_p3"
        || bodyAgreementType === "mentorship"
        || bodyAgreementType === "mentorship_quarterly"
        ? bodyAgreementType
        : "dfy";
    const agreementType: string = rentPlan || dfyContentPlan || dfyAdsPlan ? (bodyAgreementType as string) : nonRentType;
    const isDfyContent = dfyContentPlan !== null;
    const isDfyAds = dfyAdsPlan !== null;
    const isPortugal = agreementType === "portugal_gold" || agreementType === "portugal_vip";
    const isDfyAiInfluencer = agreementType === "dfy_ai_influencer";
    const isDfyAiInfluencerHighTicket =
      agreementType === "dfy_ai_influencer_gold"
      || agreementType === "dfy_ai_influencer_diamond"
      || agreementType === "dfy_ai_influencer_gold_special";
    // AI Influencer Account Rental (recurring monthly subscription). Like the
    // high-ticket DFY AI Influencer Gold/Diamond tiers it is Stripe-only and
    // skips the Whop preflight; the frontend mounts CoachingStripePay and the
    // create-coaching-intent endpoint spins up a true monthly subscription.
    const rentTier = rentTierFromType(agreementType);
    const isRent = rentTier !== null || rentPlan !== null;
    // 1:1 Mentorship (recurring ANNUAL subscription). Stripe-only like the
    // rent_* tiers; grants no portal entitlement and skips the Whop preflight.
    const isMentorship = isMentorshipType(agreementType);
    const dfyAiHighTicketTier: DfyAiInfluencerHighTicketTier | null =
      agreementType === "dfy_ai_influencer_diamond"
        ? "diamond"
        : agreementType === "dfy_ai_influencer_gold_special"
          ? "gold_special"
          : agreementType === "dfy_ai_influencer_gold"
            ? "gold"
            : null;
    const portugalTier: PortugalTier | null = agreementType === "portugal_vip"
      ? "vip"
      : agreementType === "portugal_gold"
        ? "gold"
        : null;

    // Portugal Retreat 2026 inventory guard. VIP is sold out, and Gold is
    // hard-capped at PORTUGAL_GOLD_MAX_TICKETS paid seats. Reject here so a
    // sold-out buyer never even signs an agreement. The authoritative
    // money-gate is repeated in create-coaching-intent before any PaymentIntent
    // is minted.
    if (agreementType === "portugal_vip") {
      res.status(409).json({
        error: "portugal_vip_sold_out",
        message: "The VIP Pass is sold out. Please choose the Gold Pass.",
      });
      return;
    }
    if (agreementType === "portugal_gold" && (await isPortugalGoldSoldOut())) {
      res.status(409).json({
        error: "portugal_gold_sold_out",
        message: "The Gold Pass is sold out.",
      });
      return;
    }

    // The Stripe-only flows (high-ticket DFY AI Influencer tiers, rentals,
    // mentorship, DFY content/ads plans) mount CoachingStripePay against the
    // returned agreementId. Every other type used to charge through the
    // retired Whop checkout - that stack is gone, so those types now get a
    // friendly 503 instead of a live checkout.
    const isStripeOnly = isDfyAiInfluencerHighTicket || isRent || isMentorship || isDfyContent || isDfyAds;
    if (!isStripeOnly) {
      res.status(503).json({
        error: isPortugal ? "portugal_unavailable" : isDfyAiInfluencer ? "dfy_ai_influencer_unavailable" : "dfy_unavailable",
        message: isPortugal
          ? "Portugal Retreat checkout is being prepared. Please use the chat bubble on the page or email greg@cookemedia.io and we will sort it out for you."
          : "Done-For-You checkout is being prepared. Please email greg@cookemedia.io and we will sort it out for you.",
      }); return;
    }

    const signedDate = new Date().toLocaleDateString("en-GB", {
      timeZone: "Europe/London", day: "2-digit", month: "long", year: "numeric",
    });

    const mentorshipBilling = mentorshipBillingFromType(agreementType) ?? "annual";
    const agreementText = isMentorship
      ? buildMentorshipAgreementText({ fullName, companyName, email, address, signedDate, billing: mentorshipBilling })
      : dfyContentPlan
      ? buildDfyContentAgreementText({ fullName, companyName, email, address, signedDate, plan: dfyContentPlan })
      : dfyAdsPlan
      ? buildDfyAdsAgreementText({ fullName, companyName, email, address, signedDate, plan: dfyAdsPlan })
      : rentPlan
      ? buildRentPlanAgreementText({ fullName, companyName, email, address, signedDate, plan: rentPlan })
      : isRent && rentTier
      ? buildRentAgreementText({ fullName, companyName, email, address, signedDate, tier: rentTier })
      : isPortugal && portugalTier
        ? buildPortugalAgreementText({ fullName, companyName, email, address, signedDate, tier: portugalTier })
        : isDfyAiInfluencerHighTicket && dfyAiHighTicketTier
          ? buildDfyAiInfluencerHighTicketAgreementText({ fullName, companyName, email, address, signedDate, tier: dfyAiHighTicketTier })
          : isDfyAiInfluencer
            ? buildDfyAiInfluencerAgreementText({ fullName, companyName, email, address, signedDate })
            : buildDfyAgreementText({ fullName, companyName, email, address, signedDate });

    const packagePriceCents = isMentorship
      ? mentorshipPriceCents(mentorshipBilling)
      : dfyContentPlan
      ? dfyContentPlan.priceCents
      : dfyAdsPlan
      ? dfyAdsPlan.priceCents
      : rentPlan
      ? rentPlan.priceCents
      : isRent && rentTier
      ? rentPriceCents(rentTier)
      : isPortugal
        ? (portugalTier === "vip" ? PORTUGAL_VIP_PRICE_CENTS : PORTUGAL_GOLD_PRICE_CENTS)
        : isDfyAiInfluencerHighTicket
          ? (dfyAiHighTicketTier === "diamond"
              ? DFY_AI_INFLUENCER_DIAMOND_PRICE_CENTS
              : dfyAiHighTicketTier === "gold_special"
                ? DFY_AI_INFLUENCER_GOLD_SPECIAL_PRICE_CENTS
                : DFY_AI_INFLUENCER_GOLD_PRICE_CENTS)
          : isDfyAiInfluencer
            ? DFY_AI_INFLUENCER_PRICE_CENTS
            : DFY_PRICE_CENTS;
    const productName = isMentorship
      ? mentorshipProductName(mentorshipBilling)
      : dfyContentPlan
      ? dfyContentPlan.productName
      : dfyAdsPlan
      ? dfyAdsPlan.productName
      : rentPlan
      ? rentPlan.productName
      : isRent && rentTier
      ? rentProductName(rentTier)
      : isPortugal
        ? (portugalTier === "vip" ? PORTUGAL_VIP_PRODUCT_NAME : PORTUGAL_GOLD_PRODUCT_NAME)
        : isDfyAiInfluencerHighTicket
          ? (dfyAiHighTicketTier === "diamond"
              ? DFY_AI_INFLUENCER_DIAMOND_PRODUCT_NAME
              : dfyAiHighTicketTier === "gold_special"
                ? DFY_AI_INFLUENCER_GOLD_SPECIAL_PRODUCT_NAME
                : DFY_AI_INFLUENCER_GOLD_PRODUCT_NAME)
          : isDfyAiInfluencer
            ? DFY_AI_INFLUENCER_PRODUCT_NAME
            : DFY_PRODUCT_NAME;
    const metadataProduct = isRent || isMentorship || isDfyContent || isDfyAds
      ? agreementType
      : isPortugal
        ? (portugalTier === "vip" ? "portugal_retreat_vip" : "portugal_retreat_gold")
        : isDfyAiInfluencerHighTicket
          ? (dfyAiHighTicketTier === "diamond"
              ? "dfy_ai_influencer_diamond"
              : dfyAiHighTicketTier === "gold_special"
                ? "dfy_ai_influencer_gold_special"
                : "dfy_ai_influencer_gold")
          : isDfyAiInfluencer
            ? "dfy_ai_influencer"
            : "dfy_build";

    const ipAddress = getMetaIp(req);
    const userAgent = req.headers["user-agent"]?.toString() || "unknown";
    const cookieFbpFbc = readFbpFbcFromCookies(req);
    const fbp = req.body?.fbp || cookieFbpFbc.fbp;
    const fbc = req.body?.fbc || cookieFbpFbc.fbc;

    const normalisedEmail = email.trim().toLowerCase();

    const [record] = await db.insert(coachingAgreementsTable).values({
      fullName: fullName.trim(),
      companyName: companyName?.trim() || null,
      email: normalisedEmail,
      phone: phone?.trim() || null,
      address,
      signatureDataUrl: deferSignature ? "" : signatureDataUrl,
      agreementText,
      signedDate,
      ipAddress,
      userAgent,
      fingerprintHash: fingerprintHash || null,
      acceptedTerms: deferSignature ? false : !!acceptedTerms,
      status: deferSignature ? "unsigned" : "signed",
      agreementType,
      agreementVersion: isPortugal ? "1.1" : "1.0",
      paymentProvider: isDfyAiInfluencerHighTicket || isRent || isMentorship || isDfyContent || isDfyAds ? "stripe" : "whop",
      packagePriceCents,
      fbp,
      fbc,
    }).returning();

    // Embedded Whop checkout: the frontend mounts the Whop Checkout Embed
    // widget directly with the plan ID + metadata; payment is taken inside
    // the iframe and Whop fires our /api/whop/webhook on success which
    // triggers claimDfyAgreementFromWhop below (the canonical claim path).
    const metadata = {
      agreementId: String(record.id),
      product: metadataProduct,
      email: normalisedEmail,
      fullName: fullName.trim(),
    };

    // All reachable flows are Stripe-only (the non-Stripe legacy types were
    // rejected with a 503 above, since the retired Whop checkout is gone).
    // The frontend mounts CoachingStripePay against
    // /api/stripe/create-coaching-intent using the returned agreementId.
    res.json({
      agreementId: record.id,
      provider: "stripe",
      recurring: isRent || isMentorship || (isDfyContent && dfyContentPlan!.recurring) || (isDfyAds && dfyAdsPlan!.recurring),
      priceCents: packagePriceCents,
      productName,
      metadata,
    }); return;
  } catch (error: any) {
    req.log?.error?.({ err: error?.message }, "coaching/create error");
    res.status(500).json({ error: error.message });
    return;
  }
});

// Attach a signature to a deferred (pay-first) agreement. Used by the AI
// Influencer Account Rental flow on /rent/checkout, where the buyer pays first
// and then signs the per-package service agreement. Only promotes an "unsigned"
// row to "signed"; it never downgrades a row that the payment path has already
// flipped to "active" (claimDfyAgreement keys off status<>'active').
router.post("/coaching/sign", async (req, res) => {
  try {
    const { agreementId, signatureDataUrl, acceptedTerms, fingerprintHash } = req.body || {};
    const id = typeof agreementId === "number" ? agreementId : parseInt(String(agreementId ?? ""), 10);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid agreement id" }); return; }
    if (!acceptedTerms) {
      res.status(400).json({ error: "You must accept the agreement terms to continue." }); return;
    }
    if (typeof signatureDataUrl !== "string" || !signatureDataUrl.startsWith("data:image/")) {
      res.status(400).json({ error: "Invalid signature data" }); return;
    }
    const [agreement] = await db.select().from(coachingAgreementsTable).where(eq(coachingAgreementsTable.id, id));
    if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

    // Defense-in-depth for this public, enumerable-id endpoint:
    // (a) only accept a signature once the agreement is actually paid (the
    //     pay-first rent flow always reaches this step post-payment), so a
    //     guessed id for an unpaid row cannot be signed; and
    // (b) never overwrite an existing signature, so a replayed/guessed call
    //     cannot tamper with an already-signed agreement. A genuine retry only
    //     happens when the previous attempt errored before persisting, in which
    //     case the signature is still empty and this passes.
    const isPaid = !!agreement.paidAt
      || !!agreement.stripePaymentIntentId
      || !!agreement.whopMembershipId
      || agreement.status === "active";
    if (!isPaid) {
      res.status(409).json({ error: "Payment must be completed before signing." }); return;
    }
    if (agreement.signatureDataUrl && agreement.signatureDataUrl.startsWith("data:image/")) {
      res.json({ ok: true, agreementId: id, alreadySigned: true }); return;
    }

    await db.update(coachingAgreementsTable)
      .set({
        signatureDataUrl,
        acceptedTerms: true,
        fingerprintHash: fingerprintHash || agreement.fingerprintHash || null,
        status: agreement.status === "unsigned" ? "signed" : agreement.status,
      })
      .where(eq(coachingAgreementsTable.id, id));
    res.json({ ok: true, agreementId: id });
    return;
  } catch (error: any) {
    req.log?.error?.({ err: error?.message }, "coaching/sign error");
    res.status(500).json({ error: error.message });
    return;
  }
});

router.get("/coaching/agreement/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [agreement] = await db.select().from(coachingAgreementsTable).where(eq(coachingAgreementsTable.id, id));
    if (!agreement) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      id: agreement.id,
      fullName: agreement.fullName,
      companyName: agreement.companyName,
      email: agreement.email,
      signedDate: agreement.signedDate,
      status: agreement.status,
      paidAt: agreement.paidAt,
    });
    return;
  } catch (error: any) {
    res.status(500).json({ error: error.message });
    return;
  }
});

type ClaimDfyOpts = {
  agreementId: number;
  amountCents: number;
  currency: string;
  reqIp?: string | null;
  reqUa?: string | null;
  // Whop fields (DFY default after Whop restoration). One of stripe/whop
  // identifier sets is supplied per call.
  whopReceiptId?: string | null;
  whopMembershipId?: string | null;
  whopUserId?: string | null;
  // Legacy Stripe fields kept so the verify-stripe endpoint can still claim
  // any DFY orders that were started during the brief Stripe-only window
  // before this restoration shipped.
  stripeSessionId?: string | null;
  paymentIntentId?: string | null;
};

// Task #819: human-facing product name for the high-ticket purchase
// receipt. Unlike the welcome email's `ctxContentName` (which folds the
// DFY AI Influencer Gold/Diamond/Gold Special tiers into the generic
// DFY_PRODUCT_NAME), this maps each tier to its own label so the receipt
// shows the buyer exactly what they paid for. Only called for the
// portal-granting set (`!isRentAg && !isMentorshipAg`).
function resolveHighTicketReceiptProductName(agreementType: string | null): string {
  switch (agreementType) {
    case "portugal_vip":
      return PORTUGAL_VIP_PRODUCT_NAME;
    case "portugal_gold":
      return PORTUGAL_GOLD_PRODUCT_NAME;
    case "dfy_ai_influencer":
      return DFY_AI_INFLUENCER_PRODUCT_NAME;
    case "dfy_ai_influencer_gold":
      return DFY_AI_INFLUENCER_GOLD_PRODUCT_NAME;
    case "dfy_ai_influencer_diamond":
      return DFY_AI_INFLUENCER_DIAMOND_PRODUCT_NAME;
    case "dfy_ai_influencer_gold_special":
      return DFY_AI_INFLUENCER_GOLD_SPECIAL_PRODUCT_NAME;
    default:
      // "dfy" plus the generic coaching catch-all.
      return DFY_PRODUCT_NAME;
  }
}

export async function claimDfyAgreement(opts: ClaimDfyOpts): Promise<{ alreadyClaimed: boolean }> {
  const [agreement] = await db.select().from(coachingAgreementsTable).where(eq(coachingAgreementsTable.id, opts.agreementId));
  if (!agreement) throw new Error(`agreement ${opts.agreementId} not found`);

  // Atomic claim: only flip to active if it isn't already.
  const updates: Record<string, unknown> = {
    status: "active",
    paidAt: new Date(),
    updatedAt: new Date(),
  };
  if (opts.stripeSessionId !== undefined) {
    updates.stripeSessionId = opts.stripeSessionId ?? agreement.stripeSessionId;
  }
  if (opts.paymentIntentId !== undefined) {
    updates.stripePaymentIntentId = opts.paymentIntentId ?? agreement.stripePaymentIntentId;
  }
  if (opts.whopReceiptId !== undefined) {
    updates.whopSessionId = opts.whopReceiptId ?? agreement.whopSessionId;
  }
  if (opts.whopMembershipId !== undefined) {
    updates.whopMembershipId = opts.whopMembershipId ?? agreement.whopMembershipId;
  }
  if (opts.whopUserId !== undefined) {
    updates.whopUserId = opts.whopUserId ?? agreement.whopUserId;
  }

  const claimed = await db.update(coachingAgreementsTable)
    .set(updates as any)
    .where(and(eq(coachingAgreementsTable.id, opts.agreementId), sql`${coachingAgreementsTable.status} <> 'active'`))
    .returning({ id: coachingAgreementsTable.id });

  if (claimed.length === 0) {
    return { alreadyClaimed: true };
  }

  // Agreement-type-aware Meta CAPI event labels and post-pay redirect URL.
  const isPortugalAg = agreement.agreementType === "portugal_gold" || agreement.agreementType === "portugal_vip";
  const isVipAg = agreement.agreementType === "portugal_vip";
  const isDfyAiInfluencerAg = agreement.agreementType === "dfy_ai_influencer";
  // AI Influencer Account Rental (recurring monthly subscription). Grants NO
  // portal entitlement - the A-List grant + portal-access KIT/WATI tags + the
  // portal-flavoured welcome copy are all skipped. The marketing/CRM side
  // effects (FP trackSale, Slack, CRM mirror, Kit purchase) still fire.
  const rentTierAg = rentTierFromType(agreement.agreementType ?? "");
  const rentPlanAg = parseRentPlan(agreement.agreementType ?? "");
  const isRentAg = rentTierAg !== null || rentPlanAg !== null;
  const rentProductNameAg = rentPlanAg
    ? rentPlanAg.productName
    : rentTierAg
      ? rentProductName(rentTierAg)
      : "AI Influencer Account Rental";
  // 1:1 Mentorship (recurring annual subscription). Like rentals it grants NO
  // portal entitlement - the A-List grant + portal-access KIT/WATI tags + the
  // portal-flavoured welcome copy are all skipped. The marketing/CRM side
  // effects (FP trackSale, Slack, CRM mirror, Kit purchase) still fire.
  const isMentorshipAg = isMentorshipType(agreement.agreementType ?? "");
  const mentorshipBillingAg = mentorshipBillingFromType(agreement.agreementType ?? "");
  // Done-For-You Content (one-time pack or monthly subscription). Like rentals
  // and mentorship it grants NO portal entitlement - the A-List grant +
  // portal-access KIT/WATI tags + the portal-flavoured welcome copy are all
  // skipped. The marketing/CRM side effects (FP trackSale, Slack, CRM mirror,
  // Kit purchase) still fire. Fulfilment is the managed content service: the
  // buyer fills the intake form and the team delivers via Google Drive in 48h.
  const dfyContentPlanAg = parseDfyContentPlan(agreement.agreementType ?? "");
  const isDfyContentAg = dfyContentPlanAg !== null;
  // DFY Ads claim handling mirrors DFY Content end to end (same intake-form
  // fulfilment, same sender, same receipt branch) - only the checkout URL,
  // product name, and copy differ.
  const dfyAdsPlanAg = parseDfyAdsPlan(agreement.agreementType ?? "");
  const isDfyAdsAg = dfyAdsPlanAg !== null;
  const eventIdPrefix = isPortugalAg
    ? (isVipAg ? "portugal_vip" : "portugal_gold")
    : isDfyAiInfluencerAg
      ? "dfy_ai_influencer"
      : isMentorshipAg
        ? "mentorship"
        : isRentAg
          ? agreement.agreementType!
          : isDfyContentAg || isDfyAdsAg
            ? agreement.agreementType!
            : "dfy";
  const eventSourceUrl = isPortugalAg
    ? `${getBrandBaseUrl()}/sep2026/checkout?tier=${isVipAg ? "vip" : "gold"}&step=book&agreementId=${opts.agreementId}`
    : isDfyAiInfluencerAg
      ? `${getBrandBaseUrl()}/work-with-me/checkout?type=dfy-ai-influencer&step=book&agreementId=${opts.agreementId}`
      : isMentorshipAg
        ? `${getBrandBaseUrl()}/one-on-one-mentorship/checkout?step=book&agreementId=${opts.agreementId}`
        : isRentAg
          ? `${getBrandBaseUrl()}/rent/checkout?${rentPlanAg ? rentPlanAg.checkoutQuery : `tier=${rentTierAg}`}&step=book&agreementId=${opts.agreementId}`
          : isDfyContentAg
            ? `${getBrandBaseUrl()}/dfycontent/checkout?${dfyContentPlanAg!.checkoutQuery}&step=sign&agreementId=${opts.agreementId}`
            : isDfyAdsAg
              ? `${getBrandBaseUrl()}/dfyads/checkout?${dfyAdsPlanAg!.checkoutQuery}&step=sign&agreementId=${opts.agreementId}`
              : `${getBrandBaseUrl()}/work-with-me/checkout?type=dfy&step=book&agreementId=${opts.agreementId}`;
  const ctxContentName = isPortugalAg
    ? (isVipAg ? PORTUGAL_VIP_PRODUCT_NAME : PORTUGAL_GOLD_PRODUCT_NAME)
    : isDfyAiInfluencerAg
      ? DFY_AI_INFLUENCER_PRODUCT_NAME
      : isMentorshipAg
        ? mentorshipProductName(mentorshipBillingAg ?? "annual")
        : isRentAg
          ? rentProductNameAg
          : isDfyContentAg
            ? dfyContentPlanAg!.productName
            : isDfyAdsAg
              ? dfyAdsPlanAg!.productName
              : DFY_PRODUCT_NAME;
  const ctxContentIds = isPortugalAg
    ? [eventIdPrefix]
    : isDfyAiInfluencerAg
      ? ["dfy_ai_influencer"]
      : isMentorshipAg
        ? ["mentorship"]
        : isRentAg
          ? [agreement.agreementType!]
          : isDfyContentAg || isDfyAdsAg
            ? [agreement.agreementType!]
            : ["dfy_build"];

  // Side effects fire exactly once.
  try {
    await sendMetaPurchaseEvent({
      eventId: `${eventIdPrefix}_${opts.agreementId}`,
      eventSourceUrl,
      email: agreement.email,
      phone: agreement.phone,
      fbp: agreement.fbp,
      fbc: agreement.fbc,
      clientIpAddress: agreement.ipAddress || opts.reqIp || "unknown",
      clientUserAgent: agreement.userAgent || opts.reqUa || "unknown",
      value: opts.amountCents / 100,
      currency: opts.currency.toUpperCase(),
      orderType: "high_ticket",
      contentName: ctxContentName,
      contentIds: ctxContentIds,
    });
  } catch (e) {
    console.error("Meta CAPI high-ticket purchase failed:", e);
  }

  // Slack #high-ticket-sale ping. Coaching agreements (DFY $15k,
  // Portugal Gold/VIP, DFY AI Influencer, coaching) are always
  // high-ticket so this always routes via the high-ticket webhook.
  // Fire-and-forget; helper is no-throw.
  try {
    const { notifyPaidOrder } = await import("../lib/sales-slack");
    notifyPaidOrder({
      email: agreement.email,
      customerName: agreement.fullName,
      productLabel: ctxContentName,
      amountCents: opts.amountCents,
      orderRef: `agreement #${opts.agreementId}`,
      source: `coaching:${agreement.agreementType ?? "high_ticket"}`,
      // DFY Ads / DFY Content are managed high-ticket services regardless of
      // tier, so their sub-$400 Bronze tiers must still reach the
      // #high-ticket-sale channel (the default $400 threshold would drop them).
      forceHighTicket: isDfyContentAg || isDfyAdsAg,
    });
  } catch {
    // Helper is no-throw; ignore dynamic-import failures.
  }



  // Task #643: mirror the high-ticket buyer into the internal Sales CRM
  // so Portugal / DFY / coaching wins land in `crm_contacts` at stage
  // "New" the moment the agreement flips to active. Best-effort - any
  // failure is swallowed inside enqueueCrmContact. Runs only on a fresh
  // claim (we're past the alreadyClaimed short-circuit above), so a
  // webhook + finalize-endpoint race cannot double-insert.
  void (async () => {
    try {
      const fullName = (agreement.fullName || "").trim();
      const parts = fullName ? fullName.split(/\s+/) : [];
      const firstName = parts[0] ?? null;
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      const { enqueueCrmContact } = await import("../lib/crm-ingest");
      await enqueueCrmContact({
        email: agreement.email,
        phone: agreement.phone ?? null,
        firstName,
        lastName,
        source: "coaching-buyer",
        valueCents: opts.amountCents,
        properties: {
          agreement_id: opts.agreementId,
          agreement_type: agreement.agreementType,
        },
      });
    } catch {
      // already logged inside enqueueCrmContact
    }
  })();

  // Auto-grant A-List access (mirrors Whop coaching path). Wrapped in try/catch so a transient
  // failure does not prevent the welcome email or break the response. Failures are logged for ops.
  // SKIPPED for AI Influencer Account Rental - rentals grant no portal access.
  const email = agreement.email;
  let existingUserId: number | null = null;
  if (!isRentAg && !isMentorshipAg && !isDfyContentAg && !isDfyAdsAg) {
    try {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.insert(invitesTable).values({
        email,
        token,
        accessLevel: "a-list",
        status: "sent",
        expiresAt,
      }).onConflictDoNothing();

      const [existing] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.email, email));
      if (existing) {
        existingUserId = existing.id;
        await db.update(portalUsersTable).set({
          isAList: true,
          aListJoinedAt: existing.aListJoinedAt || new Date(),
          isActive: true,
          updatedAt: new Date(),
        }).where(eq(portalUsersTable.id, existing.id));
      }
    } catch (e) {
      console.error(`A-List grant failed for DFY agreement ${opts.agreementId}:`, e);
    }
  }

  const welcomeSubject = isMentorshipAg
    ? "Your 1:1 Mentorship Is Confirmed"
    : isRentAg
    ? "Your AI Influencer Account Rental Is Confirmed"
    : isDfyContentAg
    ? `Your ${dfyContentPlanAg!.productName} Is Confirmed`
    : isDfyAdsAg
    ? `Your ${dfyAdsPlanAg!.productName} Is Confirmed`
    : isPortugalAg
      ? `Your Seat At The AI Portfolio Portugal Retreat 2026 Is Confirmed${isVipAg ? " (VIP)" : ""}`
      : isDfyAiInfluencerAg
        ? "Welcome To Your DFY AI Influencer Build"
        : "Welcome To Your Done-For-You Build With Greg";
  const welcomeBody = isMentorshipAg
    ? (() => {
        const isQuarterly = mentorshipBillingAg === "quarterly";
        const amountLine = isQuarterly
          ? `Quarterly Amount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()} (billed every 3 months, 3-month minimum term, then auto-renews quarterly - cancel anytime after)`
          : `Annual Amount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()} (billed yearly, 12-month minimum term)`;
        return `Your ${ctxContentName} is confirmed and your payment has cleared.\n\nAgreement ID: ${opts.agreementId}\nPlan: ${ctxContentName}\n${amountLine}\n\nThis is a true 1:1 with my team and me (Greg). A member of our team will send your private 1:1 Slack channel invite within the next 24 hours, and from there we will schedule your monthly 1:1 calls and get you access to the advanced masterclass.\n\nIf you need anything in the meantime, just reply to this email.`;
      })()
    : isRentAg
    ? (rentPlanAg?.billing === "annual"
        ? `Your ${ctxContentName} is confirmed and your first year's payment has cleared.\n\nAgreement ID: ${opts.agreementId}\nPlan: ${ctxContentName}\nAnnual Amount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()} (billed yearly, 12-month minimum term)\n\nHere is what happens next.\n\nSetup and transfer takes 5 working days. As soon as your AI influencer account is fully set up and transferred across, we go live and you will be notified straight away.\n\nFrom there, you will be emailed a performance report every 30 days so you always know exactly how your account is doing.\n\nYou can reach our Done For You team at any time at dfy@room30.ai, or just use the chat bubble on any of our pages. We are here whenever you need us.`
        : `Your ${ctxContentName} is confirmed and your first month's payment has cleared.\n\nAgreement ID: ${opts.agreementId}\nPlan: ${ctxContentName}\nMonthly Amount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()} (billed monthly, 90-day minimum term)\n\nHere is what happens next.\n\nSetup and transfer takes 5 working days. As soon as your AI influencer account is fully set up and transferred across, we go live and you will be notified straight away.\n\nFrom there, you will be emailed a performance report every 30 days so you always know exactly how your account is doing.\n\nYou can reach our Done For You team at any time at dfy@room30.ai, or just use the chat bubble on any of our pages. We are here whenever you need us.`)
    : isDfyContentAg
    ? `Your ${ctxContentName} is confirmed and your payment has cleared.\n\nAgreement ID: ${opts.agreementId}\nPlan: ${ctxContentName}\nAmount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}${dfyContentPlanAg!.recurring ? " (billed monthly, rolling - cancel anytime with 7 days notice)" : " (one-time)"}\n\nOur team will be in touch shortly to get you started - but first we need one quick thing from you.\n\nPlease fill out this short intake form so we have everything we need to create your content: ${DFY_CONTENT_INTAKE_FORM_URL}\n\nWe cannot begin until your form is in. Once we have it, we will script, create, and edit your content and deliver it to you via Google Drive within 48 hours (2 business days).\n\nAny questions? Just email us at dfy@room30.ai. We are here whenever you need us.`
    : isDfyAdsAg
    ? `Your ${ctxContentName} is confirmed and your payment has cleared.\n\nAgreement ID: ${opts.agreementId}\nPlan: ${ctxContentName}\nAmount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}${dfyAdsPlanAg!.recurring ? " (billed monthly, rolling - cancel anytime with 7 days notice)" : " (one-time)"}\n\nOur team will be in touch shortly to get you started - but first we need one quick thing from you.\n\nPlease fill out this short intake form so we have everything we need to create your ads: ${DFY_ADS_INTAKE_FORM_URL}\n\nWe cannot begin until your form is in. Once we have it, we will concept, create, and edit your ads and deliver them to you via Google Drive within 48 hours (2 business days).\n\nAny questions? Just email us at dfy@room30.ai. We are here whenever you need us.`
    : isPortugalAg
      ? `Your seat at the AI Portfolio Portugal Retreat 2026 (${isVipAg ? "VIP Pass" : "Gold Pass"}) is paid in full and confirmed.\n\nAgreement ID: ${opts.agreementId}\nAmount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}\nDates: 4-6 September 2026 (Pine Cliffs Resort, Algarve, Portugal)${isVipAg ? "\nVIP Day: Thursday 3 September 2026" : ""}\nA-List Portal: granted.\n\nGreg will be in touch directly with the pre-Retreat brief, accommodation details, and the alumni channel invite. If you need anything in the meantime, just reply to this email.`
      : isDfyAiInfluencerAg
        ? `Your DFY AI Influencer pre-made business is paid in full and your room30.ai portal access is granted.\n\nAgreement ID: ${opts.agreementId}\nAmount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}\nA-List Portal: granted.\n\nA team member will be in touch within the next 24 hours to confirm your influencer preferences (face, look, vibe, name, niche) and walk you through your portal at room30.ai. In the meantime you can log in and start personalising right away from the "Your Influencers" page.\n\nIf you need anything sooner, just reply to this email.`
        : `Your Done-For-You build is paid in full and your client portal access is granted.\n\nAgreement ID: ${opts.agreementId}\nAmount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}\nA-List Portal: granted.\n\nGreg will be in touch directly to schedule your 60-minute onboarding and War Map call.`;

  try {
    await sendEmail({
      userId: existingUserId,
      email,
      subject: welcomeSubject,
      body: welcomeBody,
      templateType: "coaching_welcome",
      // Rental welcome emails send from the verified dfy.room30.ai domain with
      // replies routed to the Done For You inbox; mentorship welcome emails send
      // from mentorship@room30.ai; all other agreement types keep the default
      // Room30 AI sender.
      ...(isRentAg || isDfyContentAg || isDfyAdsAg
        ? { from: RENT_FROM_EMAIL, replyTo: RENT_REPLY_TO }
        : isMentorshipAg
          ? { from: MENTORSHIP_FROM_EMAIL, replyTo: MENTORSHIP_REPLY_TO }
          : {}),
      metadata: {
        agreementId: opts.agreementId,
        agreementType: agreement.agreementType,
        stripePaymentIntentId: opts.paymentIntentId ?? null,
        whopReceiptId: opts.whopReceiptId ?? null,
        whopMembershipId: opts.whopMembershipId ?? null,
      },
    });
  } catch (e) {
    console.error(`High-ticket welcome email failed for agreement ${opts.agreementId}:`, e);
  }

  // Task #819: branded HTML purchase receipt for the high-ticket
  // portal-granting flows (DFY $15k, DFY AI Influencer + Gold/Diamond/Gold
  // Special tiers, Portugal Gold/VIP, and the generic coaching catch-all).
  // Scoped to the same `!isRentAg && !isMentorshipAg` set that grants A-List
  // portal access so the "Open Your Portal" CTA is always valid; the
  // recurring rental/mentorship subscriptions are intentionally excluded.
  // Fire-and-forget AFTER the claim is committed - idempotent on the
  // agreement id at the email_logs layer, so the finalize-endpoint vs
  // webhook race never double-sends. A send failure never reverses access.
  if (!isRentAg && !isMentorshipAg && !isDfyContentAg && !isDfyAdsAg) {
    const receiptProductName = resolveHighTicketReceiptProductName(agreement.agreementType);
    void (async () => {
      try {
        const { sendCoachingReceiptEmail } = await import("../lib/coaching-receipt");
        await sendCoachingReceiptEmail({
          agreementId: opts.agreementId,
          email,
          productName: receiptProductName,
          amountCents: opts.amountCents,
          ctaUrl: `${getBrandBaseUrl()}/members`,
          ctaLabel: "Open Your Portal",
          userId: existingUserId,
        });
      } catch (e) {
        console.error(`High-ticket receipt email failed for agreement ${opts.agreementId}:`, e);
      }
    })();
  } else if (isDfyContentAg || isDfyAdsAg) {
    // Done-For-You Content / Ads buyers (one-time pack or monthly subscription)
    // get a branded payment receipt sent from the verified dfy.room30.ai domain
    // with replies routed to dfy@room30.ai. No "Open Your Portal" CTA - these
    // packages grant no portal access; the CTA points the buyer at the intake
    // form so the team can start the 48-hour delivery. Same agreement-id
    // idempotency at the email_logs layer as every other receipt branch.
    const dfyServiceReceiptName = isDfyAdsAg ? dfyAdsPlanAg!.productName : dfyContentPlanAg!.productName;
    const dfyServiceCtaLabel = isDfyAdsAg ? "Complete Your Ads Intake Form" : "Complete Your Content Intake Form";
    const dfyServiceFormUrl = isDfyAdsAg ? DFY_ADS_INTAKE_FORM_URL : DFY_CONTENT_INTAKE_FORM_URL;
    void (async () => {
      try {
        const { sendCoachingReceiptEmail } = await import("../lib/coaching-receipt");
        await sendCoachingReceiptEmail({
          agreementId: opts.agreementId,
          email,
          productName: dfyServiceReceiptName,
          amountCents: opts.amountCents,
          ctaUrl: dfyServiceFormUrl,
          ctaLabel: dfyServiceCtaLabel,
          userId: existingUserId,
          from: RENT_FROM_EMAIL,
          replyTo: RENT_REPLY_TO,
        });
      } catch (e) {
        logger.error(
          { err: e instanceof Error ? e.message : String(e), agreementId: opts.agreementId },
          "[coaching] dfy-service receipt email failed",
        );
      }
    })();
  } else if (isRentAg) {
    // AI Influencer account rentals (the /rent matrix) get a branded payment
    // receipt too. Sent from the verified dfy.room30.ai domain with replies
    // routed to dfy@room30.ai, using rental-specific copy (no "Open Your
    // Portal" CTA - a rental grants no portal access). Same agreement-id
    // idempotency at the email_logs layer as the portal-granting receipts, so
    // the finalize-endpoint vs webhook race never double-sends.
    const rentReceiptName = rentProductNameAg ?? ctxContentName;
    const rentBilling = rentPlanAg?.billing === "annual" ? "annual" : "monthly";
    void (async () => {
      try {
        const { sendCoachingReceiptEmail } = await import("../lib/coaching-receipt");
        const { rentReceiptBodyHtml } = await import("../lib/portal-addon-receipt-emails");
        await sendCoachingReceiptEmail({
          agreementId: opts.agreementId,
          email,
          productName: rentReceiptName,
          amountCents: opts.amountCents,
          ctaUrl: `mailto:${RENT_REPLY_TO}`,
          ctaLabel: "Contact The DFY Team",
          userId: existingUserId,
          from: RENT_FROM_EMAIL,
          replyTo: RENT_REPLY_TO,
          bodyHtml: rentReceiptBodyHtml({
            productName: rentReceiptName,
            amountCents: opts.amountCents,
            billing: rentBilling,
            ctaUrl: `mailto:${RENT_REPLY_TO}`,
            ctaLabel: "Contact The DFY Team",
          }),
        });
      } catch (e) {
        logger.error(
          { err: e instanceof Error ? e.message : String(e), agreementId: opts.agreementId },
          "[coaching] rental receipt email failed",
        );
      }
    })();
  }

  // Team notification email - this is what backs the "our team will be in
  // touch within 24 hours" promise on every high-ticket thank-you screen.
  // Sent to HIGH_TICKET_NOTIFY_EMAIL (greg@cookemedia.io by default) so a
  // human is alerted the moment a high-ticket purchase clears, instead of
  // relying on someone manually checking the coaching_agreements table.
  // Fire-and-forget but logged - failures must never block the buyer flow.
  try {
    const productLabel = isMentorshipAg
      ? mentorshipProductName(mentorshipBillingAg ?? "annual")
      : isRentAg
      ? rentProductNameAg
      : isDfyContentAg
      ? dfyContentPlanAg!.productName
      : isDfyAdsAg
      ? dfyAdsPlanAg!.productName
      : isPortugalAg
        ? (isVipAg ? PORTUGAL_VIP_PRODUCT_NAME : PORTUGAL_GOLD_PRODUCT_NAME)
        : isDfyAiInfluencerAg
          ? DFY_AI_INFLUENCER_PRODUCT_NAME
          : DFY_PRODUCT_NAME;
    const slaLine = isMentorshipAg
      ? (mentorshipBillingAg === "quarterly"
          ? "SLA: send buyer their private 1:1 Slack channel invite within 24 hours, schedule the monthly 1:1 calls (team + Greg), and grant masterclass access. NOTE: recurring quarterly subscription (3-month minimum, auto-renews quarterly)."
          : "SLA: send buyer their private 1:1 Slack channel invite within 24 hours, schedule the monthly 1:1 calls (team + Greg), and grant masterclass access. NOTE: recurring annual subscription (12-month minimum).")
      : isRentAg
      ? (rentPlanAg?.billing === "annual"
          ? "SLA: contact buyer within 24 hours to set up the rented AI influencer account. NOTE: recurring annual subscription (12-month minimum)."
          : "SLA: contact buyer within 24 hours to set up the rented AI influencer account. NOTE: recurring monthly subscription (90-day minimum).")
      : isDfyContentAg
      ? (dfyContentPlanAg!.recurring
          ? `SLA: buyer fills the content intake form (${DFY_CONTENT_INTAKE_FORM_URL}); script, create, and edit their content and deliver via Google Drive within 48 hours (2 business days). NOTE: recurring monthly subscription (rolling, cancel with 7 days notice).`
          : `SLA: buyer fills the content intake form (${DFY_CONTENT_INTAKE_FORM_URL}); script, create, and edit their content and deliver via Google Drive within 48 hours (2 business days). NOTE: one-time content package.`)
      : isDfyAdsAg
      ? (dfyAdsPlanAg!.recurring
          ? `SLA: buyer fills the ads intake form (${DFY_ADS_INTAKE_FORM_URL}); concept, create, and edit their ads and deliver via Google Drive within 48 hours (2 business days). NOTE: recurring monthly subscription (rolling, cancel with 7 days notice).`
          : `SLA: buyer fills the ads intake form (${DFY_ADS_INTAKE_FORM_URL}); concept, create, and edit their ads and deliver via Google Drive within 48 hours (2 business days). NOTE: one-time ads package.`)
      : isDfyAiInfluencerAg
        ? "SLA: contact buyer within 24 hours."
        : isPortugalAg
          ? "SLA: send pre-Retreat brief and alumni channel invite this week."
          : "SLA: schedule the 60-minute War Map onboarding within 7 days.";
    const teamSubject = `[NEW SALE] ${productLabel} - ${agreement.fullName} ($${(opts.amountCents / 100).toFixed(2)})`;
    const teamBody = [
      `A new high-ticket purchase just cleared. Action required.`,
      ``,
      `Product: ${productLabel}`,
      `Agreement Type: ${agreement.agreementType}`,
      `Agreement ID: ${opts.agreementId}`,
      `Amount: $${(opts.amountCents / 100).toFixed(2)} ${opts.currency.toUpperCase()}`,
      ``,
      `BUYER`,
      `Name: ${agreement.fullName}`,
      agreement.companyName ? `Company: ${agreement.companyName}` : null,
      `Email: ${agreement.email}`,
      agreement.phone ? `Phone: ${agreement.phone}` : null,
      agreement.address ? `Address: ${agreement.address}` : null,
      ``,
      `PAYMENT`,
      opts.whopReceiptId ? `Whop Receipt: ${opts.whopReceiptId}` : null,
      opts.whopMembershipId ? `Whop Membership: ${opts.whopMembershipId}` : null,
      opts.whopUserId ? `Whop User: ${opts.whopUserId}` : null,
      opts.paymentIntentId ? `Stripe Payment Intent: ${opts.paymentIntentId}` : null,
      ``,
      slaLine,
      ``,
      `Reply to this email to contact the buyer directly.`,
    ].filter((line): line is string => line !== null).join("\n");

    await sendEmail({
      email: HIGH_TICKET_NOTIFY_EMAIL,
      subject: teamSubject,
      body: teamBody,
      templateType: "high_ticket_team_alert",
      metadata: {
        agreementId: opts.agreementId,
        agreementType: agreement.agreementType,
        buyerEmail: agreement.email,
        amountCents: opts.amountCents,
        currency: opts.currency,
      },
      replyTo: agreement.email,
    });
  } catch (e) {
    console.error(`High-ticket TEAM notification email failed for agreement ${opts.agreementId}:`, e);
  }

  return { alreadyClaimed: false };
}

router.get("/coaching/verify-stripe/:sessionId", async (_req, res) => {
  // Stripe checkout verification is retired with the legacy purchasing
  // stack. High-ticket entitlements are granted via GoHighLevel flows.
  res.status(410).json({
    paid: false,
    error: "Stripe checkout verification is no longer available.",
  });
  return;
});

// Internal helper used by the Whop webhook (whopWebhookHandlers.ts) to
// claim the DFY agreement when payment.succeeded lands with
// metadata.agreementId. Idempotent on agreementId via claimDfyAgreement.
export async function claimDfyAgreementFromWhop(opts: {
  agreementId: number;
  whopReceiptId: string | null;
  whopMembershipId: string | null;
  whopUserId: string | null;
  amountCents: number;
  currency: string;
}): Promise<{ alreadyClaimed: boolean }> {
  return claimDfyAgreement({
    agreementId: opts.agreementId,
    whopReceiptId: opts.whopReceiptId,
    whopMembershipId: opts.whopMembershipId,
    whopUserId: opts.whopUserId,
    amountCents: opts.amountCents,
    currency: opts.currency,
  });
}

// Internal helper used by the Whop webhook on refund.created /
// payment.refunded for a DFY receipt. We flip the agreement status back to
// 'refunded', revoke A-List portal access, and stop billing access. Side
// effects (welcome email rollback, Meta CAPI refund) are not fired -- the
// revoke is the on-disk source of truth.
export async function revokeDfyAgreementFromWhop(opts: {
  agreementId: number;
  whopReceiptId: string | null;
}): Promise<{ alreadyRevoked: boolean }> {
  const [agreement] = await db
    .select()
    .from(coachingAgreementsTable)
    .where(eq(coachingAgreementsTable.id, opts.agreementId));
  if (!agreement) {
    console.warn(`revokeDfyAgreementFromWhop: agreement ${opts.agreementId} not found`);
    return { alreadyRevoked: true };
  }
  if (agreement.status === "refunded") {
    return { alreadyRevoked: true };
  }
  await db
    .update(coachingAgreementsTable)
    .set({ status: "refunded", updatedAt: new Date() })
    .where(eq(coachingAgreementsTable.id, opts.agreementId));
  try {
    const [u] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.email, agreement.email));
    if (u) {
      await db
        .update(portalUsersTable)
        .set({ isAList: false, updatedAt: new Date() } as any)
        .where(eq(portalUsersTable.id, u.id));
    }
  } catch (e) {
    console.error(`A-List revoke failed for DFY agreement ${opts.agreementId}:`, e);
  }
  // Task #646: mirror the refund back to the internal Sales CRM so reps
  // stop working a row that is no longer a customer. Best-effort.
  try {
    const { markCrmContactRefunded } = await import("../lib/crm-ingest");
    void markCrmContactRefunded({
      email: agreement.email,
      reason: "whop_refund_dfy_agreement",
      detail: `agreement=${opts.agreementId}${opts.whopReceiptId ? ` receipt=${opts.whopReceiptId}` : ""}`,
      source: "whop_webhook",
      payload: {
        agreementId: opts.agreementId,
        whopReceiptId: opts.whopReceiptId,
        agreementType: agreement.agreementType,
      },
    });
  } catch (e) {
    console.warn(
      `CRM refund mirror failed for DFY agreement ${opts.agreementId}:`,
      e,
    );
  }

  return { alreadyRevoked: false };
}

// GET /coaching/verify-whop/:agreementId
// The post-payment redirect target after the embedded Whop checkout iframe
// reports success. Polls the agreement row to surface paid=true once the
// payment.succeeded webhook has flipped status='active'. As a defensive
// fallback, if the row is still status='signed' we attempt a server-side
// receipt verification via the optional ?receiptId query string so the
// thank-you page does not stall when the webhook is delayed.
router.get("/coaching/verify-whop/:agreementId", async (req, res) => {
  try {
    const id = parseInt(req.params.agreementId, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ paid: false, reason: "invalid_agreement_id", error: "Invalid agreement id" }); return;
    }

    const [agreement] = await db.select().from(coachingAgreementsTable).where(eq(coachingAgreementsTable.id, id));
    if (!agreement) {
      // Task #505: log warn so unknown / spoofed agreement ids show up
      // in ops logs (Cassie's "Payment Complete" without a charge was
      // first noticed because no agreement row existed for the id she
      // landed on).
      req.log?.warn?.({ agreementId: id, ip: getMetaIp(req) }, "[verify-whop] unknown agreementId");
      res.status(404).json({ paid: false, reason: "agreement_not_found", error: "Agreement not found" }); return;
    }
    const isHighTicket = agreement.agreementType === "dfy"
      || agreement.agreementType === "dfy_ai_influencer"
      || agreement.agreementType === "dfy_ai_influencer_gold"
      || agreement.agreementType === "dfy_ai_influencer_diamond"
      || agreement.agreementType === "dfy_ai_influencer_gold_special"
      || agreement.agreementType === "portugal_gold"
      || agreement.agreementType === "portugal_vip"
      || rentTierFromType(agreement.agreementType ?? "") !== null
      || parseRentPlan(agreement.agreementType ?? "") !== null
      || parseDfyContentPlan(agreement.agreementType ?? "") !== null
      || parseDfyAdsPlan(agreement.agreementType ?? "") !== null
      || isMentorshipType(agreement.agreementType ?? "");
    if (!isHighTicket) {
      res.status(400).json({ paid: false, reason: "not_high_ticket", error: "Agreement is not a high-ticket agreement" }); return;
    }
    // Task #505: confirming a payment requires BOTH
    //   (a) the agreement row is flipped to status='active', AND
    //   (b) at least one real payment-evidence id is attached:
    //       whop_session_id (receipt), whop_membership_id, OR
    //       stripe_payment_intent_id.
    // A truthy `paid_at` alone is not enough (legacy / partial-state
    // rows sometimes carry paid_at without ever being activated). A
    // status flip alone is also not enough - a webhook or admin write
    // could have set status='active' without a real charge clearing.
    // Both signals together are how we know a buyer actually paid.
    if (agreement.status === "active") {
      const whopReceiptId = agreement.whopSessionId ?? null;
      const whopMembershipId = agreement.whopMembershipId ?? null;
      const stripePaymentIntentId = agreement.stripePaymentIntentId ?? null;
      if (!whopReceiptId && !whopMembershipId && !stripePaymentIntentId) {
        req.log?.warn?.(
          { agreementId: id, status: agreement.status, paidAt: agreement.paidAt },
          "[verify-whop] agreement is active but has no whop receipt/membership or stripe payment intent",
        );
        res.json({ paid: false, agreementId: id, reason: "missing_payment_link" });
        return;
      }
      res.json({ paid: true, agreementId: id, whopReceiptId, whopMembershipId, stripePaymentIntentId });
      return;
    }
    if (agreement.paidAt) {
      // paid_at without status='active' means a webhook started writing
      // but never finished, or a legacy row. Refuse to confirm and log
      // so ops can reconcile manually.
      req.log?.warn?.(
        { agreementId: id, status: agreement.status, paidAt: agreement.paidAt },
        "[verify-whop] agreement has paid_at but status is not active",
      );
      res.json({ paid: false, agreementId: id, reason: "not_active" });
      return;
    }

    // Inline payment-processor rescue (Stripe PI retrieve / Whop receipt
    // fetch) is retired with the legacy purchasing stack. Confirmation now
    // relies solely on the agreement row state written by the entitlement
    // flows (the status==='active' branch above). If we reach here the
    // agreement has not yet been activated.
    res.json({ paid: false, agreementId: id, reason: "not_active" }); return;
  } catch (error: any) {
    console.error("Whop verify error:", error);
    res.status(500).json({ paid: false, error: error.message });
    return;
  }
});

// Legacy /coaching/verify alias for the Whop receipt path (kept for any
// frontend code still calling the old URL pattern). Performs a 302 redirect
// to the canonical verify-whop endpoint, preserving the receipt query.
router.get("/coaching/verify/:agreementId", (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(307, `/api/coaching/verify-whop/${encodeURIComponent(req.params.agreementId)}${qs}`);
});

export default router;
