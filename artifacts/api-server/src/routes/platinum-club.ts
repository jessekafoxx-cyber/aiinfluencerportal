import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { getAuth, clerkClient } from "../lib/auth-compat";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  platinumClubResourcesTable,
  platinumClubBuildsTable,
} from "@workspace/db";
import { and, asc, eq, sql, inArray } from "drizzle-orm";
import { ensurePortalUserForClerk } from "../lib/portal-user-upsert.js";
import { getPortalKey } from "../lib/portal-key.js";
import { computePurchaseEntitlements } from "./portal.js";
import { getDriveFileStream } from "../lib/google-drive.js";
import {
  ensurePlatinumClubBuildsSeeded,
  PLATINUM_BUILD_SECTION_TYPES,
} from "../lib/ensure-platinum-club-builds.js";

const router: ReturnType<typeof Router> = Router();

// ── Live-drop timing (Greg's UK clock) ───────────────────────────────────
// Content drops "at midnight on the last day of each month", i.e. it becomes
// visible the instant the next month begins at 00:00 Europe/London. The very
// first Blueprint drop is the end of May 2026 (-> 2026-06-01 00:00 London);
// once that passes the library stays unlocked permanently. `dropAtIso` is the
// NEXT upcoming month boundary, used by the portal as a "more coming" teaser
// countdown. Admins preview the library at any time.
const FIRST_DROP_YEAR = 2026;
const FIRST_DROP_MONTH_INDEX0 = 5; // June (0-based) => end of May 2026

function londonOffsetMinutes(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asUtc - d.getTime()) / 60_000);
}

// UTC ms for the first day of (year, monthIndex0) at 00:00 Europe/London.
function londonMonthStartUtc(year: number, monthIndex0: number): number {
  const naiveUtc = Date.UTC(year, monthIndex0, 1, 0, 0, 0);
  const offsetMin = londonOffsetMinutes(new Date(naiveUtc));
  return naiveUtc - offsetMin * 60_000;
}

function firstDropUtc(): number {
  return londonMonthStartUtc(FIRST_DROP_YEAR, FIRST_DROP_MONTH_INDEX0);
}

// Next month boundary at/after `nowMs`, expressed in London wall-clock.
function nextDropUtc(nowMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(nowMs))) map[p.type] = p.value;
  const y = Number(map.year);
  const m = Number(map.month); // 1-12
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonthIndex0 = m === 12 ? 0 : m;
  return londonMonthStartUtc(nextYear, nextMonthIndex0);
}

function isLiveNow(): boolean {
  return Date.now() >= firstDropUtc();
}

// ── Auth + access gate ────────────────────────────────────────────────────
async function loadUser(req: any, res: any) {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  let [user] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.clerkId, userId as string));
  if (!user) {
    let email: string | null = null;
    try {
      const c = await clerkClient.users.getUser(userId as string);
      email = c.emailAddresses?.[0]?.emailAddress || null;
    } catch {}
    if (!email) email = `${userId}@portal.local`;
    user = await ensurePortalUserForClerk({
      clerkId: userId as string,
      email,
      portalKey: getPortalKey(req),
    });
  }
  return user;
}

async function gate(
  req: any,
  res: any,
): Promise<{ user: any; isAdmin: boolean } | null> {
  const user = await loadUser(req, res);
  if (!user) return null;
  const isAdmin = user?.role === "admin";
  if (isAdmin) return { user, isAdmin: true };
  const ent = await computePurchaseEntitlements(user);
  if (!ent.platinumPaid) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { user, isAdmin: false };
}

// ── Drive streaming proxy ─────────────────────────────────────────────────
function extensionFor(resourceType: string): string {
  switch (resourceType) {
    case "pdf":
      return ".pdf";
    case "docx":
      return ".docx";
    case "audio":
      return ".m4a";
    case "zip":
      return ".zip";
    default:
      return "";
  }
}

