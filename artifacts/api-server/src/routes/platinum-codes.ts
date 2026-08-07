import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "../lib/auth-compat";
import { db, ordersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getPlatinumCodeForEmail,
  redeemPlatinumCode,
  issuePlatinumFounderCode,
} from "../lib/platinum-founder-codes";
import { listMainProductSlugs, isMainProductSlug, getProductBySlug } from "../productCatalog";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface AuthIdentity {
  userId: string;
  email: string;
}

async function resolveAuthIdentity(req: any): Promise<AuthIdentity | null> {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as any)?.userId || auth?.userId;
  if (!userId) return null;
  const claims = auth?.sessionClaims as any;
  let email: string | null =
    claims?.email || claims?.email_address || claims?.primary_email_address || null;
  if (!email) {
    try {
      const u = await clerkClient.users.getUser(userId as string);
      email = u.emailAddresses?.[0]?.emailAddress || null;
    } catch {
      /* ignore - resolved below */
    }
  }
  if (!email) return null;
  return { userId: String(userId), email: email.trim().toLowerCase() };
}

// Public catalog: which slugs can a Founder Code be redeemed against.
// Surfaces the WHOP_PRODUCTS isMainProduct flag so the funnel UI can
// gate the "Redeem Founder Code" widget on eligible product pages
// without baking a hard-coded slug list into the client.
router.get("/platinum-codes/main-products", (_req, res) => {
  const slugs = listMainProductSlugs();
  res.json({
    products: slugs.map((slug) => {
      const def = getProductBySlug(slug);
      return {
        slug,
        label: def.label,
        priceCents: def.priceCents,
      };
    }),
  });
});

// Authenticated buyer reads their own Platinum Founder Code. Returns the
// code itself + status. Returns 404 if the buyer has no code yet (they
// have not bought Platinum Club, or the webhook has not landed yet).
//
// Self-heal: if the buyer's most recent order has upsell3Paid=true but
// no code row exists (issuance webhook lost / out-of-order delivery),
// issue one inline so the buyer never sees a missing code on /thankyou.
router.get("/platinum-codes/me", async (req: any, res) => {
  try {
    const identity = await resolveAuthIdentity(req);
    if (!identity) { res.status(401).json({ error: "Unauthorized" }); return; }

    let row = await getPlatinumCodeForEmail(identity.email);
    if (!row) {
      const subscriberRows = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.email, identity.email),
            eq(ordersTable.upsell3Paid, true),
          ),
        )
        .limit(1);
      if (subscriberRows.length > 0) {
        await issuePlatinumFounderCode({
          email: identity.email,
          userId: identity.userId,
          orderId: subscriberRows[0]!.id,
        });
        row = await getPlatinumCodeForEmail(identity.email);
      }
    } else if (!row.ownerUserId && identity.userId) {
      // Lazy backfill of owner_user_id on first authenticated read.
      await issuePlatinumFounderCode({
        email: identity.email,
        userId: identity.userId,
      });
      row = await getPlatinumCodeForEmail(identity.email);
    }

    if (!row) { res.status(404).json({ error: "no_code" }); return; }
    res.json({
      code: row.code,
      status: row.status,
      ownerEmail: row.ownerEmail,
      redeemedForProductSlug: row.redeemedForProductSlug,
      redeemedForOrderId: row.redeemedForOrderId,
      redeemedAt: row.redeemedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }); return;
  } catch (e: any) {
    req.log?.error?.({ err: e?.message || e }, "[platinum-codes/me] failed");
    res.status(500).json({ error: "server_error" }); return;
  }
});

// Authenticated redeem: marks the code consumed AND grants the requested
// main product entitlement on a synthetic order row keyed by the
// redemption (id = `platinum-redeem-<code>`) inside one DB transaction.
// The synthetic order flips mainProductPaid=true so downstream
// entitlement readers see the buyer as having paid for the product,
// while the distinct id keeps it auditable and never collides with real
// Whop orders.
router.post("/platinum-codes/redeem", async (req: any, res) => {
  try {
    const identity = await resolveAuthIdentity(req);
    if (!identity) { res.status(401).json({ error: "Unauthorized" }); return; }

    const code = String(req.body?.code || "").trim().toUpperCase();
    const productSlug = String(req.body?.productSlug || "").trim();
    if (!code || !productSlug) {
      res.status(400).json({ error: "code and productSlug are required" }); return;
    }
    if (!isMainProductSlug(productSlug)) {
      return res
        .status(400)
        .json({ error: "not_main_product", message: "This product cannot be redeemed with a Founder Code." });
    }

    const redeemOrderId = `platinum-redeem-${code}`;
    const result = await redeemPlatinumCode({
      code,
      email: identity.email,
      userId: identity.userId,
      productSlug,
      redeemedForOrderId: redeemOrderId,
    });

    if (!result.success) {
      const status =
        result.reason === "wrong_owner" || result.reason === "subscription_inactive"
          ? 403
          : result.reason === "already_redeemed" || result.reason === "revoked"
            ? 409
            : 404;
      res.status(status).json({ error: result.reason }); return;
    }

    logger.info(
      { code, email: identity.email, userId: identity.userId, productSlug, orderId: result.orderId },
      "[platinum-codes] redemption granted main product entitlement",
    );

    res.json({
      success: true,
      code: result.code,
      productSlug: result.productSlug,
      orderId: result.orderId,
      redeemedAt: result.redeemedAt,
    }); return;
  } catch (e: any) {
    req.log?.error?.({ err: e?.message || e }, "[platinum-codes/redeem] failed");
    res.status(500).json({ error: "server_error" }); return;
  }
});

export default router;
