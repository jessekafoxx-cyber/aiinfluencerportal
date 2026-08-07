import { db, platinumFounderCodesTable, ordersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "./logger";
import { isMainProductSlug } from "../productCatalog";
import { provenanceFor } from "./payment-provenance";

// Generate a buyer-facing code shaped like PLAT-XXXX-XXXX-XXXX. The
// alphabet drops easily-confused glyphs (0/O, 1/I/L) so codes pasted
// out of an email survive transcription. 12 chars from a 32-char
// alphabet = ~60 bits of entropy, more than enough for a per-buyer
// single-use redeem code where the worst case is a duplicate generation
// (caught by the PRIMARY KEY).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  const bytes = crypto.randomBytes(12);
  let out = "PLAT-";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export interface IssueCodeArgs {
  email: string;
  orderId?: string | null;
  userId?: string | null;
}

export interface IssuedCode {
  code: string;
  ownerEmail: string;
  status: "unredeemed" | "redeemed" | "revoked";
  alreadyExisted: boolean;
}

/**
 * Idempotent issuance: ensures the buyer (keyed on email) owns exactly
 * one Platinum Founder Code. Safe to call from a webhook that may be
 * delivered multiple times. If a code already exists for the email -
 * regardless of status (unredeemed / redeemed / revoked) - this is a
 * no-op and returns the existing row.
 */
export async function issuePlatinumFounderCode(
  args: IssueCodeArgs,
): Promise<IssuedCode | null> {
  const email = normalizeEmail(args.email);
  if (!email) return null;

  const existing = await db
    .select()
    .from(platinumFounderCodesTable)
    .where(eq(platinumFounderCodesTable.ownerEmail, email))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0]!;
    // Backfill owner_user_id the first time we see one, so admin
    // lookups by user id work even for codes issued before the buyer
    // had an app_users row.
    if (args.userId && !row.ownerUserId) {
      await db
        .update(platinumFounderCodesTable)
        .set({ ownerUserId: args.userId, updatedAt: new Date() })
        .where(eq(platinumFounderCodesTable.code, row.code));
    }
    return {
      code: row.code,
      ownerEmail: row.ownerEmail,
      status: row.status as IssuedCode["status"],
      alreadyExisted: true,
    };
  }

  // Retry a handful of times in the astronomically rare collision case.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const [inserted] = await db
        .insert(platinumFounderCodesTable)
        .values({
          code,
          ownerEmail: email,
          ownerUserId: args.userId || null,
          ownerOrderId: args.orderId || null,
          status: "unredeemed",
        })
        .onConflictDoNothing({ target: platinumFounderCodesTable.ownerEmail })
        .returning();
      if (inserted) {
        logger.info(
          { email, orderId: args.orderId, code },
          "[platinum-codes] issued new Platinum Founder Code",
        );
        return {
          code: inserted.code,
          ownerEmail: inserted.ownerEmail,
          status: inserted.status as IssuedCode["status"],
          alreadyExisted: false,
        };
      }
      // onConflictDoNothing returned nothing => another concurrent
      // webhook delivery beat us. Re-read and return that row.
      const race = await db
        .select()
        .from(platinumFounderCodesTable)
        .where(eq(platinumFounderCodesTable.ownerEmail, email))
        .limit(1);
      if (race[0]) {
        return {
          code: race[0].code,
          ownerEmail: race[0].ownerEmail,
          status: race[0].status as IssuedCode["status"],
          alreadyExisted: true,
        };
      }
    } catch (e) {
      lastErr = e;
      // PRIMARY KEY collision on `code`; loop and try a different code.
    }
  }
  logger.error({ email, err: lastErr }, "[platinum-codes] issuance failed after retries");
  return null;
}

export async function getPlatinumCodeForEmail(
  email: string,
): Promise<typeof platinumFounderCodesTable.$inferSelect | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const rows = await db
    .select()
    .from(platinumFounderCodesTable)
    .where(eq(platinumFounderCodesTable.ownerEmail, e))
    .limit(1);
  return rows[0] || null;
}

