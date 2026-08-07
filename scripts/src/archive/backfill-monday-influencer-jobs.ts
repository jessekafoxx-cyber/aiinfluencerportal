/**
 * Task #714 follow-up: Backfill every existing `ai_influencer_jobs`
 * row into the Monday.com "AI Influencer Jobs" board so the team can
 * audit which historical jobs have already shipped.
 *
 * Why:
 *   The runtime mirror added in Task #714 only fires for newly queued
 *   jobs. Every row that existed before the mirror landed (and every
 *   row queued during the rollout window) is missing from Monday, so
 *   Viktor cannot use the board as a single source of truth for
 *   "has every buyer been served?". This one-shot backfill creates a
 *   Monday item per existing job, placing it in the group that matches
 *   its current DB status:
 *     - ready                  -> Completed (group_mkwcjkka)
 *     - failed                 -> Failed    (group_mm3f2bcw)
 *     - everything else        -> Queued    (group_mm3f9778)
 *
 *   The runtime helper only writes to the Queued group; status moves
 *   are owned by Viktor in the Monday UI. For the backfill we honor
 *   the final DB state so the board reflects reality on first load.
 *
 * What it does:
 *   - Selects every `ai_influencer_jobs` row ordered by id ASC.
 *   - For each row: looks up buyer email via `app_users`, builds the
 *     same column-value payload as the runtime helper (email, gender,
 *     ethnicity, status, date, admin link, notes), then POSTs the
 *     `create_item` GraphQL mutation directly to Monday.
 *   - Defaults to a dry-run that prints the planned item name + group
 *     + columnValues without calling Monday. Pass `--apply` to write.
 *   - Honors `--limit N` and `--from-id N` for chunked runs.
 *   - Throttles at ~1 request/sec (Monday default rate limit is 60
 *     req/min on the free plan; we stay well below).
 *
 * Idempotency:
 *   - Not idempotent. Monday's `create_item` does not dedupe by name.
 *     Re-running will create duplicate cards. Use `--from-id` to
 *     resume after a partial run; the script logs the last id it
 *     successfully created so you can pass `--from-id <last+1>`.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:monday-influencer-jobs
 *       # dry-run, all rows
 *   pnpm --filter @workspace/scripts run backfill:monday-influencer-jobs -- --apply
 *       # writes
 *   pnpm --filter @workspace/scripts run backfill:monday-influencer-jobs -- --apply --limit 25
 *   pnpm --filter @workspace/scripts run backfill:monday-influencer-jobs -- --apply --from-id 42
 *
 * Run against production:
 *   DATABASE_URL=$PROD_DATABASE_URL MONDAY_API_TOKEN=... \
 *     pnpm --filter @workspace/scripts \
 *       exec tsx src/backfill-monday-influencer-jobs.ts --apply
 */

import { db, aiInfluencerJobsTable, appUsers } from "@workspace/db";
import { and, asc, eq, gte } from "drizzle-orm";

const MONDAY_API_URL = "https://api.monday.com/v2";
const BOARD_ID = "5096704311";
const GROUP_QUEUED = "group_mm3f9778";
const GROUP_COMPLETED = "group_mm3fp3e";
const GROUP_FAILED = "group_mm3fzag2";

const COL_EMAIL = "email_mm3f5a9f";
const COL_GENDER = "text_mm3fs15d";
const COL_ETHNICITY = "text_mm3fcc76";
const COL_STATUS = "color_mm3ffd28";
const COL_DATE = "date_mm3f3enm";
const COL_LINK = "link_mm3fg7p1";
const COL_NOTES = "long_text_mm3fmmt7";

interface Args {
  apply: boolean;
  limit: number | null;
  fromId: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null, fromId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--from-id") args.fromId = Number(argv[++i]);
  }
  return args;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

function pickPref(prefs: unknown, keys: readonly string[]): string | null {
  if (!prefs || typeof prefs !== "object") return null;
  const root = prefs as Record<string, unknown>;
  const cp = root.characterProfile;
  const profile =
    cp && typeof cp === "object" ? (cp as Record<string, unknown>) : null;
  for (const k of keys) {
    const v = asString(root[k]);
    if (v) return v;
    if (profile) {
      const pv = asString(profile[k]);
      if (pv) return pv;
    }
  }
  return null;
}

