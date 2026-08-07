import { Router } from "express";
import { getPortalKey } from "../lib/portal-key.js";
import { normalizeDriveImageUrl, ensureAbsoluteUrl } from "../lib/drive-image-url.js";
import { getAuth, clerkClient } from "../lib/auth-compat";
import multer from "multer";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  ordersTable,
  dfyScriptsTable,
  dfyBridgePagesTable,
  dfyAdvertorialPagesTable,
  dfyTemplatesTable,
  dfyTemplateFavouritesTable,
  dfyBackgroundTracksTable,
  dfyDriveAssetsTable,
  dfyDriveSubfoldersTable,
  dfyBrollClipsTable,
} from "@workspace/db";
import { eq, asc, and, inArray, sql, ilike, or, gt, desc } from "drizzle-orm";
import { ensurePortalUserForClerk } from "../lib/portal-user-upsert.js";
import {
  startBackgroundMusicImport,
  getBackgroundMusicJob,
  getActiveBackgroundMusicJobId,
  previewObjectAbsPath,
} from "../lib/dfy-background-music-importer";
import { objectStorageClient } from "../lib/objectStorage";
import {
  runImport as runDfyImport,
  parseCsvText as parseDfyCsv,
  manifestTypeForCategory,
  type CsvRow as DfyCsvRow,
  sanitizeExternalUrl,
} from "../lib/dfy-template-importer";
import {
  triggerImmediateSync,
  getLatestSuccessfulSyncRun,
  getLatestSyncRun,
  DRIVE_FOLDERS_TO_SYNC,
  isSubfolderModeSlug,
} from "../lib/dfy-drive-assets-importer";

const router: ReturnType<typeof Router> = Router();

// Two Drive folders this surface knows about. Source of truth lives in
// `dfy-drive-assets-importer.ts` (the worker reads that map for the
// periodic sync); we re-export it here purely so the route handlers can
// reject unknown slugs without pulling them from the request body.
const DRIVE_FOLDERS: Record<string, string> = DRIVE_FOLDERS_TO_SYNC;

// ---- Auth + access gate ---------------------------------------------------

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
    // Mirror portal.ts behaviour: lazily create the user row from Clerk.
    let email: string | null = null;
    try {
      const c = await clerkClient.users.getUser(userId as string);
      email = c.emailAddresses?.[0]?.emailAddress || null;
    } catch {}
    if (!email) email = `${userId}@portal.local`;
    // Task #505: shared lower(email)-aware upsert avoids creating a
    // duplicate portal_users row when a CSV-grant ghost already exists.
    user = await ensurePortalUserForClerk({
      clerkId: userId as string,
      email,
      portalKey: getPortalKey(req),
    });
  }
  return user;
}

async function hasDfyAccess(user: any): Promise<{ allowed: boolean; isAdmin: boolean }> {
  const isAdmin = user?.role === "admin";
  if (isAdmin) return { allowed: true, isAdmin: true };
  const normEmail = String(user?.email || "").trim().toLowerCase();
  if (!normEmail) return { allowed: false, isAdmin: false };
  // Match computePurchaseEntitlements() (routes/portal.ts) so the data-route
  // gate agrees with the shell/sidebar gate. Two failure modes this fixes:
  //   1. Case-insensitive email: legacy orders.email rows may be mixed-case;
  //      a bare eq() silently misses them.
  //   2. Synthetic admin-grant-by-id OR: admin grants upsert an
  //      `admin-grant-<userId>` row whose email may diverge from the buyer's
  //      sign-in email (Clerk rename, duplicate portal_users row).
  const syntheticGrantId =
    typeof user?.id === "number" ? `admin-grant-${user.id}` : null;
  const emailClause = sql`lower(${ordersTable.email}) = ${normEmail}`;
  const orders = await db
    .select({
      doneForYouPackPaid: ordersTable.doneForYouPackPaid,
      upsell1Paid: ordersTable.upsell1Paid,
      downsell1Paid: ordersTable.downsell1Paid,
    })
    .from(ordersTable)
    .where(
      syntheticGrantId
        ? or(emailClause, eq(ordersTable.id, syntheticGrantId))
        : emailClause,
    );
  // DFY pack access mirrors computePurchaseEntitlements().doneForYouPackPaid:
  // granted by doneForYouPackPaid OR upsell1Paid (the "Hire Operators" upsell)
  // OR downsell1Paid. The previous gate checked doneForYouPackPaid only, so a
  // buyer granted access via upsell1/downsell1 saw every DFY page (the shell
  // gate honoured it) but was 403'd on every data endpoint.
  const paid = orders.some(
    (o) =>
      o.doneForYouPackPaid === true ||
      o.upsell1Paid === true ||
      o.downsell1Paid === true,
  );
  return { allowed: paid, isAdmin: false };
}

// ---- Drive endpoints ------------------------------------------------------

router.get("/portal/dfy/drive/:slug", async (req, res) => {
  try {
    const user = await loadUser(req, res);
    if (!user) return;
    const access = await hasDfyAccess(user);
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    const slug = String(req.params.slug || "");
    if (!DRIVE_FOLDERS[slug]) { res.status(404).json({ error: "Unknown folder" }); return; }

    const lastRun = await getLatestSuccessfulSyncRun(slug);
    const lastSyncedAt = lastRun?.finishedAt ?? null;

    // T392: subfolder-mode slugs (e.g. 250-scenes) return a folder index
    // - one entry per Drive subfolder, with a cover thumbnail and image
    // count - instead of a flat file list. Folders come from the
    // persisted `dfy_drive_subfolders` catalog so a brand-new (still
    // empty) Drive subfolder shows up immediately after the next sync,
    // even before any images are imported. Counts and cover thumbnails
    // are joined in from `dfy_drive_assets`.
    if (isSubfolderModeSlug(slug)) {
      const catalog = await db
        .select({
          driveSubfolderId: dfyDriveSubfoldersTable.driveSubfolderId,
          name: dfyDriveSubfoldersTable.name,
        })
        .from(dfyDriveSubfoldersTable)
        .where(
          and(
            eq(dfyDriveSubfoldersTable.slug, slug),
            eq(dfyDriveSubfoldersTable.isActive, true),
          ),
        );

      const assets = await db
        .select({
          driveFileId: dfyDriveAssetsTable.driveFileId,
          subfolderDriveId: dfyDriveAssetsTable.subfolderDriveId,
          driveModifiedTime: dfyDriveAssetsTable.driveModifiedTime,
          thumbObjectKey: dfyDriveAssetsTable.thumbObjectKey,
        })
        .from(dfyDriveAssetsTable)
        .where(
          and(
            eq(dfyDriveAssetsTable.slug, slug),
            eq(dfyDriveAssetsTable.isActive, true),
            sql`${dfyDriveAssetsTable.thumbObjectKey} IS NOT NULL`,
            sql`${dfyDriveAssetsTable.subfolderDriveId} IS NOT NULL`,
          ),
        )
        .orderBy(asc(dfyDriveAssetsTable.sortKey), asc(dfyDriveAssetsTable.id));

      type Agg = { count: number; cover: typeof assets[number] | null };
      const aggBySubfolder = new Map<string, Agg>();
      for (const a of assets) {
        const id = a.subfolderDriveId!;
        let agg = aggBySubfolder.get(id);
        if (!agg) {
          agg = { count: 0, cover: null };
          aggBySubfolder.set(id, agg);
        }
        agg.count += 1;
        if (!agg.cover) agg.cover = a;
      }

      const subfolders = catalog
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cat) => {
          const agg = aggBySubfolder.get(cat.driveSubfolderId);
          const cover = agg?.cover ?? null;
          return {
            id: cat.driveSubfolderId,
            name: cat.name,
            count: agg?.count ?? 0,
            coverThumbnailUrl: cover
              ? `/api/portal/dfy/drive/${slug}/${encodeURIComponent(
                  cover.driveFileId,
                )}/thumbnail?v=${encodeURIComponent(
                  cover.driveModifiedTime
                    ? new Date(cover.driveModifiedTime).getTime().toString(36)
                    : (cover.thumbObjectKey || "0").slice(-12),
                )}`
              : null,
          };
        });

      res.json({ mode: "subfolders", subfolders, lastSyncedAt });
      return;
    }

    // T313: serve from the persisted catalog instead of hitting Drive on every
    // request. Active rows only; ordered by sortKey (lower-cased filename) so
    // the gallery is stable across syncs.
    const rows = await db
      .select({
        id: dfyDriveAssetsTable.id,
        driveFileId: dfyDriveAssetsTable.driveFileId,
        name: dfyDriveAssetsTable.name,
        mimeType: dfyDriveAssetsTable.mimeType,
        width: dfyDriveAssetsTable.width,
        height: dfyDriveAssetsTable.height,
        driveModifiedTime: dfyDriveAssetsTable.driveModifiedTime,
        thumbObjectKey: dfyDriveAssetsTable.thumbObjectKey,
      })
      .from(dfyDriveAssetsTable)
      .where(
        and(
          eq(dfyDriveAssetsTable.slug, slug),
          eq(dfyDriveAssetsTable.isActive, true),
          sql`${dfyDriveAssetsTable.thumbObjectKey} IS NOT NULL`,
        ),
      )
      .orderBy(asc(dfyDriveAssetsTable.sortKey), asc(dfyDriveAssetsTable.id));

    res.json({
      mode: "flat",
      files: rows.map((r) => ({
        id: r.driveFileId,
        name: r.name,
        mimeType: r.mimeType,
        thumbnailUrl: `/api/portal/dfy/drive/${slug}/${encodeURIComponent(
          r.driveFileId,
        )}/thumbnail?v=${encodeURIComponent(
          // Version the URL with the same key the GCS object is versioned by,
          // so admin/CDN/browser caches treat an updated file as a new URL
          // and the immutable Cache-Control on the response is actually safe.
          r.driveModifiedTime
            ? new Date(r.driveModifiedTime).getTime().toString(36)
            : (r.thumbObjectKey || "0").slice(-12),
        )}`,
        downloadUrl: `/api/portal/dfy/drive/${slug}/${encodeURIComponent(
          r.driveFileId,
        )}/download`,
        width: r.width,
        height: r.height,
      })),
      lastSyncedAt,
    }); return;
  } catch (err: any) {
    req.log?.error?.({ err: err?.message }, "dfy drive list failed");
    res.status(502).json({ error: err?.message || "Drive list failed" }); return;
  }
});

