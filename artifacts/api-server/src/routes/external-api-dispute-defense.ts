// External API - Dispute Defense endpoints.
//
// Mounted into externalApiRouter (x-api-key gated). Gives partner agents
// (Viktor) read-only access to the same chargeback-evidence packet that
// powers the internal /portal/admin/dispute-defense admin UI, plus a
// PDF export and a refund-eligibility check so the agent can answer
// "is this buyer past the 180-day MBG window?" without bouncing back
// to a human operator.
//
// All endpoints are GET, read-only, and email-keyed. Every call goes
// through the same writeAudit row as the rest of the external API.

import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  portalUsersTable,
  accessLogsTable,
  termsAcceptancesTable,
  emailLogsTable,
  lessonProgressTable,
  ordersTable,
  coachingAgreementsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

// Mirror of UPGRADE_CATALOG in dispute-defense.ts. Re-stated here to
// avoid coupling the internal admin route to the external surface
// (they evolve at different cadences); keep in sync if a new paid_*
// column is added.
const UPGRADE_CATALOG: Array<{
  flag: keyof typeof ordersTable.$inferSelect;
  label: string;
  pathSegments: string[];
}> = [
  { flag: "bump1Paid", label: "Order Bump 1", pathSegments: ["bump1", "order-bump-1"] },
  { flag: "bump2Paid", label: "Order Bump 2 / Hook Demo Library", pathSegments: ["bump2", "order-bump-2", "hook-demo-library"] },
  { flag: "bump3Paid", label: "Order Bump 3", pathSegments: ["bump3", "order-bump-3"] },
  { flag: "upsell1Paid", label: "Upsell 1", pathSegments: ["upsell1", "upsell-1"] },
  { flag: "downsell1Paid", label: "Downsell 1", pathSegments: ["downsell1", "downsell-1"] },
  { flag: "upsell2Paid", label: "Upsell 2", pathSegments: ["upsell2", "upsell-2"] },
  { flag: "upsell3Paid", label: "Upsell 3 / Platinum Trial", pathSegments: ["upsell3", "upsell-3"] },
  { flag: "tiktokSlideshowPaid", label: "TikTok Slideshow Masterclass", pathSegments: ["tiktok-slideshow-masterclass", "slideshow-masterclass"] },
  { flag: "hookDemoPaid", label: "Hook Demo (standalone flag, legacy)", pathSegments: ["hook-demo-library"] },
  { flag: "doneForYouPackPaid", label: "Done-For-You Pack", pathSegments: ["done-for-you-pack", "dfy-pack", "dfy"] },
  { flag: "portfolioPaid", label: "Our Portfolio", pathSegments: ["our-portfolio"] },
  { flag: "platinumPaid", label: "Platinum Club", pathSegments: ["platinum-club", "platinum"] },
];

const REFUND_WINDOW_DAYS = 180;

function pathMatchesSegments(pathname: string, segments: string[]): boolean {
  const tokens = pathname.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const joined = pathname.toLowerCase();
  return segments.some((seg) => {
    const s = seg.toLowerCase();
    if (s.includes("-") || s.includes("/")) {
      return joined.includes(`/${s}`) || joined.endsWith(`/${s}`) || tokens.includes(s);
    }
    return tokens.includes(s);
  });
}

type AuditWriter = (opts: {
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
}) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────

