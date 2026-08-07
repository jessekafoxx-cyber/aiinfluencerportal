/**
 * GHL product catalog → portal entitlement mapping.
 *
 * Purchasing lives entirely inside each client's GoHighLevel account. A
 * product row (products table) describes what a purchase unlocks:
 *
 *   - grantsFullPortal: activates the buyer's portal account
 *     (portal_users.is_active), flips orders.main_product_paid via the
 *     provenance helper, and fires the enrollment/welcome email flow.
 *   - entitlements: allowlisted keys that map onto the boolean paid flags
 *     of the buyer's orders row (add-on content gates across the portal).
 *
 * Grant/revoke contract:
 *   - grantProductToUser is idempotent: replays return alreadyGranted.
 *   - revokeProductFromUser only touches ACTIVE purchase rows
 *     (revoked_at IS NULL) and returns what it revoked — downstream logic
 *     uses that as its idempotency/concurrency gate. Entitlement flags are
 *     only un-flipped when no OTHER active purchase still grants them.
 */
import { and, eq, isNull, sql, ne } from "drizzle-orm";
import {
  db,
  portalUsersTable,
  ordersTable,
  productsTable,
  purchasesTable,
  type Product,
  type PortalUser,
} from "@workspace/db";
import { provenanceFor } from "./payment-provenance";
import { enrollPurchaserAndSendEmail } from "./purchase-enrollment";
import { logger } from "./logger";

// Allowlisted add-on entitlement keys → orders paid columns. These are the
// content gates the portal already enforces; a product's `entitlements`
// array may only contain keys from this map.
export const ENTITLEMENT_DEFS = {
  bump1: { column: "bump1Paid", label: "Bump 1 (legacy VSL Vault)" },
  bump2: { column: "bump2Paid", label: "2,000 Hook Prompt Library" },
  bump3: { column: "bump3Paid", label: "TikTok Slideshow + IG Follow Hijack" },
  upsell1: { column: "upsell1Paid", label: "Done-For-You Pack" },
  downsell1: { column: "downsell1Paid", label: "Done-For-You Pack (Discounted)" },
  upsell2: { column: "upsell2Paid", label: "Portfolio + 5 AI Influencers unlock" },
  upsell3: { column: "upsell3Paid", label: "Platinum funnel tier (upsell 3)" },
  tiktok_slideshow: { column: "tiktokSlideshowPaid", label: "TikTok Slideshow" },
  hook_demo: { column: "hookDemoPaid", label: "Hook Demo" },
  dfy_pack: { column: "doneForYouPackPaid", label: "DFY content unlock" },
  portfolio: { column: "portfolioPaid", label: "47 Digital Products Portfolio" },
  platinum: { column: "platinumPaid", label: "Platinum Club" },
} as const;

export type EntitlementKey = keyof typeof ENTITLEMENT_DEFS;

// Product slugs the portal's locked upgrade surfaces look up in
// GET /portal/purchase-links (sidebar upsell rows, locked pages, credit
// panels). When a slug here has no ACTIVE product with a purchase URL,
// that surface falls back to the "contact hello@room30.ai" notice — an
// easy misconfiguration for a fresh template install, so the admin Setup
// checklist and Products page warn about it.
export const UPGRADE_SLUG_DEFS = {
  "order-bump-2": "2,000 Hook Prompt Library",
  "done-for-you-pack": "Done-For-You Pack",
  "our-portfolio": "47 Digital Products Portfolio",
  "platinum-club": "Platinum Club",
  "order-bump-3": "TikTok Slideshow + IG Follow Hijack",
  "video-credits": "Video credits top-up",
  "influencer-credits": "Influencer credits top-up",
} as const;

export type UpgradeSlug = keyof typeof UPGRADE_SLUG_DEFS;

export const UPGRADE_SLUGS = Object.keys(UPGRADE_SLUG_DEFS) as UpgradeSlug[];

