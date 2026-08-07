// External admin API for partner agents (e.g. GetViktor in Slack/Teams).
//
// Two distinct sub-routers live in this file:
//
//   1. externalApiRouter (mounted at /api/admin/external/v1)
//      Auth: x-api-key header validated by requireExternalApiKey middleware.
//      Exposes the read/write endpoints partner agents call. Read access
//      covers every entitlement the portal tracks; write access covers
//      the funnel + portal add-on flags only. High-ticket items
//      (Apex DFY, Portugal Gold/VIP, A-List) are read-only by design and
//      grant/revoke calls against them are rejected with 403.
//
//   2. externalApiAdminRouter (mounted at /api/portal/admin/external-api)
//      Auth: requireSuperAdmin (Clerk session). Lets the operator mint
//      and revoke keys, view the audit log, and toggle the global
//      kill-switch from the room30-portal admin panel.
//
// Every authenticated external request is recorded in the
// external_api_audit_log table - reads as well as writes. Write
// endpoints also snapshot before/after entitlement state so any
// grant or revoke can be reconstructed and reversed.

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  portalUsersTable,
  coachingAgreementsTable,
  platinumFounderCodesTable,
  externalApiKeysTable,
  externalApiSettingsTable,
  externalApiAuditLogTable,
  aiInfluencerJobsTable,
  accessLogsTable,
  lessonProgressTable,
  appUsers as appUsersTable,
  videoCreditsTable,
  type ExternalApiAuditLog,
} from "@workspace/db";
import { requireSuperAdmin } from "../middlewares/requireAuth";
import {
  requireExternalApiKey,
  hashExternalApiKey,
  loadExternalApiSettings,
} from "../middlewares/requireExternalApiKey";
import { computePurchaseEntitlements } from "./portal";
import { enrollPurchaserAndSendEmail } from "../lib/purchase-enrollment";
import { logger } from "../lib/logger";

// ─────────────────────────────────────────────────────────────────────────
// Product catalogue. Single source of truth for "what can be granted"
// and "what is read-only". Slugs are stable - external integrations
// store and reuse them, so renaming here is a breaking change.
// ─────────────────────────────────────────────────────────────────────────

type WriteableProduct =
  | "bump1"
  | "bump2"
  | "bump3"
  | "upsell1"
  | "upsell2"
  | "upsell3"
  | "downsell1"
  | "platinum-club"
  | "tiktok-slideshow-masterclass"
  | "hook-demo-library"
  | "done-for-you-pack"
  | "our-portfolio"
  | "main";

type ReadOnlyProduct = "apex-dfy" | "portugal-gold" | "portugal-vip" | "a-list";

type ProductSlug = WriteableProduct | ReadOnlyProduct;

interface ProductDef {
  slug: ProductSlug;
  label: string;
  category: "main" | "bump" | "upsell" | "downsell" | "addon" | "high_ticket";
  writeable: boolean;
  // The orders.* boolean column this slug toggles (writeable products only).
  paidField?: keyof typeof ordersTable.$inferSelect;
}

// Note: downsell3 (30-day-free Platinum) shares orders.upsell3Paid with
// upsell3, so externally it is exposed as the single "platinum-club"
// slug (matches the canonical entitlement). External callers do not
// need to distinguish the two purchase paths.
const PRODUCTS: ProductDef[] = [
  // The $27 funnel entry is writeable via the external API so partner
  // agents (e.g. GetViktor) can resolve the most common support ticket:
  // "I paid but cannot access the course." The grant flips
  // mainProductPaid:true ONLY on the synthetic admin-grant-<userId>
  // order row (id prefix + currentStep:"admin-granted"), and every
  // downstream funnel-reporting / cohort / revenue worker filters
  // synthetic rows out by that id prefix - so a comped grant never
  // contaminates real $27 funnel-sale metrics. Partner agents are
  // expected to verify the underlying Whop / Stripe purchase before
  // calling grant; the API itself does not re-check.
  { slug: "main", label: "AI Influencer Masterclass + DFY Build ($27 main offer)", category: "main", writeable: true, paidField: "mainProductPaid" },
  { slug: "bump1", label: "VSL Vault (legacy $47 order bump)", category: "bump", writeable: true, paidField: "bump1Paid" },
  { slug: "bump2", label: "2,000 Hook Prompt Library ($27 order bump)", category: "bump", writeable: true, paidField: "bump2Paid" },
  { slug: "bump3", label: "TikTok Slideshow + IG Follow Hijack ($37 order bump)", category: "bump", writeable: true, paidField: "bump3Paid" },
  { slug: "upsell1", label: "Done-For-You Pack ($197 upsell)", category: "upsell", writeable: true, paidField: "upsell1Paid" },
  { slug: "downsell1", label: "Done-For-You Pack discounted ($97 downsell)", category: "downsell", writeable: true, paidField: "downsell1Paid" },
  { slug: "upsell2", label: "Our Portfolio - 47 products + 5 AI Influencers ($297 upsell, also satisfies bump1)", category: "upsell", writeable: true, paidField: "upsell2Paid" },
  { slug: "upsell3", label: "1-1 Strategy Call ($497 upsell)", category: "upsell", writeable: true, paidField: "upsell3Paid" },
  { slug: "platinum-club", label: "Platinum Club (canonical entitlement, covers both upsell3 and downsell3 30-day trial)", category: "addon", writeable: true, paidField: "platinumPaid" },
  { slug: "tiktok-slideshow-masterclass", label: "TikTok AI Slideshow Masterclass (portal add-on)", category: "addon", writeable: true, paidField: "tiktokSlideshowPaid" },
  { slug: "hook-demo-library", label: "2,000 Hook Library (portal add-on)", category: "addon", writeable: true, paidField: "hookDemoPaid" },
  { slug: "done-for-you-pack", label: "Done For You Pack (portal add-on)", category: "addon", writeable: true, paidField: "doneForYouPackPaid" },
  { slug: "our-portfolio", label: "Our Portfolio (portal add-on)", category: "addon", writeable: true, paidField: "portfolioPaid" },
  { slug: "apex-dfy", label: "Apex Offers DFY Build ($15,000 high-ticket, read-only)", category: "high_ticket", writeable: false },
  { slug: "portugal-gold", label: "Portugal Retreat Gold Pass ($4,997 high-ticket, read-only)", category: "high_ticket", writeable: false },
  { slug: "portugal-vip", label: "Portugal Retreat VIP Pass ($7,497 high-ticket, read-only)", category: "high_ticket", writeable: false },
  { slug: "a-list", label: "A-List membership (high-ticket inner circle, read-only)", category: "high_ticket", writeable: false },
];

const PRODUCT_BY_SLUG = new Map<string, ProductDef>(PRODUCTS.map((p) => [p.slug, p]));

// ─────────────────────────────────────────────────────────────────────────
// Audit-log helper. Always best-effort: a logging failure must never
// take down the underlying request, since for write endpoints the
// state has already been mutated.
// ─────────────────────────────────────────────────────────────────────────

