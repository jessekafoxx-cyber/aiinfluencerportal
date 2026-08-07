import { db, ordersTable, portalUsersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  PRODUCTS,
  type PaidFieldName,
  type ProductDef,
} from "../productCatalog";
import { getBrandBaseUrl } from "../lib/brand-url";

// Customer-facing portal URL injected into the model prompt below.
const PORTAL_URL = `${getBrandBaseUrl()}/members`;

export type PurchaseSummary = {
  product: string;
  amountCents: number;
  date: string;
  recurring: boolean;
};

// One catalog entry per paid flag. Where several slugs share a flag
// (upsell3/downsell3/platinum_club -> platinumPaid via upsell3Paid,
// upsell1/downsell1 etc), prefer the canonical entry so the customer
// sees a sensible label and price.
const PAID_FIELD_PRODUCT: Record<PaidFieldName, ProductDef> = {
  mainProductPaid: PRODUCTS.main,
  bump2Paid: PRODUCTS.bump2,
  bump3Paid: PRODUCTS.bump3,
  upsell1Paid: PRODUCTS.upsell1,
  upsell2Paid: PRODUCTS.upsell2,
  upsell3Paid: PRODUCTS.upsell3,
  downsell1Paid: PRODUCTS.downsell1,
  platinumPaid: PRODUCTS.platinum_club,
  doneForYouPackPaid: PRODUCTS.upsell1,
  portfolioPaid: PRODUCTS.portfolio,
};

function formatDate(d: Date | string | null | undefined): string {
  const date = d instanceof Date ? d : d ? new Date(d) : new Date();
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Look up everything a customer email has paid for, based on the orders
 * table paid flags. Deduped across order rows by paid flag.
 */
export async function lookupPurchases(
  email: string,
): Promise<PurchaseSummary[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const rows = await db
    .select()
    .from(ordersTable)
    .where(sql`lower(${ordersTable.email}) = ${normalized}`);

  const seen = new Set<PaidFieldName>();
  const purchases: PurchaseSummary[] = [];

  for (const row of rows) {
    for (const field of Object.keys(PAID_FIELD_PRODUCT) as PaidFieldName[]) {
      if (seen.has(field)) continue;
      if ((row as Record<string, unknown>)[field] !== true) continue;
      seen.add(field);
      const def = PAID_FIELD_PRODUCT[field];
      purchases.push({
        product: def.label,
        amountCents: def.priceCents,
        date: formatDate(row.createdAt),
        recurring: def.recurring !== false,
      });
    }
  }

  return purchases;
}

export type AccountStatus = {
  purchases: PurchaseSummary[];
  portalAccountExists: boolean;
  hasLoggedIn: boolean;
};

/**
 * Full account picture for the support bot: what they paid for, and
 * whether a portal account already exists / has been signed into.
 */
export async function lookupAccountStatus(
  email: string,
): Promise<AccountStatus> {
  const normalized = email.trim().toLowerCase();
  const [purchases, portalRows] = await Promise.all([
    lookupPurchases(normalized),
    db
      .select({
        clerkId: portalUsersTable.clerkId,
      })
      .from(portalUsersTable)
      .where(sql`lower(${portalUsersTable.email}) = ${normalized}`),
  ]);
  return {
    purchases,
    portalAccountExists: portalRows.length > 0,
    hasLoggedIn: portalRows.some((r) => !!r.clerkId),
  };
}

export function formatAccountStatusForPrompt(
  email: string,
  status: AccountStatus,
): string {
  const { purchases, portalAccountExists, hasLoggedIn } = status;
  const lines =
    purchases.length > 0
      ? purchases
          .map((p) => {
            const dollars = (p.amountCents / 100).toFixed(2);
            const suffix = p.recurring ? "/month subscription" : "";
            return `- ${p.product}: $${dollars}${suffix} on ${p.date}`;
          })
          .join("\n")
      : "No purchases found for this email.";
  const account = portalAccountExists
    ? hasLoggedIn
      ? "Portal account: EXISTS and they have logged in before."
      : "Portal account: EXISTS but they have never logged in yet."
    : `Portal account: none yet (it gets created the first time they sign in at ${PORTAL_URL} with this email).`;
  return (
    `\n\n[INTERNAL - LIVE ACCOUNT CHECK FOR ${email} (you have ALREADY checked the backend, this is the real data, answer from it directly and definitively):\n` +
    `Purchases:\n${lines}\n${account}\n` +
    `How to guide them:\n` +
    `- If purchases exist: tell them exactly what they bought, then get them into ${PORTAL_URL} signing in with ${email}.\n` +
    `- If they have never logged in: they need to sign UP / create their account at ${PORTAL_URL} using ${email}, that links everything automatically.\n` +
    `- If they have logged in before but are stuck now: have them use the Forgot Password option on ${PORTAL_URL} to reset, and make sure they use ${email} exactly.\n` +
    `- If no purchases found: say so plainly and ask if they might have used a different email at checkout.\n` +
    `- If they say it STILL does not work after these steps: do not loop, offer to send the conversation to the team (the chat shows them an escalation box as soon as you use the words "over to the team").\n` +
    `NEVER ask for this email again, you already have it. NEVER say you will check later, hang tight, or get back to them. You cannot do anything outside this chat.]`
  );
}
