import { Router } from "express";
import { getAuth, clerkClient } from "../lib/auth-compat";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  knowledgeCategoriesTable,
  knowledgeDocumentsTable,
  gregAiConversationsTable,
  gregAiMessagesTable,
  gregAiSystemPromptTable,
  gregAiUsageSessionsTable,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getUserContext } from "../lib/user-context";
import { getPortalKey } from "../lib/portal-key";
import { getElevenLabsAgentId, getSignedConversationUrl, ElevenLabsConfigError } from "../lib/elevenlabs";
import { GREG_SYSTEM_PROMPT } from "../lib/greg-prompts";
import { mintVoiceToken, VOICE_TOKEN_TTL_SECONDS } from "../lib/voice-auth";
import {
  userBrainProfilesTable,
  lessonsTable,
  lessonProgressTable,
  osToolGenerationJobsTable,
  aiInfluencersTable,
  appUsers,
} from "@workspace/db";
import { getPrebuiltBrain } from "../lib/prebuilt-brains.js";
import { searchKnowledge } from "../lib/knowledge/search";
import { ensurePortalUserForClerk } from "../lib/portal-user-upsert";
import { computePurchaseEntitlements } from "./portal";
import {
  getPlatinumGregUsageSnapshot,
  recordPlatinumGregUsageHeartbeat,
} from "../lib/greg-ai-usage";

const gregAiRouter = Router();

// Gate on Platinum entitlement (`platinumPaid || upsell3Paid`, plus admin),
// reusing the single source of truth in computePurchaseEntitlements so the
// Platinum Greg AI doorway matches the rest of the Platinum Club gating.
const requirePlatinum = async (req: any, res: any, next: any) => {
  try {
    const entitlements = await computePurchaseEntitlements(req.portalUser);
    if (!entitlements.platinumPaid) {
      res.status(403).json({ error: "Platinum Club membership required" });
      return;
    }
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Entitlement check failed";
    console.error("[greg-ai] platinum entitlement check error:", message);
    res.status(500).json({ error: "Could not verify your membership. Please try again." });
  }
};

function getIp(req: any): string {
  return req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
}

const requireAuth = async (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  req.clerkId = userId;

  const claims = auth?.sessionClaims as any;
  let clerkEmail = claims?.email || claims?.email_address || claims?.primary_email_address || null;
  if (!clerkEmail) {
    try {
      const client = clerkClient;
      const clerkUser = await client.users.getUser(userId as string);
      clerkEmail = clerkUser.emailAddresses?.[0]?.emailAddress || null;
    } catch (e) {}
  }

  const email = clerkEmail || `${userId}@portal.local`;
  const adminEmail = (process.env.ADMIN_EMAIL || "greg@cookemedia.io").toLowerCase();
  const isAdmin = email.toLowerCase() === adminEmail;
  // Task #505: route through the shared lower(email)-aware upsert so a
  // pre-existing CSV-grant ghost row gets its clerk_id attached instead
  // of producing a duplicate portal_users row.
  const user = await ensurePortalUserForClerk({
    clerkId: userId as string,
    email,
    portalKey: getPortalKey(req),
    isAdmin,
  });

  req.portalUser = user;
  next();
};

const requireActive = (req: any, res: any, next: any) => {
  if (!req.portalUser?.isActive && req.portalUser?.role !== "admin") {
    res.status(403).json({ error: "Account not activated" }); return;
  }
  next();
};

// Single source of truth lives in lib/greg-prompts so the chat fallback and
// the live ElevenLabs voice agent stay in sync. Do not edit prompt copy here.
const DEFAULT_SYSTEM_PROMPT = GREG_SYSTEM_PROMPT;

gregAiRouter.get("/portal/greg-ai/conversations", requireAuth, requireActive, async (req: any, res) => {
  const conversations = await db.select()
    .from(gregAiConversationsTable)
    .where(eq(gregAiConversationsTable.userId, req.portalUser.id))
    .orderBy(desc(gregAiConversationsTable.updatedAt));
  res.json(conversations);
});