interface AuditOpts {
  req: Request;
  action: string;
  targetEmail?: string | null;
  requestBody?: unknown;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  statusCode: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

async function writeAudit(opts: AuditOpts): Promise<void> {
  try {
    const key = opts.req.externalApiKey;
    const ip = (opts.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || opts.req.ip || null;
    await db.insert(externalApiAuditLogTable).values({
      keyId: key?.id ?? null,
      keyName: key?.name ?? null,
      keyLast4: key?.last4 ?? null,
      method: opts.req.method,
      path: opts.req.originalUrl,
      action: opts.action,
      targetEmail: opts.targetEmail ? opts.targetEmail.toLowerCase() : null,
      requestBody: opts.requestBody as any,
      beforeState: opts.beforeState as any,
      afterState: opts.afterState as any,
      reason: opts.reason ?? null,
      ip,
      userAgent: (opts.req.headers["user-agent"] as string) || null,
      statusCode: opts.statusCode,
      errorCode: opts.errorCode ?? null,
      errorMessage: opts.errorMessage ?? null,
    });
  } catch (err) {
    logger.error({ err, action: opts.action }, "[external-api] audit log write failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────

// Resolve the `app_users.id` for a portal user. `ai_influencer_jobs.client_id`
// is keyed to `app_users.id` (NOT `portal_users.id` - the two tables have
// independent id sequences, see Task #362). Lookup order: clerkId
// (canonical, unique on app_users), then email as a fallback for users
// whose Clerk row has not been synced yet. Returns null when the buyer
// has never signed in (no app_users row, therefore no jobs possible).
export async function resolveAppUserIdForPortalUser(portalUser: {
  clerkId?: string | null;
  email: string;
}): Promise<number | null> {
  if (portalUser.clerkId) {
    const [row] = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.clerkId, portalUser.clerkId))
      .limit(1);
    if (row) return row.id;
  }
  const lower = portalUser.email.trim().toLowerCase();
  const [row] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.email, lower))
    .limit(1);
  return row?.id ?? null;
}

// Count free-tier AI Influencer jobs that consume quota. Mirrors
// `countActiveInfluencerJobs` in routes/influencer-jobs.ts (status='failed'
// rows are excluded so a failed build does not burn a generation slot).
// Kept local here to avoid a circular import.
async function countUsedInfluencerGenerations(appUserId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiInfluencerJobsTable)
    .where(
      and(
        eq(aiInfluencerJobsTable.clientId, appUserId),
        eq(aiInfluencerJobsTable.isFreeTier, true),
        sql`${aiInfluencerJobsTable.status} <> 'failed'`,
      ),
    );
  return row?.c ?? 0;
}

async function buildUserDossier(email: string) {
  const lower = email.trim().toLowerCase();

  const [portalUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, lower))
    .limit(1);

  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.email, lower))
    .orderBy(desc(ordersTable.createdAt));

  const coaching = await db
    .select()
    .from(coachingAgreementsTable)
    .where(eq(coachingAgreementsTable.email, lower))
    .orderBy(desc(coachingAgreementsTable.signedAt));

  const founderCodes = await db
    .select()
    .from(platinumFounderCodesTable)
    .where(eq(platinumFounderCodesTable.ownerEmail, lower));

  const entitlements = portalUser ? await computePurchaseEntitlements(portalUser) : null;

  // Video Studio credit balance (Task #828). Separate wallet from
  // research / os-tool credits; 0 when no wallet row exists yet.
  const videoCreditsBalance = portalUser
    ? await (async () => {
        const [row] = await db
          .select({
            balance: videoCreditsTable.balance,
            balanceSubunits: videoCreditsTable.balanceSubunits,
          })
          .from(videoCreditsTable)
          .where(eq(videoCreditsTable.portalUserId, portalUser.id))
          .limit(1);
        // Fractional-credit ledger: sub-units are authoritative; fall back to
        // legacy*100 for un-backfilled rows.
        return row?.balanceSubunits != null
          ? Number(row.balanceSubunits) / 100
          : Number(row?.balance ?? 0);
      })()
    : 0;

  // AI Influencer generation cap = 1 base + entitlement-derived bonus
  // (upsell2 / portfolio / admin) + portal_users.bonus_influencer_quota
  // override. `used` counts non-failed free-tier jobs against the
  // buyer's app_users.id (= ai_influencer_jobs.client_id). When the
  // buyer has not signed in yet there is no app_users row and `used` is
  // 0 by definition.
  const generations = portalUser
    ? await (async () => {
        const limit = 1 + (entitlements?.bonusInfluencerQuota ?? 0);
        const appUserId = await resolveAppUserIdForPortalUser(portalUser);
        const used = appUserId != null ? await countUsedInfluencerGenerations(appUserId) : 0;
        return { limit, used, remaining: Math.max(0, limit - used) };
      })()
    : null;

  // High-ticket detection from coaching_agreements.
  const activeCoaching = coaching.filter((c) => c.status === "signed" || c.status === "active");
  const apexDfy = activeCoaching.some((c) => c.agreementType === "dfy");
  const portugalGold = activeCoaching.some((c) => c.agreementType === "portugal_gold");
  const portugalVip = activeCoaching.some((c) => c.agreementType === "portugal_vip");

  // Access / usage evidence for refund-eligibility decisions. Read-only,
  // derived from access_logs + lesson_progress. Null when the buyer never
  // created a portal account (no portal_users row to key the queries off).
  const accessActivity = portalUser
    ? await (async () => {
        const userId = portalUser.id;

        const [totalRow] = await db
          .select({ value: count() })
          .from(accessLogsTable)
          .where(eq(accessLogsTable.userId, userId));

        const [firstRow] = await db
          .select({ at: accessLogsTable.createdAt })
          .from(accessLogsTable)
          .where(eq(accessLogsTable.userId, userId))
          .orderBy(asc(accessLogsTable.createdAt))
          .limit(1);

        const [lastRow] = await db
          .select({ at: accessLogsTable.createdAt })
          .from(accessLogsTable)
          .where(eq(accessLogsTable.userId, userId))
          .orderBy(desc(accessLogsTable.createdAt))
          .limit(1);

        const [lessonViewRow] = await db
          .select({ value: count() })
          .from(accessLogsTable)
          .where(
            and(eq(accessLogsTable.userId, userId), eq(accessLogsTable.action, "lesson_view")),
          );

        const distinctLessons = await db
          .selectDistinct({ resourceId: accessLogsTable.resourceId })
          .from(accessLogsTable)
          .where(
            and(eq(accessLogsTable.userId, userId), eq(accessLogsTable.action, "lesson_view")),
          );

        const [completedRow] = await db
          .select({ value: count() })
          .from(lessonProgressTable)
          .where(
            and(eq(lessonProgressTable.userId, userId), eq(lessonProgressTable.completed, true)),
          );

        const recent = await db
          .select({
            action: accessLogsTable.action,
            resourceType: accessLogsTable.resourceType,
            resourceId: accessLogsTable.resourceId,
            ipAddress: accessLogsTable.ipAddress,
            createdAt: accessLogsTable.createdAt,
          })
          .from(accessLogsTable)
          .where(eq(accessLogsTable.userId, userId))
          .orderBy(desc(accessLogsTable.createdAt))
          .limit(20);

        return {
          totalLogEntries: totalRow?.value ?? 0,
          firstAccessAt: firstRow?.at ?? null,
          lastAccessAt: lastRow?.at ?? null,
          lastLoginAt: portalUser.lastLoginAt,
          lessonViewCount: lessonViewRow?.value ?? 0,
          distinctLessonsViewed: distinctLessons.filter((r) => r.resourceId != null).length,
          completedLessonCount: completedRow?.value ?? 0,
          recentActivity: recent,
        };
      })()
    : null;

  return {
    found: !!portalUser || orders.length > 0 || coaching.length > 0,
    user: portalUser
      ? {
          id: portalUser.id,
          email: portalUser.email,
          firstName: portalUser.firstName,
          lastName: portalUser.lastName,
          role: portalUser.role,
          isActive: !!portalUser.isActive,
          clerkId: portalUser.clerkId,
          createdAt: portalUser.createdAt,
          lastLoginAt: portalUser.lastLoginAt,
          welcomeEmailSentAt: portalUser.welcomeEmailSentAt,
        }
      : null,
    entitlements: entitlements
      ? {
          // Funnel + portal add-on entitlements (writeable).
          main: orders.some((o) => !!o.mainProductPaid),
          bump1: !!entitlements.bump1Paid,
          bump2: !!entitlements.bump2Paid,
          bump3: !!entitlements.bump3Paid,
          upsell1: !!entitlements.upsell1Paid,
          upsell2: !!entitlements.upsell2Paid,
          upsell3: !!entitlements.upsell3Paid,
          downsell1: !!entitlements.downsell1Paid,
          "platinum-club": !!entitlements.platinumPaid || !!entitlements.upsell3Paid,
          "tiktok-slideshow-masterclass": !!entitlements.tiktokSlideshowPaid,
          "hook-demo-library": !!entitlements.hookDemoPaid,
          "done-for-you-pack": !!entitlements.doneForYouPackPaid,
          "our-portfolio": !!entitlements.portfolioPaid,
          // High-ticket entitlements (read-only).
          "apex-dfy": apexDfy,
          "portugal-gold": portugalGold,
          "portugal-vip": portugalVip,
          "a-list": !!portalUser?.isAList,
        }
      : {
          main: orders.some((o) => !!o.mainProductPaid),
          bump1: orders.some((o) => !!o.bump1Paid),
          bump2: orders.some((o) => !!o.bump2Paid),
          bump3: orders.some((o) => !!o.bump3Paid),
          upsell1: orders.some((o) => !!o.upsell1Paid),
          upsell2: orders.some((o) => !!o.upsell2Paid),
          upsell3: orders.some((o) => !!o.upsell3Paid),
          downsell1: orders.some((o) => !!o.downsell1Paid),
          "platinum-club": orders.some((o) => !!o.platinumPaid || !!o.upsell3Paid),
          "tiktok-slideshow-masterclass": orders.some((o) => !!o.tiktokSlideshowPaid),
          "hook-demo-library": orders.some((o) => !!o.hookDemoPaid),
          "done-for-you-pack": orders.some((o) => !!o.doneForYouPackPaid),
          "our-portfolio": orders.some((o) => !!o.portfolioPaid),
          "apex-dfy": apexDfy,
          "portugal-gold": portugalGold,
          "portugal-vip": portugalVip,
          "a-list": false,
        },
    credits: portalUser
      ? {
          aiUsageCents: portalUser.aiUsageCents,
          researchPaidCredits: portalUser.researchPaidCredits,
          osToolPaidCredits: portalUser.osToolPaidCredits,
          videoCredits: videoCreditsBalance,
        }
      : null,
    generations,
    coachingAgreements: coaching.map((c) => ({
      id: c.id,
      agreementType: c.agreementType,
      status: c.status,
      packagePriceCents: c.packagePriceCents,
      paidAt: c.paidAt,
      signedAt: c.signedAt,
    })),
    platinumFounderCodes: founderCodes.map((c) => ({
      code: c.code,
      status: c.status,
      redeemedForProductSlug: c.redeemedForProductSlug,
      redeemedAt: c.redeemedAt,
    })),
    orderSummary: {
      total: orders.length,
      hasRealWhopOrder: orders.some((o) => !!o.whopReceiptId || !!o.whopMembershipId),
      hasRealStripeOrder: orders.some((o) => !!o.stripePaymentIntentId),
      hasAdminGrantRow: orders.some((o) => typeof o.id === "string" && o.id.startsWith("admin-grant")),
    },
    accessActivity,
  };
}

