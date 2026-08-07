// Task #774: shared read-only health audits.
//
// Four cheap, read-only checks that surface the recurring Room30 support
// failure modes BEFORE a customer reports them. Used by two callers:
//   - the daily health-check scheduler (worker) -> logs + #ops Slack alert
//   - the admin endpoint GET /api/portal/admin/health-check -> on-demand
//
// Every audit is strictly read-only (SELECT / external GET). Nothing here
// writes to the DB or any third party. Each audit catches its own errors
// and reports `ok:false` with a reason rather than throwing, so one broken
// audit never sinks the whole run.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { isWistiaMediaReachable } from "./wistia";

export type AuditSeverity = "ok" | "warn" | "error";

export type AuditResult = {
  name: string;
  label: string;
  severity: AuditSeverity;
  summary: string;
  count: number;
  details?: Record<string, unknown>;
};

export type HealthAuditReport = {
  ranAt: string;
  durationMs: number;
  hasFindings: boolean;
  audits: AuditResult[];
};

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

// ---- Audit 1: duplicate portal_users rows (entitlement drift) ----
// The Jess / David / Eimy / Olli failure mode: a buyer ends up with more
// than one room30 portal_users row for the same email, so an admin grant
// (or a purchase) lands on row A while the user signs in via row B and
// still sees the product locked.
async function auditEntitlementDrift(): Promise<AuditResult> {
  const name = "entitlement_drift";
  const label = "Duplicate portal_users rows (entitlement drift)";
  try {
    const result = await db.execute(sql`
      SELECT lower(email) AS email, count(*) AS n
      FROM portal_users
      WHERE portal_key = 'room30' AND email IS NOT NULL AND email <> ''
      GROUP BY lower(email)
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 50
    `);
    const rows =
      (result as unknown as { rows: Array<{ email: string; n: number }> }).rows ?? [];
    const count = rows.length;
    return {
      name,
      label,
      severity: count > 0 ? "warn" : "ok",
      count,
      summary:
        count > 0
          ? `${count} email(s) have more than one room30 portal_users row - admin grants/purchases may land on the wrong row.`
          : "No duplicate portal_users rows.",
      details: count > 0 ? { emails: rows.map((r) => r.email).slice(0, 25) } : undefined,
    };
  } catch (err: unknown) {
    return {
      name,
      label,
      severity: "error",
      count: 0,
      summary: `Audit failed: ${errMessage(err)}`,
    };
  }
}

// ---- Audit 2: paid buyers with no AI Influencer build job ----
// Every main-product buyer is owed one free AI Influencer build. If the
// buyer has a paid order (by email) but no ai_influencer_jobs row for
// their app_users id (excluding failed jobs), the free build never got
// queued and they will sit on an empty "Your Influencers" page.
async function auditMissingInfluencerBuilds(): Promise<AuditResult> {
  const name = "dfy_missing_builds";
  const label = "Paid buyers with no AI Influencer build";
  try {
    const result = await db.execute(sql`
      SELECT u.id AS user_id, lower(u.email) AS email
      FROM app_users u
      WHERE u.email IS NOT NULL AND u.email <> ''
        AND EXISTS (
          SELECT 1 FROM orders o
          WHERE lower(o.email) = lower(u.email)
            AND o.main_product_paid = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_influencer_jobs j
          WHERE j.client_id = u.id
            AND j.status <> 'failed'
        )
      ORDER BY u.id DESC
      LIMIT 200
    `);
    const rows =
      (result as unknown as { rows: Array<{ user_id: number; email: string }> })
        .rows ?? [];
    const count = rows.length;
    return {
      name,
      label,
      severity: count > 0 ? "warn" : "ok",
      count,
      summary:
        count > 0
          ? `${count} paid buyer(s) have no AI Influencer build job queued.`
          : "Every paid buyer has at least one (non-failed) AI Influencer build.",
      details:
        count > 0
          ? { sample: rows.slice(0, 25).map((r) => ({ userId: r.user_id, email: r.email })) }
          : undefined,
    };
  } catch (err: unknown) {
    return {
      name,
      label,
      severity: "error",
      count: 0,
      summary: `Audit failed: ${errMessage(err)}`,
    };
  }
}

// ---- Audit 3: published workshop recordings whose Wistia media is unreachable ----
// A published recording with a typo'd / deleted Wistia media id renders a
// dead player for every Platinum member. We probe the public Wistia media
// metadata endpoint (GET, read-only) for each published recording.
async function auditWorkshopRecordingReachability(): Promise<AuditResult> {
  const name = "workshop_recording_reachability";
  const label = "Published workshop recordings with unreachable Wistia media";
  try {
    const result = await db.execute(sql`
      SELECT id, title, wistia_media_id
      FROM workshop_recordings
      WHERE published_at IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT 100
    `);
    const rows =
      (result as unknown as {
        rows: Array<{ id: number; title: string; wistia_media_id: string }>;
      }).rows ?? [];

    const unreachable: Array<{ id: number; title: string; wistiaMediaId: string }> = [];
    // Sequential probes keep us well under any Wistia rate limit; the set
    // of published recordings is small (tens, not thousands).
    for (const row of rows) {
      const id = String(row.wistia_media_id ?? "").trim();
      if (!id || !(await isWistiaMediaReachable(id))) {
        unreachable.push({ id: row.id, title: row.title, wistiaMediaId: id });
      }
    }
    const count = unreachable.length;
    return {
      name,
      label,
      severity: count > 0 ? "error" : "ok",
      count,
      summary:
        count > 0
          ? `${count} published recording(s) point at an unreachable Wistia media id.`
          : `All ${rows.length} published recording(s) have a reachable Wistia media id.`,
      details: count > 0 ? { unreachable } : undefined,
    };
  } catch (err: unknown) {
    return {
      name,
      label,
      severity: "error",
      count: 0,
      summary: `Audit failed: ${errMessage(err)}`,
    };
  }
}

export async function runHealthAudits(): Promise<HealthAuditReport> {
  const start = Date.now();
  const [drift, builds, recordings] = await Promise.all([
    auditEntitlementDrift(),
    auditMissingInfluencerBuilds(),
    auditWorkshopRecordingReachability(),
  ]);
  const audits = [drift, builds, recordings];
  const hasFindings = audits.some((a) => a.severity !== "ok");
  const report: HealthAuditReport = {
    ranAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
    hasFindings,
    audits,
  };
  if (hasFindings) {
    logger.warn(
      { audits: audits.filter((a) => a.severity !== "ok") },
      "[health-audits] findings detected",
    );
  }
  return report;
}