// T392: per-subfolder image listing for subfolder-mode slugs.
router.get("/portal/dfy/drive/:slug/folder/:subfolderId", async (req, res) => {
  try {
    const user = await loadUser(req, res);
    if (!user) return;
    const access = await hasDfyAccess(user);
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    const slug = String(req.params.slug || "");
    const subfolderId = String(req.params.subfolderId || "");
    if (!DRIVE_FOLDERS[slug]) { res.status(404).json({ error: "Unknown folder" }); return; }
    if (!isSubfolderModeSlug(slug)) {
      res.status(400).json({ error: "Slug is not subfolder-mode" }); return;
    }
    if (!subfolderId) { res.status(400).json({ error: "subfolderId required" }); return; }

    // T392: validate the subfolder exists in our catalog so we can return
    // 200 with an empty `files` array for known-but-empty folders. Only
    // 404 when the catalog has no record of this subfolder at all.
    const [catalogRow] = await db
      .select({
        driveSubfolderId: dfyDriveSubfoldersTable.driveSubfolderId,
        name: dfyDriveSubfoldersTable.name,
      })
      .from(dfyDriveSubfoldersTable)
      .where(
        and(
          eq(dfyDriveSubfoldersTable.slug, slug),
          eq(dfyDriveSubfoldersTable.driveSubfolderId, subfolderId),
          eq(dfyDriveSubfoldersTable.isActive, true),
        ),
      )
      .limit(1);
    if (!catalogRow) {
      res.status(404).json({ error: "Subfolder not found" }); return;
    }

    const rows = await db
      .select({
        id: dfyDriveAssetsTable.id,
        driveFileId: dfyDriveAssetsTable.driveFileId,
        name: dfyDriveAssetsTable.name,
        mimeType: dfyDriveAssetsTable.mimeType,
        width: dfyDriveAssetsTable.width,
        height: dfyDriveAssetsTable.height,
        driveModifiedTime: dfyDriveAssetsTable.driveModifiedTime,
        thumbObjectKey: dfyDriveAssetsTable.thumbObjectKey,
        subfolderName: dfyDriveAssetsTable.subfolderName,
      })
      .from(dfyDriveAssetsTable)
      .where(
        and(
          eq(dfyDriveAssetsTable.slug, slug),
          eq(dfyDriveAssetsTable.subfolderDriveId, subfolderId),
          eq(dfyDriveAssetsTable.isActive, true),
          sql`${dfyDriveAssetsTable.thumbObjectKey} IS NOT NULL`,
        ),
      )
      .orderBy(asc(dfyDriveAssetsTable.sortKey), asc(dfyDriveAssetsTable.id));

    const lastRun = await getLatestSuccessfulSyncRun(slug);
    res.json({
      subfolder: { id: subfolderId, name: catalogRow.name },
      files: rows.map((r) => ({
        id: r.driveFileId,
        name: r.name,
        mimeType: r.mimeType,
        thumbnailUrl: `/api/portal/dfy/drive/${slug}/${encodeURIComponent(
          r.driveFileId,
        )}/thumbnail?v=${encodeURIComponent(
          r.driveModifiedTime
            ? new Date(r.driveModifiedTime).getTime().toString(36)
            : (r.thumbObjectKey || "0").slice(-12),
        )}`,
        downloadUrl: `/api/portal/dfy/drive/${slug}/${encodeURIComponent(
          r.driveFileId,
        )}/download`,
        width: r.width,
        height: r.height,
      })),
      lastSyncedAt: lastRun?.finishedAt ?? null,
    });
    return;
  } catch (err: any) {
    req.log?.error?.({ err: err?.message }, "dfy drive subfolder list failed");
    res.status(502).json({ error: err?.message || "Drive subfolder list failed" }); return;
  }
});

router.post("/portal/dfy/drive/:slug/refresh", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const slug = String(req.params.slug || "");
  if (!DRIVE_FOLDERS[slug]) { res.status(404).json({ error: "Unknown folder" }); return; }
  // T313: enqueue (and await) an immediate sync of this slug. If another
  // sync is already in flight we return the latest run state so the admin
  // UI can surface progress instead of double-firing.
  const result = await triggerImmediateSync(slug);
  const latest = await getLatestSyncRun(slug);
  const lastSuccess = await getLatestSuccessfulSyncRun(slug);
  const [{ count: activeCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dfyDriveAssetsTable)
    .where(
      and(
        eq(dfyDriveAssetsTable.slug, slug),
        eq(dfyDriveAssetsTable.isActive, true),
      ),
    );
  res.json({
    ok: result.ok,
    reason: result.reason ?? null,
    count: activeCount,
    latestRun: latest,
    lastSyncedAt: lastSuccess?.finishedAt ?? null,
  }); return;
});

