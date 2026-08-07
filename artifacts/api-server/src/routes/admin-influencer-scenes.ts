// Admin-only bulk uploader for the global AI Influencer scene library
// (`ai_influencer_scenes` table). Lets a super-admin drop a zip whose
// top-level folders are scene categories (e.g. "Interview & Panel",
// "Speaking & Stage", "Outdoor & Casual", ...) and have every image
// inside each folder land in object storage + indexed with that
// category. Companion list / delete / category-rename endpoints power
// the /admin/influencer-scenes page.
//
// All endpoints are gated by requireAuth + requireInfluencerAdmin
// (super-admin OR ADMIN_EMAILS allow-list) - same gate as the existing
// admin-influencer-generations surface. Mutating-by-default so we are
// strict about who can touch the global library.

import { Router, type IRouter } from "express";
import multer from "multer";
import crypto from "node:crypto";
import JSZip from "jszip";
import { Storage } from "@google-cloud/storage";
import { db, aiInfluencerScenesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireInfluencerAdmin } from "../middlewares/requireInfluencerAdmin";

const router: IRouter = Router();

// Per-upload cap: 500 MB. A typical scene folder (30 photos at 5 MB
// each) is ~150 MB, so one folder per request fits comfortably. The
// admin can repeat the upload for each category folder.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const objectStorageClient = new Storage();

// Image entry extensions we accept inside the zip. Everything else
// (.DS_Store, thumbs.db, .txt, nested directory listings, etc) is
// silently skipped.
const ALLOWED_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function mimeForExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

// Pull the leading folder name out of a zip entry path. Returns null
// for files that live at the zip root (we require everything to live
// under a category folder so the mapping is unambiguous). Trailing
// emoji-prefixed folder names like "🎙️ Interview & Panel" are kept
// verbatim - the admin UI shows them as-is, and the pipeline filters
// on whatever the operator typed.
function topLevelFolder(zipPath: string): string | null {
  const parts = zipPath.split("/").filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  return parts[0];
}

// Drop any leading "__MACOSX/" garbage that macOS adds to zips built
// from Finder. Also skip dotfiles like .DS_Store regardless of depth.
function isJunkPath(zipPath: string): boolean {
  if (zipPath.startsWith("__MACOSX/")) return true;
  const segments = zipPath.split("/");
  return segments.some((s) => s.startsWith("."));
}

interface UploadStats {
  perCategory: Record<
    string,
    { inserted: number; skippedDuplicate: number; skippedUnsupported: number; failed: number }
  >;
  totalInserted: number;
  totalSkippedDuplicate: number;
  totalSkippedUnsupported: number;
  totalFailed: number;
}

function emptyCategoryStats() {
  return { inserted: 0, skippedDuplicate: 0, skippedUnsupported: 0, failed: 0 };
}

