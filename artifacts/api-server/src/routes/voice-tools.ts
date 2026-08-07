import { Router } from "express";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  userBrainProfilesTable,
  userHighTicketFunnelsTable,
  userLowTicketFunnelsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyVoiceToken } from "../lib/voice-auth";
import { searchKnowledge } from "../lib/knowledge/search";

export const voiceToolsRouter = Router();

interface VoiceReq extends Express.Request {
  voiceUserId: number;
  voiceClerkId: string;
  portalUser: typeof portalUsersTable.$inferSelect;
}

const requireVoiceAuth: import("express").RequestHandler = async (req: any, res, next) => {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  const raw = typeof header === "string" ? header : Array.isArray(header) ? header[0] : "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();

  const payload = verifyVoiceToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "Invalid or expired voice token." }); return;
  }

  const [user] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, payload.userId))
    .limit(1);

  if (!user) {
    res.status(403).json({ ok: false, error: "Account not found." }); return;
  }

  if (user.clerkId !== payload.clerkId) {
    res.status(401).json({ ok: false, error: "Token does not match account." }); return;
  }

  if (!user.isActive && user.role !== "admin") {
    res.status(403).json({ ok: false, error: "Account not active." }); return;
  }

  req.voiceUserId = payload.userId;
  req.voiceClerkId = payload.clerkId;
  req.portalUser = user;
  next();
};

function shorten(value: string | null | undefined, max = 600): string {
  if (!value) return "";
  const s = value.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max - 1) + "…".replace("…", "...");
}

