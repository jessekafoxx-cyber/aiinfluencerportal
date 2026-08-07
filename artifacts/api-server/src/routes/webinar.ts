import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  webinarSettings,
  webinarSessions,
  webinarRegistrants,
  webinarChatMessages,
  type WebinarSettings,
  type WebinarSession,
  type WebinarRegistrant,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";
import {
  getWebinarSettings,
  ensureUpcomingSessions,
  computeSessionTiming,
  attendeeCountAt,
  fireRegistrationWebhook,
  type RegistrationWebhookPayload,
} from "../lib/webinar.js";

const webinarRouter: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strOrNull(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim().length > 0
    ? v.trim().slice(0, max)
    : null;
}

function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function getClientIp(req: Request): string | null {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    null
  );
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

// Public-safe projection of settings (strips webhook URL + bot prompt).
function publicSettings(s: WebinarSettings) {
  return {
    videoProvider: s.videoProvider,
    videoSrc: s.videoSrc,
    videoDurationSeconds: s.videoDurationSeconds,
    scheduleTime: s.scheduleTime,
    scheduleTimezone: s.scheduleTimezone,
    roomGraceMinutes: s.roomGraceMinutes,
    ctaAppearSeconds: s.ctaAppearSeconds,
    chatOpenSeconds: s.chatOpenSeconds,
    ctaUrl: s.ctaUrl,
    ctaLabel: s.ctaLabel,
    botEnabled: s.botEnabled,
    botName: s.botName,
    copy: s.copy ?? {},
    vslUrls: s.vslUrls ?? {},
  };
}

function publicSession(sess: WebinarSession) {
  return {
    id: sess.id,
    startsAt: sess.startsAt.toISOString(),
    status: sess.status,
    videoDurationSeconds: sess.videoDurationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Admin auth (env password via X-Webinar-Admin-Password header)
// ---------------------------------------------------------------------------

function getAdminPassword(): string | null {
  const v = process.env.WEBINAR_ADMIN_PASSWORD;
  return typeof v === "string" && v.length >= 6 ? v : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = getAdminPassword();
  if (!expected) {
    res
      .status(503)
      .json({ error: "Admin access is not configured (WEBINAR_ADMIN_PASSWORD unset)" });
    return;
  }
  const provided =
    req.header("x-webinar-admin-password") ||
    (typeof req.body?.password === "string" ? req.body.password : "");
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// PUBLIC: config + upcoming sessions
// ---------------------------------------------------------------------------

webinarRouter.get("/webinar/config", async (req, res) => {
  try {
    const settings = await getWebinarSettings();
    const sessions = await ensureUpcomingSessions(settings);
    res.json({
      settings: publicSettings(settings),
      serverTime: new Date().toISOString(),
      sessions: sessions.map(publicSession),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] config failed",
    );
    res.status(500).json({ error: "Failed to load webinar config" });
  }
});

// ---------------------------------------------------------------------------
// PUBLIC: register
// ---------------------------------------------------------------------------

webinarRouter.post("/webinar/register", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = isValidEmail(body.email)
      ? (body.email as string).trim().toLowerCase()
      : null;
    if (!email) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }
    const firstName = strOrNull(body.firstName, 80);
    const phone = strOrNull(body.phone, 40);
    const source = strOrNull(body.source, 120);
    const referrer = strOrNull(body.referrer, 500);

    const settings = await getWebinarSettings();
    const upcoming = await ensureUpcomingSessions(settings);

    // Resolve the requested session, defaulting to the next one.
    let session: WebinarSession | undefined;
    const reqSessionId = Number(body.sessionId);
    if (Number.isInteger(reqSessionId) && reqSessionId > 0) {
      session = upcoming.find((s) => s.id === reqSessionId);
      if (!session) {
        const [byId] = await db
          .select()
          .from(webinarSessions)
          .where(eq(webinarSessions.id, reqSessionId))
          .limit(1);
        session = byId;
      }
    }
    if (!session) session = upcoming[0];
    if (!session) {
      res.status(503).json({ error: "No upcoming sessions are scheduled" });
      return;
    }

    const token = newToken();
    const [registrant] = await db
      .insert(webinarRegistrants)
      .values({
        sessionId: session.id,
        token,
        firstName,
        email,
        phone,
        source,
        referrer,
        ipAddress: getClientIp(req),
        userAgent: strOrNull(req.headers["user-agent"], 500),
      })
      .returning();

    // Build the unique access link from the canonical public origin.
    const origin =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const uniqueAccessLink = `${origin}/webinar/confirmed?t=${token}`;

    const hoursUntil =
      Math.round(
        ((session.startsAt.getTime() - Date.now()) / 3_600_000) * 10,
      ) / 10;

    const payload: RegistrationWebhookPayload = {
      event: "webinar_registration",
      first_name: firstName,
      email,
      phone,
      registered_at: registrant.registeredAt.toISOString(),
      session_datetime: session.startsAt.toISOString(),
      unique_access_link: uniqueAccessLink,
      hours_until_session: hoursUntil,
    };
    fireRegistrationWebhook(settings.webhookUrl, payload);
    // Best-effort stamp that we attempted the webhook.
    void db
      .update(webinarRegistrants)
      .set({ webhookFiredAt: new Date() })
      .where(eq(webinarRegistrants.id, registrant.id))
      .catch(() => {});

    res.json({
      token,
      uniqueAccessLink,
      session: publicSession(session),
      registrant: {
        firstName: registrant.firstName,
        email: registrant.email,
      },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] register failed",
    );
    res.status(500).json({ error: "Registration failed" });
  }
});

