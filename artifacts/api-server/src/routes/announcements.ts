import { Router, type IRouter, type Response, type NextFunction } from "express";
import {
  db,
  announcementsTable,
  announcementDismissalsTable,
  announcementImpressionsTable,
  type Announcement,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_MEDIA_KINDS,
  ANNOUNCEMENT_STATUSES,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

// ─────────────────────────────────────────────────────────────────────────────
// Task #689 - Admin Announcements composer.
//
// Two routers exported:
//   * announcementsRouter  - mounted at /api/portal/announcements (user-facing).
//   * announcementsAdminRouter - mounted at /api/portal/admin/announcements
//     (admin CRUD + publish lifecycle + media upload).
//
// Status lifecycle (3-state): draft -> published -> unpublished. `draft` and
// `unpublished` are both invisible to non-admin users; the distinction lets
// admins tell "never shipped" apart from "pulled after the fact".
// ─────────────────────────────────────────────────────────────────────────────

const objectStorageService = new ObjectStorageService();
const SIGNED_URL_TTL_SEC = 60 * 60; // 1h
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const requireAdmin = (req: any, res: Response, next: NextFunction): void => {
  if (req.portalUser?.role !== "admin") {
    res.status(403).json({ error: "Forbidden -- admin only" });
    return;
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Tiny HTML allowlist sanitizer. We never import sanitize-html to keep the
// dependency surface small; the admin composer only emits a handful of tags
// from Tiptap's StarterKit + Link extension. Everything outside the allowlist
// is stripped. Attributes are stripped except `href` on <a>, which is also
// http(s) only and gets target/rel hardening.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "u", "a", "ul", "ol", "li",
  "h2", "h3", "blockquote",
]);

function sanitizeAnnouncementHtml(input: string): string {
  if (!input) return "";
  let out = input.replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/javascript:/gi, "");
  out = out.replace(/<\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const isClosing = full.startsWith("</");
    if (isClosing) return `</${tag}>`;
    if (tag === "a") {
      const hrefMatch = String(rawAttrs).match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
      const href = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? "") : "";
      if (!/^https?:\/\//i.test(href)) return "";
      const safeHref = href.replace(/"/g, "&quot;");
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">`;
    }
    if (tag === "br") return "<br />";
    return `<${tag}>`;
  });
  return out.trim();
}

function isHttpUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isObjectPath(s: string): boolean {
  return /^\/objects\/[A-Za-z0-9/_\-]+$/.test(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// External media URL support. Admins paste a link from Wistia / YouTube /
// Vimeo / Loom OR a direct image/video URL; we classify the provider,
// normalize to a safe iframe embed URL (or accept the direct URL as-is for
// image/video), and persist the normalized URL in `mediaPath` alongside
// the appropriate `mediaKind`. Renderers switch on mediaKind: "embed" ->
// <iframe src=...>, "image"/"video" -> <img>/<video src=...>. We never
// store admin-supplied raw HTML or iframe markup -- only the resolved
// provider URL -- so a paste cannot inject script or onload handlers.
// ─────────────────────────────────────────────────────────────────────────────

const DIRECT_IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?.*)?$/i;
const DIRECT_VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)(?:\?.*)?$/i;

type ClassifiedMedia = {
  mediaPath: string;
  mediaKind: typeof ANNOUNCEMENT_MEDIA_KINDS[number];
};

