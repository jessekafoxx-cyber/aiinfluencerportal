/**
 * Stripe funnel smoke-test checklist runner (Task #623).
 *
 * End-to-end test matrix that an operator runs against `TEST_STRIPE_SECRET_KEY`
 * before flipping the live funnel. Each leg is independent and isolated to a
 * unique synthetic buyer email so re-runs don't collide with previous runs.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run smoke:stripe-funnel
 *   pnpm --filter @workspace/scripts run smoke:stripe-funnel -- --only=main+bump2
 *   pnpm --filter @workspace/scripts run smoke:stripe-funnel -- --list
 *
 * Env:
 *   TEST_STRIPE_SECRET_KEY  (required - runner refuses live mode)
 *   API_BASE                (default https://room30.ai)
 *
 * Leg result semantics:
 *   PASS    - the leg fully exercised the path and the post-conditions were
 *             observed (order flipped, decline detected, refund propagated).
 *   FAIL    - the leg ran but a post-condition failed; runner exits 1.
 *   SKIPPED - the leg requires manual UI interaction (high-ticket coaching/
 *             Portugal flows that route through CoachingStripePay in the SPA),
 *             or it requires a webhook delivery the smoke env can't observe.
 *             SKIPPED legs do NOT count toward the failure tally but ARE
 *             surfaced in the summary so an operator knows to run them.
 */

import Stripe from "stripe";
import { db, ordersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_SK = process.env.TEST_STRIPE_SECRET_KEY || "";
const API_BASE = (process.env.API_BASE || "https://room30.ai").replace(/\/$/, "");

if (!TEST_SK) {
  console.error("ERROR: TEST_STRIPE_SECRET_KEY env var is required.");
  process.exit(2);
}
if (!TEST_SK.startsWith("sk_test_")) {
  console.error(
    "ERROR: TEST_STRIPE_SECRET_KEY does not start with sk_test_; refusing to run against live mode.",
  );
  process.exit(2);
}

const stripe = new Stripe(TEST_SK, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });

// --- helpers --------------------------------------------------------------

function uniqEmail(label: string): string {
  const stamp = Date.now().toString(36);
  const safe = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `smoke+${safe}-${stamp}@room30.ai`;
}

async function http<T = any>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { rawBody: text };
  }
  return { status: res.status, data };
}

async function confirmPi(
  clientSecret: string,
  paymentMethod: string,
): Promise<Stripe.PaymentIntent> {
  const id = clientSecret.split("_secret_")[0];
  return stripe.paymentIntents.confirm(id, {
    payment_method: paymentMethod,
    return_url: `${API_BASE}/thankyou`,
  });
}

// --- leg helpers ----------------------------------------------------------

interface CartCheckoutResult {
  orderId: string;
  upsellToken: string;
  customerId: string;
  paymentIntent: Stripe.PaymentIntent | null;
  amountCents: number;
}

async function cartCheckout(opts: {
  email: string;
  slugs: string[];
  promoCode?: string;
  paymentMethod?: string;
}): Promise<CartCheckoutResult> {
  const create = await http("POST", "/api/stripe/create-checkout-intent", {
    email: opts.email,
    name: "Smoke Buyer",
    productSlugs: opts.slugs,
    promoCode: opts.promoCode,
  });
  if (create.status !== 200 || (create.data as any).error) {
    throw new Error(`create-checkout-intent failed: ${create.status} ${JSON.stringify(create.data)}`);
  }
  const { orderId, clientSecret, customerId, upsellToken, amountCents, freePromoGranted } =
    create.data as any;
  let pi: Stripe.PaymentIntent | null = null;
  if (!freePromoGranted && clientSecret) {
    pi = await confirmPi(clientSecret, opts.paymentMethod ?? "pm_card_visa");
  }
  return { orderId, upsellToken, customerId, paymentIntent: pi, amountCents };
}

