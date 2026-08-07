import type { RequestHandler, Router } from "express";
import {
  db,
  workshopRecordingsTable,
  ordersTable,
  portalUsersTable,
} from "@workspace/db";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import OpenAI from "openai";
import { sendEmail } from "../../lib/email";
import { getBrandBaseUrl } from "../../lib/brand-url";
import { isWistiaMediaReachable } from "../../lib/wistia";
import { postOpsSlackAlert } from "../../lib/ops-slack";
import { computePurchaseEntitlements } from "../portal.js";

// Task #774: throttle member-facing recording load-failure alerts so a
// transient DB blip during a busy hour can't spam #ops. One alert per
// 10-minute window; the underlying error is still logged on every hit.
let lastRecordingLoadAlertAt = 0;
function alertRecordingLoadFailure(scope: string, message: string): void {
  const now = Date.now();
  if (now - lastRecordingLoadAlertAt < 10 * 60 * 1000) return;
  lastRecordingLoadAlertAt = now;
  void postOpsSlackAlert({
    source: "workshop-recordings",
    text: `:warning: Platinum members could not load workshop recordings (${scope}): ${message}`,
    context: { scope, message },
  });
}

export interface WorkshopRecordingsDeps {
  requireAuth: RequestHandler;
  requireActive: RequestHandler;
  requireAdmin: RequestHandler;
}

type KeyMention = { name: string; context?: string };
type LinkRef = { url: string; label?: string; context?: string };
type ActionPoint = { text: string };