export async function getPlatinumCodeForUserId(
  userId: string,
): Promise<typeof platinumFounderCodesTable.$inferSelect | null> {
  if (!userId) return null;
  const rows = await db
    .select()
    .from(platinumFounderCodesTable)
    .where(eq(platinumFounderCodesTable.ownerUserId, userId))
    .limit(1);
  return rows[0] || null;
}

export interface RedeemArgs {
  code: string;
  email: string;
  userId?: string | null;
  productSlug: string;
  redeemedForOrderId: string;
}

export type RedeemResult =
  | {
      success: true;
      code: string;
      productSlug: string;
      orderId: string;
      redeemedAt: Date;
    }
  | {
      success: false;
      reason:
        | "not_found"
        | "wrong_owner"
        | "not_main_product"
        | "already_redeemed"
        | "revoked"
        | "subscription_inactive";
    };

/**
 * Atomic redemption: marking the code consumed AND granting the
 * synthetic order row that carries the entitlement happen in a single
 * DB transaction. If the entitlement insert/update fails for any
 * reason, the whole transaction rolls back and the code remains
 * unredeemed (the buyer can retry). The UPDATE ... WHERE
 * status='unredeemed' inside the transaction guarantees a code can
 * only ever be redeemed once even under concurrent callers.
 *
 * Owner check: the code's owner_user_id must match the redeeming
 * buyer's app_users id when both are present; otherwise we fall back
 * to the case-insensitive email match (issuance can happen before the
 * buyer's app_users row exists). Subscription-active check: the owner
 * must still have at least one orders row with upsell3Paid=true
 * (i.e. they have not cancelled Platinum Club). Cancellation does NOT
 * retroactively revoke an already-redeemed product; it only blocks
 * future redemptions of an unused code.
 */
export async function redeemPlatinumCode(args: RedeemArgs): Promise<RedeemResult> {
  const code = (args.code || "").trim().toUpperCase();
  const email = normalizeEmail(args.email);
  const userId = args.userId || null;
  if (!code || !email) return { success: false, reason: "not_found" };
  if (!args.redeemedForOrderId) return { success: false, reason: "not_found" };

  if (!isMainProductSlug(args.productSlug)) {
    return { success: false, reason: "not_main_product" };
  }

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(platinumFounderCodesTable)
      .where(eq(platinumFounderCodesTable.code, code))
      .for("update")
      .limit(1);
    if (!existing) return { success: false, reason: "not_found" } as RedeemResult;

    // Prefer user_id match when both sides have one; otherwise fall
    // back to email. This survives email changes once the user_id
    // backfill has happened.
    const ownerOk = existing.ownerUserId && userId
      ? existing.ownerUserId === userId
      : existing.ownerEmail === email;
    if (!ownerOk) return { success: false, reason: "wrong_owner" } as RedeemResult;

    if (existing.status === "redeemed") {
      return { success: false, reason: "already_redeemed" } as RedeemResult;
    }
    if (existing.status === "revoked") {
      return { success: false, reason: "revoked" } as RedeemResult;
    }

    // Subscription-active check inside the same tx so a concurrent
    // cancel webhook can't slip past us.
    const subscriberRows = await tx
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(and(eq(ordersTable.email, email), eq(ordersTable.upsell3Paid, true)))
      .limit(1);
    if (subscriberRows.length === 0) {
      return { success: false, reason: "subscription_inactive" } as RedeemResult;
    }

    const now = new Date();
    const flipped = await tx
      .update(platinumFounderCodesTable)
      .set({
        status: "redeemed",
        ownerUserId: existing.ownerUserId || userId,
        redeemedForProductSlug: args.productSlug,
        redeemedForOrderId: args.redeemedForOrderId,
        redeemedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(platinumFounderCodesTable.code, code),
          eq(platinumFounderCodesTable.status, "unredeemed"),
        ),
      )
      .returning({ code: platinumFounderCodesTable.code });

    if (flipped.length === 0) {
      // Lost the race against another concurrent redeem.
      return { success: false, reason: "already_redeemed" } as RedeemResult;
    }

    // Grant the entitlement: synthetic order row, mainProductPaid=true.
    // Idempotent on id, so a duplicate POST tied to the same code is a
    // no-op (the row already exists).
    const [existingOrder] = await tx
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(eq(ordersTable.id, args.redeemedForOrderId))
      .limit(1);
    // Task #551 provenance: founder-code redemption is an entitlement
    // grant, NOT a verified payment. Stamp platinum_founder_code so
    // revenue analytics exclude these from real-revenue counts while
    // still treating them as auditable paid access.
    const founderProvenance = provenanceFor({
      source: "platinum_founder_code",
      reason: `founder_code_redeem:${code}:${args.productSlug}`,
      hasReceiptId: false,
    });
    if (existingOrder) {
      await tx
        .update(ordersTable)
        .set({
          mainProductPaid: true,
          productSlugs: args.productSlug,
          paymentSourceType: founderProvenance.paymentSourceType,
          grantReason: founderProvenance.grantReason,
          paymentVerified: founderProvenance.paymentVerified,
          receiptVerified: founderProvenance.receiptVerified,
          updatedAt: now,
        })
        .where(eq(ordersTable.id, args.redeemedForOrderId));
    } else {
      await tx.insert(ordersTable).values({
        id: args.redeemedForOrderId,
        email,
        currentStep: "platinum-redeemed",
        mainProductPaid: true,
        productSlugs: args.productSlug,
        totalAmount: 0,
        paymentSourceType: founderProvenance.paymentSourceType,
        grantReason: founderProvenance.grantReason,
        paymentVerified: founderProvenance.paymentVerified,
        receiptVerified: founderProvenance.receiptVerified,
      });
    }

    logger.info(
      {
        code,
        email,
        userId,
        productSlug: args.productSlug,
        orderId: args.redeemedForOrderId,
      },
      "[platinum-codes] redeemed (atomic)",
    );

    return {
      success: true,
      code,
      productSlug: args.productSlug,
      orderId: args.redeemedForOrderId,
      redeemedAt: now,
    } as RedeemResult;
  });
}

