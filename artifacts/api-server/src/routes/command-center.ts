/**
 * Room30 Command Center API
 * Mounted under /api/crm/command-center/* (super-admin gated)
 * Plus public tracking endpoints: /api/track, /api/identify, /api/event
 */
import { Router, type Request, type Response } from "express";
import { and, eq, gte, lte, desc, asc, sql, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ccVisitors,
  ccTouchpoints,
  ccTrackerEvents,
  ccConversions,
  ccDailyProfit,
  ccTeamMembers,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";
import { requireTrueSuperAdmin as requireSuperAdmin } from "../middlewares/requireAuth.js";
import {
  pullMetaAdSpendCents,
  pullGoogleAdSpendCents,
  isMetaAdsPullConfigured,
  isGoogleAdsConfigured,
} from "../lib/google-ads-offline.js";

const router = Router();

// ---------------------------------------------------------------------------
// Attribution helpers
// ---------------------------------------------------------------------------

function classifyChannel(tp: {
  utmSource?: string | null;
  utmMedium?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  referrer?: string | null;
  utmCampaign?: string | null;
}): { channel: string; campaignType: string } {
  const src = (tp.utmSource || "").toLowerCase();
  const med = (tp.utmMedium || "").toLowerCase();
  const ref = (tp.referrer || "").toLowerCase();
  const cam = (tp.utmCampaign || "").toLowerCase();

  if (tp.fbclid || src === "facebook" || src === "fb" || src === "instagram" || med === "paid_social") {
    const campaignType = cam.includes("reel") || cam.includes("video") ? "video" :
      cam.includes("carousel") ? "carousel" : "paid_social";
    return { channel: "meta", campaignType };
  }
  if (tp.gclid || src === "google" || src === "youtube" || med === "cpc" || med === "ppc") {
    return { channel: "google", campaignType: "paid_search" };
  }
  if (src === "influencer" || cam.includes("influencer") || cam.includes("ai_influencer")) {
    return { channel: "ai_influencer", campaignType: "influencer" };
  }
  if (src === "email" || med === "email" || src === "convertkit" || src === "kit") {
    return { channel: "email", campaignType: "email" };
  }
  if (src === "whatsapp" || med === "whatsapp" || src === "wati") {
    return { channel: "whatsapp", campaignType: "whatsapp" };
  }
  if (src === "tiktok" || med === "tiktok") {
    return { channel: "tiktok", campaignType: "paid_social" };
  }
  if (ref.includes("facebook.com") || ref.includes("instagram.com")) {
    return { channel: "meta", campaignType: "organic_social" };
  }
  if (ref.includes("google.com") || ref.includes("bing.com")) {
    return { channel: "organic", campaignType: "organic_search" };
  }
  if (ref && !ref.includes("room30.ai") && !ref.includes("localhost")) {
    return { channel: "referral", campaignType: "referral" };
  }
  if (!tp.utmSource && !tp.fbclid && !tp.gclid && !ref) {
    return { channel: "direct", campaignType: "direct" };
  }
  return { channel: "organic", campaignType: "organic" };
}

type AttributionConfidence = "high" | "medium" | "low";

function computeAttributionConfidence(tp: {
  fbclid?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  channel?: string | null;
}): AttributionConfidence {
  // Direct click ID from an ad platform — unambiguous signal
  if (tp.fbclid || tp.gclid) return "high";
  // Full UTM source+medium pair — intentional tracking
  if (tp.utmSource && tp.utmMedium) return "medium";
  // Partial UTM or channel inferred from referrer
  if (tp.utmSource || tp.utmCampaign) return "medium";
  if (tp.referrer && !tp.referrer.includes("room30.ai")) return "low";
  return "low";
}

async function resolveAttribution(
  visitorId: number,
  model: "last_touch" | "first_touch" = "last_touch",
): Promise<{
  channel: string;
  campaignType: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  fbclid: string | null;
  gclid: string | null;
  confidence: AttributionConfidence;
} | null> {
  const touchpoints = await db.select().from(ccTouchpoints)
    .where(eq(ccTouchpoints.visitorId, visitorId))
    .orderBy(model === "last_touch" ? desc(ccTouchpoints.occurredAt) : asc(ccTouchpoints.occurredAt))
    .limit(20);
  if (!touchpoints.length) return null;
  const tp = touchpoints[0];
  const { channel, campaignType } = classifyChannel(tp);
  const confidence = computeAttributionConfidence(tp);
  return { channel, campaignType, utmSource: tp.utmSource, utmMedium: tp.utmMedium, utmCampaign: tp.utmCampaign, fbclid: tp.fbclid, gclid: tp.gclid, confidence };
}

// ---------------------------------------------------------------------------
// Tracker script endpoint — serves the visitor tracking IIFE as a cacheable
// JS file so pages can load it with <script src="/api/tracker.js" async>.
// Public (no auth). Cache-Control: public, max-age=3600 so the CDN/browser
// caches for 1 hour; ETag forces revalidation on code changes.
// ---------------------------------------------------------------------------

const TRACKER_SCRIPT_ETAG = `"r30-tracker-v3"`;
const TRACKER_SCRIPT = `/* Room30 Command Center tracker v3 */
(function() {
  'use strict';
  try {
    var ls = window.localStorage;
    var AID_KEY = 'r30_aid';
    var anonId = ls && ls.getItem(AID_KEY);
    if (!anonId) {
      anonId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      if (ls) ls.setItem(AID_KEY, anonId);
    }
    window._r30Aid = anonId;
    var p = new URLSearchParams(window.location.search);
    var payload = {
      anonId: anonId,
      url: window.location.href,
      referrer: document.referrer || null,
      utm_source: p.get('utm_source'),
      utm_medium: p.get('utm_medium'),
      utm_campaign: p.get('utm_campaign'),
      utm_content: p.get('utm_content'),
      utm_term: p.get('utm_term'),
      fbclid: p.get('fbclid'),
      gclid: p.get('gclid'),
    };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', blob);
    } else {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(function(){});
    }
  } catch(e) {}
})();
`;

router.get("/tracker.js", (req: Request, res: Response) => {
  if (req.headers["if-none-match"] === TRACKER_SCRIPT_ETAG) {
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  res.setHeader("ETag", TRACKER_SCRIPT_ETAG);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(TRACKER_SCRIPT);
});

// ---------------------------------------------------------------------------
// Public tracking endpoints (CORS open, always 200, fire-and-forget writes)
// ---------------------------------------------------------------------------

const CORS_ORIGINS = ["https://room30.ai", "https://www.room30.ai", "http://localhost:3000", "http://localhost:5173"];

function trackCors(req: Request, res: Response, next: any) {
  const origin = req.headers.origin || "";
  const allowed = CORS_ORIGINS.some((o) => origin === o || origin.endsWith(".room30.ai"));
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

async function upsertVisitor(anonId: string, email?: string | null): Promise<number> {
  const [existing] = await db.select({ id: ccVisitors.id }).from(ccVisitors).where(eq(ccVisitors.anonId, anonId)).limit(1);
  if (existing) {
    if (email && email.trim()) {
      await db.update(ccVisitors).set({ email: email.trim().toLowerCase(), lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(ccVisitors.id, existing.id));
    } else {
      await db.update(ccVisitors).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(ccVisitors.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db.insert(ccVisitors).values({
    anonId,
    email: email ? email.trim().toLowerCase() : null,
  }).returning({ id: ccVisitors.id });
  return created.id;
}

router.options("/track", trackCors);
router.post("/track", trackCors, async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });
  try {
    const b = req.body ?? {};
    const anonId = String(b.anonId || b.anon_id || "").trim();
    if (!anonId) return;
    const visitorId = await upsertVisitor(anonId, b.email);
    const { channel, campaignType } = classifyChannel({
      utmSource: b.utm_source,
      utmMedium: b.utm_medium,
      fbclid: b.fbclid,
      gclid: b.gclid,
      referrer: b.referrer,
      utmCampaign: b.utm_campaign,
    });
    await db.insert(ccTouchpoints).values({
      visitorId,
      sessionId: b.sessionId || b.session_id || null,
      url: b.url || null,
      referrer: b.referrer || null,
      utmSource: b.utm_source || null,
      utmMedium: b.utm_medium || null,
      utmCampaign: b.utm_campaign || null,
      utmContent: b.utm_content || null,
      utmTerm: b.utm_term || null,
      fbclid: b.fbclid || null,
      gclid: b.gclid || null,
      channel,
      campaignType,
      ipAddress: (req.headers["x-forwarded-for"] as string || "").split(",")[0].trim() || req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[cc/track] ingest error");
  }
});

router.options("/identify", trackCors);
router.post("/identify", trackCors, async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });
  try {
    const b = req.body ?? {};
    const anonId = String(b.anonId || b.anon_id || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    if (!anonId || !email) return;
    const visitorId = await upsertVisitor(anonId, email);
    // Cross-device merge: if another visitor already has this email, adopt touchpoints
    const [older] = await db.select({ id: ccVisitors.id }).from(ccVisitors)
      .where(and(sql`lower(${ccVisitors.email}) = ${email}`, sql`${ccVisitors.id} != ${visitorId}`))
      .orderBy(asc(ccVisitors.id)).limit(1);
    if (older) {
      await db.update(ccTouchpoints).set({ visitorId }).where(eq(ccTouchpoints.visitorId, older.id));
      await db.update(ccConversions).set({ visitorId }).where(eq(ccConversions.visitorId, older.id));
      await db.update(ccVisitors).set({ mergedIntoId: visitorId, updatedAt: new Date() }).where(eq(ccVisitors.id, older.id));
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[cc/identify] ingest error");
  }
});

router.options("/event", trackCors);
router.post("/event", trackCors, async (req: Request, res: Response) => {
  res.status(200).json({ ok: true });
  try {
    const b = req.body ?? {};
    const anonId = String(b.anonId || b.anon_id || "").trim();
    const eventName = String(b.event || b.eventName || "").trim();
    if (!eventName) return;
    let visitorId: number | null = null;
    if (anonId) {
      const [vis] = await db.select({ id: ccVisitors.id }).from(ccVisitors).where(eq(ccVisitors.anonId, anonId)).limit(1);
      visitorId = vis?.id ?? null;
    }
    await db.insert(ccTrackerEvents).values({
      visitorId,
      anonId: anonId || null,
      eventName,
      url: b.url || null,
      properties: b.properties || null,
      sessionId: b.sessionId || b.session_id || null,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[cc/event] ingest error");
  }
});

// ---------------------------------------------------------------------------
// Command Center API (super-admin gated)
// ---------------------------------------------------------------------------

// Tracking pipeline test page — returns recent visitors + touchpoints so
// admins can verify the landing page snippet is firing correctly without
// querying the DB directly. Super-admin gated.
router.get("/crm/command-center/tracking-test", requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const recentVisitors = await db.select().from(ccVisitors)
      .orderBy(desc(ccVisitors.createdAt)).limit(20);
    const recentTouchpoints = await db.select({
      id: ccTouchpoints.id,
      visitorId: ccTouchpoints.visitorId,
      channel: ccTouchpoints.channel,
      campaignType: ccTouchpoints.campaignType,
      utmSource: ccTouchpoints.utmSource,
      utmMedium: ccTouchpoints.utmMedium,
      utmCampaign: ccTouchpoints.utmCampaign,
      fbclid: ccTouchpoints.fbclid,
      gclid: ccTouchpoints.gclid,
      url: ccTouchpoints.url,
      occurredAt: ccTouchpoints.occurredAt,
    }).from(ccTouchpoints).orderBy(desc(ccTouchpoints.occurredAt)).limit(20);
    const recentConversions = await db.select({
      id: ccConversions.id,
      email: ccConversions.email,
      amountCents: ccConversions.amountCents,
      channel: ccConversions.channel,
      productSlugs: ccConversions.productSlugs,
      metaCapiPushed: ccConversions.metaCapiPushed,
      isRefund: ccConversions.isRefund,
      occurredAt: ccConversions.occurredAt,
    }).from(ccConversions).orderBy(desc(ccConversions.occurredAt)).limit(10);
    const [vCount] = await db.select({ n: count() }).from(ccVisitors);
    const [tpCount] = await db.select({ n: count() }).from(ccTouchpoints);
    const [convCount] = await db.select({ n: count() }).from(ccConversions);
    res.json({
      totals: {
        visitors: Number(vCount?.n ?? 0),
        touchpoints: Number(tpCount?.n ?? 0),
        conversions: Number(convCount?.n ?? 0),
      },
      recentVisitors,
      recentTouchpoints,
      recentConversions,
      instructions: {
        testTrack: "POST /api/track with { anonId, url, utm_source, utm_medium, utm_campaign, fbclid }",
        testIdentify: "POST /api/identify with { anonId, email }",
        testEvent: "POST /api/event with { anonId, event: 'checkout_started', url }",
        landingPageSnippet: "window._r30Aid is set on room30.ai pages once the snippet fires",
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/tracking-test] error");
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/crm/command-center/health", requireSuperAdmin, async (_req: Request, res: Response) => {
  const [vCount] = await db.select({ n: count() }).from(ccVisitors);
  const [tpCount] = await db.select({ n: count() }).from(ccTouchpoints);
  const [convCount] = await db.select({ n: count() }).from(ccConversions);
  const [teamCount] = await db.select({ n: count() }).from(ccTeamMembers);
  res.json({
    ok: true,
    tables: {
      visitors: Number(vCount?.n ?? 0),
      touchpoints: Number(tpCount?.n ?? 0),
      conversions: Number(convCount?.n ?? 0),
      teamMembers: Number(teamCount?.n ?? 0),
    },
  });
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

router.get("/crm/command-center/overview", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { from, to } = parseDateRange(req);
    const [totalRev] = await db.select({ v: sql<number>`COALESCE(SUM(amount_cents),0)::int` }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)));
    const [totalConv] = await db.select({ v: count() }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)));
    const profitRows = await db.select().from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, formatDate(from)), lte(ccDailyProfit.day, formatDate(to))))
      .orderBy(asc(ccDailyProfit.day));
    const totalAdSpend = profitRows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents, 0);
    const totalCosts = profitRows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents, 0);
    const revCents = Number(totalRev?.v ?? 0);
    const netProfit = revCents - totalCosts;
    const roas = totalAdSpend > 0 ? (revCents / totalAdSpend) : 0;

    const channelRows = await db.select({
      channel: ccConversions.channel,
      rev: sql<number>`COALESCE(SUM(amount_cents),0)::int`,
      n: count(),
    }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)))
      .groupBy(ccConversions.channel);

    const recentConversions = await db.select().from(ccConversions)
      .where(eq(ccConversions.isRefund, false))
      .orderBy(desc(ccConversions.occurredAt))
      .limit(10);

    const dailyRows = await db.select({
      day: ccDailyProfit.day,
      rev: sql<number>`(revenue_low_ticket_cents + revenue_high_ticket_cents + revenue_other_cents)::int`,
      costs: sql<number>`(meta_spend_cents + google_spend_cents + stripe_fee_cents + vat_cents + other_costs_cents)::int`,
    }).from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, formatDate(from)), lte(ccDailyProfit.day, formatDate(to))))
      .orderBy(asc(ccDailyProfit.day));

    res.json({
      kpis: { revenueCents: revCents, netProfitCents: netProfit, adSpendCents: totalAdSpend, roas: Math.round(roas * 100) / 100, conversions: Number(totalConv?.v ?? 0) },
      channelBreakdown: channelRows.map(r => ({ channel: r.channel || "unknown", revenueCents: Number(r.rev), conversions: Number(r.n) })),
      dailyTrend: dailyRows.map(r => ({ day: r.day, revenueCents: Number(r.rev), costsCents: Number(r.costs) })),
      recentActivity: recentConversions,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/overview] error");
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

router.get("/crm/command-center/attribution", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { from, to } = parseDateRange(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const channelRows = await db.select({
      channel: ccConversions.channel,
      revenueCents: sql<number>`COALESCE(SUM(amount_cents),0)::int`,
      conversions: count(),
    }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)))
      .groupBy(ccConversions.channel)
      .orderBy(desc(sql`SUM(amount_cents)`));

    const campaignRows = await db.select({
      utmCampaign: ccConversions.utmCampaign,
      channel: ccConversions.channel,
      revenueCents: sql<number>`COALESCE(SUM(amount_cents),0)::int`,
      conversions: count(),
    }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false), sql`${ccConversions.utmCampaign} IS NOT NULL`))
      .groupBy(ccConversions.utmCampaign, ccConversions.channel)
      .orderBy(desc(sql`SUM(amount_cents)`))
      .limit(20);

    const conversions = await db.select().from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to)))
      .orderBy(desc(ccConversions.occurredAt))
      .limit(limit).offset(offset);

    const [totalCount] = await db.select({ n: count() }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to)));

    const totalRev = channelRows.reduce((s, r) => s + Number(r.revenueCents), 0);
    const totalConv = channelRows.reduce((s, r) => s + Number(r.conversions), 0);
    const aov = totalConv > 0 ? totalRev / totalConv : 0;

    const trendRows = await db.select({
      day: sql<string>`DATE(occurred_at)`,
      channel: ccConversions.channel,
      revenueCents: sql<number>`COALESCE(SUM(amount_cents),0)::int`,
      conversions: count(),
    }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)))
      .groupBy(sql`DATE(occurred_at)`, ccConversions.channel)
      .orderBy(sql`DATE(occurred_at)`);

    // Platform-vs-Reality: compare recorded ad spend (cc_daily_profit) vs
    // cc_conversions revenue attributed to each paid channel. Lets the admin
    // see whether Meta/Google-reported ROAS matches what the Command Center
    // actually tracked as revenue from those channels.
    const [metaSpendRow] = await db
      .select({ v: sql<number>`COALESCE(SUM(meta_spend_cents), 0)::int` })
      .from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, formatDate(from)), lte(ccDailyProfit.day, formatDate(to))));
    const [googleSpendRow] = await db
      .select({ v: sql<number>`COALESCE(SUM(google_spend_cents), 0)::int` })
      .from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, formatDate(from)), lte(ccDailyProfit.day, formatDate(to))));

    const [metaRevRow] = await db
      .select({ v: sql<number>`COALESCE(SUM(amount_cents), 0)::int` })
      .from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false), eq(ccConversions.channel, "meta")));
    const [googleRevRow] = await db
      .select({ v: sql<number>`COALESCE(SUM(amount_cents), 0)::int` })
      .from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false), eq(ccConversions.channel, "google")));

    const metaSpend = Number(metaSpendRow?.v ?? 0);
    const googleSpend = Number(googleSpendRow?.v ?? 0);
    const metaRev = Number(metaRevRow?.v ?? 0);
    const googleRev = Number(googleRevRow?.v ?? 0);

    const platformVsReality = [
      {
        channel: "meta",
        label: "Meta Ads",
        spendCents: metaSpend,
        attributedRevenueCents: metaRev,
        roas: metaSpend > 0 ? Math.round((metaRev / metaSpend) * 100) / 100 : null,
        spendSource: isMetaAdsPullConfigured() ? "api" : "manual",
      },
      {
        channel: "google",
        label: "Google Ads",
        spendCents: googleSpend,
        attributedRevenueCents: googleRev,
        roas: googleSpend > 0 ? Math.round((googleRev / googleSpend) * 100) / 100 : null,
        spendSource: isGoogleAdsConfigured() ? "api" : "manual",
      },
    ];

    res.json({
      summary: { revenueCents: totalRev, conversions: totalConv, aovCents: Math.round(aov) },
      channelBreakdown: channelRows,
      campaignPerformance: campaignRows,
      conversions: conversions.map(c => ({
        ...c,
        attributionConfidence: computeAttributionConfidence({
          fbclid: c.fbclid,
          gclid: c.gclid,
          utmSource: c.utmSource,
          utmMedium: c.utmMedium,
          utmCampaign: c.utmCampaign,
          channel: c.channel,
        }),
      })),
      trend: trendRows,
      platformVsReality,
      pagination: { page, limit, total: Number(totalCount?.n ?? 0) },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/attribution] error");
    res.status(500).json({ error: "Failed to load attribution" });
  }
});