// Find or create a portal_users row for an email so we can attach
// admin-grant flags to a userId. New rows are created with
// isActive=true so the buyer can immediately sign in via the welcome
// email (mirrors what enrollPurchaserAndSendEmail expects on the
// Clerk-invitation path).
export async function ensurePortalUserByEmail(email: string) {
  const lower = email.trim().toLowerCase();
  const [existing] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, lower))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(portalUsersTable)
    .values({
      email: lower,
      role: "student",
      isActive: true,
      // Task #501: external-API admin-grant and order-attachment flows run
      // before/around Clerk signup. Without an explicit portalKey here the
      // row landed with the historical 'main' default and caused a
      // cross-portal 403 in requireAuth once the buyer signed in. Pin it
      // to "room30" - this is a non-request context with no req to read
      // getPortalKey() from, and after Task #491 'main' no longer exists.
      portalKey: "room30",
    })
    .returning();
  return created!;
}

// ─────────────────────────────────────────────────────────────────────────
// External API router (auth: x-api-key)
// ─────────────────────────────────────────────────────────────────────────

const externalApiRouter: IRouter = Router();

// Public discovery endpoints (no auth) so partner agents can confirm
// reachability and download the OpenAPI surface they should call.
externalApiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gregory-external-admin-api", version: "v1" });
});

externalApiRouter.get("/openapi.json", (_req, res) => {
  res.json(buildOpenApiSpec());
});

// All routes below require a valid x-api-key.
externalApiRouter.use(requireExternalApiKey);

// Task #708: Influencer lifecycle endpoints (queue → claim → upload
// assets → complete) so an external agent (Viktor) can run generation
// while INFLUENCER_INTERNAL_PIPELINE_ENABLED is off. Auth is shared
// (x-api-key) and every action funnels through the same writeAudit
// row as the existing user-grant routes.
import { createInfluencerApiRoutes } from "./external-api-influencers";
externalApiRouter.use(createInfluencerApiRoutes(writeAudit));

// Dispute-defense read-only endpoints. Mirrors the internal admin UI's
// evidence packet so partner agents can answer refund/chargeback
// questions directly: full evidence JSON, paginated access log, terms
// acceptances, refund-window eligibility (180-day MBG on main, EU 16(m)
// non-refundable on every upgrade), and a streamed PDF.
import { createDisputeDefenseApiRoutes } from "./external-api-dispute-defense";
externalApiRouter.use("/dispute-defense", createDisputeDefenseApiRoutes(writeAudit));