export const ENTITLEMENT_KEYS = Object.keys(ENTITLEMENT_DEFS) as EntitlementKey[];

export function isEntitlementKey(k: string): k is EntitlementKey {
  return k in ENTITLEMENT_DEFS;
}

export function sanitizeEntitlements(keys: unknown): EntitlementKey[] {
  if (!Array.isArray(keys)) return [];
  return Array.from(new Set(keys.filter((k): k is EntitlementKey => typeof k === "string" && isEntitlementKey(k))));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findProductBySlug(slug: string): Promise<Product | null> {
  const [p] = await db
    .select()
    .from(productsTable)
    .where(sql`lower(${productsTable.slug}) = ${slug.trim().toLowerCase()}`)
    .limit(1);
  return p ?? null;
}

/**
 * Find-or-create a portal user by lower(email). A purchaser who has never
 * signed in gets a shell row with no clerk_id; `ensurePortalUserForClerk`
 * adopts it by email on their first real sign-in (Task #505 invariant).
 */
export async function findOrCreateUserByEmail(
  email: string,
  name?: string | null,
): Promise<{ user: PortalUser; created: boolean }> {
  const normalised = normalizeEmail(email);
  const [existing] = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${normalised}`)
    .limit(1);
  if (existing) return { user: existing, created: false };

  const trimmed = (name ?? "").trim();
  const [firstName, ...rest] = trimmed ? trimmed.split(/\s+/) : [];
  const [inserted] = await db
    .insert(portalUsersTable)
    .values({
      email: normalised,
      firstName: firstName || null,
      lastName: rest.length ? rest.join(" ") : null,
      portalKey: "room30",
      role: "user",
      // Shell rows start inactive; grantsFullPortal products activate below,
      // and the email-claim path on first Clerk sign-in also activates.
      isActive: false,
    })
    .returning();
  if (inserted) return { user: inserted, created: true };
  // Lost a race with a concurrent insert — re-read.
  const [again] = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${normalised}`)
    .limit(1);
  if (!again) throw new Error(`portal_users insert for ${normalised} failed`);
  return { user: again, created: false };
}

/**
 * Find-or-create the buyer's GHL-OWNED orders row (entitlement flags live
 * there). Grants must only ever write flags to a row with
 * paymentSourceType = 'ghl_verified_payment' — never onto legacy
 * Stripe/Whop/admin rows — so that revokeProductFromUser (which un-flips
 * GHL rows only) can always reverse exactly what a grant wrote. Portal
 * content gates aggregate flags across ALL of the email's orders rows, so
 * a dedicated row grants access just the same.
 */