async function loadByEmail(emailLower: string) {
  const [portalUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, emailLower))
    .limit(1);

  const ordersByEmail = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.email, emailLower))
    .orderBy(desc(ordersTable.createdAt));

  const termsAcceptances = await db
    .select()
    .from(termsAcceptancesTable)
    .where(eq(termsAcceptancesTable.email, emailLower))
    .orderBy(desc(termsAcceptancesTable.acceptedAt));

  // Cap every list at a sane upper bound so the PDF/evidence builders
  // can't be turned into a memory exhaustion vector by a buyer with
  // thousands of email logs or progress rows.
  const emailLogs = await db
    .select()
    .from(emailLogsTable)
    .where(eq(emailLogsTable.email, emailLower))
    .orderBy(desc(emailLogsTable.sentAt))
    .limit(500);

  let accessLogs: Array<typeof accessLogsTable.$inferSelect> = [];
  let lessonProgress: Array<typeof lessonProgressTable.$inferSelect> = [];
  if (portalUser) {
    accessLogs = await db
      .select()
      .from(accessLogsTable)
      .where(eq(accessLogsTable.userId, portalUser.id))
      .orderBy(desc(accessLogsTable.createdAt))
      .limit(500);
    lessonProgress = await db
      .select()
      .from(lessonProgressTable)
      .where(eq(lessonProgressTable.userId, portalUser.id))
      .orderBy(desc(lessonProgressTable.createdAt))
      .limit(1000);
  }

  return { portalUser: portalUser ?? null, ordersByEmail, termsAcceptances, emailLogs, accessLogs, lessonProgress };
}

function computeEntitlements(ordersByEmail: Array<typeof ordersTable.$inferSelect>) {
  return UPGRADE_CATALOG.map((entry) => {
    const grantingOrder = ordersByEmail.find((o) => (o as any)[entry.flag] === true);
    const granted = !!grantingOrder;
    return {
      flag: entry.flag,
      label: entry.label,
      granted,
      grantedAt: grantingOrder?.updatedAt || grantingOrder?.createdAt || null,
      orderId: grantingOrder?.id || null,
      amountCents: granted && grantingOrder?.totalAmount ? grantingOrder.totalAmount : null,
      paymentSource: grantingOrder?.paymentSourceType || null,
    };
  });
}

function computeUpgradeActivity(
  entitlements: ReturnType<typeof computeEntitlements>,
  accessLogs: Array<typeof accessLogsTable.$inferSelect>,
) {
  const granted = new Set(entitlements.filter((e) => e.granted).map((e) => e.flag));
  return UPGRADE_CATALOG.filter((e) => granted.has(e.flag)).map((entry) => {
    const matches = accessLogs.filter((log) => {
      const path = (log.resourcePath || log.action || "").toString();
      return pathMatchesSegments(path, entry.pathSegments);
    });
    return {
      flag: entry.flag,
      label: entry.label,
      visitCount: matches.length,
      firstSeen: matches.length > 0 ? matches[matches.length - 1].createdAt : null,
      lastSeen: matches.length > 0 ? matches[0].createdAt : null,
      uniquePaths: Array.from(new Set(matches.map((m) => m.resourcePath).filter(Boolean))).slice(0, 10),
    };
  });
}