async function streamDrive(
  req: any,
  res: any,
  fileId: string,
  opts: { asAttachment: boolean; filename?: string; fallbackContentType?: string },
): Promise<void> {
  let upstream: Response;
  try {
    upstream = await getDriveFileStream(fileId);
  } catch (e) {
    req.log?.error?.({ err: (e as Error).message }, "platinum-club drive fetch failed");
    if (!res.headersSent) res.status(502).json({ error: "Upstream error" });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    if (!res.headersSent) res.status(502).json({ error: "Upstream error" });
    return;
  }

  const contentType =
    upstream.headers.get("content-type") ||
    opts.fallbackContentType ||
    "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  const len = upstream.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);

  if (opts.asAttachment) {
    const safe = (opts.filename || `file-${fileId}`).replace(/[^\w.\- ]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(
        opts.filename || `file-${fileId}`,
      )}`,
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
  } else {
    res.setHeader("Cache-Control", "private, max-age=86400");
  }

  const nodeStream = Readable.fromWeb(
    upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  nodeStream.on("error", (err) => {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club stream error");
    if (!res.headersSent) res.status(502);
    res.end();
  });
  nodeStream.pipe(res);
}

// ── Endpoints ─────────────────────────────────────────────────────────────

// ── DFY Builds (admin-managed taxonomy) ──────────────────────────────────
type BuildDto = {
  id: number;
  label: string;
  slug: string;
  sections: { key: string; label: string }[];
  displayOrder: number;
  isActive: boolean;
};

function toBuildDto(r: typeof platinumClubBuildsTable.$inferSelect): BuildDto {
  return {
    id: r.id,
    label: r.label,
    slug: r.slug,
    sections: Array.isArray(r.sections) ? r.sections : [],
    displayOrder: r.displayOrder,
    isActive: r.isActive,
  };
}

// Loads builds ordered for display. Lazily seeds the starter builds on the
// first read if the table is still empty (dev workers may not have booted the
// worker seed hook). `ensurePlatinumClubBuildsSeeded` is seed-if-empty +
// advisory-locked, so this never clobbers admin edits.
async function loadBuilds(opts: { activeOnly: boolean }): Promise<BuildDto[]> {
  let rows = await db
    .select()
    .from(platinumClubBuildsTable)
    .orderBy(
      asc(platinumClubBuildsTable.displayOrder),
      asc(platinumClubBuildsTable.id),
    );
  if (rows.length === 0) {
    await ensurePlatinumClubBuildsSeeded();
    rows = await db
      .select()
      .from(platinumClubBuildsTable)
      .orderBy(
        asc(platinumClubBuildsTable.displayOrder),
        asc(platinumClubBuildsTable.id),
      );
  }
  const dtos = rows.map(toBuildDto);
  return opts.activeOnly ? dtos.filter((b) => b.isActive) : dtos;
}

// All section keys across every build (active + hidden). Used to validate that
// a resource's `section` belongs to a real build section.
async function getBuildSectionKeys(): Promise<Set<string>> {
  const builds = await loadBuilds({ activeOnly: false });
  const keys = new Set<string>();
  for (const b of builds) for (const s of b.sections) keys.add(s.key);
  return keys;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Resource catalog. Resources are only returned once the drop is live (admins
// preview early). `dropAtIso` powers the teaser countdown.
router.get("/portal/platinum-club/resources", async (req, res) => {
  try {
    const ctx = await gate(req, res);
    if (!ctx) return;

    const live = isLiveNow();
    const showContent = live || ctx.isAdmin;

    // Load all builds so we can both expose the active taxonomy and suppress
    // resources whose section belongs to a HIDDEN build. Without this, hiding a
    // build would leave its resources orphaned into the member "Other" bucket
    // instead of actually hiding them.
    const allBuilds = await loadBuilds({ activeOnly: false });
    const hiddenSectionKeys = new Set<string>();
    for (const b of allBuilds) {
      if (!b.isActive) for (const s of b.sections) hiddenSectionKeys.add(s.key);
    }
    const builds = allBuilds.filter((b) => b.isActive);

    let resources: Array<Record<string, unknown>> = [];
    if (showContent) {
      const rows = await db
        .select()
        .from(platinumClubResourcesTable)
        .where(eq(platinumClubResourcesTable.isActive, true))
        .orderBy(
          asc(platinumClubResourcesTable.section),
          asc(platinumClubResourcesTable.displayOrder),
          asc(platinumClubResourcesTable.id),
        );
      resources = rows
        .filter((r) => !hiddenSectionKeys.has(r.section))
        .map((r) => {
          const hasDownload = !!r.driveFileId;
          return {
            id: r.id,
            section: r.section,
            title: r.title,
            description: r.description,
            resourceType: r.resourceType,
            downloadUrl: hasDownload
              ? `/api/portal/platinum-club/resources/${r.id}/download`
              : null,
            externalUrl: r.externalUrl,
            coverUrl: r.coverDriveFileId
              ? `/api/portal/platinum-club/resources/${r.id}/cover`
              : null,
          };
        });
    }

    res.json({
      isLive: live,
      canPreview: ctx.isAdmin && !live,
      dropAtIso: new Date(nextDropUtc(Date.now())).toISOString(),
      resources,
      builds,
    });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club resources failed");
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/portal/platinum-club/resources/:id/download", async (req, res) => {
  try {
    const ctx = await gate(req, res);
    if (!ctx) return;
    if (!isLiveNow() && !ctx.isAdmin) {
      res.status(403).json({ error: "Not yet available" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const [row] = await db
      .select()
      .from(platinumClubResourcesTable)
      .where(
        and(
          eq(platinumClubResourcesTable.id, id),
          eq(platinumClubResourcesTable.isActive, true),
        ),
      )
      .limit(1);
    if (!row || !row.driveFileId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filename = `${row.title.replace(/[^\w.\- ]/g, " ").trim()}${extensionFor(
      row.resourceType,
    )}`;
    await streamDrive(req, res, row.driveFileId, {
      asAttachment: true,
      filename,
    });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club download failed");
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

router.get("/portal/platinum-club/resources/:id/cover", async (req, res) => {
  try {
    const ctx = await gate(req, res);
    if (!ctx) return;
    if (!isLiveNow() && !ctx.isAdmin) {
      res.status(403).json({ error: "Not yet available" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const [row] = await db
      .select()
      .from(platinumClubResourcesTable)
      .where(
        and(
          eq(platinumClubResourcesTable.id, id),
          eq(platinumClubResourcesTable.isActive, true),
        ),
      )
      .limit(1);
    if (!row || !row.coverDriveFileId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await streamDrive(req, res, row.coverDriveFileId, {
      asAttachment: false,
      fallbackContentType: "image/jpeg",
    });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club cover failed");
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin CRUD (manage the Blueprint library without code changes) ─────────
// Admins own the catalog at runtime. The boot seeder only fills an empty table
// (see lib/ensure-platinum-club-resources.ts), so every change made here is
// durable across restarts.

const SECTION_KEYS = [
  "main_offer",
  "bonuses",
  "bumps",
  "upsells",
  "creation_assets",
  "content_scripts",
  "ads",
  "sales_assets",
  "top_ads",
  "custom_graphics",
] as const;

const RESOURCE_TYPES = [
  "pdf",
  "docx",
  "audio",
  "zip",
  "google_doc",
  "drive_folder",
  "link",
  "image",
  "one_click_install",
] as const;

// Admins commonly paste a full Google Drive share URL into the "file id" field.
// Extract the bare id from the common URL shapes; otherwise return the trimmed
// input as-is (already a raw id). Empty -> null.
function normalizeDriveId(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/, // /file/d/<id>/view
    /\/folders\/([a-zA-Z0-9_-]+)/, // /drive/folders/<id>
    /[?&]id=([a-zA-Z0-9_-]+)/, // uc?export=download&id=<id>
    /\/d\/([a-zA-Z0-9_-]+)/, // /document/d/<id>/edit
  ];
  for (const re of patterns) {
    const m = v.match(re);
    if (m?.[1]) return m[1];
  }
  return v;
}

function emptyToNull(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  return v ? v : null;
}

// Section is validated dynamically against the live build taxonomy (see
// assertValidSection) rather than a static enum, because admins create builds
// with their own section keys at runtime.
const resourceBaseSchema = z.object({
  section: z.string().trim().min(1, "Section is required").max(200),
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(2000).nullable().optional(),
  resourceType: z.enum(RESOURCE_TYPES),
  driveFileId: z.string().trim().max(500).nullable().optional(),
  externalUrl: z.string().trim().max(2000).nullable().optional(),
  coverDriveFileId: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

// Create requires at least one delivery target; updates are partial so the
// refine is applied only on the create path.
const resourceCreateSchema = resourceBaseSchema.refine(
  (d) => !!normalizeDriveId(d.driveFileId) || !!emptyToNull(d.externalUrl),
  {
    message: "Provide either a Drive file id or an external URL",
    path: ["driveFileId"],
  },
);

async function requireAdminCtx(req: any, res: any) {
  const ctx = await gate(req, res);
  if (!ctx) return null;
  if (!ctx.isAdmin) {
    res.status(403).json({ error: "Admins only" });
    return null;
  }
  return ctx;
}

// Full, unfiltered list (includes inactive rows + raw fields) for the admin UI.
router.get("/portal/platinum-club/admin/resources", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(platinumClubResourcesTable)
      .orderBy(
        asc(platinumClubResourcesTable.section),
        asc(platinumClubResourcesTable.displayOrder),
        asc(platinumClubResourcesTable.id),
      );
    const builds = await loadBuilds({ activeOnly: false });
    res.json({
      sections: SECTION_KEYS,
      resourceTypes: RESOURCE_TYPES,
      builds,
      resources: rows.map((r) => ({
        id: r.id,
        section: r.section,
        title: r.title,
        description: r.description,
        resourceType: r.resourceType,
        driveFileId: r.driveFileId,
        externalUrl: r.externalUrl,
        coverDriveFileId: r.coverDriveFileId,
        downloadUrl: r.driveFileId
          ? `/api/portal/platinum-club/resources/${r.id}/download`
          : null,
        coverUrl: r.coverDriveFileId
          ? `/api/portal/platinum-club/resources/${r.id}/cover`
          : null,
        displayOrder: r.displayOrder,
        isActive: r.isActive,
      })),
    });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club admin list failed");
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/portal/platinum-club/admin/resources", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const parsed = resourceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const d = parsed.data;
    const validSections = await getBuildSectionKeys();
    if (!validSections.has(d.section)) {
      res.status(400).json({ error: "Unknown section - it does not belong to any build" });
      return;
    }
    // Default displayOrder to the end of the section when not supplied.
    let order = d.displayOrder;
    if (order === undefined) {
      const [{ max } = { max: 0 }] = await db
        .select({ max: sql<number>`coalesce(max(${platinumClubResourcesTable.displayOrder}), 0)::int` })
        .from(platinumClubResourcesTable)
        .where(eq(platinumClubResourcesTable.section, d.section));
      order = Number(max) + 1;
    }
    const [row] = await db
      .insert(platinumClubResourcesTable)
      .values({
        section: d.section,
        title: d.title,
        description: emptyToNull(d.description),
        resourceType: d.resourceType,
        driveFileId: normalizeDriveId(d.driveFileId),
        externalUrl: emptyToNull(d.externalUrl),
        coverDriveFileId: normalizeDriveId(d.coverDriveFileId),
        displayOrder: order,
        isActive: d.isActive ?? true,
      })
      .returning({ id: platinumClubResourcesTable.id });
    res.status(201).json({ id: row?.id });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club admin create failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// Reorder rows within one section. Registered BEFORE the /:id route so the
// literal "reorder" segment is not swallowed by the :id matcher.
router.patch("/portal/platinum-club/admin/resources/reorder", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const parsed = z
      .object({
        section: z.string().trim().min(1).max(200),
        orderedIds: z.array(z.number().int()).min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { section, orderedIds } = parsed.data;
    const validSections = await getBuildSectionKeys();
    if (!validSections.has(section)) {
      res.status(400).json({ error: "Unknown section - it does not belong to any build" });
      return;
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      res.status(400).json({ error: "orderedIds contains duplicates" });
      return;
    }
    const existing = await db
      .select({ id: platinumClubResourcesTable.id })
      .from(platinumClubResourcesTable)
      .where(eq(platinumClubResourcesTable.section, section));
    const existingIds = new Set(existing.map((r) => r.id));
    const allBelong = orderedIds.every((id) => existingIds.has(id));
    if (!allBelong || orderedIds.length !== existingIds.size) {
      res
        .status(400)
        .json({ error: "orderedIds must list exactly the resource ids in this section" });
      return;
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(platinumClubResourcesTable)
          .set({ displayOrder: i + 1 })
          .where(
            and(
              eq(platinumClubResourcesTable.id, orderedIds[i]),
              eq(platinumClubResourcesTable.section, section),
            ),
          );
      }
    });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club admin reorder failed");
    res.status(500).json({ error: "Internal error" });
  }
});

router.patch("/portal/platinum-club/admin/resources/:id", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const parsed = resourceBaseSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const d = parsed.data;
    if (d.section !== undefined) {
      const validSections = await getBuildSectionKeys();
      if (!validSections.has(d.section)) {
        res.status(400).json({ error: "Unknown build section" });
        return;
      }
    }
    const patch: Record<string, unknown> = {};
    if (d.section !== undefined) patch.section = d.section;
    if (d.title !== undefined) patch.title = d.title;
    if (d.description !== undefined) patch.description = emptyToNull(d.description);
    if (d.resourceType !== undefined) patch.resourceType = d.resourceType;
    if (d.driveFileId !== undefined) patch.driveFileId = normalizeDriveId(d.driveFileId);
    if (d.externalUrl !== undefined) patch.externalUrl = emptyToNull(d.externalUrl);
    if (d.coverDriveFileId !== undefined)
      patch.coverDriveFileId = normalizeDriveId(d.coverDriveFileId);
    if (d.displayOrder !== undefined) patch.displayOrder = d.displayOrder;
    if (d.isActive !== undefined) patch.isActive = d.isActive;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [row] = await db
      .update(platinumClubResourcesTable)
      .set(patch)
      .where(eq(platinumClubResourcesTable.id, id))
      .returning({ id: platinumClubResourcesTable.id });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club admin update failed");
    res.status(500).json({ error: "Internal error" });
  }
});

router.delete("/portal/platinum-club/admin/resources/:id", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const [row] = await db
      .delete(platinumClubResourcesTable)
      .where(eq(platinumClubResourcesTable.id, id))
      .returning({ id: platinumClubResourcesTable.id });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club admin delete failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── DFY Builds admin CRUD ────────────────────────────────────────────────
// Reserved slug prefixes whose section keys are already owned by the seeded
// builds (May = bare keys, June = launchpad_). A new build's slug must not
// collide with these or with an existing build slug, so its generated section
// keys (`<slug>_<type>`) never clash with another build's resources.
const RESERVED_BUILD_SLUGS = new Set(["", "launchpad"]);

const buildCreateSchema = z.object({
  label: z.string().trim().min(1, "Build name is required").max(200),
});
const buildUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => d.label !== undefined || d.isActive !== undefined, {
    message: "Nothing to update",
  });

// Create a build. Generates a collision-safe slug from the label and the
// standard 10-section taxonomy keyed by `<slug>_<typeKey>`.
router.post("/portal/platinum-club/admin/builds", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const parsed = buildCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const label = parsed.data.label;
    const existing = await loadBuilds({ activeOnly: false });
    const takenSlugs = new Set(existing.map((b) => b.slug));

    const base = slugify(label) || "build";
    let slug = base;
    let n = 2;
    while (takenSlugs.has(slug) || RESERVED_BUILD_SLUGS.has(slug)) {
      slug = `${base}-${n++}`;
    }

    const sections = PLATINUM_BUILD_SECTION_TYPES.map((s) => ({
      key: `${slug}_${s.key}`,
      label: s.label,
    }));

    const [{ max } = { max: 0 }] = await db
      .select({ max: sql<number>`coalesce(max(${platinumClubBuildsTable.displayOrder}), 0)::int` })
      .from(platinumClubBuildsTable);

    const [row] = await db
      .insert(platinumClubBuildsTable)
      .values({
        label,
        slug,
        sections,
        displayOrder: Number(max) + 1,
        isActive: true,
      })
      .returning({ id: platinumClubBuildsTable.id });
    res.status(201).json({ id: row?.id, slug });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club build create failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// Reorder builds. Registered BEFORE the /:id route so "reorder" is not
// swallowed by the :id matcher. orderedIds must list exactly every build id.
router.patch("/portal/platinum-club/admin/builds/reorder", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const parsed = z
      .object({ orderedIds: z.array(z.number().int()).min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { orderedIds } = parsed.data;
    if (new Set(orderedIds).size !== orderedIds.length) {
      res.status(400).json({ error: "orderedIds contains duplicates" });
      return;
    }
    const existing = await db
      .select({ id: platinumClubBuildsTable.id })
      .from(platinumClubBuildsTable);
    const existingIds = new Set(existing.map((r) => r.id));
    const allBelong = orderedIds.every((id) => existingIds.has(id));
    if (!allBelong || orderedIds.length !== existingIds.size) {
      res.status(400).json({ error: "orderedIds must list exactly every build id" });
      return;
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(platinumClubBuildsTable)
          .set({ displayOrder: i + 1 })
          .where(eq(platinumClubBuildsTable.id, orderedIds[i]));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club build reorder failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// Rename a build and/or toggle its visibility.
router.patch("/portal/platinum-club/admin/builds/:id", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const parsed = buildUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const patch: { label?: string; isActive?: boolean } = {};
    if (parsed.data.label !== undefined) patch.label = parsed.data.label;
    if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
    const [row] = await db
      .update(platinumClubBuildsTable)
      .set(patch)
      .where(eq(platinumClubBuildsTable.id, id))
      .returning({ id: platinumClubBuildsTable.id });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club build update failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// Delete a build. Blocked when any resource still references one of its section
// keys, so content is never orphaned - the admin must move/delete those
// resources first.
router.delete("/portal/platinum-club/admin/builds/:id", async (req, res) => {
  try {
    const ctx = await requireAdminCtx(req, res);
    if (!ctx) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Bad id" });
      return;
    }
    const [build] = await db
      .select()
      .from(platinumClubBuildsTable)
      .where(eq(platinumClubBuildsTable.id, id));
    if (!build) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const sectionKeys = (Array.isArray(build.sections) ? build.sections : []).map(
      (s) => s.key,
    );
    if (sectionKeys.length > 0) {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(platinumClubResourcesTable)
        .where(inArray(platinumClubResourcesTable.section, sectionKeys));
      if (Number(count) > 0) {
        res.status(409).json({
          error: `This build still has ${Number(count)} resource(s). Move or delete them before deleting the build.`,
        });
        return;
      }
    }
    await db
      .delete(platinumClubBuildsTable)
      .where(eq(platinumClubBuildsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err: (err as Error).message }, "platinum-club build delete failed");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