// Script Writer SOP generation. Lets a partner agent async-generate the
// seven text/structured SOPs (podcast/speaking/selfie clips, viral
// slideshows/carousels, overlay + fast-motion clips) on behalf of a
// buyer resolved by email. Submit returns 202 { jobId }; poll the same
// job via GET /generate/script/jobs/:id. Reuses the in-portal handlers
// in-process so prompts + brain resolution stay single-sourced.
import { createScriptWriterApiRoutes } from "./external-api-script-writer";
externalApiRouter.use(createScriptWriterApiRoutes(writeAudit));

// GET /products - returns the master catalogue so callers know which
// slugs are valid and which are read-only.
externalApiRouter.get("/products", async (req, res) => {
  const body = {
    products: PRODUCTS.map((p) => ({
      slug: p.slug,
      label: p.label,
      category: p.category,
      writeable: p.writeable,
    })),
  };
  await writeAudit({ req, action: "products.list", statusCode: 200 });
  res.json(body);
  return;
});

// GET /user?email=...
externalApiRouter.get("/user", async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) {
    await writeAudit({ req, action: "user.lookup", statusCode: 400, errorCode: "missing_email" });
    res.status(400).json({ error: "missing_email" });
    return;
  }
  try {
    const dossier = await buildUserDossier(email);
    await writeAudit({ req, action: "user.lookup", targetEmail: email, statusCode: 200 });
    res.json(dossier);
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] user lookup failed");
    await writeAudit({
      req,
      action: "user.lookup",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// GET /user/access?email=...&product=...
externalApiRouter.get("/user/access", async (req, res) => {
  const email = String(req.query.email || "").trim();
  const productSlug = String(req.query.product || "").trim();
  if (!email || !productSlug) {
    await writeAudit({ req, action: "user.access", statusCode: 400, errorCode: "missing_params" });
    res.status(400).json({ error: "missing_params", message: "email and product are required" });
    return;
  }
  const def = PRODUCT_BY_SLUG.get(productSlug);
  if (!def) {
    await writeAudit({
      req,
      action: "user.access",
      targetEmail: email,
      statusCode: 400,
      errorCode: "unknown_product",
    });
    res.status(400).json({ error: "unknown_product", message: `Unknown product slug: ${productSlug}` });
    return;
  }
  try {
    const dossier = await buildUserDossier(email);
    const hasAccess = dossier.entitlements ? !!(dossier.entitlements as any)[def.slug] : false;
    await writeAudit({ req, action: "user.access", targetEmail: email, statusCode: 200 });
    res.json({
      email: email.toLowerCase(),
      product: def.slug,
      hasAccess,
      writeable: def.writeable,
      foundUser: dossier.found,
    });
    return;
  } catch (err) {
    logger.error({ err, email, productSlug }, "[external-api] access check failed");
    await writeAudit({
      req,
      action: "user.access",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/grant
const grantBody = z.object({
  email: z.string().email(),
  products: z.array(z.string()).min(1),
  reason: z.string().min(1).max(500),
  sendWelcomeEmail: z.boolean().optional(),
});

externalApiRouter.post("/user/grant", async (req, res) => {
  const parsed = grantBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({ req, action: "user.grant", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, products, reason, sendWelcomeEmail } = parsed.data;

  // Validate every requested slug exists and is writeable before mutating.
  const defs: ProductDef[] = [];
  for (const slug of products) {
    const def = PRODUCT_BY_SLUG.get(slug);
    if (!def) {
      await writeAudit({ req, action: "user.grant", targetEmail: email, statusCode: 400, errorCode: "unknown_product", requestBody: req.body, reason });
      res.status(400).json({ error: "unknown_product", product: slug });
      return;
    }
    if (!def.writeable) {
      await writeAudit({ req, action: "user.grant", targetEmail: email, statusCode: 403, errorCode: "read_only_product", requestBody: req.body, reason });
      res.status(403).json({
        error: "read_only_product",
        product: slug,
        message: `${slug} is a high-ticket product and is read-only via the external API. Manage it directly in the admin panel.`,
      });
      return;
    }
    defs.push(def);
  }

  try {
    const before = await buildUserDossier(email);
    const portalUser = await ensurePortalUserByEmail(email);

    const syntheticId = `admin-grant-${portalUser.id}`;
    const patch: Record<string, boolean> = {};
    for (const def of defs) {
      if (def.paidField) patch[def.paidField as string] = true;
    }

    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, syntheticId)).limit(1);
    if (existing) {
      await db.update(ordersTable).set({ ...patch, updatedAt: new Date() }).where(eq(ordersTable.id, syntheticId));
    } else {
      // mainProductPaid defaults to false on the synthetic row; if the
      // grant includes the "main" slug, the ...patch spread overrides
      // it to true. Downstream funnel-reporting / cohort / revenue
      // workers filter every "admin-grant-<userId>" row out by id
      // prefix and currentStep, so a comped grant (including main)
      // never contaminates real $27 funnel-sale metrics. Mirrors
      // applyInviteEntitlements + PATCH /portal/admin/users/:userId/access.
      await db.insert(ordersTable).values({
        id: syntheticId,
        email: portalUser.email,
        currentStep: "admin-granted",
        mainProductPaid: false,
        ...patch,
      });
    }

    // Trigger welcome / unlock email when the grant introduces the
    // first taste of paid product for a brand-new buyer. Skip silently
    // when sendWelcomeEmail is explicitly false. enrollPurchaserAndSendEmail
    // is itself idempotent on (email, orderId) so re-running on a repeat
    // grant is a no-op.
    if (sendWelcomeEmail !== false) {
      try {
        await enrollPurchaserAndSendEmail({
          email: portalUser.email,
          orderId: syntheticId,
          // Route course-portal users to /portal/sign-up under the Apex
          // Offers brand; Room30 users to /members/sign-up under the
          // Room30 AI brand. portal_users.portal_key is the source of
          // truth set at sign-up time from the X-Portal-Key header.
          portalKey: portalUser.portalKey === "room30" ? "room30" : "main",
        });
      } catch (err) {
        logger.warn({ err, email: portalUser.email }, "[external-api] welcome email enroll failed");
      }
    }

    const after = await buildUserDossier(email);
    await writeAudit({
      req,
      action: "user.grant",
      targetEmail: email,
      statusCode: 200,
      requestBody: req.body,
      beforeState: before.entitlements,
      afterState: after.entitlements,
      reason,
    });
    res.json({ ok: true, granted: defs.map((d) => d.slug), before: before.entitlements, after: after.entitlements });
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] grant failed");
    await writeAudit({
      req,
      action: "user.grant",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/influencer-bonus
//
// Grant N bonus AI Influencer generations to a buyer. Writes
// `portal_users.bonus_influencer_quota`, which computePurchaseEntitlements
// sums onto the base entitlement (1 free + 5 from upsell2Paid). Total
// cap becomes 1 + (upsell2 ? 5 : 0) + bonusInfluencerQuota.
//
// Body: `{ email, add: N, reason }` to increment by N (negative
// allowed), OR `{ email, set: N, reason }` to overwrite to exactly N.
// Floor 0; no upper cap.
const influencerBonusBody = z
  .object({
    email: z.string().email(),
    add: z.number().int().optional(),
    set: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).max(500),
  })
  .refine(
    (v) =>
      (typeof v.add === "number" || typeof v.set === "number") &&
      !(typeof v.add === "number" && typeof v.set === "number"),
    { message: "Provide exactly one of { add: N } or { set: N }." },
  );

externalApiRouter.post("/user/influencer-bonus", async (req, res) => {
  const parsed = influencerBonusBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({
      req,
      action: "user.influencer_bonus",
      statusCode: 400,
      errorCode: "bad_body",
      requestBody: req.body,
    });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, add, set, reason } = parsed.data;
  try {
    const before = await buildUserDossier(email);
    const portalUser = await ensurePortalUserByEmail(email);
    const prior = portalUser.bonusInfluencerQuota ?? 0;
    const nextRaw = typeof set === "number" ? set : prior + (add ?? 0);
    const next = Math.max(0, nextRaw);
    await db
      .update(portalUsersTable)
      .set({ bonusInfluencerQuota: next })
      .where(eq(portalUsersTable.id, portalUser.id));
    const after = await buildUserDossier(email);
    await writeAudit({
      req,
      action: "user.influencer_bonus",
      targetEmail: email,
      statusCode: 200,
      requestBody: req.body,
      beforeState: { bonusInfluencerQuota: prior, entitlements: before.entitlements },
      afterState: { bonusInfluencerQuota: next, entitlements: after.entitlements },
      reason,
    });
    res.json({
      ok: true,
      email: portalUser.email,
      userId: portalUser.id,
      bonusInfluencerQuota: next,
      previous: prior,
      delta: next - prior,
    });
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] influencer-bonus failed");
    await writeAudit({
      req,
      action: "user.influencer_bonus",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/generation-cap
//
// Adjust a buyer's AI Influencer generation cap by `delta` (signed
// integer). Writes `portal_users.bonus_influencer_quota` - the only
// knob the support agent can turn without touching real order rows.
//
// Resulting `newLimit` = max(0, oldLimit + delta) where the limit is
// the FULL effective cap (1 base + entitlement-derived bonus + override).
// The override is clamped so that the limit never drops below the
// non-bonus baseline (1 + entitlement bonus), matching what existing
// product entitlements already guarantee. A delta that would push the
// limit below `used` is allowed (remaining=0); a delta that would push
// it below 0 is clamped at 0.
//
// 404 when the email has no portal_users row (this endpoint does NOT
// create users - that is what `/user/grant` is for).
const generationCapBody = z.object({
  email: z.string().email(),
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
});

externalApiRouter.post("/user/generation-cap", async (req, res) => {
  const parsed = generationCapBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({
      req,
      action: "user.generation_cap",
      statusCode: 400,
      errorCode: "bad_body",
      requestBody: req.body,
    });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, delta, reason } = parsed.data;
  const lower = email.trim().toLowerCase();
  try {
    const [portalUser] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.email, lower))
      .limit(1);
    if (!portalUser) {
      await writeAudit({
        req,
        action: "user.generation_cap",
        targetEmail: lower,
        statusCode: 404,
        errorCode: "user_not_found",
        requestBody: req.body,
        reason,
      });
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const beforeEnt = await computePurchaseEntitlements(portalUser);
    const previousLimit = 1 + (beforeEnt.bonusInfluencerQuota ?? 0);
    const targetLimit = Math.max(0, previousLimit + delta);
    // The only writable knob is bonus_influencer_quota; entitlement-
    // derived extras and the +1 base are immutable from this endpoint.
    // Solve for the new override so that the recomputed effective limit
    // equals targetLimit. Floor at 0 - if targetLimit < (immutable
    // baseline) we leave the override at 0 and the actual newLimit will
    // be the baseline (still >= 0, audit reflects reality).
    const priorOverride = portalUser.bonusInfluencerQuota ?? 0;
    const immutableBaseline = previousLimit - priorOverride;
    const nextOverride = Math.max(0, targetLimit - immutableBaseline);

    await db
      .update(portalUsersTable)
      .set({ bonusInfluencerQuota: nextOverride })
      .where(eq(portalUsersTable.id, portalUser.id));

    const [reloaded] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.id, portalUser.id))
      .limit(1);
    const afterEnt = await computePurchaseEntitlements(reloaded!);
    const newLimit = 1 + (afterEnt.bonusInfluencerQuota ?? 0);
    const appUserId = await resolveAppUserIdForPortalUser(portalUser);
    const used = appUserId != null ? await countUsedInfluencerGenerations(appUserId) : 0;
    const remaining = Math.max(0, newLimit - used);

    await writeAudit({
      req,
      action: "user.generation_cap",
      targetEmail: portalUser.email,
      statusCode: 200,
      requestBody: req.body,
      beforeState: { limit: previousLimit, bonusInfluencerQuotaOverride: priorOverride },
      afterState: { limit: newLimit, bonusInfluencerQuotaOverride: nextOverride, used, remaining },
      reason,
    });
    res.json({
      email: portalUser.email,
      previousLimit,
      newLimit,
      used,
      remaining,
    });
    return;
  } catch (err) {
    logger.error({ err, email: lower }, "[external-api] generation-cap failed");
    await writeAudit({
      req,
      action: "user.generation_cap",
      targetEmail: lower,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/revoke
//
// Note on semantics: revoke flips the synthetic admin-grant row's flag
// back to false. If the user also has a real Whop / Stripe order row
// that grants the same product, computePurchaseEntitlements will still
// OR it back to true. The response payload makes this explicit so
// Viktor can report the right outcome to the operator.
const revokeBody = z.object({
  email: z.string().email(),
  products: z.array(z.string()).min(1),
  reason: z.string().min(1).max(500),
});

externalApiRouter.post("/user/revoke", async (req, res) => {
  const parsed = revokeBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({ req, action: "user.revoke", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, products, reason } = parsed.data;

  const defs: ProductDef[] = [];
  for (const slug of products) {
    const def = PRODUCT_BY_SLUG.get(slug);
    if (!def) {
      await writeAudit({ req, action: "user.revoke", targetEmail: email, statusCode: 400, errorCode: "unknown_product", requestBody: req.body, reason });
      res.status(400).json({ error: "unknown_product", product: slug });
      return;
    }
    if (!def.writeable) {
      await writeAudit({ req, action: "user.revoke", targetEmail: email, statusCode: 403, errorCode: "read_only_product", requestBody: req.body, reason });
      res.status(403).json({
        error: "read_only_product",
        product: slug,
        message: `${slug} is a high-ticket product and is read-only via the external API.`,
      });
      return;
    }
    defs.push(def);
  }

  try {
    const before = await buildUserDossier(email);
    const [portalUser] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.email, email.toLowerCase()))
      .limit(1);
    if (!portalUser) {
      await writeAudit({ req, action: "user.revoke", targetEmail: email, statusCode: 404, errorCode: "user_not_found", requestBody: req.body, reason });
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const syntheticId = `admin-grant-${portalUser.id}`;
    const patch: Record<string, boolean> = {};
    for (const def of defs) {
      if (def.paidField) patch[def.paidField as string] = false;
    }
    const updated = await db
      .update(ordersTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(ordersTable.id, syntheticId))
      .returning();
    const adminGrantTouched = updated.length > 0;

    const after = await buildUserDossier(email);

    // Per slug, report whether revoke fully removed the entitlement or
    // whether a real paid order keeps it on. This is the only honest
    // way to expose what we did.
    const perSlug = defs.map((d) => ({
      slug: d.slug,
      stillHasAccess: !!(after.entitlements as any)[d.slug],
      reasonStillActive: (after.entitlements as any)[d.slug] ? "active_real_order" : null,
    }));

    await writeAudit({
      req,
      action: "user.revoke",
      targetEmail: email,
      statusCode: 200,
      requestBody: req.body,
      beforeState: before.entitlements,
      afterState: after.entitlements,
      reason,
    });
    res.json({
      ok: true,
      revoked: defs.map((d) => d.slug),
      adminGrantTouched,
      perProduct: perSlug,
      before: before.entitlements,
      after: after.entitlements,
    });
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] revoke failed");
    await writeAudit({
      req,
      action: "user.revoke",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/credits - adjust portal credit balances.
const creditsBody = z.object({
  email: z.string().email(),
  type: z.enum(["research", "os_tool"]),
  delta: z.number().int(),
  reason: z.string().min(1).max(500),
});

externalApiRouter.post("/user/credits", async (req, res) => {
  const parsed = creditsBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({ req, action: "user.credits", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, type, delta, reason } = parsed.data;
  try {
    const [portalUser] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.email, email.toLowerCase()))
      .limit(1);
    if (!portalUser) {
      await writeAudit({ req, action: "user.credits", targetEmail: email, statusCode: 404, errorCode: "user_not_found", requestBody: req.body, reason });
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const before = {
      researchPaidCredits: portalUser.researchPaidCredits,
      osToolPaidCredits: portalUser.osToolPaidCredits,
    };
    const column = type === "research" ? "researchPaidCredits" : "osToolPaidCredits";
    const sqlColumn = type === "research" ? portalUsersTable.researchPaidCredits : portalUsersTable.osToolPaidCredits;
    const [updated] = await db
      .update(portalUsersTable)
      .set({
        [column]: sql`GREATEST(0, ${sqlColumn} + ${delta})`,
        updatedAt: new Date(),
      } as any)
      .where(eq(portalUsersTable.id, portalUser.id))
      .returning();
    const after = {
      researchPaidCredits: updated!.researchPaidCredits,
      osToolPaidCredits: updated!.osToolPaidCredits,
    };
    await writeAudit({
      req,
      action: "user.credits",
      targetEmail: email,
      statusCode: 200,
      requestBody: req.body,
      beforeState: before,
      afterState: after,
      reason,
    });
    res.json({ ok: true, type, delta, before, after });
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] credits adjust failed");
    await writeAudit({
      req,
      action: "user.credits",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// POST /user/resend-welcome
const resendBody = z.object({
  email: z.string().email(),
  reason: z.string().min(1).max(500),
});

externalApiRouter.post("/user/resend-welcome", async (req, res) => {
  const parsed = resendBody.safeParse(req.body);
  if (!parsed.success) {
    await writeAudit({ req, action: "user.resend_welcome", statusCode: 400, errorCode: "bad_body", requestBody: req.body });
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues });
    return;
  }
  const { email, reason } = parsed.data;
  try {
    const portalUser = await ensurePortalUserByEmail(email);
    // enrollPurchaserAndSendEmail is keyed on (email, orderId). To force a
    // fresh send (operator explicitly asked to resend), use a one-shot
    // synthetic resend orderId derived from the timestamp so the
    // idempotency guard does not short-circuit.
    const orderId = `resend-${Date.now()}-${portalUser.id}`;
    const result = await enrollPurchaserAndSendEmail({ email: portalUser.email, orderId });
    // Task #745: operators call resend-welcome on stuck buyers
    // (`isActive=false`, no welcomeEmailSentAt) to unstick them.
    // enrollPurchaserAndSendEmail already heals isActive on the
    // "sent" branches; here we additionally stamp welcomeEmailSentAt
    // so the operator's audit view immediately reflects that a
    // welcome email went out. We only stamp on a successful send and
    // we leave any existing non-null timestamp alone.
    let activated = false;
    let welcomeStamped = false;
    if (result.status === "sent") {
      const updated = await db
        .update(portalUsersTable)
        .set({
          isActive: true,
          welcomeEmailSentAt: sql`COALESCE(${portalUsersTable.welcomeEmailSentAt}, now())`,
        })
        .where(eq(portalUsersTable.id, portalUser.id))
        .returning({
          isActive: portalUsersTable.isActive,
          welcomeEmailSentAt: portalUsersTable.welcomeEmailSentAt,
        });
      activated = !!updated[0]?.isActive;
      welcomeStamped = !!updated[0]?.welcomeEmailSentAt;
    }
    await writeAudit({
      req,
      action: "user.resend_welcome",
      targetEmail: email,
      statusCode: 200,
      requestBody: req.body,
      afterState: { ...result, activated, welcomeStamped },
      reason,
    });
    res.json({ ok: true, result, activated, welcomeStamped });
    return;
  } catch (err) {
    logger.error({ err, email }, "[external-api] resend welcome failed");
    await writeAudit({
      req,
      action: "user.resend_welcome",
      targetEmail: email,
      statusCode: 500,
      errorCode: "internal_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      requestBody: req.body,
      reason,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Admin management router (auth: requireSuperAdmin)
// Mounted at /api/portal/admin/external-api
// ─────────────────────────────────────────────────────────────────────────

const externalApiAdminRouter: IRouter = Router();

externalApiAdminRouter.get("/keys", requireSuperAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: externalApiKeysTable.id,
      name: externalApiKeysTable.name,
      last4: externalApiKeysTable.last4,
      createdByEmail: externalApiKeysTable.createdByEmail,
      createdAt: externalApiKeysTable.createdAt,
      revokedAt: externalApiKeysTable.revokedAt,
      revokedReason: externalApiKeysTable.revokedReason,
      lastUsedAt: externalApiKeysTable.lastUsedAt,
      lastUsedIp: externalApiKeysTable.lastUsedIp,
    })
    .from(externalApiKeysTable)
    .orderBy(desc(externalApiKeysTable.createdAt));
  res.json({ keys: rows });
});

externalApiAdminRouter.post("/keys", requireSuperAdmin, async (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 120) {
    res.status(400).json({ error: "bad_name", message: "Provide a 1-120 char name." });
    return;
  }
  // 32 random bytes -> 44-char base64url, prefixed so admins can spot
  // the key shape in logs and so a future scanner can detect leaks.
  const raw = crypto.randomBytes(32).toString("base64url");
  const plaintext = `gregk_${raw}`;
  const keyHash = hashExternalApiKey(plaintext);
  const last4 = plaintext.slice(-4);
  const [row] = await db
    .insert(externalApiKeysTable)
    .values({
      keyHash,
      name,
      last4,
      createdByClerkId: req.userId ?? null,
      createdByEmail: req.appUser?.email ?? req.portalUser?.email ?? null,
    })
    .returning({
      id: externalApiKeysTable.id,
      name: externalApiKeysTable.name,
      last4: externalApiKeysTable.last4,
      createdAt: externalApiKeysTable.createdAt,
    });
  // plaintext is returned exactly once - the admin must copy it now.
  res.status(201).json({ key: row, plaintext });
});

externalApiAdminRouter.post("/keys/:id/revoke", requireSuperAdmin, async (req: any, res) => {
  const id = parseInt(String(req.params.id || ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  const reason = String(req.body?.reason || "").trim() || null;
  const [row] = await db
    .update(externalApiKeysTable)
    .set({
      revokedAt: sql`now()`,
      revokedByClerkId: req.userId ?? null,
      revokedReason: reason,
    })
    .where(and(eq(externalApiKeysTable.id, id), sql`${externalApiKeysTable.revokedAt} IS NULL`))
    .returning({ id: externalApiKeysTable.id, revokedAt: externalApiKeysTable.revokedAt });
  if (!row) {
    res.status(404).json({ error: "not_found_or_already_revoked" });
    return;
  }
  res.json({ ok: true, key: row });
});

externalApiAdminRouter.get("/audit-log", requireSuperAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || "100"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10));
  const targetEmail = String(req.query.email || "").trim().toLowerCase();
  const action = String(req.query.action || "").trim();

  const conditions = [] as any[];
  if (targetEmail) conditions.push(eq(externalApiAuditLogTable.targetEmail, targetEmail));
  if (action) conditions.push(eq(externalApiAuditLogTable.action, action));

  let q = db.select().from(externalApiAuditLogTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const rows: ExternalApiAuditLog[] = await q
    .orderBy(desc(externalApiAuditLogTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ rows, limit, offset });
});

externalApiAdminRouter.get("/settings", requireSuperAdmin, async (_req, res) => {
  const settings = await loadExternalApiSettings();
  res.json({ settings });
});

externalApiAdminRouter.post("/settings/kill-switch", requireSuperAdmin, async (req: any, res) => {
  const enabled = !!req.body?.enabled;
  const reason = String(req.body?.reason || "").trim() || null;
  await loadExternalApiSettings();
  const [updated] = await db
    .update(externalApiSettingsTable)
    .set({
      killSwitchEnabled: enabled,
      killSwitchReason: enabled ? reason : null,
      killSwitchToggledAt: sql`now()`,
      killSwitchToggledByEmail: req.appUser?.email ?? req.portalUser?.email ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(externalApiSettingsTable.id, 1))
    .returning();
  res.json({ settings: updated });
});

// ─────────────────────────────────────────────────────────────────────────
// OpenAPI spec (served at /api/admin/external/v1/openapi.json so partner
// agents can introspect the surface area without needing a separate doc).
// Hand-maintained alongside the routes above; small enough that codegen
// would be overkill, large enough that an inline JSON object is the
// clearest source of truth.
// ─────────────────────────────────────────────────────────────────────────

function buildOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "GREGORY External Admin API",
      version: "1.0.0",
      description:
        "Read/write admin API for partner agents (e.g. GetViktor) to inspect and manage GREGORY portal entitlements. Auth: send `x-api-key: <key>` on every request. Rate limit: 60 requests / minute / key. High-ticket products are read-only.",
    },
    servers: [{ url: "/api/admin/external/v1" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Product: {
          type: "object",
          properties: {
            slug: { type: "string" },
            label: { type: "string" },
            category: { type: "string", enum: ["main", "bump", "upsell", "downsell", "addon", "high_ticket"] },
            writeable: { type: "boolean" },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      "/health": {
        get: {
          summary: "Liveness probe (no auth)",
          security: [],
          responses: { "200": { description: "OK" } },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This document (no auth)",
          security: [],
          responses: { "200": { description: "OpenAPI document" } },
        },
      },
      "/products": {
        get: {
          summary: "List the master product catalogue",
          responses: { "200": { description: "Product list" } },
        },
      },
      "/user": {
        get: {
          summary: "Look up a user by email",
          description:
            "Full dossier including entitlements, credits, coaching agreements, founder codes, a `generations` block `{ limit, used, remaining }` describing the buyer's AI Influencer generation cap (null when no portal_users row exists), and an `accessActivity` block of read-only login/usage evidence for refund-eligibility decisions (null when no portal_users row exists).",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: {
            "200": {
              description: "Full dossier",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      accessActivity: {
                        type: "object",
                        nullable: true,
                        description:
                          "Read-only access/usage evidence derived from access_logs + lesson_progress. Null when the buyer never created a portal account.",
                        properties: {
                          totalLogEntries: { type: "integer", minimum: 0 },
                          firstAccessAt: { type: "string", format: "date-time", nullable: true },
                          lastAccessAt: { type: "string", format: "date-time", nullable: true },
                          lastLoginAt: { type: "string", format: "date-time", nullable: true },
                          lessonViewCount: { type: "integer", minimum: 0 },
                          distinctLessonsViewed: { type: "integer", minimum: 0 },
                          completedLessonCount: { type: "integer", minimum: 0 },
                          recentActivity: {
                            type: "array",
                            description: "Up to the 20 most recent access-log entries, newest first.",
                            items: {
                              type: "object",
                              properties: {
                                action: { type: "string" },
                                resourceType: { type: "string", nullable: true },
                                resourceId: { type: "string", nullable: true },
                                ipAddress: { type: "string", nullable: true },
                                createdAt: { type: "string", format: "date-time", nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "404": { description: "Not found" },
          },
        },
      },
      "/user/generation-cap": {
        post: {
          summary: "Adjust a buyer's AI Influencer generation cap by `delta`",
          description:
            "Writes `portal_users.bonus_influencer_quota` so the effective limit moves by `delta`. The limit is the full effective cap (1 base + entitlement-derived bonus + admin override). The override is floored at 0, so the effective limit can never drop below the buyer's entitlement baseline (1 + upsell2/portfolio/admin extras). A delta that pushes the new limit below `used` is allowed (remaining=0). Response always reports the actual `newLimit`, which may differ from `previousLimit + delta` when the request would breach the baseline. 404 when no portal_users row exists for the email.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "delta", "reason"],
                  properties: {
                    email: { type: "string", format: "email" },
                    delta: { type: "integer", description: "Signed change to apply to the current cap." },
                    reason: { type: "string", description: "Human-readable audit reason." },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Adjusted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["email", "previousLimit", "newLimit", "used", "remaining"],
                    properties: {
                      email: { type: "string", format: "email" },
                      previousLimit: { type: "integer", minimum: 0 },
                      newLimit: { type: "integer", minimum: 0 },
                      used: { type: "integer", minimum: 0 },
                      remaining: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
            "400": { description: "Bad body (delta not an integer / reason empty)" },
            "404": { description: "User not found" },
          },
        },
      },
      "/influencer/{id}/name": {
        patch: {
          summary: "Admin rename of an AI influencer (no ownership check)",
          description:
            "Buyer-facing rename lives at `PATCH /api/influencers/{id}/name` and is gated to the influencer's owner. This admin variant lets a support agent rename any influencer. Same validation rules: 1-50 trimmed chars, allow Unicode letters/digits, spaces, hyphens, apostrophes, and periods; HTML/script-injection chars are blocked. Writes the dedicated `custom_name` column so the auto-name dedupe index keeps working and every existing UI reflects the rename.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "reason"],
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 50 },
                    reason: { type: "string", minLength: 1, maxLength: 500 },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Renamed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "customName", "previousName"],
                    properties: {
                      id: { type: "integer" },
                      customName: { type: "string", nullable: true },
                      previousName: { type: "string" },
                      influencer: { type: "object" },
                    },
                  },
                },
              },
            },
            "400": { description: "Bad body / invalid name (name_required, name_too_long, name_invalid_chars)" },
            "404": { description: "Influencer not found" },
          },
        },
      },
      "/user/access": {
        get: {
          summary: "Yes/no access check for a single product",
          parameters: [
            { name: "email", in: "query", required: true, schema: { type: "string", format: "email" } },
            { name: "product", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Access state" } },
        },
      },
      "/user/grant": {
        post: {
          summary: "Grant one or more writeable products to a user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "products", "reason"],
                  properties: {
                    email: { type: "string", format: "email" },
                    products: { type: "array", items: { type: "string" } },
                    reason: { type: "string", description: "Human-readable audit reason." },
                    sendWelcomeEmail: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Granted" },
            "403": { description: "Read-only product" },
          },
        },
      },
      "/user/revoke": {
        post: {
          summary: "Revoke one or more writeable products. Real Whop/Stripe orders are not mutated; the response reports if access remains active because of a real order.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "products", "reason"],
                  properties: {
                    email: { type: "string", format: "email" },
                    products: { type: "array", items: { type: "string" } },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Revoked" } },
        },
      },
      "/user/credits": {
        post: {
          summary: "Adjust paid credit balances (research or os_tool). delta may be negative.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "type", "delta", "reason"],
                  properties: {
                    email: { type: "string", format: "email" },
                    type: { type: "string", enum: ["research", "os_tool"] },
                    delta: { type: "integer" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Adjusted" } },
        },
      },
      "/dispute-defense/evidence": {
        get: {
          summary: "Full chargeback-evidence packet for a buyer (by email)",
          description:
            "Returns the same evidence the internal admin UI builds: entitlements grid, upgrade engagement (visits to owned products), terms acceptances, email send log, access log sample (most recent 100), order summary, evidence score, and a `refundEligibility` block (180-day MBG status on main + non-refundable upgrades per EU Art. 16(m)). Works even when the buyer has orders but no portal_users row.",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: { "200": { description: "Evidence packet" }, "400": { description: "Missing email" } },
        },
      },
      "/dispute-defense/access-log": {
        get: {
          summary: "Paginated raw access log for a buyer",
          description:
            "Paginates `access_logs` rows joined to the buyer's portal_users.id. Returns `{ totalCount, rows, limit, offset, nextOffset }`. Default limit=100, max=500. Returns `found:false` when no portal_users row exists.",
          parameters: [
            { name: "email", in: "query", required: true, schema: { type: "string", format: "email" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
            { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: { "200": { description: "Access log page" }, "400": { description: "Missing email" } },
        },
      },
      "/dispute-defense/evidence-pdf": {
        get: {
          summary: "Stream a multi-page PDF version of the evidence packet",
          description:
            "Returns `application/pdf` with `Content-Disposition: attachment`. Same data as `/evidence` plus full terms acceptances, full access log (most recent 50), and full email send list (most recent 100). Suitable for upload directly to a Stripe/Whop dispute response.",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: { "200": { description: "PDF binary" }, "400": { description: "Missing email" } },
        },
      },
      "/dispute-defense/terms-check": {
        get: {
          summary: "Terms acceptances on file for a buyer",
          description:
            "Returns every `terms_acceptances` row for the email (sorted newest first) plus a `hasCheckoutAcceptance` flag (true when at least one acceptance was captured on a /checkout or /offer page, or its checkbox text mentions terms/refund).",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: { "200": { description: "Terms acceptances" }, "400": { description: "Missing email" } },
        },
      },
      "/dispute-defense/refund-eligibility": {
        get: {
          summary: "180-day money-back-guarantee eligibility check",
          description:
            "Computes `mainProduct.daysRemaining` (180-day MBG starting from the earliest main-product order's createdAt) plus a list of `nonRefundableUpgrades` the buyer owns (every upgrade is a non-refundable digital good per EU Art. 16(m) and the US refund policy). Eligible means `daysRemaining > 0`.",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: { "200": { description: "Eligibility" }, "400": { description: "Missing email" } },
        },
      },
      "/generate/script": {
        post: {
          summary: "Async-generate a Script Writer SOP on behalf of a buyer",
          description:
            "Enqueues one of the fourteen text/structured Script Writer SOPs for the buyer resolved by `email`, reusing the same in-portal generation logic (prompts, Brain resolution, scrubbing). These are the seven full-script SOPs (podcast-clip, speaking-clip, selfie-clip, slideshow, carousel, overlay, fastmotion) plus their matching `*-ideas` variants (podcast-ideas, speaking-ideas, selfie-ideas, slideshow-ideas, carousel-ideas, overlay-ideas, fastmotion-ideas) for fetching topic ideas before generating a full script. The buyer must already have a Brain (404 `handler_rejected` otherwise). `input` is the SOP-specific payload the in-portal page would POST (e.g. `{ context, tone, influencerId, offerBrainId }`). Returns 202 `{ jobId, sop, ownerKey }`; poll the job at `/generate/script/jobs/{id}`. Image SOPs (green-screen, hook-demo, and their `*-ideas`) are intentionally not supported here.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "sop"],
                  properties: {
                    email: { type: "string", format: "email" },
                    sop: {
                      type: "string",
                      enum: [
                        "podcast-clip",
                        "speaking-clip",
                        "selfie-clip",
                        "slideshow",
                        "carousel",
                        "overlay",
                        "fastmotion",
                        "podcast-ideas",
                        "speaking-ideas",
                        "selfie-ideas",
                        "slideshow-ideas",
                        "carousel-ideas",
                        "overlay-ideas",
                        "fastmotion-ideas",
                      ],
                    },
                    input: { type: "object", description: "SOP-specific generation payload" },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Job enqueued" },
            "400": { description: "Missing email or invalid sop" },
            "404": { description: "Buyer has no Brain yet (forwarded from handler)" },
          },
        },
      },
      "/generate/script/jobs/{id}": {
        get: {
          summary: "Poll a Script Writer generation job",
          description:
            "Returns the job's `{ status, progressPct, stage, result, errorMessage }`. `result` is populated only when `status='succeeded'`. Ownership is enforced by re-deriving the same owner key from `email`, so callers can only read jobs they submitted for that buyer.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "email", in: "query", required: true, schema: { type: "string", format: "email" } },
          ],
          responses: {
            "200": { description: "Job status" },
            "400": { description: "Missing email or bad id" },
            "404": { description: "No such job for this buyer" },
          },
        },
      },
      "/user/resend-welcome": {
        post: {
          summary: "Re-send the welcome / sign-in email for a user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "reason"],
                  properties: {
                    email: { type: "string", format: "email" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Sent" } },
        },
      },
    },
  };
}

export { externalApiRouter, externalApiAdminRouter };