function computeRefundEligibility(ordersByEmail: Array<typeof ordersTable.$inferSelect>) {
  // 180-day money-back guarantee applies to the $27 main product only.
  // Every other entitlement (bumps, upsells, downsells, portal add-ons,
  // Platinum) is a non-refundable digital good per EU Article 16(m) and
  // the equivalent terms in the US Refund Policy.
  const mainOrder = ordersByEmail
    .filter((o) => o.mainProductPaid && o.createdAt)
    .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())[0];

  let mainEligible = false;
  let purchaseDate: string | null = null;
  let expiresAt: string | null = null;
  let daysSincePurchase: number | null = null;
  let daysRemaining: number | null = null;
  let reason = "no_main_product_purchase";

  if (mainOrder?.createdAt) {
    const purchased = new Date(mainOrder.createdAt);
    purchaseDate = purchased.toISOString();
    const expires = new Date(purchased.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expiresAt = expires.toISOString();
    const elapsedMs = Date.now() - purchased.getTime();
    daysSincePurchase = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    daysRemaining = Math.max(0, REFUND_WINDOW_DAYS - daysSincePurchase);
    mainEligible = daysRemaining > 0;
    reason = mainEligible
      ? `within_180_day_window (${daysRemaining} days remaining)`
      : `outside_180_day_window (purchased ${daysSincePurchase} days ago)`;
  }

  const nonRefundableUpgrades = UPGRADE_CATALOG.map((entry) => {
    const owner = ordersByEmail.find((o) => (o as any)[entry.flag] === true);
    if (!owner) return null;
    return {
      flag: entry.flag,
      label: entry.label,
      grantedAt: owner.updatedAt || owner.createdAt || null,
      orderId: owner.id,
      amountCents: owner.totalAmount || null,
      refundable: false,
      refundableReason: "Non-refundable digital good (EU Art. 16(m) / US refund policy: instant-access digital content).",
    };
  }).filter(Boolean) as Array<{
    flag: string;
    label: string;
    grantedAt: Date | string | null;
    orderId: string;
    amountCents: number | null;
    refundable: false;
    refundableReason: string;
  }>;

  return {
    mainProduct: {
      eligible: mainEligible,
      purchaseDate,
      expiresAt,
      daysSincePurchase,
      daysRemaining,
      refundWindowDays: REFUND_WINDOW_DAYS,
      orderId: mainOrder?.id || null,
      amountCents: mainOrder?.totalAmount || null,
      reason,
    },
    nonRefundableUpgrades,
    summary: {
      hasMainProduct: !!mainOrder,
      mainEligible,
      nonRefundableCount: nonRefundableUpgrades.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────

export function createDisputeDefenseApiRoutes(writeAudit: AuditWriter): IRouter {
  const router = Router();

  function getEmail(req: Request): string | null {
    const raw = req.query.email;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }

  // GET /dispute-defense/evidence?email=
  router.get("/evidence", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.evidence", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email", message: "email query param is required" });
      return;
    }
    try {
      const data = await loadByEmail(email);
      const entitlements = computeEntitlements(data.ordersByEmail);
      const upgradeActivity = computeUpgradeActivity(entitlements, data.accessLogs);
      const refundEligibility = computeRefundEligibility(data.ordersByEmail);

      const uniqueIps = new Set(data.accessLogs.map((l) => l.ipAddress).filter(Boolean));
      const uniqueDevices = new Set(data.accessLogs.map((l) => l.userAgent).filter(Boolean));
      const firstAccess = data.accessLogs.length > 0 ? data.accessLogs[data.accessLogs.length - 1].createdAt : null;
      const lastAccess = data.accessLogs.length > 0 ? data.accessLogs[0].createdAt : null;
      const totalWatchSec = data.lessonProgress.reduce((s, lp) => s + (lp.watchTimeSeconds || 0), 0);
      const lessonsCompleted = data.lessonProgress.filter((lp) => lp.completed).length;
      const evidenceScore =
        (data.termsAcceptances.length > 0 ? 25 : 0) +
        (data.accessLogs.length > 10 ? 25 : data.accessLogs.length > 0 ? 15 : 0) +
        (data.emailLogs.length > 0 ? 20 : 0) +
        (data.ordersByEmail.length > 0 ? 15 : 0) +
        (lessonsCompleted > 0 ? 15 : 0);

      const body = {
        email,
        found: !!data.portalUser || data.ordersByEmail.length > 0,
        user: data.portalUser
          ? {
              id: data.portalUser.id,
              email: data.portalUser.email,
              firstName: data.portalUser.firstName,
              lastName: data.portalUser.lastName,
              isActive: data.portalUser.isActive,
              clerkId: data.portalUser.clerkId,
              createdAt: data.portalUser.createdAt,
            }
          : null,
        summary: {
          evidenceScore,
          termsAccepted: data.termsAcceptances.length > 0,
          totalTermsAcceptances: data.termsAcceptances.length,
          totalAccessLogs: data.accessLogs.length,
          totalEmailLogs: data.emailLogs.length,
          totalOrders: data.ordersByEmail.length,
          lessonsCompleted,
          totalWatchTimeMinutes: Math.round(totalWatchSec / 60),
          uniqueIps: uniqueIps.size,
          uniqueDevices: uniqueDevices.size,
          firstAccess,
          lastAccess,
        },
        entitlements,
        upgradeActivity,
        refundEligibility,
        termsAcceptances: data.termsAcceptances,
        emailLogs: data.emailLogs.map((el) => ({
          id: el.id,
          subject: el.subject,
          templateType: el.templateType,
          status: el.status,
          messageId: el.messageId,
          sentAt: el.sentAt,
          // Body excluded from default packet - call /evidence-pdf or
          // pull via internal admin UI for full text.
        })),
        accessLogsSample: data.accessLogs.slice(0, 100),
        orders: data.ordersByEmail.map((o) => ({
          id: o.id,
          totalAmount: o.totalAmount,
          createdAt: o.createdAt,
          paymentSourceType: o.paymentSourceType,
          stripePaymentIntentId: o.stripePaymentIntentId,
          stripeSessionId: o.stripeSessionId,
          mainProductPaid: o.mainProductPaid,
        })),
      };

      await writeAudit({ req, action: "dispute-defense.evidence", targetEmail: email, statusCode: 200 });
      res.json(body);
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.evidence failed");
      await writeAudit({
        req,
        action: "dispute-defense.evidence",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  // GET /dispute-defense/access-log?email=&limit=&offset=
  router.get("/access-log", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.access-log", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email" });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

    try {
      const [portalUser] = await db
        .select()
        .from(portalUsersTable)
        .where(eq(portalUsersTable.email, email))
        .limit(1);

      if (!portalUser) {
        await writeAudit({ req, action: "dispute-defense.access-log", targetEmail: email, statusCode: 200 });
        res.json({ email, found: false, totalCount: 0, rows: [], limit, offset, nextOffset: null });
        return;
      }

      const rows = await db
        .select()
        .from(accessLogsTable)
        .where(eq(accessLogsTable.userId, portalUser.id))
        .orderBy(desc(accessLogsTable.createdAt))
        .limit(limit)
        .offset(offset);

      // Total count via SQL count() so we don't load the full id list
      // into memory just to size a paginator (access_logs grows fast).
      const [totalRow] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(accessLogsTable)
        .where(eq(accessLogsTable.userId, portalUser.id));
      const totalCount = totalRow?.c ?? 0;
      const nextOffset = offset + rows.length < totalCount ? offset + rows.length : null;

      await writeAudit({ req, action: "dispute-defense.access-log", targetEmail: email, statusCode: 200 });
      res.json({
        email,
        found: true,
        userId: portalUser.id,
        totalCount,
        limit,
        offset,
        nextOffset,
        rows,
      });
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.access-log failed");
      await writeAudit({
        req,
        action: "dispute-defense.access-log",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  // GET /dispute-defense/terms-check?email=
  router.get("/terms-check", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.terms-check", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email" });
      return;
    }
    try {
      const acceptances = await db
        .select()
        .from(termsAcceptancesTable)
        .where(eq(termsAcceptancesTable.email, email))
        .orderBy(desc(termsAcceptancesTable.acceptedAt));

      const checkoutAcceptances = acceptances.filter((a) => {
        const page = (a.pageUrl || "").toLowerCase();
        const cb = (a.checkboxText || "").toLowerCase();
        return page.includes("/checkout") || page.includes("/offer") || cb.includes("refund") || cb.includes("terms");
      });

      await writeAudit({ req, action: "dispute-defense.terms-check", targetEmail: email, statusCode: 200 });
      res.json({
        email,
        totalAcceptances: acceptances.length,
        hasCheckoutAcceptance: checkoutAcceptances.length > 0,
        firstAcceptedAt: acceptances.length > 0 ? acceptances[acceptances.length - 1].acceptedAt : null,
        lastAcceptedAt: acceptances.length > 0 ? acceptances[0].acceptedAt : null,
        acceptances: acceptances.map((a) => ({
          id: a.id,
          acceptedAt: a.acceptedAt,
          pageUrl: a.pageUrl,
          checkboxText: a.checkboxText,
          termsVersion: a.termsVersion,
          refundPolicyVersion: a.refundPolicyVersion,
          ipAddress: a.ipAddress,
          userAgent: a.userAgent,
          fingerprintHash: a.fingerprintHash,
          sessionId: a.sessionId,
        })),
      });
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.terms-check failed");
      await writeAudit({
        req,
        action: "dispute-defense.terms-check",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  // GET /dispute-defense/refund-eligibility?email=
  router.get("/refund-eligibility", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.refund-eligibility", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email" });
      return;
    }
    try {
      const ordersByEmail = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.email, email))
        .orderBy(desc(ordersTable.createdAt));

      const eligibility = computeRefundEligibility(ordersByEmail);
      await writeAudit({ req, action: "dispute-defense.refund-eligibility", targetEmail: email, statusCode: 200 });
      res.json({ email, ...eligibility });
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.refund-eligibility failed");
      await writeAudit({
        req,
        action: "dispute-defense.refund-eligibility",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  // GET /dispute-defense/evidence-pdf?email=
  router.get("/evidence-pdf", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.evidence-pdf", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email" });
      return;
    }
    try {
      const data = await loadByEmail(email);
      const entitlements = computeEntitlements(data.ordersByEmail);
      const upgradeActivity = computeUpgradeActivity(entitlements, data.accessLogs);
      const refundEligibility = computeRefundEligibility(data.ordersByEmail);
      const lessonsCompleted = data.lessonProgress.filter((lp) => lp.completed).length;
      const totalWatchSec = data.lessonProgress.reduce((s, lp) => s + (lp.watchTimeSeconds || 0), 0);
      const uniqueIps = new Set(data.accessLogs.map((l) => l.ipAddress).filter(Boolean));
      const uniqueDevices = new Set(data.accessLogs.map((l) => l.userAgent).filter(Boolean));

      const filename = `dispute-evidence-${email.replace(/[^a-z0-9.@_-]/gi, "_")}-${new Date().toISOString().split("T")[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const doc = new PDFDocument({ size: "LETTER", margin: 50, info: { Title: `Dispute Evidence - ${email}` } });
      doc.pipe(res);

      doc.fontSize(20).text("GREGORY - Dispute Defense Evidence Packet", { align: "left" });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#666").text(`Generated: ${new Date().toISOString()}`);
      doc.text(`Buyer: ${email}`);
      doc.fillColor("black");
      doc.moveDown();

      // Section: Buyer + Summary
      doc.fontSize(14).text("Buyer Summary", { underline: true });
      doc.fontSize(10).moveDown(0.3);
      if (data.portalUser) {
        const u = data.portalUser;
        doc.text(`Name: ${[u.firstName, u.lastName].filter(Boolean).join(" ") || "(not on file)"}`);
        doc.text(`Portal user id: ${u.id}`);
        doc.text(`Account created: ${u.createdAt ? new Date(u.createdAt).toISOString() : "n/a"}`);
        doc.text(`Active: ${u.isActive ? "yes" : "no"}`);
      } else {
        doc.text("No portal_users row on file (buyer may have orders but never signed in).");
      }
      doc.moveDown();

      doc.text(`Terms acceptances on file: ${data.termsAcceptances.length}`);
      doc.text(`Access log rows: ${data.accessLogs.length} (capped at 500)`);
      doc.text(`Unique IPs: ${uniqueIps.size}    Unique devices: ${uniqueDevices.size}`);
      doc.text(`Emails sent: ${data.emailLogs.length}`);
      doc.text(`Lessons completed: ${lessonsCompleted}    Total watch time: ${Math.round(totalWatchSec / 60)} min`);
      doc.moveDown();

      // Section: Refund eligibility
      doc.fontSize(14).text("Refund Eligibility", { underline: true });
      doc.fontSize(10).moveDown(0.3);
      const re = refundEligibility.mainProduct;
      doc.text(`Main product (180-day MBG): ${re.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}`);
      if (re.purchaseDate) {
        doc.text(`  Purchased: ${re.purchaseDate}`);
        doc.text(`  Window expires: ${re.expiresAt}`);
        doc.text(`  Days since purchase: ${re.daysSincePurchase}    Days remaining: ${re.daysRemaining}`);
      }
      doc.text(`  Reason: ${re.reason}`);
      doc.moveDown(0.5);
      doc.text(`Non-refundable upgrades owned: ${refundEligibility.nonRefundableUpgrades.length}`);
      for (const up of refundEligibility.nonRefundableUpgrades) {
        const grantedAt = up.grantedAt ? new Date(up.grantedAt as any).toISOString() : "n/a";
        doc.text(`  - ${up.label}  (granted ${grantedAt}, order ${up.orderId})`);
      }
      doc.moveDown();

      // Section: Entitlements
      doc.fontSize(14).text("Entitlements Grid", { underline: true });
      doc.fontSize(10).moveDown(0.3);
      for (const e of entitlements) {
        const status = e.granted ? "GRANTED" : "not granted";
        doc.text(`  ${e.label}: ${status}${e.grantedAt ? ` (${new Date(e.grantedAt as any).toISOString()})` : ""}`);
      }
      doc.moveDown();

      // Section: Upgrade engagement
      if (upgradeActivity.length > 0) {
        doc.fontSize(14).text("Upgrade Engagement (visits to owned products)", { underline: true });
        doc.fontSize(10).moveDown(0.3);
        for (const a of upgradeActivity) {
          doc.text(`  ${a.label}: ${a.visitCount} visits`);
          if (a.firstSeen) doc.text(`     first: ${new Date(a.firstSeen as any).toISOString()}`);
          if (a.lastSeen) doc.text(`     last: ${new Date(a.lastSeen as any).toISOString()}`);
        }
        doc.moveDown();
      }

      // Section: Terms acceptances
      if (data.termsAcceptances.length > 0) {
        doc.addPage();
        doc.fontSize(14).text("Terms Acceptances", { underline: true });
        doc.fontSize(9).moveDown(0.3);
        for (const ta of data.termsAcceptances) {
          doc.text(`Accepted: ${ta.acceptedAt ? new Date(ta.acceptedAt).toISOString() : "n/a"}`);
          if (ta.pageUrl) doc.text(`  Page: ${ta.pageUrl}`);
          if (ta.checkboxText) doc.text(`  Checkbox text: ${ta.checkboxText}`);
          if (ta.termsVersion) doc.text(`  Terms version: ${ta.termsVersion}`);
          if (ta.refundPolicyVersion) doc.text(`  Refund policy version: ${ta.refundPolicyVersion}`);
          if (ta.ipAddress) doc.text(`  IP: ${ta.ipAddress}`);
          if (ta.userAgent) doc.text(`  User-Agent: ${ta.userAgent}`);
          doc.moveDown(0.3);
        }
      }

      // Section: Access log sample (first 50)
      if (data.accessLogs.length > 0) {
        doc.addPage();
        doc.fontSize(14).text(`Access Log (most recent ${Math.min(50, data.accessLogs.length)} of ${data.accessLogs.length})`, { underline: true });
        doc.fontSize(8).moveDown(0.3);
        for (const log of data.accessLogs.slice(0, 50)) {
          const at = log.createdAt ? new Date(log.createdAt).toISOString() : "n/a";
          doc.text(`${at}  ${log.action || ""}  ${log.resourcePath || ""}  ip=${log.ipAddress || "?"}`);
        }
      }

      // Section: Emails sent
      if (data.emailLogs.length > 0) {
        doc.addPage();
        doc.fontSize(14).text(`Emails Sent (${data.emailLogs.length})`, { underline: true });
        doc.fontSize(9).moveDown(0.3);
        for (const el of data.emailLogs.slice(0, 100)) {
          const at = el.sentAt ? new Date(el.sentAt).toISOString() : "n/a";
          doc.text(`${at}  [${el.status}]  ${el.subject || "(no subject)"}`);
          if (el.templateType) doc.text(`  template: ${el.templateType}`);
          doc.moveDown(0.2);
        }
      }

      doc.end();
      await writeAudit({ req, action: "dispute-defense.evidence-pdf", targetEmail: email, statusCode: 200 });
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.evidence-pdf failed");
      await writeAudit({
        req,
        action: "dispute-defense.evidence-pdf",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Headers may already be sent if PDF streaming started; only respond
      // with JSON when nothing has been flushed.
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      } else {
        res.end();
      }
      return;
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 13: Service-agreement access for high-ticket disputes.
  //
  // GET /dispute-defense/agreements?email=
  //   List signed coaching/DFY service agreements for a buyer email.
  //   Returns the full agreement payload including signature data URL
  //   so Viktor can attach the original to dispute evidence.
  //
  // GET /dispute-defense/agreement-pdf?id=
  //   Render a single agreement as a printable PDF for dispute upload.
  // ───────────────────────────────────────────────────────────────────────

  router.get("/agreements", async (req, res) => {
    const email = getEmail(req);
    if (!email) {
      await writeAudit({ req, action: "dispute-defense.agreements", statusCode: 400, errorCode: "missing_email" });
      res.status(400).json({ error: "missing_email", message: "email query param is required" });
      return;
    }
    try {
      const agreements = await db
        .select({
          id: coachingAgreementsTable.id,
          fullName: coachingAgreementsTable.fullName,
          companyName: coachingAgreementsTable.companyName,
          email: coachingAgreementsTable.email,
          phone: coachingAgreementsTable.phone,
          address: coachingAgreementsTable.address,
          agreementText: coachingAgreementsTable.agreementText,
          agreementVersion: coachingAgreementsTable.agreementVersion,
          agreementType: coachingAgreementsTable.agreementType,
          signedDate: coachingAgreementsTable.signedDate,
          ipAddress: coachingAgreementsTable.ipAddress,
          userAgent: coachingAgreementsTable.userAgent,
          acceptedTerms: coachingAgreementsTable.acceptedTerms,
          status: coachingAgreementsTable.status,
          paidAt: coachingAgreementsTable.paidAt,
          signedAt: coachingAgreementsTable.signedAt,
          packagePriceCents: coachingAgreementsTable.packagePriceCents,
          paymentProvider: coachingAgreementsTable.paymentProvider,
          stripePaymentIntentId: coachingAgreementsTable.stripePaymentIntentId,
          // Signature data URL intentionally included - Viktor needs it
          // to render the buyer's electronic signature on bank-facing
          // dispute evidence.
          signatureDataUrl: coachingAgreementsTable.signatureDataUrl,
        })
        .from(coachingAgreementsTable)
        .where(eq(sql`lower(${coachingAgreementsTable.email})`, email))
        .orderBy(desc(coachingAgreementsTable.signedAt));

      await writeAudit({
        req,
        action: "dispute-defense.agreements",
        targetEmail: email,
        statusCode: 200,
      });
      res.json({ found: agreements.length > 0, count: agreements.length, agreements });
      return;
    } catch (err) {
      logger.error({ err, email }, "[external-api] dispute-defense.agreements failed");
      await writeAudit({
        req,
        action: "dispute-defense.agreements",
        targetEmail: email,
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "internal_error" });
      return;
    }
  });

  router.get("/agreement-pdf", async (req, res) => {
    const raw = req.query.id;
    const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
    // Defense in depth: require the caller to know both the id AND the
    // buyer email. Without this, anyone with an external API key could
    // enumerate every signed agreement by walking sequential ids.
    const emailParam = getEmail(req);
    if (!Number.isFinite(id) || id <= 0) {
      await writeAudit({ req, action: "dispute-defense.agreement-pdf", statusCode: 400, errorCode: "missing_id" });
      res.status(400).json({ error: "missing_id", message: "id query param is required (positive integer)" });
      return;
    }
    if (!emailParam) {
      await writeAudit({
        req,
        action: "dispute-defense.agreement-pdf",
        statusCode: 400,
        errorCode: "missing_email",
      });
      res
        .status(400)
        .json({ error: "missing_email", message: "email query param is required (must match agreement.email)" });
      return;
    }
    try {
      const [agreement] = await db
        .select()
        .from(coachingAgreementsTable)
        .where(eq(coachingAgreementsTable.id, id))
        .limit(1);

      if (!agreement) {
        await writeAudit({
          req,
          action: "dispute-defense.agreement-pdf",
          targetEmail: emailParam,
          statusCode: 404,
          errorCode: "agreement_not_found",
        });
        res.status(404).json({ error: "agreement_not_found" });
        return;
      }

      // Email-binding check: caller must already know which buyer this
      // agreement belongs to. Return the same 404 shape as not-found so
      // an attacker cannot distinguish "wrong id" from "right id, wrong
      // email" through the response.
      if (
        !agreement.email ||
        agreement.email.toLowerCase() !== emailParam.toLowerCase()
      ) {
        await writeAudit({
          req,
          action: "dispute-defense.agreement-pdf",
          targetEmail: emailParam,
          statusCode: 404,
          errorCode: "agreement_email_mismatch",
        });
        res.status(404).json({ error: "agreement_not_found" });
        return;
      }

      const filename = `service-agreement-${agreement.id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const doc = new PDFDocument({
        size: "LETTER",
        margin: 50,
        info: { Title: `Service Agreement #${agreement.id}` },
      });
      doc.pipe(res);

      doc.fontSize(18).font("Helvetica-Bold").text("SIGNED SERVICE AGREEMENT", { align: "center" });
      doc.moveDown();
      doc.fontSize(10).font("Helvetica");
      doc.text(`Agreement ID: ${agreement.id}`);
      doc.text(`Type: ${agreement.agreementType || "standard"}`);
      doc.text(`Version: ${agreement.agreementVersion}`);
      doc.text(`Status: ${agreement.status}`);
      doc.text(
        `Signed: ${agreement.signedDate} (${agreement.signedAt ? new Date(agreement.signedAt).toISOString() : ""})`,
      );
      doc.text(`IP Address: ${agreement.ipAddress || "N/A"}`);
      doc.text(`Browser: ${(agreement.userAgent || "N/A").substring(0, 120)}`);
      doc.text(`Paid: ${agreement.paidAt ? new Date(agreement.paidAt).toISOString() : "Pending"}`);
      if (agreement.packagePriceCents) {
        doc.text(`Package Price: $${(agreement.packagePriceCents / 100).toFixed(2)}`);
      }
      if (agreement.stripePaymentIntentId) {
        doc.text(`Stripe PI: ${agreement.stripePaymentIntentId}`);
      }
      doc.moveDown();

      doc.fontSize(14).font("Helvetica-Bold").text("AGREEMENT TEXT");
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica").text(agreement.agreementText || "No agreement text stored");
      doc.moveDown();

      doc.fontSize(14).font("Helvetica-Bold").text("ELECTRONIC SIGNATURE");
      doc.moveDown(0.5);
      const sig = agreement.signatureDataUrl || "";
      if (sig.startsWith("data:image/")) {
        try {
          const base64Data = sig.split(",")[1] || "";
          const imgBuffer = Buffer.from(base64Data, "base64");
          doc.image(imgBuffer, { width: 200 });
        } catch {
          doc.fontSize(10).text("[Signature image could not be rendered]");
        }
      } else if (sig) {
        doc.fontSize(16).font("Helvetica-Bold").text(sig);
      } else {
        doc.fontSize(10).text("(no signature on file)");
      }
      doc.moveDown();
      doc.fontSize(9).font("Helvetica");
      doc.text(`Signed by: ${agreement.fullName}`);
      doc.text(`Email: ${agreement.email}`);
      doc.text(`Company: ${agreement.companyName || "N/A"}`);
      doc.text(`Address: ${agreement.address}`);
      doc.text(`Terms Accepted: ${agreement.acceptedTerms ? "Yes" : "No"}`);

      doc.moveDown(2);
      doc
        .fontSize(8)
        .text(
          "This document was generated from AI Influencer Portfolio system records for use in payment dispute resolution.",
          { align: "center" },
        );

      doc.end();
      await writeAudit({
        req,
        action: "dispute-defense.agreement-pdf",
        targetEmail: agreement.email,
        statusCode: 200,
      });
      return;
    } catch (err) {
      logger.error({ err, id }, "[external-api] dispute-defense.agreement-pdf failed");
      await writeAudit({
        req,
        action: "dispute-defense.agreement-pdf",
        statusCode: 500,
        errorCode: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      } else {
        res.end();
      }
      return;
    }
  });

  return router;
}
