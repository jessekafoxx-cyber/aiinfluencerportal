/**
 * Stripe webhook backfill.
 *
 * Root cause: the Stripe webhook endpoint was never registered in the
 * Stripe Dashboard, so `payment_intent.succeeded` events have never
 * reached `/api/stripe/webhook` in production. The
 * `stripe_processed_events` table is empty all-time. As a result:
 *
 *   - 34/122 orders in the last 30d that have a stripe_payment_intent_id
 *     are marked `main_product_paid=true` but with NULL
 *     `payment_source_type` (some other path flipped the bit without
 *     stamping provenance + without firing portal enrollment).
 *   - Only 1/30d order carries the canonical `stripe_verified_payment`
 *     stamp.
 *   - Welcome emails were never sent for these buyers; portal
 *     entitlements never resolved correctly.
 *
 * Two paths, depending on the row's current state:
 *
 *   PATH A - main_product_paid is ALREADY true but provenance is missing:
 *     The webhook replay route (markStripeOrderPaid) early-returns for
 *     these because the paid flag is already set, which skips both the
 *     provenance stamp and `enrollPurchaserAndSendEmail`. So we patch
 *     them directly: validate the Stripe PI is `succeeded`, UPDATE
 *     paymentSourceType + grantReason + paymentVerified +
 *     receiptVerified + stripeCustomerId + stripeDefaultPaymentMethodId
 *     (only when currently null), then call enrollPurchaserAndSendEmail
 *     (idempotent via email_logs).
 *
 *   PATH B - main_product_paid is false but the Stripe PI is `succeeded`:
 *     The webhook never fired and no other path flipped the bit. Replay
 *     through the exported handlePaymentIntentSucceeded(), which routes
 *     through markStripeOrderPaid -> provenance stamp + enrollment.
 *
 * Both paths are dry-run by default. Pass --apply (or set APPLY=1) to
 * actually write.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:stripe-paid-orders            # dry-run
 *   APPLY=1 pnpm --filter @workspace/scripts run backfill:stripe-paid-orders    # write
 *
 * Env:
 *   STRIPE_SECRET_KEY (or TEST_STRIPE_SECRET_KEY in dev)
 *   DATABASE_URL
 *   SINCE_DAYS   default 90
 *   LIMIT        default 500
 *   ONLY_EMAIL   optional single buyer
 *   ONLY_ORDER   optional single order id
 *   REQUEST_DELAY_MS default 200
 *   APPLY=1 | --apply
 */
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getStripeClient } from "@workspace/api-server/stripeClient";
import { handlePaymentIntentSucceeded } from "@workspace/api-server/stripeWebhookHandlers";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply");
const SINCE_DAYS = Math.max(1, Number(process.env.SINCE_DAYS || "90"));
const LIMIT = Math.min(5000, Number(process.env.LIMIT || "500"));
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();
const ONLY_ORDER = (process.env.ONLY_ORDER || "").trim();
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS ?? 200));

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

interface Counters {
  scanned: number;
  pathAProvenancePatched: number;
  pathAEnrollmentSent: number;
  pathAEnrollmentSkipped: number;
  pathBReplayed: number;
  piNotSucceeded: number;
  piMetadataMismatch: number;
  alreadyClean: number;
  skipped: number;
  failed: number;
}

