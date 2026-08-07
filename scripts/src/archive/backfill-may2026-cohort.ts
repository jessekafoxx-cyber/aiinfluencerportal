/**
 * Task #515: Broad-spectrum backfill for the MAY2026 launch cohort.
 *
 * The existing `recover:may2026-stuck` script only flips
 * `mainProductPaid` via `reconcileIfWhopGrantedMain`, leaving buyers
 * who paid for bumps / upsells / the Platinum Club downsell with
 * their main flag flipped but everything else still false. This
 * script calls the new `reconcileBuyerFromWhop` helper which walks
 * every valid Whop membership the buyer holds across the catalog and
 * flips every matching `orders.*Paid` column in one go, plus issues
 * the Platinum Founder Code when `upsell3Paid` ends up true.
 *
 * Selection: every `orders` row created on/after `--since` (default
 * 2026-05-14, MAY2026 cohort) whose email is non-empty. The helper
 * itself is idempotent, so rows that are already correct become
 * no-ops in the report.
 *
 * Dry-run by default. Pass `--apply` (or `APPLY=1`) to write.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:may2026-cohort
 *   pnpm --filter @workspace/scripts run backfill:may2026-cohort -- --apply
 *   pnpm --filter @workspace/scripts run backfill:may2026-cohort -- --emails=foo@x.com,bar@y.com
 *
 * Env:
 *   WHOP_API_KEY, WHOP_BUSINESS_ID, DATABASE_URL  (required)
 *   SINCE                  default 2026-05-14T00:00:00Z
 *   LIMIT                  default 1000
 *   EMAILS                 comma-separated allowlist; overrides date filter
 *   REQUEST_DELAY_MS       default 200 (Cloudflare-friendly pacing)
 *   APPLY=1 | --apply      default dry-run
 */
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import {
  reconcileBuyerFromWhop,
  type ReconcileBuyerResult,
} from "../../../artifacts/api-server/src/lib/free-promo-reconcile";

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  for (const a of process.argv) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

const APPLY = argFlag("apply") || process.env.APPLY === "1";
const SINCE_RAW =
  argValue("since") ||
  process.env.SINCE ||
  "2026-05-14T00:00:00Z";
