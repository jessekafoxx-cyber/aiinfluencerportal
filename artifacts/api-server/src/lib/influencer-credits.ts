/**
 * Influencer-credit grant + revoke helpers used by the
 * "Buy more influencer generations" flow (flat $29/credit).
 *
 * The buyer pays a Stripe PaymentIntent stamped with
 * metadata.purpose='influencer_credits' + portalUserId + qty. On
 * success we increment portal_users.bonus_influencer_quota by qty
 * and persist a one-row ledger entry in influencer_credit_purchases
 * (UNIQUE on stripe_payment_intent_id).
 *
 * Idempotency: every grant path (finalize endpoint, webhook,
 * reconciler) calls grantInfluencerCredits. The first writer wins
 * the UNIQUE insert; subsequent writers detect the existing row and
 * no-op so concurrent finalize + webhook can never double-grant.
 *
 * Refund posture (mirrors portal-stripe-addons): on a Stripe
 * refund we revoke UNUSED credits only. Used credits are not
 * clawed back since the buyer already consumed them on generations.
 */

import { eq, sql } from "drizzle-orm";
import {
  db,
  influencerCreditPurchasesTable,
  portalUsersTable,
} from "@workspace/db";
import { logger } from "./logger";

export const INFLUENCER_CREDIT_UNIT_CENTS = 2900;
export const INFLUENCER_CREDIT_MIN_QTY = 1;
export const INFLUENCER_CREDIT_MAX_QTY = 100;

export function parseInfluencerCreditQty(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const qty = Math.floor(n);
  if (qty < INFLUENCER_CREDIT_MIN_QTY || qty > INFLUENCER_CREDIT_MAX_QTY) return null;
  return qty;
}

export type GrantInfluencerCreditsInput = {
  portalUserId: number;
  qty: number;
  paymentIntentId: string;
  stripeCustomerId?: string | null;
  amountCents?: number | null;
};

export type GrantInfluencerCreditsResult = {
  granted: boolean;
  alreadyGranted: boolean;
  qty: number;
  newBonusQuota: number;
};

/**
 * Idempotent: insert ledger row + bump bonus_influencer_quota.
 * Returns granted=true on the first successful grant for a PI,
 * granted=false + alreadyGranted=true on every replay.
 */
