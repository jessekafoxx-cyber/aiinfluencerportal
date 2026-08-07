/**
 * Video-credit wallet + ledger helpers for the AI Video Studio (Task #828).
 *
 * Video credits are a SEPARATE balance from research / os-tool / influencer
 * credits. Each portal user has at most one wallet row (video_credits) and an
 * append-only ledger (video_credit_transactions). Every balance mutation goes
 * through `applyVideoCreditDelta` inside a single transaction that locks the
 * wallet row, so concurrent debits/credits cannot race the balance negative.
 *
 * Idempotency:
 *   - Stripe credit-pack grants pass `stripePaymentIntentId` (UNIQUE in the
 *     ledger) so the finalize endpoint + webhook never double-grant.
 *   - Debits/refunds pass `idempotencyKey` (UNIQUE in the ledger) so a retried
 *     generation/edit/timeout-refund cannot double-charge or double-refund.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  videoCreditsTable,
  videoCreditTransactionsTable,
  VIDEO_CREDIT_TX_TYPES,
  type VideoCreditTxType,
  type VideoCreditTransaction,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Fractional-credit ledger (Task #837). Balances and ledger deltas are stored
 * in integer sub-units (1 credit = 100 sub-units) so half-credits are exactly
 * representable. The legacy integer `balance` / `amount` / `balance_after`
 * columns are kept in sync (rounded) for un-migrated readers; the *_subunits
 * columns are authoritative. Effective sub-units fall back to legacy*100 when
 * the *_subunits column is still null (un-backfilled row).
 */
export const SUBUNITS_PER_CREDIT = 100;

/** Convert a (possibly fractional) credit amount to integer sub-units. */
export function creditsToSubunits(credits: number): number {
  return Math.round(credits * SUBUNITS_PER_CREDIT);
}

/** Convert integer sub-units back to a credit amount. */
export function subunitsToCredits(subunits: number): number {
  return subunits / SUBUNITS_PER_CREDIT;
}

/** Legacy integer-credit value to keep the old columns roughly in sync. */
function subunitsToLegacy(subunits: number): number {
  return Math.round(subunits / SUBUNITS_PER_CREDIT);
}

export class InsufficientVideoCreditsError extends Error {
  readonly balance: number;
  readonly required: number;
  constructor(balance: number, required: number) {
    super(`Insufficient video credits: have ${balance}, need ${required}`);
    this.name = "InsufficientVideoCreditsError";
    this.balance = balance;
    this.required = required;
  }
}

/** Ensure a wallet row exists for the user; returns the current balance. */
export async function getOrCreateVideoWalletBalance(portalUserId: number): Promise<number> {
  assertPortalUserId(portalUserId);
  await db
    .insert(videoCreditsTable)
    .values({ portalUserId, balance: 0 })
    .onConflictDoNothing({ target: videoCreditsTable.portalUserId });
  const [row] = await db
    .select({
      balance: videoCreditsTable.balance,
      balanceSubunits: videoCreditsTable.balanceSubunits,
    })
    .from(videoCreditsTable)
    .where(eq(videoCreditsTable.portalUserId, portalUserId))
    .limit(1);
  return subunitsToCredits(effectiveBalanceSubunits(row));
}

/** Effective wallet balance in sub-units, falling back to legacy*100. */
function effectiveBalanceSubunits(
  row: { balance: number | null; balanceSubunits: number | null } | undefined,
): number {
  if (!row) return 0;
  if (row.balanceSubunits != null) return Number(row.balanceSubunits);
  return Number(row.balance ?? 0) * SUBUNITS_PER_CREDIT;
}

