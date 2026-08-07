import { Router } from "express";
import type { Request, Response } from "express";
import { db, contentArmySignupsTable } from "@workspace/db";
import { sendEmail } from "../lib/email";
import { checkRateLimit } from "../lib/rate-limit";
import { upsertGhlContact, ghlConfigured } from "../lib/ghl-sync";
import { requireSuperAdmin } from "../middlewares/requireAuth";

const contentArmyRouter = Router();

// GHL tag applied to every Content Army waitlist signup. GHL's contact
// upsert creates the contact when new and merges this tag onto an existing
// contact, so a single upsert call satisfies "create + tag, or just add the
// tag if the contact already exists".
const CONTENT_ARMY_WAITLIST_TAG = "content-army-waiting-list";

// Per-IP rate limits for the public waitlist form. Generous enough not to
// hurt real visitors, tight enough to stop a scripted flood.
const RATE_LIMITS = [
  { windowMs: 60_000, max: 5 },
  { windowMs: 60 * 60_000, max: 20 },
];

// Where new-signup notifications get delivered. Falls back to the shared
// Room30 admin alias, then to Greg's inbox.
const ADMIN_NOTIFY_EMAIL =
  process.env.CONTENT_ARMY_NOTIFY_ADMIN_EMAIL?.trim() ||
  process.env.ROOM30_NOTIFY_ADMIN_EMAIL?.trim() ||
  "greg@cookemedia.io";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_NAME_LEN = 200;
const MAX_PHONE_LEN = 40;
const MAX_SOURCE_LEN = 64;

function getClientIp(req: Request): string | null {
  const ip = req.ip;
  if (typeof ip === "string" && ip.length > 0) return ip;
  return req.socket.remoteAddress ?? null;
}

contentArmyRouter.post(
  "/contentarmy/notify",
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      firstName?: unknown;
      email?: unknown;
      phone?: unknown;
      source?: unknown;
      // Honeypot: a hidden field real users never fill in.
      company?: unknown;
    };

    const ip = getClientIp(req);
    const rateKey = ip || "unknown";
    const limit = checkRateLimit("content-army-notify", rateKey, RATE_LIMITS);
    if (!limit.ok) {
      req.log.warn(
        { ip, retryAfterSec: limit.retryAfterSec, window: limit.window },
        "content army signup rate-limited",
      );
      res.setHeader("Retry-After", String(limit.retryAfterSec));
      res.status(429).json({
        ok: false,
        error:
          "You are sending requests a little too quickly. Please wait a moment and try again.",
      });
      return;
    }

    // Honeypot trip - log it, but pretend everything is fine so bots cannot
    // tell the field is being checked.
    const honeypot =
      typeof body.company === "string" ? body.company.trim() : "";
    if (honeypot.length > 0) {
      req.log.warn({ ip }, "content army honeypot tripped - dropping signup");
      res.json({ ok: true });
      return;
    }

    const firstName =
      typeof body.firstName === "string" ? body.firstName.trim() : "";
    const rawEmail = typeof body.email === "string" ? body.email : "";
    const email = rawEmail.trim().toLowerCase();
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!firstName || firstName.length > MAX_NAME_LEN) {
      res.status(400).json({ ok: false, error: "Please enter your first name." });
      return;
    }
    if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
      res.status(400).json({ ok: false, error: "Enter a valid email address." });
      return;
    }
    // Require at least a few digits so an empty / junk phone is rejected,
    // while staying permissive about formatting and country codes.
    const phoneDigits = phone.replace(/[^0-9]/g, "");
    if (!phone || phone.length > MAX_PHONE_LEN || phoneDigits.length < 6) {
      res.status(400).json({ ok: false, error: "Enter a valid phone number." });
      return;
    }

    const rawSource = typeof body.source === "string" ? body.source.trim() : "";
    const source =
      rawSource.length > 0 && rawSource.length <= MAX_SOURCE_LEN
        ? rawSource
        : "contentarmy-coming-soon";

    const ua = (req.headers["user-agent"] as string | undefined) ?? null;

    try {
      const inserted = await db
        .insert(contentArmySignupsTable)
        .values({
          firstName,
          email,
          phone,
          source,
          clientIpAddress: ip,
          clientUserAgent: ua,
        })
        .onConflictDoNothing({ target: contentArmySignupsTable.email })
        .returning({ id: contentArmySignupsTable.id });

      const isNewRow = inserted.length > 0;
      req.log.info(
        { email, source, isNewRow },
        "content army signup recorded",
      );

      // Mirror the signup into GoHighLevel: upsert the contact and add the
      // waitlist tag. Runs on every valid submit (not just new rows) so a
      // repeat submitter still gets the tag ensured. Fire-and-forget - the
      // helper swallows its own errors and never blocks the visitor.
      void upsertGhlContact({
        email,
        firstName,
        phone,
        source: `contentarmy:${source}`,
        tags: [CONTENT_ARMY_WAITLIST_TAG],
      }).catch((err) => {
        req.log.error(
          { err, email },
          "failed to mirror content army signup to GHL",
        );
      });

      // Fire-and-forget admin notification on genuinely new rows only so
      // repeat submits do not spam the inbox. Never blocks the visitor.
      if (isNewRow) {
        void notifyAdminOfSignup({
          firstName,
          email,
          phone,
          source,
          ip,
          ua,
          createdAt: new Date(),
        }).catch((err) => {
          req.log.error(
            { err, email },
            "failed to send content army admin notification email",
          );
        });
      }

      res.json({ ok: true });
      return;
    } catch (err) {
      req.log.error({ err }, "failed to record content army signup");
      res.status(500).json({
        ok: false,
        error: "Could not save your details. Please try again.",
      });
      return;
    }
  },
);