const LIMIT = Math.min(5000, Number(argValue("limit") || process.env.LIMIT || "1000"));
const EMAILS_ARG = (argValue("emails") || process.env.EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const REQUEST_DELAY_MS = Math.max(
  0,
  Number(argValue("delay-ms") || process.env.REQUEST_DELAY_MS || "200"),
);

if (!process.env.WHOP_API_KEY || !process.env.WHOP_BUSINESS_ID) {
  console.error("Missing WHOP_API_KEY or WHOP_BUSINESS_ID");
  process.exit(1);
}

const sinceDate = new Date(SINCE_RAW);
if (Number.isNaN(sinceDate.getTime())) {
  console.error(`Bad --since value: ${SINCE_RAW}`);
  process.exit(1);
}

interface Tally {
  considered: number;
  reconciled: number;
  alreadyCorrect: number;
  notInWhop: number;
  errors: number;
  founderCodeIssued: number;
  enrollmentEmailsSent: number;
}

function fmtResult(email: string, r: ReconcileBuyerResult): string {
  const parts: string[] = [];
  if (r.fieldsFlipped.length > 0) parts.push(`flipped=${r.fieldsFlipped.join("+")}`);
  if (r.fieldsAlreadyTrue.length > 0)
    parts.push(`alreadyTrue=${r.fieldsAlreadyTrue.join("+")}`);
  if (r.unmappedSlugs.length > 0)
    parts.push(`unmapped=${r.unmappedSlugs.join("+")}`);
  if (r.founderCodeEnsured) parts.push("founder=ok");
  if (r.enrollmentEmailStatus !== "not_attempted")
    parts.push(`email=${r.enrollmentEmailStatus}`);
  return `email=${email} order=${r.orderId || "?"} ${parts.join(" ")}`.trim();
}

async function main() {
  console.log(
    `[t515] cohort backfill since=${sinceDate.toISOString()} limit=${LIMIT} apply=${APPLY} emails=${EMAILS_ARG.length || "all"}`,
  );

  const baseConds = [
    sql`${ordersTable.email} IS NOT NULL AND length(${ordersTable.email}) > 0`,
  ];
  if (EMAILS_ARG.length === 0) {
    baseConds.push(gte(ordersTable.createdAt, sinceDate));
  } else {
    baseConds.push(
      inArray(sql<string>`lower(${ordersTable.email})`, EMAILS_ARG),
    );
  }

  const rows = await db
    .select({
      id: ordersTable.id,
      email: ordersTable.email,
      createdAt: ordersTable.createdAt,
      mainProductPaid: ordersTable.mainProductPaid,
      bump2Paid: ordersTable.bump2Paid,
      bump3Paid: ordersTable.bump3Paid,
      upsell1Paid: ordersTable.upsell1Paid,
      downsell1Paid: ordersTable.downsell1Paid,
      upsell2Paid: ordersTable.upsell2Paid,
      upsell3Paid: ordersTable.upsell3Paid,
    })
    .from(ordersTable)
    .where(and(...baseConds))
    .orderBy(desc(ordersTable.createdAt))
    .limit(LIMIT);

  // De-duplicate by lower(email) so an email with multiple orders rows
  // only consumes one Whop /memberships call. The helper's
  // order-resolution step will still pick the right row inside the DB.
  const seen = new Set<string>();
  const targets: Array<{ orderId: string; email: string }> = [];
  for (const r of rows) {
    const e = (r.email || "").trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    targets.push({ orderId: r.id, email: e });
  }

  console.log(`[t515] candidates=${targets.length} (rows fetched=${rows.length})`);

  const tally: Tally = {
    considered: targets.length,
    reconciled: 0,
    alreadyCorrect: 0,
    notInWhop: 0,
    errors: 0,
    founderCodeIssued: 0,
    enrollmentEmailsSent: 0,
  };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    if (i > 0 && REQUEST_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
    try {
      if (!APPLY) {
        // Dry-run: still call the helper so the operator can see the
        // exact set of flips that WOULD happen, but we wrap it in a
        // transaction-style probe by NOT calling .apply. The helper
        // doesn't expose a dry-run flag; instead we run the read-side
        // only by asking for memberships through the same shared
        // listValidMembershipsByEmailStrict path the helper uses --
        // delegated to the helper itself by passing a sentinel that
        // tells it to noop the writes. Simpler approach: just print
        // intent here without invoking the helper, mirroring how
        // recover:may2026-stuck does it.
        console.log(`[would-resync] email=${t.email} orderId=${t.orderId}`);
        continue;
      }
      const r = await reconcileBuyerFromWhop({
        email: t.email,
        orderId: t.orderId,
        source: "sweep",
        // Task #515 audit marker: any enrollment email triggered by
        // this backfill is stamped so ops can trace its origin in
        // email_logs after the fact, the same way Task #460's
        // re-send script used `metadata.resentFromTask460`.
        resentFromTask515: true,
      });
      if (r.flipped) {
        tally.reconciled++;
        console.log(`[flipped] ${fmtResult(t.email, r)}`);
      } else if (r.membershipIds.length === 0) {
        tally.notInWhop++;
        console.log(`[not-in-whop] email=${t.email} orderId=${t.orderId}`);
      } else {
        tally.alreadyCorrect++;
        console.log(`[already-correct] ${fmtResult(t.email, r)}`);
      }
      if (r.founderCodeEnsured) tally.founderCodeIssued++;
      if (r.enrollmentEmailStatus === "sent") tally.enrollmentEmailsSent++;
    } catch (e) {
      tally.errors++;
      console.error(
        `[fail] email=${t.email} orderId=${t.orderId}`,
        (e as Error)?.message || e,
      );
    }
  }

  console.log(
    `[t515] done. considered=${tally.considered} reconciled=${tally.reconciled} alreadyCorrect=${tally.alreadyCorrect} notInWhop=${tally.notInWhop} errors=${tally.errors} founderCodeIssued=${tally.founderCodeIssued} enrollmentEmailsSent=${tally.enrollmentEmailsSent} apply=${APPLY}`,
  );
  if (!APPLY) {
    console.log(
      `[t515] dry-run only. Re-run with --apply (or APPLY=1) to actually flip rows + issue Founder Codes + send emails.`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[t515] fatal", e);
    process.exit(1);
  },
);