async function ensureOrderRow(user: PortalUser, receiptId: string) {
  const normalised = normalizeEmail(user.email);
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(
      sql`lower(${ordersTable.email}) = ${normalised} and ${ordersTable.paymentSourceType} = 'ghl_verified_payment'`,
    )
    .orderBy(ordersTable.createdAt)
    .limit(1);
  if (existing) return existing;
  const stamp = provenanceFor({
    source: "ghl_verified_payment",
    reason: "ghl_products_webhook",
    hasReceiptId: true,
  });
  const [inserted] = await db
    .insert(ordersTable)
    .values({
      id: `ghl:${receiptId}`,
      email: normalised,
      ghlOrderId: receiptId,
      paymentSourceType: stamp.paymentSourceType,
      grantReason: stamp.grantReason,
      paymentVerified: stamp.paymentVerified,
      receiptVerified: stamp.receiptVerified,
      totalAmount: 0,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [again] = await db
    .select()
    .from(ordersTable)
    .where(
      sql`lower(${ordersTable.email}) = ${normalised} and ${ordersTable.paymentSourceType} = 'ghl_verified_payment'`,
    )
    .limit(1);
  if (!again) throw new Error(`orders row create for ${normalised} failed`);
  return again;
}

export interface GrantResult {
  granted: string[];
  alreadyGranted: boolean;
  userId: number;
}

export async function grantProductToUser(
  user: PortalUser,
  product: Product,
  opts: { source?: string; receiptId?: string; metadata?: Record<string, unknown> } = {},
): Promise<GrantResult> {
  const receiptId = opts.receiptId?.trim() || `p${product.id}-u${user.id}-${Date.now()}`;

  // Insert the purchase row first. The partial unique index on
  // (user_id, product_id) WHERE revoked_at IS NULL makes a replayed grant
  // collapse into alreadyGranted.
  const [purchase] = await db
    .insert(purchasesTable)
    .values({
      userId: user.id,
      productId: product.id,
      source: opts.source ?? "webhook",
      metadata: { ...(opts.metadata ?? {}), receiptId },
    })
    .onConflictDoNothing()
    .returning();
  if (!purchase) {
    // Replay of an existing active purchase. Side effects below are all
    // idempotent, so RE-APPLY them: if a previous attempt crashed after the
    // ledger insert but before the entitlement flips, the retry heals the
    // grant instead of no-oping forever (retry-safety contract).
    const [existing] = await db
      .select({ metadata: purchasesTable.metadata })
      .from(purchasesTable)
      .where(
        and(
          eq(purchasesTable.userId, user.id),
          eq(purchasesTable.productId, product.id),
          isNull(purchasesTable.revokedAt),
        ),
      )
      .limit(1);
    const existingReceipt =
      (existing?.metadata as Record<string, unknown> | null | undefined)?.receiptId;
    await applyGrantSideEffects(
      user,
      product,
      typeof existingReceipt === "string" && existingReceipt ? existingReceipt : receiptId,
    );
    return { granted: [], alreadyGranted: true, userId: user.id };
  }

  const granted = await applyGrantSideEffects(user, product, receiptId);
  return { granted, alreadyGranted: false, userId: user.id };
}

/**
 * Apply (or re-apply) every side effect of an active grant. Idempotent:
 * activation is a plain SET, flag flips are guarded, and the enrollment
 * email dedupes per orderId — safe to run on every webhook/API replay.
 */
async function applyGrantSideEffects(
  user: PortalUser,
  product: Product,
  receiptId: string,
): Promise<string[]> {
  const granted: string[] = [];

  if (product.grantsFullPortal) {
    await db
      .update(portalUsersTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(portalUsersTable.id, user.id));
    const order = await ensureOrderRow(user, receiptId);
    if (!order.mainProductPaid) {
      const stamp = provenanceFor({
        source: "ghl_verified_payment",
        reason: `ghl_product:${product.slug}`,
        hasReceiptId: true,
      });
      await db
        .update(ordersTable)
        .set({
          mainProductPaid: true,
          ghlOrderId: order.ghlOrderId ?? receiptId,
          paymentSourceType: stamp.paymentSourceType,
          grantReason: stamp.grantReason,
          paymentVerified: stamp.paymentVerified,
          receiptVerified: stamp.receiptVerified,
          updatedAt: new Date(),
        })
        .where(eq(ordersTable.id, order.id));
    }
    granted.push("portal_access");
    // Clerk invitation + branded welcome email (deduped per orderId inside).
    void enrollPurchaserAndSendEmail({ email: user.email, orderId: order.id }).catch((err) =>
      logger.warn({ err, email: user.email }, "[ghl-entitlements] enrollment email failed"),
    );
  }

  const keys = sanitizeEntitlements(product.entitlements);
  if (keys.length > 0) {
    const order = await ensureOrderRow(user, receiptId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of keys) {
      updates[ENTITLEMENT_DEFS[key].column] = true;
      granted.push(key);
    }
    await db.update(ordersTable).set(updates).where(eq(ordersTable.id, order.id));
  }

  return granted;
}

/**
 * Revoke a product from a user. Only touches active purchase rows
 * (revoked_at IS NULL); returns the list of entitlement keys actually
 * un-flipped. Keys still granted by another active purchase are preserved.
 */
export async function revokeProductFromUser(
  user: PortalUser,
  product: Product,
): Promise<string[]> {
  const revokedRows = await db
    .update(purchasesTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(purchasesTable.userId, user.id),
        eq(purchasesTable.productId, product.id),
        isNull(purchasesTable.revokedAt),
      ),
    )
    .returning({ id: purchasesTable.id });
  if (revokedRows.length === 0) return [];

  // Which entitlements do the user's REMAINING active purchases still grant?
  const remaining = await db
    .select({ grantsFullPortal: productsTable.grantsFullPortal, entitlements: productsTable.entitlements })
    .from(purchasesTable)
    .innerJoin(productsTable, eq(purchasesTable.productId, productsTable.id))
    .where(
      and(
        eq(purchasesTable.userId, user.id),
        isNull(purchasesTable.revokedAt),
        ne(purchasesTable.productId, product.id),
      ),
    );
  const stillFullPortal = remaining.some((r) => r.grantsFullPortal);
  const stillKeys = new Set(remaining.flatMap((r) => sanitizeEntitlements(r.entitlements)));

  const revoked: string[] = [];
  const normalised = normalizeEmail(user.email);
  // Only rows written by the GHL grant model may be un-flipped. Legacy
  // Stripe/Whop/admin-granted orders rows are independent paid evidence and
  // must never lose their flags because a GHL product was revoked.
  const ghlRowsOnly = sql`lower(${ordersTable.email}) = ${normalised} and ${ordersTable.paymentSourceType} = 'ghl_verified_payment'`;

  if (product.grantsFullPortal && !stillFullPortal) {
    await db
      .update(ordersTable)
      .set({ mainProductPaid: false, updatedAt: new Date() })
      .where(ghlRowsOnly);
    // Deactivate only if NO remaining orders row (any source) still proves
    // main-product access — and never deactivate admins.
    const [stillPaid] = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(
        sql`lower(${ordersTable.email}) = ${normalised} and ${ordersTable.mainProductPaid} = true`,
      )
      .limit(1);
    if (!stillPaid) {
      await db
        .update(portalUsersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(portalUsersTable.id, user.id), ne(portalUsersTable.role, "admin")));
    }
    revoked.push("portal_access");
  }

  const keysToRemove = sanitizeEntitlements(product.entitlements).filter((k) => !stillKeys.has(k));
  if (keysToRemove.length > 0) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of keysToRemove) {
      updates[ENTITLEMENT_DEFS[key].column] = false;
      revoked.push(key);
    }
    await db.update(ordersTable).set(updates).where(ghlRowsOnly);
  }

  return revoked;
}

