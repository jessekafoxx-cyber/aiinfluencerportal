/**
 * Idempotent Stripe catalog seeder (Task #582).
 *
 * Reads the canonical product catalog from
 * artifacts/api-server/src/stripeProducts.ts and ensures one matching
 * Stripe Product + Price for each entry. Idempotency is keyed off
 * Price.lookup_key:
 *
 *   - If a Price with the lookup_key already exists, no-op.
 *   - If not but a Product with name === def.label exists, attach a
 *     fresh Price to it with the lookup_key.
 *   - Otherwise create both Product + Price from scratch.
 *
 * Also creates the MAY2026 promotion (Coupon + Promotion Code).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:stripe-catalog
 *   pnpm --filter @workspace/scripts run seed:stripe-catalog --apply
 *
 * Without --apply this is a dry run (prints the plan, makes no API calls
 * that mutate state). With --apply it actually creates / updates.
 */

import Stripe from "stripe";
import {
  STRIPE_PRODUCTS,
  MAY2026_PROMO,
  type StripeProductDef,
} from "../../artifacts/api-server/src/stripeProducts";

const APPLY = process.argv.includes("--apply");

function main(): Promise<void> {
  return run();
}

async function run(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set in env. Aborting.");
    process.exit(1);
  }
  const stripe = new Stripe(key, {
    apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
  });

  console.log(
    `[seed-stripe-catalog] mode=${APPLY ? "APPLY" : "DRY-RUN"} mode=${
      key.startsWith("sk_live_") ? "LIVE" : "TEST"
    }`,
  );

  const defs = Object.values(STRIPE_PRODUCTS) as StripeProductDef[];
  for (const def of defs) {
    await upsertCatalogEntry(stripe, def);
  }

  await upsertMay2026Promo(stripe);

  console.log(
    `[seed-stripe-catalog] done. ${defs.length} catalog entries processed.${
      APPLY ? "" : " (dry run; pass --apply to mutate Stripe)"
    }`,
  );
}

async function upsertCatalogEntry(
  stripe: Stripe,
  def: StripeProductDef,
): Promise<void> {
  // 1. Has a Price with this lookup_key already?
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    limit: 1,
    active: true,
  });
  if (existing.data[0]) {
    const p = existing.data[0];
    console.log(
      `  ✔ ${def.slug.padEnd(32)} lookup_key=${def.lookupKey} -> Price ${p.id} (already exists, $${(p.unit_amount ?? 0) / 100})`,
    );
    return;
  }

  // 2. Find or create the parent Product.
  let productId: string | undefined;
  const search = await stripe.products.search({
    query: `name:'${def.label.replace(/'/g, "\\'")}'`,
    limit: 1,
  });
  if (search.data[0]) {
    productId = search.data[0].id;
    console.log(`  · ${def.slug}: reusing Product ${productId} ('${def.label}')`);
  } else if (APPLY) {
    const created = await stripe.products.create({
      name: def.label,
      metadata: { slug: def.slug },
      statement_descriptor: def.statementDescriptorSuffix.slice(0, 22),
    });
    productId = created.id;
    console.log(`  + ${def.slug}: CREATED Product ${productId} ('${def.label}')`);
  } else {
    productId = "prod_DRYRUN";
    console.log(`  + ${def.slug}: would CREATE Product ('${def.label}') [dry-run]`);
  }

  // 3. Create the Price with the canonical lookup_key.
  const recurring =
    def.recurring && typeof def.recurring === "object"
      ? {
          interval: def.recurring.interval,
          interval_count: def.recurring.intervalCount ?? 1,
        }
      : undefined;

  if (APPLY) {
    const created = await stripe.prices.create({
      product: productId!,
      unit_amount: def.priceCents,
      currency: def.currency,
      lookup_key: def.lookupKey,
      transfer_lookup_key: true,
      ...(recurring ? { recurring } : {}),
      metadata: { slug: def.slug },
    });
    console.log(
      `  + ${def.slug.padEnd(32)} lookup_key=${def.lookupKey} -> Price ${created.id} ($${def.priceCents / 100})`,
    );
  } else {
    console.log(
      `  + ${def.slug.padEnd(32)} would CREATE Price (lookup_key=${def.lookupKey}, $${def.priceCents / 100}) [dry-run]`,
    );
  }
}

/**
 * Resolve the Stripe Product IDs that the MAY2026 coupon should be
 * restricted to. Pulls the live Product behind each allowed slug's
 * lookup_key so we never ship a coupon that accidentally zeroes out
 * an upsell or order bump.
 */
