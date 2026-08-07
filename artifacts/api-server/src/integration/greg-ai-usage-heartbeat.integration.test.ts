// Task #768 integration test: recordPlatinumGregUsageHeartbeat (Task #764).
//
// The Platinum Greg AI heartbeat upsert has subtle correctness rules that no
// automated test covered until now. A future refactor could silently
// reintroduce lost-time or double-count bugs, so this is the regression lock.
//
// Runs against the real Postgres pointed at by DATABASE_URL because the helper
// uses real SQL (per-user transaction-scoped advisory locks + a cumulative
// GREATEST-style guard + a unique index that treats NULL session_key rows as
// distinct). All of that only exercises correctly against a live DB.
//
// greg_ai_usage_sessions has no FK on user_id, so each test invents a unique
// random userId and cleans up its own rows in `after`, keeping the suite
// isolated from real portal data.
//
// Covers:
//   1. Repeated heartbeats for one sessionKey -> exactly ONE row that only
//      grows toward the true cumulative elapsed time.
//   2. Out-of-order / smaller cumulative values never shrink the row.
//   3. Total usage is capped at the monthly allowance across MULTIPLE
//      sessions, without double-deducting a session's own existing row.
//   4. Legacy NULL-sessionKey rows (the pre-heartbeat one-shot shape) insert
//      independently and never collide on the unique index.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[greg-ai-usage-heartbeat.integration.test] DATABASE_URL must be set; " +
      "this integration test is the regression lock for the Platinum Greg AI " +
      "heartbeat upsert and must actually run against a live DB.",
  );
}

const { db, gregAiUsageSessionsTable, pool } = await import("@workspace/db");
const { eq, and, inArray, isNull } = await import("drizzle-orm");
const {
  recordPlatinumGregUsageHeartbeat,
  getPlatinumGregUsageSnapshot,
  PLATINUM_GREG_MONTHLY_LIMIT_SECONDS,
} = await import("../lib/greg-ai-usage.ts");

// Track every userId we touch so cleanup is exhaustive even if an assert
// throws mid-test.
const usedUserIds: number[] = [];

// Pick a userId that is astronomically unlikely to collide with a real
// portal_users.id, and remember it for teardown.
function freshUserId(): number {
  // 900_000_000 + random keeps us well above any real serial id while
  // staying inside the 32-bit int4 range of greg_ai_usage_sessions.user_id.
  const id = 900_000_000 + crypto.randomInt(0, 90_000_000);
  usedUserIds.push(id);
  return id;
}

async function rowsFor(userId: number) {
  return db
    .select({
      id: gregAiUsageSessionsTable.id,
      channel: gregAiUsageSessionsTable.channel,
      sessionKey: gregAiUsageSessionsTable.sessionKey,
      durationSeconds: gregAiUsageSessionsTable.durationSeconds,
    })
    .from(gregAiUsageSessionsTable)
    .where(eq(gregAiUsageSessionsTable.userId, userId));
}

before(() => {
  // Sanity: the cap math below assumes the documented 7200s allowance.
  assert.equal(PLATINUM_GREG_MONTHLY_LIMIT_SECONDS, 7200);
});

after(async () => {
  if (usedUserIds.length > 0) {
    await db
      .delete(gregAiUsageSessionsTable)
      .where(inArray(gregAiUsageSessionsTable.userId, usedUserIds))
      .catch(() => {});
  }
  try {
    await pool.end();
  } catch {
    /* noop */
  }
});

test("repeated heartbeats for one sessionKey produce one row that only grows", async () => {
  const userId = freshUserId();
  const sessionKey = `sess_${crypto.randomBytes(6).toString("hex")}`;

  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 15);
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 30);
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 47);

  const rows = await rowsFor(userId);
  assert.equal(rows.length, 1, "exactly one row per (userId, sessionKey)");
  assert.equal(rows[0]!.durationSeconds, 47, "row grows to the latest cumulative value");
  assert.equal(rows[0]!.channel, "voice");

  const snap = await getPlatinumGregUsageSnapshot(userId);
  assert.equal(snap.usedSeconds, 47);
  assert.equal(snap.remainingSeconds, PLATINUM_GREG_MONTHLY_LIMIT_SECONDS - 47);
  assert.equal(snap.canStart, true);

  // A replay of an already-seen value is a no-op (still one row, same value).
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 47);
  const after = await rowsFor(userId);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.durationSeconds, 47);
});

test("out-of-order / smaller cumulative values never shrink the row", async () => {
  const userId = freshUserId();
  const sessionKey = `sess_${crypto.randomBytes(6).toString("hex")}`;

  await recordPlatinumGregUsageHeartbeat(userId, "chat", sessionKey, 100);
  await recordPlatinumGregUsageHeartbeat(userId, "chat", sessionKey, 300);
  // A late/reordered heartbeat carrying a SMALLER cumulative value arrives.
  await recordPlatinumGregUsageHeartbeat(userId, "chat", sessionKey, 200);
  // ...and a zero, which must also be ignored.
  await recordPlatinumGregUsageHeartbeat(userId, "chat", sessionKey, 0);

  const rows = await rowsFor(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.durationSeconds, 300, "duration never shrinks below its peak");
});

