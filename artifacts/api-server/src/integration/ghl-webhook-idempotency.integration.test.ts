// Task regression lock: GHL purchase webhook idempotency / out-of-order safety.
//
// Boots a tiny Express app mounting only the ghl-purchase-webhook router
// against the real Postgres (DATABASE_URL) and exercises the riskiest
// webhook orderings:
//
//   1. bad / missing secret        -> 401 (logged, no state change)
//   2. unknown product slug        -> 404
//   3. duplicate grant             -> alreadyGranted, access intact
//   4. revoke BEFORE any grant     -> 200 noop, must not create/strip access
//   5. revoke with a coexisting legacy Stripe paid orders row
//                                  -> legacy flags survive, user stays active
//   6. two products sharing an entitlement key: revoking one must NOT
//      un-flip the key while the other purchase remains active; revoking
//      the second finally clears it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[ghl-webhook-idempotency.integration.test] DATABASE_URL must be set; " +
      "this is the regression lock for duplicate/out-of-order GHL webhooks.",
  );
}

const { db, ordersTable, portalUsersTable, productsTable, purchasesTable, pool } =
  await import("@workspace/db");
const { eq, sql, inArray } = await import("drizzle-orm");
const { getWebhookSecret } = await import("../lib/ghl-settings.ts");
const expressMod = await import("express");
const express = expressMod.default;
const webhookRouter = (await import("../routes/ghl-purchase-webhook.ts")).default;

const RUN = crypto.randomBytes(4).toString("hex");
const EMAIL = `ghl-idem-${RUN}@integration.test`;
const EMAIL_NOOP = `ghl-idem-noop-${RUN}@integration.test`;
const SLUG_MAIN = `ghl-idem-main-${RUN}`;
const SLUG_A = `ghl-idem-shared-a-${RUN}`;
const SLUG_B = `ghl-idem-shared-b-${RUN}`;
const ALL_SLUGS = [SLUG_MAIN, SLUG_A, SLUG_B];
const ALL_EMAILS = [EMAIL, EMAIL_NOOP];

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  (req as any).log = { info: () => {}, warn: () => {}, error: () => {} };
  next();
});
app.use("/api", webhookRouter);

let server: http.Server | undefined;
let baseUrl = "";
let SECRET = "";

async function cleanup() {
  const users = await db
    .select({ id: portalUsersTable.id })
    .from(portalUsersTable)
    .where(inArray(sql`lower(${portalUsersTable.email})`, ALL_EMAILS));
  for (const u of users) {
    await db.delete(purchasesTable).where(eq(purchasesTable.userId, u.id));
  }
  await db.delete(ordersTable).where(inArray(sql`lower(${ordersTable.email})`, ALL_EMAILS));
  await db.delete(productsTable).where(inArray(productsTable.slug, ALL_SLUGS));
  await db
    .delete(portalUsersTable)
    .where(inArray(sql`lower(${portalUsersTable.email})`, ALL_EMAILS));
}

before(async () => {
  await cleanup();
  SECRET = await getWebhookSecret();
  await db.insert(productsTable).values([
    {
      name: "Idem Main Product",
      slug: SLUG_MAIN,
      kind: "main",
      grantsFullPortal: true,
      entitlements: ["dfy_pack"],
      active: true,
    },
    {
      name: "Idem Shared A",
      slug: SLUG_A,
      kind: "addon",
      grantsFullPortal: false,
      entitlements: ["portfolio"],
      active: true,
    },
    {
      name: "Idem Shared B",
      slug: SLUG_B,
      kind: "addon",
      grantsFullPortal: false,
      entitlements: ["portfolio", "hook_demo"],
      active: true,
    },
  ]);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await cleanup();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  try {
    await pool.end();
  } catch {
    /* noop */
  }
});

