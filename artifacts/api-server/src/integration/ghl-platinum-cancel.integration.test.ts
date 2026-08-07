// Task #699 integration test: /api/portal/ghl/platinum-cancel.
//
// Boots a tiny Express app mounting only the ghl-platinum-cancel router
// against the real Postgres pointed at by DATABASE_URL, then exercises:
//
//   1. Missing GHL_WEBHOOK_SECRET env  -> 503
//   2. Bad / missing X-GHL-Webhook-Secret header -> 401
//   3. Valid secret + unknown email -> 200 ordersAffected:0
//   4. Happy path: orders row with platinumPaid+upsell3Paid both true
//      gets both flipped to false on the first call, replay returns
//      200 with both `revoked.*` flags false (idempotent).
//
// The route writes through revokeStripeOrderPaid(), which fires KIT /
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
    "[ghl-platinum-cancel.integration.test] DATABASE_URL must be set; " +
      "this integration test is the regression lock for the Platinum " +
      "cancel webhook and must actually run.",
  );
}

const TEST_SECRET =
  "test-ghl-secret-" + crypto.randomBytes(8).toString("hex");

const { db, ordersTable, pool } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const expressMod = await import("express");
const express = expressMod.default;
const routerMod = await import("../routes/ghl-platinum-cancel.ts");
const platinumCancelRouter = routerMod.default;

// Minimal req.log shim so the route's structured logging calls don't
// blow up when we mount it outside the full API server.
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
app.use("/api", platinumCancelRouter);

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

async function postCancel(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/portal/ghl/platinum-cancel`, {
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
    const r = await postCancel(
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
  const missing = await postCancel({ email: "nobody@example.test" });
  assert.equal(missing.status, 401);
  const wrong = await postCancel(
    { email: "nobody@example.test" },
    { "x-ghl-webhook-secret": "wrong-secret" },
  );
  assert.equal(wrong.status, 401);
});

test("200 with ordersAffected:0 when email matches no Platinum row", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `nomatch+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const r = await postCancel(
    { email, reason: "trial_ended" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.ordersAffected, 0);
  assert.equal(r.json.revoked.platinumPaid, false);
  assert.equal(r.json.revoked.upsell3Paid, false);
  assert.equal(r.json.alreadyRevoked, true);
});

test("happy path: flips both Platinum columns, idempotent on replay", async () => {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  const email = `cancel+${crypto.randomBytes(4).toString("hex")}@example.test`;
  const orderId = `stripe_test_${crypto.randomBytes(6).toString("hex")}`;
  seededOrderIds.push(orderId);

  await db.insert(ordersTable).values({
    id: orderId,
    email,
    mainProductPaid: true,
    platinumPaid: true,
    upsell3Paid: true,
    totalAmount: 0,
    currentStep: "thank-you",
    productSlugs: "main+upsell3",
    paymentSourceType: "stripe_verified_payment",
    grantReason: "test seed for #699",
    paymentVerified: true,
    receiptVerified: true,
    stripePaymentIntentId: `pi_test_${crypto.randomBytes(6).toString("hex")}`,
  });

  const first = await postCancel(
    { email, reason: "vip_club_cancelation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.ordersAffected, 1);
  assert.equal(first.json.revoked.platinumPaid, true);
  assert.equal(first.json.revoked.upsell3Paid, true);
  assert.equal(first.json.alreadyRevoked, false);

  const [afterRow] = await db
    .select({
      platinumPaid: ordersTable.platinumPaid,
      upsell3Paid: ordersTable.upsell3Paid,
      mainProductPaid: ordersTable.mainProductPaid,
      grantReason: ordersTable.grantReason,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  assert.equal(afterRow!.platinumPaid, false, "platinumPaid must flip to false");
  assert.equal(afterRow!.upsell3Paid, false, "upsell3Paid must flip to false");
  assert.equal(
    afterRow!.mainProductPaid,
    true,
    "mainProductPaid must NOT be touched - Platinum-only scope",
  );
  assert.match(
    String(afterRow!.grantReason),
    /revoked: ghl_platinum_cancel/,
    "grant_reason must carry the ghl_platinum_cancel provenance",
  );

  // Replay: both already false -> ordersAffected 0, revoked flags false.
  const replay = await postCancel(
    { email, reason: "vip_club_cancelation_test" },
    { "x-ghl-webhook-secret": TEST_SECRET },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.json.ok, true);
  assert.equal(replay.json.ordersAffected, 0);
  assert.equal(replay.json.revoked.platinumPaid, false);
  assert.equal(replay.json.revoked.upsell3Paid, false);
  assert.equal(replay.json.alreadyRevoked, true);
});