test("fractional cumulative seconds are floored, not rounded up", async () => {
  const userId = freshUserId();
  const sessionKey = `sess_${crypto.randomBytes(6).toString("hex")}`;

  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 12.9);
  const rows = await rowsFor(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.durationSeconds, 12, "12.9s floors to 12, never overcounts");
});

test("total is capped at the monthly allowance across multiple sessions", async () => {
  const userId = freshUserId();
  const sessionA = `sess_${crypto.randomBytes(6).toString("hex")}`;
  const sessionB = `sess_${crypto.randomBytes(6).toString("hex")}`;

  // Session A burns almost the whole allowance.
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionA, 7000);
  // Session B then tries to record 500s, but only 200s of headroom remain.
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionB, 500);

  const snap = await getPlatinumGregUsageSnapshot(userId);
  assert.equal(
    snap.usedSeconds,
    PLATINUM_GREG_MONTHLY_LIMIT_SECONDS,
    "combined usage clamps exactly at the 7200s cap",
  );
  assert.equal(snap.remainingSeconds, 0);
  assert.equal(snap.canStart, false);

  const rows = await rowsFor(userId);
  const byKey = new Map(rows.map((r) => [r.sessionKey, r.durationSeconds]));
  assert.equal(byKey.get(sessionA), 7000);
  assert.equal(byKey.get(sessionB), 200, "session B clamps to the remaining 200s headroom");

  // A further heartbeat on session B while already at the cap must NOT push
  // total usage past 7200, and must NOT double-deduct session B's own row
  // (its existing 200s are excluded from "used by others" before capping).
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionB, 900);
  const after = await rowsFor(userId);
  const afterByKey = new Map(after.map((r) => [r.sessionKey, r.durationSeconds]));
  assert.equal(afterByKey.get(sessionB), 200, "session B stays clamped at 200s, no double-deduct");
  const snap2 = await getPlatinumGregUsageSnapshot(userId);
  assert.equal(snap2.usedSeconds, PLATINUM_GREG_MONTHLY_LIMIT_SECONDS);
});

test("growing an existing capped session does not double-deduct its own row", async () => {
  const userId = freshUserId();
  const sessionA = `sess_${crypto.randomBytes(6).toString("hex")}`;
  const sessionB = `sess_${crypto.randomBytes(6).toString("hex")}`;

  // Two modest sessions, total 3000s, leaving 4200s of headroom.
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionA, 2000);
  await recordPlatinumGregUsageHeartbeat(userId, "chat", sessionB, 1000);

  // Session A grows. usedByOthers must be 1000 (session B only), so A's cap is
  // 6200 - it should be allowed to reach 5000 freely, NOT be choked by treating
  // its own existing 2000s as "other" usage.
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionA, 5000);

  const rows = await rowsFor(userId);
  const byKey = new Map(rows.map((r) => [r.sessionKey, r.durationSeconds]));
  assert.equal(byKey.get(sessionA), 5000, "session A grows to 5000 without self-collision");
  assert.equal(byKey.get(sessionB), 1000);

  const snap = await getPlatinumGregUsageSnapshot(userId);
  assert.equal(snap.usedSeconds, 6000);
});

test("legacy NULL-sessionKey rows insert independently and never collide", async () => {
  const userId = freshUserId();

  // Simulate the pre-heartbeat one-shot shape: rows written with NULL
  // session_key. Postgres treats NULLs as distinct in a unique index, so two
  // such rows must coexist rather than upserting into one.
  await db.insert(gregAiUsageSessionsTable).values({
    userId,
    channel: "voice",
    sessionKey: null,
    durationSeconds: 120,
    startedAt: new Date(),
  });
  await db.insert(gregAiUsageSessionsTable).values({
    userId,
    channel: "chat",
    sessionKey: null,
    durationSeconds: 80,
    startedAt: new Date(),
  });

  const legacyRows = await db
    .select({ id: gregAiUsageSessionsTable.id })
    .from(gregAiUsageSessionsTable)
    .where(
      and(
        eq(gregAiUsageSessionsTable.userId, userId),
        isNull(gregAiUsageSessionsTable.sessionKey),
      ),
    );
  assert.equal(legacyRows.length, 2, "two NULL-session_key rows coexist (NULLs are distinct)");

  // A keyed heartbeat for the same user adds a THIRD, independent row and the
  // snapshot sums all three.
  const sessionKey = `sess_${crypto.randomBytes(6).toString("hex")}`;
  await recordPlatinumGregUsageHeartbeat(userId, "voice", sessionKey, 50);

  const snap = await getPlatinumGregUsageSnapshot(userId);
  assert.equal(snap.usedSeconds, 250, "120 + 80 legacy + 50 keyed = 250");
  const allRows = await rowsFor(userId);
  assert.equal(allRows.length, 3);
});
