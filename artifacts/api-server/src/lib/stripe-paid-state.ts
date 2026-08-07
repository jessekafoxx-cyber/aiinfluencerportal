/**
 * Stripe-side equivalent of whopWebhookHandlers.markBumpOrUpsellPaid.
 *
 * Every code path that flips a paid_* boolean on `orders` for a Stripe
 * payment MUST go through `markStripeOrderPaid` so:
 *   - the right slug -> column mapping is applied (single source of truth),
 *   - paymentSourceType + grantReason + paymentVerified + receiptVerified
 *     are stamped via `provenanceFor()` (the DB CHECK constraints in
 *     migration 0056 will reject the write otherwise),
 *   - portal enrollment + welcome email are kicked off after a main flip,
 *   - the order's stripeCustomerId / stripePaymentIntentId / saved PM
 *     id are persisted on first payment so off-session upsell charges
 *     work without re-mounting Elements.
 */

import { db, ordersTable } from "@workspace/db";
import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import {
  PRODUCTS,
  type ProductDef,
  type ProductSlug,
  type PaidFieldName,
} from "../productCatalog";
import { provenanceFor, isRealRevenueSource, type PaymentSourceType } from "./payment-provenance";
import { enrollPurchaserAndSendEmail } from "./purchase-enrollment";
import { logger } from "./logger";

export type { PaidFieldName };

/**
 * Runtime guard for the PaidFieldName string union. Used by webhook +
 * reconciler code paths that read `metadata.extraPaidField` (a plain
 * string off the Stripe wire) and need to validate it before passing
 * to `markStripeOrderPaid({ paidFieldOverride })`.
 */
const ALL_PAID_FIELDS: ReadonlySet<string> = new Set<PaidFieldName>([
  "mainProductPaid",
  "bump2Paid",
  "bump3Paid",
  "upsell1Paid",
  "upsell2Paid",
  "upsell3Paid",
  "downsell1Paid",
  "platinumPaid",
  "doneForYouPackPaid",
  "portfolioPaid",
]);
export function isPaidFieldName(value: unknown): value is PaidFieldName {
  return typeof value === "string" && ALL_PAID_FIELDS.has(value);
}

/**
 * Typed map from a paid-field name to the matching Drizzle column
 * reference. Lets us do `eq(PAID_COLUMN[paidField], false)` in WHERE
 * clauses without falling back to `(ordersTable as any)[paidField]`.
 */
const PAID_COLUMN = {
  mainProductPaid: ordersTable.mainProductPaid,
  bump2Paid: ordersTable.bump2Paid,
  bump3Paid: ordersTable.bump3Paid,
  upsell1Paid: ordersTable.upsell1Paid,
  upsell2Paid: ordersTable.upsell2Paid,
  upsell3Paid: ordersTable.upsell3Paid,
  downsell1Paid: ordersTable.downsell1Paid,
  platinumPaid: ordersTable.platinumPaid,
  doneForYouPackPaid: ordersTable.doneForYouPackPaid,
  portfolioPaid: ordersTable.portfolioPaid,
} as const satisfies Record<PaidFieldName, SQLWrapper>;

type OrderRow = typeof ordersTable.$inferSelect;
type OrderUpdate = Partial<typeof ordersTable.$inferInsert>;

/**
 * Read the boolean state of a paid_* column from an order row. Index
 * access is type-safe because PaidFieldName is a strict subset of the
 * order row's keys.
 */
function readPaidFlag(order: OrderRow, paidField: PaidFieldName): boolean {
  return order[paidField] === true;
}

/**
 * Apply `paidField=true` to a typed update object via switch so the
 * resulting `OrderUpdate` is fully typed (no `as any`).
 */
function setPaidFlag(updates: OrderUpdate, paidField: PaidFieldName, value: boolean): void {
  switch (paidField) {
    case "mainProductPaid": updates.mainProductPaid = value; break;
    case "bump2Paid": updates.bump2Paid = value; break;
    case "bump3Paid": updates.bump3Paid = value; break;
    case "upsell1Paid": updates.upsell1Paid = value; break;
    case "upsell2Paid": updates.upsell2Paid = value; break;
    case "upsell3Paid": updates.upsell3Paid = value; break;
    case "downsell1Paid": updates.downsell1Paid = value; break;
    case "platinumPaid": updates.platinumPaid = value; break;
    case "doneForYouPackPaid": updates.doneForYouPackPaid = value; break;
    case "portfolioPaid": updates.portfolioPaid = value; break;
  }
}