// Conversion touchpoints
router.get("/crm/command-center/attribution/conversion/:id/touchpoints", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [conv] = await db.select().from(ccConversions).where(eq(ccConversions.id, id)).limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    let touchpoints: any[] = [];
    if (conv.visitorId) {
      touchpoints = await db.select().from(ccTouchpoints).where(eq(ccTouchpoints.visitorId, conv.visitorId)).orderBy(asc(ccTouchpoints.occurredAt));
    }
    res.json({ conversion: conv, touchpoints });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDateRange(req: Request): { from: Date; to: Date } {
  const now = new Date();
  const rangeParam = (req.query.range as string) || "30d";
  let from = new Date(now);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  if (rangeParam === "today") {
    from = new Date(now); from.setHours(0, 0, 0, 0);
  } else if (rangeParam === "7d") {
    from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
  } else if (rangeParam === "30d") {
    from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
  } else if (rangeParam === "90d") {
    from.setDate(from.getDate() - 90); from.setHours(0, 0, 0, 0);
  } else if (req.query.from && req.query.to) {
    from = new Date(String(req.query.from)); to.setTime(new Date(String(req.query.to)).getTime()); to.setHours(23, 59, 59, 999);
  } else {
    from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

async function buildDailyRevenueFromStripe(_day: string): Promise<{ lowTicket: number; highTicket: number; other: number; stripeFee: number; vatCents: number }> {
  // Live revenue pull from the payment processor is retired with the
  // Stripe stack. The P&L "refresh" endpoint still pulls ad spend and
  // preserves manually entered revenue; automatic revenue import returns
  // zeros so manual entries are never overwritten.
  return { lowTicket: 0, highTicket: 0, other: 0, stripeFee: 0, vatCents: 0 };
}

function getAllDaysInRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(23, 59, 59, 999);
  while (cur.getTime() <= end.getTime()) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

router.get("/crm/command-center/profit", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { from, to } = parseDateRange(req);
    const fromDay = formatDate(from);
    const toDay = formatDate(to);

    const existingRows = await db.select().from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, fromDay), lte(ccDailyProfit.day, toDay)))
      .orderBy(asc(ccDailyProfit.day));

    // Build a complete day series — skeleton rows (all-zero) for missing days
    // so the chart always shows a contiguous timeline.
    const existingByDay = new Map(existingRows.map(r => [r.day, r]));
    const allDays = getAllDaysInRange(from, to);
    const cutoff14d = formatDate(new Date(Date.now() - 14 * 86_400_000));
    const missingDays = allDays.filter(d => !existingByDay.has(d));

    // Fire-and-forget: backfill missing days within last 14d from Stripe so
    // the NEXT load of this page will have real revenue numbers.
    const backfillDays = missingDays.filter(d => d >= cutoff14d && d < formatDate(new Date()));
    if (backfillDays.length > 0) {
      void Promise.all(backfillDays.map(async (day) => {
        try {
          const data = await buildDailyRevenueFromStripe(day);
          await db.insert(ccDailyProfit).values({
            day,
            revenueLowTicketCents: data.lowTicket,
            revenueHighTicketCents: data.highTicket,
            revenueOtherCents: data.other,
            stripeFeeCents: data.stripeFee,
            vatCents: data.vatCents,
            revenueSource: "stripe",
            refreshedAt: new Date(),
          }).onConflictDoNothing();
        } catch { /* fire-and-forget, non-blocking */ }
      })).catch(() => {});
    }

    // Merge existing rows with skeleton rows so response always covers full range
    const rows = allDays.map(day => {
      const r = existingByDay.get(day);
      if (r) {
        const rev = r.revenueLowTicketCents + r.revenueHighTicketCents + r.revenueOtherCents;
        const costs = r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents;
        const net = rev - costs;
        return {
          ...r,
          totalRevenueCents: rev,
          totalCostsCents: costs,
          netProfitCents: net,
          marginPct: rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0,
          status: (net > 0 ? "profit" : net < 0 ? "loss" : "break_even") as "profit" | "loss" | "break_even",
          isBackfillPending: false,
        };
      }
      return {
        id: null as unknown as number,
        day,
        revenueLowTicketCents: 0,
        revenueHighTicketCents: 0,
        revenueOtherCents: 0,
        metaSpendCents: 0,
        googleSpendCents: 0,
        stripeFeeCents: 0,
        vatCents: 0,
        otherCostsCents: 0,
        notes: null,
        revenueSource: null,
        metaSpendSource: null,
        googleSpendSource: null,
        refreshedAt: null,
        createdAt: null,
        updatedAt: null,
        totalRevenueCents: 0,
        totalCostsCents: 0,
        netProfitCents: 0,
        marginPct: 0,
        status: "break_even" as "profit" | "loss" | "break_even",
        isBackfillPending: backfillDays.includes(day),
      };
    });

    const totalRev = rows.reduce((s, r) => s + r.revenueLowTicketCents + r.revenueHighTicketCents + r.revenueOtherCents, 0);
    const totalCosts = rows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents, 0);
    const totalAdSpend = rows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents, 0);
    const netProfit = totalRev - totalCosts;
    const margin = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;
    const totalConv = await db.select({ n: count() }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), lte(ccConversions.occurredAt, to), eq(ccConversions.isRefund, false)));
    const convCount = Number(totalConv[0]?.n ?? 0);
    const cpa = convCount > 0 ? totalAdSpend / convCount : 0;
    const days = rows.filter(r => r.totalRevenueCents > 0).length || 1;

    res.json({
      rows,
      summary: {
        totalRevenueCents: totalRev,
        totalCostsCents: totalCosts,
        totalAdSpendCents: totalAdSpend,
        netProfitCents: netProfit,
        marginPct: Math.round(margin * 10) / 10,
        avgDailyRevenueCents: Math.round(totalRev / days),
        cpaAvgCents: Math.round(cpa),
        breakEvenAdSpendCents: Math.round(totalRev * 0.3),
        conversions: convCount,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/profit] error");
    res.status(500).json({ error: "Failed to load profit data" });
  }
});