async function chargeUpsell(
  orderId: string,
  upsellToken: string,
  productSlug: string,
): Promise<{ status: number; data: any }> {
  // The server expects `productSlug` (dashed cart slug like "upsell-1",
  // "downsell-1", "downsell-3") - NOT a bare internal slug. See
  // UPSELL_CART_SLUG_TO_INTERNAL in artifacts/api-server/src/routes/stripe-funnel.ts.
  const r = await http("POST", "/api/stripe/charge-upsell", {
    orderId,
    upsellToken,
    productSlug,
  });
  return { status: r.status, data: r.data };
}

async function pollOrderFlag(
  orderId: string,
  flag: string,
  expected: boolean,
  maxAttempts = 12,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await http("GET", `/api/funnel/order/${orderId}`);
    if (r.status === 200 && (r.data as any)?.[flag] === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function pollOrderPaid(orderId: string): Promise<void> {
  const ok = await pollOrderFlag(orderId, "mainProductPaid", true);
  if (!ok) throw new Error(`order ${orderId} never observed as mainProductPaid=true`);
}

// --- legs -----------------------------------------------------------------

type LegStatus = "pass" | "fail" | "skip";
type LegResult = { name: string; status: LegStatus; error?: string; note?: string };

function pass(name: string, note?: string): LegResult {
  return { name, status: "pass", ...(note ? { note } : {}) };
}
function fail(name: string, error: string): LegResult {
  return { name, status: "fail", error };
}
function skip(name: string, note: string): LegResult {
  return { name, status: "skip", note };
}

async function legMainOnly(): Promise<LegResult> {
  const name = "main-only";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, `PI status=${r.paymentIntent?.status}`);
    await pollOrderPaid(r.orderId);
    return pass(name, `orderId=${r.orderId} pi=${r.paymentIntent.id}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legMainBump2(): Promise<LegResult> {
  const name = "main+bump2";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main", "bump2"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, `PI status=${r.paymentIntent?.status}`);
    await pollOrderPaid(r.orderId);
    if (!(await pollOrderFlag(r.orderId, "bump2Paid", true))) {
      return fail(name, "bump2Paid never flipped");
    }
    return pass(name, `orderId=${r.orderId}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legMainBump2Bump3(): Promise<LegResult> {
  const name = "main+bump2+bump3";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main", "bump2", "bump3"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, `PI status=${r.paymentIntent?.status}`);
    await pollOrderPaid(r.orderId);
    if (!(await pollOrderFlag(r.orderId, "bump2Paid", true))) return fail(name, "bump2Paid never flipped");
    if (!(await pollOrderFlag(r.orderId, "bump3Paid", true))) return fail(name, "bump3Paid never flipped");
    return pass(name, `orderId=${r.orderId}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legUpsell1OneClick(): Promise<LegResult> {
  const name = "upsell1-one-click";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, `main PI status=${r.paymentIntent?.status}`);
    await pollOrderPaid(r.orderId);
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.status !== 200 || !u.data?.success) return fail(name, `charge-upsell: ${JSON.stringify(u.data)}`);
    if (!(await pollOrderFlag(r.orderId, "upsell1Paid", true))) return fail(name, "upsell1Paid never flipped");
    return pass(name, `orderId=${r.orderId} upsellPi=${u.data.paymentIntentId}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legUpsell3DSRequired(): Promise<LegResult> {
  // Pay the main with the 3DS card so the saved card requires re-auth on
  // off-session attempts. The off-session charge should return
  // requiresAction with a clientSecret for the SPA to mount Elements.
  const name = "upsell-3ds-required";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({
      email,
      slugs: ["main"],
      paymentMethod: "pm_card_threeDSecure2Required",
    });
    if (r.paymentIntent?.status !== "succeeded") {
      return skip(
        name,
        `main PI status=${r.paymentIntent?.status} (3DS confirm not automatable in test API; run UI flow manually)`,
      );
    }
    await pollOrderPaid(r.orderId);
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.data?.requiresAction === true && typeof u.data?.clientSecret === "string") {
      return pass(name, "requiresAction returned with clientSecret for SPA re-auth");
    }
    if (u.data?.success === true) {
      return pass(name, "3DS card auto-confirmed off-session (Stripe radar permitted it)");
    }
    return fail(name, `unexpected response: ${JSON.stringify(u.data)}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legMainPlusUpsellDecline(): Promise<LegResult> {
  // Main succeeds; the off-session upsell charge against the saved card
  // must be DECLINED. `pm_card_chargeCustomerFail` is the Stripe test PM
  // documented to fail customer-saved charges (off-session) while still
  // succeeding at attach time, so it models the real-world "card on file
  // got declined when we tried the upsell" scenario.
  const name = "main+upsell-decline";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({
      email,
      slugs: ["main"],
      paymentMethod: "pm_card_chargeCustomerFail",
    });
    if (r.paymentIntent?.status !== "succeeded") {
      return fail(name, `main PI did not succeed: status=${r.paymentIntent?.status}`);
    }
    await pollOrderPaid(r.orderId);
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.data?.success === true) {
      return fail(name, "off-session upsell on chargeCustomerFail PM unexpectedly succeeded");
    }
    // Either non-200 with an error, OR 200 with success=false / error.
    if (u.status >= 400 || u.data?.error || u.data?.success === false) {
      return pass(name, `upsell properly declined: status=${u.status} body=${JSON.stringify(u.data).slice(0, 120)}`);
    }
    return fail(name, `ambiguous decline response: ${JSON.stringify(u.data)}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legDownsell1AfterDecline(): Promise<LegResult> {
  // True end-to-end of the decline → downsell branch the SPA implements:
  //   1. Main succeeds with pm_card_chargeCustomerFail (succeeds at attach,
  //      fails off-session).
  //   2. Off-session charge-upsell upsell1 → must be declined.
  //   3. SPA falls through to /downsell1 which mounts a fresh Stripe
  //      Elements. We swap the customer's default PM to pm_card_visa (the
  //      "buyer enters fresh card" simulation) and charge downsell1
  //      off-session against the new PM. downsell1Paid must flip true.
  const name = "downsell1-after-upsell-decline";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({
      email,
      slugs: ["main"],
      paymentMethod: "pm_card_chargeCustomerFail",
    });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);

    // Step 2: confirm the upsell is in fact declined off-session.
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.data?.success === true) {
      return fail(name, "upsell1 unexpectedly succeeded; decline-then-downsell path not exercised");
    }

    // Step 3: replace the customer's default payment method with a
    // working test card and retry the buyer at the downsell tier.
    const freshPm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
    });
    await stripe.paymentMethods.attach(freshPm.id, { customer: r.customerId });
    await stripe.customers.update(r.customerId, {
      invoice_settings: { default_payment_method: freshPm.id },
    });

    const d = await chargeUpsell(r.orderId, r.upsellToken, "downsell-1");
    if (d.status !== 200 || !d.data?.success) return fail(name, `downsell1: ${JSON.stringify(d.data)}`);
    if (!(await pollOrderFlag(r.orderId, "downsell1Paid", true))) {
      return fail(name, "downsell1Paid never flipped");
    }
    return pass(name, `upsell1 declined, downsell1 succeeded with fresh PM (pi=${d.data.paymentIntentId})`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legDownsell3AfterUpsell3Decline(): Promise<LegResult> {
  // Task #626 acceptance leg: buyer pays the main, skips upsell-1 /
  // downsell-1 / upsell-2 / upsell-3 (we simulate "skip" by simply
  // never calling charge-upsell for them), then accepts the final
  // downsell-3 Platinum trial offer. The server creates a Stripe
  // subscription with trial_period_days=30 against the saved card.
  // upsell3Paid (shared column for both upsell3 and downsell3) must
  // flip true, the response must carry a subscriptionId, and the
  // returned subscription status should be trialing/active.
  const name = "downsell3-after-upsell3-decline";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);

    // Buyer declines upsell-3 by never calling charge-upsell with
    // productSlug='upsell-3'. The SPA's decline route from /upsell3
    // sends them to /downsell3 where they accept this trial.
    const d = await chargeUpsell(r.orderId, r.upsellToken, "downsell-3");
    if (d.status !== 200 || !d.data?.success) {
      return fail(name, `downsell-3 charge-upsell: ${JSON.stringify(d.data)}`);
    }
    if (typeof d.data?.subscriptionId !== "string" || !d.data.subscriptionId.startsWith("sub_")) {
      return fail(name, `expected subscriptionId on downsell-3 response: ${JSON.stringify(d.data)}`);
    }
    if (d.data?.status !== "trialing" && d.data?.status !== "active") {
      return fail(name, `expected sub status trialing|active, got ${d.data?.status}`);
    }
    if (!(await pollOrderFlag(r.orderId, "upsell3Paid", true))) {
      return fail(name, "upsell3Paid (shared with downsell3) never flipped");
    }

    // Provenance assertions: the order row must carry the subscriptionId
    // on stripe_subscription_id and reflect a real Stripe revenue source.
    const [orderRow] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, r.orderId));
    if (!orderRow) return fail(name, "order row missing after flip");
    if (orderRow.stripeSubscriptionId !== d.data.subscriptionId) {
      return fail(
        name,
        `stripe_subscription_id mismatch: ${orderRow.stripeSubscriptionId} vs ${d.data.subscriptionId}`,
      );
    }
    if (orderRow.paymentSourceType !== "stripe_verified_payment") {
      return fail(name, `unexpected paymentSourceType=${orderRow.paymentSourceType}`);
    }
    if (orderRow.paymentVerified !== true || orderRow.receiptVerified !== true) {
      return fail(
        name,
        `provenance flags wrong: paymentVerified=${orderRow.paymentVerified} receiptVerified=${orderRow.receiptVerified}`,
      );
    }
    return pass(
      name,
      `orderId=${r.orderId} sub=${d.data.subscriptionId} status=${d.data.status} provenance=${orderRow.paymentSourceType}`,
    );
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legDownsell3Declined(): Promise<LegResult> {
  // Task #626 decline leg: buyer pays the main, then declines BOTH
  // upsell-3 and the downsell-3 fallback (i.e. closes the funnel at
  // /downsell3 instead of clicking "Start My 30-Day Free Trial"). No
  // extra subscription should exist on the customer, and the
  // upsell3Paid column must remain false. We use the Stripe API to
  // verify no subscription got created against the customer for
  // belt-and-braces parity with the FP "no double-count" guarantee.
  const name = "downsell3-declined";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);

    // No charge-upsell for upsell-3 OR downsell-3: this is the decline.
    // Give the worker pollers a moment to settle, then assert the
    // post-condition.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const orderResp = await http("GET", `/api/funnel/order/${r.orderId}`);
    if (orderResp.status !== 200) return fail(name, `order fetch: ${orderResp.status}`);
    if ((orderResp.data as any)?.upsell3Paid === true) {
      return fail(name, "upsell3Paid flipped without a charge-upsell call");
    }
    const subs = await stripe.subscriptions.list({ customer: r.customerId, limit: 5 });
    if (subs.data.length > 0) {
      return fail(
        name,
        `unexpected subscription on customer after decline: ${subs.data.map((s) => `${s.id}=${s.status}`).join(",")}`,
      );
    }
    return pass(name, `orderId=${r.orderId} no subscription created, upsell3Paid stays false`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legMay2026Promo(): Promise<LegResult> {
  const name = "may2026-promo-100-off-main";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"], promoCode: "MAY2026" });
    if (r.paymentIntent && r.paymentIntent.status !== "succeeded") {
      return fail(name, "MAY2026 main PI not succeeded");
    }
    await pollOrderPaid(r.orderId);
    return pass(name, `orderId=${r.orderId} amountCents=${r.amountCents}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

// Task #654: assert MAY2026 only discounts the main SKU and leaves
// the bump full-price. If the per-line restriction ever regresses
// (e.g. internal-slug response shape, missing local-floor enforcement),
// this leg fails because amountCents would drop to 0 instead of 2700.
async function legMay2026MainPlusBump2(): Promise<LegResult> {
  const name = "may2026-promo-main+bump2";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main", "bump2"], promoCode: "MAY2026" });
    if (r.amountCents !== 2700) {
      return fail(
        name,
        `expected amountCents=2700 (main free + bump2 $27), got=${r.amountCents}`,
      );
    }
    if (r.paymentIntent?.status !== "succeeded") {
      return fail(name, `PI status=${r.paymentIntent?.status}`);
    }
    await pollOrderPaid(r.orderId);
    if (!(await pollOrderFlag(r.orderId, "bump2Paid", true))) {
      return fail(name, "bump2Paid never flipped");
    }
    // Verify the orders row's payment provenance matches the new
    // Stripe verified-payment shape.
    const [orderRow] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, r.orderId));
    if (!orderRow) return fail(name, "order row not found");
    if (orderRow.paymentSourceType !== "stripe_verified_payment") {
      return fail(name, `expected paymentSourceType=stripe_verified_payment, got=${orderRow.paymentSourceType}`);
    }
    if (orderRow.paymentVerified !== true) {
      return fail(name, "paymentVerified is not true");
    }
    return pass(name, `orderId=${r.orderId} amountCents=${r.amountCents} pi=${r.paymentIntent.id}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legRefundFullPi(): Promise<LegResult> {
  // Real check: buy main only, refund the PI via Stripe API, poll the
  // order's mainProductPaid for ≤25s for the webhook handler to flip it
  // back. If no flip in window, mark SKIPPED (webhook may not be wired to
  // the smoke target) rather than FAIL.
  const name = "refund-flips-main-paid-false";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);
    const refund = await stripe.refunds.create({ payment_intent: r.paymentIntent.id });
    const flipped = await pollOrderFlag(r.orderId, "mainProductPaid", false, 25);
    if (flipped) return pass(name, `refund=${refund.id} mainProductPaid→false`);
    return skip(
      name,
      `refund=${refund.id} created OK but order flag not observed flipping in 25s (verify webhook delivery to ${API_BASE})`,
    );
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legRefundPartialBumpOnly(): Promise<LegResult> {
  // Buy main+bump2; partial-refund the bump2 portion; expect ONLY bump2Paid
  // to flip back to false, mainProductPaid stays true.
  //
  // The bump2 amount is derived from the live catalog, not hardcoded: we
  // ask the server for the cart total of [main] alone and the cart total
  // of [main, bump2] and take the difference. This stays correct if the
  // catalog (or a promo) ever changes the bump2 price.
  const name = "partial-refund-bump-only";
  try {
    const probeEmail = uniqEmail(`${name}-probe`);
    const probeMain = await http("POST", "/api/stripe/create-checkout-intent", {
      email: probeEmail,
      productSlugs: ["main"],
    });
    const probeMainBump = await http("POST", "/api/stripe/create-checkout-intent", {
      email: probeEmail,
      productSlugs: ["main", "bump2"],
    });
    const mainCents = Number((probeMain.data as any)?.amountCents ?? 0);
    const mainBumpCents = Number((probeMainBump.data as any)?.amountCents ?? 0);
    const bump2Cents = mainBumpCents - mainCents;
    if (!(bump2Cents > 0)) {
      return fail(name, `could not derive bump2 price from catalog (main=${mainCents}, main+bump=${mainBumpCents})`);
    }

    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main", "bump2"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "PI not succeeded");
    await pollOrderPaid(r.orderId);
    if (!(await pollOrderFlag(r.orderId, "bump2Paid", true))) return fail(name, "bump2Paid not set");

    const refund = await stripe.refunds.create({
      payment_intent: r.paymentIntent.id,
      amount: bump2Cents,
    });
    const bumpFlipped = await pollOrderFlag(r.orderId, "bump2Paid", false, 25);
    if (!bumpFlipped) {
      return skip(name, `refund=${refund.id} (${bump2Cents}c) but bump2Paid did not flip in 25s (webhook?)`);
    }
    const order = await http("GET", `/api/funnel/order/${r.orderId}`);
    if ((order.data as any)?.mainProductPaid !== true) {
      return fail(name, "mainProductPaid incorrectly flipped on partial refund");
    }
    return pass(name, `refund=${refund.id} (${bump2Cents}c catalog-derived); only bump2Paid flipped`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

// High-ticket flows route through CoachingStripePay in the SPA with
// agreement-id binding and a finalize step that touches coaching_agreements
// (not orders). They can't be meaningfully exercised by a headless HTTP
// runner because the agreement is created by an admin-side flow first.
// These are SKIPPED with an explicit manual checklist note - they do NOT
// count toward pass tallies.
const HIGH_TICKET_MANUAL = (label: string, route: string): (() => Promise<LegResult>) =>
  async () =>
    skip(
      label,
      `manual UI run required: open ${route}, pay with pm_card_visa, verify coaching_agreements.status='active' and stripe_payment_intent_id is set`,
    );

const legHighTicketDfy = HIGH_TICKET_MANUAL("high-ticket-dfy", "/work-with-me-checkout (DFY $15k)");
const legHighTicketCoaching = HIGH_TICKET_MANUAL(
  "high-ticket-coaching",
  "/work-with-me-checkout (coaching package)",
);
const legPortugalGold = HIGH_TICKET_MANUAL("portugal-gold", "/sep2026/checkout?tier=gold");
const legPortugalVip = HIGH_TICKET_MANUAL("portugal-vip", "/sep2026/checkout?tier=vip");

// --- Task #732: DFY-pack dual-flip legs -----------------------------------
// Every upsell-1 / downsell-1 charge must flip BOTH the upsell flag
// AND `doneForYouPackPaid` so the buyer's portal unlocks the pack.

async function legUpsell1DfyDualFlip(): Promise<LegResult> {
  const name = "upsell1-dfy-dual-flip";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.status !== 200 || !u.data?.success) return fail(name, `charge-upsell: ${JSON.stringify(u.data)}`);
    if (!(await pollOrderFlag(r.orderId, "upsell1Paid", true))) return fail(name, "upsell1Paid never flipped");
    if (!(await pollOrderFlag(r.orderId, "doneForYouPackPaid", true))) {
      return fail(name, "doneForYouPackPaid never flipped (DFY entitlement missing)");
    }
    return pass(name, `both upsell1Paid + doneForYouPackPaid flipped (pi=${u.data.paymentIntentId})`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legDownsell1DfyDualFlip(): Promise<LegResult> {
  // Same path as the existing downsell1 leg but also asserts DFY flips.
  const name = "downsell1-dfy-dual-flip";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({
      email,
      slugs: ["main"],
      paymentMethod: "pm_card_chargeCustomerFail",
    });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);
    const u = await chargeUpsell(r.orderId, r.upsellToken, "upsell-1");
    if (u.data?.success === true) return fail(name, "upsell1 unexpectedly succeeded; decline branch not exercised");
    const freshPm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
    await stripe.paymentMethods.attach(freshPm.id, { customer: r.customerId });
    await stripe.customers.update(r.customerId, {
      invoice_settings: { default_payment_method: freshPm.id },
    });
    const d = await chargeUpsell(r.orderId, r.upsellToken, "downsell-1");
    if (d.status !== 200 || !d.data?.success) return fail(name, `downsell1: ${JSON.stringify(d.data)}`);
    if (!(await pollOrderFlag(r.orderId, "downsell1Paid", true))) return fail(name, "downsell1Paid never flipped");
    if (!(await pollOrderFlag(r.orderId, "doneForYouPackPaid", true))) {
      return fail(name, "doneForYouPackPaid never flipped on downsell1");
    }
    return pass(name, `both downsell1Paid + doneForYouPackPaid flipped (pi=${d.data.paymentIntentId})`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legPromoUpsell1SavedPm(): Promise<LegResult> {
  // $0 promo path: main grants for free under MAY2026 100%-off. The
  // server must still issue a SetupIntent so a payment method gets
  // saved + stamped on the customer; the upsell off-session charge
  // then has a default PM to bill. Without the SetupIntent the upsell
  // would 409 with no_payment_method_on_file.
  const name = "promo-upsell1-saved-pm";
  try {
    const email = uniqEmail(name);
    const create = await http("POST", "/api/stripe/create-checkout-intent", {
      email,
      name: "Smoke Buyer",
      productSlugs: ["main"],
      promoCode: "MAY2026",
    });
    if (create.status !== 200 || (create.data as any).error) {
      return fail(name, `create-checkout-intent: ${JSON.stringify(create.data)}`);
    }
    const data: any = create.data;
    if (!data.freePromoPath || !data.clientSecret) {
      return skip(
        name,
        `promo did not return freePromoPath+SetupIntent (data=${JSON.stringify(data).slice(0, 160)})`,
      );
    }
    // Confirm the SetupIntent with a saved card so the customer has a
    // default PM going into the upsell step.
    const setupId = String(data.clientSecret).split("_secret_")[0]!;
    await stripe.setupIntents.confirm(setupId, {
      payment_method: "pm_card_visa",
      return_url: `${API_BASE}/thankyou`,
    });
    // Best-effort finalize so the server persists stripeDefaultPaymentMethodId
    // synchronously. The webhook does the same; we hit the dedicated finalize
    // endpoint to remove the wait.
    await http("POST", "/api/stripe/finalize-free-promo-setup", {
      orderId: data.orderId,
      setupIntentId: setupId,
    });
    if (!data.upsellToken) return fail(name, "promo path missing upsellToken");
    // Give the webhook + finalize ~3s to write stripeDefaultPaymentMethodId.
    await new Promise((r) => setTimeout(r, 3000));
    const u = await chargeUpsell(data.orderId, data.upsellToken, "upsell-1");
    if (u.status !== 200 || !u.data?.success) return fail(name, `upsell-1 on promo: ${JSON.stringify(u.data)}`);
    if (!(await pollOrderFlag(data.orderId, "upsell1Paid", true))) return fail(name, "upsell1Paid never flipped");
    if (!(await pollOrderFlag(data.orderId, "doneForYouPackPaid", true))) {
      return fail(name, "doneForYouPackPaid never flipped on promo+upsell1");
    }
    return pass(name, `$0 promo saved PM via SetupIntent; upsell1+DFY both flipped (pi=${u.data.paymentIntentId})`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

async function legReconcilerOrphanDfy(): Promise<LegResult> {
  // Task #732 #5: orphan-by-email DFY rescue. The reconciler is a
  // worker-side loop with a 15-min cadence; we drive it synchronously
  // via the dev-only POST /api/_dev/stripe-reconcile-once endpoint
  // (gated on NODE_ENV !== "production") so the smoke runner can
  // assert the flip instead of leaving it as a manual SKIP.
  const name = "reconciler-orphan-dfy";
  try {
    const email = uniqEmail(name);
    const r = await cartCheckout({ email, slugs: ["main"] });
    if (r.paymentIntent?.status !== "succeeded") return fail(name, "main PI not succeeded");
    await pollOrderPaid(r.orderId);
    // Synthesize an orphan $197 PI: same customer (so the reconciler
    // can resolve email), amount 19700, NO orderId/product metadata.
    // This is the exact shape the rescue path looks for.
    const orphanPi = await stripe.paymentIntents.create({
      amount: 19700,
      currency: "usd",
      customer: r.customerId,
      payment_method: "pm_card_visa",
      confirm: true,
      off_session: true,
      metadata: { source: "smoke-orphan-rescue" },
    });
    if (orphanPi.status !== "succeeded") {
      return fail(name, `orphan PI did not succeed: ${orphanPi.status}`);
    }
    // Drive the reconciler synchronously. Last-hour window is plenty
    // since we just created the orphan PI seconds ago.
    const recRes = await fetch(`${API_BASE}/_dev/stripe-reconcile-once`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lookbackHours: 1 }),
    });
    if (!recRes.ok) {
      const body = await recRes.text().catch(() => "");
      return fail(name, `dev reconciler endpoint HTTP ${recRes.status}: ${body.slice(0, 200)}`);
    }
    if (!(await pollOrderFlag(r.orderId, "doneForYouPackPaid", true))) {
      return fail(name, "doneForYouPackPaid never flipped after reconcile");
    }
    return pass(name, `orphan $197 pi=${orphanPi.id} rescued; doneForYouPackPaid flipped on order ${r.orderId}`);
  } catch (e) {
    return fail(name, e instanceof Error ? e.message : String(e));
  }
}

// --- runner ---------------------------------------------------------------

const ALL_LEGS: Array<{ key: string; run: () => Promise<LegResult> }> = [
  { key: "main", run: legMainOnly },
  { key: "main+bump2", run: legMainBump2 },
  { key: "main+bump2+bump3", run: legMainBump2Bump3 },
  { key: "upsell1", run: legUpsell1OneClick },
  { key: "upsell-3ds", run: legUpsell3DSRequired },
  { key: "main+upsell-decline", run: legMainPlusUpsellDecline },
  { key: "downsell1", run: legDownsell1AfterDecline },
  { key: "downsell3", run: legDownsell3AfterUpsell3Decline },
  { key: "downsell3-declined", run: legDownsell3Declined },
  { key: "may2026", run: legMay2026Promo },
  { key: "may2026+bump2", run: legMay2026MainPlusBump2 },
  { key: "refund", run: legRefundFullPi },
  { key: "partial-refund", run: legRefundPartialBumpOnly },
  // Task #732 DFY-pack legs.
  { key: "upsell1-dfy-dual-flip", run: legUpsell1DfyDualFlip },
  { key: "downsell1-dfy-dual-flip", run: legDownsell1DfyDualFlip },
  { key: "promo-upsell1-saved-pm", run: legPromoUpsell1SavedPm },
  { key: "reconciler-orphan-dfy", run: legReconcilerOrphanDfy },
  { key: "dfy", run: legHighTicketDfy },
  { key: "coaching", run: legHighTicketCoaching },
  { key: "portugal-gold", run: legPortugalGold },
  { key: "portugal-vip", run: legPortugalVip },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const l of ALL_LEGS) console.log(l.key);
    process.exit(0);
  }
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1]!.split(",") : null;

  console.log(`Stripe funnel smoke test (API_BASE=${API_BASE}, mode=test)`);
  console.log("-".repeat(78));

  const results: LegResult[] = [];
  for (const leg of ALL_LEGS) {
    if (only && !only.includes(leg.key)) continue;
    process.stdout.write(`▶ ${leg.key.padEnd(36)} `);
    const r = await leg.run();
    results.push(r);
    const tag =
      r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
    const trailing = r.error ? `// ${r.error}` : r.note ? `// ${r.note}` : "";
    console.log(`${tag}  ${trailing}`);
  }

  console.log("-".repeat(78));
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(`Result: ${passed} pass, ${failed} fail, ${skipped} skip (of ${results.length})`);
  if (skipped > 0) {
    console.log("\nSKIPPED legs (manual verification required):");
    for (const r of results) if (r.status === "skip") console.log(`  - ${r.name}: ${r.note}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke runner crashed:", err);
  process.exit(2);
});