/** Resolve a slug to its `orders.<col>_paid` column, or null. */
export function paidFieldForSlug(slug: ProductSlug): PaidFieldName | null {
  return PRODUCTS[slug]?.paidField ?? null;
}

export interface MarkStripeOrderPaidOpts {
  orderId: string;
  slug: ProductSlug;
  source: PaymentSourceType;
  /** Free-form short reason for the audit trail. */
  reason: string;
  /**
   * Overrides the paid_* column derived from PRODUCTS[slug].paidField.
   * Used by the portal-addons router so that one Stripe Price (e.g. the
   * funnel's `upsell1` $197 SKU) can flip a different entitlement column
   * (`doneForYouPackPaid`) when bought from the portal sidebar, without
   * stomping the funnel's own `upsell1Paid` column.
   */
  paidFieldOverride?: PaidFieldName;
  /** Stripe identifiers to persist on the order. */
  stripe: {
    customerId?: string | null;
    paymentIntentId?: string | null;
    chargeId?: string | null;
    paymentMethodId?: string | null;
    subscriptionId?: string | null;
  };
  /** Amount actually charged for THIS slug, in cents. */
  amountCents: number;
}

export interface MarkStripeOrderPaidResult {
  alreadyPaid: boolean;
  flipped: PaidFieldName | null;
  email: string | null;
}

/**
 * Atomically flip the matching paid_* column. Returns alreadyPaid=true
 * when the row was already flipped (no-op, safe to call from webhook
 * retries).
 */