export type ApplyVideoCreditDeltaInput = {
  portalUserId: number;
  /** Signed credit delta. Positive grants, negative debits. */
  delta: number;
  type: VideoCreditTxType;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  stripePaymentIntentId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ApplyVideoCreditDeltaResult = {
  applied: boolean;
  alreadyApplied: boolean;
  balance: number;
  delta: number;
};

/**
 * Atomically apply a signed delta to the wallet and append a ledger row.
 * Throws InsufficientVideoCreditsError when a debit would go negative.
 * Returns alreadyApplied=true (and a no-op) when a matching
 * stripePaymentIntentId / idempotencyKey ledger row already exists.
 */
export async function applyVideoCreditDelta(
  input: ApplyVideoCreditDeltaInput,
): Promise<ApplyVideoCreditDeltaResult> {
  assertPortalUserId(input.portalUserId);
  if (!Number.isFinite(input.delta)) {
    throw new Error("applyVideoCreditDelta: delta must be a finite number");
  }
  const deltaSubunits = creditsToSubunits(input.delta);

  return db.transaction(async (tx) => {
    // Idempotency short-circuit before any mutation.
    if (input.stripePaymentIntentId) {
      const existing = await tx
        .select({ id: videoCreditTransactionsTable.id })
        .from(videoCreditTransactionsTable)
        .where(
          eq(
            videoCreditTransactionsTable.stripePaymentIntentId,
            input.stripePaymentIntentId,
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return noopResult(tx, input.portalUserId);
      }
    }
    if (input.idempotencyKey) {
      const existing = await tx
        .select({ id: videoCreditTransactionsTable.id })
        .from(videoCreditTransactionsTable)
        .where(eq(videoCreditTransactionsTable.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.length > 0) {
        return noopResult(tx, input.portalUserId);
      }
    }

    // Ensure wallet exists, then lock the row for the balance math.
    await tx
      .insert(videoCreditsTable)
      .values({ portalUserId: input.portalUserId, balance: 0 })
      .onConflictDoNothing({ target: videoCreditsTable.portalUserId });

    const [wallet] = await tx
      .select({
        id: videoCreditsTable.id,
        balance: videoCreditsTable.balance,
        balanceSubunits: videoCreditsTable.balanceSubunits,
      })
      .from(videoCreditsTable)
      .where(eq(videoCreditsTable.portalUserId, input.portalUserId))
      .for("update")
      .limit(1);

    const currentSubunits = effectiveBalanceSubunits(wallet);
    const nextSubunits = currentSubunits + deltaSubunits;
    if (nextSubunits < 0) {
      throw new InsufficientVideoCreditsError(
        subunitsToCredits(currentSubunits),
        subunitsToCredits(-deltaSubunits),
      );
    }

    await tx
      .update(videoCreditsTable)
      .set({
        balance: subunitsToLegacy(nextSubunits),
        balanceSubunits: nextSubunits,
        updatedAt: new Date(),
      })
      .where(eq(videoCreditsTable.portalUserId, input.portalUserId));

    await tx.insert(videoCreditTransactionsTable).values({
      portalUserId: input.portalUserId,
      type: input.type,
      amount: subunitsToLegacy(deltaSubunits),
      balanceAfter: subunitsToLegacy(nextSubunits),
      amountSubunits: deltaSubunits,
      balanceAfterSubunits: nextSubunits,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? null,
    });

    return {
      applied: true,
      alreadyApplied: false,
      balance: subunitsToCredits(nextSubunits),
      delta: input.delta,
    };
  });
}

/** Grant credits from a paid Stripe credit-pack PI. Idempotent on the PI id. */
export async function grantVideoCreditsFromStripe(opts: {
  portalUserId: number;
  qty: number;
  paymentIntentId: string;
  reason?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<ApplyVideoCreditDeltaResult> {
  if (!Number.isInteger(opts.qty) || opts.qty <= 0) {
    throw new Error("grantVideoCreditsFromStripe: qty must be a positive integer");
  }
  const result = await applyVideoCreditDelta({
    portalUserId: opts.portalUserId,
    delta: opts.qty,
    type: VIDEO_CREDIT_TX_TYPES.PURCHASE,
    reason: opts.reason ?? "credit pack purchase",
    refType: "stripe_pi",
    refId: opts.paymentIntentId,
    stripePaymentIntentId: opts.paymentIntentId,
    metadata: opts.metadata ?? null,
  });
  logger.info(
    {
      portalUserId: opts.portalUserId,
      qty: opts.qty,
      paymentIntentId: opts.paymentIntentId,
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      balance: result.balance,
    },
    "[video-credits] stripe grant",
  );
  return result;
}

/** Debit credits for a generation/edit. Throws on insufficient balance. */
export async function debitVideoCredits(opts: {
  portalUserId: number;
  amount: number;
  type: VideoCreditTxType;
  reason?: string;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<ApplyVideoCreditDeltaResult> {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new Error("debitVideoCredits: amount must be a positive number");
  }
  return applyVideoCreditDelta({
    portalUserId: opts.portalUserId,
    delta: -opts.amount,
    type: opts.type,
    reason: opts.reason ?? null,
    refType: opts.refType ?? null,
    refId: opts.refId ?? null,
    idempotencyKey: opts.idempotencyKey ?? null,
    metadata: opts.metadata ?? null,
  });
}

/** Refund credits (failed/timed-out generation or edit). Idempotent. */
export async function refundVideoCredits(opts: {
  portalUserId: number;
  amount: number;
  reason?: string;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<ApplyVideoCreditDeltaResult> {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new Error("refundVideoCredits: amount must be a positive number");
  }
  const result = await applyVideoCreditDelta({
    portalUserId: opts.portalUserId,
    delta: opts.amount,
    type: VIDEO_CREDIT_TX_TYPES.REFUND,
    reason: opts.reason ?? "refund",
    refType: opts.refType ?? null,
    refId: opts.refId ?? null,
    idempotencyKey: opts.idempotencyKey ?? null,
    metadata: opts.metadata ?? null,
  });
  if (result.applied) {
    logger.info(
      {
        portalUserId: opts.portalUserId,
        amount: opts.amount,
        refType: opts.refType,
        refId: opts.refId,
        balance: result.balance,
      },
      "[video-credits] refund",
    );
  }
  return result;
}

/**
 * Claw back credits from a refunded credit-pack purchase. Idempotent on the
 * PI id (keyed by idempotencyKey `revoke:pi:<id>`). Only revokes what is still
 * in the wallet - never drives the balance negative if the buyer already spent
 * some of the purchased credits.
 */
export async function revokeVideoCreditsForPaymentIntent(
  paymentIntentId: string,
): Promise<{ qtyRevoked: number; qtyPurchased: number }> {
  // Locate the original purchase ledger row for this PI.
  const [purchase] = await db
    .select({
      amount: videoCreditTransactionsTable.amount,
      amountSubunits: videoCreditTransactionsTable.amountSubunits,
    })
    .from(videoCreditTransactionsTable)
    .where(
      and(
        eq(videoCreditTransactionsTable.stripePaymentIntentId, paymentIntentId),
        eq(videoCreditTransactionsTable.type, VIDEO_CREDIT_TX_TYPES.PURCHASE),
      ),
    )
    .limit(1);
  if (!purchase) {
    return { qtyRevoked: 0, qtyPurchased: 0 };
  }
  const purchasedSubunits =
    purchase.amountSubunits != null
      ? Number(purchase.amountSubunits)
      : Number(purchase.amount) * SUBUNITS_PER_CREDIT;
  const qtyPurchased = subunitsToCredits(purchasedSubunits);
  const [walletRow] = await db
    .select({
      portalUserId: videoCreditsTable.portalUserId,
      balance: videoCreditsTable.balance,
      balanceSubunits: videoCreditsTable.balanceSubunits,
    })
    .from(videoCreditTransactionsTable)
    .innerJoin(
      videoCreditsTable,
      eq(videoCreditsTable.portalUserId, videoCreditTransactionsTable.portalUserId),
    )
    .where(eq(videoCreditTransactionsTable.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  if (!walletRow) {
    return { qtyRevoked: 0, qtyPurchased };
  }
  const balanceSubunits = effectiveBalanceSubunits(walletRow);
  const subunitsToRevoke = Math.max(0, Math.min(purchasedSubunits, balanceSubunits));
  if (subunitsToRevoke <= 0) {
    return { qtyRevoked: 0, qtyPurchased };
  }
  const result = await applyVideoCreditDelta({
    portalUserId: walletRow.portalUserId,
    delta: -subunitsToCredits(subunitsToRevoke),
    type: VIDEO_CREDIT_TX_TYPES.REFUND,
    reason: "credit pack refund clawback",
    refType: "stripe_pi_refund",
    refId: paymentIntentId,
    idempotencyKey: `revoke:pi:${paymentIntentId}`,
  });
  return {
    qtyRevoked: result.applied ? subunitsToCredits(subunitsToRevoke) : 0,
    qtyPurchased,
  };
}

/** Admin manual adjustment (positive or negative). */
export async function adminAdjustVideoCredits(opts: {
  portalUserId: number;
  delta: number;
  reason: string;
  adminEmail?: string | null;
}): Promise<ApplyVideoCreditDeltaResult> {
  if (!Number.isInteger(opts.delta) || opts.delta === 0) {
    throw new Error("adminAdjustVideoCredits: delta must be a non-zero integer");
  }
  const result = await applyVideoCreditDelta({
    portalUserId: opts.portalUserId,
    delta: opts.delta,
    type: VIDEO_CREDIT_TX_TYPES.ADMIN_ADJUST,
    reason: opts.reason,
    refType: "admin",
    refId: opts.adminEmail ?? null,
    metadata: opts.adminEmail ? { adminEmail: opts.adminEmail } : null,
  });
  logger.info(
    {
      portalUserId: opts.portalUserId,
      delta: opts.delta,
      reason: opts.reason,
      adminEmail: opts.adminEmail,
      balance: result.balance,
    },
    "[video-credits] admin adjust",
  );
  return result;
}

export async function listVideoCreditTransactions(
  portalUserId: number,
  limit = 50,
): Promise<VideoCreditTransaction[]> {
  assertPortalUserId(portalUserId);
  return db
    .select()
    .from(videoCreditTransactionsTable)
    .where(eq(videoCreditTransactionsTable.portalUserId, portalUserId))
    .orderBy(desc(videoCreditTransactionsTable.createdAt))
    .limit(Math.min(Math.max(1, limit), 200));
}

function assertPortalUserId(portalUserId: number): void {
  if (!Number.isInteger(portalUserId) || portalUserId <= 0) {
    throw new Error("video-credits: invalid portalUserId");
  }
}

async function noopResult(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  portalUserId: number,
): Promise<ApplyVideoCreditDeltaResult> {
  const [row] = await tx
    .select({
      balance: videoCreditsTable.balance,
      balanceSubunits: videoCreditsTable.balanceSubunits,
    })
    .from(videoCreditsTable)
    .where(eq(videoCreditsTable.portalUserId, portalUserId))
    .limit(1);
  return {
    applied: false,
    alreadyApplied: true,
    balance: subunitsToCredits(effectiveBalanceSubunits(row)),
    delta: 0,
  };
}