router.patch("/crm/command-center/profit/:day", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const day = String(req.params.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { res.status(400).json({ error: "Invalid date" }); return; }
    const b = req.body ?? {};
    const set: Record<string, any> = { updatedAt: new Date() };
    if (typeof b.otherCostsCents === "number") set.otherCostsCents = b.otherCostsCents;
    if (typeof b.metaSpendCents === "number") set.metaSpendCents = b.metaSpendCents;
    if (typeof b.googleSpendCents === "number") set.googleSpendCents = b.googleSpendCents;
    if (typeof b.vatCents === "number") set.vatCents = b.vatCents;
    if (typeof b.notes === "string") set.notes = b.notes;
    const insertValues: typeof ccDailyProfit.$inferInsert = { day };
    const [row] = await db.insert(ccDailyProfit).values(insertValues)
      .onConflictDoUpdate({ target: ccDailyProfit.day, set })
      .returning();
    res.json({ ok: true, row });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/profit/patch] error");
    res.status(500).json({ error: "Update failed" });
  }
});

// Refresh yesterday's revenue from Stripe
router.post("/crm/command-center/profit/refresh", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const day = req.body?.day || formatDate(new Date(Date.now() - 86400000));
    const stripeData = await buildDailyRevenueFromStripe(day);

    // Attempt ad spend auto-pull from Meta/Google APIs; fall back to null
    // so existing manually-entered spend is preserved (ON CONFLICT only
    // updates spend columns when the pull succeeded).
    const [metaSpendCentsApi, googleSpendCentsApi] = await Promise.all([
      pullMetaAdSpendCents(day).catch(() => null),
      pullGoogleAdSpendCents(day).catch(() => null),
    ]);

    const updateSet: Record<string, any> = {
      revenueLowTicketCents: stripeData.lowTicket,
      revenueHighTicketCents: stripeData.highTicket,
      revenueOtherCents: stripeData.other,
      stripeFeeCents: stripeData.stripeFee,
      vatCents: stripeData.vatCents,
      revenueSource: "stripe",
      refreshedAt: new Date(),
      updatedAt: new Date(),
    };
    if (metaSpendCentsApi !== null) {
      updateSet.metaSpendCents = metaSpendCentsApi;
      updateSet.metaSpendSource = "api";
    }
    if (googleSpendCentsApi !== null) {
      updateSet.googleSpendCents = googleSpendCentsApi;
      updateSet.googleSpendSource = "api";
    }

    const insertValues: typeof ccDailyProfit.$inferInsert = {
      day,
      revenueLowTicketCents: stripeData.lowTicket,
      revenueHighTicketCents: stripeData.highTicket,
      revenueOtherCents: stripeData.other,
      stripeFeeCents: stripeData.stripeFee,
      vatCents: stripeData.vatCents,
      revenueSource: "stripe",
      ...(metaSpendCentsApi !== null ? { metaSpendCents: metaSpendCentsApi, metaSpendSource: "api" } : {}),
      ...(googleSpendCentsApi !== null ? { googleSpendCents: googleSpendCentsApi, googleSpendSource: "api" } : {}),
      refreshedAt: new Date(),
    };

    const [row] = await db
      .insert(ccDailyProfit)
      .values(insertValues)
      .onConflictDoUpdate({ target: ccDailyProfit.day, set: updateSet })
      .returning();

    res.json({
      ok: true,
      day,
      row,
      adSpendPulled: {
        meta: metaSpendCentsApi !== null ? { cents: metaSpendCentsApi, source: "api" } : { source: "manual" },
        google: googleSpendCentsApi !== null ? { cents: googleSpendCentsApi, source: "api" } : { source: "manual" },
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/profit/refresh] error");
    res.status(500).json({ error: "Refresh failed" });
  }
});