async function main() {
  console.log(
    `[backfill-stripe] sinceDays=${SINCE_DAYS} limit=${LIMIT} apply=${APPLY} only_email=${ONLY_EMAIL || "(any)"} only_order=${ONLY_ORDER || "(any)"}`,
  );

  const sinceDate = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);

  // Candidate set: rows with a Stripe PI whose provenance is missing or
  // non-stripe. Covers both the "already paid but no provenance"
  // (path A) and "PI exists but not flipped" (path B) cohorts.
  const conditions = [
    isNotNull(ordersTable.stripePaymentIntentId),
    gte(ordersTable.createdAt, sinceDate),
    or(
      sql`${ordersTable.paymentSourceType} IS NULL`,
      sql`${ordersTable.paymentSourceType} NOT LIKE 'stripe_%'`,
    )!,
  ];
  if (ONLY_EMAIL) conditions.push(eq(sql`LOWER(${ordersTable.email})`, ONLY_EMAIL));
  if (ONLY_ORDER) conditions.push(eq(ordersTable.id, ONLY_ORDER));

  const rows = await db
    .select({
      id: ordersTable.id,
      email: ordersTable.email,
      pi: ordersTable.stripePaymentIntentId,
      mainPaid: ordersTable.mainProductPaid,
      paymentSourceType: ordersTable.paymentSourceType,
      stripeCustomerId: ordersTable.stripeCustomerId,
      stripeDefaultPaymentMethodId: ordersTable.stripeDefaultPaymentMethodId,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(LIMIT);

  console.log(`[backfill-stripe] selected ${rows.length} candidate orders`);

  const stripe = getStripeClient();
  const counters: Counters = {
    scanned: 0,
    pathAProvenancePatched: 0,
    pathAEnrollmentSent: 0,
    pathAEnrollmentSkipped: 0,
    pathBReplayed: 0,
    piNotSucceeded: 0,
    piMetadataMismatch: 0,
    alreadyClean: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    counters.scanned++;
    const piId = row.pi as string | null;
    if (!piId) {
      counters.skipped++;
      continue;
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(piId);
      if (intent.status !== "succeeded") {
        counters.piNotSucceeded++;
        console.log(
          `[backfill-stripe] order=${row.id} email=${row.email} pi=${piId} status=${intent.status} - skipping`,
        );
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const metaOrderId = (intent.metadata?.orderId as string | undefined) || null;
      if (metaOrderId && metaOrderId !== row.id) {
        console.warn(
          `[backfill-stripe] order=${row.id} pi=${piId} metadata.orderId=${metaOrderId} - MISMATCH, skipping`,
        );
        counters.piMetadataMismatch++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // ------------------------------------------------------------
      // PATH A: main_product_paid is already true.
      //   markStripeOrderPaid would early-return -> patch directly.
      // ------------------------------------------------------------
      if (row.mainPaid === true) {
        const customerId =
          typeof intent.customer === "string"
            ? intent.customer
            : intent.customer?.id || null;
        const paymentMethodId =
          typeof intent.payment_method === "string"
            ? intent.payment_method
            : intent.payment_method?.id || null;
        const chargeId =
          intent.latest_charge && typeof intent.latest_charge === "string"
            ? intent.latest_charge
            : (intent.latest_charge as { id?: string } | null)?.id || null;
        const hasReceipt = !!intent.id || !!chargeId;

        if (!APPLY) {
          console.log(
            `[backfill-stripe] DRY path-A: would patch provenance order=${row.id} email=${row.email} pi=${piId} (source=stripe_verified_payment, receipt=${hasReceipt})`,
          );
          counters.pathAProvenancePatched++;
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        const updates: Partial<typeof ordersTable.$inferInsert> = {
          paymentSourceType: "stripe_verified_payment",
          grantReason: `backfill-stripe: payment_intent.succeeded ${intent.id}`,
          paymentVerified: true,
          receiptVerified: hasReceipt,
          updatedAt: new Date(),
        };
        if (customerId && !row.stripeCustomerId) updates.stripeCustomerId = customerId;
        if (paymentMethodId && !row.stripeDefaultPaymentMethodId) {
          updates.stripeDefaultPaymentMethodId = paymentMethodId;
        }

        await db.update(ordersTable).set(updates).where(eq(ordersTable.id, row.id));
        counters.pathAProvenancePatched++;
        console.log(
          `[backfill-stripe] path-A patched provenance order=${row.id} email=${row.email} pi=${piId}`,
        );

        if (row.email) {
          try {
            const enrollResult = await enrollPurchaserAndSendEmail({
              email: row.email,
              orderId: row.id,
              portalKey: "room30",
              extraMetadata: {
                source: "stripe_verified_payment",
                backfillReason: "stripe-webhook-never-fired",
                stripePaymentIntentId: intent.id,
                stripeCustomerId: customerId ?? null,
              },
            });
            if (enrollResult.status === "sent") {
              counters.pathAEnrollmentSent++;
              console.log(
                `[backfill-stripe] path-A enrollment ${enrollResult.mode} order=${row.id} email=${row.email}`,
              );
            } else {
              counters.pathAEnrollmentSkipped++;
              console.log(
                `[backfill-stripe] path-A enrollment ${enrollResult.status} order=${row.id} email=${row.email} reason=${(enrollResult as { reason?: string }).reason ?? (enrollResult as { error?: string }).error ?? "?"}`,
              );
            }
          } catch (e: any) {
            counters.failed++;
            console.error(
              `[backfill-stripe] path-A enrollment FAIL order=${row.id} email=${row.email} err=${e?.message || String(e)}`,
            );
          }
        } else {
          counters.pathAEnrollmentSkipped++;
        }

        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // ------------------------------------------------------------
      // PATH B: main_product_paid is false. Webhook replay does
      //   everything (flip + provenance + enrollment).
      // ------------------------------------------------------------
      if (!metaOrderId) {
        console.warn(
          `[backfill-stripe] order=${row.id} pi=${piId} - PI has no orderId metadata and main is unpaid; webhook would also have ignored; skipping`,
        );
        counters.skipped++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      if (!APPLY) {
        console.log(
          `[backfill-stripe] DRY path-B: would replay pi=${piId} order=${row.id} email=${row.email} product=${intent.metadata?.product ?? "(none)"} slugs=${intent.metadata?.productSlugs ?? "(none)"}`,
        );
        counters.pathBReplayed++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      await handlePaymentIntentSucceeded(intent, `backfill-stripe:${row.id}`);
      counters.pathBReplayed++;
      console.log(
        `[backfill-stripe] path-B replayed pi=${piId} order=${row.id} email=${row.email}`,
      );
    } catch (err: any) {
      counters.failed++;
      console.error(
        `[backfill-stripe] FAIL order=${row.id} pi=${piId} err=${err?.message || String(err)}`,
      );
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Post-check.
  const [stillBroken] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(
      and(
        isNotNull(ordersTable.stripePaymentIntentId),
        gte(ordersTable.createdAt, sinceDate),
        or(
          sql`${ordersTable.paymentSourceType} IS NULL`,
          sql`${ordersTable.paymentSourceType} NOT LIKE 'stripe_%'`,
        )!,
      ),
    );

  console.log("\n========= BACKFILL SUMMARY =========");
  console.log(JSON.stringify(counters, null, 2));
  console.log(`Still-broken in window after run: ${stillBroken?.n ?? "?"}`);
  console.log(
    APPLY
      ? "APPLY=1 - changes were written."
      : "DRY-RUN - no DB writes. Re-run with --apply or APPLY=1.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-stripe] FATAL", err);
    process.exit(1);
  });
