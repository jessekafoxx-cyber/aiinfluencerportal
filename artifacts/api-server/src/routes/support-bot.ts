import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  supportBotSessionsTable,
  type SupportBotMessage,
  type SupportBotSessionMetadata,
  type SupportBotSessionRow,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { SYSTEM_PROMPT } from "../support-bot/system-prompt";
import { detectIntent, isFrustrated, extractEmail } from "../support-bot/intent";
import {
  lookupAccountStatus,
  formatAccountStatusForPrompt,
} from "../support-bot/purchase-lookup";
import {
  WIDGET_JS,
  WIDGET_CSS,
  DEMO_HTML,
} from "../support-bot/widget-assets";
import {
  getRefundEligibility,
  issueMainMasterclassRefund,
  formatRefundContextForPrompt,
} from "../support-bot/refund";
import { escalateInfluencerGeneration } from "../support-bot/influencer-escalation";
import {
  searchSupportKnowledge,
  formatSupportKnowledgeForPrompt,
} from "../support-bot/retrieval";
import {
  REFUND_CODE_MAX_ATTEMPTS,
  generateRefundCode,
  hashRefundCode,
  extractSixDigitCode,
  isResendRequest,
  isCodeExpired,
  isResendCoolingDown,
  sendRefundCodeEmail,
} from "../support-bot/refund-verification";
import { submitSupportBugReport } from "../lib/monday";
import { sendEmail } from "../lib/email";
import { checkRateLimit } from "../lib/rate-limit";
import { getBrandBaseUrl } from "../lib/brand-url";

const router: Router = Router();

// The phrase the system prompt instructs the model to use when it wants a
// human to take over. Detecting it is what makes the escalation box appear
// in the widget. (It replaced the old "email <support address>" trigger -
// the bot no longer hands out an email address.)
const ESCALATION_PHRASE = "over to the team";

// Internal destination inbox for escalated transcripts. Never shown to the
// customer - the bot only ever says it is passing the chat "over to the team".
const SUPPORT_INBOX = "hello@room30.ai";

// Customer-facing portal URL used in bot replies.
const PORTAL_URL = `${getBrandBaseUrl()}/members`;
const MAX_STORED_MESSAGES = 60;
const MODEL_HISTORY_MESSAGES = 20;
const ESCALATION_EMAIL_DEDUPE_MS = 10 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FALLBACK_REPLY =
  "Sorry, having a bit of trouble on my end. Try again in a minute, or say the word and I'll pass this over to the team :)";

// The widget renders plain text, so any markdown the model sneaks in
// (**bold**, __bold__, `code`, # headers) shows up as literal
// asterisks/underscores to the customer. Prompt bans it, this
// guarantees it.
function stripMarkdownFormatting(text: string): string {
  return (
    text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      // Single-asterisk emphasis only when the inner text hugs the
      // asterisks (markdown semantics), so "2 * 3 * 4" is untouched.
      .replace(
        /(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s.,!?:;)])/gm,
        "$1$2",
      )
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      // Markdown bullet markers at line start ("* item").
      .replace(/^(\s*)\*\s+/gm, "$1")
  );
}

// The widget is embeddable on any brand property (and the demo
// page), so these endpoints are CORS-open. No auth by design; rate
// limits below keep abuse in check.
router.use("/support-bot", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? "unknown";
}

async function loadOrCreateSession(
  sessionId: string | null,
): Promise<SupportBotSessionRow> {
  if (sessionId && UUID_RE.test(sessionId)) {
    const [existing] = await db
      .select()
      .from(supportBotSessionsTable)
      .where(eq(supportBotSessionsTable.id, sessionId))
      .limit(1);
    if (existing) return existing;
  }
  const id = sessionId && UUID_RE.test(sessionId) ? sessionId : randomUUID();
  const [created] = await db
    .insert(supportBotSessionsTable)
    .values({ id, messages: [], metadata: {} })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(supportBotSessionsTable)
    .where(eq(supportBotSessionsTable.id, id))
    .limit(1);
  if (!row) throw new Error("failed to create support bot session");
  return row;
}

const BUG_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_bug_report",
    description:
      "Submit a bug report to the dev team once you have collected enough detail (what happened, where, and ideally steps to reproduce). Call this once per bug, then confirm to the customer.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short one-line summary of the bug",
        },
        description: {
          type: "string",
          description:
            "What happened vs what the customer expected, including any page or section named",
        },
        steps: {
          type: "string",
          description: "Steps to reproduce, if the customer gave any",
        },
      },
      required: ["title", "description"],
    },
  },
};

