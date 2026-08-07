// Task #700 integration test: /api/portal/ghl/platinum-reactivate.
//
// Boots a tiny Express app mounting only the ghl-platinum-reactivate
// router against the real Postgres pointed at by DATABASE_URL, then
// exercises:
//
//   1. Missing GHL_WEBHOOK_SECRET env  -> 503
//   2. Bad / missing X-GHL-Webhook-Secret header -> 401
//   3. Valid secret + unknown email -> 200 ordersAffected:0
//   4. Trial-path order (productSlugs contains `upsell3`) gets
//      `upsell3Paid` re-flipped to true on first call, `platinumPaid`
//      stays false (mutual exclusion). Replay returns 200 with
//      `reactivated.upsell3Paid=false` (idempotent).
//   5. Standalone Platinum order (productSlugs=`platinum-club`) gets
//      `platinumPaid` re-flipped to true; `upsell3Paid` stays false.
//
// The route writes through markStripeOrderPaid(), which fires KIT /
// WATI side-effects through dynamic imports wrapped in try/catch, so
// those will fail-soft if their env vars are missing - intentional.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[ghl-platinum-reactivate.integration.test] DATABASE_URL must be set; " +
      "this integration test is the regression lock for the Platinum " +
      "reactivate webhook and must actually run.",
  );
}

const TEST_SECRET =
  "test-ghl-secret-" + crypto.randomBytes(8).toString("hex");

const { db, ordersTable, pool } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const expressMod = await import("express");
const express = expressMod.default;
const routerMod = await import("../routes/ghl-platinum-reactivate.ts");
const platinumReactivateRouter = routerMod.default;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  (req as any).log = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  next();
});
app.use("/api", platinumReactivateRouter);

let server: http.Server | undefined;
let baseUrl = "";
const seededOrderIds: string[] = [];

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  for (const id of seededOrderIds) {
    await db
      .delete(ordersTable)
      .where(eq(ordersTable.id, id))
      .catch(() => {});
  }
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  try {
    await pool.end();
  } catch {
    /* noop */
  }
});

async function postReactivate(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/portal/ghl/platinum-reactivate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test("503 when GHL_WEBHOOK_SECRET is unset", async () => {
  const prior = process.env.GHL_WEBHOOK_SECRET;
  delete process.env.GHL_WEBHOOK_SECRET;
  try {
    const r = await postReactivate(
      { email: "nobody@example.test" },
      { "x-ghl-webhook-secret": "anything" },
    );
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "ghl_webhook_disabled");
  } finally {
    if (prior !== undefined) process.env.GHL_WEBHOOK_SECRET = prior;
  }
});

test("401 when secret header is missing or wrong", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const missing = await postReactivate({ email: "nobody@example.test" });
  assert.equal(missing.status, 401);
  const wrong = await postReactivate(
    { email: "nobody@example.test" },
    { "x-ghl-webhook-secret": "wrong-secret" },
  );
  assert.equal(wrong.status, 401);
});

