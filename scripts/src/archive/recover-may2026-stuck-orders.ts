/**
 * Task #479 recovery sweep: rescue buyers stranded by the MAY2026
 * checkout spinner-reset bug.
 *
 * Scope: every orders row created within the affected window whose
 * `mainProductPaid = false` AND whose `productSlugs` carries a
 * `promo:MAY2026` token (or another promo token when PROMO is set).
 * For each candidate the script:
 *
 *   1. Asks Whop directly whether the buyer email is already enrolled
 *      as an active member of the main product (the $0/discounted
 *      promo path). If so, the same `reconcileIfWhopGrantedMain`
 *      helper used by /portal/setup-account flips the row and sends
 *      the canonical "set your password" email (idempotent on
 *      email+orderId via email_logs, so re-running is safe).
 *   2. If Whop has no active membership for that email, the row is
 *      reported as `not_in_whop` for manual triage -- the buyer
 *      never reached Whop's success step and needs a fresh checkout
 *      link or a refund decision.
 *
 * Dry-run by default. Set `APPLY=1` (or pass `--apply`) to actually
 * flip rows and send emails.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run recover:may2026-stuck             # dry-run report
 *   APPLY=1 pnpm --filter @workspace/scripts run recover:may2026-stuck     # write
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID  (required)
 *   DATABASE_URL                    (required)
 *   CLERK_SECRET_KEY                (required for the enrollment email)
 *   RESEND_API_KEY                  (required to actually deliver mail)
 *   SINCE_HOURS                     (default 720 = 30 days)
 *   PROMO                           (default `MAY2026`; case-insensitive)
 *   LIMIT                           (default 500)
 *   APPLY=1 | --apply               (default dry-run)
 *   REQUEST_DELAY_MS                (default 150; same Cloudflare-friendly
 *                                    pacing as recover:free-promos)
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { reconcileIfWhopGrantedMain } from "../../../artifacts/api-server/src/lib/free-promo-reconcile";

const APPLY =
  process.env.APPLY === "1" || process.argv.includes("--apply");
const SINCE_HOURS = Number(process.env.SINCE_HOURS || "720");
const LIMIT = Math.min(2000, Number(process.env.LIMIT || "500"));
const PROMO = (process.env.PROMO || "MAY2026").trim().toLowerCase();
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS ?? 150));

if (!process.env.WHOP_API_KEY || !process.env.WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}

function carriesPromo(slugsCsv: string | null, promo: string): boolean {
  if (!slugsCsv) return false;
  return slugsCsv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .some((s) => s.startsWith("promo:") && s.slice("promo:".length) === promo);
}

async function main() {
  const sinceDate = new Date(Date.now() - SINCE_HOURS * 3600 * 1000);
  console.log(
    `[may2026] selecting unpaid orders since ${sinceDate.toISOString()} promo=${PROMO} limit=${LIMIT} apply=${APPLY}`,
  );

  const rows = await db
    .select({
      id: ordersTable.id,
      email: ordersTable.email,
      productSlugs: ordersTable.productSlugs,
      createdAt: ordersTable.createdAt,
      totalAmount: ordersTable.totalAmount,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.mainProductPaid, false),
        gte(ordersTable.createdAt, sinceDate),
        sql`${ordersTable.email} IS NOT NULL AND length(${ordersTable.email}) > 0`,
      ),
    )
    .orderBy(desc(ordersTable.createdAt))
    .limit(LIMIT);

  const candidates = rows.filter((r) => carriesPromo(r.productSlugs, PROMO));
  console.log(
    `[may2026] candidate rows=${candidates.length} (of ${rows.length} recent unpaid)`,
  );

  let flipped = 0;
  let alreadyPaid = 0;
  let notInWhop = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (i > 0 && REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    const email = (c.email || "").trim().toLowerCase();
    if (!email) continue;
    if (!APPLY) {
      console.log(
        `[would-reconcile] order=${c.id} email=${email} createdAt=${c.createdAt?.toISOString?.() || "?"}`,
      );
      continue;
    }
    try {
      const result = await reconcileIfWhopGrantedMain({
        orderId: c.id,
        email,
        source: "sweep",
      });
      if (result.flipped) {
        flipped++;
        console.log(`[flipped] order=${c.id} email=${email} totalCents=${result.totalCents}`);
      } else if (result.alreadyPaid) {
        alreadyPaid++;
        console.log(`[already-paid] order=${c.id} email=${email}`);
      } else if (result.reason === "no_whop_membership") {
        notInWhop++;
        console.log(`[not-in-whop] order=${c.id} email=${email}`);
      } else {
        console.log(`[noop] order=${c.id} email=${email} reason=${result.reason || "unknown"}`);
      }
    } catch (e) {
      errors++;
      console.error(`[fail] order=${c.id} email=${email}`, (e as Error)?.message || e);
    }
  }

  console.log(
    `[may2026] done. candidates=${candidates.length} flipped=${flipped} alreadyPaid=${alreadyPaid} notInWhop=${notInWhop} errors=${errors} apply=${APPLY}`,
  );
  if (!APPLY) {
    console.log(`[may2026] dry-run only. Re-run with APPLY=1 to actually flip rows + send emails.`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[may2026] fatal", e);
    process.exit(1);
  },
);