function classifyExternalMediaUrl(input: string): ClassifiedMedia | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname;

  // Wistia: accept either canonical share URLs (`wistia.com/medias/<id>`,
  // `*.wistia.com/medias/<id>`) or already-built embed URLs
  // (`fast.wistia.net/embed/iframe/<id>`).
  if (host.endsWith("wistia.com") || host.endsWith("wistia.net")) {
    const embedMatch = path.match(/\/embed\/iframe\/([A-Za-z0-9]+)/);
    if (embedMatch) {
      return {
        mediaPath: `https://fast.wistia.net/embed/iframe/${embedMatch[1]}`,
        mediaKind: "embed",
      };
    }
    const mediasMatch = path.match(/\/medias\/([A-Za-z0-9]+)/);
    if (mediasMatch) {
      return {
        mediaPath: `https://fast.wistia.net/embed/iframe/${mediasMatch[1]}`,
        mediaKind: "embed",
      };
    }
  }

  // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID,
  // youtube.com/embed/ID. All -> www.youtube.com/embed/ID.
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) {
      return { mediaPath: `https://www.youtube.com/embed/${v}`, mediaKind: "embed" };
    }
    const shorts = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
    if (shorts) {
      return { mediaPath: `https://www.youtube.com/embed/${shorts[1]}`, mediaKind: "embed" };
    }
    const embed = path.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
    if (embed) {
      return { mediaPath: `https://www.youtube.com/embed/${embed[1]}`, mediaKind: "embed" };
    }
  }
  if (host === "youtu.be") {
    const id = path.replace(/^\//, "").split("/")[0];
    if (/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      return { mediaPath: `https://www.youtube.com/embed/${id}`, mediaKind: "embed" };
    }
  }

  // Vimeo: vimeo.com/<id> or player.vimeo.com/video/<id>.
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = path.match(/(?:^|\/)(\d{6,})(?:\/|$)/);
    if (id) {
      return { mediaPath: `https://player.vimeo.com/video/${id[1]}`, mediaKind: "embed" };
    }
  }

  // Loom: loom.com/share/<id> or loom.com/embed/<id>.
  if (host === "loom.com") {
    const m = path.match(/^\/(?:share|embed)\/([A-Za-z0-9]+)/);
    if (m) {
      return { mediaPath: `https://www.loom.com/embed/${m[1]}`, mediaKind: "embed" };
    }
  }

  // Direct media URL fallback. Allow any https URL whose path ends in a
  // known image/video extension. Stored as-is and rendered with <img>
  // or <video src=...> on the client.
  if (DIRECT_IMAGE_EXT.test(path)) {
    return { mediaPath: u.toString(), mediaKind: "image" };
  }
  if (DIRECT_VIDEO_EXT.test(path)) {
    return { mediaPath: u.toString(), mediaKind: "video" };
  }
  return null;
}

const baseFields = {
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(20_000).optional().default(""),
  mediaPath: z.string().max(500).nullable().optional(),
  mediaKind: z.enum(ANNOUNCEMENT_MEDIA_KINDS).nullable().optional(),
  ctaLabel: z.string().trim().max(80).nullable().optional(),
  ctaHref: z.string().trim().max(500).nullable().optional(),
  ctaNewTab: z.boolean().optional(),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional().default("all"),
  status: z.enum(ANNOUNCEMENT_STATUSES).optional().default("draft"),
};

const createSchema = z.object(baseFields);
const updateSchema = z.object({
  title: baseFields.title.optional(),
  bodyHtml: baseFields.bodyHtml.optional(),
  mediaPath: baseFields.mediaPath.optional(),
  mediaKind: baseFields.mediaKind.optional(),
  ctaLabel: baseFields.ctaLabel.optional(),
  ctaHref: baseFields.ctaHref.optional(),
  ctaNewTab: baseFields.ctaNewTab.optional(),
  audience: baseFields.audience.optional(),
  status: baseFields.status.optional(),
});

type SanitizedInput = {
  title: string;
  bodyHtml: string;
  mediaPath: string | null;
  mediaKind: typeof ANNOUNCEMENT_MEDIA_KINDS[number] | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  ctaNewTab: boolean;
  audience?: typeof ANNOUNCEMENT_AUDIENCES[number];
  status?: typeof ANNOUNCEMENT_STATUSES[number];
};