export async function grantInfluencerCredits(
  input: GrantInfluencerCreditsInput,
): Promise<GrantInfluencerCreditsResult> {
  const qty = parseInfluencerCreditQty(input.qty);
  if (qty === null) {
    throw new Error(
      `grantInfluencerCredits: invalid qty ${input.qty} (must be ${INFLUENCER_CREDIT_MIN_QTY}-${INFLUENCER_CREDIT_MAX_QTY})`,
    );
  }
  if (!Number.isInteger(input.portalUserId) || input.portalUserId <= 0) {
    throw new Error("grantInfluencerCredits: invalid portalUserId");
  }
  if (typeof input.paymentIntentId !== "string" || !input.paymentIntentId.startsWith("pi_")) {
    throw new Error("grantInfluencerCredits: invalid paymentIntentId");
  }

  const totalAmountCents =
    typeof input.amountCents === "number" && input.amountCents > 0
      ? input.amountCents
      : qty * INFLUENCER_CREDIT_UNIT_CENTS;

  // Single transaction: claim ledger row + bump bonus pool atomically.
  // UNIQUE on stripe_payment_intent_id means a concurrent writer gets
  // DO NOTHING and an empty returning, in which case we short-circuit
  // before the quota bump so it cannot double-credit.
  const { granted, newBonusQuota } = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(influencerCreditPurchasesTable)
      .values({
        portalUserId: input.portalUserId,
        qty,
        unitAmountCents: INFLUENCER_CREDIT_UNIT_CENTS,
        totalAmountCents,
        stripePaymentIntentId: input.paymentIntentId,
        stripeCustomerId: input.stripeCustomerId ?? null,
        status: "paid",
      })
      .onConflictDoNothing({
        target: influencerCreditPurchasesTable.stripePaymentIntentId,
      })
      .returning({ id: influencerCreditPurchasesTable.id });

    if (inserted.length === 0) {
      const userRow = await tx
        .select({ bonus: portalUsersTable.bonusInfluencerQuota })
        .from(portalUsersTable)
        .where(eq(portalUsersTable.id, input.portalUserId))
        .limit(1);
      return { granted: false, newBonusQuota: Number(userRow[0]?.bonus ?? 0) };
    }

    const updated = await tx
      .update(portalUsersTable)
      .set({
        bonusInfluencerQuota: sql`${portalUsersTable.bonusInfluencerQuota} + ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, input.portalUserId))
      .returning({ bonus: portalUsersTable.bonusInfluencerQuota });

    return { granted: true, newBonusQuota: Number(updated[0]?.bonus ?? 0) };
  });

  if (!granted) {
    return { granted: false, alreadyGranted: true, qty, newBonusQuota };
  }

  logger.info(
    {
      portalUserId: input.portalUserId,
      qty,
      paymentIntentId: input.paymentIntentId,
      totalAmountCents,
      newBonusQuota,
    },
    "[influencer-credits] granted",
  );

  return { granted: true, alreadyGranted: false, qty, newBonusQuota };
}

export type RevokeInfluencerCreditsResult = {
  revoked: boolean;
  qtyRevoked: number;
  qtyOnLedger: number;
};

/**
 * Refund handler: revoke UNUSED credits only. Look up the ledger
 * row by PI id. Decrement bonus_influencer_quota by
 * min(qty_purchased - qty_already_refunded, current_bonus). Flip
 * the ledger row to status='refunded' with refunded_at + refunded_qty.
 *
 * Idempotent: if the row is already terminal-refunded (status=
 * 'refunded' AND refunded_qty=qty), we no-op and return revoked=false.
 */
export async function revokeInfluencerCreditsForPaymentIntent(
  paymentIntentId: string,
): Promise<RevokeInfluencerCreditsResult> {
  const rows = await db
    .select()
    .from(influencerCreditPurchasesTable)
    .where(eq(influencerCreditPurchasesTable.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  const ledger = rows[0];
  if (!ledger) {
    return { revoked: false, qtyRevoked: 0, qtyOnLedger: 0 };
  }
  if (ledger.status === "refunded" && ledger.refundedQty >= ledger.qty) {
    return { revoked: false, qtyRevoked: 0, qtyOnLedger: ledger.qty };
  }

  const remainingToRefund = ledger.qty - ledger.refundedQty;
  if (remainingToRefund <= 0) {
    return { revoked: false, qtyRevoked: 0, qtyOnLedger: ledger.qty };
  }

  // Read current bonus to compute how many we can actually claw
  // back without going negative. Used credits stay with the buyer.
  const userRow = await db
    .select({ bonus: portalUsersTable.bonusInfluencerQuota })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, ledger.portalUserId))
    .limit(1);
  const currentBonus = Number(userRow[0]?.bonus ?? 0);
  const qtyRevoked = Math.max(0, Math.min(remainingToRefund, currentBonus));

  if (qtyRevoked > 0) {
    await db
      .update(portalUsersTable)
      .set({
        bonusInfluencerQuota: sql`GREATEST(0, ${portalUsersTable.bonusInfluencerQuota} - ${qtyRevoked})`,
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, ledger.portalUserId));
  }

  await db
    .update(influencerCreditPurchasesTable)
    .set({
      status: "refunded",
      refundedAt: new Date(),
      refundedQty: ledger.refundedQty + remainingToRefund,
    })
    .where(eq(influencerCreditPurchasesTable.id, ledger.id));

  logger.info(
    {
      portalUserId: ledger.portalUserId,
      paymentIntentId,
      qtyOnLedger: ledger.qty,
      qtyRevoked,
      qtyUsed: remainingToRefund - qtyRevoked,
    },
    "[influencer-credits] refunded",
  );

  return { revoked: qtyRevoked > 0, qtyRevoked, qtyOnLedger: ledger.qty };
}