const REFUND_TOOL = {
  type: "function" as const,
  function: {
    name: "issue_refund",
    description:
      "Issue the Stripe refund for the $27 main masterclass for the customer email in this conversation. ONLY call this after you have made the save attempt AND the customer has clearly confirmed they still want the refund. NEVER call it for any other product (bumps, upsells, DFY, Platinum, high-ticket are non-refundable).",
    parameters: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description:
            "Must be true. Confirms the customer explicitly said they still want the refund after your save attempt.",
        },
      },
      required: ["confirm"],
    },
  },
};

const INFLUENCER_TOOL = {
  type: "function" as const,
  function: {
    name: "escalate_influencer_generation",
    description:
      "Escalate a stuck AI influencer generation (not delivered after 24 hours) to the team for a high-priority manual build. Only call once you have the customer's full name and their portal account email is already confirmed in this conversation.",
    parameters: {
      type: "object",
      properties: {
        client_name: {
          type: "string",
          description: "The customer's full name, as given by them",
        },
      },
      required: ["client_name"],
    },
  },
};

/**
 * Execute the refund and build the customer-facing reply, mutating the
 * session metadata. Called from two places: the issue_refund tool path
 * (email already verified) and the code-verification short-circuit.
 */
async function runRefundAndBuildReply(
  email: string,
  sessionId: string,
  metadata: SupportBotSessionMetadata,
): Promise<string> {
  const result = await issueMainMasterclassRefund({ email, sessionId });
  switch (result.status) {
    case "refunded": {
      metadata.refundIssuedAt = new Date().toISOString();
      metadata.refundedOrderId = result.orderId;
      const dollars = (result.amountCents / 100).toFixed(2);
      return `Done :) I've put the refund for the $${dollars} masterclass through just now. It goes back to the card you paid with, usually within 5-10 working days depending on your bank. Access to the masterclass will close off with it.\n\nAnything else I can help with?`;
    }
    case "already_refunded":
      metadata.refundIssuedAt = new Date().toISOString();
      return "Looks like that one's already been refunded on our side. Refunds take 5-10 working days to show on your statement. If it's been longer than that, let me send this over to the team and they'll chase it up.";
    case "has_addons":
      return "Your order has add-ons attached so I can't run this one automatically. Let me pass this over to the team and they'll sort the masterclass refund manually, usually within a few hours.";
    case "not_stripe":
      return "This one needs a quick manual check on our side, I can't process it automatically. Let me pass this over to the team and they'll sort it, usually within a few hours.";
    case "no_purchase":
      return `I can't find a masterclass purchase under ${email}. Any chance you used a different email at checkout?`;
    default:
      return "That didn't go through on my end just now, sorry. Let me pass this over to the team and they'll process the refund manually.";
  }
}

function clearRefundVerification(metadata: SupportBotSessionMetadata): void {
  delete metadata.refundVerifyEmail;
  delete metadata.refundVerifyCodeHash;
  delete metadata.refundVerifySentAt;
  delete metadata.refundVerifyAttempts;
  delete metadata.refundEmailVerifiedAt;
  delete metadata.refundConfirmedAt;
}