router.post(
  "/bulk-upload",
  requireAuth,
  requireInfluencerAdmin,
  upload.single("zip"),
  async (req: any, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Missing 'zip' file" });
        return;
      }
      if (!/zip$/i.test(req.file.mimetype) && !/\.zip$/i.test(req.file.originalname)) {
        res.status(400).json({ error: "File must be a .zip" });
        return;
      }
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (!bucketId || !privateDir) {
        res.status(500).json({ error: "Object storage not configured" });
        return;
      }

      // Optional override: the admin can post `categoryOverride=...` in
      // the multipart form to force every image in the zip into a single
      // category, regardless of folder structure. Useful when the
      // operator zipped a flat folder.
      const categoryOverrideRaw = (req.body?.categoryOverride || "").toString().trim();
      const categoryOverride = categoryOverrideRaw ? categoryOverrideRaw.slice(0, 80) : null;

      // Optional gender hint applied to every row in this upload.
      // Defaults to "any" so the pipeline's gender filter accepts the
      // scene for male + female builds.
      const genderHintRaw = (req.body?.genderHint || "").toString().trim().toLowerCase();
      const genderHint = ["any", "female", "male"].includes(genderHintRaw)
        ? genderHintRaw
        : "any";

      const zip = await JSZip.loadAsync(req.file.buffer);
      const stats: UploadStats = {
        perCategory: {},
        totalInserted: 0,
        totalSkippedDuplicate: 0,
        totalSkippedUnsupported: 0,
        totalFailed: 0,
      };

      const bucket = objectStorageClient.bucket(bucketId);

      // Process entries serially. Object storage uploads are network-
      // bound but the admin UI shows a single per-zip progress; we keep
      // this serial so the per-row logs are readable when something
      // fails. A typical 30-image folder finishes in well under a
      // minute on the worker's outbound bandwidth.
      const entries = Object.values(zip.files).filter(
        (e) => !e.dir && !isJunkPath(e.name),
      );

      for (const entry of entries) {
        const category = categoryOverride ?? topLevelFolder(entry.name);
        if (!category) {
          // File at the zip root with no override - skip rather than
          // dump it into a synthetic bucket.
          continue;
        }
        if (!stats.perCategory[category]) {
          stats.perCategory[category] = emptyCategoryStats();
        }
        const bucketStats = stats.perCategory[category];

        const baseName = entry.name.split("/").pop() || entry.name;
        const rawExt = (baseName.split(".").pop() || "").toLowerCase();
        if (!ALLOWED_EXTS.has(rawExt)) {
          bucketStats.skippedUnsupported += 1;
          stats.totalSkippedUnsupported += 1;
          continue;
        }

        try {
          const buf = await entry.async("nodebuffer");
          if (buf.length === 0) {
            bucketStats.skippedUnsupported += 1;
            stats.totalSkippedUnsupported += 1;
            continue;
          }

          // Content hash so re-uploading the same byte sequence is a
          // no-op (`ON CONFLICT DO NOTHING` on drive_file_id).
          const sha = crypto.createHash("sha256").update(buf).digest("hex");
          const driveFileId = `upload:${sha}`;

          // Skip-if-exists short-circuit so we do not waste a GCS upload
          // when the row already exists. Race with another concurrent
          // upload still falls back to the ON CONFLICT DO NOTHING path
          // below.
          const [existing] = await db
            .select({ id: aiInfluencerScenesTable.id })
            .from(aiInfluencerScenesTable)
            .where(eq(aiInfluencerScenesTable.driveFileId, driveFileId));
          if (existing) {
            bucketStats.skippedDuplicate += 1;
            stats.totalSkippedDuplicate += 1;
            continue;
          }

          const fileName = `scene-${crypto.randomUUID()}.${rawExt}`;
          const objectPath = `${privateDir}/${fileName}`;
          const file = bucket.file(objectPath);

          await file.save(buf, {
            contentType: mimeForExt(rawExt),
            metadata: { cacheControl: "public, max-age=31536000" },
          });

          // Match the existing upload-image route: pipeline / UI fetch
          // via the authenticated proxy path, not a raw bucket URL.
          const servePath = `/api/portal/images/${fileName}`;

          const inserted = await db
            .insert(aiInfluencerScenesTable)
            .values({
              driveFileId,
              label: baseName,
              genderHint,
              gcsUrl: servePath,
              enabled: true,
              source: "admin-zip",
              category,
              originalFilename: baseName,
            })
            .onConflictDoNothing({ target: aiInfluencerScenesTable.driveFileId })
            .returning({ id: aiInfluencerScenesTable.id });

          if (inserted.length === 0) {
            // Race: another worker inserted the same hash between our
            // SELECT and INSERT. Treat as duplicate.
            bucketStats.skippedDuplicate += 1;
            stats.totalSkippedDuplicate += 1;
          } else {
            bucketStats.inserted += 1;
            stats.totalInserted += 1;
          }
        } catch (err: any) {
          req.log.warn(
            { err: err?.message, entry: entry.name, category },
            "admin-influencer-scenes: bulk-upload entry failed",
          );
          bucketStats.failed += 1;
          stats.totalFailed += 1;
        }
      }

      req.log.info(
        {
          adminClerkId: req.auth?.userId,
          totalInserted: stats.totalInserted,
          totalSkippedDuplicate: stats.totalSkippedDuplicate,
          totalSkippedUnsupported: stats.totalSkippedUnsupported,
          totalFailed: stats.totalFailed,
          categories: Object.keys(stats.perCategory),
        },
        "admin-influencer-scenes: bulk-upload finished",
      );

      res.json({
        ok: true,
        stats,
        zipSizeBytes: req.file.size,
        zipName: req.file.originalname,
      });
    } catch (err: any) {
      req.log.error(
        { err: err?.message, stack: err?.stack },
        "admin-influencer-scenes: bulk-upload failed",
      );
      res.status(500).json({ error: "internal_error", message: err?.message });
    }
  },
);

