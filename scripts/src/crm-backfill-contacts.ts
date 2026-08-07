/**
 * crm-backfill-contacts
 *
 * Populates `crm_contacts` from existing buyer / lead tables so the CRM
 * isn't empty on a fresh install. Idempotent: skips emails already in
 * crm_contacts (matched case-insensitively).
 *
 * Sources, in order of priority:
 *   1. orders where main_product_paid=true        -> source="funnel-buyer"
 *   2. coaching_agreements where paid_at IS NOT NULL -> source="coaching-buyer"
 *   3. portal_users where is_active=true          -> source="portal-user"
 *
 * Each row is upserted using lower(email) as the dedupe key. Existing
 * crm_contacts rows are NEVER updated (we don't want to overwrite manual
 * edits or stage assignments) - we only INSERT missing emails.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run crm:backfill-contacts
 *   pnpm --filter @workspace/scripts run crm:backfill-contacts -- --apply   # write
 *   pnpm --filter @workspace/scripts run crm:backfill-contacts -- --apply --source=orders
 *
 * Default is dry-run. --apply actually writes. --source can be passed
 * multiple times (or comma-separated) to limit which sources run.
 */

import { db, crmContacts } from "@workspace/db";
import { sql } from "drizzle-orm";

type SourceKey =
  | "orders"
  | "coaching"
  | "portal_users"
  | "funnel_leads"
  | "kit_outbox"
  | "kit_subscribers";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const sourceArg = argv
  .filter((a) => a.startsWith("--source"))
  .flatMap((a) => a.replace(/^--source[=]?/, "").split(","))
  .map((s) => s.trim())
  .filter(Boolean) as SourceKey[];
const SOURCES: SourceKey[] = sourceArg.length
  ? sourceArg
  : [
      "orders",
      "coaching",
      "portal_users",
      "funnel_leads",
      "kit_outbox",
      "kit_subscribers",
    ];

type Candidate = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  source: string;
  createdAt: Date | null;
};

function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@") || trimmed.length > 254) return null;
  return trimmed;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

async function loadExistingEmails(): Promise<Set<string>> {
  const rows = await db.execute<{ email: string }>(
    sql`SELECT DISTINCT lower(email) AS email FROM crm_contacts`,
  );
  return new Set((rows.rows as { email: string }[]).map((r) => r.email));
}

async function resolveDefaultStageId(): Promise<number | null> {
  const rows = await db.execute(
    sql`SELECT id FROM crm_pipeline_stages
        WHERE is_won = false AND is_lost = false
        ORDER BY sort_order ASC, id ASC
        LIMIT 1`,
  );
  const r = (rows.rows as Array<{ id: number }>)[0];
  return r ? Number(r.id) : null;
}

function splitFullName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

async function loadCandidatesFromOrders(): Promise<Candidate[]> {
  const rows = await db.execute(
    sql`SELECT email, phone, created_at
        FROM orders
        WHERE main_product_paid = true
          AND email IS NOT NULL
        ORDER BY created_at ASC`,
  );
  const out: Candidate[] = [];
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const email = normaliseEmail(r.email);
    if (!email) continue;
    out.push({
      email,
      firstName: null,
      lastName: null,
      phone: nonEmpty(r.phone),
      source: "funnel-buyer",
      createdAt: r.created_at instanceof Date ? r.created_at : null,
    });
  }
  return out;
}