/**
 * Admin-driven revoke. Always succeeds (idempotent) and never touches
 * already-redeemed access for the redeemed_for product - the task
 * acceptance criterion is that "cancelling Platinum Club does not
 * retroactively revoke an already-redeemed product".
 */
export async function revokePlatinumCode(
  code: string,
  reason: string,
): Promise<{ revoked: boolean; alreadyRevoked: boolean; alreadyRedeemed: boolean }> {
  const c = (code || "").trim().toUpperCase();
  if (!c) return { revoked: false, alreadyRevoked: false, alreadyRedeemed: false };
  const [existing] = await db
    .select()
    .from(platinumFounderCodesTable)
    .where(eq(platinumFounderCodesTable.code, c))
    .limit(1);
  if (!existing) return { revoked: false, alreadyRevoked: false, alreadyRedeemed: false };
  if (existing.status === "redeemed") {
    return { revoked: false, alreadyRevoked: false, alreadyRedeemed: true };
  }
  if (existing.status === "revoked") {
    return { revoked: false, alreadyRevoked: true, alreadyRedeemed: false };
  }
  await db
    .update(platinumFounderCodesTable)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: reason || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinumFounderCodesTable.code, c),
        eq(platinumFounderCodesTable.status, "unredeemed"),
      ),
    );
  return { revoked: true, alreadyRevoked: false, alreadyRedeemed: false };
}

/**
 * Cancellation / refund hook: when a buyer's Platinum Club access is
 * removed (orders.upsell3Paid flipped back to false), any unredeemed
 * code they own is revoked. Already-redeemed codes are left alone -
 * the buyer keeps the product they already redeemed for.
 */
export async function revokeUnredeemedCodeForEmail(
  email: string,
  reason: string,
): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e) return false;
  const flipped = await db
    .update(platinumFounderCodesTable)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: reason || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinumFounderCodesTable.ownerEmail, e),
        eq(platinumFounderCodesTable.status, "unredeemed"),
      ),
    )
    .returning({ code: platinumFounderCodesTable.code });
  if (flipped.length > 0) {
    logger.info(
      { email: e, reason, code: flipped[0]!.code },
      "[platinum-codes] revoked unredeemed code on subscription cancel/refund",
    );
    return true;
  }
  return false;
}