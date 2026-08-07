// Integration regression lock: GHL grant retry-safety (partial-failure heal).
//
// Failure mode being locked out: the grant path inserts the `purchases`
// ledger row FIRST (its partial unique active index is the idempotency
// gate) and then applies entitlement side effects (portal_users.is_active,
// orders.*_paid on a dedicated ghl_verified_payment row). If the first
// attempt crashes between those two steps, a replayed grant must NOT
// no-op on the ledger conflict — it must re-apply the (idempotent) side
// effects and heal the buyer's access.
//
// Also locks the revoke isolation contract: revoking a GHL product must
// never un-flip flags on a legacy (non-GHL) paid orders row, and must not
// deactivate a user whose access is still proven by that legacy row.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[ghl-grant-retry.integration.test] DATABASE_URL must be set; this test " +
      "is the regression lock for GHL grant retry-safety and must actually run.",
  );
}

const { db, ordersTable, portalUsersTable, productsTable, purchasesTable, pool } =
  await import("@workspace/db");
const { eq, sql } = await import("drizzle-orm");
const { grantProductToUser, revokeProductFromUser, findOrCreateUserByEmail } =
  await import("../lib/ghl-entitlements.ts");

const EMAIL = `ghl-retry-${Date.now()}@integration.test`;
const SLUG = `ghl-retry-test-${Date.now()}`;

async function cleanup() {
  const users = await db
    .select({ id: portalUsersTable.id })
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = ${EMAIL}`);
  for (const u of users) {
    await db.delete(purchasesTable).where(eq(purchasesTable.userId, u.id));
  }
  await db.delete(ordersTable).where(sql`lower(${ordersTable.email}) = ${EMAIL}`);
  await db.delete(productsTable).where(eq(productsTable.slug, SLUG));
  await db.delete(portalUsersTable).where(sql`lower(${portalUsersTable.email}) = ${EMAIL}`);
}

before(cleanup);
after(async () => {
  await cleanup();
  await pool.end();
});

test("replayed grant heals a partial failure (ledger row without side effects)", async () => {
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Retry Test Product",
      slug: SLUG,
      kind: "main",
      grantsFullPortal: true,
      entitlements: ["dfy_pack"],
      active: true,
    })
    .returning();
  const { user } = await findOrCreateUserByEmail(EMAIL, "Retry Tester");

  // Simulate a crash after the ledger insert, before any side effects:
  await db.insert(purchasesTable).values({
    userId: user.id,
    productId: product.id,
    source: "webhook",
    metadata: { receiptId: "r-partial-test" },
  });

  // Replay. Must report alreadyGranted AND heal the missing side effects.
  const result = await grantProductToUser(user, product);
  assert.equal(result.alreadyGranted, true);

  const [freshUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, user.id));
  assert.equal(freshUser.isActive, true, "replay must activate the stranded buyer");

  const ghlOrders = await db
    .select()
    .from(ordersTable)
    .where(
      sql`lower(${ordersTable.email}) = ${EMAIL} and ${ordersTable.paymentSourceType} = 'ghl_verified_payment'`,
    );
  assert.equal(ghlOrders.length, 1, "grant must write to a dedicated GHL orders row");
  assert.equal(ghlOrders[0].mainProductPaid, true);
  assert.equal(ghlOrders[0].doneForYouPackPaid, true);
});

test("revoking the GHL product never touches legacy paid rows or deactivates users they cover", async () => {
  // Legacy (non-GHL) paid evidence for the same email:
  await db.insert(ordersTable).values({
    id: `legacy-test-${Date.now()}`,
    email: EMAIL,
    mainProductPaid: true,
    doneForYouPackPaid: true,
    paymentSourceType: "stripe_verified_payment",
    grantReason: "integration-test",
    paymentVerified: true,
    receiptVerified: true,
    totalAmount: 2700,
  });

  const [product] = await db.select().from(productsTable).where(eq(productsTable.slug, SLUG));
  const { user } = await findOrCreateUserByEmail(EMAIL);

  const revoked = await revokeProductFromUser(user, product);
  assert.ok(revoked.includes("portal_access"));

  const rows = await db
    .select()
    .from(ordersTable)
    .where(sql`lower(${ordersTable.email}) = ${EMAIL}`);
  const legacy = rows.find((r) => r.paymentSourceType === "stripe_verified_payment");
  const ghl = rows.find((r) => r.paymentSourceType === "ghl_verified_payment");
  assert.ok(legacy && ghl);
  assert.equal(legacy.mainProductPaid, true, "legacy paid evidence must survive a GHL revoke");
  assert.equal(legacy.doneForYouPackPaid, true);
  assert.equal(ghl.mainProductPaid, false, "GHL-owned flags must be un-flipped");
  assert.equal(ghl.doneForYouPackPaid, false);

  const [freshUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, user.id));
  assert.equal(
    freshUser.isActive,
    true,
    "user must stay active while legacy paid evidence remains",
  );
});
