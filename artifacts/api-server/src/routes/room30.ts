import { Router } from "express";
import type { Request, Response } from "express";
import {
  db,
  room30NotifySignupsTable,
  room30ContactSubmissionsTable,
} from "@workspace/db";
import { sendEmail } from "../lib/email";
import { checkRateLimit } from "../lib/rate-limit";

const room30Router = Router();

// Per-IP rate limits for the public contact form. Generous enough not to
// hurt real visitors, tight enough to stop a scripted flood.
const CONTACT_RATE_LIMITS = [
  { windowMs: 60_000, max: 5 },
  { windowMs: 60 * 60_000, max: 20 },
];

// Where new-signup notifications get delivered. Override with
// ROOM30_NOTIFY_ADMIN_EMAIL if you want to point it elsewhere later.
const ADMIN_NOTIFY_EMAIL =
  process.env.ROOM30_NOTIFY_ADMIN_EMAIL?.trim() || "greg@cookemedia.io";

// Where contact-form submissions get delivered. Defaults to the public
// hello@ inbox so the team always receives them; override with
// ROOM30_CONTACT_INBOX_EMAIL if you want to route them elsewhere.
const CONTACT_INBOX_EMAIL =
  process.env.ROOM30_CONTACT_INBOX_EMAIL?.trim() || "hello@room30.ai";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_SOURCE_LEN = 64;
const MAX_NAME_LEN = 200;
const MAX_MESSAGE_LEN = 5000;

function getClientIp(req: Request): string | null {
  // Prefer Express's req.ip - it honors the app's `trust proxy` setting
  // and gives us the real client IP when we're behind the Replit shared
  // proxy, while ignoring spoofed x-forwarded-for headers from clients
  // connecting directly to the artifact port. Fall back to the raw
  // socket address only if Express somehow could not resolve it.
  const ip = req.ip;
  if (typeof ip === "string" && ip.length > 0) return ip;
  return req.socket.remoteAddress ?? null;
}

room30Router.post("/room30/notify", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { email?: unknown; source?: unknown };

  const rawEmail = typeof body.email === "string" ? body.email : "";
  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return res
      .status(400)
      .json({ ok: false, error: "Enter a valid email address." });
  }

  const rawSource = typeof body.source === "string" ? body.source.trim() : "";
  const source =
    rawSource.length > 0 && rawSource.length <= MAX_SOURCE_LEN
      ? rawSource
      : "room30-coming-soon";

  const ua = (req.headers["user-agent"] as string | undefined) ?? null;
  const ip = getClientIp(req);

  try {
    const inserted = await db
      .insert(room30NotifySignupsTable)
      .values({
        email,
        source,
        clientIpAddress: ip,
        clientUserAgent: ua,
      })
      .onConflictDoNothing({ target: room30NotifySignupsTable.email })
      .returning({ id: room30NotifySignupsTable.id });

    const isNewRow = inserted.length > 0;
    req.log.info(
      { email, source, isNewRow },
      "room30 notify signup recorded",
    );

    // Fire-and-forget admin notification. We only email on genuinely new
    // rows so repeat submits from the same address do not spam the inbox.
    // Failures are logged but never break the visitor's signup.
    if (isNewRow) {
      void notifyAdminOfSignup({
        email,
        source,
        ip,
        ua,
        createdAt: new Date(),
      }).catch((err) => {
        req.log.error(
          { err, email },
          "failed to send room30 admin notification email",
        );
      });
    }

    res.json({ ok: true }); return;
  } catch (err) {
    req.log.error({ err }, "failed to record room30 notify signup");
    return res
      .status(500)
      .json({ ok: false, error: "Could not save your email. Please try again." });
  }
});

