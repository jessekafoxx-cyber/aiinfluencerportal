import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  aiInfluencersTable,
  influencerAnglesTable,
  influencerSettingsTable,
  settingImagesTable,
  type AiInfluencer,
  type InfluencerAngle,
  type InfluencerSetting,
  type SettingImage,
} from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Dedicated multer for /manual: enforces the same 10MB/file limit the
// modal advertises and caps total uploaded files so a crafted request
// cannot pin memory by streaming 41 large multipart parts at once.
const manualUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1 + 20 + 20, // mainImage + angleImages + settingImages caps
  },
});

// Wraps a multer middleware so any error (file too large, bad field name, etc.)
// is surfaced as a JSON 400 instead of falling through to the default Express
// error handler, which would otherwise silently 500 with no useful body.
function multerSafe(mw: (req: Request, res: Response, next: (err?: unknown) => void) => void) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    mw(req, res, (err?: unknown) => {
      if (err) {
        const anyErr = err as { code?: string; message?: string };
        logger.warn({ err }, "influencers: multer rejected upload");
        res.status(400).json({
          error: "upload_failed",
          code: anyErr?.code ?? "unknown",
          message: anyErr?.message ?? "Upload failed",
        }); return;
      }
      next();
    });
  };
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "gif", "webp"];

async function uploadBufferPublic(
  buffer: Buffer,
  mimetype: string,
  originalName: string,
  prefix = "",
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error("object_storage_not_configured");
  }
  const rawExt = (originalName.split(".").pop() || "").toLowerCase();
  const ext = ALLOWED_EXTS.includes(rawExt) ? rawExt : "png";
  const fileName = `${prefix}${crypto.randomUUID()}.${ext}`;
  const objectPath = `${privateDir}/${fileName}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  // Single retry with backoff for transient GCS failures (5xx, ECONN*,
  // ETIMEDOUT, EAI_AGAIN). A successful save followed by a flaky save on
  // the next file in a batch was a common cause of the generic
  // "Failed to upload" / 500 path on angle/setting uploads.
  try {
    await file.save(buffer, {
      contentType: mimetype,
      metadata: { cacheControl: "public, max-age=31536000" },
    });
  } catch (err: any) {
    const status = err?.code ?? err?.response?.status;
    const errno = err?.errno ?? err?.cause?.code;
    const transient =
      (typeof status === "number" && status >= 500) ||
      errno === "ECONNRESET" ||
      errno === "ECONNREFUSED" ||
      errno === "ETIMEDOUT" ||
      errno === "EAI_AGAIN";
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 750 + Math.floor(Math.random() * 500)));
    await file.save(buffer, {
      contentType: mimetype,
      metadata: { cacheControl: "public, max-age=31536000" },
    });
  }
  return `/api/portal/images/${fileName}`;
}

// Upload an inline (base64-encoded) image returned by an AI model. Picks an
// extension from the mime type and re-uses the same public path convention as
// uploadBufferPublic so the existing /api/portal/images/:fileName route can
// serve it.
async function uploadInlineImage(
  b64: string,
  mimeType: string,
  prefix = "",
): Promise<string> {
  const buffer = Buffer.from(b64, "base64");
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg")
    ? "jpg"
    : mimeType.includes("webp")
    ? "webp"
    : mimeType.includes("gif")
    ? "gif"
    : "png";
  return uploadBufferPublic(buffer, mimeType, `gen.${ext}`, prefix);
}

async function fetchImageAsInline(
  url: string,
): Promise<{ data: string; mimeType: string }> {
  // /api/portal/images/<file> is served by the API server itself; we resolve
  // the GCS object directly to avoid round-tripping through HTTP and to keep
  // this working in any deploy where the public URL host is different.
  const m = url.match(/\/api\/portal\/images\/([^/?#]+)$/);
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (m && bucketId && privateDir) {
    const fileName = m[1];
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(`${privateDir}/${fileName}`);
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    return {
      data: buf.toString("base64"),
      mimeType: (meta.contentType as string) || "image/png",
    };
  }
  // Fallback: fetch via HTTP (e.g. an external avatarUrl).
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`failed_to_fetch_avatar:${resp.status}`);
  const ab = await resp.arrayBuffer();
  return {
    data: Buffer.from(ab).toString("base64"),
    mimeType: resp.headers.get("content-type") || "image/png",
  };
}

// 12 angle directives, kept brief so the model can interpret them as
// camera/pose changes while preserving the subject's identity.
const ANGLE_DIRECTIVES: { label: string; instruction: string }[] = [
  { label: "Front straight", instruction: "Front-facing portrait, eyes to camera, neutral expression." },
  { label: "Three-quarter left", instruction: "Three-quarter view from her left side, soft smile, eyes to camera." },
  { label: "Three-quarter right", instruction: "Three-quarter view from her right side, soft smile, eyes to camera." },
  { label: "Profile left", instruction: "Strict left profile, looking forward, no eye contact with camera." },
  { label: "Profile right", instruction: "Strict right profile, looking forward, no eye contact with camera." },
  { label: "Looking up", instruction: "Front view, chin lowered slightly, eyes glancing up to camera." },
  { label: "Looking down", instruction: "Front view, eyes softly cast down, contemplative." },
  { label: "Over-the-shoulder left", instruction: "Back of head visible, looking back over her left shoulder at camera." },
  { label: "Over-the-shoulder right", instruction: "Back of head visible, looking back over her right shoulder at camera." },
  { label: "Laughing candid", instruction: "Front-facing, genuine laugh, eyes nearly closed, candid energy." },
  { label: "Serious editorial", instruction: "Front-facing, serious editorial expression, lips closed, sharp eyes." },
  { label: "Wide grin to camera", instruction: "Front-facing, wide confident grin, full teeth, eyes to camera." },
];

const ANGLE_PRESERVE = "Preserve the exact same person, identical face, hair, skin tone, body type, age, and outfit as the reference image. Studio quality photograph, consistent lighting, neutral background.";

// Lazy-loaded to avoid TS6305 from the gemini lib's pre-existing composite
// build issues; tsx resolves the source directly at runtime.
async function getGenerateProImage() {
  const mod = await import(
    "@workspace/integrations-gemini-ai/image" as any
  );
  return mod.generateProImage as (opts: {
    prompt: string;
    inputImages?: { data: string; mimeType: string }[];
  }) => Promise<{ b64_json: string; mimeType: string }>;
}

async function generateAvatarFromPrompt(
  mainImagePrompt: unknown,
): Promise<{ url: string; promptUsed: any }> {
  const promptText = typeof mainImagePrompt === "string"
    ? mainImagePrompt
    : JSON.stringify(mainImagePrompt, null, 2);
  const wrapped = `Generate a single, photorealistic, high-resolution portrait photograph of an AI influencer using the following structured prompt. Output exactly one image.\n\n${promptText}`;
  const generateProImage = await getGenerateProImage();
  const out = await generateProImage({ prompt: wrapped });
  const url = await uploadInlineImage(out.b64_json, out.mimeType, "inf-main-");
  return { url, promptUsed: mainImagePrompt };
}

async function loadOwnedInfluencer(
  influencerId: number,
  userId: number,
): Promise<AiInfluencer | null> {
  const [row] = await db
    .select()
    .from(aiInfluencersTable)
    .where(
      and(
        eq(aiInfluencersTable.id, influencerId),
        eq(aiInfluencersTable.clientId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

interface InfluencerWithCounts extends AiInfluencer {
  anglesCount: number;
  settingsCount: number;
}

// Strict allowlist for buyer-supplied display names. Permits Unicode
// letters/digits, spaces, hyphens, apostrophes, and periods. Blocks
// every character used in HTML/script injection (`<`, `>`, `&`, `/`,
// `\`, `;`, `"`, `=`, `(`, `)`, etc.). Trim + length checked by the
// caller so this regex only validates the character set.
const CUSTOM_NAME_PATTERN = /^[\p{L}\p{N} .'\-]+$/u;

export type CustomNameValidation =
  | { ok: true; value: string }
  | { ok: false; code: "name_required" | "name_too_long" | "name_invalid_chars" };

export function validateCustomName(raw: unknown): CustomNameValidation {
  if (typeof raw !== "string") return { ok: false, code: "name_required" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, code: "name_required" };
  if (trimmed.length > 50) return { ok: false, code: "name_too_long" };
  if (!CUSTOM_NAME_PATTERN.test(trimmed)) {
    return { ok: false, code: "name_invalid_chars" };
  }
  return { ok: true, value: trimmed };
}

// Fold custom_name into the `name` surface so every consumer (list
// card, detail header, jobs status screen, search filter, etc.)
// reflects the rename without code changes. The raw `name` column
// is preserved on a `_rawName` companion field for the rare caller
// that needs the auto-generated value (e.g. admin tooling).
export function withDisplayName<T extends AiInfluencer>(
  row: T,
): T & { customName: string | null } {
  const custom = row.customName ?? null;
  return {
    ...row,
    name: custom && custom.length > 0 ? custom : row.name,
    customName: custom,
  };
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  try {
    const rows = await db
      .select()
      .from(aiInfluencersTable)
      .where(eq(aiInfluencersTable.clientId, userId))
      .orderBy(desc(aiInfluencersTable.id));

    if (rows.length === 0) {
      res.json({ influencers: [] as InfluencerWithCounts[] }); return;
    }
    const ids = rows.map((r) => r.id);

    const angleCounts = await db
      .select({
        influencerId: influencerAnglesTable.influencerId,
        c: sql<number>`count(*)::int`,
      })
      .from(influencerAnglesTable)
      .where(inArray(influencerAnglesTable.influencerId, ids))
      .groupBy(influencerAnglesTable.influencerId);

    const settingCounts = await db
      .select({
        influencerId: influencerSettingsTable.influencerId,
        c: sql<number>`count(*)::int`,
      })
      .from(influencerSettingsTable)
      .where(inArray(influencerSettingsTable.influencerId, ids))
      .groupBy(influencerSettingsTable.influencerId);

    const angleMap = new Map(angleCounts.map((r) => [r.influencerId, r.c]));
    const settingMap = new Map(settingCounts.map((r) => [r.influencerId, r.c]));

    const influencers: InfluencerWithCounts[] = rows.map((r) => ({
      ...withDisplayName(r),
      anglesCount: angleMap.get(r.id) ?? 0,
      settingsCount: settingMap.get(r.id) ?? 0,
    }));
    res.json({ influencers }); return;
  } catch (err) {
    logger.error({ err }, "influencers: list failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────
// CREATE  (just a name + optional niche)
// ─────────────────────────────────────────────────────────────
const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  gender: z.string().trim().min(1).max(40),
  ageRange: z.string().trim().min(1).max(40),
});

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const parsed = createBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "bad_body", issues: parsed.error.issues }); return;
  }
  const { name, gender, ageRange } = parsed.data;
  try {
    const [row] = await db
      .insert(aiInfluencersTable)
      .values({
        clientId: userId,
        name,
        gender,
        ageRange,
        status: "active",
      })
      .returning();
    res.status(201).json({ influencer: row }); return;
  } catch (err) {
    req.log.error({ err }, "influencers: create failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────
// CREATE MANUAL  (buyer-uploaded gallery; bypasses paywall + cap)
// ─────────────────────────────────────────────────────────────
// Multipart form with fields:
//   - name        (text, required, 1-50 chars)
//   - mainImage   (file, required, single image)
//   - angleImages   (files, optional, up to 20 images)
//   - settingImages (files, optional, up to 20 images, grouped as one
//                    "Uploaded" setting on the influencer detail page)
// The created influencer is `source='manual'`, `status='active'`,
// has no `ai_influencer_jobs` row, and is therefore invisible to the
// generation-cap counter + the Viktor pipeline. It renders in the
// gallery identically to AI-generated influencers and is fully
// editable (add/remove angles + settings via existing routes).
router.post(
  "/manual",
  requireAuth,
  multerSafe(
    manualUpload.fields([
      { name: "mainImage", maxCount: 1 },
      { name: "angleImages", maxCount: 20 },
      { name: "settingImages", maxCount: 20 },
    ]),
  ),
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!rawName || rawName.length > 50) {
      res.status(400).json({ error: "bad_name", message: "Name is required (1-50 chars)" });
      return;
    }
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const mainFiles = files.mainImage ?? [];
    if (mainFiles.length !== 1) {
      res.status(400).json({ error: "missing_main_image", message: "Main portrait is required" });
      return;
    }
    const angleFiles = files.angleImages ?? [];
    const settingFiles = files.settingImages ?? [];
    const all = [...mainFiles, ...angleFiles, ...settingFiles];
    for (const f of all) {
      if (!ALLOWED_TYPES.includes(f.mimetype)) {
        res.status(400).json({
          error: "bad_file_type",
          message: `Unsupported file type: ${f.originalname}. Use JPG, PNG, GIF, or WebP.`,
        });
        return;
      }
    }

    // 1) Upload every image to object storage FIRST, before touching the
    //    database. Storage writes are not transactional, so doing them
    //    up front means the DB write below is the only thing inside the
    //    transaction and a storage hiccup can't leave a half-created
    //    influencer behind. Each phase returns its own actionable 502 so
    //    the buyer learns which image failed instead of a generic error.
    const mainFile = mainFiles[0]!;
    let avatarUrl: string;
    try {
      avatarUrl = await uploadBufferPublic(
        mainFile.buffer,
        mainFile.mimetype,
        mainFile.originalname,
        "manual.main.",
      );
    } catch (err) {
      req.log.error({ err }, "influencers: manual main-image upload failed");
      res.status(502).json({
        error: "image_upload_failed",
        message:
          "We couldn't save your main portrait. Please try again, or use a smaller image (under 10 MB).",
      });
      return;
    }

    // Always include the main portrait as the first angle so the detail
    // page shows a portrait card even if the buyer skipped the angles
    // section entirely.
    const angleUploads: Array<{ url: string; label: string }> = [
      { url: avatarUrl, label: "Portrait" },
    ];
    try {
      let idx = 0;
      for (const f of angleFiles) {
        const url = await uploadBufferPublic(
          f.buffer,
          f.mimetype,
          f.originalname,
          "manual.angle.",
        );
        angleUploads.push({ url, label: `Angle ${++idx}` });
      }
    } catch (err) {
      req.log.error({ err }, "influencers: manual angle upload failed");
      res.status(502).json({
        error: "image_upload_failed",
        message:
          "We couldn't save one of your angle images. Please try again, or use smaller images (under 10 MB each).",
      });
      return;
    }

    const settingUploads: Array<{ url: string; label: string }> = [];
    try {
      let sIdx = 0;
      for (const f of settingFiles) {
        const url = await uploadBufferPublic(
          f.buffer,
          f.mimetype,
          f.originalname,
          "manual.setting.",
        );
        settingUploads.push({ url, label: `Scene ${++sIdx}` });
      }
    } catch (err) {
      req.log.error({ err }, "influencers: manual setting upload failed");
      res.status(502).json({
        error: "image_upload_failed",
        message:
          "We couldn't save one of your scene images. Please try again, or use smaller images (under 10 MB each).",
      });
      return;
    }

    // 2) Persist the influencer + angles + settings atomically. We
    //    deliberately do NOT collide with the partial unique index
    //    `ai_influencers_client_autoname_uq` (it only fires on names
    //    matching 'Influencer %') because we store the buyer's typed name
    //    in `customName` with a distinct raw `name` fallback. Wrapping all
    //    inserts in one transaction means a failure on the angle/setting
    //    insert rolls back the influencer row too, so the buyer never ends
    //    up with an orphaned, nameless influencer (the old non-transactional
    //    flow committed the influencer first, then 500'd on a later insert).
    const rawNameValue = `Manual ${crypto.randomUUID().slice(0, 8)}`;
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(aiInfluencersTable)
          .values({
            clientId: userId,
            name: rawNameValue,
            customName: rawName,
            status: "active",
            source: "manual",
            avatarUrl,
          })
          .returning();
        if (!row) throw new Error("influencer insert returned no row");

        await tx.insert(influencerAnglesTable).values(
          angleUploads.map((a, i) => ({
            influencerId: row.id,
            imageUrl: a.url,
            label: a.label,
            sortOrder: i,
          })),
        );

        // All uploaded scenes go into ONE setting group called "Uploaded"
        // so they render on the detail page under a single section. The
        // buyer can rename / split via the existing setting routes later.
        if (settingUploads.length > 0) {
          const [settingRow] = await tx
            .insert(influencerSettingsTable)
            .values({
              influencerId: row.id,
              name: "Uploaded",
              description: "Scenes you uploaded yourself.",
              sortOrder: 0,
            })
            .returning();
          if (!settingRow) throw new Error("setting insert returned no row");
          await tx.insert(settingImagesTable).values(
            settingUploads.map((s, i) => ({
              settingId: settingRow.id,
              imageUrl: s.url,
              label: s.label,
              sortOrder: i,
            })),
          );
        }

        return row;
      });

      res.status(201).json({ influencer: withDisplayName(created) });
      return;
    } catch (err) {
      // Surface a real, actionable message instead of an opaque
      // "internal_error". Drizzle wraps DB failures with the full SQL text,
      // which we must not leak to the buyer, so SQL-shaped errors collapse
      // to a clean message while genuine app errors (e.g. a misconfigured
      // bucket) pass through. The full error + stack always stay in the log.
      req.log.error({ err }, "influencers: manual create failed");
      const raw = err instanceof Error && err.message ? err.message : "Unexpected error";
      const looksLikeSql =
        /failed query|insert into|select .+ from|syntax error|duplicate key|violates|constraint/i.test(
          raw,
        );
      const message = looksLikeSql
        ? "We couldn't save your influencer due to a database error. Please try again, and contact support if it keeps happening."
        : `We couldn't save your influencer: ${raw.slice(0, 200)}`;
      res.status(500).json({ error: "manual_create_failed", message });
      return;
    }
  },
);

