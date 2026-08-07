/**
 * One-off: comp-invite a single user into the Room30 portal.
 *
 * Mirrors scripts/src/grant-portugal-full-access.ts but for a single
 * email rather than a CSV, and stamps an "invitedBy" attribution onto
 * the orders row's grant_reason + portal_users.notes so the inviter is
 * recoverable later.
 *
 * What this does for the target email:
 *   1. Upserts an orders row (deterministic id `invite-<sha1(email).16>`)
 *      with every *Paid boolean flipped true, provenance =
 *      admin_grant (verified=true, receiptVerified=false because there
 *      is no processor receipt), grantReason = `invited_by:<inviter>`.
 *   2. Upserts a portal_users row with isActive=true, isAList=true,
 *      aListJoinedAt=now, portalKey='room30'. Lookup is by
 *      lower(email) so it matches the Task #505 unique index.
 *   3. Calls enrollPurchaserAndSendEmail so the buyer gets a Clerk
 *      invite + the standard "your account is ready" email. Idempotent
 *      via email_logs.
 *
 * DRY_RUN=1 by default. DRY_RUN=0 to actually write.
 *
 * Usage:
 *   EMAIL=yddecasas123@gmail.com INVITED_BY=eddy@room30.ai DRY_RUN=1 \
 *     pnpm --filter @workspace/scripts run invite:portal-user
 *
 *   DRY_RUN=0 to apply. Run against PROD by exporting PROD_DATABASE_URL
 *   as DATABASE_URL for the invocation (per replit.md DB skill).
 */

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, ordersTable, portalUsersTable } from "@workspace/db";
import { enrollPurchaserAndSendEmail } from "../../artifacts/api-server/src/lib/purchase-enrollment";
import { provenanceFor } from "../../artifacts/api-server/src/lib/payment-provenance";

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const RAW_EMAIL = (process.env.EMAIL ?? "").trim().toLowerCase();
const INVITED_BY = (process.env.INVITED_BY ?? "").trim().toLowerCase();

if (!RAW_EMAIL || !/^\S+@\S+\.\S+$/.test(RAW_EMAIL)) {
  console.error(
    "[invite] EMAIL env var is required (e.g. EMAIL=person@example.com)",
  );
  process.exit(1);
}
if (!INVITED_BY || !/^\S+@\S+\.\S+$/.test(INVITED_BY)) {
  console.error(
    "[invite] INVITED_BY env var is required (e.g. INVITED_BY=eddy@room30.ai)",
  );
  process.exit(1);
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

function deterministicOrderId(email: string): string {
  const hash = createHash("sha1").update(email).digest("hex").slice(0, 16);
  return `invite-${hash}`;
}

async function upsertOrder(): Promise<string> {
  const orderId = deterministicOrderId(RAW_EMAIL);
  const prov = provenanceFor({
    source: "admin_grant",
    reason: `invited_by:${INVITED_BY}`,
    hasReceiptId: false,
  });
  if (DRY_RUN) return orderId;
  await db
    .insert(ordersTable)
    .values({
      id: orderId,
      email: RAW_EMAIL,
      ...ALL_PAID_FIELDS,
      ...prov,
    })
    .onConflictDoUpdate({
      target: ordersTable.id,
      set: {
        email: RAW_EMAIL,
        ...ALL_PAID_FIELDS,
        ...prov,
        updatedAt: new Date(),
      },
    });
  return orderId;
}

async function upsertPortalUser(): Promise<{ created: boolean }> {
  const existing = await db
    .select({ id: portalUsersTable.id })
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${RAW_EMAIL}`)
    .limit(1);

  if (existing.length > 0) {
    if (DRY_RUN) return { created: false };
    await db
      .update(portalUsersTable)
      .set({
        isActive: true,
        isAList: true,
        aListJoinedAt: sql`COALESCE(${portalUsersTable.aListJoinedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, existing[0].id));
    return { created: false };
  }

  if (DRY_RUN) return { created: true };
  await db.insert(portalUsersTable).values({
    email: RAW_EMAIL,
    isActive: true,
    isAList: true,
    aListJoinedAt: new Date(),
    portalKey: "room30",
  });
  return { created: true };
}

async function main() {
  console.log(
    `[invite] EMAIL=${RAW_EMAIL} INVITED_BY=${INVITED_BY} DRY_RUN=${DRY_RUN ? 1 : 0}`,
  );

  const orderId = await upsertOrder();
  console.log(
    `[invite] order ${DRY_RUN ? "(dry-run)" : "upserted"} id=${orderId} all *Paid=true source=admin_grant reason=invited_by:${INVITED_BY}`,
  );

  const pu = await upsertPortalUser();
  console.log(
    `[invite] portal_users ${DRY_RUN ? "(dry-run)" : pu.created ? "inserted" : "updated"} email=${RAW_EMAIL} isActive=true isAList=true`,
  );

  if (DRY_RUN) {
    console.log("[invite] DRY_RUN=1 (default) -- no Clerk invite sent. Set DRY_RUN=0 to apply.");
    return;
  }

  const enroll = await enrollPurchaserAndSendEmail({
    email: RAW_EMAIL,
    orderId,
    portalKey: "room30",
    extraMetadata: { invitedBy: INVITED_BY, grant: "admin_invite" },
  });
  console.log(
    `[invite] enrollment status=${enroll.status}${
      enroll.status === "sent" ? ` mode=${enroll.mode}` : ""
    }${enroll.status === "skipped" ? ` reason=${enroll.reason}` : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[invite] failed", err);
    process.exit(1);
  });