// ---------------------------------------------------------------------------
// PUBLIC: resolve session by access token (waiting room / live room state)
// ---------------------------------------------------------------------------

async function loadByToken(
  token: string,
): Promise<{ registrant: WebinarRegistrant; session: WebinarSession } | null> {
  const [registrant] = await db
    .select()
    .from(webinarRegistrants)
    .where(eq(webinarRegistrants.token, token))
    .limit(1);
  if (!registrant) return null;
  const [session] = await db
    .select()
    .from(webinarSessions)
    .where(eq(webinarSessions.id, registrant.sessionId))
    .limit(1);
  if (!session) return null;
  return { registrant, session };
}

webinarRouter.get("/webinar/session/:token", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const settings = await getWebinarSettings();
    const timing = computeSessionTiming(loaded.session, settings);
    const attendees =
      timing.phase === "live"
        ? attendeeCountAt(loaded.session, timing.elapsedSeconds, settings)
        : 0;
    res.json({
      settings: publicSettings(settings),
      session: publicSession(loaded.session),
      registrant: {
        firstName: loaded.registrant.firstName,
        email: loaded.registrant.email,
        joinedAt: loaded.registrant.joinedAt?.toISOString() ?? null,
        ctaClicked: loaded.registrant.ctaClicked,
        offer27Paid: loaded.registrant.offer27Paid,
      },
      timing,
      attendees,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] session lookup failed",
    );
    res.status(500).json({ error: "Failed to load session" });
  }
});

webinarRouter.post("/webinar/session/:token/join", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (!loaded.registrant.joinedAt) {
      await db
        .update(webinarRegistrants)
        .set({ joinedAt: new Date() })
        .where(eq(webinarRegistrants.id, loaded.registrant.id));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] join failed",
    );
    res.status(500).json({ error: "Join failed" });
  }
});