// CSV export
router.get("/crm/command-center/profit/export", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { from, to } = parseDateRange(req);
    const rows = await db.select().from(ccDailyProfit)
      .where(and(gte(ccDailyProfit.day, formatDate(from)), lte(ccDailyProfit.day, formatDate(to))))
      .orderBy(asc(ccDailyProfit.day));
    const headers = ["Day","Low Ticket Revenue","High Ticket Revenue","Other Revenue","Total Revenue","Meta Spend","Google Spend","Stripe Fees","VAT","Other Costs","Total Costs","Net Profit","Margin %","Notes"];
    const csvRows = rows.map(r => {
      const rev = r.revenueLowTicketCents + r.revenueHighTicketCents + r.revenueOtherCents;
      const costs = r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents;
      const net = rev - costs;
      const margin = rev > 0 ? ((net / rev) * 100).toFixed(1) : "0.0";
      return [r.day, r.revenueLowTicketCents / 100, r.revenueHighTicketCents / 100, r.revenueOtherCents / 100, rev / 100, r.metaSpendCents / 100, r.googleSpendCents / 100, r.stripeFeeCents / 100, r.vatCents / 100, r.otherCostsCents / 100, costs / 100, net / 100, margin, r.notes || ""].map(String);
    });
    const csv = [headers, ...csvRows].map(r => r.join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="profit-${formatDate(from)}-to-${formatDate(to)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: "Export failed" });
  }
});