async function streamDriveFile(
  req: any,
  res: any,
  slug: string,
  fileId: string,
  asAttachment: boolean,
) {
  try {
    const user = await loadUser(req, res);
    if (!user) return;
    const access = await hasDfyAccess(user);
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!DRIVE_FOLDERS[slug]) { res.status(404).json({ error: "Unknown folder" }); return; }

    // T313: the DB row is now the allowlist. If a row is missing, soft-deleted,
    // or not yet mirrored to GCS we refuse rather than fall back to Drive.
    const [row] = await db
      .select()
      .from(dfyDriveAssetsTable)
      .where(
        and(
          eq(dfyDriveAssetsTable.slug, slug),
          eq(dfyDriveAssetsTable.driveFileId, fileId),
          eq(dfyDriveAssetsTable.isActive, true),
        ),
      )
      .limit(1);
    if (!row) { res.status(404).json({ error: "File not in folder" }); return; }

    const key = asAttachment ? row.originalObjectKey : row.thumbObjectKey;
    if (!key) { res.status(404).json({ error: "Asset not ready" }); return; }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!bucketId || !privateDir) {
      res.status(500).json({ error: "Object storage not configured" }); return;
    }

    const file = objectStorageClient
      .bucket(bucketId)
      .file(previewObjectAbsPath(privateDir, key));
    const [exists] = await file.exists();
    if (!exists) { res.status(404).json({ error: "Asset missing" }); return; }

    let metaSize: number | null = null;
    try {
      const [meta] = await file.getMetadata();
      if (meta?.size != null) {
        const n = Number(meta.size);
        if (Number.isFinite(n) && n > 0) metaSize = n;
      }
    } catch {
      /* best-effort */
    }

    const contentType = asAttachment
      ? row.mimeType || "application/octet-stream"
      : "image/webp";
    res.setHeader("Content-Type", contentType);
    // Originals can exceed 32 MiB. Autoscale (Cloud Run) caps a *buffered*
    // response - one with a fixed Content-Length - at 32 MiB, which silently
    // truncated every original > 32 MiB ("Site wasn't available" + Resume in
    // the browser). Omitting Content-Length on the attachment forces chunked
    // transfer encoding, which Cloud Run streams without the 32 MiB cap.
    // Thumbnails are tiny, so we keep their Content-Length for nicer caching.
    if (metaSize && !asAttachment) res.setHeader("Content-Length", String(metaSize));
    if (asAttachment) {
      const safe = (row.name || `file-${fileId}`).replace(/[^\w.\- ]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(
          row.name || `file-${fileId}`,
        )}`,
      );
      // Originals are large; cache them on the user's browser for a day.
      res.setHeader("Cache-Control", "private, max-age=86400");
    } else {
      // Thumb object key is versioned by drive_modified_time (see importer);
      // a real edit produces a new key, so the immutable cache is safe.
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }

    const stream = file.createReadStream();
    // Client navigated away / aborted mid-transfer: tear the stream down
    // quietly so it doesn't surface as an unhandled error (the prod logs
    // showed "request aborted" ~900ms into originals downloads).
    const cleanup = () => stream.destroy();
    res.on("close", cleanup);
    stream.on("error", (e) => {
      req.log?.error?.({ err: (e as Error).message }, "drive stream error");
      // If the body has already started flowing we can only end the
      // response - headers (and thus status) are already committed.
      if (!res.headersSent) res.status(502).json({ error: "Stream failed" });
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    // Any unexpected throw before/around streaming (DB, getMetadata, exists,
    // read-stream setup) must return a clean JSON error rather than letting
    // Express render a raw 500 HTML page in a navigated tab.
    req.log?.error?.({ err: (e as Error).message }, "streamDriveFile failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    } else {
      res.end();
    }
  }
}

router.get("/portal/dfy/drive/:slug/:fileId/thumbnail", (req, res) =>
  streamDriveFile(req, res, String(req.params.slug), String(req.params.fileId), false),
);

router.get("/portal/dfy/drive/:slug/:fileId/download", (req, res) =>
  streamDriveFile(req, res, String(req.params.slug), String(req.params.fileId), true),
);

// ---- Pre-generated content scripts catalog --------------------------------

router.get("/portal/dfy/scripts", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  // Only the 4 formats wired to the AI Influencer Portfolio offer are
  // exposed. Legacy types (carousel, fastmotion, hook-demo, overlay,
  // slideshow) remain in the DB but are filtered out server-side so we
  // don't waste bandwidth shipping ~610 unused rows on every page load.
  const ACTIVE_SCRIPT_TYPES = ["podcast-clip", "speaking-clip", "green-screen", "selfie-clip"];
  const rows = await db
    .select()
    .from(dfyScriptsTable)
    .where(inArray(dfyScriptsTable.type, ACTIVE_SCRIPT_TYPES))
    .orderBy(asc(dfyScriptsTable.type), asc(dfyScriptsTable.sortOrder));
  res.json({
    scripts: rows.map((r) => ({
      id: r.id,
      type: r.type,
      hook: r.hook,
      body: r.body,
    })),
  }); return;
});

// ---- Bridge pages (admin-curated link list) -------------------------------

router.get("/portal/dfy/bridge-pages", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db
    .select()
    .from(dfyBridgePagesTable)
    .orderBy(asc(dfyBridgePagesTable.sortOrder), asc(dfyBridgePagesTable.id));
  // Task #742: normalise any Drive share URL on the way out so legacy
  // rows with `/file/d/<id>/view` URLs render in the card without
  // needing a DB backfill first. The on-disk backfill is shipped as a
  // separate one-shot script (`scripts/src/normalize-bridge-page-drive-urls.ts`).
  const pages = rows.map((p) => ({
    ...p,
    previewImageUrl: normalizeDriveImageUrl(p.previewImageUrl),
    // Task #742 follow-up: legacy rows stored GHL preview / download
    // URLs without `https://`, which makes the <a href> resolve as a
    // relative path and lands on the portal's own 404 page. Add the
    // scheme on the way out so the existing rows just work.
    url: ensureAbsoluteUrl(p.url) ?? p.url,
    downloadUrl: ensureAbsoluteUrl(p.downloadUrl),
  }));
  res.json({ pages }); return;
});

router.post("/portal/dfy/bridge-pages", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { title, description, url, previewImageUrl, downloadUrl, bonusNumber } = (req.body || {}) as {
    title?: string; description?: string; url?: string;
    previewImageUrl?: string; downloadUrl?: string; bonusNumber?: number | null;
  };
  if (!title || !url) { res.status(400).json({ error: "title and url required" }); return; }
  const [row] = await db
    .insert(dfyBridgePagesTable)
    .values({
      title,
      description: description || null,
      // Task #742 follow-up: stamp the scheme on bare host+path URLs
      // so `<a href>` doesn't resolve them as a relative portal path.
      url: ensureAbsoluteUrl(url) ?? url,
      // Task #742: normalise Drive URLs at write time so the stored
      // value is always a direct-image URL the <img> can render.
      previewImageUrl: normalizeDriveImageUrl(previewImageUrl || null),
      downloadUrl: ensureAbsoluteUrl(downloadUrl || null),
      bonusNumber:
        typeof bonusNumber === "number" && Number.isFinite(bonusNumber) ? bonusNumber : null,
      // T402: admin-created rows are always tagged manual, so the
      // weekly sheet importer never overwrites them.
      source: "manual",
    })
    .returning();
  res.json({ page: row }); return;
});

// T402: admin-only on-demand re-sync from the curated Google Sheet.
// Returns the inserted/updated/skipped counts so the portal toast can
// surface real numbers ("Added 3, updated 2").
router.post("/portal/dfy/bridge-pages/sync-from-sheet", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { syncBridgePagesFromSheet } = await import("../lib/dfy-bridge-pages-importer");
  const report = await syncBridgePagesFromSheet();
  if (!report.ok) {
    res.status(502).json({ error: report.error || "Sheet sync failed", report });
    return;
  }
  res.json({
    ok: true,
    totalRows: report.totalRows,
    inserted: report.inserted,
    updated: report.updated,
    skipped: report.skipped,
  }); return;
});