router.post("/support-bot/chat", async (req: Request, res: Response) => {
  try {
    const rate = checkRateLimit("support-bot-chat", clientIp(req), [
      { windowMs: 60_000, max: 10 },
      { windowMs: 3_600_000, max: 100 },
    ]);
    if (!rate.ok) {
      res.status(429).json({
        error: "Too many messages, give it a minute.",
        retry_after: rate.retryAfterSec,
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000) {
      res.status(400).json({ error: "message is required (max 4000 chars)" });
      return;
    }
    const rawSessionId =
      typeof body.session_id === "string" ? body.session_id : null;
    const pageUrl =
      typeof body.page_url === "string" ? body.page_url.slice(0, 500) : null;

    const session = await loadOrCreateSession(rawSessionId);
    const metadata: SupportBotSessionMetadata = { ...session.metadata };
    const prevIntent = session.metadata.lastIntent;
    if (pageUrl) metadata.pageUrl = pageUrl;

    // Capture any email the customer types, for purchase lookups.
    const foundEmail = extractEmail(message);
    let email = session.email;
    if (foundEmail) email = foundEmail;

    const intent = detectIntent(message, {
      email,
      bugCollecting: metadata.bugCollecting === true,
    });
    metadata.lastIntent = intent;
    const frustrated = isFrustrated(message);

    if (intent === "bug_report") metadata.bugCollecting = true;
    if (intent === "refund_request") metadata.refundContext = true;
    if (intent === "influencer_stuck") metadata.influencerComplaint = true;

    const needsEmailForTopic =
      !email &&
      (intent === "refund_request" || intent === "influencer_stuck");
    if (intent === "needs_email" || needsEmailForTopic) {
      // Canned response per spec: don't burn a model call to ask.
      const reply =
        "Sure, what's the email you used at checkout? I'll take a look.";
      const now = new Date().toISOString();
      const allMessages: SupportBotMessage[] = [
        ...session.messages,
        { role: "user", content: message, at: now },
        { role: "assistant", content: reply, at: now },
      ];
      const messages = allMessages.slice(-MAX_STORED_MESSAGES);
      await db
        .update(supportBotSessionsTable)
        .set({ messages, metadata, email, updatedAt: new Date() })
        .where(eq(supportBotSessionsTable.id, session.id));
      res.json({
        response: reply,
        session_id: session.id,
        needs_email: true,
        escalate: false,
      });
      return;
    }

    // Canned-response helper for the refund verification short-circuits
    // below: persist the turn and reply without a model call.
    const respondCanned = async (reply: string): Promise<void> => {
      const now = new Date().toISOString();
      const allMessages: SupportBotMessage[] = [
        ...session.messages,
        { role: "user", content: message, at: now },
        { role: "assistant", content: reply, at: now },
      ];
      const messages = allMessages.slice(-MAX_STORED_MESSAGES);
      await db
        .update(supportBotSessionsTable)
        .set({ messages, metadata, email, updatedAt: new Date() })
        .where(eq(supportBotSessionsTable.id, session.id));
      res.json({
        response: reply,
        session_id: session.id,
        needs_email: false,
        escalate: false,
      });
    };

    // --- Refund email-ownership verification (anonymous widget) ---
    if (
      metadata.refundVerifyEmail &&
      email &&
      metadata.refundVerifyEmail !== email
    ) {
      // Customer switched email mid-chat: the previous code/verification
      // no longer proves ownership of the new address.
      clearRefundVerification(metadata);
    }

    const awaitingRefundCode =
      !!email &&
      !metadata.refundIssuedAt &&
      !metadata.refundEmailVerifiedAt &&
      typeof metadata.refundVerifyCodeHash === "string" &&
      typeof metadata.refundVerifySentAt === "string";

    // Code sends are limited per TARGET email (primary control - the IP
    // key alone is spoofable via x-forwarded-for) and per IP as
    // defense-in-depth.
    const refundCodeSendAllowed = (targetEmail: string): boolean => {
      const perEmail = checkRateLimit("support-bot-refund-code-email", targetEmail, [
        { windowMs: 3_600_000, max: 5 },
      ]);
      const perIp = checkRateLimit("support-bot-refund-code", clientIp(req), [
        { windowMs: 3_600_000, max: 6 },
      ]);
      return perEmail.ok && perIp.ok;
    };

    if (awaitingRefundCode && email) {
      const pasted = extractSixDigitCode(message);
      if (pasted) {
        if (isCodeExpired(metadata.refundVerifySentAt!)) {
          if (!refundCodeSendAllowed(email)) {
            await respondCanned(
              "I've sent a few codes already so I'll pause there for a bit. If none arrived, let me pass this over to the team and they'll sort the refund manually.",
            );
            return;
          }
          const code = generateRefundCode();
          const sent = await sendRefundCodeEmail(email, code, session.id);
          if (sent) {
            metadata.refundVerifyCodeHash = hashRefundCode(
              session.id,
              email,
              code,
            );
            metadata.refundVerifySentAt = new Date().toISOString();
            metadata.refundVerifyAttempts = 0;
            await respondCanned(
              `That code's expired now, sorry. I've just emailed a fresh one to ${email} - paste it here and I'll process the refund straight away.`,
            );
          } else {
            await respondCanned(
              "I couldn't get a new code out just now, sorry. Let me pass this over to the team and they'll sort the refund manually.",
            );
          }
          return;
        }
        if (
          hashRefundCode(session.id, email, pasted) ===
          metadata.refundVerifyCodeHash
        ) {
          metadata.refundEmailVerifiedAt = new Date().toISOString();
          delete metadata.refundVerifyCodeHash;
          delete metadata.refundVerifySentAt;
          delete metadata.refundVerifyAttempts;
          if (!metadata.refundConfirmedAt) {
            // Codes are only ever sent after a confirmed issue_refund
            // tool call, so this is a belt-and-braces state guard: the
            // email is now verified but we still need explicit intent
            // before money moves (the tool is re-exposed next turn).
            await respondCanned(
              "That's you verified :) Just to double check before I put it through - you're sure you want the refund for the $27 masterclass? Once it's done your access closes off with it.",
            );
            return;
          }
          const reply = await runRefundAndBuildReply(
            email,
            session.id,
            metadata,
          );
          await respondCanned(reply);
          return;
        }
        const attempts = (metadata.refundVerifyAttempts ?? 0) + 1;
        metadata.refundVerifyAttempts = attempts;
        if (attempts >= REFUND_CODE_MAX_ATTEMPTS) {
          clearRefundVerification(metadata);
          await respondCanned(
            "That code doesn't match and that was the last try, sorry. Let me pass this over to the team and they'll sort the refund manually.",
          );
          return;
        }
        const left = REFUND_CODE_MAX_ATTEMPTS - attempts;
        await respondCanned(
          `Hmm, that code doesn't match what I sent to ${email}. Double check the latest email (spam folder too) and paste it again - ${left} ${left === 1 ? "try" : "tries"} left.`,
        );
        return;
      }
      if (isResendRequest(message)) {
        if (isResendCoolingDown(metadata.refundVerifySentAt!)) {
          await respondCanned(
            'Just sent one - give it a minute to land and check your spam folder too. If it\'s still not there in a couple of minutes, say "resend" and I\'ll fire another.',
          );
          return;
        }
        if (!refundCodeSendAllowed(email)) {
          await respondCanned(
            "I've sent a few codes already so I'll pause there for a bit. If none arrived, let me pass this over to the team and they'll sort the refund manually.",
          );
          return;
        }
        const code = generateRefundCode();
        const sent = await sendRefundCodeEmail(email, code, session.id);
        if (sent) {
          metadata.refundVerifyCodeHash = hashRefundCode(
            session.id,
            email,
            code,
          );
          metadata.refundVerifySentAt = new Date().toISOString();
          metadata.refundVerifyAttempts = 0;
          await respondCanned(
            `Done, fresh code on its way to ${email}. Paste the 6 digits here and I'll process the refund straight away.`,
          );
        } else {
          await respondCanned(
            "I couldn't get a new code out just now, sorry. Let me pass this over to the team and they'll sort the refund manually.",
          );
        }
        return;
      }
      // No code and no resend request: fall through to the model - the
      // prompt note below keeps it asking for the code.
    }

    // Build the model conversation. The account lookup unlocks only in a
    // purchase/access context: either the message is a purchase question,
    // or the customer just supplied their email after the bot asked for
    // it. A bare email in an unrelated message never triggers a lookup
    // (limits casual enumeration of other people's purchases). Once
    // unlocked, the live account check is injected on EVERY turn so
    // follow-ups ("doesn't work", "??") get real data instead of the bot
    // re-asking for the email or promising to check later.
    let systemPrompt = SYSTEM_PROMPT;
    // First message of a brand-new conversation: open with a warm thanks
    // plus a "there's a real human team behind me" reassurance, exactly
    // once. AI-only support with no visible human path annoys people.
    if (session.messages.length === 0) {
      systemPrompt +=
        `\n\nFIRST MESSAGE OF THIS CONVERSATION: This is the customer's very first message. Open your reply with a short, warm acknowledgement along these lines (use your own words, keep it natural and brief): "Hey, thanks for your message! Just so you know, there's a real human team behind me - if you ever need them, I'll show you how to reach them. But I can usually sort things for you right here." Then answer their actual question in the same message. Never repeat this reassurance in later replies unless they ask how to reach the team.`;
    }
    // RAG: pull the most relevant masterclass content (lesson notes +
    // video transcripts) for this question so Alana answers with real,
    // specific course material instead of signposting. Fail-open: any
    // error and she answers from the static knowledge base alone.
    // Short follow-ups ("ok but what tool should I use") carry no topic on
    // their own and retrieve noise, so fold the last couple of user turns
    // into the retrieval query to keep the conversation's subject attached.
    try {
      const retrievalQueries = [message];
      if (message.trim().length < 120) {
        const priorUserTurns = session.messages
          .filter((m) => m.role === "user")
          .slice(-2)
          .map((m) => m.content.slice(0, 300));
        if (priorUserTurns.length > 0) {
          retrievalQueries.push(`${priorUserTurns.join("\n")}\n${message}`);
        }
      }
      const hits = await searchSupportKnowledge(retrievalQueries, 8);
      systemPrompt += formatSupportKnowledgeForPrompt(hits);
    } catch (err) {
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-bot] masterclass retrieval failed; answering without it",
      );
    }
    if (
      intent === "purchase_check" ||
      intent === "refund_request" ||
      intent === "influencer_stuck" ||
      (foundEmail !== null && prevIntent === "needs_email")
    ) {
      metadata.purchaseLookupUnlocked = true;
    }
    if (email && metadata.purchaseLookupUnlocked === true) {
      try {
        const status = await lookupAccountStatus(email);
        systemPrompt += formatAccountStatusForPrompt(email, status);
      } catch (err) {
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[support-bot] account lookup failed; answering without it",
        );
      }
    }
    if (email && metadata.refundContext === true) {
      try {
        const eligibility = await getRefundEligibility(email);
        systemPrompt += formatRefundContextForPrompt(
          email,
          eligibility,
          metadata.refundIssuedAt,
        );
      } catch (err) {
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[support-bot] refund eligibility check failed; answering without it",
        );
      }
    }
    if (awaitingRefundCode && email) {
      systemPrompt += `\n\n[INTERNAL - a 6-digit refund confirmation code was emailed to ${email}. Ask the customer to paste the code here in the chat. If they say it hasn't arrived, tell them to check spam or just say "resend". Do NOT call issue_refund again - the refund processes automatically the moment the correct code is pasted.]`;
    }

    const history = session.messages.slice(-MODEL_HISTORY_MESSAGES);
    const chatMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const bugMode = metadata.bugCollecting === true;
    const tools: Array<
      typeof BUG_TOOL | typeof REFUND_TOOL | typeof INFLUENCER_TOOL
    > = [];
    if (bugMode) tools.push(BUG_TOOL);
    if (metadata.refundContext === true && email && !awaitingRefundCode) {
      tools.push(REFUND_TOOL);
    }
    if (metadata.influencerComplaint === true && email) {
      tools.push(INFLUENCER_TOOL);
    }

    let reply = "";
    try {
      const completion = await openai.chat.completions.create(
        {
          model: "gpt-4o",
          messages: chatMessages,
          temperature: 0.7,
          max_tokens: 600,
          ...(tools.length > 0 ? { tools } : {}),
        },
        { timeout: 40_000, maxRetries: 0 },
      );
      const choice = completion.choices[0];
      const toolCalls = (choice?.message?.tool_calls ?? []).filter(
        (t): t is typeof t & { type: "function" } => t.type === "function",
      );

      const refundCall = toolCalls.find(
        (t) => t.function.name === "issue_refund",
      );
      const influencerCall = toolCalls.find(
        (t) => t.function.name === "escalate_influencer_generation",
      );
      const bugCall = toolCalls.find(
        (t) => t.function.name === "submit_bug_report",
      );

      if (refundCall && email) {
        let refundArgs: { confirm?: boolean } = {};
        try {
          refundArgs = JSON.parse(refundCall.function.arguments || "{}");
        } catch {
          // fall through with empty args
        }
        if (refundArgs.confirm !== true) {
          // Enforce the tool contract in code, not just in the prompt:
          // no refund without the model asserting explicit customer
          // confirmation after the save attempt.
          reply =
            "Just to double check before I put it through, you're sure you want the refund for the $27 masterclass? Once it's done your access closes off with it.";
        } else if (metadata.refundIssuedAt) {
          reply =
            "That refund's already been processed on our side. It usually takes 5-10 working days to show back on your card. If it's been longer than that, let me send this over to the team and they'll chase it up.";
        } else if (
          metadata.refundEmailVerifiedAt &&
          metadata.refundVerifyEmail === email
        ) {
          reply = await runRefundAndBuildReply(email, session.id, metadata);
        } else {
          // Anonymous widget: prove ownership of the checkout email
          // before money moves. Only email a code when an eligible
          // order actually exists (never use us as a mail cannon
          // against arbitrary addresses).
          const eligibility = await getRefundEligibility(email);
          if (eligibility.status === "has_addons") {
            reply =
              "Your order has add-ons attached so I can't run this one automatically. Let me pass this over to the team and they'll sort the masterclass refund manually, usually within a few hours.";
          } else if (eligibility.status === "not_stripe") {
            reply =
              "This one needs a quick manual check on our side, I can't process it automatically. Let me pass this over to the team and they'll sort it, usually within a few hours.";
          } else if (eligibility.status === "no_purchase") {
            reply = `I can't find a masterclass purchase under ${email}. Any chance you used a different email at checkout?`;
          } else {
            if (!refundCodeSendAllowed(email)) {
              reply =
                "I've sent a few codes already so I'll pause there for a bit. If none arrived, let me pass this over to the team and they'll sort the refund manually.";
            } else {
              const code = generateRefundCode();
              const sent = await sendRefundCodeEmail(email, code, session.id);
              if (sent) {
                metadata.refundVerifyEmail = email;
                metadata.refundVerifyCodeHash = hashRefundCode(
                  session.id,
                  email,
                  code,
                );
                metadata.refundVerifySentAt = new Date().toISOString();
                metadata.refundVerifyAttempts = 0;
                metadata.refundConfirmedAt = new Date().toISOString();
                reply = `Last step for security: I've just emailed a 6-digit code to ${email}. Paste it here and I'll process the refund straight away. Check spam if you don't see it, or say "resend".`;
              } else {
                reply =
                  "I couldn't send the confirmation code just now, sorry. Let me pass this over to the team and they'll sort the refund manually.";
              }
            }
          }
        }
      } else if (influencerCall && email) {
        let args: { client_name?: string } = {};
        try {
          args = JSON.parse(influencerCall.function.arguments || "{}");
        } catch {
          // fall through with empty args
        }
        const clientName = (args.client_name || "").trim();
        if (metadata.influencerEscalatedAt) {
          reply =
            "Already flagged this one to the team as high priority, they're on it. The full image set gets pushed straight to your portal account, so keep an eye on it.";
        } else if (!clientName) {
          reply =
            "Quick one before I flag it, what's your full name? Just so the team match it to your account properly.";
        } else {
          const result = await escalateInfluencerGeneration({
            clientName,
            email,
            sessionId: session.id,
          });
          switch (result.status) {
            case "escalated":
              metadata.influencerEscalatedAt = new Date().toISOString();
              reply =
                "Sorted. I've just flagged your generation to the team as a high priority manual build. The full image set will be pushed straight to your portal account, so keep an eye on it today.\n\nAnything else while you're here?";
              break;
            case "no_account":
              reply = `Hmm, ${email} doesn't match a portal account on our side, and the manual build gets pushed to the portal account directly. What's the exact email you log in with at ${PORTAL_URL}?`;
              break;
            default:
              reply =
                "I couldn't get that through to the team just now, sorry. Let me pass this over to the team with your full name and portal email so they can run the manual generation for you.";
          }
        }
      } else if (bugMode && bugCall) {
        let args: {
          title?: string;
          description?: string;
          steps?: string;
        } = {};
        try {
          args = JSON.parse(bugCall.function.arguments || "{}");
        } catch {
          // fall through with empty args
        }
        const submitted = await submitSupportBugReport({
          title: args.title || "Bug report from support bot",
          description: args.description || message,
          steps: args.steps || null,
          email,
          pageUrl: metadata.pageUrl || null,
        });
        metadata.bugCollecting = false;
        if (submitted) {
          metadata.bugSubmittedAt = new Date().toISOString();
        }
        reply =
          "Got it, logged that as a bug. Dev team will look into it. Thanks for flagging.\n\nAnything else I can help with?";
      }
      if (!reply) {
        reply = stripMarkdownFormatting(
          choice?.message?.content?.trim() || FALLBACK_REPLY,
        );
      }
    } catch (err) {
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[support-bot] openai chat call failed",
      );
      reply = FALLBACK_REPLY;
    }

    const escalate =
      intent === "escalation" ||
      frustrated ||
      reply.toLowerCase().includes(ESCALATION_PHRASE);
    if (escalate && !metadata.escalationOfferedAt) {
      metadata.escalationOfferedAt = new Date().toISOString();
    }

    const now = new Date().toISOString();
    const allMessages: SupportBotMessage[] = [
      ...session.messages,
      { role: "user", content: message, at: now },
      { role: "assistant", content: reply, at: now },
    ];
    const messages = allMessages.slice(-MAX_STORED_MESSAGES);

    await db
      .update(supportBotSessionsTable)
      .set({ messages, metadata, email, updatedAt: new Date() })
      .where(eq(supportBotSessionsTable.id, session.id));

    res.json({
      response: reply,
      session_id: session.id,
      needs_email: false,
      escalate,
    });
  } catch (err) {
    req.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[support-bot] chat endpoint failed",
    );
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/support-bot/escalate", async (req: Request, res: Response) => {
  try {
    const rate = checkRateLimit("support-bot-escalate", clientIp(req), [
      { windowMs: 60_000, max: 3 },
      { windowMs: 3_600_000, max: 10 },
    ]);
    if (!rate.ok) {
      res.status(429).json({
        error: "Too many requests, give it a minute.",
        retry_after: rate.retryAfterSec,
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId =
      typeof body.session_id === "string" ? body.session_id : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!sessionId || !UUID_RE.test(sessionId)) {
      res.status(400).json({ error: "valid session_id is required" });
      return;
    }
    if (!email || !extractEmail(email)) {
      res.status(400).json({ error: "valid email is required" });
      return;
    }

    const [session] = await db
      .select()
      .from(supportBotSessionsTable)
      .where(eq(supportBotSessionsTable.id, sessionId))
      .limit(1);
    if (!session || session.messages.length === 0) {
      res.status(404).json({ error: "session not found" });
      return;
    }

    // Dedupe: atomically claim the send slot before emailing so
    // concurrent double-clicks can't both send. The conditional UPDATE
    // only succeeds when no send happened within the dedupe window.
    const claimedAt = new Date().toISOString();
    const cutoffIso = new Date(
      Date.now() - ESCALATION_EMAIL_DEDUPE_MS,
    ).toISOString();
    const claimed = await db
      .update(supportBotSessionsTable)
      .set({
        metadata: sql`${supportBotSessionsTable.metadata} || jsonb_build_object('escalatedEmailSentAt', ${claimedAt}::text)`,
        updatedAt: new Date(),
      })
      .where(
        sql`${supportBotSessionsTable.id} = ${sessionId} AND (
          ${supportBotSessionsTable.metadata} ->> 'escalatedEmailSentAt' IS NULL
          OR ${supportBotSessionsTable.metadata} ->> 'escalatedEmailSentAt' < ${cutoffIso}
        )`,
      )
      .returning({ id: supportBotSessionsTable.id });
    if (claimed.length === 0) {
      res.json({ success: true, already_sent: true });
      return;
    }

    const transcript = session.messages
      .map((m) => {
        const who = m.role === "user" ? "Customer" : "Bot";
        return `${who}: ${m.content}`;
      })
      .join("\n\n");

    const pageUrl = session.metadata.pageUrl || "unknown";
    const result = await sendEmail({
      email: SUPPORT_INBOX,
      replyTo: email,
      subject: `Support bot escalation from ${email}`,
      body:
        `A customer asked for a human in the support bot chat.\n\n` +
        `Customer email: ${email}\n` +
        `Page: ${pageUrl}\n` +
        `Session: ${session.id}\n\n` +
        `--- Transcript ---\n\n${transcript}`,
      templateType: "support_bot_escalation",
      metadata: { sessionId: session.id, customerEmail: email },
    });

    if (result.status !== "sent") {
      // Release the claim so the customer can retry.
      await db
        .update(supportBotSessionsTable)
        .set({
          metadata: sql`${supportBotSessionsTable.metadata} - 'escalatedEmailSentAt'`,
          updatedAt: new Date(),
        })
        .where(eq(supportBotSessionsTable.id, session.id));
      res.status(502).json({ success: false, error: "email send failed" });
      return;
    }

    if (!session.email) {
      await db
        .update(supportBotSessionsTable)
        .set({ email, updatedAt: new Date() })
        .where(eq(supportBotSessionsTable.id, session.id));
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[support-bot] escalate endpoint failed",
    );
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});

router.get("/support-bot/widget.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(WIDGET_JS);
});

router.get("/support-bot/widget.css", (_req, res) => {
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(WIDGET_CSS);
});

router.get("/support-bot/demo", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DEMO_HTML);
});

export default router;
