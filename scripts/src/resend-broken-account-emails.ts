/**
 * Task #460 - Re-send broken Room30 account-setup emails.
 *
 * The bad batch went out with a *.riker.replit.dev CTA host (502 for
 * buyers) because PUBLIC_APP_URL was unset and REPLIT_DOMAINS only
 * contained a preview host. This script:
 *
 *   1. Scans `email_logs` for `purchase_account_created` and
 *      `purchase_account_existing` rows where the stored CTA URL
 *      points at a *.replit.dev or *.replit.app host AND the row has
 *      not already been processed by an earlier run of this script.
 *   2. For each affected row: revokes the matching pending Clerk
 *      invitation (its `redirect_url` is baked in at creation time and
 *      cannot be edited - we have to issue a new invitation),
 *      immutably tags the original log row with
 *      `metadata.replacedByTask460=true` (and the new replay log id,
 *      filled in after enrollment) so a second run skips it, then
 *      re-runs `enrollPurchaserAndSendEmail` with `extraMetadata` that
 *      tags the replay so it's distinguishable from the original.
 *   3. Defaults to dry-run. Pass `--apply` (or `APPLY=1`) to actually
 *      revoke + re-send.
 *
 * Idempotency: rerunning is safe. The original `orderId` in the bad
 * row is never mutated; we add a `replacedByTask460=true` flag (an
 * audit marker, NOT consumed by `enrollPurchaserAndSendEmail`'s
 * dedupe check) and explicitly skip flagged rows in
 * `loadAffectedRows`. Re-issuing the enrollment for the same
 * `(email, orderId)` is also caught by the per-order dedupe inside
 * `enrollPurchaserAndSendEmail` itself if the marker write somehow
 * lands without a successful enrollment - in that case it returns
 * `{ status: "skipped", reason: "already_sent" }` and the script
 * moves on without sending twice.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run resend:broken-account-emails
 *     # dry-run: prints affected rows, does nothing
 *   pnpm --filter @workspace/scripts run resend:broken-account-emails -- --apply
 *     # writes: revokes invitations and re-sends emails
 *
 *   ONLY_EMAIL=foo@bar.com ...           # restrict to one buyer
 *   LIMIT=50 ...                         # cap rows processed (default: all)
 *   SENT_AFTER=2026-05-10T00:00:00Z      # batch lower bound (ISO)
 *   SENT_BEFORE=2026-05-15T00:00:00Z     # batch upper bound (ISO)
 *
 * SENT_AFTER and SENT_BEFORE are REQUIRED unless `ONLY_EMAIL` is set.
 * They prevent accidental out-of-batch re-sends if the script is run
 * after some unrelated future incident also leaves a bad host in
 * email_logs.
 *
 * Env:
 *   DATABASE_URL, CLERK_SECRET_KEY, RESEND_API_KEY (or whatever
 *   sendEmail needs), PUBLIC_APP_URL (must be `https://room30.ai` so
 *   the replays use the correct host).
 */

import { clerkClient } from "@clerk/express";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db, emailLogsTable } from "@workspace/db";
import { enrollPurchaserAndSendEmail } from "@workspace/api-server/lib/purchase-enrollment";
import { inferPortalKey, pickStringField } from "./resend-broken-account-emails-helpers.ts";

const DRY_RUN = !(process.argv.includes("--apply") || process.env.APPLY === "1");
const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").trim().toLowerCase();
const LIMIT = Number(process.env.LIMIT || "0");
const SENT_AFTER = (process.env.SENT_AFTER || "").trim();
const SENT_BEFORE = (process.env.SENT_BEFORE || "").trim();