router.patch("/portal/dfy/bridge-pages/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  type BridgePagePatchBody = {
    title?: unknown;
    description?: unknown;
    url?: unknown;
    sortOrder?: unknown;
    previewImageUrl?: unknown;
    downloadUrl?: unknown;
    bonusNumber?: unknown;
  };
  const body: BridgePagePatchBody = req.body ?? {};
  const patch: Partial<typeof dfyBridgePagesTable.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string") patch.description = body.description || null;
  if (typeof body.url === "string") patch.url = ensureAbsoluteUrl(body.url) ?? body.url;
  if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
  if (typeof body.previewImageUrl === "string") {
    // Task #742: normalise Drive share URLs to the direct-image CDN
    // URL so the stored value can be rendered by an <img> tag.
    patch.previewImageUrl = normalizeDriveImageUrl(body.previewImageUrl || null);
  }
  if (typeof body.downloadUrl === "string") patch.downloadUrl = ensureAbsoluteUrl(body.downloadUrl || null);
  if (typeof body.bonusNumber === "number" && Number.isFinite(body.bonusNumber)) {
    patch.bonusNumber = body.bonusNumber;
  } else if (body.bonusNumber === null) {
    patch.bonusNumber = null;
  }
  // T402: any admin edit promotes the row to manual ownership so the
  // weekly sheet importer stops touching it. This matches the task
  // spec: "make admin manual-edit preserve source = 'manual'".
  patch.source = "manual";
  const [row] = await db
    .update(dfyBridgePagesTable)
    .set(patch)
    .where(eq(dfyBridgePagesTable.id, id))
    .returning();
  res.json({ page: row }); return;
});

router.delete("/portal/dfy/bridge-pages/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(dfyBridgePagesTable).where(eq(dfyBridgePagesTable.id, id));
  res.json({ ok: true }); return;
});

// ---- Advertorial pages (admin-curated link list, T441) -------------------

router.get("/portal/dfy/advertorial-pages", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  const pages = await db
    .select()
    .from(dfyAdvertorialPagesTable)
    .orderBy(asc(dfyAdvertorialPagesTable.sortOrder), asc(dfyAdvertorialPagesTable.id));
  res.json({ pages }); return;
});

router.post("/portal/dfy/advertorial-pages", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { title, description, previewUrl, installUrl, previewImageUrl, templateNumber } =
    (req.body || {}) as {
      title?: string; description?: string;
      previewUrl?: string; installUrl?: string;
      previewImageUrl?: string; templateNumber?: number | null;
    };
  if (!title || !previewUrl) {
    res.status(400).json({ error: "title and previewUrl required" }); return;
  }
  const [row] = await db
    .insert(dfyAdvertorialPagesTable)
    .values({
      title,
      description: description || null,
      previewUrl,
      installUrl: installUrl || null,
      previewImageUrl: previewImageUrl || null,
      templateNumber:
        typeof templateNumber === "number" && Number.isFinite(templateNumber) ? templateNumber : null,
      source: "manual",
    })
    .returning();
  res.json({ page: row }); return;
});

// Task #498: admin-facing health endpoint for DFY content. Returns the
// same report the boot hook logs (empty Drive slugs, last sync status
// per slug, bridge/highlight/advertorial table counts) so an admin can
// verify a fix without tailing logs.
router.get("/portal/dfy/admin/content-health", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { checkDfyContentHealth } = await import("../lib/dfy-content-health");
  const report = await checkDfyContentHealth();
  res.json({ ok: report.emptyDriveSlugs.length === 0
    && report.failedSyncSlugs.length === 0
    && report.bridgePages > 0
    && report.highlightCovers > 0
    && report.advertorialPages > 0, report });
  return;
});

// Read-only admin diagnostic. Autoscale (Cloud Run) only streams a *buffered*
// response - one with a fixed Content-Length - up to 32 MiB; the download route
// now omits Content-Length on originals so they stream chunked past that cap.
// This lists active DFY originals whose stored size exceeds 32 MiB so an admin
// can see exactly which files rely on the chunked path (and spot any unusually
// large asset) without tailing logs or hitting object storage.
const CLOUD_RUN_BUFFERED_RESPONSE_CAP_BYTES = 32 * 1024 * 1024;
router.get("/portal/dfy/admin/oversized-originals", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const rows = await db
    .select({
      id: dfyDriveAssetsTable.id,
      slug: dfyDriveAssetsTable.slug,
      name: dfyDriveAssetsTable.name,
      driveFileId: dfyDriveAssetsTable.driveFileId,
      fileSize: dfyDriveAssetsTable.fileSize,
    })
    .from(dfyDriveAssetsTable)
    .where(
      and(
        eq(dfyDriveAssetsTable.isActive, true),
        sql`${dfyDriveAssetsTable.originalObjectKey} is not null`,
        gt(dfyDriveAssetsTable.fileSize, CLOUD_RUN_BUFFERED_RESPONSE_CAP_BYTES),
      ),
    )
    .orderBy(desc(dfyDriveAssetsTable.fileSize));
  const items = rows.map((r) => ({
    ...r,
    fileSizeMb:
      r.fileSize == null
        ? null
        : Math.round((r.fileSize / (1024 * 1024)) * 10) / 10,
  }));
  res.json({
    capBytes: CLOUD_RUN_BUFFERED_RESPONSE_CAP_BYTES,
    capMb: 32,
    count: items.length,
    items,
  });
  return;
});

router.get("/portal/dfy/advertorial-pages/sync-status", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { getAdvertorialPagesSyncStatus } = await import("../lib/dfy-advertorial-pages-importer");
  res.json({ status: getAdvertorialPagesSyncStatus() }); return;
});

router.post("/portal/dfy/advertorial-pages/sync-from-sheet", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { syncAdvertorialPagesFromSheet } = await import("../lib/dfy-advertorial-pages-importer");
  const report = await syncAdvertorialPagesFromSheet();
  if (!report.ok) {
    res.status(502).json({ error: report.error || "Sheet sync failed", report });
    return;
  }
  res.json({
    ok: true,
    totalRows: report.totalRows,
    inserted: report.inserted,
    updated: report.updated,
    skipped: report.skipped,
  }); return;
});

router.patch("/portal/dfy/advertorial-pages/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  type AdvertorialPagePatchBody = {
    title?: unknown; description?: unknown;
    previewUrl?: unknown; installUrl?: unknown;
    previewImageUrl?: unknown; sortOrder?: unknown;
    templateNumber?: unknown;
  };
  const body: AdvertorialPagePatchBody = req.body ?? {};
  const patch: Partial<typeof dfyAdvertorialPagesTable.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string") patch.description = body.description || null;
  if (typeof body.previewUrl === "string") patch.previewUrl = body.previewUrl;
  if (typeof body.installUrl === "string") patch.installUrl = body.installUrl || null;
  if (typeof body.previewImageUrl === "string") patch.previewImageUrl = body.previewImageUrl || null;
  if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
  if (typeof body.templateNumber === "number" && Number.isFinite(body.templateNumber)) {
    patch.templateNumber = body.templateNumber;
  } else if (body.templateNumber === null) {
    patch.templateNumber = null;
  }
  // Any admin edit promotes the row to manual ownership so the
  // weekly sheet importer stops touching it.
  patch.source = "manual";
  const [row] = await db
    .update(dfyAdvertorialPagesTable)
    .set(patch)
    .where(eq(dfyAdvertorialPagesTable.id, id))
    .returning();
  res.json({ page: row }); return;
});

router.delete("/portal/dfy/advertorial-pages/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(dfyAdvertorialPagesTable).where(eq(dfyAdvertorialPagesTable.id, id));
  res.json({ ok: true }); return;
});