// ---------------------------------------------------------------------------
// Team Hub
// ---------------------------------------------------------------------------

const DEFAULT_TEAM: Omit<typeof ccTeamMembers.$inferInsert, "id" | "createdAt" | "updatedAt">[] = [
  { name: "Greg Cooke", role: "CEO / Founder", email: "greg@cookemedia.io", timezone: "Europe/London", activeHoursStart: 8, activeHoursEnd: 19, sortOrder: 0 },
  { name: "Viktor", role: "AI Influencer Lead", email: null, timezone: "Europe/London", activeHoursStart: 9, activeHoursEnd: 18, sortOrder: 1 },
  { name: "Creative Director", role: "Creative / Marketing", email: null, timezone: "America/New_York", activeHoursStart: 9, activeHoursEnd: 18, sortOrder: 2 },
  { name: "Operations Manager", role: "Operations", email: null, timezone: "America/New_York", activeHoursStart: 9, activeHoursEnd: 18, sortOrder: 3 },
  { name: "Content Strategist", role: "Content / Scripts", email: null, timezone: "Europe/London", activeHoursStart: 9, activeHoursEnd: 18, sortOrder: 4 },
];

let teamSeeded = false;
async function ensureTeamSeed() {
  if (teamSeeded) return;
  teamSeeded = true;
  try {
    const [ex] = await db.select({ n: count() }).from(ccTeamMembers);
    if (Number(ex?.n ?? 0) === 0) {
      await db.insert(ccTeamMembers).values(DEFAULT_TEAM as any);
    }
  } catch (err) {
    teamSeeded = false;
    logger.warn({ err: (err as Error).message }, "[cc/team] seed failed");
  }
}

