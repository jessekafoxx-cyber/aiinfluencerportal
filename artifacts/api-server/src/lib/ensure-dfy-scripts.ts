import { db, dfyScriptsTable } from "@workspace/db";
import { sql, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import seed from "./dfy-scripts-seed.json" with { type: "json" };

interface SeedRow {
  type: string;
  hook: string;
  body: string;
  sort_order: number;
}

// Boot installer for the DFY scripts catalog (Done For You Pack >
// "1,000+ Proven AI Influencer Portfolio Scripts"). The seed JSON was
// dumped from dev after running scripts/src/seed-dfy-scripts.ts. This
// hook does two things:
//   1. If the table is empty (fresh DB / first boot in prod): bulk
//      insert every seed row.
//   2. If the table is populated but the seed has MORE rows for any
//      type than the DB currently does (this is what catches the
//      Task #528 regression where prod kept the original 488 rows
//      after dev grew to 1,000+): top-up only the missing tail of
//      each type by inserting seed rows whose sort_order is greater
//      than the current max(sort_order) in the DB. This is idempotent:
//      once max(sort_order) catches up to the seed, the loop no-ops.
// Finally we log a warn if the active-format row count drops below
// 1,000 so the regression is visible in ops logs before a customer
// reports it (the 4 active formats are the ones the portal renders).
const ADVISORY_LOCK_KEY = 8472610954183267839n;

const ACTIVE_TYPES = [
  "podcast-clip",
  "speaking-clip",
  "green-screen",
  "selfie-clip",
] as const;
const ACTIVE_TOTAL_FLOOR = 1000;

export async function ensureDfyScripts(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Serialize concurrent boots so only one instance can perform
      // the seed; the lock is auto-released at COMMIT/ROLLBACK.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(dfyScriptsTable);

      const seedRows = (seed as SeedRow[]).map((r) => ({
        type: r.type,
        hook: r.hook,
        body: r.body,
        sortOrder: r.sort_order ?? 0,
      }));

      if (count === 0) {
        // Fresh DB: bulk insert in chunks to stay well under
        // Postgres's 65535 bound parameter limit.
        const CHUNK = 500;
        let inserted = 0;
        for (let i = 0; i < seedRows.length; i += CHUNK) {
          const slice = seedRows.slice(i, i + CHUNK);
          await tx.insert(dfyScriptsTable).values(slice);
          inserted += slice.length;
        }
        logger.info({ inserted }, "ensureDfyScripts: seeded scripts into empty table");
      } else {
        // Populated DB: top-up only the tail of each type, to recover
        // from the Task #528 regression where prod sat at 488 rows
        // (122/type) while dev grew past 1,000.
        const seedByType = new Map<string, typeof seedRows>();
        for (const r of seedRows) {
          if (!seedByType.has(r.type)) seedByType.set(r.type, []);
          seedByType.get(r.type)!.push(r);
        }
        let totalInserted = 0;
        for (const [type, rows] of seedByType) {
          const [{ maxSort }] = await tx
            .select({ maxSort: sql<number | null>`max(${dfyScriptsTable.sortOrder})::int` })
            .from(dfyScriptsTable)
            .where(eq(dfyScriptsTable.type, type));
          const cutoff = maxSort ?? -1;
          const tail = rows.filter((r) => r.sortOrder > cutoff);
          if (tail.length === 0) continue;
          const CHUNK = 500;
          for (let i = 0; i < tail.length; i += CHUNK) {
            await tx.insert(dfyScriptsTable).values(tail.slice(i, i + CHUNK));
          }
          totalInserted += tail.length;
          logger.info(
            { type, inserted: tail.length, fromSort: cutoff + 1 },
            "ensureDfyScripts: topped up type from seed",
          );
        }
        if (totalInserted === 0) {
          logger.info({ count }, "ensureDfyScripts: table already in sync with seed, skipping");
        } else {
          logger.info({ totalInserted }, "ensureDfyScripts: top-up complete");
        }
      }

      // Regression guard: warn if the 4 active formats drop below the
      // 1,000-row promise the page header makes. The portal filters
      // server-side to ACTIVE_TYPES, so this is the count that matters.
      const [{ activeCount }] = await tx
        .select({ activeCount: sql<number>`count(*)::int` })
        .from(dfyScriptsTable)
        .where(inArray(dfyScriptsTable.type, [...ACTIVE_TYPES]));
      if (activeCount < ACTIVE_TOTAL_FLOOR) {
        logger.warn(
          { activeCount, floor: ACTIVE_TOTAL_FLOOR, types: ACTIVE_TYPES },
          "ensureDfyScripts: active script count is below the 1,000 floor - portal will render fewer than promised",
        );
      } else {
        logger.info(
          { activeCount },
          "ensureDfyScripts: active script count is healthy",
        );
      }
    });
  } catch (err) {
    logger.error({ err }, "ensureDfyScripts: failed");
  }
}