// Admin-only on-demand re-sync for the 5+ Sales Funnel Templates
// gallery. Mirrors the bridge-pages /sync-from-sheet endpoint above so
// the portal's "Sync from sheet" button can show real counts in a toast.
router.post("/portal/dfy/templates/funnel-templates/sync-from-sheet", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const { syncFunnelTemplatesFromSheet } = await import("../lib/dfy-funnel-templates-importer");
  const report = await syncFunnelTemplatesFromSheet();
  if (!report.ok) {
    res.status(502).json({ error: report.error || "Sheet sync failed", report });
    return;
  }
  res.json({
    ok: true,
    totalRows: report.totalRows,
    inserted: report.inserted,
    updated: report.updated,
    skipped: report.skipped,
  }); return;
});

// ---- DFY template library --------------------------------------------------

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const TEMPLATE_CATEGORIES = new Set([
  "ad_swipe",
  "canva_ad_template",
  "advertorial_swipe",
  "funnel_template",
  "landing_page_swipe",
]);

function detectMime(name: string): string {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

// Task #745: admin-only upload endpoint for bridge-page preview images.
// Drops the buyer's file into the same GCS bucket as the template
// uploader and returns the same `/api/portal/images/<file>` shape the
// rest of the portal already serves, so the admin can drop an image
// into the bridge-pages form without depending on Drive hotlinks.
// Lives here (not next to the other bridge-pages routes) because it
// reuses `templateUpload` + `uploadTemplateBuffer`, both declared in
// this section of the file.
router.post(
  "/portal/dfy/bridge-pages/upload-image",
  templateUpload.single("image"),
  async (req: any, res) => {
    const user = await loadUser(req, res);
    if (!user) return;
    if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
    if (!req.file) { res.status(400).json({ error: "image file is required" }); return; }
    const mime = String(req.file.mimetype || "").toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      res.status(400).json({ error: "Only JPEG, PNG, or WebP images are allowed" }); return;
    }
    try {
      const uploaded = await uploadTemplateBuffer(
        req.file.buffer,
        req.file.originalname || "bridge-page.jpg",
        mime,
      );
      res.json({ url: uploaded.url }); return;
    } catch (err: any) {
      req.log?.error?.({ err }, "bridge-page image upload failed");
      res.status(500).json({ error: err?.message || "Upload failed" }); return;
    }
  },
);

async function uploadTemplateBuffer(
  buf: Buffer,
  origName: string,
  mime: string,
): Promise<{ url: string; mediaKind: "image" | "video" }> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) throw new Error("Object storage not configured");
  const ext = (origName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const fileName = `dfy-${crypto.randomUUID()}.${ext}`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  await file.save(buf, {
    contentType: mime || detectMime(origName),
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  const mediaKind = (mime || detectMime(origName)).startsWith("video/")
    ? "video"
    : "image";
  return { url: `/api/portal/images/${fileName}`, mediaKind };
}

// GET /api/portal/dfy/templates?category=ad_swipe&page=1&pageSize=60&search=...
router.get("/portal/dfy/templates", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const category = String(req.query.category || "");
  if (!TEMPLATE_CATEGORIES.has(category)) {
    res.status(400).json({ error: "Unknown category" }); return;
  }

  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(String(req.query.pageSize || "60"), 10) || 60),
  );
  const search = String(req.query.search || "").trim().toLowerCase();
  const industry = String(req.query.industry || "").trim();
  const awareness = String(req.query.awareness || "").trim();
  const ratio = String(req.query.ratio || "").trim();
  const theme = String(req.query.theme || "").trim();
  const platform = String(req.query.platform || "").trim();
  const subCategory = String(req.query.subCategory || "").trim();
  const favouritesOnly = String(req.query.favouritesOnly || "") === "1";

  // Pull a single page of rows. Filtering is done client-side after we
  // load all rows for the category because the gallery needs the full
  // filter-option list for the chip bar anyway. Categories cap at ~3K
  // rows, well under any worry-budget for an in-memory pass.
  const rows = await db
    .select()
    .from(dfyTemplatesTable)
    .where(eq(dfyTemplatesTable.category, category))
    .orderBy(asc(dfyTemplatesTable.sortOrder), asc(dfyTemplatesTable.id));

  const favRows = await db
    .select({ templateId: dfyTemplateFavouritesTable.templateId })
    .from(dfyTemplateFavouritesTable)
    .where(eq(dfyTemplateFavouritesTable.userId, user.id));
  const favSet = new Set(favRows.map((f) => f.templateId));

  // Derive filter option lists from active (non-empty) values only.
  const optionSet = (k: keyof (typeof rows)[number]) => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = r[k] as string | null;
      if (v && String(v).trim()) s.add(String(v).trim());
    }
    return Array.from(s).sort();
  };
  // T262: theme is collected from theme/theme2/theme3 so all three
  // facets are filterable from one dropdown.
  const themeSet = new Set<string>();
  for (const r of rows) {
    for (const v of [r.theme, r.theme2, r.theme3] as (string | null)[]) {
      if (v && String(v).trim()) themeSet.add(String(v).trim());
    }
  }
  const filterOptions = {
    industry: optionSet("industry"),
    awarenessStage: optionSet("awarenessStage"),
    ratio: optionSet("ratio"),
    theme: Array.from(themeSet).sort(),
    platform: optionSet("platform"),
    subCategory: optionSet("subCategory"),
  };

  const filtered = rows.filter((r) => {
    if (industry && r.industry !== industry) return false;
    if (awareness && r.awarenessStage !== awareness) return false;
    if (ratio && r.ratio !== ratio) return false;
    if (theme && r.theme !== theme && r.theme2 !== theme && r.theme3 !== theme)
      return false;
    if (platform && r.platform !== platform) return false;
    if (subCategory && r.subCategory !== subCategory) return false;
    if (favouritesOnly && !favSet.has(r.id)) return false;
    if (search && !(r.title || "").toLowerCase().includes(search)) return false;
    return true;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const sliced = filtered.slice(start, start + pageSize);

  res.json({
    items: sliced.map((r) => ({
      id: r.id,
      category: r.category,
      subCategory: r.subCategory,
      title: r.title,
      imageUrl: r.imageUrl,
      mediaKind: r.mediaKind,
      posterUrl: r.posterUrl,
      transcript: r.transcript,
      canvaUrl: r.canvaUrl,
      liveUrl: r.liveUrl,
      pdfUrl: r.pdfUrl,
      industry: r.industry,
      awarenessStage: r.awarenessStage,
      ratio: r.ratio,
      theme: r.theme,
      theme2: r.theme2,
      theme3: r.theme3,
      platform: r.platform,
      brandName: r.brandName,
      adCopy: r.adCopy,
      sourceDisplayId: r.sourceDisplayId,
      isFavourite: favSet.has(r.id),
    })),
    total,
    page,
    pageSize,
    filterOptions,
  }); return;
});

