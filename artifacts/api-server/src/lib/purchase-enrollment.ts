import { clerkClient } from "./auth-compat";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, emailLogsTable, portalUsersTable } from "@workspace/db";
import { sendEmail, type EmailBrand } from "./email";
import { logger } from "./logger";
import {
  newAccountBodyHtml,
  existingAccountBodyHtml,
} from "./purchase-enrollment-emails";
import {
  buildPurchaseSignUpUrl,
  buildPurchaseSignInUrl,
  brandLabel,
  type PurchasePortalKey,
} from "./purchase-enrollment-urls";

export { newAccountBodyHtml, existingAccountBodyHtml } from "./purchase-enrollment-emails";
export {
  buildPurchaseSignUpUrl,
  buildPurchaseSignInUrl,
} from "./purchase-enrollment-urls";
export type { PurchasePortalKey } from "./purchase-enrollment-urls";

// Triggered the moment a Whop main-product payment is confirmed. Creates a
// Clerk invitation so the buyer can pick a password during sign-up, then
// sends a branded "Your account is ready" email with a CTA button. If the
// buyer already has a Clerk account (a returning customer), we skip the
// invitation and send a "training unlocked" email pointing at the right
// portal sign-in page instead.
//
// Idempotency: keep one successful email per orderId. Failed attempts must
// remain retryable when a webhook is replayed after the sender is repaired.
//
// Every enrollment email now renders as Room30 AI and lands buyers on
// https://room30.ai/members/sign-up|sign-in (Task #661). The legacy
// `"main"` portal value still exists in portal_users for historical
// reasons but no longer selects an Apex sign-up page or brand shell.

type EnrollResult =
  | { status: "skipped"; reason: string }
  | { status: "sent"; mode: "new_account" | "existing_account" }
  | {
      status: "failed";
      mode: "new_account" | "existing_account";
      error: string;
    };

function portalToBrand(_portalKey: PurchasePortalKey): EmailBrand {
  // Every portal renders as Room30 AI (Task #661). The Apex Offers
  // product was retired in Task #491; legacy `"main"` rows still exist
  // in the DB but no longer select an Apex-branded email shell.
  return "room30";
}

async function alreadyEnrolledForOrder(email: string, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.email, email),
        eq(emailLogsTable.status, "sent"),
        inArray(emailLogsTable.templateType, [
          "purchase_account_created",
          "purchase_account_existing",
        ]),
        sql`${emailLogsTable.metadata}->>'orderId' = ${orderId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// A "returning customer" is one who has already signed in at least once:
// their portal_users row carries a bound auth identity (clerk_id column,
// which now stores the Replit Auth user id). Shell rows created at
// purchase time have clerk_id IS NULL and do not count.
async function authAccountExistsForEmail(email: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: portalUsersTable.id })
      .from(portalUsersTable)
      .where(
        and(
          sql`lower(${portalUsersTable.email}) = ${email}`,
          sql`${portalUsersTable.clerkId} IS NOT NULL`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err, email }, "[enroll] account lookup failed; assuming new user");
    return false;
  }
}

export async function enrollPurchaserAndSendEmail(opts: {
  email: string;
  orderId: string;
  // Defaults to "room30". The `"main"` legacy value is still accepted
  // by the type for back-compat with external-admin-API callers that
  // grant against historical course-portal users, but it no longer
  // selects a different brand wrapper or sign-up URL (Task #661).
  portalKey?: PurchasePortalKey;
  // Optional metadata to merge into the email_logs row. Used by the
  // Task #460 re-send script to mark replayed sends so they can be
  // distinguished from the original (broken) batch.
  extraMetadata?: Record<string, unknown>;
  // Bypass the per-(email, orderId) `email_logs` dedupe. Reserved for
  // controlled replay flows like the Task #460 resend script which
  // already gates duplicates on its own audit marker
  // (`metadata.replacedByTask460`). Do NOT set from webhook handlers.
  forceResend?: boolean;
}): Promise<EnrollResult> {
  const email = opts.email.trim().toLowerCase();
  const orderId = opts.orderId;
  const portalKey: PurchasePortalKey = opts.portalKey ?? "room30";
  const brand = portalToBrand(portalKey);
  const label = brandLabel(portalKey);

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { status: "skipped", reason: "invalid_email" };
  }

  if (!opts.forceResend && (await alreadyEnrolledForOrder(email, orderId))) {
    return { status: "skipped", reason: "already_sent" };
  }

  // Returning customer: do not create a new invitation, just confirm the
  // unlock and point them at the right portal's sign-in page.
  if (await authAccountExistsForEmail(email)) {
    const signInUrl = buildPurchaseSignInUrl(portalKey);
    const plainBody = `Thanks for the purchase. Your new training is unlocked under the same ${label} account you already use.\n\nOpen the portal:\n${signInUrl}\n\nSee you inside.\nThe ${label} team`;
    const existingSend = await sendEmail({
      email,
      subject: `Your ${label} training is unlocked`,
      body: plainBody,
      bodyHtml: existingAccountBodyHtml(signInUrl, label),
      templateType: "purchase_account_existing",
      brand,
      metadata: { orderId, signInUrl, portalKey, ...(opts.extraMetadata ?? {}) },
    });
    if (existingSend.status === "failed") {
      return {
        status: "failed",
        mode: "existing_account",
        error: existingSend.error || "Email provider rejected the message.",
      };
    }
    await activatePortalUserByEmail(email);
    return { status: "sent", mode: "existing_account" };
  }

  // New customer: point them at the portal sign-up URL. Signing in with
  // the same email they bought with automatically claims their purchase
  // (shell-row claim in requireAuth), so no invitation ticket is needed.
  const ctaUrl = buildPurchaseSignUpUrl(portalKey);
  const plainBody = `Thanks for joining ${label}. Your training is unlocked.\n\nSign in using ${email} and step inside:\n${ctaUrl}\n\nIf you already have a ${label} account, log in with the same email and your new training will appear automatically.\n\nSee you inside.\nThe ${label} team`;

  const newSend = await sendEmail({
    email,
    subject: `Your ${label} account is ready`,
    body: plainBody,
    bodyHtml: newAccountBodyHtml(email, ctaUrl, label),
    templateType: "purchase_account_created",
    brand,
    metadata: {
      orderId,
      ctaUrl,
      portalKey,
      ...(opts.extraMetadata ?? {}),
    },
  });
  if (newSend.status === "failed") {
    return {
      status: "failed",
      mode: "new_account",
      error: newSend.error || "Email provider rejected the message.",
    };
  }

  await activatePortalUserByEmail(email);
  return { status: "sent", mode: "new_account" };
}

// Heal `portal_users.is_active = false` rows for buyers we just
// confirmed have paid (we are sending them a welcome / account-ready
// email = they own a product). The schema defaults `is_active` to
// false and some upstream paths (e.g. the GHL webhook before Task
// #745, plus legacy invitation flows) created rows in that state,
// which then 403-locked the buyer at `requireActive` even though
// they had a valid Clerk identity and verified payment. This is
// idempotent: rows that are already active are untouched, and a row
// missing entirely is left alone (the create-on-signin path in
// requireAuth handles that case explicitly).
async function activatePortalUserByEmail(email: string): Promise<void> {
  try {
    await db
      .update(portalUsersTable)
      .set({ isActive: true })
      .where(
        and(
          sql`lower(${portalUsersTable.email}) = ${email}`,
          eq(portalUsersTable.isActive, false),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, email },
      "[enroll] failed to flip portal_users.is_active during enrollment send",
    );
  }
}
