/**
 * One-off recovery: grant FULL Room30 portal access to every Portugal-event
 * attendee found in the Whop Members CSV, then send each one a custom email
 * letting them know their portal is fully unlocked because they were in
 * Portugal.
 *
 * What "full access" means here:
 *   - orders row with EVERY *Paid boolean = true (mainProduct, bump1, bump2,
 *     bump3, upsell1, upsell2, upsell3, downsell1, tiktokSlideshow, hookDemo,
 *     doneForYouPack, portfolio, platinum). Deterministic order id
 *     `portugal-grant-<sha1(email).slice(0,16)>` so re-runs upsert in place.
 *   - portal_users row upserted with isAList=true, aListJoinedAt=now,
 *     isActive=true, portalKey='main'. Created with email-only if the user
 *     has not signed up yet (clerkId stays NULL until they do).
 *   - Calls enrollPurchaserAndSendEmail first so the buyer gets a Clerk
 *     invite + the standard "your account is ready" email if they don't
 *     already have one. Idempotent via email_logs.metadata.orderId.
 *   - Then sends the custom Portugal email (templateType
 *     `portugal_full_access_grant`). Idempotent via email_logs lookup on
 *     templateType + email.
 *
 * Usage:
 *   CSV_PATH=/abs/path/to/members.csv DRY_RUN=1 \
 *     pnpm --filter @workspace/scripts run grant:portugal-full-access
 *   DRY_RUN=0 to actually write + email.
 *
 * Required env: DATABASE_URL, CLERK_SECRET_KEY, RESEND_API_KEY (the API
 * server's existing env). Reuses artifacts/api-server/src/lib/* directly.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, emailLogsTable, ordersTable, portalUsersTable } from "@workspace/db";
import { sendEmail } from "../../artifacts/api-server/src/lib/email";
import { enrollPurchaserAndSendEmail } from "../../artifacts/api-server/src/lib/purchase-enrollment";
import { getBrandBaseUrl } from "../../artifacts/api-server/src/lib/brand-url";

const PORTUGAL_PRODUCT_IDS = new Set<string>([
  "prod_b3ec5vJKWFYsJ", // Portugal Gold
  "prod_f0E1tYv8rbeOp", // Portugal VIP
]);

const TEMPLATE_TYPE = "portugal_full_access_grant";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const CSV_PATH = process.env.CSV_PATH
  ? resolve(process.env.CSV_PATH)
  : resolve(
      process.cwd(),
      "../attached_assets/exprt_iL3N8M1jVsJU_1778793947930.csv",
    );

type Buyer = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  productIds: string[];
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cur.push(field);
        field = "";
      } else if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (ch === "\r") {
        // skip
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function pickColumn(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function loadBuyers(): Buyer[] {
  const text = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  const idxEmail = pickColumn(headers, ["email", "user email", "buyer email"]);
  const idxProductIds = pickColumn(headers, ["product ids", "product_ids"]);
  const idxProductId = pickColumn(headers, ["product id", "product_id"]);
  const idxName = pickColumn(headers, ["name"]);
  const idxFirst = pickColumn(headers, ["first name", "first_name"]);
  const idxLast = pickColumn(headers, ["last name", "last_name"]);

  if (idxEmail < 0) throw new Error("CSV missing Email column");
  if (idxProductIds < 0 && idxProductId < 0) {
    throw new Error("CSV missing Product IDs / Product ID column");
  }

  const byEmail = new Map<string, Buyer>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[idxEmail] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const rawProds =
      idxProductIds >= 0 ? row[idxProductIds] : row[idxProductId] ?? "";
    const prodList = rawProds
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const portugalProds = prodList.filter((p) => PORTUGAL_PRODUCT_IDS.has(p));
    if (portugalProds.length === 0) continue;

    let firstName: string | null =
      idxFirst >= 0 ? (row[idxFirst] ?? "").trim() || null : null;
    let lastName: string | null =
      idxLast >= 0 ? (row[idxLast] ?? "").trim() || null : null;
    if (!firstName && !lastName && idxName >= 0) {
      const full = (row[idxName] ?? "").trim();
      if (full) {
        const parts = full.split(/\s+/);
        firstName = parts[0] ?? null;
        lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }
    }

    const existing = byEmail.get(email);
    if (existing) {
      for (const p of portugalProds) {
        if (!existing.productIds.includes(p)) existing.productIds.push(p);
      }
      existing.firstName = existing.firstName || firstName;
      existing.lastName = existing.lastName || lastName;
    } else {
      byEmail.set(email, { email, firstName, lastName, productIds: portugalProds });
    }
  }
  return [...byEmail.values()];
}

function deterministicOrderId(email: string): string {
  const hash = createHash("sha1").update(email).digest("hex").slice(0, 16);
  return `portugal-grant-${hash}`;
}

const ALL_PAID_FIELDS = {
  mainProductPaid: true,
  bump1Paid: true,
  bump2Paid: true,
  bump3Paid: true,
  upsell1Paid: true,
  upsell2Paid: true,
  upsell3Paid: true,
  downsell1Paid: true,
  tiktokSlideshowPaid: true,
  hookDemoPaid: true,
  doneForYouPackPaid: true,
  portfolioPaid: true,
  platinumPaid: true,
} as const;

async function upsertOrderAllPaid(buyer: Buyer): Promise<string> {
  const orderId = deterministicOrderId(buyer.email);
  if (DRY_RUN) return orderId;
  await db
    .insert(ordersTable)
    .values({
      id: orderId,
      email: buyer.email,
      ...ALL_PAID_FIELDS,
    })
    .onConflictDoUpdate({
      target: ordersTable.id,
      set: {
        email: buyer.email,
        ...ALL_PAID_FIELDS,
        updatedAt: new Date(),
      },
    });
  return orderId;
}

async function upsertPortalUserAList(buyer: Buyer): Promise<void> {
  if (DRY_RUN) return;
  const existing = await db
    .select({ id: portalUsersTable.id })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, buyer.email))
    .limit(1);
  const now = new Date();
  if (existing.length > 0) {
    await db
      .update(portalUsersTable)
      .set({
        isAList: true,
        aListJoinedAt: now,
        isActive: true,
      })
      .where(eq(portalUsersTable.id, existing[0].id));
  } else {
    await db.insert(portalUsersTable).values({
      email: buyer.email,
      ...(buyer.firstName ? { firstName: buyer.firstName } : {}),
      ...(buyer.lastName ? { lastName: buyer.lastName } : {}),
      isAList: true,
      aListJoinedAt: now,
      isActive: true,
      portalKey: "main",
    });
  }
}

async function alreadySentCustomEmail(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        eq(emailLogsTable.email, email),
        eq(emailLogsTable.templateType, TEMPLATE_TYPE),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function buildEmail(buyer: Buyer): {
  subject: string;
  body: string;
  bodyHtml: string;
} {
  const baseUrl = getBrandBaseUrl();
  const signInUrl = `${baseUrl.replace(/\/$/, "")}/portal/sign-in`;
  const greetingName = buyer.firstName?.trim() || "friend";
  const subject = "Your full Room30 access is unlocked";
  const body = [
    `Hey ${greetingName},`,
    "",
    "Massive thanks for being with us in Portugal.",
    "",
    "As a Portugal attendee, your Room30 portal is now fully unlocked - every upgrade, every bonus room, every coaching tool. There is nothing left behind a paywall for you.",
    "",
    `Sign in here: ${signInUrl}`,
    "",
    "If you do not see the new sections after signing in, hard-refresh the page once - the unlocks are tied to your account, not your browser.",
    "",
    "If anything is missing or you want any white-glove help getting set up, just reply to this email and I will sort it personally.",
    "",
    "- Greg",
  ].join("\n");
  const bodyHtml = `
    <p>Hey ${greetingName},</p>
    <p>Massive thanks for being with us in Portugal.</p>
    <p>As a Portugal attendee, your Room30 portal is now <strong>fully unlocked</strong> - every upgrade, every bonus room, every coaching tool. There is nothing left behind a paywall for you.</p>
    <p style="margin: 28px 0;">
      <a href="${signInUrl}" style="display:inline-block;padding:14px 24px;background:#c9a96a;color:#0b0b0b;text-decoration:none;border-radius:8px;font-weight:600;letter-spacing:0.02em;">
        Open your portal
      </a>
    </p>
    <p>If you do not see the new sections after signing in, hard-refresh the page once - the unlocks are tied to your account, not your browser.</p>
    <p>If anything is missing or you want any white-glove help getting set up, just reply to this email and I will sort it personally.</p>
    <p>- Greg</p>
  `.trim();
  return { subject, body, bodyHtml };
}

async function main() {
  const buyers = loadBuyers();
  console.log(
    `[portugal] csv=${CSV_PATH} matched=${buyers.length} buyer(s) carrying a Portugal product (Gold prod_b3ec5vJKWFYsJ or VIP prod_f0E1tYv8rbeOp)`,
  );
  for (const b of buyers) {
    console.log(
      `  ${b.email}  name=${b.firstName ?? "?"} ${b.lastName ?? ""}  products=${b.productIds.join(",")}`,
    );
  }
  if (DRY_RUN) {
    console.log(
      "[portugal] DRY_RUN=1 (default) -- nothing written. Set DRY_RUN=0 to apply.",
    );
    return;
  }

  let ordersUpserted = 0;
  let portalUsersUpserted = 0;
  let standardEmails = 0;
  let customEmails = 0;
  let customEmailsSkipped = 0;
  let failed = 0;

  for (const buyer of buyers) {
    try {
      const orderId = await upsertOrderAllPaid(buyer);
      ordersUpserted++;
      console.log(`[order] ${buyer.email} -> ${orderId} fields=ALL_PAID`);

      await upsertPortalUserAList(buyer);
      portalUsersUpserted++;
      console.log(`[a-list] ${buyer.email} -> isAList=true`);

      try {
        const r = await enrollPurchaserAndSendEmail({
          email: buyer.email,
          orderId,
          portalKey: "room30",
        });
        if (r.status === "sent") standardEmails++;
        console.log(`[enroll] ${buyer.email} -> ${JSON.stringify(r)}`);
      } catch (err) {
        console.warn(
          `[enroll] ${buyer.email} -> failed (continuing): ${(err as Error).message}`,
        );
      }

      if (await alreadySentCustomEmail(buyer.email)) {
        customEmailsSkipped++;
        console.log(`[custom-email] ${buyer.email} -> already sent, skipping`);
      } else {
        const { subject, body, bodyHtml } = buildEmail(buyer);
        const result = await sendEmail({
          email: buyer.email,
          subject,
          body,
          bodyHtml,
          templateType: TEMPLATE_TYPE,
          brand: "room30",
          metadata: {
            source: "portugal-full-access-grant",
            productIds: buyer.productIds,
          },
        });
        if (result.status === "sent") customEmails++;
        else failed++;
        console.log(
          `[custom-email] ${buyer.email} -> ${result.status} ${result.messageId ?? ""}`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `[fatal] ${buyer.email} failed: ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `[portugal] done. orders_upserted=${ordersUpserted} portal_users_upserted=${portalUsersUpserted} standard_enroll_emails=${standardEmails} portugal_emails_sent=${customEmails} portugal_emails_already_sent=${customEmailsSkipped} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
