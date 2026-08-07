// Task #714: Monday.com mirror for newly queued AI Influencer jobs.
//
// Modeled after lib/viktor-slack.ts. Fire-and-forget: a flaky Monday
// API must never bubble into the caller (i.e. a buyer submitting the
// Generate modal). When the env var is unset the helper logs once and
// returns.
//
// Env var note: the user provisioned the secret as `MONDAY_API` rather
// than `MONDAY_API_TOKEN`. We read `MONDAY_API_TOKEN` first (the name
// documented in replit.md) and fall back to `MONDAY_API` so the
// existing secret keeps working without a rename.

import { logger } from "./logger";
import { db, aiInfluencerJobsTable, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";

const MONDAY_BOARD_ID = "5096704311";
const MONDAY_QUEUED_GROUP_ID = "group_mm3f9778";
const MONDAY_API_URL = "https://api.monday.com/v2";

const COL_EMAIL = "email_mm3f5a9f";
const COL_GENDER = "text_mm3fs15d";
const COL_ETHNICITY = "text_mm3fcc76";
const COL_STATUS = "color_mm3ffd28";
const COL_DATE = "date_mm3f3enm";
const COL_LINK = "link_mm3fg7p1";
const COL_NOTES = "long_text_mm3fmmt7";

function publicBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

function mondayToken(): string | undefined {
  return (
    process.env.MONDAY_API_TOKEN?.trim() ||
    process.env.MONDAY_API?.trim() ||
    undefined
  );
}

// One-time guards so the "token unset" / "non-prod skip" branches do
// not spam the logs on every queued job. Process-lifetime memo; a
// rolling restart re-arms them which is the desired behavior.
let loggedMissingToken = false;
let loggedNonProdSkip = false;

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

function pickPref(
  prefs: unknown,
  keys: readonly string[],
): string | null {
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

// ---------------------------------------------------------------------
// Support-bot bug reports -> Room30.ai Bug Reports board.

const MONDAY_BUG_BOARD_ID_DEFAULT = "5099620012";
const BUG_COL_EMAIL = "email_mm4w6a17";
const BUG_COL_PAGE_URL = "text_mm4wkybx";
const BUG_COL_STEPS = "long_text_mm4we98h";
const BUG_COL_DATE = "date_mm4wncy8";

export type SupportBugReport = {
  title: string;
  description: string;
  email?: string | null;
  steps?: string | null;
  pageUrl?: string | null;
};

/**
 * Create a bug-report item on the Monday.com Bug Reports board and
 * attach the full description as an update. Fire-and-forget: never
 * throws, logs and returns false on any failure. Same prod gate +
 * MONDAY_ALLOW_DEV override as the influencer-jobs mirror.
 */
export async function submitSupportBugReport(
  report: SupportBugReport,
): Promise<boolean> {
  try {
    const isProd = process.env.NODE_ENV === "production";
    const allowDev = process.env.MONDAY_ALLOW_DEV === "1";
    if (!isProd && !allowDev) {
      logger.info(
        { nodeEnv: process.env.NODE_ENV ?? "unset" },
        "[monday-bug] non-production env; skipping bug board create (set MONDAY_ALLOW_DEV=1 to override)",
      );
      return false;
    }
    const token = mondayToken();
    if (!token) {
      logger.info(
        {},
        "[monday-bug] MONDAY_API_TOKEN/MONDAY_API unset; skipping bug board create (log-only)",
      );
      return false;
    }

    const boardId =
      process.env.MONDAY_BUG_BOARD_ID?.trim() || MONDAY_BUG_BOARD_ID_DEFAULT;

    const columnValues: Record<string, unknown> = {
      [BUG_COL_DATE]: { date: new Date().toISOString().slice(0, 10) },
    };
    if (report.email) {
      columnValues[BUG_COL_EMAIL] = {
        email: report.email,
        text: report.email,
      };
    }
    if (report.pageUrl) columnValues[BUG_COL_PAGE_URL] = report.pageUrl;
    if (report.steps) columnValues[BUG_COL_STEPS] = { text: report.steps };

    const query =
      "mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) { " +
      "create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id } " +
      "}";
    const variables = {
      boardId,
      itemName: report.title || "Bug Report",
      columnValues: JSON.stringify(columnValues),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let itemId: string | null = null;
    try {
      const res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, body: body.slice(0, 500) },
          "[monday-bug] create_item returned non-2xx",
        );
        return false;
      }
      const json = (await res.json().catch(() => null)) as
        | { errors?: unknown; data?: { create_item?: { id?: string } } }
        | null;
      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        logger.warn(
          { errors: JSON.stringify(json.errors).slice(0, 500) },
          "[monday-bug] create_item GraphQL errors",
        );
        return false;
      }
      itemId = json?.data?.create_item?.id ?? null;
    } finally {
      clearTimeout(timer);
    }
    if (!itemId) return false;

    // Attach the full description as an update. Best-effort: the item
    // already exists, so a failure here still counts as submitted.
    let body = `**Bug Report**\n\n${report.description || "No description provided"}`;
    if (report.steps) body += `\n\n**Steps to Reproduce:**\n${report.steps}`;
    if (report.email) body += `\n\n**Reporter:** ${report.email}`;
    if (report.pageUrl) body += `\n\n**Page:** ${report.pageUrl}`;

    const updateQuery =
      "mutation ($itemId: ID!, $body: String!) { " +
      "create_update (item_id: $itemId, body: $body) { id } " +
      "}";
    const upController = new AbortController();
    const upTimer = setTimeout(() => upController.abort(), 10_000);
    try {
      await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token,
        },
        body: JSON.stringify({
          query: updateQuery,
          variables: { itemId, body },
        }),
        signal: upController.signal,
      });
    } catch (err) {
      logger.warn(
        { err: errMessage(err), itemId },
        "[monday-bug] create_update failed; item was still created",
      );
    } finally {
      clearTimeout(upTimer);
    }

    logger.info({ itemId }, "[monday-bug] bug report created");
    return true;
  } catch (err) {
    logger.warn(
      { err: errMessage(err) },
      "[monday-bug] submitSupportBugReport threw; swallowing",
    );
    return false;
  }
}

