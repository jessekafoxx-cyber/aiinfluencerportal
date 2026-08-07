/**
 * Task #552 - Live funnel purchase verification harness.
 *
 * Read-only audit script. Given a buyer email (or order id) and the list of
 * funnel steps the buyer accepted, prints the orders row, the matching
 * coaching_payments rows (in case a row landed there for high-ticket
 * cross-sells), every paid-step flag, the whop_receipt_id, the provenance
 * columns, and a PASS/FAIL summary against the Task #552 acceptance
 * checklist.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify:funnel-purchase -- \
 *       --email buyer@example.com \
 *       --accepted main,bump2,bump3,upsell1,upsell2,upsell3
 *
 *   pnpm --filter @workspace/scripts run verify:funnel-purchase -- \
 *       --order-id ord_xxx \
 *       --accepted main,upsell1,downsell1,upsell3
 *
 *   pnpm --filter @workspace/scripts run verify:funnel-purchase -- \
 *       --email buyer@example.com   # no --accepted = read-only dump
 *
 * Connection: uses PROD_DATABASE_URL if set, else DATABASE_URL. Both safe -
 * script only runs SELECTs.
 *
 * Accepted-step vocabulary:
 *   main          - the /checkout main charge ($27 AI Influencer Masterclass)
 *   bump1, bump2, bump3 - order bumps on the checkout cart
 *   upsell1, downsell1, upsell2, upsell3, downsell3 - one-click upsell page
 *
 * For each step in --accepted, the script asserts the matching paid flag is
 * true. For each step NOT in --accepted, it asserts the flag is false (so
 * the script catches an "accidentally charged" regression as well as a
 * "didn't charge" one). Pass --accepted=main as a minimum.
 */

import { Client } from "pg";

type StepResult = { name: string; ok: boolean; detail: string };

const ALL_STEPS = [
  "main",
  "bump1",
  "bump2",
  "bump3",
  "upsell1",
  "downsell1",
  "upsell2",
  "upsell3",
  "downsell3",
] as const;
type StepName = (typeof ALL_STEPS)[number];

const STEP_TO_COLUMN: Record<Exclude<StepName, "downsell3">, string> = {
  main: "main_product_paid",
  bump1: "bump1_paid",
  bump2: "bump2_paid",
  bump3: "bump3_paid",
  upsell1: "upsell1_paid",
  downsell1: "downsell1_paid",
  upsell2: "upsell2_paid",
  upsell3: "upsell3_paid",
};

function parseArgs(argv: string[]): {
  email?: string;
  orderId?: string;
  accepted?: Set<StepName>;
} {
  const out: { email?: string; orderId?: string; accepted?: Set<StepName> } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--order-id") out.orderId = argv[++i];
    else if (a === "--accepted" || a?.startsWith("--accepted=")) {
      const raw = a.startsWith("--accepted=") ? a.split("=", 2)[1] : argv[++i];
      const set = new Set<StepName>();
      for (const part of (raw || "").split(",").map((s) => s.trim()).filter(Boolean)) {
        if ((ALL_STEPS as readonly string[]).includes(part)) {
          set.add(part as StepName);
        } else {
          console.error(
            `Unknown step in --accepted: "${part}". Allowed: ${ALL_STEPS.join(", ")}`,
          );
          process.exit(2);
        }
      }
      out.accepted = set;
    }
  }
  return out;
}