async function post(
  body: unknown,
  opts: { secret?: string } = {},
): Promise<{ status: number; json: any }> {
  const secret = opts.secret ?? SECRET;
  const res = await fetch(`${baseUrl}/api/public/webhooks/ghl`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-webhook-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function ghlOrderRows(email: string) {
  return db
    .select()
    .from(ordersTable)
    .where(
      sql`lower(${ordersTable.email}) = ${email} and ${ordersTable.paymentSourceType} = 'ghl_verified_payment'`,
    );
}

async function portalUser(email: string) {
  const [u] = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${email}`);
  return u;
}

test("401 on missing or wrong secret; no user is created", async () => {
  const missing = await post({ email: EMAIL, product: SLUG_MAIN }, { secret: "" });
  assert.equal(missing.status, 401);
  const wrong = await post({ email: EMAIL, product: SLUG_MAIN }, { secret: "whsec_wrong" });
  assert.equal(wrong.status, 401);
  assert.equal(await portalUser(EMAIL), undefined, "rejected delivery must not create a user");
});

test("404 on unknown product slug", async () => {
  const r = await post({ email: EMAIL, product: `no-such-product-${RUN}` });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "unknown_product");
});

test("revoke BEFORE any grant is a safe noop", async () => {
  const r = await post({ email: EMAIL_NOOP, product: SLUG_MAIN, action: "revoke" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.revoked, []);
  const u = await portalUser(EMAIL_NOOP);
  assert.ok(u, "revoke path creates the shell user row");
  assert.equal(u.isActive, false, "an out-of-order revoke must never activate anyone");
  assert.equal((await ghlOrderRows(EMAIL_NOOP)).length, 0, "no orders row should be created");
});

test("duplicate grants collapse to one purchase; access stays intact", async () => {
  const first = await post({ email: EMAIL, name: "Idem Tester", product: SLUG_MAIN });
  assert.equal(first.status, 200);
  assert.equal(first.json.alreadyGranted, false);
  assert.ok(first.json.granted.includes("portal_access"));

  const replay = await post({ email: EMAIL, product: SLUG_MAIN });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.alreadyGranted, true);

  const user = await portalUser(EMAIL);
  assert.equal(user.isActive, true);
  const purchases = await db
    .select()
    .from(purchasesTable)
    .where(eq(purchasesTable.userId, user.id));
  assert.equal(purchases.length, 1, "duplicate webhook must not create a second ledger row");

  const rows = await ghlOrderRows(EMAIL);
  assert.equal(rows.length, 1, "grants share one dedicated GHL orders row");
  assert.equal(rows[0].mainProductPaid, true);
  assert.equal(rows[0].doneForYouPackPaid, true);
});

test("revoke with coexisting legacy Stripe paid order keeps access", async () => {
  await db.insert(ordersTable).values({
    id: `legacy-idem-${RUN}`,
    email: EMAIL,
    mainProductPaid: true,
    doneForYouPackPaid: true,
    paymentSourceType: "stripe_verified_payment",
    grantReason: "integration-test legacy evidence",
    paymentVerified: true,
    receiptVerified: true,
    totalAmount: 2700,
  });

  const r = await post({ email: EMAIL, product: SLUG_MAIN, action: "revoke" });
  assert.equal(r.status, 200);
  assert.ok(r.json.revoked.includes("portal_access"));

  const all = await db
    .select()
    .from(ordersTable)
    .where(sql`lower(${ordersTable.email}) = ${EMAIL}`);
  const legacy = all.find((o) => o.paymentSourceType === "stripe_verified_payment")!;
  const ghl = all.find((o) => o.paymentSourceType === "ghl_verified_payment")!;
  assert.equal(legacy.mainProductPaid, true, "legacy Stripe evidence must never be un-flipped");
  assert.equal(legacy.doneForYouPackPaid, true);
  assert.equal(ghl.mainProductPaid, false, "GHL-owned flags are reversed");
  assert.equal(ghl.doneForYouPackPaid, false);

  const user = await portalUser(EMAIL);
  assert.equal(user.isActive, true, "buyer must stay active while legacy paid order exists");

  // Duplicate revoke: safe noop.
  const replay = await post({ email: EMAIL, product: SLUG_MAIN, action: "revoke" });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.json.revoked, []);
  assert.equal((await portalUser(EMAIL)).isActive, true);
});

test("shared entitlement key survives until the LAST granting purchase is revoked", async () => {
  const a = await post({ email: EMAIL, product: SLUG_A });
  const b = await post({ email: EMAIL, product: SLUG_B });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  let [row] = await ghlOrderRows(EMAIL);
  assert.equal(row.portfolioPaid, true);
  assert.equal(row.hookDemoPaid, true);

  // Revoke A: portfolio still granted by B, must be preserved.
  const revokeA = await post({ email: EMAIL, product: SLUG_A, action: "revoke" });
  assert.equal(revokeA.status, 200);
  assert.deepEqual(revokeA.json.revoked, [], "portfolio is still covered by product B");
  [row] = await ghlOrderRows(EMAIL);
  assert.equal(row.portfolioPaid, true, "shared key must survive revoking one of two products");
  assert.equal(row.hookDemoPaid, true);

  // Revoke B: now nothing grants portfolio or hook_demo.
  const revokeB = await post({ email: EMAIL, product: SLUG_B, action: "revoke" });
  assert.equal(revokeB.status, 200);
  assert.ok(revokeB.json.revoked.includes("portfolio"));
  assert.ok(revokeB.json.revoked.includes("hook_demo"));
  [row] = await ghlOrderRows(EMAIL);
  assert.equal(row.portfolioPaid, false);
  assert.equal(row.hookDemoPaid, false);
});