test("200 with ordersAffected:0 when email matches no paid order", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `nomatch+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const r = await postReactivate(
    { email, reason: "reactivation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.ordersAffected, 0);
  assert.equal(r.json.reactivated.platinumPaid, false);
  assert.equal(r.json.reactivated.upsell3Paid, false);
  assert.equal(r.json.alreadyActive, true);
});

test("trial-path order: flips upsell3Paid back to true, idempotent on replay", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `react-trial+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const orderId = `stripe_test_${crypto.randomBytes(6).toString("hex")}`;
  seededOrderIds.push(orderId);

  await db.insert(ordersTable).values({
    id: orderId,
    email,
    mainProductPaid: true,
    platinumPaid: false,
    upsell3Paid: false,
    totalAmount: 2700,
    currentStep: "thank-you",
    productSlugs: "main+upsell3",
    paymentSourceType: "stripe_verified_payment",
    grantReason: "test seed for #700 trial path",
    paymentVerified: true,
    receiptVerified: true,
    stripePaymentIntentId: `pi_test_${crypto.randomBytes(6).toString("hex")}`,
    stripeSubscriptionId: `sub_test_${crypto.randomBytes(6).toString("hex")}`,
  });

  const first = await postReactivate(
    { email, reason: "vip_club_reactivation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.ordersAffected, 1);
  assert.equal(first.json.reactivated.upsell3Paid, true);
  assert.equal(first.json.reactivated.platinumPaid, false);
  assert.equal(first.json.alreadyActive, false);

  const [afterRow] = await db
    .select({
      platinumPaid: ordersTable.platinumPaid,
      upsell3Paid: ordersTable.upsell3Paid,
      mainProductPaid: ordersTable.mainProductPaid,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  assert.equal(afterRow!.upsell3Paid, true, "upsell3Paid must flip to true");
  assert.equal(
    afterRow!.platinumPaid,
    false,
    "platinumPaid must stay false for trial-path orders (mutual exclusion)",
  );
  assert.equal(
    afterRow!.mainProductPaid,
    true,
    "mainProductPaid must NOT be touched - Platinum-only scope",
  );

  // Replay: already true -> ordersAffected 0.
  const replay = await postReactivate(
    { email, reason: "vip_club_reactivation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.json.ok, true);
  assert.equal(replay.json.ordersAffected, 0);
  assert.equal(replay.json.reactivated.platinumPaid, false);
  assert.equal(replay.json.reactivated.upsell3Paid, false);
  assert.equal(replay.json.alreadyActive, true);
});

test("main-only order: webhook must NOT grant Platinum to a buyer who never had it", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `react-main-only+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const orderId = `stripe_test_${crypto.randomBytes(6).toString("hex")}`;
  seededOrderIds.push(orderId);

  await db.insert(ordersTable).values({
    id: orderId,
    email,
    mainProductPaid: true,
    platinumPaid: false,
    upsell3Paid: false,
    totalAmount: 2700,
    currentStep: "thank-you",
    productSlugs: "main",
    paymentSourceType: "stripe_verified_payment",
    grantReason: "test seed for #700 main-only negative",
    paymentVerified: true,
    receiptVerified: true,
    stripePaymentIntentId: `pi_test_${crypto.randomBytes(6).toString("hex")}`,
  });

  const r = await postReactivate(
    { email, reason: "vip_club_reactivation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.ordersAffected, 0);
  assert.equal(r.json.reactivated.platinumPaid, false);
  assert.equal(r.json.reactivated.upsell3Paid, false);
  assert.equal(r.json.alreadyActive, true);

  const [afterRow] = await db
    .select({
      platinumPaid: ordersTable.platinumPaid,
      upsell3Paid: ordersTable.upsell3Paid,
      mainProductPaid: ordersTable.mainProductPaid,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  assert.equal(
    afterRow!.platinumPaid,
    false,
    "platinumPaid must NOT be granted to a main-only buyer",
  );
  assert.equal(afterRow!.upsell3Paid, false);
  assert.equal(afterRow!.mainProductPaid, true);
});

test("standalone Platinum order: flips platinumPaid back to true, leaves upsell3Paid alone", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `react-standalone+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const orderId = `stripe_test_${crypto.randomBytes(6).toString("hex")}`;
  seededOrderIds.push(orderId);

  await db.insert(ordersTable).values({
    id: orderId,
    email,
    mainProductPaid: true,
    platinumPaid: false,
    upsell3Paid: false,
    totalAmount: 2700,
    currentStep: "thank-you",
    productSlugs: "main+platinum-club",
    paymentSourceType: "stripe_verified_payment",
    grantReason: "test seed for #700 standalone path",
    paymentVerified: true,
    receiptVerified: true,
    stripePaymentIntentId: `pi_test_${crypto.randomBytes(6).toString("hex")}`,
  });

  const first = await postReactivate(
    { email, reason: "vip_club_reactivation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.ordersAffected, 1);
  assert.equal(first.json.reactivated.platinumPaid, true);
  assert.equal(first.json.reactivated.upsell3Paid, false);

  const [afterRow] = await db
    .select({
      platinumPaid: ordersTable.platinumPaid,
      upsell3Paid: ordersTable.upsell3Paid,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  assert.equal(afterRow!.platinumPaid, true, "platinumPaid must flip to true");
  assert.equal(
    afterRow!.upsell3Paid,
    false,
    "upsell3Paid must stay false for standalone Platinum orders",
  );
});