async function main() {
  const { email, orderId, accepted } = parseArgs(process.argv.slice(2));
  if (!email && !orderId) {
    console.error(
      "Usage: verify-funnel-purchase --email <addr> | --order-id <id> [--accepted main,bump2,upsell1,...]",
    );
    process.exit(2);
  }
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Set PROD_DATABASE_URL (preferred for live verification) or DATABASE_URL",
    );
    process.exit(2);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const where = orderId
      ? { sql: "id = $1", val: orderId }
      : { sql: "lower(email) = lower($1)", val: email! };

    const ordersRes = await client.query(
      `SELECT id, email, phone, created_at, current_step,
              main_product_paid, bump1_paid, bump2_paid, bump3_paid,
              upsell1_paid, downsell1_paid, upsell2_paid, upsell3_paid,
              total_amount, product_slugs,
              whop_user_id, whop_receipt_id, whop_membership_id,
              whop_bundle_plan_id,
              payment_source_type, grant_reason,
              payment_verified, receipt_verified,
              affiliate_code
         FROM orders
        WHERE ${where.sql}
        ORDER BY created_at DESC`,
      [where.val],
    );

    if (ordersRes.rows.length === 0) {
      console.log("No orders row matched.");
      process.exit(1);
    }

    let anyFailed = false;

    for (const o of ordersRes.rows) {
      console.log("\n================================================");
      console.log(`order ${o.id}  (${o.email})  created_at=${o.created_at}`);
      console.log("================================================");
      console.log(JSON.stringify(o, null, 2));

      // Cross-check coaching_payments for the same buyer email. Funnel
      // upsell receipts are not currently persisted there (they're returned
      // in the charge-upsell API response only), but the Task #552 done-
      // looks-like criteria asks us to look. If a row exists, print it so
      // the human can confirm the receipt matches the Whop dashboard.
      const cp = await client.query(
        `SELECT cp.id, cp.agreement_id, cp.whop_receipt_id,
                cp.whop_membership_id, cp.amount_cents, cp.currency,
                cp.created_at
           FROM coaching_payments cp
           LEFT JOIN coaching_agreements ca ON ca.id = cp.agreement_id
          WHERE lower(ca.email) = lower($1)
          ORDER BY cp.created_at DESC`,
        [o.email],
      );
      console.log(
        `\n  coaching_payments rows for ${o.email}: ${cp.rows.length}`,
      );
      for (const row of cp.rows) {
        console.log(`    - ${JSON.stringify(row)}`);
      }

      const selectedBumps: string[] = (o.product_slugs || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      const results: StepResult[] = [];

      // --- Provenance / receipt invariants for the main charge ---
      results.push({
        name: "main: mainProductPaid=true",
        ok: !!o.main_product_paid,
        detail: `main_product_paid=${o.main_product_paid}`,
      });
      results.push({
        name: "main: whop_receipt_id present",
        ok: !!o.whop_receipt_id,
        detail: `whop_receipt_id=${o.whop_receipt_id ?? "NULL"}`,
      });
      results.push({
        name: "main: payment_source_type=whop_verified_payment",
        ok: o.payment_source_type === "whop_verified_payment",
        detail: `payment_source_type=${o.payment_source_type ?? "NULL"}`,
      });
      results.push({
        name: "main: payment_verified + receipt_verified both true",
        ok: !!o.payment_verified && !!o.receipt_verified,
        detail: `payment_verified=${o.payment_verified} receipt_verified=${o.receipt_verified}`,
      });

      // --- Bump cart vs flag consistency (always runs) ---
      const cartHasBump: Record<"bump1" | "bump2" | "bump3", boolean> = {
        bump1: selectedBumps.includes("order-bump-1"),
        bump2: selectedBumps.includes("order-bump-2"),
        bump3: selectedBumps.includes("order-bump-3"),
      };
      for (const k of ["bump1", "bump2", "bump3"] as const) {
        const actual = !!o[`${k}_paid`];
        results.push({
          name: `${k}: paid flag matches cart selection`,
          ok: actual === cartHasBump[k],
          detail: `cart=${cartHasBump[k]} ${k}_paid=${actual}`,
        });
      }

      // --- Per-step accepted/declined assertions (only if --accepted given) ---
      if (accepted) {
        // For downsell3, the funnel writes upsell3Paid=true (shared flag).
        // We assert upsell3_paid==true if either upsell3 OR downsell3 is in
        // the accepted set, and false only when neither is.
        const acceptedUpsell3OrTrial =
          accepted.has("upsell3") || accepted.has("downsell3");

        for (const step of [
          "upsell1",
          "downsell1",
          "upsell2",
        ] as const) {
          const expected = accepted.has(step);
          const actual = !!o[STEP_TO_COLUMN[step]];
          results.push({
            name: `${step}: flag matches accepted-step input`,
            ok: actual === expected,
            detail: `expected=${expected} ${STEP_TO_COLUMN[step]}=${actual}`,
          });
        }
        results.push({
          name: "upsell3 / downsell3: shared upsell3_paid flag matches input",
          ok: !!o.upsell3_paid === acceptedUpsell3OrTrial,
          detail: `expected=${acceptedUpsell3OrTrial} upsell3_paid=${!!o.upsell3_paid}`,
        });

        // For bumps, --accepted is authoritative if provided AND should
        // agree with the cart. Surface any disagreement loudly.
        for (const k of ["bump1", "bump2", "bump3"] as const) {
          const expected = accepted.has(k);
          const actual = !!o[`${k}_paid`];
          results.push({
            name: `${k}: flag matches accepted-step input`,
            ok: actual === expected,
            detail: `expected=${expected} ${k}_paid=${actual}`,
          });
        }
      } else {
        for (const k of ["upsell1", "downsell1", "upsell2", "upsell3"] as const) {
          results.push({
            name: `${k}: flag readable (no --accepted given, dump only)`,
            ok: true,
            detail: `${STEP_TO_COLUMN[k]}=${o[STEP_TO_COLUMN[k]]}`,
          });
        }
      }

      // --- Portal user existence (proves the access email was send-able) ---
      const portalRes = await client.query(
        `SELECT id, email, clerk_id, portal_key, is_active, created_at
           FROM portal_users
          WHERE lower(email) = lower($1)`,
        [o.email],
      );
      results.push({
        name: "portal: exactly one portal_users row for buyer email",
        ok: portalRes.rows.length === 1,
        detail: `rows=${portalRes.rows.length} ${
          portalRes.rows[0]
            ? `(id=${portalRes.rows[0].id}, clerk_id=${
                portalRes.rows[0].clerk_id ?? "NULL"
              }, portal_key=${portalRes.rows[0].portal_key})`
            : ""
        }`,
      });

      console.log("\n--- Acceptance checks ---");
      let failed = 0;
      for (const r of results) {
        const tag = r.ok ? "PASS" : "FAIL";
        if (!r.ok) failed++;
        console.log(`  [${tag}] ${r.name}  ::  ${r.detail}`);
      }
      console.log(
        `\nSummary: ${results.length - failed}/${results.length} checks passed`,
      );
      if (failed > 0) anyFailed = true;
    }

    if (anyFailed) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