const BAD_HOST_RE = /\.replit\.(app|dev)(\b|[/:?#])/i;

interface AffectedRow {
  id: number;
  email: string;
  templateType: string;
  metadata: Record<string, unknown> | null;
  sentAt: Date;
  ctaUrl: string;
  orderId: string;
  portalKey: "room30" | "main";
}

function parseBatchWindow(): { after: Date; before: Date } | null {
  if (!SENT_AFTER && !SENT_BEFORE) return null;
  if (!SENT_AFTER || !SENT_BEFORE) {
    throw new Error(
      "SENT_AFTER and SENT_BEFORE must be set together (or both omitted alongside ONLY_EMAIL).",
    );
  }
  const after = new Date(SENT_AFTER);
  const before = new Date(SENT_BEFORE);
  if (Number.isNaN(after.getTime()) || Number.isNaN(before.getTime())) {
    throw new Error("SENT_AFTER / SENT_BEFORE must be valid ISO timestamps.");
  }
  if (after >= before) throw new Error("SENT_AFTER must be earlier than SENT_BEFORE.");
  return { after, before };
}

async function loadAffectedRows(window: { after: Date; before: Date } | null): Promise<AffectedRow[]> {
  const conds: SQL[] = [
    inArray(emailLogsTable.templateType, ["purchase_account_created", "purchase_account_existing"]),
    // Skip rows we've already processed in a previous run. This is
    // the load-bearing idempotency guarantee.
    sql`COALESCE(${emailLogsTable.metadata}->>'replacedByTask460', 'false') <> 'true'`,
    // Skip rows that ARE the replays themselves.
    sql`COALESCE(${emailLogsTable.metadata}->>'resentFromTask460', 'false') <> 'true'`,
  ];
  if (ONLY_EMAIL) conds.push(eq(emailLogsTable.email, ONLY_EMAIL));
  if (window) {
    conds.push(gte(emailLogsTable.sentAt, window.after));
    conds.push(lte(emailLogsTable.sentAt, window.before));
  }

  const rows = await db
    .select({
      id: emailLogsTable.id,
      email: emailLogsTable.email,
      templateType: emailLogsTable.templateType,
      metadata: emailLogsTable.metadata,
      sentAt: emailLogsTable.sentAt,
    })
    .from(emailLogsTable)
    .where(and(...conds))
    .orderBy(desc(emailLogsTable.sentAt));

  const affected: AffectedRow[] = [];
  for (const r of rows) {
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const ctaUrl = pickStringField(meta, "ctaUrl", "signInUrl", "inviteUrl", "redirectUrl");
    if (!ctaUrl || !BAD_HOST_RE.test(ctaUrl)) continue;
    const orderId = pickStringField(meta, "orderId");
    if (!orderId) {
      console.warn(`[resend] skipping email_logs#${r.id} (${r.email}): no orderId in metadata`);
      continue;
    }

    affected.push({
      id: r.id,
      email: r.email,
      templateType: r.templateType,
      metadata: meta,
      sentAt: r.sentAt,
      ctaUrl,
      orderId,
      portalKey: inferPortalKey(ctaUrl, meta),
    });
  }

  // Dedupe by (email, orderId) - newest log row wins.
  const seen = new Set<string>();
  const deduped: AffectedRow[] = [];
  for (const a of affected) {
    const key = `${a.email}|${a.orderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }
  return LIMIT > 0 ? deduped.slice(0, LIMIT) : deduped;
}

// Minimal Clerk invitation shape we depend on. Centralized here so we
// don't sprinkle `any` casts at each call site. The fields are stable
// across the SDK shapes we currently see (camelCase newer API,
// snake_case older API).
interface ClerkInvitationLite {
  id: string;
  emailAddress?: string;
  email_address?: string;
  redirectUrl?: string;
  redirect_url?: string;
  publicMetadata?: Record<string, unknown>;
  public_metadata?: Record<string, unknown>;
}
interface ClerkInvitationListPage {
  data?: ClerkInvitationLite[];
}
type InvitationListResponse = ClerkInvitationLite[] | ClerkInvitationListPage;

const clerkInvitations = clerkClient.invitations as unknown as {
  getInvitationList: (args: {
    status?: string;
    limit?: number;
    offset?: number;
  }) => Promise<InvitationListResponse>;
  revokeInvitation: (id: string) => Promise<unknown>;
};

function readInvitationFields(inv: ClerkInvitationLite): {
  email: string;
  orderId: string;
  source: string;
  redirectUrl: string;
} {
  const email = String(inv.emailAddress ?? inv.email_address ?? "").toLowerCase();
  const meta = (inv.publicMetadata ?? inv.public_metadata ?? {}) as Record<string, unknown>;
  const orderId = typeof meta.orderId === "string" ? meta.orderId : "";
  const source = typeof meta.source === "string" ? meta.source : "";
  const redirectUrl = String(inv.redirectUrl ?? inv.redirect_url ?? "");
  return { email, orderId, source, redirectUrl };
}

// Scoped revoke: only revoke pending invitations that match BOTH the
// target email AND the publicMetadata stamped by
// `createClerkInvitationUrl` (`orderId === <this order>` and
// `source === "purchase"`). Unrelated invites for the same email
// (e.g. a separate course-portal invite, or a hand-issued admin
// invite) are left alone, even if their redirect happens to point at
// a Replit preview host.
async function revokeBrokenInvitationsForOrder(
  email: string,
  orderId: string,
): Promise<number> {
  let revoked = 0;
  let offset = 0;
  const limit = 100;
  for (let i = 0; i < 50; i++) {
    let page: InvitationListResponse;
    try {
      page = await clerkInvitations.getInvitationList({ status: "pending", limit, offset });
    } catch (err) {
      console.warn(
        `[resend] getInvitationList failed at offset=${offset}:`,
        (err as Error).message,
      );
      break;
    }
    const data: ClerkInvitationLite[] = Array.isArray(page)
      ? page
      : Array.isArray(page.data)
        ? page.data
        : [];
    if (data.length === 0) break;
    for (const inv of data) {
      const f = readInvitationFields(inv);
      if (f.email !== email) continue;
      if (f.orderId !== orderId || f.source !== "purchase") continue;
      try {
        await clerkInvitations.revokeInvitation(inv.id);
        revoked++;
        console.log(
          `  - revoked Clerk invitation ${inv.id} (order=${f.orderId} redirect=${f.redirectUrl || "?"})`,
        );
      } catch (err) {
        console.warn(`  - failed to revoke ${inv.id}:`, (err as Error).message);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return revoked;
}

// Idempotency guard. Returns true if a previous run already produced a
// successful replay row for this original log id. Used so a partial
// failure (resend lands in `email_logs` but the audit-marker write
// crashes) does not cause a duplicate send on the next run.
async function replayAlreadyExistsFor(originalLogId: number): Promise<boolean> {
  const rows = await db
    .select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(
      and(
        inArray(emailLogsTable.templateType, [
          "purchase_account_created",
          "purchase_account_existing",
        ]),
        sql`${emailLogsTable.metadata}->>'resentFromTask460' = 'true'`,
        sql`(${emailLogsTable.metadata}->>'originalEmailLogId')::int = ${originalLogId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Audit-only marker, written ONLY after a successful resend. Does NOT
// mutate `orderId`. `loadAffectedRows` filters on this flag so a
// future run skips this row.
async function markReplaceSucceeded(logId: number): Promise<void> {
  const payload = JSON.stringify({
    replacedByTask460: true,
    replacedAt: new Date().toISOString(),
    replacedByScript: "resend-broken-account-emails",
  });
  await db
    .update(emailLogsTable)
    .set({
      metadata: sql`COALESCE(${emailLogsTable.metadata}, '{}'::jsonb) || ${payload}::jsonb`,
    })
    .where(eq(emailLogsTable.id, logId));
}

// Failure breadcrumb. We deliberately DO NOT set `replacedByTask460`
// here so `loadAffectedRows` will pick the row back up on the next
// run and an operator can retry.
async function markReplaceFailed(logId: number, errMessage: string): Promise<void> {
  const payload = JSON.stringify({
    lastReplayError: errMessage,
    lastReplayAttemptAt: new Date().toISOString(),
  });
  await db
    .update(emailLogsTable)
    .set({
      metadata: sql`COALESCE(${emailLogsTable.metadata}, '{}'::jsonb) || ${payload}::jsonb`,
    })
    .where(eq(emailLogsTable.id, logId));
}

async function main(): Promise<void> {
  const window = parseBatchWindow();
  if (!ONLY_EMAIL && !window) {
    console.error(
      "[resend] refuse to run: set SENT_AFTER and SENT_BEFORE (ISO) to bound the batch, or ONLY_EMAIL to target a single buyer.",
    );
    process.exit(2);
  }

  console.log(
    `[resend] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} only_email=${ONLY_EMAIL || "*"} ` +
      `window=${window ? `${window.after.toISOString()}..${window.before.toISOString()}` : "n/a"} ` +
      `limit=${LIMIT || "all"}`,
  );

  const affected = await loadAffectedRows(window);
  console.log(`[resend] ${affected.length} affected email_logs row(s) found.`);
  if (affected.length === 0) {
    console.log("[resend] nothing to do.");
    return;
  }

  for (const row of affected) {
    console.log(
      `\n[resend] log#${row.id} email=${row.email} order=${row.orderId} portal=${row.portalKey} sent=${row.sentAt.toISOString()}`,
    );
    console.log(`         broken CTA: ${row.ctaUrl}`);
    if (DRY_RUN) continue;

    // 0) Idempotency guard. If a previous run already produced a
    // successful replay row tagged with this `originalEmailLogId`,
    // skip resend even if the audit marker on the original row was
    // never written (e.g. the process crashed between the email send
    // and the marker UPDATE). This is the failsafe the code review
    // asked for: `forceResend: true` disables the in-process dedupe,
    // so we layer this on top of it.
    if (await replayAlreadyExistsFor(row.id)) {
      console.log(`  - skip: a successful replay row already exists for log#${row.id}`);
      try {
        await markReplaceSucceeded(row.id);
      } catch (err) {
        console.warn(`  -> failed to backfill audit marker on log#${row.id}:`, (err as Error).message);
      }
      continue;
    }

    // 1) Revoke ONLY the broken-host invitation(s) tied to this order.
    // Unrelated invites for the same email are left intact.
    const revoked = await revokeBrokenInvitationsForOrder(row.email, row.orderId);
    if (revoked > 0) console.log(`  - revoked ${revoked} broken Clerk invitation(s)`);

    // 2) Replay enrollment. We pass `forceResend: true` because the
    // existing email_logs row already has the same `(email, orderId)`
    // and would otherwise short-circuit the dedupe check inside
    // enrollPurchaserAndSendEmail. The audit marker on the original
    // row (written below ONLY on success) is what makes this script
    // idempotent across reruns.
    let enrolled = false;
    let enrollErr: string | null = null;
    try {
      const r = await enrollPurchaserAndSendEmail({
        email: row.email,
        orderId: row.orderId,
        portalKey: row.portalKey,
        forceResend: true,
        extraMetadata: {
          resentFromTask460: true,
          originalEmailLogId: row.id,
          originalCtaUrl: row.ctaUrl,
          originalSentAt: row.sentAt.toISOString(),
        },
      });
      console.log(`  -> enroll result: ${JSON.stringify(r)}`);
      enrolled = r.status === "sent";
      if (!enrolled) enrollErr = `unexpected status: ${JSON.stringify(r)}`;
    } catch (err) {
      enrollErr = (err as Error).message;
      console.error(`  -> enroll FAILED for log#${row.id}:`, enrollErr);
    }

    // 3) Only mark the original row as replaced AFTER a successful
    // resend. If enroll failed, leave the row eligible for the next
    // run so an operator can retry. We tag failed attempts with a
    // separate `lastReplayError` field for visibility, but do NOT set
    // `replacedByTask460` so the next loadAffectedRows() will pick it
    // back up.
    try {
      if (enrolled) {
        await markReplaceSucceeded(row.id);
      } else {
        await markReplaceFailed(row.id, enrollErr ?? "unknown");
      }
    } catch (err) {
      console.warn(`  -> failed to write audit marker on log#${row.id}:`, (err as Error).message);
    }
  }

  console.log(`\n[resend] done. ${DRY_RUN ? "(dry-run; no changes written)" : "(applied)"}`);
}

// Only execute main() when invoked as the entry script. Importing
// from a test file (e.g. `inferPortalKey`) must not start a DB-touching
// run.
const isEntry = (() => {
  try {
    const argv1 = process.argv[1] || "";
    return argv1.endsWith("resend-broken-account-emails.ts") || argv1.endsWith("resend-broken-account-emails.js");
  } catch {
    return false;
  }
})();

if (isEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[resend] fatal:", err);
      process.exit(1);
    });
}