async function loadCandidatesFromCoaching(): Promise<Candidate[]> {
  try {
    const rows = await db.execute(
      sql`SELECT email, full_name, phone, created_at
          FROM coaching_agreements
          WHERE paid_at IS NOT NULL
            AND email IS NOT NULL
          ORDER BY created_at ASC`,
    );
    const out: Candidate[] = [];
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const email = normaliseEmail(r.email);
      if (!email) continue;
      const { first, last } = splitFullName(nonEmpty(r.full_name));
      out.push({
        email,
        firstName: first,
        lastName: last,
        phone: nonEmpty(r.phone),
        source: "coaching-buyer",
        createdAt: r.created_at instanceof Date ? r.created_at : null,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[backfill] coaching_agreements skipped:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function loadCandidatesFromFunnelLeads(): Promise<Candidate[]> {
  try {
    const rows = await db.execute(
      sql`SELECT email, first_name, phone, created_at
          FROM funnel_leads
          WHERE email IS NOT NULL
          ORDER BY created_at ASC`,
    );
    const out: Candidate[] = [];
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const email = normaliseEmail(r.email);
      if (!email) continue;
      out.push({
        email,
        firstName: nonEmpty(r.first_name),
        lastName: null,
        phone: nonEmpty(r.phone),
        source: "funnel-lead",
        createdAt: r.created_at instanceof Date ? r.created_at : null,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[backfill] funnel_leads skipped:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function loadCandidatesFromPortalUsers(): Promise<Candidate[]> {
  const rows = await db.execute(
    sql`SELECT email, first_name, last_name, created_at
        FROM portal_users
        WHERE is_active = true
          AND email IS NOT NULL
        ORDER BY created_at ASC`,
  );
  const out: Candidate[] = [];
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const email = normaliseEmail(r.email);
    if (!email) continue;
    out.push({
      email,
      firstName: nonEmpty(r.first_name),
      lastName: nonEmpty(r.last_name),
      phone: null,
      source: "portal-user",
      createdAt: r.created_at instanceof Date ? r.created_at : null,
    });
  }
  return out;
}

async function loadCandidatesFromKitOutbox(): Promise<Candidate[]> {
  try {
    const rows = await db.execute(
      sql`SELECT contact_email AS email,
                 MIN(created_at) AS created_at
            FROM kit_sync_outbox
           WHERE contact_email IS NOT NULL
           GROUP BY contact_email`,
    );
    const out: Candidate[] = [];
    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const email = normaliseEmail(r.email);
      if (!email) continue;
      out.push({
        email,
        firstName: null,
        lastName: null,
        phone: null,
        source: "kit-subscriber",
        createdAt: r.created_at instanceof Date ? r.created_at : null,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[backfill] kit_sync_outbox skipped:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function loadCandidatesFromKitSubscribers(): Promise<Candidate[]> {
  const apiKey = process.env.KIT_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[backfill] KIT_API_KEY not set - skipping kit_subscribers source");
    return [];
  }
  const out: Candidate[] = [];
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    const url = after
      ? `https://api.kit.com/v4/subscribers?after=${encodeURIComponent(after)}&per_page=500`
      : `https://api.kit.com/v4/subscribers?per_page=500`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Kit-Api-Key": apiKey,
      },
    });
    if (!res.ok) {
      console.warn(
        `[backfill] KIT /subscribers page ${page} failed: HTTP ${res.status} - aborting kit_subscribers source`,
      );
      break;
    }
    const body = (await res.json()) as {
      subscribers?: Array<{
        email_address?: string;
        first_name?: string | null;
        created_at?: string | null;
      }>;
      pagination?: { has_next_page?: boolean; end_cursor?: string | null };
    };
    for (const s of body.subscribers ?? []) {
      const email = normaliseEmail(s.email_address);
      if (!email) continue;
      const createdAt = s.created_at ? new Date(s.created_at) : null;
      out.push({
        email,
        firstName: nonEmpty(s.first_name),
        lastName: null,
        phone: null,
        source: "kit-subscriber",
        createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
      });
    }
    if (!body.pagination?.has_next_page || !body.pagination?.end_cursor) break;
    after = body.pagination.end_cursor;
  }
  return out;
}

function dedupeByEmail(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = map.get(c.email);
    if (!existing) {
      map.set(c.email, c);
      continue;
    }
    map.set(c.email, {
      email: existing.email,
      firstName: existing.firstName ?? c.firstName,
      lastName: existing.lastName ?? c.lastName,
      phone: existing.phone ?? c.phone,
      source: existing.source,
      createdAt:
        existing.createdAt && c.createdAt
          ? existing.createdAt <= c.createdAt
            ? existing.createdAt
            : c.createdAt
          : existing.createdAt ?? c.createdAt,
    });
  }
  return Array.from(map.values());
}

async function main(): Promise<void> {
  console.log(
    `[backfill] starting (apply=${APPLY}, sources=${SOURCES.join(",")})`,
  );

  const existing = await loadExistingEmails();
  console.log(`[backfill] crm_contacts already holds ${existing.size} emails`);

  const defaultStageId = await resolveDefaultStageId();
  if (defaultStageId == null) {
    console.error(
      "[backfill] no usable pipeline stage found (need at least one stage with is_won=false AND is_lost=false). Seed crm_pipeline_stages first.",
    );
    process.exit(1);
  }
  console.log(`[backfill] default stage_id for new + un-staged rows: ${defaultStageId}`);

  const all: Candidate[] = [];
  if (SOURCES.includes("orders")) {
    const rows = await loadCandidatesFromOrders();
    console.log(`[backfill] orders candidates: ${rows.length}`);
    all.push(...rows);
  }
  if (SOURCES.includes("coaching")) {
    const rows = await loadCandidatesFromCoaching();
    console.log(`[backfill] coaching candidates: ${rows.length}`);
    all.push(...rows);
  }
  if (SOURCES.includes("portal_users")) {
    const rows = await loadCandidatesFromPortalUsers();
    console.log(`[backfill] portal_users candidates: ${rows.length}`);
    all.push(...rows);
  }
  if (SOURCES.includes("funnel_leads")) {
    const rows = await loadCandidatesFromFunnelLeads();
    console.log(`[backfill] funnel_leads candidates: ${rows.length}`);
    all.push(...rows);
  }
  if (SOURCES.includes("kit_outbox")) {
    const rows = await loadCandidatesFromKitOutbox();
    console.log(`[backfill] kit_outbox candidates: ${rows.length}`);
    all.push(...rows);
  }
  if (SOURCES.includes("kit_subscribers")) {
    const rows = await loadCandidatesFromKitSubscribers();
    console.log(`[backfill] kit_subscribers candidates: ${rows.length}`);
    all.push(...rows);
  }

  const deduped = dedupeByEmail(all);
  const toInsert = deduped.filter((c) => !existing.has(c.email));
  const skipped = deduped.length - toInsert.length;
  console.log(
    `[backfill] unique emails: ${deduped.length}, new to insert: ${toInsert.length}, already in CRM: ${skipped}`,
  );

  const breakdown = toInsert.reduce<Record<string, number>>((acc, c) => {
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});
  for (const [source, count] of Object.entries(breakdown)) {
    console.log(`  - ${source}: ${count}`);
  }

  if (!APPLY) {
    console.log("[backfill] dry-run: not writing. Re-run with --apply to commit.");
    process.exit(0);
  }

  // Repair any prior backfill rows that landed without a stage_id so they
  // show up on the Pipeline board (runs even when no new inserts).
  const repair = await db.execute(
    sql`UPDATE crm_contacts
        SET stage_id = ${defaultStageId}, updated_at = now()
        WHERE stage_id IS NULL
          AND source IN ('funnel-buyer', 'coaching-buyer', 'portal-user', 'funnel-lead', 'kit-subscriber')
        RETURNING id`,
  );
  const repairedCount = (repair.rows as unknown[]).length;
  if (repairedCount > 0) {
    console.log(`[backfill] repaired ${repairedCount} prior un-staged backfill rows`);
  }

  if (toInsert.length === 0) {
    console.log("[backfill] nothing to do, already in sync");
    process.exit(0);
  }

  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const values = batch.map((c) => ({
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      source: c.source,
      stageId: defaultStageId,
      createdAt: c.createdAt ?? new Date(),
      lastActivityAt: c.createdAt ?? new Date(),
    }));
    await db.insert(crmContacts).values(values).onConflictDoNothing();
    written += batch.length;
    console.log(`[backfill] inserted batch ${i / BATCH + 1} (${written}/${toInsert.length})`);
  }
  console.log(`[backfill] done: inserted ${written} contacts`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