export async function markStripeOrderPaid(
  opts: MarkStripeOrderPaidOpts,
): Promise<MarkStripeOrderPaidResult> {
  const def: ProductDef | undefined = PRODUCTS[opts.slug];
  if (!def) {
    throw new Error(`markStripeOrderPaid: unknown slug ${opts.slug}`);
  }
  const paidField: PaidFieldName | undefined = opts.paidFieldOverride ?? def.paidField;
  if (!paidField) {
    throw new Error(
      `markStripeOrderPaid: slug ${opts.slug} has no paidField mapping (not a funnel/portal SKU)`,
    );
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, opts.orderId));
  if (!order) {
    logger.warn({ orderId: opts.orderId, slug: opts.slug }, "[stripe-paid-state] order not found");
    return { alreadyPaid: false, flipped: null, email: null };
  }
  if (readPaidFlag(order, paidField)) {
    return { alreadyPaid: true, flipped: paidField, email: order.email };
  }

  const updates: OrderUpdate = {
    totalAmount: (order.totalAmount || 0) + (opts.amountCents || 0),
    updatedAt: new Date(),
  };
  setPaidFlag(updates, paidField, true);

  // Only the MAIN flip stamps row-level provenance. Bumps / upsells /
  // downsells inherit the provenance of their parent main payment -
  // the row's paymentSourceType reflects "how was this order
  // originally bought?", not "what was the most recent flip?".
  // `provenanceFor()` is the gate for that write: it enforces the DB
  // CHECK constraints (verified=true requires a stripe_*/whop_*
  // source; receipt_verified=true requires a non-null receipt id).
  if (paidField === "mainProductPaid") {
    const stamp = provenanceFor({
      source: opts.source,
      reason: opts.reason,
      hasReceiptId: !!opts.stripe.paymentIntentId || !!opts.stripe.chargeId,
    });
    updates.paymentSourceType = stamp.paymentSourceType;
    updates.grantReason = stamp.grantReason;
    updates.paymentVerified = stamp.paymentVerified;
    updates.receiptVerified = stamp.receiptVerified;
    // Persist the exact effective (post-promo) main-line cents we just
    // received. The thank-you browser pixel reads this back via
    // GET /funnel/order/:oid so its Purchase value matches the server CAPI
    // main event byte-for-byte under the shared event_id, even when the main
    // was promo-discounted (e.g. a 100%-off-main cart with a paid bump stamps
    // 0 here, so the browser reports 0 just like the server skips the event).
    updates.effectiveMainAmountCents = opts.amountCents || 0;
  }

  if (opts.stripe.customerId && !order.stripeCustomerId) {
    updates.stripeCustomerId = opts.stripe.customerId;
  }
  if (opts.stripe.paymentIntentId && !order.stripePaymentIntentId) {
    updates.stripePaymentIntentId = opts.stripe.paymentIntentId;
  }
  if (opts.stripe.paymentMethodId && !order.stripeDefaultPaymentMethodId) {
    updates.stripeDefaultPaymentMethodId = opts.stripe.paymentMethodId;
  }
  if (opts.stripe.subscriptionId && !order.stripeSubscriptionId) {
    updates.stripeSubscriptionId = opts.stripe.subscriptionId;
  }

  const result = await db
    .update(ordersTable)
    .set(updates)
    .where(and(eq(ordersTable.id, opts.orderId), eq(PAID_COLUMN[paidField], false)))
    .returning({ id: ordersTable.id });

  if (result.length === 0) {
    return { alreadyPaid: true, flipped: paidField, email: order.email };
  }

  logger.info(
    {
      orderId: opts.orderId,
      slug: opts.slug,
      paidField,
      source: opts.source,
      reason: opts.reason,
      amountCents: opts.amountCents,
    },
    "[stripe-paid-state] flipped paid column",
  );

  // Slack #low-ticket / #high-ticket-sale ping. Routes by threshold
  // ($500). Only fires for real-revenue sources so admin grants, free
  // promos, and reconciler-only flips stay silent (mirrors the Kit
  // purchases gate below). Fire-and-forget; helper is no-throw.
  if (order.email && opts.amountCents > 0) {
    const sourceForRevenue: PaymentSourceType =
      paidField === "mainProductPaid"
        ? opts.source
        : ((order.paymentSourceType as PaymentSourceType | null) ?? opts.source);
    if (isRealRevenueSource(sourceForRevenue)) {
      void (async () => {
        try {
          const { notifyPaidOrder } = await import("./sales-slack");
          notifyPaidOrder({
            email: order.email,
            productLabel: def.label,
            amountCents: opts.amountCents,
            orderRef: `order #${opts.orderId} (${paidField})`,
            source: `stripe:${opts.source}`,
          });
        } catch {
          // Helper is no-throw; ignore dynamic-import failures.
        }
      })();
    }
  }

  // Low-ticket #sales Slack summary is NOT dispatched from here.
  // It's fired centrally from stripeWebhookHandlers.handlePaymentIntentSucceeded
  // AFTER the full cart loop completes (so main + bumps are all flipped
  // before the items[] snapshot is taken), with the same atomic claim
  // as the legacy GET /api/funnel/order/:oid trigger. See
  // lib/order-items.ts::dispatchLowTicketOrderSlackSummary.

  // GHL mirror: on the MAIN paid flip only, add the "Purchased" tag
  // and remove the "not-purchased" tag from the buyer's GHL contact.
  // Idempotent (one-shot gate is funnel_leads.ghl_purchased_tagged_at)
  // and best-effort - failures never block the order flip.
  //
  // Awaited (with a 2500ms cap) rather than pure fire-and-forget:
  // Stripe webhook handlers run in short-lived request contexts, and
  // a `void (async ...)()` here was dropped by the runtime mid-fetch
  // - that's how 23 paid buyers in a recent 48h window ended up not
  // tagged Purchased in GHL despite their order rows showing paid.
  // 2500ms covers an upsert + add Purchased + add masterclass-tag +
  // remove not-purchased (4 calls @ ~400ms each) without blocking
  // Stripe's 30s webhook timeout budget.
  if (paidField === "mainProductPaid" && order.email) {
    try {
      const { tagGhlPurchased } = await import("./ghl-sync");
      await Promise.race([
        tagGhlPurchased({
          email: order.email,
          phone: order.phone ?? null,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch {
      // Already logged inside tagGhlPurchased.
    }
  }

  // Kick off portal enrollment + welcome email when the MAIN product
  // flips. Other slugs do not enroll on their own.
  if (paidField === "mainProductPaid" && order.email) {
    try {
      await enrollPurchaserAndSendEmail({
        email: order.email,
        orderId: opts.orderId,
        portalKey: "room30",
        extraMetadata: {
          stripeCustomerId: opts.stripe.customerId ?? null,
          stripePaymentIntentId: opts.stripe.paymentIntentId ?? null,
          source: opts.source,
        },
      });
    } catch (e) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e), orderId: opts.orderId },
        "[stripe-paid-state] portal enrollment after main flip failed",
      );
    }
  }

  // Meta Conversions API (server-side Purchase). Fires for every real-
  // revenue paid_* flip on the funnel - main, bumps, upsells, downsells -
  // so Meta receives a server-side Purchase that survives iOS / ad-blockers
  // / cookie loss (the part that lifts Event Match Quality). The MAIN flip
  // reuses the SAME event_id the browser pixel sends from the thank-you
  // page (`order_<id>_main`) so the browser + server events dedupe instead
  // of double-counting; bump / upsell / downsell flips get their own
  // per-column event_id (no browser counterpart). fbp / fbc / ip / ua /
  // email / phone were captured onto the order row at checkout. Gated by
  // isRealRevenueSource so admin grants / free promos / reconciler-only
  // flips never push a fake conversion (amountCents>0 also drops the $0
  // MAY2026 100%-off grants). Fire-and-forget; never blocks the webhook.
  // metaCapi de-dupes on event_id via metaCapiEventsTable, so webhook
  // retries / finalize+webhook races are safe.
  if (order.email && opts.amountCents > 0) {
    const sourceForCapi: PaymentSourceType =
      paidField === "mainProductPaid"
        ? opts.source
        : ((order.paymentSourceType as PaymentSourceType | null) ?? opts.source);
    if (isRealRevenueSource(sourceForCapi)) {
      const metaEventId =
        paidField === "mainProductPaid"
          ? `order_${opts.orderId}_main`
          : `order_${opts.orderId}_${paidField}`;
      void (async () => {
        try {
          const { sendMetaPurchaseEvent } = await import("../services/metaCapi");
          await sendMetaPurchaseEvent({
            eventId: metaEventId,
            eventSourceUrl: "https://room30.ai/offer",
            email: order.email,
            phone: order.phone ?? null,
            fbp: order.fbp ?? null,
            fbc: order.fbc ?? null,
            clientIpAddress: order.clientIpAddress ?? null,
            clientUserAgent: order.clientUserAgent ?? null,
            value: opts.amountCents / 100,
            currency: "USD",
            orderType: "standard",
            contentName: def.label,
            contentIds: [opts.slug],
          });
        } catch (e) {
          logger.warn(
            {
              err: e instanceof Error ? e.message : String(e),
              orderId: opts.orderId,
              paidField,
            },
            "[stripe-paid-state] Meta CAPI Purchase failed (non-fatal)",
          );
        }
      })();
    }
  }

  // Command Center: record conversion for attribution + P&L dashboard.
  // Idempotent via ON CONFLICT DO UPDATE on stripe_payment_intent_id
  // (main+bump flips share a PI, amounts accumulate on one row).
  // Fire-and-forget; never blocks the webhook. Only for real-revenue
  // sources with a PI id - subscriptions (upsell3) skipped cleanly.
  if (order.email && opts.amountCents > 0 && opts.stripe.paymentIntentId) {
    const sourceForCC: PaymentSourceType =
      paidField === "mainProductPaid"
        ? opts.source
        : ((order.paymentSourceType as PaymentSourceType | null) ?? opts.source);
    if (isRealRevenueSource(sourceForCC)) {
      void (async () => {
        try {
          const { recordCcConversion } = await import("./cc-conversion-ingest.js");
          await recordCcConversion({
            email: order.email!,
            stripePaymentIntentId: opts.stripe.paymentIntentId!,
            stripeCustomerId: opts.stripe.customerId ?? null,
            amountCents: opts.amountCents,
            slug: opts.slug,
            paidField,
          });
        } catch {}
      })();
    }
  }

  return { alreadyPaid: false, flipped: paidField, email: order.email };
}