// The admin form now sends a bare media id (extracted client-side from a
// pasted Wistia embed), but stay tolerant of a full embed snippet arriving
// from an older client or a direct API caller by extracting the id here too.
function extractWistiaMediaId(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const patterns = [
    /media-id=["']([a-z0-9]+)["']/i,
    /\/medias\/([a-z0-9]+)/i,
    /\/embed\/([a-z0-9]+)\.js/i,
    /wistia_async_([a-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  if (/^[a-z0-9]{6,}$/i.test(raw)) return raw;
  return "";
}

// --------------------------------------------------------------------
// VTT helpers
// --------------------------------------------------------------------

// Strip WEBVTT header, cue numbers, timestamp arrows, and alignment cues,
// returning a clean speaker-tagged transcript. Consecutive cues from the
// same speaker are merged into a single line so the AI prompt stays
// cheap and readable.
export function vttToPlainTranscript(vtt: string): string {
  if (!vtt) return "";
  const raw = vtt.replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const out: { speaker: string | null; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (line.startsWith("NOTE")) continue;
    if (/^\d+$/.test(line)) continue;
    if (/-->/.test(line)) continue;
    // Strip inline VTT styling like <v Speaker> or <c.classname>
    const stripped = line
      .replace(/<v\s+([^>]+)>/g, "$1: ")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .trim();
    if (!stripped) continue;
    const speakerMatch = stripped.match(/^([^:]{1,80}):\s*(.*)$/);
    let speaker: string | null = null;
    let text = stripped;
    if (speakerMatch && speakerMatch[1] && !/https?:/i.test(speakerMatch[1])) {
      speaker = speakerMatch[1].trim();
      text = speakerMatch[2].trim();
    }
    const prev = out[out.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${text}`.trim();
    } else {
      out.push({ speaker, text });
    }
  }
  return out
    .map((p) => (p.speaker ? `${p.speaker}: ${p.text}` : p.text))
    .join("\n");
}

// Detect URLs the AI may miss inside the raw transcript so the
// "Key links / mentions" tab is always complete. The AI gets the
// plain transcript and is asked for context; this is the safety net
// for raw URLs that show up verbatim.
function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const urls = new Set<string>();
  const re = /\bhttps?:\/\/[^\s)\]<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const trimmed = m[0].replace(/[.,;:!?]+$/, "");
    urls.add(trimmed);
  }
  return Array.from(urls);
}

function scrubDashes(s: string): string {
  return s.replace(/\u2014/g, " - ").replace(/\u2013/g, " - ");
}

// --------------------------------------------------------------------
// Summary HTML allowlist sanitizer
// --------------------------------------------------------------------
// The "summary" field is the only place we accept HTML (AI-generated or
// admin-edited) and render it via dangerouslySetInnerHTML in the member
// UI. Allowlist only the tags our prompt is supposed to produce and
// hard-strip everything else - including <script>, on* event handlers,
// javascript:/data: URLs, and dangerous tags like <iframe>, <object>,
// <style>, <link>. Anything not on the allowlist is dropped along with
// its tag wrapper (text content is preserved).
const SUMMARY_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "code",
  "pre",
]);
const SUMMARY_ALLOWED_ATTRS_PER_TAG: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
};

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return false;
  // Block javascript:, data:, vbscript:, file: etc. Allow http(s), mailto,
  // and protocol-relative/relative paths.
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return false;
  return true;
}

export function sanitizeSummaryHtml(input: string): string {
  if (!input) return "";
  let html = input;

  // 1) Strip <script>, <style>, <iframe>, <object>, <embed>, <link>, <meta>
  //    blocks with their contents.
  html = html.replace(
    /<(script|style|iframe|object|embed|link|meta|svg|math|template|form|input|button|textarea|select|option)\b[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  // Self-closing variants of the same dangerous tags.
  html = html.replace(
    /<(script|style|iframe|object|embed|link|meta|svg|math|template|form|input|button|textarea|select|option)\b[^>]*\/?>(?!<\/)/gi,
    "",
  );
  // 2) Strip HTML comments (could carry IE conditional payloads).
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  // 3) Walk every remaining tag and decide: keep, rewrite, or drop.
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_full, tagRaw: string, attrsRaw: string) => {
      const tag = tagRaw.toLowerCase();
      if (!SUMMARY_ALLOWED_TAGS.has(tag)) return "";
      const isClose = /^<\//.test(_full);
      if (isClose) return `</${tag}>`;

      const allowedAttrs = SUMMARY_ALLOWED_ATTRS_PER_TAG[tag] ?? null;
      if (!allowedAttrs || allowedAttrs.size === 0) {
        return `<${tag}>`;
      }

      const keptAttrs: string[] = [];
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrsRaw)) !== null) {
        const name = m[1].toLowerCase();
        const value = m[2] ?? m[3] ?? m[4] ?? "";
        if (!allowedAttrs.has(name)) continue;
        if (/^on/i.test(name)) continue;
        if (name === "href" && !isSafeUrl(value)) continue;
        // Escape quotes inside attribute value.
        const safeValue = value.replace(/"/g, "&quot;").replace(/</g, "&lt;");
        keptAttrs.push(`${name}="${safeValue}"`);
      }

      // Auto-add rel="noopener noreferrer" + target="_blank" to anchors
      // so members opening links don't leak referrers or expose
      // window.opener back to the workshop notes context.
      if (tag === "a") {
        if (!keptAttrs.some((a) => a.startsWith("href="))) return "";
        keptAttrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }

      return `<${tag}${keptAttrs.length ? " " + keptAttrs.join(" ") : ""}>`;
    },
  );
}

// --------------------------------------------------------------------
// AI generation
// --------------------------------------------------------------------

type GeneratedNotes = {
  summary: string;
  keyMentions: KeyMention[];
  links: LinkRef[];
  actionPoints: ActionPoint[];
};

async function generateNotesFromTranscript(
  transcriptVtt: string,
  title: string,
): Promise<GeneratedNotes> {
  const transcript = vttToPlainTranscript(transcriptVtt);
  if (!transcript.trim()) {
    throw new Error("Transcript is empty");
  }

  // GPT context budget: trim very long transcripts to ~80k chars so we
  // stay well inside gpt-4o's 128k token window even after the prompt.
  const MAX_CHARS = 80_000;
  const trimmed =
    transcript.length > MAX_CHARS
      ? transcript.slice(0, MAX_CHARS) + "\n\n[... transcript truncated ...]"
      : transcript;

  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });

  const systemPrompt = `You produce structured workshop notes for a private members portal.
The workshop is a live coaching call inside the "Platinum Club" - members watch the recording later and want a fast briefing.

You will be given the raw transcript of the call. Produce ONE JSON object with this exact schema:
{
  "summary": string,            // HTML. 4-8 short paragraphs. Use <p>, <strong>, <em>, <ul>, <ol>, <li>. NO h1/h2/h3 headings, NO markdown, NO code blocks. Cover what was actually taught - frameworks, examples, decisions, breakthroughs - in plain language a member can skim in 60 seconds.
  "keyMentions": [{"name": string, "context": string}],  // People, brands, tools, books, courses, ad accounts, offers, funnels, frameworks the host names by name. context = one short sentence on why it came up.
  "links": [{"url": string, "label": string, "context": string}], // Every URL mentioned (paste full https://...). label = readable name. context = what it is. Include obvious ones even if the speaker only said the domain (e.g. "stripe.com" -> add https://).
  "actionPoints": [{"text": string}]   // Concrete things a member should DO after watching. 3-8 entries. Each text is one tight sentence, imperative voice ("Audit your...", "Add a...", "Test..."). No fluff.
}

CRITICAL RULES:
- Output STRICT JSON only. No markdown fences, no commentary, no preamble.
- NEVER use em dashes (\u2014) or en dashes (\u2013). Use a regular hyphen with spaces ( - ) instead.
- summary is HTML, not markdown. Use <strong>, never **bold**.
- If a category genuinely has nothing in the call, return an empty array - do not invent.
- Do not include the speaker pleasantries / "how are you" / mic-check chatter from the open of the call.
- Personal first names of attendees (Lisa, CJ, Marshall, Jay, etc.) are NOT key mentions - those are participants. Only include named brands, tools, people-with-authority, books, frameworks.`;

  const userPrompt = `Workshop title: ${title || "(untitled)"}

Transcript follows. Produce the JSON.

---
${trimmed}
---`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned non-JSON; please try again");
  }

  const summary = sanitizeSummaryHtml(
    scrubDashes(
      typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
    ),
  );
  const keyMentions: KeyMention[] = Array.isArray(parsed?.keyMentions)
    ? parsed.keyMentions
        .map((m: any) => ({
          name: scrubDashes(String(m?.name ?? "").trim()),
          context: m?.context ? scrubDashes(String(m.context).trim()) : "",
        }))
        .filter((m: KeyMention) => m.name.length > 0)
    : [];

  const aiLinks: LinkRef[] = Array.isArray(parsed?.links)
    ? parsed.links
        .map((l: any) => ({
          url: String(l?.url ?? "").trim(),
          label: l?.label ? scrubDashes(String(l.label).trim()) : "",
          context: l?.context ? scrubDashes(String(l.context).trim()) : "",
        }))
        .filter((l: LinkRef) => /^https?:\/\//i.test(l.url))
    : [];

  // Safety net: any raw URL the AI missed.
  const aiUrlSet = new Set(aiLinks.map((l) => l.url.toLowerCase()));
  for (const u of extractUrlsFromText(transcript)) {
    if (!aiUrlSet.has(u.toLowerCase())) {
      aiLinks.push({ url: u, label: u, context: "" });
      aiUrlSet.add(u.toLowerCase());
    }
  }

  const actionPoints: ActionPoint[] = Array.isArray(parsed?.actionPoints)
    ? parsed.actionPoints
        .map((a: any) => ({
          text: scrubDashes(
            typeof a === "string" ? a : String(a?.text ?? "").trim(),
          ),
        }))
        .filter((a: ActionPoint) => a.text.length > 0)
    : [];

  return { summary, keyMentions, links: aiLinks, actionPoints };
}

// --------------------------------------------------------------------
// Platinum gate
// --------------------------------------------------------------------

// Platinum access is computed from the buyer's ORDERS (via
// computePurchaseEntitlements), NOT from raw fields on the portal_users
// row. portal_users has no platinum_paid / upsell3_paid columns, so the
// previous `user.platinumPaid || user.upsell3Paid` check was always
// undefined for every non-admin and returned false -> every Platinum
// member got a 403 ("Failed to load recordings"). Admins still short-
// circuit true without a DB round-trip.
async function isPlatinumOrAdmin(user: any): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  const ent = await computePurchaseEntitlements(user);
  return !!ent.platinumPaid;
}

// --------------------------------------------------------------------
// Email blast
// --------------------------------------------------------------------

interface PlatinumMember {
  email: string;
  firstName: string | null;
}

async function listPlatinumMembers(): Promise<PlatinumMember[]> {
  const rows = await db
    .select({
      email: sql<string>`lower(${ordersTable.email})`,
      revoked: sql<boolean>`bool_and(coalesce(${ordersTable.grantReason}, '') LIKE 'revoked:%')`,
    })
    .from(ordersTable)
    .where(
      and(
        isNotNull(ordersTable.email),
        ne(ordersTable.email, ""),
        or(
          eq(ordersTable.platinumPaid, true),
          eq(ordersTable.upsell3Paid, true),
        ),
      ),
    )
    .groupBy(sql`lower(${ordersTable.email})`);

  const eligible = rows.filter(
    (r) => r.email && /^\S+@\S+\.\S+$/.test(r.email) && !r.revoked,
  );
  if (eligible.length === 0) return [];

  const nameRows = await db
    .select({
      email: sql<string>`lower(${portalUsersTable.email})`,
      firstName: sql<string | null>`max(${portalUsersTable.firstName})`,
    })
    .from(portalUsersTable)
    .where(isNotNull(portalUsersTable.email))
    .groupBy(sql`lower(${portalUsersTable.email})`);
  const nameByEmail = new Map<string, string | null>();
  for (const n of nameRows) {
    if (n.email) nameByEmail.set(n.email, n.firstName);
  }

  return eligible.map((r) => ({
    email: r.email,
    firstName: nameByEmail.get(r.email) ?? null,
  }));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ctaButtonHtml(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#C9A44C" style="border-radius:10px;"><a href="${escapeHtml(
    href,
  )}" style="display:inline-block;padding:16px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#0A0A0A;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;border-radius:10px;">${escapeHtml(
    label,
  )}</a></td></tr></table>`;
}

function recordingEmailHtml(opts: {
  firstName: string | null;
  title: string;
  recordedAt: Date;
  url: string;
}): string {
  const greeting = opts.firstName ? `Hey ${escapeHtml(opts.firstName)},` : "Hey,";
  const dateStr = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(opts.recordedAt);
  return `<p>${greeting}</p>
<p>The recording from <strong>${escapeHtml(opts.title)}</strong> (${escapeHtml(
    dateStr,
  )}) is live inside the Platinum Club.</p>
<p>Inside you'll find the full replay, a clean summary of what was covered, every link and tool mentioned, and the action points to take next.</p>
${ctaButtonHtml(opts.url, "Watch the recording")}
<p style="color:#666;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br/><span style="color:#C9A44C;">${escapeHtml(
    opts.url,
  )}</span></p>
<p>- The AI Influencer Portfolio team</p>`;
}

function recordingEmailText(opts: {
  firstName: string | null;
  title: string;
  recordedAt: Date;
  url: string;
}): string {
  const greeting = opts.firstName ? `Hey ${opts.firstName},` : "Hey,";
  const dateStr = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(opts.recordedAt);
  return `${greeting}

The recording from "${opts.title}" (${dateStr}) is live inside the Platinum Club.

Inside you'll find the full replay, a clean summary of what was covered, every link and tool mentioned, and the action points to take next.

Watch the recording: ${opts.url}

- The AI Influencer Portfolio team`;
}

async function blastNewRecordingEmail(
  recordingId: number,
  title: string,
  recordedAt: Date,
): Promise<{ sent: number; failed: number }> {
  const members = await listPlatinumMembers();
  if (members.length === 0) return { sent: 0, failed: 0 };

  const base = getBrandBaseUrl();
  const url = `${base.replace(/\/$/, "")}/members/platinum-club?tab=recordings&recording=${recordingId}`;

  let sent = 0;
  let failed = 0;
  // Resend free plan throttles at 5 req/sec. 250ms gap keeps us safely
  // below that even with the request itself in flight.
  const SLEEP_MS = 250;
  for (const m of members) {
    const result = await sendEmail({
      email: m.email,
      subject: `New Platinum recording: ${title}`,
      body: recordingEmailText({
        firstName: m.firstName,
        title,
        recordedAt,
        url,
      }),
      bodyHtml: recordingEmailHtml({
        firstName: m.firstName,
        title,
        recordedAt,
        url,
      }),
      templateType: "platinum_workshop_recording_published",
      metadata: { recordingId },
    });
    if (result.status === "sent") sent++;
    else failed++;
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  return { sent, failed };
}

// --------------------------------------------------------------------
// Input parsing
// --------------------------------------------------------------------

function parseRecordedAt(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function sanitizeMentions(input: unknown): KeyMention[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m: any) => ({
      name: typeof m?.name === "string" ? m.name.trim().slice(0, 200) : "",
      context:
        typeof m?.context === "string" ? m.context.trim().slice(0, 600) : "",
    }))
    .filter((m) => m.name.length > 0);
}

function sanitizeLinks(input: unknown): LinkRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((l: any) => ({
      url: typeof l?.url === "string" ? l.url.trim() : "",
      label:
        typeof l?.label === "string" ? l.label.trim().slice(0, 200) : "",
      context:
        typeof l?.context === "string" ? l.context.trim().slice(0, 600) : "",
    }))
    .filter((l) => /^https?:\/\//i.test(l.url));
}

function sanitizeActionPoints(input: unknown): ActionPoint[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((a: any) => ({
      text:
        typeof a === "string"
          ? a.trim()
          : typeof a?.text === "string"
            ? a.text.trim()
            : "",
    }))
    .filter((a) => a.text.length > 0)
    .map((a) => ({ text: a.text.slice(0, 600) }));
}

// --------------------------------------------------------------------
// Public payload shape
// --------------------------------------------------------------------

function toMemberPayload(row: typeof workshopRecordingsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    recordedAt: row.recordedAt,
    wistiaMediaId: row.wistiaMediaId,
    durationMinutes: row.durationMinutes,
    summary: row.summary ?? "",
    keyMentions: (row.keyMentions ?? []) as KeyMention[],
    links: (row.links ?? []) as LinkRef[],
    actionPoints: (row.actionPoints ?? []) as ActionPoint[],
    additionalNotes: row.additionalNotes ?? "",
    publishedAt: row.publishedAt,
  };
}

function toAdminPayload(row: typeof workshopRecordingsTable.$inferSelect) {
  return {
    ...toMemberPayload(row),
    transcriptVtt: row.transcriptVtt ?? "",
    notifiedAt: row.notifiedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// --------------------------------------------------------------------
// Route registration
// --------------------------------------------------------------------

export function registerWorkshopRecordingsRoutes(
  portalRouter: Router,
  { requireAuth, requireActive, requireAdmin }: WorkshopRecordingsDeps,
): void {
  // ============ MEMBER (Platinum-gated) ============

  portalRouter.get(
    "/portal/workshop-recordings",
    requireAuth,
    requireActive,
    async (req: any, res) => {
      try {
        if (!(await isPlatinumOrAdmin(req.portalUser))) {
          res.status(403).json({ error: "Platinum Club access required" });
          return;
        }
        const rows = await db
          .select()
          .from(workshopRecordingsTable)
          .where(isNotNull(workshopRecordingsTable.publishedAt))
          .orderBy(desc(workshopRecordingsTable.recordedAt));
        res.json({ recordings: rows.map(toMemberPayload) });
      } catch (err: any) {
        req.log?.error?.(
          { err: err?.message },
          "[workshop-recordings] member list failed",
        );
        alertRecordingLoadFailure("member list", err?.message || "unknown");
        res
          .status(500)
          .json({ error: err?.message || "Could not load recordings" });
      }
    },
  );

  portalRouter.get(
    "/portal/workshop-recordings/:id",
    requireAuth,
    requireActive,
    async (req: any, res) => {
      try {
        const isAdmin = req.portalUser?.role === "admin";
        if (!(await isPlatinumOrAdmin(req.portalUser))) {
          res.status(403).json({ error: "Platinum Club access required" });
          return;
        }
        const id = Number(req.params?.id);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ error: "Invalid id" });
          return;
        }
        const [row] = await db
          .select()
          .from(workshopRecordingsTable)
          .where(eq(workshopRecordingsTable.id, id))
          .limit(1);
        if (!row) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        if (!row.publishedAt && !isAdmin) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json({ recording: toMemberPayload(row) });
      } catch (err: any) {
        req.log?.error?.(
          { err: err?.message },
          "[workshop-recordings] member detail failed",
        );
        alertRecordingLoadFailure("member detail", err?.message || "unknown");
        res
          .status(500)
          .json({ error: err?.message || "Could not load recording" });
      }
    },
  );

}