// POST /api/portal/dfy/templates  (admin)  — multipart upload
router.post(
  "/portal/dfy/templates",
  templateUpload.single("image"),
  async (req: any, res) => {
    const user = await loadUser(req, res);
    if (!user) return;
    if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
    const body = req.body || {};
    const category = String(body.category || "");
    if (!TEMPLATE_CATEGORIES.has(category)) {
      res.status(400).json({ error: "Unknown category" }); return;
    }
    const title = String(body.title || "").trim();
    if (!title) { res.status(400).json({ error: "title is required" }); return; }

    let imageUrl: string | null = body.imageUrl ? String(body.imageUrl) : null;
    let mediaKind: "image" | "video" =
      body.mediaKind === "video" ? "video" : "image";
    if (req.file) {
      const uploaded = await uploadTemplateBuffer(
        req.file.buffer,
        req.file.originalname || "upload",
        req.file.mimetype || "",
      );
      imageUrl = uploaded.url;
      mediaKind = uploaded.mediaKind;
    }
    if (!imageUrl) {
      res.status(400).json({ error: "image upload or imageUrl is required" }); return;
    }
    // DB only ever stores URLs we own. Reject any externally hosted
    // URL (supabase, CDN, etc.) the admin form might try to paste.
    if (!imageUrl.startsWith("/api/portal/images/")) {
      res.status(400).json({
        error: "imageUrl must be an /api/portal/images/... path. Upload the file instead.",
      }); return;
    }

    const [row] = await db
      .insert(dfyTemplatesTable)
      .values({
        category,
        subCategory: body.subCategory ? String(body.subCategory) : null,
        sourceDisplayId: body.sourceDisplayId ? String(body.sourceDisplayId) : null,
        title,
        imageUrl,
        mediaKind,
        canvaUrl: sanitizeExternalUrl(body.canvaUrl as string | null | undefined),
        liveUrl: sanitizeExternalUrl(body.liveUrl as string | null | undefined),
        pdfUrl: sanitizeExternalUrl(body.pdfUrl as string | null | undefined),
        industry: body.industry ? String(body.industry) : null,
        awarenessStage: body.awarenessStage ? String(body.awarenessStage) : null,
        ratio: body.ratio ? String(body.ratio) : null,
        theme: body.theme ? String(body.theme) : null,
        theme2: body.theme2 ? String(body.theme2) : null,
        theme3: body.theme3 ? String(body.theme3) : null,
        platform: body.platform ? String(body.platform) : null,
        brandName: body.brandName ? String(body.brandName) : null,
        adCopy: body.adCopy ? String(body.adCopy) : null,
      })
      .returning();
    res.json({ template: row }); return;
  },
);

// PATCH /api/portal/dfy/templates/:id  (admin)
router.patch(
  "/portal/dfy/templates/:id",
  templateUpload.single("image"),
  async (req: any, res) => {
    const user = await loadUser(req, res);
    if (!user) return;
    if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }

    const body = req.body || {};
    const patch: Partial<typeof dfyTemplatesTable.$inferInsert> & {
      updatedAt: Date;
    } = { updatedAt: new Date() };
    const readStr = (v: unknown): string | null | undefined => {
      if (typeof v !== "string") return undefined;
      return v === "" ? null : v;
    };
    const title = readStr(body.title);
    if (title !== undefined) patch.title = title === null ? "" : title;
    const subCategory = readStr(body.subCategory);
    if (subCategory !== undefined) patch.subCategory = subCategory;
    const canvaUrl = readStr(body.canvaUrl);
    if (canvaUrl !== undefined) patch.canvaUrl = sanitizeExternalUrl(canvaUrl);
    const liveUrl = readStr(body.liveUrl);
    if (liveUrl !== undefined) patch.liveUrl = sanitizeExternalUrl(liveUrl);
    const pdfUrl = readStr(body.pdfUrl);
    if (pdfUrl !== undefined) patch.pdfUrl = sanitizeExternalUrl(pdfUrl);
    const industry = readStr(body.industry);
    if (industry !== undefined) patch.industry = industry;
    const awarenessStage = readStr(body.awarenessStage);
    if (awarenessStage !== undefined) patch.awarenessStage = awarenessStage;
    const ratio = readStr(body.ratio);
    if (ratio !== undefined) patch.ratio = ratio;
    const theme = readStr(body.theme);
    if (theme !== undefined) patch.theme = theme;
    const theme2 = readStr(body.theme2);
    if (theme2 !== undefined) patch.theme2 = theme2;
    const theme3 = readStr(body.theme3);
    if (theme3 !== undefined) patch.theme3 = theme3;
    const platform = readStr(body.platform);
    if (platform !== undefined) patch.platform = platform;
    const brandName = readStr(body.brandName);
    if (brandName !== undefined) patch.brandName = brandName;
    const adCopy = readStr(body.adCopy);
    if (adCopy !== undefined) patch.adCopy = adCopy;

    if (req.file) {
      const uploaded = await uploadTemplateBuffer(
        req.file.buffer,
        req.file.originalname || "upload",
        req.file.mimetype || "",
      );
      patch.imageUrl = uploaded.url;
      patch.mediaKind = uploaded.mediaKind;
    } else if (typeof body.imageUrl === "string" && body.imageUrl) {
      // Reject externally hosted URLs - DB only ever stores our own.
      if (!body.imageUrl.startsWith("/api/portal/images/")) {
        res.status(400).json({
          error: "imageUrl must be an /api/portal/images/... path. Upload the file instead.",
        }); return;
      }
      patch.imageUrl = body.imageUrl;
    }
    if (body.mediaKind === "video" || body.mediaKind === "image") {
      patch.mediaKind = body.mediaKind;
    }

    const [row] = await db
      .update(dfyTemplatesTable)
      .set(patch)
      .where(eq(dfyTemplatesTable.id, id))
      .returning();
    res.json({ template: row }); return;
  },
);

// DELETE /api/portal/dfy/templates/:id  (admin)
router.delete("/portal/dfy/templates/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(dfyTemplatesTable).where(eq(dfyTemplatesTable.id, id));
  res.json({ ok: true }); return;
});

// POST /api/portal/dfy/templates/:id/favourite  -> { isFavourite }
router.post("/portal/dfy/templates/:id/favourite", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }

  const existing = await db
    .select()
    .from(dfyTemplateFavouritesTable)
    .where(
      and(
        eq(dfyTemplateFavouritesTable.userId, user.id),
        eq(dfyTemplateFavouritesTable.templateId, id),
      ),
    );
  if (existing.length) {
    await db
      .delete(dfyTemplateFavouritesTable)
      .where(
        and(
          eq(dfyTemplateFavouritesTable.userId, user.id),
          eq(dfyTemplateFavouritesTable.templateId, id),
        ),
      );
    res.json({ isFavourite: false }); return;
  }
  await db
    .insert(dfyTemplateFavouritesTable)
    .values({ userId: user.id, templateId: id })
    .onConflictDoNothing();
  res.json({ isFavourite: true }); return;
});

// POST /api/portal/dfy/templates/import-csv  (admin)
//
// Re-imports a single CSV against a single category by invoking the
// shared importer pipeline (manifest join, zip extraction, object-
// storage upload, external-URL fallback download + re-upload).
// Body: { category, subCategory?, csv, assetsDir? }. The importer is
// idempotent on (category, sourceDisplayId).
router.post("/portal/dfy/templates/import-csv", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }

  const body = req.body || {};
  const category = String(body.category || "");
  if (!TEMPLATE_CATEGORIES.has(category)) {
    res.status(400).json({ error: "Unknown category" }); return;
  }
  const csvText = String(body.csv || "");
  if (!csvText) { res.status(400).json({ error: "csv is required" }); return; }
  let subCategory: string | null = body.subCategory ? String(body.subCategory) : null;
  // canva_ad_template is split into three sub-categories that each
  // map to a different manifest type and zip pool. Require the admin
  // to pick one so we don't silently default to monthly_drop and
  // collapse the segmentation.
  if (category === "canva_ad_template") {
    const allowed = new Set(["monthly_drop", "free_template", "previous_drop"]);
    if (!subCategory || !allowed.has(subCategory)) {
      res.status(400).json({
        error:
          "subCategory is required for canva_ad_template (monthly_drop | free_template | previous_drop).",
      }); return;
    }
  } else {
    subCategory = null;
  }
  const assetsDir =
    typeof body.assetsDir === "string" && body.assetsDir
      ? String(body.assetsDir)
      : process.env.DFY_ASSETS_DIR || "attached_assets";

  let rows: DfyCsvRow[];
  try {
    rows = parseDfyCsv<DfyCsvRow>(csvText);
  } catch (err: any) {
    res.status(400).json({ error: `CSV parse failed: ${err?.message}` }); return;
  }

  // landing_page_swipe.csv mixes three categories. Apply the same
  // title-prefix split the CLI uses so the admin can paste the raw
  // export and have each row land in the right category.
  let filter: ((r: DfyCsvRow) => boolean) | undefined;
  if (category === "landing_page_swipe") {
    filter = (r) => /^Landing Swipe/i.test(r.title || "");
  } else if (category === "advertorial_swipe") {
    filter = (r) => /^Advertorial Swipe/i.test(r.title || "");
  } else if (category === "funnel_template") {
    filter = (r) => /^Quiz Funnel/i.test(r.title || "");
  }

  try {
    const report = await runDfyImport({
      category,
      subCategory,
      manifestType: manifestTypeForCategory(category, subCategory),
      csvRows: rows,
      assetsDir,
      filter,
      log: (msg) => req.log.info(msg),
    });
    // Flat shape so the admin UI can read counts directly.
    res.json({
      ok: true,
      category: report.category,
      inserted: report.inserted,
      updated: report.updated,
      skipped: report.skipped,
      missingImage: report.missingImage.length,
      failedDownload: report.failedDownload.length,
    }); return;
  } catch (err: any) {
    req.log.error({ err }, "dfy-import-csv failed");
    res.status(500).json({ error: err?.message || "Import failed" }); return;
  }
});

