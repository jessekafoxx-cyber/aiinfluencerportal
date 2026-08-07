import { db, knowledgeSourcesTable } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { ingestSource } from "./ingest";

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const RUN_LIMIT_PER_TICK = 5; // at most 5 sources per tick to bound cost

let started = false;
let timer: NodeJS.Timeout | null = null;

export function startKnowledgeScheduler() {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  started = true;
  console.log("[knowledge/scheduler] starting (every 6h)");

  // First tick after a short delay so server boot is unaffected.
  setTimeout(() => {
    runTick().catch((e) => console.error("[knowledge/scheduler] tick error:", e));
  }, 60 * 1000);

  timer = setInterval(() => {
    runTick().catch((e) => console.error("[knowledge/scheduler] tick error:", e));
  }, POLL_INTERVAL_MS);
}

export function stopKnowledgeScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

async function runTick() {
  // Pick enabled sources whose last_synced_at is older than sync_frequency_hours,
  // or that have never synced. Skip sources with frequency 0 (manual only) and
  // those already running/queued.
  const due = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.isActive, true),
        sql`${knowledgeSourcesTable.syncFrequencyHours} > 0`,
        sql`${knowledgeSourcesTable.syncStatus} NOT IN ('running','queued')`,
        or(
          isNull(knowledgeSourcesTable.lastScrapedAt),
          lt(
            knowledgeSourcesTable.lastScrapedAt,
            sql`NOW() - (${knowledgeSourcesTable.syncFrequencyHours} || ' hours')::interval`,
          ),
        ),
      ),
    )
    .limit(RUN_LIMIT_PER_TICK);

  if (due.length === 0) return;
  console.log(`[knowledge/scheduler] running ${due.length} due source(s)`);

  for (const s of due) {
    try {
      await ingestSource(s.id);
    } catch (err) {
      console.error(`[knowledge/scheduler] source ${s.id} failed:`, err);
    }
  }
}
