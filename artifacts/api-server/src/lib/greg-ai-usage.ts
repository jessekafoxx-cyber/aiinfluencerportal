import { db } from "@workspace/db";
import { gregAiUsageSessionsTable } from "@workspace/db";
import { eq, and, sql, gte } from "drizzle-orm";

// Task #762: Platinum Club Greg AI doorway. Platinum members get a hard
// 120-minute (7200s) voice+chat allowance per calendar month, summed from
// greg_ai_usage_sessions and reset automatically on the 1st (no reset job).
// The cap is enforced server-side here, not just in the UI.
export const PLATINUM_GREG_MONTHLY_LIMIT_SECONDS = 7200;

// Start of the current calendar month in UTC. Usage logged on/after this
// instant counts toward the current allowance; everything before it has
// already "reset".
export function currentMonthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

// Start of the next calendar month in UTC - the instant the allowance resets.
export function nextMonthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export type PlatinumGregUsageSnapshot = {
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  canStart: boolean;
  resetsAt: string;
};

// Sum the caller's voice+chat seconds for the current calendar month and
// derive the allowance snapshot returned to the client.
export async function getPlatinumGregUsageSnapshot(userId: number): Promise<PlatinumGregUsageSnapshot> {
  const monthStart = currentMonthStartUtc();
  const [row] = await db
    .select({
      used: sql<number>`COALESCE(SUM(${gregAiUsageSessionsTable.durationSeconds}), 0)::int`,
    })
    .from(gregAiUsageSessionsTable)
    .where(
      and(
        eq(gregAiUsageSessionsTable.userId, userId),
        gte(gregAiUsageSessionsTable.startedAt, monthStart),
      ),
    );

  const usedSeconds = Math.max(0, Number(row?.used ?? 0));
  const limitSeconds = PLATINUM_GREG_MONTHLY_LIMIT_SECONDS;
  const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
  return {
    usedSeconds,
    limitSeconds,
    remainingSeconds,
    canStart: remainingSeconds > 0,
    resetsAt: nextMonthStartUtc().toISOString(),
  };
}

// Task #764: namespace for the per-user transaction-scoped advisory lock that
// serializes concurrent heartbeat writes for the same user, so the
// remaining-allowance cap is computed against a stable total.
const PLATINUM_GREG_USAGE_LOCK_NAMESPACE = 764001;

// Task #764: idempotently record a heartbeat-or-final usage report.
//
// The client posts the CUMULATIVE elapsed seconds for an in-progress session,
// keyed by a client-generated `sessionKey`, every ~15s while a voice call or
// chat view is open (and once more on a clean end). We upsert ONE row per
// session keyed by (userId, sessionKey), so:
//   - a hard tab-close / crash only loses the last heartbeat interval, never
//     the whole session (the previous heartbeat already persisted the time);
//   - replays and out-of-order deliveries are harmless (cumulative + GREATEST
//     guard means the value only ever climbs toward the true elapsed time).
// The duration is capped at the remaining monthly allowance so a long session
// can never push usage past the cap.
export async function recordPlatinumGregUsageHeartbeat(
  userId: number,
  channel: "voice" | "chat",
  sessionKey: string,
  cumulativeSeconds: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${PLATINUM_GREG_USAGE_LOCK_NAMESPACE}, ${userId})`,
    );

    const monthStart = currentMonthStartUtc();

    // Total seconds already counted this month across ALL of this user's
    // sessions (including the row we're about to update, if it exists).
    const [totalRow] = await tx
      .select({
        used: sql<number>`COALESCE(SUM(${gregAiUsageSessionsTable.durationSeconds}), 0)::int`,
      })
      .from(gregAiUsageSessionsTable)
      .where(
        and(
          eq(gregAiUsageSessionsTable.userId, userId),
          gte(gregAiUsageSessionsTable.startedAt, monthStart),
        ),
      );
    const totalUsed = Math.max(0, Number(totalRow?.used ?? 0));

    // The existing row for this exact session (if any).
    const [existing] = await tx
      .select({
        id: gregAiUsageSessionsTable.id,
        durationSeconds: gregAiUsageSessionsTable.durationSeconds,
      })
      .from(gregAiUsageSessionsTable)
      .where(
        and(
          eq(gregAiUsageSessionsTable.userId, userId),
          eq(gregAiUsageSessionsTable.sessionKey, sessionKey),
        ),
      )
      .limit(1);

    const existingDuration = existing ? Math.max(0, existing.durationSeconds) : 0;
    // Seconds used by every OTHER session this month.
    const usedByOthers = Math.max(0, totalUsed - existingDuration);
    // How much THIS session may grow to without overshooting the cap.
    const cap = Math.max(0, PLATINUM_GREG_MONTHLY_LIMIT_SECONDS - usedByOthers);
    // Never let a late/reordered heartbeat shrink the recorded duration.
    const candidate = Math.max(existingDuration, Math.floor(cumulativeSeconds));
    const newDuration = Math.min(candidate, cap);

    if (existing) {
      if (newDuration !== existingDuration) {
        await tx
          .update(gregAiUsageSessionsTable)
          .set({ durationSeconds: newDuration })
          .where(eq(gregAiUsageSessionsTable.id, existing.id));
      }
    } else if (newDuration > 0) {
      await tx.insert(gregAiUsageSessionsTable).values({
        userId,
        channel,
        sessionKey,
        durationSeconds: newDuration,
        startedAt: new Date(),
      });
    }
  });
}
