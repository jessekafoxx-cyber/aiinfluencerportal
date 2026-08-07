// Task #720 integration test: POST /api/portal/influencer-jobs quota gate.
//
// Regression lock for the wedge where a buyer could double-click the
// "Generate" button and sneak a second AI Influencer job past the
// portfolioPaid 6-build cap that the UI was already showing as
// "CAP REACHED". The route at routes/influencer-jobs.ts and the UI
// both call resolveInfluencerQuota() now (Task #718), but no test
// asserts the server-side gate at /api/portal/influencer-jobs actually
// rejects a concurrent over-cap submit with 402 quota_exceeded.
//
// Covers:
//   1. portfolioPaid-only buyer with 6 existing non-failed jobs -> 402
//      quota_exceeded { used: 6, total: 6 }.
//   2. No-SKU buyer with 1 existing non-failed job -> 402
//      quota_exceeded { used: 1, total: 1 }.
//   3. Optional race: two concurrent POSTs from a buyer at 5/6 - at
//      least one must succeed; if BOTH succeed we flag it as a real
//      bug (the route has no DB-level guard against the race today).
//
// Outbound HTTP to Clerk is intercepted via a global fetch stub
// installed BEFORE any workspace import so the requireAuth email-
// backfill lookup never reaches the real Clerk backend. Pre-seeding
// the app_users + portal_users rows means requireAuth never needs to
// invent an email anyway, but the stub is a defense-in-depth so any
// future requireAuth change cannot leak network during tests.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Router } from "express";

// ---- env wiring (must run BEFORE any workspace import) -------------------
process.env.NODE_ENV = "test";
process.env.MT_TEST_BYPASS = "1";
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ??
  "sk_test_" + crypto.randomBytes(12).toString("hex");
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-do-not-use-in-prod";
// Keep the buyer-facing internal Higgsfield/Enhancor pipeline OFF (the
// default since Task #708) so the preflight gate in the route does not
// require provider health to be green for the enqueue to be reachable.
delete process.env.INFLUENCER_INTERNAL_PIPELINE_ENABLED;
// Mute the Viktor / Monday side-effects: they fail-soft when their env
// vars are unset, which is exactly what we want here.
delete process.env.VIKTOR_SLACK_WEBHOOK_URL;
delete process.env.MONDAY_API_TOKEN;
delete process.env.MONDAY_API;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[influencer-jobs-quota.integration.test] DATABASE_URL must be set; " +
      "this integration test is the regression lock for the AI Influencer " +
      "cap gate and must actually run.",
  );
}

// ---- global fetch stub ---------------------------------------------------
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const stubFetch: typeof fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("api.clerk.com") || url.includes("api.clerk.dev")) {
    // Pretend the user doesn't exist. requireAuth wraps this in
    // try/catch so a 404 here is harmless - the pre-seeded app_users /
    // portal_users rows are what the route actually reads.
    return jsonResponse({ errors: [{ code: "not_found" }] }, 404);
  }
  return realFetch(input, init);
};
globalThis.fetch = stubFetch;

// ---- Lazy-import workspace modules AFTER env + fetch are wired -----------
const {
  db,
  appUsers,
  portalUsersTable,
  ordersTable,
  aiInfluencerJobsTable,
  pool,
} = await import("@workspace/db");
const { eq, inArray } = await import("drizzle-orm");
const expressMod = await import("express");
const express = expressMod.default;
const influencerJobsRouterMod = await import("../routes/influencer-jobs.ts");
const influencerJobsRouter: Router = influencerJobsRouterMod.default;

const app = express();
app.use(express.json({ limit: "5mb" }));
// Minimal req.log shim — the route uses req.log.warn on the preflight
// path and various downstream paths.
app.use((req, _res, next) => {
  (req as any).log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  next();
});
app.use("/api/portal/influencer-jobs", influencerJobsRouter);

let server: http.Server | undefined;
let baseUrl = "";
const seededClerkIds: string[] = [];
const seededAppUserIds: number[] = [];
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
  if (seededAppUserIds.length) {
    await db
      .delete(aiInfluencerJobsTable)
      .where(inArray(aiInfluencerJobsTable.clientId, seededAppUserIds))
      .catch(() => {});
  }
  for (const id of seededOrderIds) {
    await db.delete(ordersTable).where(eq(ordersTable.id, id)).catch(() => {});
  }
  for (const cid of seededClerkIds) {
    await db
      .delete(portalUsersTable)
      .where(eq(portalUsersTable.clerkId, cid))
      .catch(() => {});
    await db.delete(appUsers).where(eq(appUsers.clerkId, cid)).catch(() => {});
  }
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  globalThis.fetch = realFetch;
  try {
    await pool.end();
  } catch {
    /* noop */
  }
});

type Fixture = {
  clerkId: string;
  email: string;
  appUserId: number;
};