function asObj(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function pickOffer(offer: unknown) {
  const o = asObj(offer);
  if (!o) return null;
  return {
    name: o.name || o.title || o.offerName || null,
    price: o.price ?? o.offerPrice ?? o.amount ?? null,
    pricing_model: o.pricingModel || o.pricing_model || null,
    promise: o.promise || o.bigPromise || o.outcome || null,
    summary: shorten(o.summary || o.description || o.pitch || ""),
  };
}

// ----------------------------------------------------------------------------
// POST /api/voice-tools/get_user_brain
// ----------------------------------------------------------------------------
voiceToolsRouter.post("/voice-tools/get_user_brain", requireVoiceAuth, async (req: any, res) => {
  try {
    const userId = req.voiceUserId as number;

    const [brain] = await db
      .select()
      .from(userBrainProfilesTable)
      .where(eq(userBrainProfilesTable.userId, userId))
      .limit(1);

    if (!brain) {
      res.json({
        ok: true,
        has_brain: false,
        message:
          "This user hasn't filled out their Brain profile yet. Recommend they go to the Brain tab in the portal and complete it so we can help them properly.",
      }); return;
    }

    res.json({
      ok: true,
      has_brain: true,
      profile: {
        name: brain.name || null,
        company_name: brain.companyName || null,
        who_they_help: brain.whoDoYouHelp || null,
        how_they_help: brain.howDoYouHelpThem || null,
        key_achievements: shorten(brain.keyAchievements, 800),
        website: brain.website || null,
        brand_color_primary: brain.brandColorPrimary || null,
        brand_color_secondary: brain.brandColorSecondary || null,
        status: brain.status,
        generated_at: brain.generatedAt,
      },
      brain_summary: shorten(brain.generatedBrain, 2000),
    });
    return;
  } catch (err: unknown) {
    console.error("[voice-tools] get_user_brain error:", err);
    res.status(500).json({ ok: false, error: "Could not fetch brain right now." });
    return;
  }
});

// ----------------------------------------------------------------------------
// POST /api/voice-tools/get_user_offers
// ----------------------------------------------------------------------------
voiceToolsRouter.post("/voice-tools/get_user_offers", requireVoiceAuth, async (req: any, res) => {
  try {
    const userId = req.voiceUserId as number;

    const [brain] = await db
      .select()
      .from(userBrainProfilesTable)
      .where(eq(userBrainProfilesTable.userId, userId))
      .limit(1);

    const [highTicket] = await db
      .select()
      .from(userHighTicketFunnelsTable)
      .where(eq(userHighTicketFunnelsTable.userId, userId))
      .limit(1);

    const [lowTicket] = await db
      .select()
      .from(userLowTicketFunnelsTable)
      .where(eq(userLowTicketFunnelsTable.userId, userId))
      .limit(1);

    const offers = {
      low_ticket: pickOffer(brain?.confirmedLowTicketOffer),
      premium: pickOffer(brain?.confirmedPremiumOffer),
      hundred_k: pickOffer(brain?.confirmed100kOffer),
    };

    const high_ticket_funnel = highTicket
      ? {
          offer_type: highTicket.offerType || null,
          offer_name: highTicket.offerName || null,
          offer_price: highTicket.offerPrice || null,
          vsl_url: highTicket.vslUrl || null,
        }
      : null;

    const low_ticket_funnel = lowTicket
      ? {
          offer_name: lowTicket.offerName || null,
          main_price: lowTicket.mainPrice || null,
          bump_name: lowTicket.bumpName || null,
          upsell_1_name: lowTicket.upsell1Name || null,
          downsell_1_name: lowTicket.downsell1Name || null,
        }
      : null;

    const has_any =
      !!offers.low_ticket || !!offers.premium || !!offers.hundred_k || !!high_ticket_funnel || !!low_ticket_funnel;

    res.json({
      ok: true,
      has_offers: has_any,
      message: has_any
        ? null
        : "This user hasn't built any offers yet. Recommend they start with the Find Your Offers tool in the portal.",
      offers,
      high_ticket_funnel,
      low_ticket_funnel,
    });
    return;
  } catch (err: unknown) {
    console.error("[voice-tools] get_user_offers error:", err);
    res.status(500).json({ ok: false, error: "Could not fetch offers right now." });
    return;
  }
});

// ----------------------------------------------------------------------------
// POST /api/voice-tools/search_greg_knowledge
// Body: { query: string, limit?: number }
// Returns top matching chunks across all enabled knowledge sources, with
// source name + expert context attribution so the agent can quote correctly.
// ----------------------------------------------------------------------------

// Per-user sliding-window limiter. Each search call costs an embedding
// (network + a few hundredths of a cent), so cap aggressive callers.
const SEARCH_WINDOW_MS = 60 * 1000;
const SEARCH_MAX_PER_WINDOW = 30;
const searchHits = new Map<number, number[]>();
function takeSearchSlot(userId: number): boolean {
  const now = Date.now();
  const list = searchHits.get(userId) ?? [];
  const fresh = list.filter((t) => now - t < SEARCH_WINDOW_MS);
  if (fresh.length >= SEARCH_MAX_PER_WINDOW) {
    searchHits.set(userId, fresh);
    return false;
  }
  fresh.push(now);
  searchHits.set(userId, fresh);
  return true;
}

voiceToolsRouter.post("/voice-tools/search_greg_knowledge", requireVoiceAuth, async (req: any, res) => {
  try {
    if (!takeSearchSlot(req.voiceUserId)) {
      res.status(429).json({
        ok: false,
        error: "Too many knowledge searches in the last minute. Slow down.",
      }); return;
    }
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 10)) : 5;

    if (query.length < 3) {
      res.json({
        ok: true,
        count: 0,
        results: [],
        message: "Empty query. Provide a specific question or topic.",
      }); return;
    }

    const hits = await searchKnowledge(query, { limit });
    if (hits.length === 0) {
      res.json({
        ok: true,
        count: 0,
        results: [],
        message:
          "Nothing in the knowledge base matched that question yet. Answer from general expertise and recommend the user ask Greg directly.",
      }); return;
    }

    const results = hits.map((h) => ({
      source: h.sourceName,
      expert_context: h.expertContext,
      title: h.documentTitle,
      url: h.documentUrl,
      similarity: Math.round(h.similarity * 1000) / 1000,
      content: shorten(h.content, 1200),
    }));

    res.json({
      ok: true,
      count: results.length,
      query,
      results,
      attribution_hint:
        "When using these in your answer, briefly attribute the source (e.g. 'Greg teaches that...' or 'According to [expert]...').",
    });
    return;
  } catch (err: unknown) {
    console.error("[voice-tools] search_greg_knowledge error:", err);
    res.status(500).json({ ok: false, error: "Could not search the knowledge base right now." });
    return;
  }
});

export default voiceToolsRouter;