/**
 * Revoke a paid column. Used by refund / dispute / sub cancellation
 * webhook handlers. Idempotent.
 */
export async function revokeStripeOrderPaid(opts: {
  orderId: string;
  paidField: PaidFieldName;
  reason: string;
}): Promise<{ revoked: boolean }> {
  // Look up the order BEFORE the flip so downstream hooks can read the
  // details that the original paid flip persisted.
  const [orderBefore] = await db.select().from(ordersTable).where(eq(ordersTable.id, opts.orderId));
  const updates: OrderUpdate = {
    grantReason: `revoked: ${opts.reason}`,
    updatedAt: new Date(),
  };
  setPaidFlag(updates, opts.paidField, false);
  const result = await db
    .update(ordersTable)
    .set(updates)
    .where(and(eq(ordersTable.id, opts.orderId), eq(PAID_COLUMN[opts.paidField], true)))
    .returning({ id: ordersTable.id, email: ordersTable.email });
  const revoked = result.length > 0;
  if (revoked) {
    logger.warn(
      { orderId: opts.orderId, paidField: opts.paidField, reason: opts.reason },
      "[stripe-paid-state] revoked paid column",
    );
    const refundedEmail = result[0]!.email;
    // Command Center: mark the matching cc_conversions row as refunded so
    // attribution + P&L dashboards net out. Fire-and-forget.
    void (async () => {
      try {
        const { revokeCcConversion } = await import("./cc-conversion-ingest.js");
        await revokeCcConversion({
          orderId: opts.orderId,
          stripePaymentIntentId: orderBefore?.stripePaymentIntentId ?? null,
        });
      } catch {}
    })();

    // Security hardening (room30 anti-piracy spec 5.2): on any entitlement
    // revoke (refund / dispute / sub-cancel / terminal invoice failure /
    // GHL platinum cancel) terminate the buyer's active Clerk sessions so
    // portal access drops immediately instead of lingering until the JWT
    // expires, and post an #ops Slack alert. Fire-and-forget; a flaky
    // Clerk API or webhook must never bubble into the revoke path.
    if (refundedEmail) {
      void (async () => {
        let sessionsTerminated = 0;
        try {
          const { portalUsersTable } = await import("@workspace/db");
          const emailNorm = refundedEmail.trim().toLowerCase();
          const rows = await db
            .select({ clerkId: portalUsersTable.clerkId })
            .from(portalUsersTable)
            .where(sql`lower(${portalUsersTable.email}) = ${emailNorm}`);
          const clerkIds = Array.from(
            new Set(
              rows
                .map((r) => (r.clerkId || "").trim())
                .filter((id): id is string => id.length > 0),
            ),
          );
          if (clerkIds.length > 0) {
            // Sessions live in our own `sessions` table (Replit Auth);
            // the session payload stores the user under sess->user->id.
            const { sessionsTable } = await import("@workspace/db");
            for (const clerkId of clerkIds) {
              try {
                const deleted = await db
                  .delete(sessionsTable)
                  .where(sql`${sessionsTable.sess}->'user'->>'id' = ${clerkId}`)
                  .returning({ sid: sessionsTable.sid });
                sessionsTerminated += deleted.length;
              } catch (e) {
                logger.warn(
                  { err: e instanceof Error ? e.message : String(e), clerkId },
                  "[stripe-paid-state] session revoke failed (non-fatal)",
                );
              }
            }
          }
        } catch (e) {
          logger.warn(
            { err: e instanceof Error ? e.message : String(e), orderId: opts.orderId },
            "[stripe-paid-state] session-termination lookup failed (non-fatal)",
          );
        }
        try {
          const { postOpsSlackAlert } = await import("./ops-slack");
          await postOpsSlackAlert({
            source: "stripe-revoke",
            text: `Access revoked: ${refundedEmail} (${opts.paidField}) - ${opts.reason}. Terminated ${sessionsTerminated} active session(s).`,
            context: {
              orderId: opts.orderId,
              paidField: opts.paidField,
              reason: opts.reason,
              sessionsTerminated,
            },
          });
        } catch {
          /* ops-slack already swallows its own errors; guard the import too */
        }
      })();
    }
  }
  return { revoked };
}
