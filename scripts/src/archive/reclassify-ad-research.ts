// Task #200: one-shot reclassify script. For every non-`ok` ad-research
// row, re-derive recovery_class / recovery_strategy / retry_after_at
// from the live worker helpers and (optionally) apply the diff. The
// script intentionally calls *only* the exported helper surface
// (`deriveRecoveryClass`, `computeRetrySchedule`, `normalizeSocialUrl`,
// `MAX_ATTEMPTS`) so the off-runtime classification matches what
// `persistResult` would write at terminal-failure time. No custom
// taxonomy overrides live in this script - the dead-content /
// invalid-input / exhausted folding is fully owned by the helpers.
//
// Usage:
//   pnpm --filter @workspace/scripts run reclassify:ad-research -- --dry-run
//   pnpm --filter @workspace/scripts run reclassify:ad-research
//
// Idempotent.
import { db, adResearchBoardItems } from "@workspace/db";
import { ne, sql } from "drizzle-orm";
import {
  deriveRecoveryClass,
  computeRetrySchedule,
  normalizeSocialUrl,
  MAX_ATTEMPTS,
} from "@workspace/api-server/lib/media-downloader-helpers";

interface DiffRow {
  id: number;
  rowKey: string;
  errorClass: string | null;
  oldClass: string | null;
  newClass: string;
  oldStrategy: string | null;
  newStrategy: string;
  oldRetryAt: string | null;
  newRetryAt: string | null;
  oldNorm: string | null;
  newNorm: string;
  willChange: boolean;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  // Idempotency anchor: we never derive a fresh retry_after_at from
  // wall-clock `Date.now()` for rows that already have one. Doing so
  // would shift the timestamp forward on every invocation and create
  // perpetual diffs. Instead:
  //   - if `retry_after_at_t197` is already set, we keep it as-is
  //   - if it is NULL and the helper says the row should have one,
  //     we anchor the schedule at the row's existing `retry_after_at`
  //     when present, falling back to a fixed epoch derived from the
  //     most recent observed timestamp on the row (`updated_at`).
  // The fallback epoch is read per-row inside the loop. We only need
  // a default for rows where `updated_at` is also missing, which
  // shouldn't happen in practice.
  const fallbackEpoch = Date.now();
  const rows = await db
    .select({
      id: adResearchBoardItems.id,
      rowKey: adResearchBoardItems.rowKey,
      adLink: adResearchBoardItems.adLink,
      mediaStatus: adResearchBoardItems.mediaStatus,
      mediaErrorClass: adResearchBoardItems.mediaErrorClass,
      mediaAttempts: adResearchBoardItems.mediaAttempts,
      recoveryClass: adResearchBoardItems.recoveryClass,
      recoveryStrategy: adResearchBoardItems.recoveryStrategy,
      retryAfterAt: adResearchBoardItems.retryAfterAt,
      normalizedUrl: adResearchBoardItems.normalizedUrl,
      updatedAt: adResearchBoardItems.updatedAt,
    })
    .from(adResearchBoardItems)
    .where(ne(adResearchBoardItems.mediaStatus, "ok"));

  const diffs: DiffRow[] = [];
  for (const r of rows) {
    const klass = (r.mediaErrorClass || "").toLowerCase();
    // Pure helper output - no custom override. computeRetrySchedule
    // handles exhaustion (`newAttempts >= MAX_ATTEMPTS` -> permanent-
    // dismiss-exhausted with retry_after_at = null). The recovery
    // class itself reflects the error taxonomy at the time of the
    // failure, not an attempts-derived state.
    const recClass = deriveRecoveryClass(klass);
    const attempts = Math.max(1, r.mediaAttempts ?? 1);
    // Anchor schedule computation to a deterministic per-row epoch so
    // repeated runs produce the same result. Prefer the existing
    // `retry_after_at` (back-derived to its own scheduling moment),
    // otherwise the row's `updated_at`, otherwise a process-level
    // fallback (rows without any timestamp shouldn't exist).
    const epoch = r.retryAfterAt
      ? new Date(r.retryAfterAt).getTime()
      : r.updatedAt
        ? new Date(r.updatedAt).getTime()
        : fallbackEpoch;
    const sched = computeRetrySchedule(recClass, attempts, MAX_ATTEMPTS, epoch);
    const norm = normalizeSocialUrl(r.adLink || "").url || r.adLink || "";

    const oldRetryAt = r.retryAfterAt ? new Date(r.retryAfterAt).toISOString() : null;
    // Idempotency rule: never overwrite an existing retry_after_at.
    // Only write a new value when the row currently has none AND the
    // helper says one is warranted. Class/strategy/normalized-url
    // corrections still apply on every run but converge after one.
    const newRetryAt =
      oldRetryAt !== null
        ? oldRetryAt
        : sched.retryAfterAt
          ? sched.retryAfterAt.toISOString()
          : null;
    const willChange =
      r.recoveryClass !== recClass ||
      r.recoveryStrategy !== sched.recoveryStrategy ||
      oldRetryAt !== newRetryAt ||
      r.normalizedUrl !== norm;
    diffs.push({
      id: r.id,
      rowKey: r.rowKey,
      errorClass: r.mediaErrorClass,
      oldClass: r.recoveryClass,
      newClass: recClass,
      oldStrategy: r.recoveryStrategy,
      newStrategy: sched.recoveryStrategy,
      oldRetryAt,
      newRetryAt,
      oldNorm: r.normalizedUrl,
      newNorm: norm,
      willChange,
    });
  }

  const changed = diffs.filter((d) => d.willChange);
  console.log(`Scanned ${diffs.length} non-ok rows; ${changed.length} would change.`);
  const byNewClass = new Map<string, number>();
  for (const d of changed) {
    byNewClass.set(d.newClass, (byNewClass.get(d.newClass) ?? 0) + 1);
  }
  for (const [k, v] of byNewClass.entries()) {
    console.log(`  -> ${k}: ${v}`);
  }
  if (changed.length) {
    console.log("\nSample (first 10):");
    for (const d of changed.slice(0, 10)) {
      console.log(
        `  #${d.id} ${d.rowKey} errClass=${d.errorClass} ` +
          `class:${d.oldClass ?? "∅"}->${d.newClass} ` +
          `strategy:${d.oldStrategy ?? "∅"}->${d.newStrategy} ` +
          `retryAt:${d.oldRetryAt ?? "∅"}->${d.newRetryAt ?? "∅"}`,
      );
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: no updates applied.");
    process.exit(0);
  }

  let applied = 0;
  for (const d of changed) {
    await db.execute(sql`
      UPDATE ad_research_board_items
         SET recovery_class_t197 = ${d.newClass},
             recovery_strategy_t197 = ${d.newStrategy},
             retry_after_at_t197 = ${d.newRetryAt ? new Date(d.newRetryAt) : null},
             normalized_url_t197 = ${d.newNorm}
       WHERE id = ${d.id}
    `);
    applied += 1;
  }
  console.log(`\nApplied ${applied} updates.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
