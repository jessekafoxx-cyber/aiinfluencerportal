/**
 * Task #519 backfill: rescue MAY2026 buyers whose `orders` row was
 * created (or synthesized) by `scripts/src/recover-may2026-stuck-orders.ts`
 * or `recover-whop-buyers-by-email.ts` but landed missing one or more
 * of `mainProductPaid`, `whopUserId`, `whopMembershipId`, or
 * `whopReceiptId` - the partial state that breaks
 * `/whop/charge-upsell` (Platinum downsell hang) and
 * `/api/portal/setup-account` (post-purchase signup 403).
 *
 * For each candidate row:
 *   1. List active memberships in Whop by the buyer's email (walks the
 *      WHOP_MAIN_PRODUCT_IDS allowlist so MAY2026 promo product ids
 *      drift-recover too).
 *   2. If at least one membership is found, fill in the missing fields:
 *        - mainProductPaid = true
 *        - whopUserId      <- membership.user_id (when current is null)
 *        - whopMembershipId<- membership.id      (when current is null)
 *      Never overwrites an existing non-null value. Logs every column
 *      that is actually touched.
 *
 *      Note on whopReceiptId: it is intentionally NOT hydrated here.
 *      MAY2026 $0 promos arrive via `membership.went_valid` and never
 *      produce a Whop receipt - `whopReceiptId` is supposed to stay
 *      NULL for them so that future refund matching (which keys on
 *      receipt id equality, see `whopWebhookHandlers.ts`) cannot
 *      collide with a free-promo grant. Mirror that contract here.
 *   3. Row is skipped (and logged as `not_in_whop`) when no live
 *      membership exists for that email - those buyers need a manual
 *      decision (refund vs grant), not a silent backfill.
 *
 * Dry-run by default. Pass `--apply` (or set `APPLY=1`) to write.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:may2026-recovery            # dry-run
 *   APPLY=1 pnpm --filter @workspace/scripts run backfill:may2026-recovery    # write
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID  (required)
 *   DATABASE_URL                    (required)
 *   WHOP_MAIN_PRODUCT_IDS           (optional, MAY2026 drift product ids)
 *   SINCE                           (default `2026-05-14`; ISO date)
 *   LIMIT                           (default 1000)
 *   ONLY_EMAIL                      (process a single buyer)
 *   APPLY=1 | --apply               (default dry-run)
 *   REQUEST_DELAY_MS                (default 150)
 */
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { listValidMembershipsByEmailStrict } from "@workspace/api-server/lib/free-promo-reconcile";
import { getMainProductIdAllowlist } from "@workspace/api-server/whopProducts";

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply");
const SINCE = process.env.SINCE || "2026-05-14";
const LIMIT = Math.min(5000, Number(process.env.LIMIT || "1000"));
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS ?? 150));

if (!process.env.WHOP_API_KEY || !process.env.WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}

async function main() {
  const sinceDate = new Date(SINCE);
  if (Number.isNaN(sinceDate.getTime())) {
    console.error(`Invalid SINCE date: ${SINCE}`);
    process.exit(1);
  }

  console.log(
    `[backfill-519] selecting orders created since ${sinceDate.toISOString()} where mainProductPaid IS NULL/false OR whopUserId IS NULL, limit=${LIMIT}, apply=${APPLY}`,
  );

  const rows = await db
    .select({
      id: ordersTable.id,
      email: ordersTable.email,
      mainProductPaid: ordersTable.mainProductPaid,
      whopUserId: ordersTable.whopUserId,
      whopMembershipId: ordersTable.whopMembershipId,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, sinceDate),
        or(
          isNull(ordersTable.mainProductPaid),
          eq(ordersTable.mainProductPaid, false),
          isNull(ordersTable.whopUserId),
        ),
        sql`${ordersTable.email} IS NOT NULL AND length(${ordersTable.email}) > 0`,
      ),
    )
    .limit(LIMIT);

  const candidates = ONLY_EMAIL
    ? rows.filter((r) => (r.email || "").trim().toLowerCase() === ONLY_EMAIL)
    : rows;

  console.log(
    `[backfill-519] candidate rows=${candidates.length} (of ${rows.length} scanned)`,
  );

  const allowlist = getMainProductIdAllowlist();
  console.log(`[backfill-519] main-product allowlist: ${allowlist.join(", ")}`);

  let backfilled = 0;
  let notInWhop = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (i > 0 && REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    const email = (c.email || "").trim().toLowerCase();
    if (!email) continue;

    try {
      let matchedUserId: string | null = null;
      let matchedMembershipId: string | null = null;
      let matchedProductId: string | null = null;
      for (const pid of allowlist) {
        const memberships = await listValidMembershipsByEmailStrict(email, pid);
        if (memberships.length > 0) {
          const m = memberships[0]!;
          matchedUserId = m.user_id || (typeof m.user === "string" ? m.user : null) || null;
          matchedMembershipId = m.id;
          matchedProductId = pid;
          break;
        }
      }

      if (!matchedMembershipId) {
        notInWhop++;
        console.log(`[not-in-whop] order=${c.id} email=${email}`);
        continue;
      }

      const updates: Record<string, unknown> = {};
      const touched: string[] = [];
      if (!c.mainProductPaid) {
        updates.mainProductPaid = true;
        touched.push("mainProductPaid");
      }
      if (!c.whopUserId && matchedUserId) {
        updates.whopUserId = matchedUserId;
        touched.push("whopUserId");
      }
      if (!c.whopMembershipId) {
        updates.whopMembershipId = matchedMembershipId;
        touched.push("whopMembershipId");
      }

      if (touched.length === 0) {
        unchanged++;
        console.log(`[already-complete] order=${c.id} email=${email}`);
        continue;
      }

      updates.updatedAt = new Date();

      if (!APPLY) {
        console.log(
          `[would-backfill] order=${c.id} email=${email} fields=${touched.join(",")} productId=${matchedProductId}`,
        );
        continue;
      }

      await db
        .update(ordersTable)
        .set(updates as any)
        .where(eq(ordersTable.id, c.id));

      backfilled++;
      console.log(
        `[backfilled] order=${c.id} email=${email} fields=${touched.join(",")} productId=${matchedProductId} whopUserId=${matchedUserId} whopMembershipId=${matchedMembershipId}`,
      );
    } catch (e) {
      errors++;
      console.error(`[fail] order=${c.id} email=${email}`, (e as Error)?.message || e);
    }
  }

  console.log(
    `[backfill-519] done. candidates=${candidates.length} backfilled=${backfilled} notInWhop=${notInWhop} unchanged=${unchanged} errors=${errors} apply=${APPLY}`,
  );
  if (!APPLY) {
    console.log(`[backfill-519] dry-run only. Re-run with APPLY=1 to actually write.`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[backfill-519] fatal", e);
    process.exit(1);
  },
);