room30Router.post("/room30/contact", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    message?: unknown;
    // Honeypot: a hidden field real users will never fill in. Bots that
    // auto-fill every input will populate it and get silently rejected.
    company?: unknown;
    // Optional signal from the client - how long the form was on screen
    // before submission. Sub-second submissions are almost certainly bots.
    elapsedMs?: unknown;
  };

  const ip = getClientIp(req);
  const rateKey = ip || "unknown";

  const limit = checkRateLimit("room30-contact", rateKey, CONTACT_RATE_LIMITS);
  if (!limit.ok) {
    req.log.warn(
      { ip, retryAfterSec: limit.retryAfterSec, window: limit.window },
      "room30 contact form rate-limited",
    );
    res.setHeader("Retry-After", String(limit.retryAfterSec));
    res.status(429).json({
      ok: false,
      error:
        "You are sending messages a little too quickly. Please wait a moment and try again.",
    }); return;
  }

  // Honeypot trip - log it, but pretend everything is fine so bots cannot
  // tell the field is being checked.
  const honeypot =
    typeof body.company === "string" ? body.company.trim() : "";
  if (honeypot.length > 0) {
    req.log.warn(
      { ip, honeypotLen: honeypot.length },
      "room30 contact form honeypot tripped - dropping submission",
    );
    res.json({ ok: true }); return;
  }

  // Suspiciously fast submissions (likely scripted) - silently drop.
  const elapsedMs =
    typeof body.elapsedMs === "number" && Number.isFinite(body.elapsedMs)
      ? body.elapsedMs
      : null;
  if (elapsedMs !== null && elapsedMs >= 0 && elapsedMs < 1500) {
    req.log.warn(
      { ip, elapsedMs },
      "room30 contact form submitted too fast - dropping submission",
    );
    res.json({ ok: true }); return;
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const rawEmail = typeof body.email === "string" ? body.email : "";
  const email = rawEmail.trim().toLowerCase();
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";

  if (!rawName || rawName.length > MAX_NAME_LEN) {
    return res
      .status(400)
      .json({ ok: false, error: "Please enter your name." });
  }
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return res
      .status(400)
      .json({ ok: false, error: "Enter a valid email address." });
  }
  if (!rawMessage || rawMessage.length > MAX_MESSAGE_LEN) {
    return res
      .status(400)
      .json({ ok: false, error: "Please include a message." });
  }

  const ua = (req.headers["user-agent"] as string | undefined) ?? null;
  const submittedAt = new Date();
  const when =
    submittedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  req.log.info(
    { name: rawName, email, ip, messageLength: rawMessage.length },
    "room30 contact form submission received",
  );

  // Persist the submission first so support can browse it in the admin UI
  // even if email delivery later fails. We do not let a DB write failure
  // block the email send though - the visitor's message is still the
  // priority, so we log and continue.
  try {
    await db.insert(room30ContactSubmissionsTable).values({
      name: rawName,
      email,
      message: rawMessage,
      clientIpAddress: ip,
      clientUserAgent: ua,
      createdAt: submittedAt,
    });
  } catch (err) {
    req.log.error(
      { err, email },
      "failed to persist room30 contact submission row",
    );
  }

  const subject = `AI Influencer Portfolio contact form: ${rawName}`;
  const textBody = [
    "A new message just came in via the room30.ai contact form.",
    "",
    `Name: ${rawName}`,
    `Email: ${email}`,
    `IP: ${ip || "unknown"}`,
    `User agent: ${ua || "unknown"}`,
    `Submitted: ${when}`,
    "",
    "Message:",
    rawMessage,
    "",
    `Reply directly to this email to respond to ${rawName}.`,
  ].join("\n");

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const htmlBody = [
    `<p>A new message just came in via the <strong>room30.ai</strong> contact form.</p>`,
    `<p style="margin:18px 0 6px;"><strong>Name:</strong> ${escape(rawName)}<br />`,
    `<strong>Email:</strong> <a href="mailto:${escape(email)}">${escape(email)}</a><br />`,
    `<strong>IP:</strong> ${escape(ip || "unknown")}<br />`,
    `<strong>User agent:</strong> ${escape(ua || "unknown")}<br />`,
    `<strong>Submitted:</strong> ${escape(when)}</p>`,
    `<p style="margin:18px 0 6px;"><strong>Message:</strong></p>`,
    `<div style="white-space:pre-wrap;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 16px;">${escape(rawMessage).replace(/\r?\n/g, "<br />")}</div>`,
    `<p style="margin-top:18px;font-size:13px;color:rgba(255,255,255,0.55);">Reply directly to this email to respond to ${escape(rawName)}.</p>`,
  ].join("");

  try {
    const result = await sendEmail({
      email: CONTACT_INBOX_EMAIL,
      subject,
      body: textBody,
      bodyHtml: htmlBody,
      templateType: "room30_contact_form",
      metadata: {
        senderName: rawName,
        senderEmail: email,
        ip: ip || "unknown",
        source: "room30-site/contact",
      },
      replyTo: email,
    });

    if (result.status === "failed") {
      req.log.error(
        { err: result.error, email },
        "failed to deliver room30 contact form email",
      );
      res.status(502).json({
        ok: false,
        error:
          "We could not deliver your message right now. Please try again in a moment.",
      }); return;
    }

    res.json({ ok: true }); return;
  } catch (err) {
    req.log.error({ err, email }, "unexpected error sending contact email");
    res.status(500).json({
      ok: false,
      error:
        "Something went wrong on our end. Please try again in a moment.",
    }); return;
  }
});

async function notifyAdminOfSignup(params: {
  email: string;
  source: string;
  ip: string | null;
  ua: string | null;
  createdAt: Date;
}): Promise<void> {
  const { email, source, ip, ua, createdAt } = params;
  const when = createdAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const ipLine = ip || "unknown";
  const uaLine = ua || "unknown";

  const subject = `New AI Influencer Portfolio signup: ${email}`;
  const body = [
    "A new visitor just signed up on the room30.ai notify-me page.",
    "",
    `Email: ${email}`,
    `Source: ${source}`,
    `IP: ${ipLine}`,
    `User agent: ${uaLine}`,
    `Submitted: ${when}`,
    "",
    "View the full list in the AI Influencer Portfolio admin under Signups.",
  ].join("\n");

  await sendEmail({
    email: ADMIN_NOTIFY_EMAIL,
    subject,
    body,
    templateType: "room30_notify_admin_alert",
    metadata: { signupEmail: email, source, ip: ipLine },
    replyTo: email,
  });
}

export default room30Router;
