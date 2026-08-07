// Runtime sender for high-ticket coaching-agreement purchase receipt emails
// (Task #819). Covers the flows that run through the coaching-agreement
// Stripe path: DFY $15k, DFY AI Influencer ($2,997 + Gold/Diamond/Gold
// Special tiers), Portugal Gold/VIP, and the generic coaching catch-all.
//
// Idempotency: at most one receipt per (email, templateType, agreementId).
// The email_logs row written by `sendEmail` carries metadata.agreementId,
// so the finalize-endpoint vs Stripe/Whop webhook race and any webhook
// re-delivery all short-circuit on the same dedupe check and never
// double-send. This mirrors `sendPortalAddonReceiptEmail`.
//
// Callers fire this fire-and-forget AFTER the agreement has been claimed
// (status flipped to active + portal access granted), so a Resend outage
// or any send failure can never reverse the entitlement.

import { and, eq, sql } from "drizzle-orm";
import { db, emailLogsTable } from "@workspace/db";
import { sendEmail } from "./email";
import { logger } from "./logger";
import { portalAddonReceiptBodyHtml } from "./portal-addon-receipt-emails";

const TEMPLATE_TYPE = "coaching_receipt";

async function alreadySentReceipt(
  email: string,
  agreementId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.email, email),
        eq(emailLogsTable.templateType, TEMPLATE_TYPE),
        sql`${emailLogsTable.metadata}->>'agreementId' = ${String(agreementId)}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type CoachingReceiptResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function sendCoachingReceiptEmail(opts: {
  agreementId: number;
  email: string;
  productName: string;
  amountCents: number;
  ctaUrl: string;
  ctaLabel: string;
  userId?: number | null;
  // Override the default Room30 AI sender / reply-to. Used by the AI
  // Influencer rental receipts so they send from the verified dfy.room30.ai
  // domain with replies routed to the Done For You inbox.
  from?: string;
  replyTo?: string;
  // Override the rendered card body. When set, this replaces the default
  // portal-addon receipt layout (whose "ready inside your account" copy does
  // not fit a rental that has not been set up yet).
  bodyHtml?: string;
}): Promise<CoachingReceiptResult> {
  const email = (opts.email || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { status: "skipped", reason: "invalid_email" };
  }

  // A $0 claim (free promo / comped agreement) has nothing to receipt.
  if (!Number.isFinite(opts.amountCents) || opts.amountCents <= 0) {
    return { status: "skipped", reason: "no_amount" };
  }

  try {
    if (await alreadySentReceipt(email, opts.agreementId)) {
      return { status: "skipped", reason: "already_sent" };
    }
  } catch (e) {
    // A dedupe-check failure must not block the receipt; the worst case
    // is a rare duplicate, never a missing receipt.
    logger.warn(
      { err: e instanceof Error ? e.message : String(e), agreementId: opts.agreementId },
      "[coaching-receipt] dedupe lookup failed; proceeding to send",
    );
  }

  const amountLabel = `$${(opts.amountCents / 100).toFixed(2)}`;
  const plainBody = `Thanks for your purchase. Your ${opts.productName} is confirmed and your payment has cleared.\n\n${opts.productName}: ${amountLabel}\n\n${opts.ctaLabel}:\n${opts.ctaUrl}\n\nQuestions about your order? Just reply to this email and we will help you out.\n\nEnjoy it.\nThe AI Influencer Portfolio team`;

  const result = await sendEmail({
    userId: opts.userId ?? null,
    email,
    subject: `Your ${opts.productName} receipt`,
    body: plainBody,
    bodyHtml:
      opts.bodyHtml ??
      portalAddonReceiptBodyHtml({
        productName: opts.productName,
        amountCents: opts.amountCents,
        ctaUrl: opts.ctaUrl,
        ctaLabel: opts.ctaLabel,
      }),
    templateType: TEMPLATE_TYPE,
    brand: "room30",
    ...(opts.from ? { from: opts.from } : {}),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    metadata: {
      agreementId: opts.agreementId,
      amountCents: opts.amountCents,
      productName: opts.productName,
    },
  });

  if (result.status === "failed") {
    return { status: "failed", error: result.error || "Email provider rejected the message." };
  }
  return { status: "sent" };
}