function normalizeInput<T extends Record<string, any>>(parsed: T): {
  ok: true;
  value: Partial<SanitizedInput>;
} | { ok: false; error: string } {
  const value: Partial<SanitizedInput> = {};
  if (parsed.title !== undefined) value.title = String(parsed.title).trim();
  if (parsed.bodyHtml !== undefined) value.bodyHtml = sanitizeAnnouncementHtml(String(parsed.bodyHtml));
  if (parsed.mediaPath !== undefined) {
    const v = parsed.mediaPath;
    if (v === null || v === "") {
      value.mediaPath = null;
      // Clearing mediaPath always clears the kind too, regardless of what
      // the client sent.
      value.mediaKind = null;
    } else if (isObjectPath(String(v))) {
      // Uploaded asset path. mediaKind must come from the client (the
      // /uploads/request-url endpoint hands one back at upload time).
      value.mediaPath = String(v);
      if (parsed.mediaKind !== undefined) {
        value.mediaKind = parsed.mediaKind ?? null;
      }
    } else if (typeof v === "string" && /^https:\/\//i.test(v)) {
      // External URL paste (Wistia / YouTube / Vimeo / Loom / direct
      // image / direct video). Server classifies and normalizes -- client
      // cannot override the resulting kind, which prevents
      // unsupported-provider iframes by construction.
      const classified = classifyExternalMediaUrl(String(v));
      if (!classified) {
        return {
          ok: false,
          error:
            "Unsupported media URL. Paste a Wistia, YouTube, Vimeo, or Loom link, or a direct image/video URL.",
        };
      }
      value.mediaPath = classified.mediaPath;
      value.mediaKind = classified.mediaKind;
    } else {
      return { ok: false, error: "mediaPath must be an /objects/<id> path or an https URL" };
    }
  } else if (parsed.mediaKind !== undefined) {
    // Caller is updating only the kind without touching the path -- allow
    // it (rare; e.g. backfill correction).
    value.mediaKind = parsed.mediaKind ?? null;
  }
  if (parsed.ctaLabel !== undefined) {
    const v = parsed.ctaLabel;
    value.ctaLabel = v ? String(v).trim() : null;
  }
  if (parsed.ctaHref !== undefined) {
    const v = parsed.ctaHref;
    if (v === null || v === "") {
      value.ctaHref = null;
    } else if (isHttpUrl(String(v))) {
      value.ctaHref = String(v).trim();
    } else {
      return { ok: false, error: "ctaHref must be a http(s) URL" };
    }
  }
  if (parsed.ctaNewTab !== undefined) value.ctaNewTab = !!parsed.ctaNewTab;
  if (parsed.audience !== undefined) value.audience = parsed.audience;
  if (parsed.status !== undefined) value.status = parsed.status;
  const finalLabel = value.ctaLabel;
  const finalHref = value.ctaHref;
  if ((finalLabel && !finalHref) || (!finalLabel && finalHref)) {
    return { ok: false, error: "CTA label and link must be set together" };
  }
  if (value.mediaPath && !value.mediaKind) {
    return { ok: false, error: "mediaKind is required when mediaPath is set" };
  }
  if (value.mediaKind && value.mediaPath === undefined) {
    return { ok: false, error: "mediaPath is required when mediaKind is set" };
  }
  return { ok: true, value };
}

// Best-effort resolution of a viewable media URL. We hand clients a fresh
// short-lived signed GET URL so the browser can stream directly from GCS
// without going through the API for byte serving. If signing fails (e.g.
// the underlying object was deleted out of band) we surface null and the
// UI just hides the media slot.
async function resolveMediaUrl(mediaPath: string | null): Promise<string | null> {
  if (!mediaPath) return null;
  // External URLs (Wistia / YouTube / Vimeo / Loom embeds, direct image /
  // video URLs) are already public and need no signing. Skip the GCS
  // round-trip entirely; otherwise getSignedReadUrl will throw on a
  // non-/objects path and the row's media disappears.
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
  try {
    return await objectStorageService.getSignedReadUrl(mediaPath, SIGNED_URL_TTL_SEC);
  } catch (err) {
    logger.warn({ err, mediaPath }, "announcements: media sign failed");
    return null;
  }
}