export type MondayJobContext = { jobId: number };

/**
 * Mirror a newly queued AI Influencer job to the Monday.com tracking
 * board. Loads job + buyer email from the DB so callers only need to
 * pass the job id. Never throws.
 */
export async function notifyMondayNewInfluencerJob(
  ctx: MondayJobContext,
): Promise<void> {
  try {
    const isProd = process.env.NODE_ENV === "production";
    const allowDev = process.env.MONDAY_ALLOW_DEV === "1";
    if (!isProd && !allowDev) {
      if (!loggedNonProdSkip) {
        loggedNonProdSkip = true;
        logger.info(
          { task: 714, nodeEnv: process.env.NODE_ENV ?? "unset" },
          "[monday] non-production env; skipping notifications (set MONDAY_ALLOW_DEV=1 to override) - logged once per process",
        );
      }
      return;
    }
    const token = mondayToken();
    if (!token) {
      if (!loggedMissingToken) {
        loggedMissingToken = true;
        logger.info(
          { task: 714 },
          "[monday] MONDAY_API_TOKEN/MONDAY_API unset; skipping notifications (log-only) - logged once per process",
        );
      }
      return;
    }

    const [job] = await db
      .select({
        id: aiInfluencerJobsTable.id,
        clientId: aiInfluencerJobsTable.clientId,
        prefs: aiInfluencerJobsTable.prefs,
        createdAt: aiInfluencerJobsTable.createdAt,
      })
      .from(aiInfluencerJobsTable)
      .where(eq(aiInfluencerJobsTable.id, ctx.jobId))
      .limit(1);
    if (!job) {
      logger.warn({ jobId: ctx.jobId, task: 714 }, "[monday] job not found");
      return;
    }

    let buyerEmail: string | null = null;
    try {
      const [u] = await db
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(eq(appUsers.id, job.clientId))
        .limit(1);
      buyerEmail = u?.email ?? null;
    } catch (err) {
      logger.warn(
        { err: errMessage(err), jobId: ctx.jobId, task: 714 },
        "[monday] buyer email lookup failed",
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

    // Hardcoded per Task #714 spec - the Monday card link must always
    // point at the canonical production admin console regardless of
    // PUBLIC_APP_URL (which could be a preview origin during a
    // MONDAY_ALLOW_DEV smoke test).
    const link = `https://room30.ai/admin/influencer-generations?jobId=${job.id}`;

    const itemName = `Job #${job.id} — ${buyerEmail ?? `client #${job.clientId}`}`;

    const columnValues: Record<string, unknown> = {
      [COL_EMAIL]: buyerEmail
        ? { email: buyerEmail, text: buyerEmail }
        : { email: "", text: "" },
      [COL_GENDER]: gender,
      [COL_ETHNICITY]: ethnicity,
      [COL_STATUS]: { label: "Queued" },
      [COL_DATE]: { date: dateStr },
      [COL_LINK]: { url: link, text: "Admin console" },
      [COL_NOTES]: notesBlob,
    };

    // Idempotency guard: every job id is unique, and the item name is
    // `Job #<id> — <email>`, so a name-based lookup is a safe dedupe
    // key. Without this, any caller that re-fires the helper for the
    // same job (admin retry that doesn't insert a new job row, or a
    // SIGKILL'd backfill run that gets re-invoked) would create
    // duplicate cards. Best-effort: if the lookup itself fails for
    // any reason (network, GraphQL error, unexpected shape) we fall
    // through to the create and accept the risk of an occasional
    // dupe over the risk of dropping a real job. Mute via
    // `MONDAY_DEDUP_DISABLED=1` if Monday's name filter ever changes
    // semantics under us.
    if (process.env.MONDAY_DEDUP_DISABLED !== "1") {
      try {
        const dupQuery =
          "query ($boardId: ID!, $name: CompareValue!) { " +
          "boards (ids: [$boardId]) { items_page (limit: 5, query_params: { rules: [{ column_id: \"name\", compare_value: $name, operator: contains_text }] }) { items { id name } } } " +
          "}";
        const dupController = new AbortController();
        const dupTimer = setTimeout(() => dupController.abort(), 8_000);
        let existingId: string | null = null;
        try {
          const dupRes = await fetch(MONDAY_API_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: token,
            },
            body: JSON.stringify({
              query: dupQuery,
              variables: { boardId: MONDAY_BOARD_ID, name: itemName },
            }),
            signal: dupController.signal,
          });
          if (dupRes.ok) {
            const dupJson = (await dupRes.json().catch(() => null)) as
              | { data?: { boards?: Array<{ items_page?: { items?: Array<{ id: string; name: string }> } }> } }
              | null;
            const items =
              dupJson?.data?.boards?.[0]?.items_page?.items ?? [];
            // `contains_text` is a substring match - re-confirm an
            // exact name match before declaring a dupe.
            const match = items.find((it) => it?.name === itemName);
            if (match) existingId = match.id;
          }
        } finally {
          clearTimeout(dupTimer);
        }
        if (existingId) {
          logger.info(
            { jobId: ctx.jobId, mondayItemId: existingId, task: 714 },
            "[monday] item already exists for this job; skipping create",
          );
          return;
        }
      } catch (err) {
        logger.warn(
          { err: errMessage(err), jobId: ctx.jobId, task: 714 },
          "[monday] dedup lookup failed; proceeding with create",
        );
      }
    }

    const query =
      "mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) { " +
      "create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id } " +
      "}";
    const variables = {
      boardId: MONDAY_BOARD_ID,
      groupId: MONDAY_QUEUED_GROUP_ID,
      itemName,
      columnValues: JSON.stringify(columnValues),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn(
          {
            status: res.status,
            body: body.slice(0, 500),
            jobId: ctx.jobId,
            task: 714,
          },
          "[monday] API returned non-2xx",
        );
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { errors?: unknown; data?: unknown }
        | null;
      if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        logger.warn(
          {
            errors: JSON.stringify(json.errors).slice(0, 500),
            jobId: ctx.jobId,
            task: 714,
          },
          "[monday] GraphQL errors",
        );
      }
    } catch (err) {
      logger.warn(
        { err: errMessage(err), jobId: ctx.jobId, task: 714 },
        "[monday] API POST failed",
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn(
      { err: errMessage(err), jobId: ctx.jobId, task: 714 },
      "[monday] notifyMondayNewInfluencerJob threw; swallowing",
    );
  }
}