gregAiRouter.post("/portal/greg-ai/conversations", requireAuth, requireActive, async (req: any, res) => {
  const [conversation] = await db.insert(gregAiConversationsTable).values({
    userId: req.portalUser.id,
    title: "New Chat",
    lastMessageAt: new Date(),
  }).returning();
  res.json(conversation);
});

gregAiRouter.delete("/portal/greg-ai/conversations/:id", requireAuth, requireActive, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [conv] = await db.select().from(gregAiConversationsTable)
    .where(and(eq(gregAiConversationsTable.id, id), eq(gregAiConversationsTable.userId, req.portalUser.id)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(gregAiMessagesTable).where(eq(gregAiMessagesTable.conversationId, id));
  await db.delete(gregAiConversationsTable).where(eq(gregAiConversationsTable.id, id));
  res.json({ success: true });
});

gregAiRouter.get("/portal/greg-ai/conversations/:id/messages", requireAuth, requireActive, async (req: any, res) => {
  const id = parseInt(req.params.id);
  const [conv] = await db.select().from(gregAiConversationsTable)
    .where(and(eq(gregAiConversationsTable.id, id), eq(gregAiConversationsTable.userId, req.portalUser.id)));
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  const messages = await db.select()
    .from(gregAiMessagesTable)
    .where(eq(gregAiMessagesTable.conversationId, id))
    .orderBy(asc(gregAiMessagesTable.createdAt));
  res.json(messages);
});

// Shared chat-stream handler. Used by the existing upsell-gated chat route
// and the Platinum Club doorway (which layers Platinum + remaining-allowance
// gating in front of it). Keep this the single source of truth so both
// surfaces stay in sync.
async function handleGregChatStream(req: any, res: any) {
  const conversationId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "Message required" }); return; }

  const [conv] = await db.select().from(gregAiConversationsTable)
    .where(and(eq(gregAiConversationsTable.id, conversationId), eq(gregAiConversationsTable.userId, req.portalUser.id)));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  await db.insert(gregAiMessagesTable).values({
    conversationId,
    role: "user",
    content: message,
  });

  const previousMessages = await db.select()
    .from(gregAiMessagesTable)
    .where(eq(gregAiMessagesTable.conversationId, conversationId))
    .orderBy(asc(gregAiMessagesTable.createdAt));

  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  const [customPrompt] = await db.select().from(gregAiSystemPromptTable)
    .where(eq(gregAiSystemPromptTable.isActive, true))
    .orderBy(desc(gregAiSystemPromptTable.updatedAt))
    .limit(1);
  if (customPrompt) systemPrompt = customPrompt.prompt;

  const [relevantDocs, userContext] = await Promise.all([
    getRelevantKnowledge(message),
    getUserContext(req.portalUser.id, req.portalUser.email, getPortalKey(req)),
  ]);

  let knowledgeContext = "";
  if (relevantDocs.length > 0) {
    knowledgeContext = "\n\n---\nRELEVANT KNOWLEDGE BASE CONTEXT:\n" +
      relevantDocs.map(d => `[${d.categoryName} - ${d.title}]\n${d.content}`).join("\n\n---\n") +
      "\n---\nUse the above context to inform your response when relevant. Don't mention the knowledge base directly.";
  }

  const chatMessages: any[] = [
    { role: "system", content: systemPrompt + userContext + knowledgeContext },
    ...previousMessages.map(m => ({ role: m.role, content: m.content })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    await db.insert(gregAiMessagesTable).values({
      conversationId,
      role: "assistant",
      content: fullResponse,
    });

    const isFirst = previousMessages.length <= 1;
    if (isFirst && fullResponse) {
      const titleSnippet = message.slice(0, 60) + (message.length > 60 ? "..." : "");
      await db.update(gregAiConversationsTable)
        .set({ title: titleSnippet, lastMessageAt: new Date(), messageCount: sql`${gregAiConversationsTable.messageCount} + 2` })
        .where(eq(gregAiConversationsTable.id, conversationId));
    } else {
      await db.update(gregAiConversationsTable)
        .set({ lastMessageAt: new Date(), messageCount: sql`${gregAiConversationsTable.messageCount} + 2` })
        .where(eq(gregAiConversationsTable.id, conversationId));
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  } catch (err: any) {
    console.error("Greg AI chat error:", err);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`);
    res.end();
    return;
  }
}

gregAiRouter.post(
  "/portal/greg-ai/conversations/:id/messages",
  requireAuth,
  requireActive,
  handleGregChatStream,
);

async function getRelevantKnowledge(query: string): Promise<{ title: string; content: string; categoryName: string }[]> {
  // Try vector search first — far better recall than substring matching.
  try {
    const hits = await searchKnowledge(query, { limit: 6 });
    if (hits.length > 0) {
      return hits.map((h) => ({
        title: h.documentTitle,
        content: h.content.length > 1500 ? h.content.slice(0, 1500) + "..." : h.content,
        categoryName: h.expertContext
          ? `${h.categoryName} (${h.expertContext})`
          : h.categoryName,
      }));
    }
  } catch (err) {
    console.error("[greg-ai] vector search failed, falling back to substring:", err);
  }

  // Fallback: legacy substring search (in case embeddings haven't been generated yet).
  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3).slice(0, 5);
  if (searchTerms.length === 0) return [];

  const results: { title: string; content: string; categoryName: string }[] = [];

  for (const term of searchTerms) {
    const docs = await db.select({
      title: knowledgeDocumentsTable.title,
      content: knowledgeDocumentsTable.content,
      categoryName: knowledgeCategoriesTable.name,
    })
    .from(knowledgeDocumentsTable)
    .innerJoin(knowledgeCategoriesTable, eq(knowledgeDocumentsTable.categoryId, knowledgeCategoriesTable.id))
    .where(
      and(
        eq(knowledgeCategoriesTable.isActive, true),
        sql`(lower(${knowledgeDocumentsTable.title}) LIKE ${'%' + term + '%'} OR lower(${knowledgeDocumentsTable.content}) LIKE ${'%' + term + '%'})`
      )
    )
    .limit(3);

    for (const doc of docs) {
      if (!results.find(r => r.title === doc.title)) {
        const truncated = doc.content.length > 2000 ? doc.content.slice(0, 2000) + "..." : doc.content;
        results.push({ ...doc, content: truncated });
      }
    }
  }

  return results.slice(0, 5);
}

// ----------------------------------------------------------------------------
// Per-user dynamic context for the ElevenLabs Greg agent.
// ----------------------------------------------------------------------------
// The configured agent interpolates a set of dynamic variables into its system
// prompt / first message ({{user_brain}}, {{user_products}}, {{user_progress}},
// ...). We resolve them once here and reuse the result in both voice-token
// endpoints (the upsell-gated route and the Platinum doorway). Every lookup is
// best-effort: any failure or empty result degrades to a sensible default
// string so a live call never fails just because one context source is
// unavailable. The endpoint-specific {{user_token}} is merged in by each
// caller, not here.
async function buildGregUserContext(portalUser: any): Promise<Record<string, string>> {
  const userId = portalUser.id as number;

  const firstName =
    (portalUser.email ? String(portalUser.email).split("@")[0] : "").split(/[._-]/)[0] || "";
  const userName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "there";

  // All lookups below are independent, so run them concurrently to keep the
  // token endpoint (which gates the start of a live voice call) snappy. Each
  // closure owns its own try/catch and resolves to a safe default string.

  // Brain / offer.
  const brainP = (async (): Promise<{
    companyName: string;
    audience: string;
    userBrain: string;
  }> => {
    let companyName = "";
    let audience = "";
    let userBrain = "not selected yet";
    try {
      const [brain] = await db
        .select({
          brainMode: userBrainProfilesTable.brainMode,
          selectedPrebuiltBrainId: userBrainProfilesTable.selectedPrebuiltBrainId,
          companyName: userBrainProfilesTable.companyName,
          whoDoYouHelp: userBrainProfilesTable.whoDoYouHelp,
          howDoYouHelpThem: userBrainProfilesTable.howDoYouHelpThem,
        })
        .from(userBrainProfilesTable)
        .where(eq(userBrainProfilesTable.userId, userId))
        .limit(1);
      if (brain) {
        companyName = brain.companyName || "";
        audience = brain.whoDoYouHelp || "";
        if (brain.brainMode === "prebuilt" && brain.selectedPrebuiltBrainId) {
          const pre = getPrebuiltBrain(brain.selectedPrebuiltBrainId);
          if (pre) userBrain = pre.tagline ? `${pre.name} - ${pre.tagline}` : pre.name;
        } else {
          const parts = [
            companyName || null,
            audience ? `helps ${audience}` : null,
            brain.howDoYouHelpThem ? `by ${brain.howDoYouHelpThem}` : null,
          ].filter(Boolean) as string[];
          if (parts.length) userBrain = parts.join(", ");
        }
      }
    } catch {}
    return { companyName, audience, userBrain };
  })();

  // Products owned (curated to the human-meaningful SKUs).
  const productsP = (async (): Promise<string> => {
    try {
      const ent: any = await computePurchaseEntitlements(portalUser);
      const owned: string[] = [];
      if (ent.mainProductPaid) owned.push("Main course");
      if (ent.platinumPaid) owned.push("Platinum Club");
      if (ent.portfolioPaid) owned.push("Our Portfolio");
      if (ent.doneForYouPackPaid) owned.push("Done For You Pack");
      if (ent.bump2Paid || ent.hookDemoPaid) owned.push("Hook Demo Library");
      if (ent.tiktokSlideshowPaid) owned.push("TikTok Slideshow Masterclass");
      if (ent.upsell2Paid) owned.push("VSL Templates Pack");
      if (owned.length) return owned.join(", ");
    } catch {}
    return "Main course only";
  })();

  // Lesson progress for the Room30 curriculum.
  const progressP = (async (): Promise<string> => {
    try {
      const [{ total }] = await db
        .select({ total: count() })
        .from(lessonsTable)
        .where(eq(lessonsTable.portalKey, "room30"));
      const [{ done }] = await db
        .select({ done: count() })
        .from(lessonProgressTable)
        .innerJoin(lessonsTable, eq(lessonProgressTable.lessonId, lessonsTable.id))
        .where(
          and(
            eq(lessonProgressTable.userId, userId),
            eq(lessonProgressTable.completed, true),
            eq(lessonsTable.portalKey, "room30"),
          ),
        );
      const totalN = Number(total) || 0;
      const doneN = Number(done) || 0;
      if (totalN > 0) {
        const pct = Math.round((doneN / totalN) * 100);
        return `${pct}% complete (${doneN}/${totalN} lessons)`;
      }
    } catch {}
    return "not started yet";
  })();

  // Latest AI influencer build status. ai_influencers.client_id references the
  // appUsers row, mapped from this portal user by shared clerk_id.
  const influencerP = (async (): Promise<string> => {
    try {
      if (portalUser.clerkId) {
        const [appUser] = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.clerkId, portalUser.clerkId))
          .limit(1);
        if (appUser) {
          const [inf] = await db
            .select({ name: aiInfluencersTable.name, status: aiInfluencersTable.status })
            .from(aiInfluencersTable)
            .where(eq(aiInfluencersTable.clientId, appUser.id))
            .orderBy(desc(aiInfluencersTable.createdAt))
            .limit(1);
          if (inf) return `${inf.name} (${inf.status})`;
        }
      }
    } catch {}
    return "none yet";
  })();

  // Most recently used OS tools (distinct slugs, newest first).
  const toolsP = (async (): Promise<string> => {
    try {
      const rows = await db
        .select({ slug: osToolGenerationJobsTable.slug })
        .from(osToolGenerationJobsTable)
        .where(eq(osToolGenerationJobsTable.userId, userId))
        .orderBy(desc(osToolGenerationJobsTable.createdAt))
        .limit(15);
      const distinct = Array.from(
        new Set(rows.map((r) => r.slug).filter((s): s is string => Boolean(s))),
      ).slice(0, 5);
      if (distinct.length) return distinct.join(", ");
    } catch {}
    return "none yet";
  })();

  const [brainR, userProducts, userProgress, influencerStatus, recentTools] = await Promise.all([
    brainP,
    productsP,
    progressP,
    influencerP,
    toolsP,
  ]);

  // Member since (month + year).
  let memberSince = "recently";
  try {
    if (portalUser.createdAt) {
      memberSince = new Date(portalUser.createdAt).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      });
    }
  } catch {}

  return {
    user_name: userName,
    user_email: portalUser.email || "",
    user_company: brainR.companyName,
    user_audience: brainR.audience,
    user_brain: brainR.userBrain,
    user_products: userProducts,
    user_progress: userProgress,
    user_influencer_status: influencerStatus,
    user_recent_tools: recentTools,
    user_member_since: memberSince,
  };
}

// ============================================================================
// Voice (ElevenLabs Conversational AI)
// ----------------------------------------------------------------------------
// Mints a short-lived signed WebSocket URL the browser uses to start a live
// voice call with the configured Greg AI agent. The ElevenLabs API key never
// touches the client; it is held by the Replit ElevenLabs connector and
// injected server-side via the connectors SDK.
//
// Configuration:
//   - ELEVENLABS_AGENT_ID env var: the Conversational AI agent_id created in
//     the ElevenLabs dashboard (must already be configured with Greg's voice
//     and system prompt).
// ============================================================================

gregAiRouter.get("/portal/greg-ai/voice-token", requireAuth, requireActive, async (req: any, res) => {
  try {
    const agentId = getElevenLabsAgentId();
    const signedUrl = await getSignedConversationUrl(agentId);

    const portalUser = req.portalUser;
    const userToken = mintVoiceToken({ userId: portalUser.id, clerkId: portalUser.clerkId });

    const context = await buildGregUserContext(portalUser);

    res.json({
      signedUrl,
      agentId,
      dynamicVariables: {
        user_token: userToken,
        ...context,
      },
      tokenExpiresInSec: VOICE_TOKEN_TTL_SECONDS,
    });
    return;
  } catch (err: unknown) {
    if (err instanceof ElevenLabsConfigError) {
      res.status(503).json({ error: err.message, code: "ELEVENLABS_NOT_CONFIGURED" }); return;
    }
    const message = err instanceof Error ? err.message : "Failed to get voice token";
    console.error("[greg-ai] voice-token error:", message);
    res.status(500).json({ error: "Failed to start voice call. Please try again." });
    return;
  }
});

// ============================================================================
// Platinum Club Greg AI doorway (Task #762)
// ----------------------------------------------------------------------------
// A separate, Platinum-only entry point with its own hard 120-minute (7200s)
// monthly voice+chat allowance. Distinct from the upsell-gated Greg AI page
// and the $10 aiUsageCents credit model. The cap is enforced here server-side
// so the UI cannot be bypassed.
// ============================================================================

// Read the caller's current-month usage snapshot.
gregAiRouter.get(
  "/portal/greg-ai/platinum/usage",
  requireAuth,
  requireActive,
  requirePlatinum,
  async (req: any, res) => {
    try {
      const snapshot = await getPlatinumGregUsageSnapshot(req.portalUser.id);
      res.json(snapshot);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to read usage";
      console.error("[greg-ai] platinum usage read error:", message);
      res.status(500).json({ error: "Could not load your usage. Please try again." });
    }
  },
);

// Record a finished session's elapsed seconds, capped at remaining allowance.
gregAiRouter.post(
  "/portal/greg-ai/platinum/usage",
  requireAuth,
  requireActive,
  requirePlatinum,
  async (req: any, res) => {
    try {
      const channel = req.body?.channel;
      const durationSecondsRaw = req.body?.durationSeconds;
      const sessionKeyRaw = req.body?.sessionKey;
      if (channel !== "voice" && channel !== "chat") {
        res.status(400).json({ error: "channel must be 'voice' or 'chat'" });
        return;
      }
      const durationSeconds = Math.floor(Number(durationSecondsRaw));
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
        res.status(400).json({ error: "durationSeconds must be a non-negative integer" });
        return;
      }

      // Task #764: heartbeat / final path. When the client supplies a
      // sessionKey, `durationSeconds` is the CUMULATIVE elapsed time for that
      // in-progress session and we idempotently upsert ONE capped row keyed by
      // it. The periodic heartbeats mean a hard tab-close loses at most one
      // interval instead of the whole session. We do not 403 on an exhausted
      // cap here - the upsert is naturally capped (cap=0 records nothing) and
      // an in-progress session that just hit the cap should still flush the
      // final seconds it was entitled to.
      const sessionKey =
        typeof sessionKeyRaw === "string" && sessionKeyRaw.trim().length > 0
          ? sessionKeyRaw.trim().slice(0, 100)
          : null;

      if (sessionKey) {
        await recordPlatinumGregUsageHeartbeat(
          req.portalUser.id,
          channel,
          sessionKey,
          durationSeconds,
        );
        const updated = await getPlatinumGregUsageSnapshot(req.portalUser.id);
        res.json(updated);
        return;
      }

      // Legacy one-shot path (no sessionKey): kept for backward compatibility
      // with any older client that posts a single final duration.
      const snapshot = await getPlatinumGregUsageSnapshot(req.portalUser.id);
      if (snapshot.remainingSeconds <= 0) {
        res.status(403).json({
          error: "You've used your 2 hours of Greg AI this month. Resets on the 1st.",
          code: "PLATINUM_GREG_CAP_EXHAUSTED",
        });
        return;
      }

      // Cap the recorded amount at remaining time so a long final session
      // can never push usage past the monthly allowance.
      const billable = Math.min(durationSeconds, snapshot.remainingSeconds);
      if (billable > 0) {
        await db.insert(gregAiUsageSessionsTable).values({
          userId: req.portalUser.id,
          channel,
          durationSeconds: billable,
          startedAt: new Date(),
        });
      }

      const updated = await getPlatinumGregUsageSnapshot(req.portalUser.id);
      res.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record usage";
      console.error("[greg-ai] platinum usage record error:", message);
      res.status(500).json({ error: "Could not record your usage. Please try again." });
    }
  },
);

// Mint a voice token for a Platinum member, gated on remaining allowance so
// an exhausted member cannot start a new call.
gregAiRouter.get(
  "/portal/greg-ai/platinum/voice-token",
  requireAuth,
  requireActive,
  requirePlatinum,
  async (req: any, res) => {
    try {
      const snapshot = await getPlatinumGregUsageSnapshot(req.portalUser.id);
      if (snapshot.remainingSeconds <= 0) {
        res.status(403).json({
          error: "You've used your 2 hours of Greg AI this month. Resets on the 1st.",
          code: "PLATINUM_GREG_CAP_EXHAUSTED",
        });
        return;
      }

      const agentId = getElevenLabsAgentId();
      const signedUrl = await getSignedConversationUrl(agentId);

      const portalUser = req.portalUser;
      const userToken = mintVoiceToken({ userId: portalUser.id, clerkId: portalUser.clerkId });

      const context = await buildGregUserContext(portalUser);

      res.json({
        signedUrl,
        agentId,
        dynamicVariables: {
          user_token: userToken,
          ...context,
        },
        tokenExpiresInSec: VOICE_TOKEN_TTL_SECONDS,
        remainingSeconds: snapshot.remainingSeconds,
      });
      return;
    } catch (err: unknown) {
      if (err instanceof ElevenLabsConfigError) {
        res.status(503).json({ error: err.message, code: "ELEVENLABS_NOT_CONFIGURED" }); return;
      }
      const message = err instanceof Error ? err.message : "Failed to get voice token";
      console.error("[greg-ai] platinum voice-token error:", message);
      res.status(500).json({ error: "Failed to start voice call. Please try again." });
      return;
    }
  },
);

// Platinum-gated chat turn. Refuses when the monthly allowance is exhausted,
// then delegates to the shared chat-stream handler.
gregAiRouter.post(
  "/portal/greg-ai/platinum/conversations/:id/messages",
  requireAuth,
  requireActive,
  requirePlatinum,
  async (req: any, res, next) => {
    try {
      const snapshot = await getPlatinumGregUsageSnapshot(req.portalUser.id);
      if (snapshot.remainingSeconds <= 0) {
        res.status(403).json({
          error: "You've used your 2 hours of Greg AI this month. Resets on the 1st.",
          code: "PLATINUM_GREG_CAP_EXHAUSTED",
        });
        return;
      }
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Allowance check failed";
      console.error("[greg-ai] platinum chat gate error:", message);
      res.status(500).json({ error: "Could not start the chat. Please try again." });
    }
  },
  handleGregChatStream,
);

export default gregAiRouter;
