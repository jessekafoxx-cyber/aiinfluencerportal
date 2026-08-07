// Runtime sender for portal sidebar add-on purchase receipt emails
// (Tasks #814, #816).
//
// Idempotency: at most one receipt per (email, templateType, orderId).
// The email_logs row written by `sendEmail` carries metadata.orderId, so
// the webhook-vs-redirect (finalize) race and any webhook re-delivery all
// short-circuit on the same dedupe check and never double-send. This
// mirrors the established `alreadyEnrolledForOrder` pattern in
// `purchase-enrollment.ts`.
//
// Each public add-on slug maps to its own config (product name, CTA, and
// a distinct templateType). Slugs that unlock the SAME product on the
// SAME paid column share a templateType so a single purchase that can be
// reached via two slugs (hook library, TikTok bundle) never sends two
// receipts.
//
// Callers fire this fire-and-forget (`void sendPortalAddonReceiptEmail(...)`)
// AFTER the paid_* flip has already been committed, so a Resend outage or
// any send failure can never reverse the access grant.

import { and, eq, sql } from "drizzle-orm";
import { db, emailLogsTable } from "@workspace/db";
import { sendEmail } from "./email";
import { logger } from "./logger";
import { getBrandBaseUrl } from "./brand-url";
import {
  portalAddonReceiptBodyHtml,
  influencerCreditReceiptBodyHtml,
} from "./portal-addon-receipt-emails";

interface PortalAddonReceiptConfig {
  /** Dedupe key namespace; shared across slugs that unlock the same product. */
  templateType: string;
  /** Human-facing product name shown in the receipt body + line item. */
  productName: string;
  /** Email subject line. */
  subject: string;
  /** Path under the brand origin the CTA button links to. */
  ctaPath: string;
  /** CTA button label. */
  ctaLabel: string;
  /** Recurring memberships render "$X / month" and membership copy. */
  recurring?: boolean;
}

// Keyed by PUBLIC sidebar slug (the value stamped into PI/subscription
// metadata.productSlug and posted by the charge-saved endpoint). The
// existing Done-For-You Pack templateType is preserved (`dfy_pack_receipt`)
// so receipts already sent under Task #814 still dedupe correctly.
const RECEIPT_CONFIG: Record<string, PortalAddonReceiptConfig> = {
  "done-for-you-pack": {
    templateType: "dfy_pack_receipt",
    productName: "Done-For-You Pack",
    subject: "Your Done-For-You Pack receipt",
    ctaPath: "/members/done-for-you-pack",
    ctaLabel: "Open Your Done-For-You Pack",
  },
  // Hook Library: order-bump-2 and hook-demo-library both flip bump2Paid
  // for the identical product, so they share one templateType.
  "hook-demo-library": {
    templateType: "portal_addon_receipt_hook_library",
    productName: "2,000 Hook Library",
    subject: "Your 2,000 Hook Library receipt",
    ctaPath: "/members/hook-demo-library",
    ctaLabel: "Open Your Hook Library",
  },
  "order-bump-2": {
    templateType: "portal_addon_receipt_hook_library",
    productName: "2,000 Hook Library",
    subject: "Your 2,000 Hook Library receipt",
    ctaPath: "/members/hook-demo-library",
    ctaLabel: "Open Your Hook Library",
  },
  "our-portfolio": {
    templateType: "portal_addon_receipt_portfolio",
    productName: "Our Portfolio",
    subject: "Your Our Portfolio receipt",
    ctaPath: "/members/our-portfolio",
    ctaLabel: "Open Our Portfolio",
  },
  // TikTok bundle: order-bump-3 and tiktok-slideshow-masterclass are a
  // single $37 unlock (both flip bump3Paid), so they share one
  // templateType to avoid two receipts for one purchase.
  "tiktok-slideshow-masterclass": {
    templateType: "portal_addon_receipt_tiktok_bundle",
    productName: "TikTok Slideshow + IG Follower Hijack Masterclass",
    subject: "Your TikTok Slideshow + IG Follower Hijack receipt",
    ctaPath: "/members/tiktok-slideshow-masterclass",
    ctaLabel: "Open Your Masterclass",
  },
  "order-bump-3": {
    templateType: "portal_addon_receipt_tiktok_bundle",
    productName: "TikTok Slideshow + IG Follower Hijack Masterclass",
    subject: "Your TikTok Slideshow + IG Follower Hijack receipt",
    ctaPath: "/members/tiktok-slideshow-masterclass",
    ctaLabel: "Open Your Masterclass",
  },
  "platinum-club": {
    templateType: "portal_addon_receipt_platinum",
    productName: "Platinum Club",
    subject: "Your Platinum Club receipt",
    ctaPath: "/members/platinum-club",
    ctaLabel: "Open Platinum Club",
    recurring: true,
  },
};