function groupForStatus(status: string): { groupId: string; label: string } {
  if (status === "ready") return { groupId: GROUP_COMPLETED, label: "Completed" };
  if (status === "failed") return { groupId: GROUP_FAILED, label: "Failed" };
  return { groupId: GROUP_QUEUED, label: "Queued" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token =
    process.env.MONDAY_API_TOKEN?.trim() || process.env.MONDAY_API?.trim();

  if (args.apply && !token) {
    console.error(
      "[backfill-monday] MONDAY_API_TOKEN (or MONDAY_API) is required for --apply",
    );
    process.exit(1);
  }

  const where = args.fromId
    ? gte(aiInfluencerJobsTable.id, args.fromId)
    : undefined;
  const baseQuery = db
    .select({
      id: aiInfluencerJobsTable.id,
      clientId: aiInfluencerJobsTable.clientId,
      status: aiInfluencerJobsTable.status,
      prefs: aiInfluencerJobsTable.prefs,
      createdAt: aiInfluencerJobsTable.createdAt,
    })
    .from(aiInfluencerJobsTable)
    .where(where ? and(where) : undefined)
    .orderBy(asc(aiInfluencerJobsTable.id));

  const rows = args.limit ? await baseQuery.limit(args.limit) : await baseQuery;

  console.log(
    `[backfill-monday] mode=${args.apply ? "APPLY" : "DRY-RUN"} rows=${rows.length}` +
      (args.fromId ? ` fromId=${args.fromId}` : "") +
      (args.limit ? ` limit=${args.limit}` : ""),
  );

  let created = 0;
  let failed = 0;
  let lastOkId: number | null = null;

  for (const job of rows) {
    let buyerEmail: string | null = null;
    try {
      const [u] = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, job.clientId))
        .limit(1);
      buyerEmail = u?.email ?? null;
    } catch (err) {
      console.warn(
        `[backfill-monday] job #${job.id} buyer lookup failed:`,
        (err as Error)?.message ?? err,
      );
    }

    const gender = pickPref(job.prefs, ["gender", "sex"]) ?? "";
    const ethnicity =
      pickPref(job.prefs, ["ethnicity", "ethnic", "race"]) ?? "";
    const vibe = pickPref(job.prefs, ["vibe", "style", "aesthetic"]) ?? "";
    const notesText = pickPref(job.prefs, ["notes", "additionalNotes"]) ?? "";
    const notesBlob = [
      vibe ? `Vibe: ${vibe}` : null,
      notesText ? `Notes: ${notesText}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const createdAt =
      job.createdAt instanceof Date ? job.createdAt : new Date(job.createdAt);
    const dateStr = createdAt.toISOString().slice(0, 10);
    const link = `https://room30.ai/admin/influencer-generations?jobId=${job.id}`;
    const { groupId, label: statusLabel } = groupForStatus(job.status);
    const itemName = `Job #${job.id} — ${buyerEmail ?? `client #${job.clientId}`}`;

    const columnValues: Record<string, unknown> = {
      [COL_EMAIL]: buyerEmail
        ? { email: buyerEmail, text: buyerEmail }
        : { email: "", text: "" },
      [COL_GENDER]: gender,
      [COL_ETHNICITY]: ethnicity,
      [COL_STATUS]: { label: statusLabel },
      [COL_DATE]: { date: dateStr },
      [COL_LINK]: { url: link, text: "Admin console" },
      [COL_NOTES]: notesBlob,
    };

    if (!args.apply) {
      console.log(
        `[backfill-monday] DRY job #${job.id} status=${job.status} group=${groupId} name="${itemName}"`,
      );
      continue;
    }

    // Idempotency guard: look up an existing item by name before
    // creating a new one. Prevents duplicate cards if a previous
    // backfill run was SIGKILL'd by a shell timeout after the
    // create_item POST but before the success line was logged
    // (exactly what happened during the Task #714 prod backfill).
    // Best-effort: if the lookup itself fails we fall through to
    // create() and accept the dupe risk over skipping a real row.
    let existingId: string | null = null;
    try {
      const dupQuery =
        "query ($boardId: ID!, $name: CompareValue!) { " +
        "boards (ids: [$boardId]) { items_page (limit: 5, query_params: { rules: [{ column_id: \"name\", compare_value: $name, operator: contains_text }] }) { items { id name } } } " +
        "}";
      const dupController = new AbortController();
      const dupTimer = setTimeout(() => dupController.abort(), 10_000);
      try {
        const dupRes = await fetch(MONDAY_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: token!,
          },
          body: JSON.stringify({
            query: dupQuery,
            variables: { boardId: BOARD_ID, name: itemName },
          }),
          signal: dupController.signal,
        });
        if (dupRes.ok) {
          const dupJson = (await dupRes.json().catch(() => null)) as
            | { data?: { boards?: Array<{ items_page?: { items?: Array<{ id: string; name: string }> } }> } }
            | null;
          const items = dupJson?.data?.boards?.[0]?.items_page?.items ?? [];
          const match = items.find((it) => it?.name === itemName);
          if (match) existingId = match.id;
        }
      } finally {
        clearTimeout(dupTimer);
      }
    } catch (err) {
      console.warn(
        `[backfill-monday] job #${job.id} dedup lookup failed; proceeding with create:`,
        (err as Error)?.message ?? err,
      );
    }
    if (existingId) {
      console.log(
        `[backfill-monday] SKIP job #${job.id} -> already on board as item ${existingId} (group=${groupId})`,
      );
      lastOkId = job.id;
      await sleep(500);
      continue;
    }

    const query =
      "mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) { " +
      "create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id } " +
      "}";
    const variables = {
      boardId: BOARD_ID,
      groupId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token!,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        failed++;
        console.warn(
          `[backfill-monday] job #${job.id} HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
      } else {
        let json: { errors?: unknown; data?: { create_item?: { id?: string } } } | null = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* ignore */
        }
        if (json && Array.isArray(json.errors) && json.errors.length > 0) {
          failed++;
          console.warn(
            `[backfill-monday] job #${job.id} GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`,
          );
        } else {
          const itemId = json?.data?.create_item?.id ?? "?";
          created++;
          lastOkId = job.id;
          console.log(
            `[backfill-monday] OK job #${job.id} -> monday item ${itemId} (group=${groupId})`,
          );
        }
      }
    } catch (err) {
      failed++;
      console.warn(
        `[backfill-monday] job #${job.id} POST failed:`,
        (err as Error)?.message ?? err,
      );
    } finally {
      clearTimeout(timer);
    }

    // ~1 req/sec to stay well under Monday's 60 req/min default.
    await sleep(1000);
  }

  console.log(
    `[backfill-monday] done. created=${created} failed=${failed} lastOkId=${lastOkId ?? "n/a"}`,
  );
  if (!args.apply) {
    console.log(
      "[backfill-monday] re-run with --apply (and MONDAY_API_TOKEN set) to actually write.",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-monday] fatal:", err);
  process.exit(1);
});