// =====================================================================
// T257 — DFY Background Reel Music library
// =====================================================================

function shapeBackgroundTrack(row: typeof dfyBackgroundTracksTable.$inferSelect) {
  return {
    id: row.id,
    title: row.displayTitle,
    trackCode: row.trackCode,
    originalFilename: row.originalFilename,
    durationSeconds: row.durationSeconds,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    previewUrl: `/api/portal/dfy/background-music/${row.id}/preview`,
    downloadUrl: `/api/portal/dfy/background-music/${row.id}/download`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// T396: encode/decode the shuffle cursor. We pack the per-visit seed
// and the current offset into a single opaque base64 string so the
// client only has to echo it back to keep ordering consistent across
// infinite-scroll pages within one visit. A fresh first-page request
// (no cursor) generates a brand-new seed, so reload/come-back-later
// surfaces a different slice of the library.
interface BgmCursor {
  seed: string;
  offset: number;
}

function encodeBgmCursor(c: BgmCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeBgmCursor(raw: string): BgmCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.seed === "string" && Number.isFinite(parsed.offset)) {
      return { seed: String(parsed.seed), offset: Math.max(0, Number(parsed.offset)) };
    }
  } catch {
    // fall through
  }
  return null;
}

function newBgmSeed(): string {
  // 9 base36 chars = ~46 bits of entropy, plenty for shuffle keying.
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).slice(0, 12);
}

router.get("/portal/dfy/background-music", async (req, res) => {
  try {
    const user = await loadUser(req, res);
    if (!user) return;
    const access = await hasDfyAccess(user);
    if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

    const q = String(req.query.q || "").trim();
    const qUpper = q.toUpperCase();
    const rawLimit = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(rawLimit, 1), 100);

    // Resolve cursor: explicit value wins, otherwise mint a fresh seed
    // so the first page gets a new shuffle every visit.
    const rawCursor = String(req.query.cursor || "").trim();
    const decoded = rawCursor ? decodeBgmCursor(rawCursor) : null;
    const seed = decoded?.seed ?? newBgmSeed();
    const offset = decoded?.offset ?? 0;

    const conditions = [eq(dfyBackgroundTracksTable.isActive, true)];
    if (q) {
      const cond = or(
        ilike(dfyBackgroundTracksTable.displayTitle, `%${q}%`),
        ilike(dfyBackgroundTracksTable.originalFilename, `%${q}%`),
        ilike(dfyBackgroundTracksTable.trackCode, `%${qUpper}%`),
      );
      if (cond) conditions.push(cond);
    }

    // Stable per-visit shuffle: md5(id || seed). Deterministic for a
    // fixed (id, seed) pair so OFFSET-based pagination never duplicates
    // or skips rows within one visit, but varies across visits because
    // each fresh first-page request mints a new seed. When searching,
    // an exact code match floats to the top before the shuffled tail.
    const orderClauses = q
      ? sql`(${dfyBackgroundTracksTable.trackCode} = ${qUpper}) DESC, md5(${dfyBackgroundTracksTable.id}::text || ${seed}) ASC, ${dfyBackgroundTracksTable.id} ASC`
      : sql`md5(${dfyBackgroundTracksTable.id}::text || ${seed}) ASC, ${dfyBackgroundTracksTable.id} ASC`;

    const rows = await db
      .select()
      .from(dfyBackgroundTracksTable)
      .where(and(...conditions))
      .orderBy(orderClauses)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeBgmCursor({ seed, offset: offset + page.length })
      : null;

    res.json({
      tracks: page.map(shapeBackgroundTrack),
      nextCursor,
      isAdmin: access.isAdmin,
    }); return;
  } catch (err: any) {
    req.log?.error?.({ err: err?.message }, "bgm list failed");
    res.status(500).json({ error: err?.message || "List failed" }); return;
  }
});