export function getPortalAddonReceiptConfig(
  publicSlug: string | null | undefined,
): PortalAddonReceiptConfig | null {
  if (!publicSlug) return null;
  return RECEIPT_CONFIG[publicSlug] ?? null;
}

async function alreadySentReceipt(
  email: string,
  templateType: string,
  orderId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.email, email),
        eq(emailLogsTable.templateType, templateType),
        sql`${emailLogsTable.metadata}->>'orderId' = ${orderId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type PortalAddonReceiptResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function sendPortalAddonReceiptEmail(opts: {
  publicSlug: string;
  orderId: string;
  email: string;
  amountCents: number;
  userId?: number | null;
}): Promise<PortalAddonReceiptResult> {
  const config = getPortalAddonReceiptConfig(opts.publicSlug);
  if (!config) {
    return { status: "skipped", reason: "no_receipt_config_for_slug" };
  }

  const email = (opts.email || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { status: "skipped", reason: "invalid_email" };
  }

  try {
    if (await alreadySentReceipt(email, config.templateType, opts.orderId)) {
      return { status: "skipped", reason: "already_sent" };
    }
  } catch (e) {
    // A dedupe-check failure must not block the receipt; the worst case
    // is a rare duplicate, never a missing receipt.
    logger.warn(
      { err: e instanceof Error ? e.message : String(e), orderId: opts.orderId, slug: opts.publicSlug },
      "[portal-addon-receipt] dedupe lookup failed; proceeding to send",
    );
  }

  const ctaUrl = `${getBrandBaseUrl()}${config.ctaPath}`;
  const baseAmount = `$${(opts.amountCents / 100).toFixed(2)}`;
  const amountLabel = config.recurring ? `${baseAmount} / month` : baseAmount;
  const introLine = config.recurring
    ? `Thanks for joining. Your ${config.productName} membership is active and ready inside your account.`
    : `Thanks for your purchase. Your ${config.productName} is unlocked and ready inside your account.`;
  const signoff = config.recurring ? "Welcome to the club." : "Enjoy it.";
  const plainBody = `${introLine}\n\n${config.productName}: ${amountLabel}\n\n${config.ctaLabel}:\n${ctaUrl}\n\nQuestions about your order? Just reply to this email and we will help you out.\n\n${signoff}\nThe AI Influencer Portfolio team`;

  const result = await sendEmail({
    userId: opts.userId ?? null,
    email,
    subject: config.subject,
    body: plainBody,
    bodyHtml: portalAddonReceiptBodyHtml({
      productName: config.productName,
      amountCents: opts.amountCents,
      ctaUrl,
      ctaLabel: config.ctaLabel,
      recurring: config.recurring,
    }),
    templateType: config.templateType,
    brand: "room30",
    metadata: {
      orderId: opts.orderId,
      amountCents: opts.amountCents,
      publicSlug: opts.publicSlug,
    },
  });

  if (result.status === "failed") {
    return { status: "failed", error: result.error || "Email provider rejected the message." };
  }
  return { status: "sent" };
}

// ===========================================================================
// Influencer Generation credit top-up receipts (Task #818).
//
// Unlike the six sidebar add-ons above, this purchase does NOT flip an
// orders.* column, so there is no orderId to dedupe on. Instead we dedupe
// on the Stripe paymentIntentId - the same key the influencer_credit_purchases
// ledger is UNIQUE on - so the charge-saved (direct), finalize endpoint, and
// webhook grant paths all short-circuit on the same email_logs row and never
// double-send. Callers fire this fire-and-forget AFTER the credit grant is
// committed, so a Resend outage can never reverse the grant.
// ===========================================================================

const INFLUENCER_CREDIT_RECEIPT_TEMPLATE = "influencer_credits_receipt";

async function alreadySentInfluencerReceipt(
  email: string,
  paymentIntentId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.email, email),
        eq(emailLogsTable.templateType, INFLUENCER_CREDIT_RECEIPT_TEMPLATE),
        sql`${emailLogsTable.metadata}->>'paymentIntentId' = ${paymentIntentId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function sendInfluencerCreditReceiptEmail(opts: {
  paymentIntentId: string;
  email: string;
  qty: number;
  amountCents: number;
  newQuota?: number | null;
  userId?: number | null;
}): Promise<PortalAddonReceiptResult> {
  const email = (opts.email || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { status: "skipped", reason: "invalid_email" };
  }
  if (typeof opts.paymentIntentId !== "string" || !opts.paymentIntentId.startsWith("pi_")) {
    return { status: "skipped", reason: "invalid_payment_intent_id" };
  }
  if (!Number.isFinite(opts.qty) || opts.qty <= 0) {
    return { status: "skipped", reason: "invalid_qty" };
  }

  try {
    if (await alreadySentInfluencerReceipt(email, opts.paymentIntentId)) {
      return { status: "skipped", reason: "already_sent" };
    }
  } catch (e) {
    // A dedupe-check failure must not block the receipt; the worst case
    // is a rare duplicate, never a missing receipt.
    logger.warn(
      {
        err: e instanceof Error ? e.message : String(e),
        paymentIntentId: opts.paymentIntentId,
      },
      "[influencer-credit-receipt] dedupe lookup failed; proceeding to send",
    );
  }

  const ctaPath = "/members/your-influencers";
  const ctaLabel = "Open Your Influencers";
  const ctaUrl = `${getBrandBaseUrl()}${ctaPath}`;
  const total = `$${(opts.amountCents / 100).toFixed(2)}`;
  const creditsLabel = `${opts.qty} Influencer Generation${opts.qty === 1 ? "" : "s"}`;
  const newQuota = typeof opts.newQuota === "number" ? opts.newQuota : null;
  const balanceLine =
    newQuota !== null
      ? `\nNew balance: ${newQuota} generation${newQuota === 1 ? "" : "s"}`
      : "";
  const plainBody = `Thanks for your purchase. Your ${creditsLabel} have been added to your account and are ready to use.\n\n${creditsLabel}: ${total}${balanceLine}\n\n${ctaLabel}:\n${ctaUrl}\n\nQuestions about your order? Just reply to this email and we will help you out.\n\nEnjoy it.\nThe AI Influencer Portfolio team`;

  const result = await sendEmail({
    userId: opts.userId ?? null,
    email,
    subject: "Your Influencer Generations receipt",
    body: plainBody,
    bodyHtml: influencerCreditReceiptBodyHtml({
      qty: opts.qty,
      amountCents: opts.amountCents,
      newQuota,
      ctaUrl,
      ctaLabel,
    }),
    templateType: INFLUENCER_CREDIT_RECEIPT_TEMPLATE,
    brand: "room30",
    metadata: {
      paymentIntentId: opts.paymentIntentId,
      qty: opts.qty,
      amountCents: opts.amountCents,
      newQuota,
    },
  });

  if (result.status === "failed") {
    return { status: "failed", error: result.error || "Email provider rejected the message." };
  }
  return { status: "sent" };
}