interface InfluencerSettingWithImages extends InfluencerSetting {
  images: SettingImage[];
}
interface InfluencerDetailResponse {
  influencer: AiInfluencer;
  angles: InfluencerAngle[];
  settings: InfluencerSettingWithImages[];
}

// ─────────────────────────────────────────────────────────────
// DETAIL
// ─────────────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const influencer = await loadOwnedInfluencer(id, userId);
    if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

    const angles = await db
      .select()
      .from(influencerAnglesTable)
      .where(eq(influencerAnglesTable.influencerId, id))
      .orderBy(influencerAnglesTable.sortOrder, influencerAnglesTable.id);

    const settings = await db
      .select()
      .from(influencerSettingsTable)
      .where(eq(influencerSettingsTable.influencerId, id))
      .orderBy(influencerSettingsTable.sortOrder, influencerSettingsTable.id);

    let images: SettingImage[] = [];
    if (settings.length > 0) {
      images = await db
        .select()
        .from(settingImagesTable)
        .where(
          inArray(
            settingImagesTable.settingId,
            settings.map((s) => s.id),
          ),
        )
        .orderBy(settingImagesTable.sortOrder, settingImagesTable.id);
    }

    const settingsWithImages: InfluencerSettingWithImages[] = settings.map(
      (s) => ({ ...s, images: images.filter((img) => img.settingId === s.id) }),
    );

    const response: InfluencerDetailResponse = {
      influencer: withDisplayName(influencer),
      angles,
      settings: settingsWithImages,
    };
    res.json(response); return;
  } catch (err) {
    logger.error({ err }, "influencers: get failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────
// RENAME / DELETE INFLUENCER
// ─────────────────────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  const body = (req.body ?? {}) as { name?: string; niche?: string | null };
  try {
    const influencer = await loadOwnedInfluencer(id, userId);
    if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

    const patch: Partial<AiInfluencer> = {};
    if (typeof body.name === "string") {
      const n = body.name.trim();
      if (!n) { res.status(400).json({ error: "name_required" }); return; }
      patch.name = n.slice(0, 120);
    }
    if (body.niche !== undefined) {
      patch.niche = body.niche ? String(body.niche).slice(0, 200) : null;
    }
    if (Object.keys(patch).length === 0) {
      res.json({ influencer }); return;
    }
    const [row] = await db
      .update(aiInfluencersTable)
      .set(patch)
      .where(eq(aiInfluencersTable.id, id))
      .returning();
    res.json({ influencer: row }); return;
  } catch (err) {
    logger.error({ err }, "influencers: patch failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// PATCH /:id/name - inline buyer-driven rename. Writes the dedicated
// `custom_name` column instead of `name` so the auto-name dedupe index
// keeps working. Owner-only. Responds with the previous display name
// (custom if one was set, otherwise the auto-name) so the client can
// undo/toast.
router.patch("/:id/name", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  const body = (req.body ?? {}) as { name?: unknown };
  const validation = validateCustomName(body.name);
  if (!validation.ok) { res.status(400).json({ error: validation.code }); return; }
  try {
    const influencer = await loadOwnedInfluencer(id, userId);
    if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
    const previousName = influencer.customName?.trim()
      ? influencer.customName
      : influencer.name;
    const [row] = await db
      .update(aiInfluencersTable)
      .set({ customName: validation.value })
      .where(eq(aiInfluencersTable.id, id))
      .returning();
    res.json({
      id: row.id,
      customName: row.customName,
      previousName,
    });
    return;
  } catch (err) {
    logger.error({ err, id, userId }, "influencers: rename failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.appUser?.id as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
  try {
    const influencer = await loadOwnedInfluencer(id, userId);
    if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
    await db.delete(aiInfluencersTable).where(eq(aiInfluencersTable.id, id));
    res.json({ ok: true }); return;
  } catch (err) {
    logger.error({ err }, "influencers: delete failed");
    res.status(500).json({ error: "internal_error" }); return;
  }
});

// ─────────────────────────────────────────────────────────────
// MAIN IMAGE
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/main-image",
  requireAuth,
  multerSafe(upload.single("image")),
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    if (!req.file) { res.status(400).json({ error: "no_file" }); return; }
    if (!ALLOWED_TYPES.includes(req.file.mimetype)) {
      res.status(400).json({ error: "bad_mimetype" }); return;
    }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      const url = await uploadBufferPublic(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        "inf-main-",
      );
      const [row] = await db
        .update(aiInfluencersTable)
        .set({ avatarUrl: url })
        .where(eq(aiInfluencersTable.id, id))
        .returning();
      res.json({ influencer: row }); return;
    } catch (err) {
      logger.error({ err }, "influencers: main-image upload failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.delete(
  "/:id/main-image",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      const [row] = await db
        .update(aiInfluencersTable)
        .set({ avatarUrl: null })
        .where(eq(aiInfluencersTable.id, id))
        .returning();
      res.json({ influencer: row }); return;
    } catch (err) {
      logger.error({ err }, "influencers: main-image delete failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

// ─────────────────────────────────────────────────────────────
// ANGLES
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/angles",
  requireAuth,
  multerSafe(upload.array("images", 12)),
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    const allFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (allFiles.length === 0) {
      res.status(400).json({
        error: "no_files",
        code: "invalid_photo",
        message: "Please attach at least one photo (JPG, PNG, GIF, or WebP).",
      });
      return;
    }
    const empty = allFiles.find((f) => !f.buffer || f.size === 0);
    if (empty) {
      res.status(400).json({
        error: "empty_file",
        code: "invalid_photo",
        message: `"${empty.originalname || "your photo"}" is empty or could not be read. Please re-export it and try again.`,
      });
      return;
    }
    const oversize = allFiles.find((f) => f.size > 100 * 1024 * 1024);
    if (oversize) {
      res.status(400).json({
        error: "file_too_large",
        code: "invalid_photo",
        message: `"${oversize.originalname}" is over 100 MB. Please re-export it smaller and try again.`,
      });
      return;
    }
    const badType = allFiles.find((f) => !ALLOWED_TYPES.includes(f.mimetype));
    if (badType) {
      res.status(400).json({
        error: "bad_mime",
        code: "invalid_photo",
        message: `"${badType.originalname}" is not a supported image type. Please upload a JPG, PNG, GIF, or WebP.`,
      });
      return;
    }
    const files = allFiles;
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

      const [{ maxOrder }] = await db
        .select({
          maxOrder: sql<number>`coalesce(max(${influencerAnglesTable.sortOrder}), -1)::int`,
        })
        .from(influencerAnglesTable)
        .where(eq(influencerAnglesTable.influencerId, id));

      const inserted: InfluencerAngle[] = [];
      let nextOrder = (maxOrder ?? -1) + 1;
      for (const file of files) {
        const url = await uploadBufferPublic(
          file.buffer,
          file.mimetype,
          file.originalname,
          "inf-angle-",
        );
        const [row] = await db
          .insert(influencerAnglesTable)
          .values({
            influencerId: id,
            label: null,
            imageUrl: url,
            prompt: null,
            sortOrder: nextOrder++,
          })
          .returning();
        inserted.push(row);
      }
      res.status(201).json({ angles: inserted }); return;
    } catch (err) {
      logger.error({ err }, "influencers: angles upload failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.delete(
  "/:id/angles/:angleId",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    const angleId = Number(req.params.angleId);
    if (!Number.isFinite(id) || !Number.isFinite(angleId)) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      await db
        .delete(influencerAnglesTable)
        .where(
          and(
            eq(influencerAnglesTable.id, angleId),
            eq(influencerAnglesTable.influencerId, id),
          ),
        );
      res.json({ ok: true }); return;
    } catch (err) {
      logger.error({ err }, "influencers: angle delete failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

// ─────────────────────────────────────────────────────────────
// SETTINGS  (custom user-named buckets like Podcast, Car, Walking)
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/settings",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    const body = (req.body ?? {}) as { name?: string; description?: string | null };
    const name = String(body.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name_required" }); return; }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

      const [{ maxOrder }] = await db
        .select({
          maxOrder: sql<number>`coalesce(max(${influencerSettingsTable.sortOrder}), -1)::int`,
        })
        .from(influencerSettingsTable)
        .where(eq(influencerSettingsTable.influencerId, id));

      const [row] = await db
        .insert(influencerSettingsTable)
        .values({
          influencerId: id,
          name: name.slice(0, 80),
          description: body.description ? String(body.description).slice(0, 400) : null,
          sortOrder: (maxOrder ?? -1) + 1,
        })
        .returning();
      res.status(201).json({ setting: { ...row, images: [] } }); return;
    } catch (err) {
      logger.error({ err }, "influencers: setting create failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.patch(
  "/:id/settings/:settingId",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    const settingId = Number(req.params.settingId);
    if (!Number.isFinite(id) || !Number.isFinite(settingId)) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    const body = (req.body ?? {}) as { name?: string; description?: string | null };
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

      const patch: Partial<InfluencerSetting> = {};
      if (typeof body.name === "string") {
        const n = body.name.trim();
        if (!n) { res.status(400).json({ error: "name_required" }); return; }
        patch.name = n.slice(0, 80);
      }
      if (body.description !== undefined) {
        patch.description = body.description
          ? String(body.description).slice(0, 400)
          : null;
      }
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: "nothing_to_update" }); return;
      }
      const [row] = await db
        .update(influencerSettingsTable)
        .set(patch)
        .where(
          and(
            eq(influencerSettingsTable.id, settingId),
            eq(influencerSettingsTable.influencerId, id),
          ),
        )
        .returning();
      if (!row) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ setting: row }); return;
    } catch (err) {
      logger.error({ err }, "influencers: setting patch failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.delete(
  "/:id/settings/:settingId",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    const settingId = Number(req.params.settingId);
    if (!Number.isFinite(id) || !Number.isFinite(settingId)) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      await db
        .delete(influencerSettingsTable)
        .where(
          and(
            eq(influencerSettingsTable.id, settingId),
            eq(influencerSettingsTable.influencerId, id),
          ),
        );
      res.json({ ok: true }); return;
    } catch (err) {
      logger.error({ err }, "influencers: setting delete failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.post(
  "/:id/settings/:settingId/images",
  requireAuth,
  multerSafe(upload.array("images", 20)),
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    const settingId = Number(req.params.settingId);
    if (!Number.isFinite(id) || !Number.isFinite(settingId)) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    const allFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (allFiles.length === 0) {
      res.status(400).json({
        error: "no_files",
        code: "invalid_photo",
        message: "Please attach at least one photo (JPG, PNG, GIF, or WebP).",
      }); return;
    }
    const oversize = allFiles.find((f) => f.size > 100 * 1024 * 1024);
    if (oversize) {
      res.status(400).json({
        error: "file_too_large",
        code: "invalid_photo",
        message: `"${oversize.originalname}" is over 100 MB. Please re-export it smaller and try again.`,
      }); return;
    }
    const badType = allFiles.find((f) => !ALLOWED_TYPES.includes(f.mimetype));
    if (badType) {
      res.status(400).json({
        error: "bad_mime",
        code: "invalid_photo",
        message: `"${badType.originalname}" is not a supported image type. Please upload a JPG, PNG, GIF, or WebP.`,
      }); return;
    }
    const files = allFiles;
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

      const [setting] = await db
        .select()
        .from(influencerSettingsTable)
        .where(
          and(
            eq(influencerSettingsTable.id, settingId),
            eq(influencerSettingsTable.influencerId, id),
          ),
        )
        .limit(1);
      if (!setting) { res.status(404).json({ error: "setting_not_found" }); return; }

      const [{ maxOrder }] = await db
        .select({
          maxOrder: sql<number>`coalesce(max(${settingImagesTable.sortOrder}), -1)::int`,
        })
        .from(settingImagesTable)
        .where(eq(settingImagesTable.settingId, settingId));

      const inserted: SettingImage[] = [];
      let nextOrder = (maxOrder ?? -1) + 1;
      for (const file of files) {
        const url = await uploadBufferPublic(
          file.buffer,
          file.mimetype,
          file.originalname,
          "inf-setimg-",
        );
        const [row] = await db
          .insert(settingImagesTable)
          .values({
            settingId,
            imageUrl: url,
            label: null,
            prompt: null,
            sortOrder: nextOrder++,
          })
          .returning();
        inserted.push(row);
      }
      res.status(201).json({ images: inserted }); return;
    } catch (err) {
      logger.error({ err }, "influencers: setting images upload failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

router.delete(
  "/:id/settings/:settingId/images/:imageId",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    const settingId = Number(req.params.settingId);
    const imageId = Number(req.params.imageId);
    if (
      !Number.isFinite(id) ||
      !Number.isFinite(settingId) ||
      !Number.isFinite(imageId)
    ) {
      res.status(400).json({ error: "bad_id" }); return;
    }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }

      const [setting] = await db
        .select()
        .from(influencerSettingsTable)
        .where(
          and(
            eq(influencerSettingsTable.id, settingId),
            eq(influencerSettingsTable.influencerId, id),
          ),
        )
        .limit(1);
      if (!setting) { res.status(404).json({ error: "setting_not_found" }); return; }

      await db
        .delete(settingImagesTable)
        .where(
          and(
            eq(settingImagesTable.id, imageId),
            eq(settingImagesTable.settingId, settingId),
          ),
        );
      res.json({ ok: true }); return;
    } catch (err) {
      logger.error({ err }, "influencers: setting image delete failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

// ─────────────────────────────────────────────────────────────
// AI GENERATION  (Gemini Nano Banana Pro - gemini-3-pro-image-preview)
// ─────────────────────────────────────────────────────────────

const generateMainBody = z.object({
  mainImagePrompt: z.union([z.string().min(1), z.record(z.string(), z.any())]),
});

router.post(
  "/:id/generate-main",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    const parsed = generateMainBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "bad_body", issues: parsed.error.issues }); return;
    }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      // Manual (buyer-uploaded) influencers are a static gallery: no
      // AI regeneration is allowed against them. The buyer owns their
      // own images and can add/remove via the manual edit routes.
      if (influencer.source === "manual") {
        res.status(409).json({
          error: "manual_influencer_static_only",
          message: "AI regeneration is not available for manually uploaded influencers.",
        }); return;
      }
      const { url, promptUsed } = await generateAvatarFromPrompt(parsed.data.mainImagePrompt);
      const [row] = await db
        .update(aiInfluencersTable)
        .set({ avatarUrl: url, mainImagePrompt: promptUsed })
        .where(eq(aiInfluencersTable.id, id))
        .returning();
      res.json({ influencer: row }); return;
    } catch (err) {
      req.log.error({ err }, "influencers: generate-main failed");
      res.status(502).json({ error: "image_generation_failed" }); return;
    }
  },
);

router.post(
  "/:id/generate-angles",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.appUser?.id as number | undefined;
    if (!userId) { res.status(401).json({ error: "unauthenticated" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    try {
      const influencer = await loadOwnedInfluencer(id, userId);
      if (!influencer) { res.status(404).json({ error: "not_found" }); return; }
      if (influencer.source === "manual") {
        res.status(409).json({
          error: "manual_influencer_static_only",
          message: "AI angle generation is not available for manually uploaded influencers.",
        }); return;
      }
      if (!influencer.avatarUrl) {
        res.status(400).json({ error: "no_main_image" }); return;
      }

      // Pull the avatar once, reuse for every angle call.
      const refImage = await fetchImageAsInline(influencer.avatarUrl);

      // Find current max sortOrder so newly generated angles append cleanly.
      const [{ maxOrder }] = await db
        .select({
          maxOrder: sql<number>`coalesce(max(${influencerAnglesTable.sortOrder}), -1)::int`,
        })
        .from(influencerAnglesTable)
        .where(eq(influencerAnglesTable.influencerId, id));

      // Concurrency cap of 3 - balance speed against per-key Gemini RPM.
      const CONCURRENCY = 3;
      const results: Array<{
        idx: number;
        url: string | null;
        label: string;
        instruction: string;
        error?: string;
      }> = ANGLE_DIRECTIVES.map((d, idx) => ({
        idx,
        url: null,
        label: d.label,
        instruction: d.instruction,
      }));

      const generateProImage = await getGenerateProImage();
      let cursor = 0;
      async function worker() {
        while (true) {
          const i = cursor++;
          if (i >= ANGLE_DIRECTIVES.length) return;
          const dir = ANGLE_DIRECTIVES[i]!;
          try {
            const out = await generateProImage({
              prompt: `${dir.instruction} ${ANGLE_PRESERVE}`,
              inputImages: [{ data: refImage.data, mimeType: refImage.mimeType }],
            });
            const url = await uploadInlineImage(out.b64_json, out.mimeType, "inf-angle-");
            results[i]!.url = url;
          } catch (err) {
            req.log.error({ err, label: dir.label }, "influencers: angle generation failed");
            results[i]!.error = err instanceof Error ? err.message : "unknown";
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      // Persist the successful ones in the directive's stable order.
      let nextOrder = (maxOrder ?? -1) + 1;
      const inserted: InfluencerAngle[] = [];
      for (const r of results) {
        if (!r.url) continue;
        const [row] = await db
          .insert(influencerAnglesTable)
          .values({
            influencerId: id,
            label: r.label,
            imageUrl: r.url,
            prompt: r.instruction,
            sortOrder: nextOrder++,
          })
          .returning();
        inserted.push(row);
      }

      const failures = results.filter((r) => !r.url).map((r) => ({ label: r.label, error: r.error }));
      res.status(201).json({
        angles: inserted,
        generated: inserted.length,
        requested: ANGLE_DIRECTIVES.length,
        failures,
      }); return;
    } catch (err) {
      req.log.error({ err }, "influencers: generate-angles failed");
      res.status(500).json({ error: "internal_error" }); return;
    }
  },
);

export default router;