/** All active access for a user (for the external API + admin UI). */
export async function getUserAccess(user: PortalUser) {
  const rows = await db
    .select({
      productId: purchasesTable.productId,
      slug: productsTable.slug,
      name: productsTable.name,
      grantsFullPortal: productsTable.grantsFullPortal,
      entitlements: productsTable.entitlements,
      source: purchasesTable.source,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .innerJoin(productsTable, eq(purchasesTable.productId, productsTable.id))
    .where(and(eq(purchasesTable.userId, user.id), isNull(purchasesTable.revokedAt)));
  // Aggregate flags across ALL of the email's orders rows (GHL grants live
  // on a dedicated ghl_verified_payment row; legacy rows may hold others).
  const orderRows = await db
    .select()
    .from(ordersTable)
    .where(sql`lower(${ordersTable.email}) = ${normalizeEmail(user.email)}`);
  const flags: Record<string, boolean> = {};
  for (const key of ENTITLEMENT_KEYS) {
    flags[key] = orderRows.some(
      (o) => !!(o as Record<string, unknown>)[ENTITLEMENT_DEFS[key].column],
    );
  }
  return {
    isActive: !!user.isActive,
    purchases: rows,
    entitlementFlags: flags,
    mainProductPaid: orderRows.some((o) => !!o.mainProductPaid),
  };
}