router.get("/crm/command-center/team", requireSuperAdmin, async (_req: Request, res: Response) => {
  await ensureTeamSeed();
  const members = await db.select().from(ccTeamMembers).orderBy(asc(ccTeamMembers.sortOrder));
  res.json({ members });
});

router.post("/crm/command-center/team", requireSuperAdmin, async (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (!b.name || !b.role) { res.status(400).json({ error: "name and role required" }); return; }
  const [member] = await db.insert(ccTeamMembers).values({
    name: String(b.name),
    role: String(b.role),
    email: b.email || null,
    slackHandle: b.slackHandle || null,
    timezone: b.timezone || "UTC",
    activeHoursStart: Number(b.activeHoursStart ?? 9),
    activeHoursEnd: Number(b.activeHoursEnd ?? 18),
    avatarUrl: b.avatarUrl || null,
    sortOrder: Number(b.sortOrder ?? 99),
  }).returning();
  res.json({ member });
});

router.patch("/crm/command-center/team/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const patch: any = { updatedAt: new Date() };
  if (b.name) patch.name = b.name;
  if (b.role) patch.role = b.role;
  if ("email" in b) patch.email = b.email;
  if ("slackHandle" in b) patch.slackHandle = b.slackHandle;
  if (b.timezone) patch.timezone = b.timezone;
  if (typeof b.activeHoursStart === "number") patch.activeHoursStart = b.activeHoursStart;
  if (typeof b.activeHoursEnd === "number") patch.activeHoursEnd = b.activeHoursEnd;
  if ("avatarUrl" in b) patch.avatarUrl = b.avatarUrl;
  if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
  const [member] = await db.update(ccTeamMembers).set(patch).where(eq(ccTeamMembers.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ member });
});