async function streamBgmObject(
  req: any,
  res: any,
  id: number,
  kind: "preview" | "download",
) {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }

  const [row] = await db
    .select()
    .from(dfyBackgroundTracksTable)
    .where(eq(dfyBackgroundTracksTable.id, id))
    .limit(1);
  if (!row || !row.isActive) { res.status(404).json({ error: "Not found" }); return; }

  const key = kind === "preview" ? row.previewObjectKey : row.originalObjectKey;
  if (!key) { res.status(404).json({ error: "Asset not ready" }); return; }

  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    res.status(500).json({ error: "Object storage not configured" }); return;
  }

  const file = objectStorageClient
    .bucket(bucketId)
    .file(previewObjectAbsPath(privateDir, key));
  const [exists] = await file.exists();
  if (!exists) { res.status(404).json({ error: "Asset missing" }); return; }

  let metaContentType: string | null = null;
  let metaSize: number | null = null;
  try {
    const [meta] = await file.getMetadata();
    if (typeof meta?.contentType === "string") metaContentType = meta.contentType;
    if (meta?.size != null) {
      const n = Number(meta.size);
      if (Number.isFinite(n) && n > 0) metaSize = n;
    }
  } catch {
    // metadata is best-effort; the stream call below is the source of truth
  }
  const contentType =
    kind === "preview" ? "audio/mpeg" : (row.mimeType || metaContentType || "audio/mpeg");
  const size = metaSize;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  if (size) res.setHeader("Content-Length", String(size));
  if (kind === "preview") {
    res.setHeader("Cache-Control", "private, max-age=86400");
  } else {
    const safe = (row.originalFilename || `track-${row.id}`).replace(/[^\w.\- ]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(
        row.originalFilename || `track-${row.id}`,
      )}`,
    );
  }

  const stream = file.createReadStream();
  stream.on("error", (e) => {
    req.log?.error?.({ err: (e as Error).message }, "bgm stream error");
    if (!res.headersSent) res.status(502);
    res.end();
  });
  stream.pipe(res);
}

// ---- DFY B-Roll library ---------------------------------------------------
//
// T399: paginated library listing for the portal page. Returns imported
// clips only (failed rows are hidden). Supports an optional `pack`
// numeric filter and an optional `q` filename substring search. The
// gate matches every other DFY route: paid customers and admins only.
router.get("/portal/dfy/broll", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) {
    res.status(403).json({ error: "DFY pack required" });
    return;
  }

  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, Math.floor(limitRaw)))
    : 60;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  const packRaw = req.query.pack;
  const packNum = packRaw != null && packRaw !== "" ? Number(packRaw) : NaN;
  const hasPack = Number.isFinite(packNum) && packNum > 0;

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";

  const conditions = [eq(dfyBrollClipsTable.status, "imported")];
  if (hasPack) {
    // packNumbers is int[]; use the @> contains operator so the row is
    // returned when its array contains the requested pack number.
    conditions.push(sql`${dfyBrollClipsTable.packNumbers} @> ARRAY[${packNum}]::int[]`);
  }
  if (q) {
    conditions.push(ilike(dfyBrollClipsTable.originalFilename, `%${q}%`));
  }

  const whereExpr = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [{ count: totalCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dfyBrollClipsTable)
    .where(whereExpr);

  const rows = await db
    .select({
      publicId: dfyBrollClipsTable.publicId,
      originalFilename: dfyBrollClipsTable.originalFilename,
      mimeType: dfyBrollClipsTable.mimeType,
      fileSize: dfyBrollClipsTable.fileSize,
      packNumbers: dfyBrollClipsTable.packNumbers,
    })
    .from(dfyBrollClipsTable)
    .where(whereExpr)
    .orderBy(asc(dfyBrollClipsTable.id))
    .limit(limit)
    .offset(offset);

  // Distinct pack numbers across the entire imported corpus, used by the
  // UI to render filter chips. This is a small list (~18 packs) so the
  // extra query is cheap and avoids a second round-trip.
  const packRows = await db
    .select({ pack: sql<number>`unnest(${dfyBrollClipsTable.packNumbers})` })
    .from(dfyBrollClipsTable)
    .where(eq(dfyBrollClipsTable.status, "imported"));
  const packSet = new Set<number>();
  for (const r of packRows) {
    if (Number.isFinite(r.pack)) packSet.add(Number(r.pack));
  }
  const packs = Array.from(packSet).sort((a, b) => a - b);

  res.json({
    clips: rows.map((r) => ({
      publicId: r.publicId,
      filename: r.originalFilename,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      packNumbers: r.packNumbers,
      playbackUrl: `/api/portal/dfy/broll/${r.publicId}/play`,
      downloadUrl: `/api/portal/dfy/broll/${r.publicId}/download`,
    })),
    total: totalCount,
    limit,
    offset,
    packs,
  });
});

// ---- DFY B-Roll playback --------------------------------------------------
//
// The bulk B-Roll importer (T317/T398) writes one row per unique Drive
// video to dfy_broll_clips and uploads the file to GCS at
// `.private/dfy-broll/<publicId>/<filename>`. The row's `playback_url`
// points here. We stream the GCS object back with Range support so the
// portal's <video> tag can scrub.
router.get("/portal/dfy/broll/:publicId/play", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) {
    res.status(403).json({ error: "DFY pack required" });
    return;
  }
  const publicId = String(req.params.publicId || "");
  if (!publicId) {
    res.status(400).json({ error: "publicId required" });
    return;
  }
  const [row] = await db
    .select()
    .from(dfyBrollClipsTable)
    .where(eq(dfyBrollClipsTable.publicId, publicId))
    .limit(1);
  if (!row || row.status !== "imported") {
    res.status(404).json({ error: "Clip not found" });
    return;
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    res.status(500).json({ error: "Object storage not configured" });
    return;
  }
  // PRIVATE_OBJECT_DIR is "/<bucket>/.private"; importer stores at
  // ".private/<objectKey>" relative to the bucket. Re-derive the object
  // name the same way the importer did.
  const trimmed = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const slashIdx = trimmed.indexOf("/");
  const privatePrefix = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
  const objectName = `${privatePrefix}/${row.objectKey}`;

  const file = objectStorageClient.bucket(bucketId).file(objectName);
  const contentType = row.mimeType || "video/mp4";
  const totalSize = row.fileSize ?? null;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=86400");

  const range = req.headers.range;
  let start = 0;
  let end = totalSize ? totalSize - 1 : undefined;
  if (range && totalSize) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const s = m[1] ? Number(m[1]) : 0;
      const e = m[2] ? Number(m[2]) : totalSize - 1;
      if (Number.isFinite(s) && Number.isFinite(e) && s <= e && e < totalSize) {
        start = s;
        end = e;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        res.setHeader("Content-Length", String(end - start + 1));
      }
    }
  } else if (totalSize) {
    res.setHeader("Content-Length", String(totalSize));
  }

  const stream = file.createReadStream(
    end != null ? { start, end } : start > 0 ? { start } : undefined,
  );
  stream.on("error", (e) => {
    req.log?.error?.({ err: (e as Error).message, publicId }, "broll stream error");
    if (!res.headersSent) res.status(502);
    res.end();
  });
  stream.pipe(res);
});

// T399: per-clip download. Same gate as /play, but forces a download
// (Content-Disposition: attachment) and preserves the original filename
// so saved files match what was in the source Drive folders.
router.get("/portal/dfy/broll/:publicId/download", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const access = await hasDfyAccess(user);
  if (!access.allowed) {
    res.status(403).json({ error: "DFY pack required" });
    return;
  }
  const publicId = String(req.params.publicId || "");
  if (!publicId) {
    res.status(400).json({ error: "publicId required" });
    return;
  }
  const [row] = await db
    .select()
    .from(dfyBrollClipsTable)
    .where(eq(dfyBrollClipsTable.publicId, publicId))
    .limit(1);
  if (!row || row.status !== "imported") {
    res.status(404).json({ error: "Clip not found" });
    return;
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    res.status(500).json({ error: "Object storage not configured" });
    return;
  }
  const trimmed = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const slashIdx = trimmed.indexOf("/");
  const privatePrefix = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
  const objectName = `${privatePrefix}/${row.objectKey}`;
  const file = objectStorageClient.bucket(bucketId).file(objectName);

  // Filename for Content-Disposition. ASCII-safe fallback for old UAs
  // plus the RFC 5987 encoded version so unicode names survive.
  const rawName = row.originalFilename || "broll.mp4";
  const asciiName = rawName.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");
  const encodedName = encodeURIComponent(rawName);

  res.setHeader("Content-Type", row.mimeType || "video/mp4");
  res.setHeader("Cache-Control", "private, max-age=0");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
  );
  if (row.fileSize) res.setHeader("Content-Length", String(row.fileSize));

  const stream = file.createReadStream();
  stream.on("error", (e) => {
    req.log?.error?.({ err: (e as Error).message, publicId }, "broll download stream error");
    if (!res.headersSent) res.status(502);
    res.end();
  });
  stream.pipe(res);
});

router.get("/portal/dfy/background-music/:id/preview", (req, res) =>
  streamBgmObject(req, res, Number(req.params.id), "preview"),
);
router.get("/portal/dfy/background-music/:id/download", (req, res) =>
  streamBgmObject(req, res, Number(req.params.id), "download"),
);

router.post("/portal/admin/dfy/background-music/refresh", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const job = startBackgroundMusicImport();
  res.json({ job }); return;
});

router.get("/portal/admin/dfy/background-music/jobs/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = String(req.params.id || "");
  const job = getBackgroundMusicJob(id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({ job }); return;
});

router.get("/portal/admin/dfy/background-music/active-job", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = getActiveBackgroundMusicJobId();
  const job = id ? getBackgroundMusicJob(id) : null;
  res.json({ job }); return;
});

router.patch("/portal/admin/dfy/background-music/:id", async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }

  const body = req.body || {};
  const patch: Partial<typeof dfyBackgroundTracksTable.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t) { res.status(400).json({ error: "title cannot be empty" }); return; }
    patch.displayTitle = t;
  }
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    patch.sortOrder = body.sortOrder;
  }

  const [row] = await db
    .update(dfyBackgroundTracksTable)
    .set(patch)
    .where(eq(dfyBackgroundTracksTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ track: shapeBackgroundTrack(row) }); return;
});

export default router;