webinarRouter.post("/webinar/session/:token/heartbeat", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const watched = Number((req.body ?? {}).watchedSeconds);
    if (Number.isFinite(watched) && watched >= 0) {
      // Monotonic: never let the watch duration go backwards.
      await db
        .update(webinarRegistrants)
        .set({
          watchDurationSeconds: sql`GREATEST(${webinarRegistrants.watchDurationSeconds}, ${Math.floor(watched)})`,
        })
        .where(eq(webinarRegistrants.id, loaded.registrant.id));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

webinarRouter.post("/webinar/session/:token/cta-click", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (!loaded.registrant.ctaClicked) {
      await db
        .update(webinarRegistrants)
        .set({ ctaClicked: true, ctaClickedAt: new Date() })
        .where(eq(webinarRegistrants.id, loaded.registrant.id));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to record click" });
  }
});

// ---------------------------------------------------------------------------
// PUBLIC: scripted chat replay (messages due by current playback offset)
// ---------------------------------------------------------------------------

webinarRouter.get("/webinar/session/:token/chat", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const settings = await getWebinarSettings();
    const timing = computeSessionTiming(loaded.session, settings);
    // Scripted messages whose displayAt <= elapsed, plus any session-
    // specific live (AI/human) messages with a NULL displayAt.
    const rows = await db
      .select()
      .from(webinarChatMessages)
      .where(
        and(
          sql`(${webinarChatMessages.sessionId} IS NULL OR ${webinarChatMessages.sessionId} = ${loaded.session.id})`,
          sql`(${webinarChatMessages.displayAtSeconds} IS NULL OR ${webinarChatMessages.displayAtSeconds} <= ${timing.elapsedSeconds})`,
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(${webinarChatMessages.displayAtSeconds}, 2147483647)`,
        ),
        asc(webinarChatMessages.createdAt),
      )
      .limit(500);
    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        authorName: m.authorName,
        body: m.body,
        displayAtSeconds: m.displayAtSeconds,
      })),
      elapsedSeconds: timing.elapsedSeconds,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load chat" });
  }
});

// ---------------------------------------------------------------------------
// PUBLIC: attendee posts a chat message -> AI host (Reece) reply
// ---------------------------------------------------------------------------

const lastChatByToken = new Map<string, number>();
const CHAT_RATE_MS = 5000;

const DEFAULT_BOT_PROMPT = `You are a friendly, upbeat live webinar host moderator helping in the chat of an online training about building a Low-Ticket Acquisition and Operating System with GREGORY. (the brand). You are a real member of the team in the chat.

Strict rules:
- NEVER reveal or imply you are an AI, a bot, or automated. You are a real person on the team.
- Keep replies short (1-3 sentences), warm, casual, and encouraging - like a real moderator typing fast in a busy chat.
- Encourage people to stay to the end and watch for the special offer.
- NEVER promise or guarantee income, results, or earnings. Stay compliant and vague about outcomes.
- If asked about refunds, billing, or money-back, gently deflect: tell them the team will help after the session and to drop their email, do not promise refunds.
- Do not give personal financial, legal, or medical advice.
- Never use em dashes or en dashes; use a normal hyphen.`;

webinarRouter.post("/webinar/session/:token/chat", async (req, res) => {
  try {
    const loaded = await loadByToken(req.params.token);
    if (!loaded) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const message = strOrNull((req.body ?? {}).message, 500);
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // Rate limit: 1 message / 5s / token.
    const now = Date.now();
    const last = lastChatByToken.get(req.params.token) ?? 0;
    if (now - last < CHAT_RATE_MS) {
      res.status(429).json({ error: "Please wait a moment before sending another message" });
      return;
    }
    lastChatByToken.set(req.params.token, now);

    const settings = await getWebinarSettings();

    // Persist the attendee's message as a live (NULL displayAt) line.
    await db.insert(webinarChatMessages).values({
      sessionId: loaded.session.id,
      role: "attendee",
      authorName: loaded.registrant.firstName || "Guest",
      body: message,
      displayAtSeconds: null,
      scripted: false,
    });

    if (!settings.botEnabled) {
      res.json({ reply: null });
      return;
    }

    const systemPrompt =
      (settings.botPrompt && settings.botPrompt.trim()) || DEFAULT_BOT_PROMPT;
    const botName = settings.botName || "Reece";

    let reply = "";
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 300,
        messages: [
          { role: "system", content: `${systemPrompt}\n\nYour name is ${botName}.` },
          { role: "user", content: message },
        ],
      });
      reply = completion.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[webinar] chat AI reply failed",
      );
    }

    if (reply) {
      await db.insert(webinarChatMessages).values({
        sessionId: loaded.session.id,
        role: "bot",
        authorName: botName,
        body: reply,
        displayAtSeconds: null,
        scripted: false,
      });
    }

    res.json({
      reply: reply
        ? { authorName: botName, body: reply, role: "bot" }
        : null,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] chat post failed",
    );
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

webinarRouter.post("/webinar/admin/login", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

webinarRouter.get("/webinar/admin/settings", requireAdmin, async (_req, res) => {
  const settings = await getWebinarSettings();
  res.json({ settings });
});

const SETTINGS_TEXT_FIELDS = [
  "videoProvider",
  "videoSrc",
  "scheduleTime",
  "scheduleTimezone",
  "ctaUrl",
  "ctaLabel",
  "botName",
  "botPrompt",
  "webhookUrl",
] as const;

const SETTINGS_INT_FIELDS = [
  "videoDurationSeconds",
  "upcomingCount",
  "roomGraceMinutes",
  "ctaAppearSeconds",
  "chatOpenSeconds",
  "counterBase",
  "counterRampPct",
  "counterVariancePct",
] as const;

webinarRouter.put("/webinar/admin/settings", requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    for (const f of SETTINGS_TEXT_FIELDS) {
      if (typeof body[f] === "string") update[f] = (body[f] as string).slice(0, 4000);
    }
    for (const f of SETTINGS_INT_FIELDS) {
      if (body[f] !== undefined && body[f] !== null) {
        const n = Number(body[f]);
        if (Number.isFinite(n)) update[f] = Math.max(0, Math.floor(n));
      }
    }
    if (typeof body.botEnabled === "boolean") update.botEnabled = body.botEnabled;
    if (body.copy && typeof body.copy === "object")
      update.copy = body.copy as Record<string, string>;
    if (body.vslUrls && typeof body.vslUrls === "object")
      update.vslUrls = body.vslUrls as Record<string, string>;

    await getWebinarSettings(); // ensure row exists
    const [updated] = await db
      .update(webinarSettings)
      .set(update)
      .where(eq(webinarSettings.id, 1))
      .returning();
    res.json({ settings: updated });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webinar] admin settings update failed",
    );
    res.status(500).json({ error: "Failed to update settings" });
  }
});

webinarRouter.get("/webinar/admin/sessions", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: webinarSessions.id,
      startsAt: webinarSessions.startsAt,
      status: webinarSessions.status,
      videoDurationSeconds: webinarSessions.videoDurationSeconds,
      registrantCount: sql<number>`(SELECT COUNT(*) FROM ${webinarRegistrants} WHERE ${webinarRegistrants.sessionId} = ${webinarSessions.id})`,
    })
    .from(webinarSessions)
    .orderBy(desc(webinarSessions.startsAt))
    .limit(200);
  res.json({
    sessions: rows.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      registrantCount: Number(r.registrantCount),
    })),
  });
});

webinarRouter.post("/webinar/admin/sessions/generate", requireAdmin, async (_req, res) => {
  const settings = await getWebinarSettings();
  const sessions = await ensureUpcomingSessions(settings);
  res.json({ sessions: sessions.map(publicSession) });
});

webinarRouter.post("/webinar/admin/sessions", requireAdmin, async (req, res) => {
  try {
    const startsAtRaw = (req.body ?? {}).startsAt;
    const startsAt = typeof startsAtRaw === "string" ? new Date(startsAtRaw) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) {
      res.status(400).json({ error: "A valid startsAt ISO datetime is required" });
      return;
    }
    const settings = await getWebinarSettings();
    const [created] = await db
      .insert(webinarSessions)
      .values({
        startsAt,
        status: "scheduled",
        videoDurationSeconds: settings.videoDurationSeconds,
      })
      .onConflictDoNothing({ target: webinarSessions.startsAt })
      .returning();
    if (!created) {
      res.status(409).json({ error: "A session already exists at that time" });
      return;
    }
    res.json({ session: publicSession(created) });
  } catch (err) {
    res.status(500).json({ error: "Failed to create session" });
  }
});

webinarRouter.get("/webinar/admin/registrants", requireAdmin, async (req, res) => {
  const sessionId = Number(req.query.sessionId);
  const where = Number.isInteger(sessionId) && sessionId > 0
    ? eq(webinarRegistrants.sessionId, sessionId)
    : undefined;
  const rows = await db
    .select()
    .from(webinarRegistrants)
    .where(where as any)
    .orderBy(desc(webinarRegistrants.registeredAt))
    .limit(1000);
  res.json({
    registrants: rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      firstName: r.firstName,
      email: r.email,
      phone: r.phone,
      registeredAt: r.registeredAt.toISOString(),
      joinedAt: r.joinedAt?.toISOString() ?? null,
      watchDurationSeconds: r.watchDurationSeconds,
      ctaClicked: r.ctaClicked,
      offer27Paid: r.offer27Paid,
      source: r.source,
    })),
  });
});

// Scripted chat management ---------------------------------------------------

webinarRouter.get("/webinar/admin/chat", requireAdmin, async (req, res) => {
  const sessionId = Number(req.query.sessionId);
  const rows = await db
    .select()
    .from(webinarChatMessages)
    .where(
      Number.isInteger(sessionId) && sessionId > 0
        ? eq(webinarChatMessages.sessionId, sessionId)
        : (sql`${webinarChatMessages.scripted} = true` as any),
    )
    .orderBy(asc(sql`COALESCE(${webinarChatMessages.displayAtSeconds}, 0)`))
    .limit(1000);
  res.json({ messages: rows });
});

webinarRouter.post("/webinar/admin/chat", requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = strOrNull(body.body, 1000);
    if (!text) {
      res.status(400).json({ error: "Message body is required" });
      return;
    }
    const displayAtRaw = Number(body.displayAtSeconds);
    const [created] = await db
      .insert(webinarChatMessages)
      .values({
        sessionId: null,
        role: strOrNull(body.role, 20) || "attendee",
        authorName: strOrNull(body.authorName, 80) || "Guest",
        body: text,
        displayAtSeconds: Number.isFinite(displayAtRaw)
          ? Math.max(0, Math.floor(displayAtRaw))
          : 0,
        scripted: true,
      })
      .returning();
    res.json({ message: created });
  } catch (err) {
    res.status(500).json({ error: "Failed to add chat message" });
  }
});

webinarRouter.delete("/webinar/admin/chat/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(webinarChatMessages).where(eq(webinarChatMessages.id, id));
  res.json({ ok: true });
});

export default webinarRouter;
