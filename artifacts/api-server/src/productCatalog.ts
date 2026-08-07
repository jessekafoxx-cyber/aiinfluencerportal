/**
 * Plain product catalog for the Room30 portal template.
 *
 * The legacy Whop / Stripe purchase stacks are gone - purchasing now
 * flows through GoHighLevel (see the GHL webhook + products table).
 * This file only carries the payment-processor-agnostic constants that
 * entitlement, reporting, and support code still need:
 *   - the slug -> orders.<col>_paid mapping,
 *   - display labels + canonical catalog prices,
 *   - a stable `sku` string used for Kit purchase-line idempotency
 *     (values preserved from the retired Stripe lookup keys so existing
 *     Kit transaction history keeps matching),
 *   - the "main product" flag consumed by Platinum Founder Codes.
 */

export type ProductSlug =
  | "main"
  | "bump2"
  | "bump3"
  | "upsell1"
  | "downsell1"
  | "upsell2"
  | "upsell3"
  | "downsell3"
  | "platinum_club"
  | "portfolio";

export type PaidFieldName =
  | "mainProductPaid"
  | "bump2Paid"
  | "bump3Paid"
  | "upsell1Paid"
  | "upsell2Paid"
  | "upsell3Paid"
  | "downsell1Paid"
  | "platinumPaid"
  | "doneForYouPackPaid"
  | "portfolioPaid";

export interface ProductDef {
  slug: ProductSlug;
  label: string;
  /** Canonical catalog price in cents (reporting fallback only). */
  priceCents: number;
  /** True for subscription-style products (Platinum Club). */
  recurring: boolean;
  /**
   * Stable SKU string for external reporting (Kit purchase lines).
   * Preserves the retired Stripe `lookup_key` values so historic
   * transactions keep matching.
   */
  sku: string;
  /** Maps to the matching `orders.<col>_paid` boolean column, if any. */
  paidField?: PaidFieldName;
  /**
   * True for "main products" that a Platinum Founder Code can be
   * redeemed against. Today only the $27 Influencer Masterclass
   * qualifies; future main products should opt in here.
   */
  isMainProduct?: boolean;
}

export const PRODUCTS: Record<ProductSlug, ProductDef> = {
  main: {
    slug: "main",
    label: "AI Influencer Masterclass + DFY Build",
    priceCents: 2700,
    recurring: false,
    sku: "ao_main_v1",
    paidField: "mainProductPaid",
    isMainProduct: true,
  },
  bump2: {
    slug: "bump2",
    label: "2,000 Hook Prompt Library",
    priceCents: 2700,
    recurring: false,
    sku: "ao_bump2_v1",
    paidField: "bump2Paid",
  },
  bump3: {
    slug: "bump3",
    label: "TikTok Slideshow + IG Follow Hijack Masterclass",
    priceCents: 3700,
    recurring: false,
    sku: "ao_bump3_v1",
    paidField: "bump3Paid",
  },
  upsell1: {
    slug: "upsell1",
    label: "Done-For-You Pack",
    priceCents: 19700,
    recurring: false,
    sku: "ao_upsell1_v1",
    paidField: "upsell1Paid",
  },
  downsell1: {
    slug: "downsell1",
    label: "Done-For-You Pack (Discounted)",
    priceCents: 9700,
    recurring: false,
    sku: "ao_downsell1_v1",
    paidField: "downsell1Paid",
  },
  upsell2: {
    slug: "upsell2",
    label: "Our Portfolio (47 digital products + 5 unique AI Influencers)",
    priceCents: 29700,
    recurring: false,
    sku: "ao_upsell2_v1",
    paidField: "upsell2Paid",
  },
  upsell3: {
    slug: "upsell3",
    label: "Platinum Club",
    priceCents: 9700,
    recurring: true,
    sku: "ao_upsell3_platinum_trial_v1",
    paidField: "upsell3Paid",
  },
  // A buyer who declines upsell3 and accepts downsell3 owns Platinum
  // either way - both intentionally share the `upsell3Paid` column.
  downsell3: {
    slug: "downsell3",
    label: "Platinum Club (30-Day Free Trial - Downsell)",
    priceCents: 9700,
    recurring: true,
    sku: "ao_downsell3_platinum_trial_v1",
    paidField: "upsell3Paid",
  },
  // Sidebar Platinum purchase keeps its own `platinumPaid` column so it
  // stays distinguishable from an upsell3 purchase at the DB level.
  platinum_club: {
    slug: "platinum_club",
    label: "Platinum Club",
    priceCents: 9700,
    recurring: true,
    sku: "ao_upsell3_platinum_trial_v1",
    paidField: "platinumPaid",
  },
  portfolio: {
    slug: "portfolio",
    label: "47 Digital Products & 5 AI Influencers",
    priceCents: 29700,
    recurring: false,
    sku: "portfolio_v1",
  },
};

export function getProductBySlug(slug: ProductSlug): ProductDef {
  return PRODUCTS[slug];
}

export function isMainProductSlug(slug: string): boolean {
  const def = (PRODUCTS as Record<string, ProductDef>)[slug];
  return !!def?.isMainProduct;
}

export function listMainProductSlugs(): ProductSlug[] {
  return (Object.values(PRODUCTS) as ProductDef[])
    .filter((d) => d.isMainProduct)
    .map((d) => d.slug);
}