async function resolveAllowedProductIds(stripe: Stripe): Promise<string[]> {
  const ids: string[] = [];
  for (const slug of MAY2026_PROMO.appliesToSlugs) {
    const def = STRIPE_PRODUCTS[slug];
    if (!def) continue;
    const list = await stripe.prices.list({
      lookup_keys: [def.lookupKey],
      limit: 1,
      expand: ["data.product"],
    });
    const price = list.data[0];
    if (!price) {
      console.warn(
        `  ! MAY2026: no Stripe Price for slug=${slug} (lookup_key=${def.lookupKey}). The coupon will be skipped until the catalog seed runs with --apply.`,
      );
      continue;
    }
    const productId =
      typeof price.product === "string"
        ? price.product
        : (price.product as Stripe.Product | Stripe.DeletedProduct).id;
    ids.push(productId);
  }
  return ids;
}

async function upsertMay2026Promo(stripe: Stripe): Promise<void> {
  const allowedProductIds = await resolveAllowedProductIds(stripe);

  // Coupon - restricted to the main SKU only via applies_to.products.
  let coupon: Stripe.Coupon | null = null;
  try {
    coupon = await stripe.coupons.retrieve(MAY2026_PROMO.couponId);
    const restrictedTo = coupon.applies_to?.products ?? [];
    console.log(
      `  ✔ Coupon ${coupon.id} already exists (${coupon.percent_off}% off, restricted to ${restrictedTo.length} product(s))`,
    );
  } catch {
    if (APPLY) {
      if (allowedProductIds.length === 0) {
        console.warn(
          `  ! Skipping coupon creation: no resolvable Product ids for ${MAY2026_PROMO.appliesToSlugs.join(",")}. Re-run after the catalog has been seeded.`,
        );
      } else {
        coupon = await stripe.coupons.create({
          id: MAY2026_PROMO.couponId,
          percent_off: MAY2026_PROMO.percentOff,
          duration: "once",
          max_redemptions: MAY2026_PROMO.maxRedemptions,
          name: "MAY2026 Launch Promo",
          applies_to: { products: allowedProductIds },
        });
        console.log(
          `  + Coupon CREATED ${coupon.id} (${coupon.percent_off}% off, restricted to [${allowedProductIds.join(", ")}])`,
        );
      }
    } else {
      console.log(
        `  + Coupon ${MAY2026_PROMO.couponId} would be CREATED (${MAY2026_PROMO.percentOff}% off, restricted to [${allowedProductIds.join(", ") || "<resolve at apply time>"}]) [dry-run]`,
      );
    }
  }

  // Promotion Code - hard expiry, restricted by virtue of the coupon.
  const existing = await stripe.promotionCodes.list({
    code: MAY2026_PROMO.promotionCode,
    limit: 1,
  });
  if (existing.data[0]) {
    console.log(
      `  ✔ PromotionCode ${existing.data[0].id} (${existing.data[0].code}) already exists`,
    );
    return;
  }
  if (APPLY && coupon) {
    // The installed stripe-node typings omit the required `coupon`
    // field on PromotionCodeCreateParams. Augment the type explicitly
    // (no `any`) to satisfy both TS and the Stripe API.
    type CreateParamsWithCoupon = Omit<Stripe.PromotionCodeCreateParams, "promotion"> & {
      coupon: string;
    };
    const params: CreateParamsWithCoupon = {
      coupon: coupon.id,
      code: MAY2026_PROMO.promotionCode,
      max_redemptions: MAY2026_PROMO.maxRedemptions,
      active: true,
      expires_at: MAY2026_PROMO.expiresAtUnixSec,
    };
    const created = await stripe.promotionCodes.create(
      params as unknown as Stripe.PromotionCodeCreateParams,
    );
    console.log(
      `  + PromotionCode CREATED ${created.id} (${created.code}, expires ${new Date(MAY2026_PROMO.expiresAtUnixSec * 1000).toISOString()})`,
    );
  } else {
    console.log(
      `  + PromotionCode ${MAY2026_PROMO.promotionCode} would be CREATED (expires ${new Date(MAY2026_PROMO.expiresAtUnixSec * 1000).toISOString()}) [dry-run]`,
    );
  }
}

main().catch((err) => {
  console.error("[seed-stripe-catalog] failed:", err);
  process.exit(1);
});