type SerializedAnnouncement = {
  id: number;
  title: string;
  bodyHtml: string;
  mediaPath: string | null;
  mediaUrl: string | null;
  mediaKind: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  ctaNewTab: boolean;
  audience: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Look up dismissal count for a single row. Used to enrich admin mutation
// responses so the on-wire shape stays consistent with the admin list
// (which also returns aggregate counts). Kept as a one-row query so it is
// O(1) per mutation; the admin list still folds counts into its subquery.
async function loadDismissedCount(id: number): Promise<number> {
  try {
    const [r] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(announcementDismissalsTable)
      .where(eq(announcementDismissalsTable.announcementId, id));
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

// Enriches a serialized row with the same `seenCount`/`dismissedCount`
// fields the admin list returns. `seenCount` is intentionally a floor
// approximation: without a separate impressions table the only ack signal
// we have is "user dismissed it", so seenCount == dismissedCount on
// published rows (everyone who closed it must have seen it) and 0 on
// draft/unpublished rows.
async function serializeAdmin(a: Announcement) {
  const base = await serialize(a);
  const dismissedCount = await loadDismissedCount(a.id);
  return {
    ...base,
    dismissedCount,
    seenCount: a.status === "published" ? dismissedCount : 0,
  };
}

async function serialize(a: Announcement): Promise<SerializedAnnouncement> {
  return {
    id: a.id,
    title: a.title,
    bodyHtml: a.bodyHtml,
    mediaPath: a.mediaPath,
    mediaUrl: await resolveMediaUrl(a.mediaPath),
    mediaKind: a.mediaKind,
    ctaLabel: a.ctaLabel,
    ctaHref: a.ctaHref,
    ctaNewTab: a.ctaNewTab,
    audience: a.audience,
    status: a.status,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// User-facing router: GET active announcements for the current portal user,
// excluding ones they've already dismissed, plus a dismiss endpoint.
// ─────────────────────────────────────────────────────────────────────────────
export const announcementsRouter: IRouter = Router();

announcementsRouter.get("/", requireAuth, async (req: any, res: Response) => {
  const portalUser = req.portalUser;
  if (!portalUser?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const isAdmin = portalUser.role === "admin";
    const audienceFilter = isAdmin
      ? inArray(announcementsTable.audience, ["all", "admins"])
      : eq(announcementsTable.audience, "all");
    const rows = await db
      .select({
        a: announcementsTable,
        dismissedAt: announcementDismissalsTable.dismissedAt,
      })
      .from(announcementsTable)
      .leftJoin(
        announcementDismissalsTable,
        and(
          eq(announcementDismissalsTable.announcementId, announcementsTable.id),
          eq(announcementDismissalsTable.portalUserId, portalUser.id),
        ),
      )
      .where(and(eq(announcementsTable.status, "published"), audienceFilter))
      .orderBy(desc(announcementsTable.publishedAt), desc(announcementsTable.id))
      .limit(50);
    const undismissed = rows.filter((r) => r.dismissedAt === null);
    const items = await Promise.all(undismissed.map((r) => serialize(r.a)));
    res.json({ announcements: items });
    return;
  } catch (err) {
    req.log?.error?.({ err }, "announcements: list failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// Archive feed: every published announcement the user is eligible to see,
// regardless of whether they've dismissed it. Powers the in-portal
// "Announcements" history page so users can re-read anything that has
// scrolled out of the bell. Excludes draft/unpublished rows (admins use
// the admin list for those) and respects the same audience gate as the
// active feed.
announcementsRouter.get("/archive", requireAuth, async (req: any, res: Response) => {
  const portalUser = req.portalUser;
  if (!portalUser?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const isAdmin = portalUser.role === "admin";
    const audienceFilter = isAdmin
      ? inArray(announcementsTable.audience, ["all", "admins"])
      : eq(announcementsTable.audience, "all");
    const rows = await db
      .select({
        a: announcementsTable,
        dismissedAt: announcementDismissalsTable.dismissedAt,
      })
      .from(announcementsTable)
      .leftJoin(
        announcementDismissalsTable,
        and(
          eq(announcementDismissalsTable.announcementId, announcementsTable.id),
          eq(announcementDismissalsTable.portalUserId, portalUser.id),
        ),
      )
      .where(and(eq(announcementsTable.status, "published"), audienceFilter))
      .orderBy(desc(announcementsTable.publishedAt), desc(announcementsTable.id))
      .limit(200);
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await serialize(r.a)),
        dismissed: r.dismissedAt !== null,
        dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
      })),
    );
    res.json({ announcements: items });
    return;
  } catch (err) {
    req.log?.error?.({ err }, "announcements: archive failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// Task #719 - Record one impression row the first time a user actually
// sees an announcement (popup render or archive list). Idempotent via
// the unique index on (announcement_id, portal_user_id) +
// onConflictDoNothing, so the popup may fire this on every render
// without inflating the count. Same eligibility gate as /dismiss so a
// user can't pre-stamp an impression on a draft / admins-only row.
announcementsRouter.post("/:id/seen", requireAuth, async (req: any, res: Response) => {
  const portalUser = req.portalUser;
  if (!portalUser?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const [row] = await db
      .select({
        status: announcementsTable.status,
        audience: announcementsTable.audience,
      })
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    if (!row || row.status !== "published") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const isAdmin = portalUser.role === "admin";
    if (row.audience === "admins" && !isAdmin) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await db
      .insert(announcementImpressionsTable)
      .values({ announcementId: id, portalUserId: portalUser.id })
      .onConflictDoNothing();
    res.json({ ok: true });
    return;
  } catch (err) {
    logger.error({ err }, "announcements: seen failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

announcementsRouter.post("/:id/dismiss", requireAuth, async (req: any, res: Response) => {
  const portalUser = req.portalUser;
  if (!portalUser?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    // Eligibility gate: a user may only dismiss an announcement that is
    // currently visible to them. Without this check a user could pre-
    // dismiss an unknown id (draft, unpublished, or admins-only) and
    // never see it once it eventually publishes. Non-eligible ids return
    // 404 so we don't leak the existence of admin-only or draft rows.
    const [row] = await db
      .select({
        status: announcementsTable.status,
        audience: announcementsTable.audience,
      })
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    if (!row || row.status !== "published") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const isAdmin = portalUser.role === "admin";
    if (row.audience === "admins" && !isAdmin) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    await db
      .insert(announcementDismissalsTable)
      .values({ announcementId: id, portalUserId: portalUser.id })
      .onConflictDoNothing();
    res.json({ ok: true });
    return;
  } catch (err) {
    logger.error({ err }, "announcements: dismiss failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin router: full CRUD + publish/unpublish + media upload.
// ─────────────────────────────────────────────────────────────────────────────
export const announcementsAdminRouter: IRouter = Router();

announcementsAdminRouter.get("/", requireAuth, requireAdmin, async (req: any, res: Response) => {
  try {
    // Aggregate counts per announcement:
    //  * dismissed_count - number of users that have dismissed the row.
    //  * seen_count      - best-effort "users who could have seen this" - for
    //    published rows we approximate this with the dismiss count plus the
    //    list of currently-active recipients; since we don't track view-ack
    //    events, dismiss count is the floor (everyone who saw it then closed
    //    it). For draft/unpublished rows seen_count is 0.
    // We compute both via subquery so the admin list still costs one round-trip.
    const rows = await db
      .select({
        a: announcementsTable,
        impressionCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${announcementImpressionsTable}
          WHERE ${announcementImpressionsTable.announcementId} = ${announcementsTable.id}
        )`,
        dismissedCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${announcementDismissalsTable}
          WHERE ${announcementDismissalsTable.announcementId} = ${announcementsTable.id}
        )`,
      })
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.id))
      .limit(200);
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await serialize(r.a)),
        dismissedCount: Number(r.dismissedCount ?? 0),
        impressionCount: Number(r.impressionCount ?? 0),
        // Task #719 - real impression tracking. seenCount is now the max of
        // impressions and dismissals (a dismissal without a recorded
        // impression - e.g. legacy rows from before this table existed -
        // still implies the user saw it).
        seenCount:
          r.a.status === "published"
            ? Math.max(
                Number(r.impressionCount ?? 0),
                Number(r.dismissedCount ?? 0),
              )
            : 0,
      })),
    );
    res.json({ announcements: items });
    return;
  } catch (err) {
    req.log?.error?.({ err }, "announcements admin: list failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

announcementsAdminRouter.post("/", requireAuth, requireAdmin, async (req: any, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const norm = normalizeInput(parsed.data);
  if (!norm.ok) {
    res.status(400).json({ error: norm.error });
    return;
  }
  try {
    const now = new Date();
    const status = norm.value.status ?? "draft";
    const [row] = await db
      .insert(announcementsTable)
      .values({
        title: norm.value.title ?? "Untitled",
        bodyHtml: norm.value.bodyHtml ?? "",
        mediaPath: norm.value.mediaPath ?? null,
        mediaKind: norm.value.mediaKind ?? null,
        ctaLabel: norm.value.ctaLabel ?? null,
        ctaHref: norm.value.ctaHref ?? null,
        ctaNewTab: norm.value.ctaNewTab ?? true,
        audience: norm.value.audience ?? "all",
        status,
        publishedAt: status === "published" ? now : null,
        createdById: req.portalUser?.id ?? null,
      })
      .returning();
    res.json({ announcement: await serializeAdmin(row) });
    return;
  } catch (err) {
    req.log?.error?.({ err }, "announcements admin: create failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

announcementsAdminRouter.patch("/:id", requireAuth, requireAdmin, async (req: any, res: Response) => {
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const norm = normalizeInput(parsed.data);
  if (!norm.ok) {
    res.status(400).json({ error: norm.error });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(announcementsTable)
      .where(eq(announcementsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const next: Partial<typeof announcementsTable.$inferInsert> = {
      ...norm.value,
      updatedAt: new Date(),
    };
    if (norm.value.status === "published" && existing.status !== "published") {
      next.publishedAt = new Date();
    }
    // Unpublishing keeps publishedAt for audit (so admins can see when it
    // first went live); draft-from-published clears it.
    if (norm.value.status === "draft" && existing.status === "published") {
      next.publishedAt = null;
    }
    const [row] = await db
      .update(announcementsTable)
      .set(next)
      .where(eq(announcementsTable.id, id))
      .returning();
    res.json({ announcement: await serializeAdmin(row) });
    return;
  } catch (err) {
    req.log?.error?.({ err }, "announcements admin: update failed");
    res.status(500).json({ error: "internal_error" });
    return;
  }
});

announcementsAdminRouter.post(
  "/:id/publish",
  requireAuth,
  requireAdmin,
  async (req: any, res: Response) => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    try {
      const [existing] = await db
        .select()
        .from(announcementsTable)
        .where(eq(announcementsTable.id, id));
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      // Re-publishing from `unpublished` keeps the original publishedAt to
      // preserve ordering for users; first-time publish stamps it now.
      const publishedAt = existing.publishedAt ?? new Date();
      const [row] = await db
        .update(announcementsTable)
        .set({ status: "published", publishedAt, updatedAt: new Date() })
        .where(eq(announcementsTable.id, id))
        .returning();
      res.json({ announcement: await serializeAdmin(row) });
      return;
    } catch (err) {
      req.log?.error?.({ err }, "announcements admin: publish failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }
  },
);

announcementsAdminRouter.post(
  "/:id/unpublish",
  requireAuth,
  requireAdmin,
  async (req: any, res: Response) => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    try {
      // 3-state lifecycle: published -> unpublished (not back to draft). We
      // keep publishedAt so we can show "was live from X to Y" later.
      const [row] = await db
        .update(announcementsTable)
        .set({ status: "unpublished", updatedAt: new Date() })
        .where(eq(announcementsTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ announcement: await serializeAdmin(row) });
      return;
    } catch (err) {
      req.log?.error?.({ err }, "announcements admin: unpublish failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }
  },
);

announcementsAdminRouter.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  async (req: any, res: Response) => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    try {
      const result = await db
        .delete(announcementsTable)
        .where(eq(announcementsTable.id, id))
        .returning({ id: announcementsTable.id });
      if (result.length === 0) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
      return;
    } catch (err) {
      req.log?.error?.({ err }, "announcements admin: delete failed");
      res.status(500).json({ error: "internal_error" });
      return;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated announcements upload endpoint. Enforces server-side MIME + size
// limits (the generic /storage/uploads/request-url accepts any contentType,
// and announcements have stricter rules: image/* or video/* only, <= 100 MB).
// Returns a presigned PUT URL and the /objects/<id> path the admin should
// hand back when saving the announcement.
// ─────────────────────────────────────────────────────────────────────────────
const uploadBodySchema = z.object({
  contentType: z.string().min(1).max(120),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  name: z.string().max(300).optional(),
});

announcementsAdminRouter.post(
  "/uploads/request-url",
  requireAuth,
  requireAdmin,
  async (req: any, res: Response) => {
    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_body",
        message: `File must be <= ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
        details: parsed.error.flatten(),
      });
      return;
    }
    const ct = parsed.data.contentType.toLowerCase();
    const isImage = ALLOWED_IMAGE_TYPES.has(ct);
    const isVideo = ALLOWED_VIDEO_TYPES.has(ct);
    if (!isImage && !isVideo) {
      res.status(400).json({
        error: "unsupported_media_type",
        message:
          "Only PNG, JPEG, WebP, GIF images or MP4, MOV, WebM video are supported.",
      });
      return;
    }
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL({
        userId: req.portalUser?.id,
      });
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({
        uploadURL,
        objectPath,
        mediaKind: isImage ? "image" : "video",
      });
      return;
    } catch (err) {
      req.log?.error?.({ err }, "announcements admin: upload url failed");
      res.status(500).json({ error: "upload_url_failed" });
      return;
    }
  },
);

// Test-only export so unit tests can exercise the sanitizer directly.
export const __test = { sanitizeAnnouncementHtml };