async function notifyAdminOfSignup(params: {
  firstName: string;
  email: string;
  phone: string;
  source: string;
  ip: string | null;
  ua: string | null;
  createdAt: Date;
}): Promise<void> {
  const { firstName, email, phone, source, ip, ua, createdAt } = params;
  const when = createdAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const ipLine = ip || "unknown";
  const uaLine = ua || "unknown";

  const subject = `New Content Army Masterclass signup: ${firstName}`;
  const body = [
    "A new visitor just joined the Content Army Masterclass waitlist.",
    "",
    `First name: ${firstName}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Source: ${source}`,
    `IP: ${ipLine}`,
    `User agent: ${uaLine}`,
    `Submitted: ${when}`,
  ].join("\n");

  await sendEmail({
    email: ADMIN_NOTIFY_EMAIL,
    subject,
    body,
    templateType: "content_army_notify_admin_alert",
    metadata: { signupEmail: email, signupPhone: phone, source, ip: ipLine },
    replyTo: email,
  });
}

// Throttle between GHL upserts so a large backfill never bursts past GHL's
// rate limits. The waitlist is low-volume, so a small per-row delay is fine.
const BACKFILL_THROTTLE_MS = 120;

// Admin-only backfill: push every Content Army waitlist signup into GHL,
// creating the contact when new and adding the `content-army-waiting-list`
// tag (the upsert merges the tag onto existing contacts). Idempotent and
// safe to re-run - re-tagging a contact is a no-op. Super-admin gated.
contentArmyRouter.post(
  "/contentarmy/admin/backfill-ghl",
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    if (!ghlConfigured()) {
      res.status(503).json({
        ok: false,
        error: "GHL is not configured (GHL_API_KEY / GHL_LOCATION_ID unset).",
      });
      return;
    }

    let rows: Array<{
      id: number;
      email: string;
      firstName: string | null;
      phone: string | null;
      source: string | null;
    }>;
    try {
      rows = await db
        .select({
          id: contentArmySignupsTable.id,
          email: contentArmySignupsTable.email,
          firstName: contentArmySignupsTable.firstName,
          phone: contentArmySignupsTable.phone,
          source: contentArmySignupsTable.source,
        })
        .from(contentArmySignupsTable)
        .orderBy(contentArmySignupsTable.id);
    } catch (err) {
      req.log.error({ err }, "content army GHL backfill: select failed");
      res.status(500).json({ ok: false, error: "Could not load signups." });
      return;
    }

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ email: string; reason: string }> = [];

    for (const row of rows) {
      try {
        const contactId = await upsertGhlContact({
          email: row.email,
          firstName: row.firstName,
          phone: row.phone,
          source: row.source
            ? `contentarmy:${row.source}`
            : "contentarmy-backfill",
          tags: [CONTENT_ARMY_WAITLIST_TAG],
        });
        if (contactId) {
          succeeded += 1;
        } else {
          failed += 1;
          errors.push({
            email: row.email,
            reason: "upsert returned no contact id",
          });
        }
      } catch (err: any) {
        failed += 1;
        errors.push({ email: row.email, reason: err?.message || String(err) });
      }
      await new Promise((r) => setTimeout(r, BACKFILL_THROTTLE_MS));
    }

    req.log.info(
      { total: rows.length, succeeded, failed },
      "content army GHL backfill complete",
    );

    res.json({
      ok: true,
      total: rows.length,
      succeeded,
      failed,
      // Cap the echoed errors so the response stays small on large lists.
      errors: errors.slice(0, 50),
    });
  },
);

export default contentArmyRouter;
