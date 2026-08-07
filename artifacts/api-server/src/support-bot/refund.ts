// Support-bot self-serve refunds. Policy: the $27 main masterclass is
// the ONLY product the bot may refund. Everything else (bumps, upsells,
// DFY, Platinum, high-ticket) is non-refundable per T&Cs agreed at
// checkout and must be denied in-conversation.
//
// Safety model:
// - Only orders paid via Stripe with a persisted PaymentIntent qualify
//   (paymentSourceType = stripe_verified_payment). Whop/GHL/admin-grant
//   rows go to the team.
// - If the same PaymentIntent also covers order bumps, we DO NOT
//   auto-refund: the charge.refunded webhook revokes every cart slug on
//   the PI (see handleChargeReversal in stripeWebhookHandlers.ts), so a
//   partial main-only refund would wrongly strip paid bump access.
//   Those cases are handed over to the team via the in-chat escalation.
// - Full refund of the PI (main-only carts, so PI amount == main line).
// - Idempotency key per order + a pre-check of charge.amount_refunded
//   make replays safe. Entitlement revocation, CRM mirror, and
//   downstream cleanup all ride the existing charge.refunded
//   webhook path - nothing extra to do here.

import { db, ordersTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

export type RefundEligibility =
  | { status: "no_purchase" }
  | { status: "not_stripe" }
  | { status: "has_addons" }
  | {
      status: "eligible";
      orderId: string;
      paymentIntentId: string;
      amountCents: number;
    };

export type RefundResult =
  | { status: "refunded"; orderId: string; amountCents: number }
  | { status: "already_refunded" }
  | { status: "no_purchase" }
  | { status: "not_stripe" }
  | { status: "has_addons" }
  | { status: "error" };

const MAIN_FALLBACK_CENTS = 2700;

export async function getRefundEligibility(
  email: string,
): Promise<RefundEligibility> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { status: "no_purchase" };

  const rows = await db
    .select({
      id: ordersTable.id,
      stripePaymentIntentId: ordersTable.stripePaymentIntentId,
      paymentSourceType: ordersTable.paymentSourceType,
      mainProductPaid: ordersTable.mainProductPaid,
      bump1Paid: ordersTable.bump1Paid,
      bump2Paid: ordersTable.bump2Paid,
      bump3Paid: ordersTable.bump3Paid,
      effectiveMainAmountCents: ordersTable.effectiveMainAmountCents,
      totalAmount: ordersTable.totalAmount,
    })
    .from(ordersTable)
    .where(
      sql`lower(${ordersTable.email}) = ${normalized} AND ${ordersTable.mainProductPaid} = true`,
    )
    .orderBy(desc(ordersTable.createdAt));

  if (rows.length === 0) return { status: "no_purchase" };

  const stripeRow = rows.find(
    (r) =>
      r.paymentSourceType === "stripe_verified_payment" &&
      !!r.stripePaymentIntentId,
  );
  if (!stripeRow) return { status: "not_stripe" };

  if (stripeRow.bump1Paid || stripeRow.bump2Paid || stripeRow.bump3Paid) {
    return { status: "has_addons" };
  }

  const amountCents =
    stripeRow.effectiveMainAmountCents ??
    stripeRow.totalAmount ??
    MAIN_FALLBACK_CENTS;

  return {
    status: "eligible",
    orderId: stripeRow.id,
    paymentIntentId: stripeRow.stripePaymentIntentId!,
    amountCents: amountCents > 0 ? amountCents : MAIN_FALLBACK_CENTS,
  };
}

/**
 * Automated self-serve refunds are retired with the legacy Stripe
 * integration. The bot can no longer issue a refund directly; it routes
 * the customer to the team for manual processing. We return "not_stripe"
 * (the same result the prompt maps to "pass this over to the team and they
 * will process it manually") for any otherwise-eligible order so the bot
 * never claims a refund was issued.
 */
export async function issueMainMasterclassRefund(opts: {
  email: string;
  sessionId: string;
}): Promise<RefundResult> {
  const eligibility = await getRefundEligibility(opts.email);
  if (eligibility.status !== "eligible") return eligibility;
  logger.warn(
    { orderId: eligibility.orderId, sessionId: opts.sessionId },
    "[support-bot] refund requested but automated refunds are retired; routing to manual team",
  );
  return { status: "not_stripe" };
}

/**
 * Internal prompt context so the model knows, before the save attempt,
 * whether this customer even has a bot-refundable order.
 */
export function formatRefundContextForPrompt(
  email: string,
  eligibility: RefundEligibility,
  alreadyIssuedAt: string | undefined,
): string {
  let stateLine: string;
  if (alreadyIssuedAt) {
    stateLine =
      "A refund was ALREADY issued in this conversation. Do not call issue_refund again. If asked, refunds take 5-10 working days to land.";
  } else {
    switch (eligibility.status) {
      case "eligible":
        stateLine = `They have a refundable $${(eligibility.amountCents / 100).toFixed(2)} masterclass order paid by card. If they confirm they still want the refund after your save attempt, call the issue_refund tool with confirm=true.`;
        break;
      case "has_addons":
        stateLine =
          "Their masterclass order has add-ons attached, so you CANNOT refund it automatically. If they confirm they want the refund, tell them you are passing it over to the team and they will process it manually.";
        break;
      case "not_stripe":
        stateLine =
          "Their masterclass purchase was not a standard card order, so you CANNOT refund it automatically. If they confirm they want the refund, tell them you are passing it over to the team and they will process it manually.";
        break;
      case "no_purchase":
        stateLine =
          "No masterclass purchase exists under this email. Do NOT call issue_refund. Ask if they used a different email at checkout.";
        break;
    }
  }
  return (
    `\n\n[INTERNAL - REFUND CHECK FOR ${email}: ${stateLine}\n` +
    `Reminder: ONLY the $27 masterclass is ever refundable. Upgrades, bumps, DFY, Platinum, and high-ticket purchases are non-refundable per the terms agreed at checkout - deny those politely and never call issue_refund for them. Never tell the customer a refund is done unless the tool ran in this conversation.]`
  );
}