router.delete("/crm/command-center/team/:id", requireSuperAdmin, async (req: Request, res: Response) => {
  await db.update(ccTeamMembers).set({ isActive: false, updatedAt: new Date() }).where(eq(ccTeamMembers.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI Analyst
// ---------------------------------------------------------------------------

router.post("/crm/command-center/ai-analyst", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { question, range = "30d" } = req.body ?? {};
    if (!question?.trim()) { res.status(400).json({ error: "question required" }); return; }

    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - (range === "7d" ? 7 : range === "90d" ? 90 : 30));
    from.setHours(0, 0, 0, 0);

    const [revRow] = await db.select({ v: sql<number>`COALESCE(SUM(amount_cents),0)::int` }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), eq(ccConversions.isRefund, false)));
    const [convRow] = await db.select({ v: count() }).from(ccConversions)
      .where(and(gte(ccConversions.occurredAt, from), eq(ccConversions.isRefund, false)));
    const channelRows = await db.select({
      channel: ccConversions.channel,
      rev: sql<number>`COALESCE(SUM(amount_cents),0)::int`,
      n: count(),
    }).from(ccConversions).where(and(gte(ccConversions.occurredAt, from), eq(ccConversions.isRefund, false))).groupBy(ccConversions.channel);
    const profitRows = await db.select().from(ccDailyProfit)
      .where(gte(ccDailyProfit.day, formatDate(from))).orderBy(asc(ccDailyProfit.day));
    const totalRev = Number(revRow?.v ?? 0);
    const totalConv = Number(convRow?.v ?? 0);
    const totalAdSpend = profitRows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents, 0);
    const totalCosts = profitRows.reduce((s, r) => s + r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents, 0);

    const dataContext = `
Business Data Summary (last ${range}):
- Total Revenue: $${(totalRev / 100).toFixed(2)}
- Total Conversions: ${totalConv}
- Average Order Value: $${totalConv > 0 ? (totalRev / totalConv / 100).toFixed(2) : 0}
- Total Ad Spend: $${(totalAdSpend / 100).toFixed(2)}
- Blended ROAS: ${totalAdSpend > 0 ? (totalRev / totalAdSpend).toFixed(2) : "N/A"}
- Total Costs: $${(totalCosts / 100).toFixed(2)}
- Net Profit: $${((totalRev - totalCosts) / 100).toFixed(2)}
- Margin: ${totalRev > 0 ? (((totalRev - totalCosts) / totalRev) * 100).toFixed(1) : 0}%

Channel Breakdown:
${channelRows.map(r => `- ${r.channel || "unknown"}: $${(Number(r.rev) / 100).toFixed(2)} revenue, ${r.n} conversions`).join("\n")}

Daily P&L (last 7 rows):
${profitRows.slice(-7).map(r => {
  const rev = r.revenueLowTicketCents + r.revenueHighTicketCents + r.revenueOtherCents;
  const costs = r.metaSpendCents + r.googleSpendCents + r.stripeFeeCents + r.vatCents + r.otherCostsCents;
  return `- ${r.day}: Revenue $${(rev/100).toFixed(2)}, Costs $${(costs/100).toFixed(2)}, Net $${((rev-costs)/100).toFixed(2)}`;
}).join("\n")}
`;

    // Build structured chart + table from live data so the UI can render
    // a bar chart and channel table alongside the GPT narrative.
    const chartData = channelRows.length > 0
      ? {
          type: "bar" as const,
          title: `Revenue by Channel (last ${range})`,
          labels: channelRows.map((r) => r.channel || "unknown"),
          datasets: [
            {
              label: "Revenue ($)",
              data: channelRows.map((r) => Math.round(Number(r.rev) / 100)),
              color: "#d4af4b",
            },
          ],
        }
      : null;

    const tableData = channelRows.length > 0
      ? {
          headers: ["Channel", "Revenue", "Conversions", "AOV"],
          rows: channelRows.map((r) => {
            const rev = Number(r.rev);
            const n = Number(r.n);
            const aov = n > 0 ? Math.round(rev / n) : 0;
            return [
              r.channel || "unknown",
              `$${(rev / 100).toFixed(2)}`,
              String(n),
              `$${(aov / 100).toFixed(2)}`,
            ];
          }),
        }
      : null;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are the AI Influencer Portfolio Business Analyst. You have access to real-time business data for the AI Influencer Portfolio digital education brand (greg@cookemedia.io). Answer questions concisely and insightfully. Focus on actionable insights. Format numbers as currency where appropriate. Be direct and data-driven. If asked for trends or charts, describe what you see in the data.`,
        },
        { role: "user", content: `${dataContext}\n\nQuestion: ${question}` },
      ],
    });

    const response = completion.choices[0]?.message?.content || "I couldn't generate an analysis. Please try again.";

    res.json({ response, chart_data: chartData, table_data: tableData, data_summary: { revenueCents: totalRev, conversions: totalConv, netProfitCents: totalRev - totalCosts } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[cc/ai-analyst] error");
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

export default router;