async function seedFixture(opts: {
  portfolioPaid: boolean;
  existingJobs: number;
}): Promise<Fixture> {
  const tag = crypto.randomBytes(4).toString("hex");
  const clerkId = `user_test_${tag}`;
  const email = `quota+${tag}@example.test`;
  seededClerkIds.push(clerkId);

  const [appUser] = await db
    .insert(appUsers)
    .values({ clerkId, email, role: "user" })
    .returning();
  seededAppUserIds.push(appUser.id);

  await db.insert(portalUsersTable).values({
    clerkId,
    email,
    portalKey: "room30",
    role: "user",
    isActive: true,
  });

  if (opts.portfolioPaid) {
    const orderId = `test_order_${tag}`;
    seededOrderIds.push(orderId);
    await db.insert(ordersTable).values({
      id: orderId,
      email,
      currentStep: "thank-you",
      mainProductPaid: true,
      portfolioPaid: true,
      totalAmount: 0,
      productSlugs: "main+our-portfolio",
      paymentSourceType: "stripe_verified_payment",
      grantReason: "test seed for #720",
      paymentVerified: true,
      receiptVerified: true,
      stripePaymentIntentId: `pi_test_${tag}`,
    });
  }

  for (let i = 0; i < opts.existingJobs; i++) {
    await db.insert(aiInfluencerJobsTable).values({
      clientId: appUser.id,
      prefs: {
        ageRange: "25-32",
        ethnicity: "white",
        gender: "female",
        vibe: "test fixture",
      },
      status: "queued",
      isFreeTier: true,
      etaAt: new Date(Date.now() + 60_000),
    });
  }

  return { clerkId, email, appUserId: appUser.id };
}

const VALID_BODY = {
  ageRange: "25-32",
  ethnicity: "white",
  gender: "female",
  vibe: "test submit",
};

async function postJob(
  clerkId: string,
): Promise<{ status: number; json: any }> {
  const res = await realFetch(`${baseUrl}/api/portal/influencer-jobs/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-clerk-id": clerkId,
    },
    body: JSON.stringify(VALID_BODY),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test("portfolioPaid buyer at 6/6 cap -> 402 quota_exceeded", async () => {
  const fx = await seedFixture({ portfolioPaid: true, existingJobs: 6 });
  const r = await postJob(fx.clerkId);
  assert.equal(
    r.status,
    402,
    `expected 402 quota_exceeded, got ${r.status}: ${JSON.stringify(r.json)}`,
  );
  assert.equal(r.json.error, "quota_exceeded");
  assert.equal(r.json.used, 6);
  assert.equal(r.json.total, 6);
  assert.equal(r.json.bonusUnlocked, true);

  // And no 7th row was created.
  const rows = await db
    .select({ id: aiInfluencerJobsTable.id })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.clientId, fx.appUserId));
  assert.equal(rows.length, 6, "no 7th ai_influencer_jobs row may exist");
});

test("no-SKU buyer at 1/1 free-tier cap -> 402 quota_exceeded", async () => {
  const fx = await seedFixture({ portfolioPaid: false, existingJobs: 1 });
  const r = await postJob(fx.clerkId);
  assert.equal(
    r.status,
    402,
    `expected 402 quota_exceeded, got ${r.status}: ${JSON.stringify(r.json)}`,
  );
  assert.equal(r.json.error, "quota_exceeded");
  assert.equal(r.json.used, 1);
  assert.equal(r.json.total, 1);
  assert.equal(r.json.bonusUnlocked, false);

  const rows = await db
    .select({ id: aiInfluencerJobsTable.id })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.clientId, fx.appUserId));
  assert.equal(rows.length, 1, "no 2nd ai_influencer_jobs row may exist");
});

test("race: two concurrent POSTs at 5/6 - observes whether both can sneak past the cap", async (t) => {
  const fx = await seedFixture({ portfolioPaid: true, existingJobs: 5 });

  const [a, b] = await Promise.all([postJob(fx.clerkId), postJob(fx.clerkId)]);
  const successes = [a, b].filter((r) => r.status >= 200 && r.status < 300);
  const rejects = [a, b].filter((r) => r.status === 402);

  // Every response must be either a 2xx insert or a 402 quota_exceeded -
  // anything else (500, 503, etc.) means the gate misfired and the
  // soft-check below would mask it.
  assert.equal(
    successes.length + rejects.length,
    2,
    `expected each POST to return either 2xx or 402, got ${a.status}/${b.status}`,
  );

  const rows = await db
    .select({ id: aiInfluencerJobsTable.id })
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.clientId, fx.appUserId));

  // Task #721: the cap is now enforced by a per-client advisory lock +
  // transactional re-count around the insert, so concurrent POSTs can
  // never produce used > total. At most one of the two POSTs may be a
  // 2xx insert, and the table can never grow past the 6-build cap.
  assert.ok(
    successes.length <= 1,
    `concurrent POSTs both inserted past the 6-build cap; ` +
      `successes=${successes.length} statuses=${a.status}/${b.status}`,
  );
  assert.ok(
    rows.length <= 6,
    `ai_influencer_jobs row count exceeded the 6-build cap: rows=${rows.length}`,
  );
  void t;
});