// Per-category counts so the admin page can show a roll-up of the
// current library state. Includes both Drive-synced and admin-zip rows
// so the page is a true library overview.
router.get("/stats", requireAuth, requireInfluencerAdmin, async (req: any, res) => {
  try {
    const rows = await db
      .select({
        source: aiInfluencerScenesTable.source,
        category: aiInfluencerScenesTable.category,
        genderHint: aiInfluencerScenesTable.genderHint,
        enabled: aiInfluencerScenesTable.enabled,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInfluencerScenesTable)
      .groupBy(
        aiInfluencerScenesTable.source,
        aiInfluencerScenesTable.category,
        aiInfluencerScenesTable.genderHint,
        aiInfluencerScenesTable.enabled,
      );

    let totalAll = 0;
    let totalEnabled = 0;
    for (const r of rows) {
      const c = Number(r.count);
      totalAll += c;
      if (r.enabled) totalEnabled += c;
    }

    res.json({
      totalAll,
      totalEnabled,
      rows: rows.map((r) => ({
        source: r.source,
        category: r.category,
        genderHint: r.genderHint,
        enabled: r.enabled,
        count: Number(r.count),
      })),
    });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "admin-influencer-scenes: stats failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// Paginated list filtered by source / category / enabled / gender.
// Default returns the most recent 100 admin-zip rows so the page lands
// on the operator's own uploads rather than the giant Drive catalog.
router.get("/", requireAuth, requireInfluencerAdmin, async (req: any, res) => {
  try {
    const source = (req.query.source || "").toString();
    const category = (req.query.category || "").toString();
    const enabledRaw = (req.query.enabled || "").toString();
    const limit = Math.max(1, Math.min(500, parseInt((req.query.limit || "100").toString(), 10) || 100));

    const conds: any[] = [];
    if (source) conds.push(eq(aiInfluencerScenesTable.source, source));
    if (category) conds.push(eq(aiInfluencerScenesTable.category, category));
    if (enabledRaw === "true") conds.push(eq(aiInfluencerScenesTable.enabled, true));
    if (enabledRaw === "false") conds.push(eq(aiInfluencerScenesTable.enabled, false));

    const rows = await db
      .select()
      .from(aiInfluencerScenesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(aiInfluencerScenesTable.createdAt))
      .limit(limit);

    res.json({ rows });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "admin-influencer-scenes: list failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// Toggle a single row enabled / disabled. Disabling keeps the GCS
// object + row so we can re-enable without re-uploading; the pipeline
// only picks scenes where enabled=true.
router.patch("/:id/enabled", requireAuth, requireInfluencerAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    const enabled = req.body?.enabled === true;
    const [row] = await db
      .update(aiInfluencerScenesTable)
      .set({ enabled })
      .where(eq(aiInfluencerScenesTable.id, id))
      .returning({ id: aiInfluencerScenesTable.id, enabled: aiInfluencerScenesTable.enabled });
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true, id: row.id, enabled: row.enabled });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "admin-influencer-scenes: toggle failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// Hard-delete a row. Does NOT delete the underlying GCS object so a
// fat-fingered click in the admin UI is recoverable from bucket history.
// Re-uploading the same byte sequence will re-create the row with the
// same `upload:<sha>` id.
router.delete("/:id", requireAuth, requireInfluencerAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad_id" });
      return;
    }
    const [row] = await db
      .delete(aiInfluencerScenesTable)
      .where(eq(aiInfluencerScenesTable.id, id))
      .returning({ id: aiInfluencerScenesTable.id });
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true, id: row.id });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "admin-influencer-scenes: delete failed");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
