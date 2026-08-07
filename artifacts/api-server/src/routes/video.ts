/**
 * AI Video Studio API (Task #828). Admin-only; every route is gated by
 * requireVideoStudioAdmin which returns 404 (not 403) for non-admins so the
 * feature is undetectable.
 *
 * Step 1 surface: video-credit balance + ledger + admin adjustment. Later
 * steps (HeyGen generation, gallery, purchases, auto-edit) mount additional
 * routes on this same router.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  ordersTable,
  portalUsersTable,
  videoJobsTable,
  VIDEO_CREDIT_TX_TYPES,
  type VideoJob,
} from "@workspace/db";
import {
  requireVideoStudioAdmin,
  hasUnlimitedVideoCredits,
} from "../middlewares/requireVideoStudioAdmin.js";
import {
  getOrCreateVideoWalletBalance,
  listVideoCreditTransactions,
  adminAdjustVideoCredits,
  debitVideoCredits,
  refundVideoCredits,
  InsufficientVideoCreditsError,
} from "../lib/video-credits.js";
import {
  isHeygenConfigured,
  VIDEO_CREDIT_COST,
  MAX_VIDEO_SECONDS,
  estimateScriptSeconds,
  generateTalkingHeadVideo,
  listHeygenVoices,
  EDIT_CREDITS_COST,
} from "../lib/heygen.js";
import {
  getOrCreateTalkingPhoto,
  resolveAndApplyHeygenStatus,
  failJobAndRefund,
} from "../lib/video-generation.js";
import {
  PRICE_PER_CREDIT_CENTS,
  CREDIT_CURRENCY,
  MIN_CREDIT_QTY,
  MAX_CREDIT_QTY,
  CREDIT_QTY_PRESETS,
  creditPriceCents,
  normalizeCreditQty,
} from "../lib/video-packs.js";
import { isEditPipelineConfigured, EDIT_STYLES } from "../lib/video-edit-pipeline.js";
import {
  listElevenLabsVoices,
  convertSpeechToSpeech,
  isElevenLabsConfigured,
} from "../lib/elevenlabs.js";
import { getAudioDurationSeconds } from "../lib/audio-duration.js";
import { uploadVideoBuffer, downloadSourceImageBytes } from "../lib/video-storage.js";
import multer from "multer";

const router: IRouter = Router();

// Voice-changer uploads (Task #838): in-memory, 30 MB cap. ~90s of audio is a
// few MB even uncompressed, so 30 MB leaves generous headroom for any codec.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Custom-photo uploads: in-memory, 15 MB cap. HeyGen talking-photo source
// images are comfortably under this; the cap just bounds per-request memory.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Map an uploaded image mime type to a file extension for storage.
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function imageExtForMime(mime: string): string | null {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  return IMAGE_EXT_BY_MIME[base] ?? null;
}

// Map an uploaded audio mime type to a file extension for storage + ffprobe.
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};
function audioExtForMime(mime: string): string | null {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  return AUDIO_EXT_BY_MIME[base] ?? null;
}

const MAX_CONCURRENT_GENERATING = 3;
const MAX_CONCURRENT_EDITING = 5;

/** Public-facing shape of a video job. */
function serializeJob(job: VideoJob) {
  return {
    id: job.id,
    influencerId: job.influencerId,
    sourceImageUrl: job.sourceImageUrl,
    script: job.script,
    voiceId: job.voiceId,
    inputMode: job.inputMode,
    stsVoiceId: job.stsVoiceId,
    sourceAudioUrl: job.sourceAudioUrl,
    convertedAudioUrl: job.convertedAudioUrl,
    quality: job.quality,
    aspectRatio: job.aspectRatio,
    title: job.title,
    status: job.status,
    rawVideoUrl: job.rawVideoUrl,
    thumbnailUrl: job.thumbnailUrl,
    durationSeconds: job.durationSeconds,
    generationCreditsCost: job.generationCreditsCost,
    errorMessage: job.errorMessage,
    editStyle: job.editStyle,
    editStatus: job.editStatus,
    editedVideoUrl: job.editedVideoUrl,
    editCreditsCost: job.editCreditsCost,
    editErrorMessage: job.editErrorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

// Every route below is admin-only (404 for non-admins).
router.use(requireVideoStudioAdmin);

/** GET /api/video/credits - current balance for the signed-in admin. */
router.get("/credits", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser?.id;
  if (!portalUserId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Admins have unlimited credits - surface that to the UI so it renders an
  // "Unlimited" pill instead of a finite, never-decrementing number.
  if (hasUnlimitedVideoCredits(req)) {
    res.json({ balance: null, unlimited: true });
    return;
  }
  const balance = await getOrCreateVideoWalletBalance(portalUserId);
  res.json({ balance, unlimited: false });
});

/** GET /api/video/credits/transactions - recent ledger entries. */
router.get("/credits/transactions", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser?.id;
  if (!portalUserId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const transactions = await listVideoCreditTransactions(portalUserId, limit);
  res.json({
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      // Prefer fractional sub-unit values, falling back to legacy integers.
      amount: t.amountSubunits != null ? t.amountSubunits / 100 : t.amount,
      balanceAfter:
        t.balanceAfterSubunits != null ? t.balanceAfterSubunits / 100 : t.balanceAfter,
      reason: t.reason,
      refType: t.refType,
      refId: t.refId,
      createdAt: t.createdAt,
    })),
  });
});

/**
 * POST /api/video/admin/credits/adjust - manual balance adjustment.
 * Body: { portalUserId? | email?, delta, reason }. delta may be negative.
 */
router.post("/admin/credits/adjust", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    portalUserId?: unknown;
    email?: unknown;
    delta?: unknown;
    reason?: unknown;
  };
  const delta = Number(body.delta);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!Number.isInteger(delta) || delta === 0) {
    res.status(400).json({ error: "delta must be a non-zero integer" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  let portalUserId: number | null = null;
  if (body.portalUserId != null && Number.isInteger(Number(body.portalUserId))) {
    portalUserId = Number(body.portalUserId);
  } else if (typeof body.email === "string" && body.email.trim()) {
    const lower = body.email.trim().toLowerCase();
    const [row] = await db
      .select({ id: portalUsersTable.id })
      .from(portalUsersTable)
      .where(sql`lower(${portalUsersTable.email}) = ${lower}`)
      .limit(1);
    portalUserId = row?.id ?? null;
  }
  if (!portalUserId) {
    res.status(404).json({ error: "Target user not found" });
    return;
  }

  const adminEmail = (req.appUser?.email || req.portalUser?.email || null) as
    | string
    | null;
  try {
    const result = await adminAdjustVideoCredits({
      portalUserId,
      delta,
      reason,
      adminEmail,
    });
    res.json({ ok: true, portalUserId, delta, balance: result.balance });
  } catch (err) {
    req.log?.error(
      { err: err instanceof Error ? err.message : String(err), portalUserId, delta },
      "[video] admin credit adjust failed",
    );
    res.status(500).json({ error: "Failed to adjust credits" });
  }
});

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------
/** GET /api/video/voices - HeyGen voice catalog (24h cached). */
router.get("/voices", async (req: Request, res: Response) => {
  if (!isHeygenConfigured()) {
    res.status(503).json({ error: "Video generation is not configured" });
    return;
  }
  try {
    const force = req.query.refresh === "1";
    const voices = await listHeygenVoices(force);
    res.json({ voices });
  } catch (err) {
    req.log?.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[video] voices fetch failed",
    );
    res.status(502).json({ error: "Failed to load voices" });
  }
});

/**
 * GET /api/video/influencer-voice?influencerId= - the voice last used for this
 * character (Task #837 step 8). Derived from the owner's own most recent job
 * for that influencer, so a character defaults to the same voice on every new
 * clip. Scoped by portalUserId; returns { voiceId: null } when none yet.
 */
router.get("/influencer-voice", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser!.id;
  const influencerId = Number(req.query.influencerId);
  if (!Number.isInteger(influencerId) || influencerId <= 0) {
    res.json({ voiceId: null });
    return;
  }
  const [row] = await db
    .select({ voiceId: videoJobsTable.voiceId })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.portalUserId, portalUserId),
        eq(videoJobsTable.influencerId, influencerId),
        sql`${videoJobsTable.voiceId} is not null`,
      ),
    )
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(1);
  // The ElevenLabs STS voice lives in a separate namespace, so it is tracked
  // independently from the HeyGen text voice (Task #838). Auto-select the last
  // ElevenLabs voice this owner used for this character.
  const [stsRow] = await db
    .select({ stsVoiceId: videoJobsTable.stsVoiceId })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.portalUserId, portalUserId),
        eq(videoJobsTable.influencerId, influencerId),
        sql`${videoJobsTable.stsVoiceId} is not null`,
      ),
    )
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(1);
  res.json({ voiceId: row?.voiceId ?? null, stsVoiceId: stsRow?.stsVoiceId ?? null });
});

// ---------------------------------------------------------------------------
// Voice changer (Task #838): record/upload audio -> ElevenLabs speech-to-speech
// -> HeyGen lip-sync. Separate ElevenLabs voice namespace from the text path.
// ---------------------------------------------------------------------------

/**
 * Absolute, publicly reachable base URL for assets HeyGen must fetch itself
 * (the converted audio). Mirrors the influencer pipeline's resolver: explicit
 * PUBLIC_URL, else the first REPLIT_DOMAINS host. Empty when neither is set.
 */
function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}`;
  return "";
}

/** GET /api/video/voices/elevenlabs - ElevenLabs voice library for STS. */
router.get("/voices/elevenlabs", async (req: Request, res: Response) => {
  if (!(await isElevenLabsConfigured())) {
    res.status(503).json({ error: "Voice changer is not configured" });
    return;
  }
  try {
    const voices = await listElevenLabsVoices();
    res.json({ voices });
  } catch (err) {
    req.log?.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[video] elevenlabs voices fetch failed",
    );
    res.status(502).json({ error: "Failed to load voices" });
  }
});

/**
 * POST /api/video/audio/upload - multipart "audio" field. Validates duration
 * (<= MAX_VIDEO_SECONDS) BEFORE any credit is charged, stores the raw clip, and
 * returns its internal URL + measured duration. No credit is spent here; the
 * charge happens in /generate-from-audio.
 */
router.post(
  "/audio/upload",
  audioUpload.single("audio"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || !file.buffer?.length) {
      res.status(400).json({ error: "No audio file uploaded" });
      return;
    }
    const ext = audioExtForMime(file.mimetype);
    if (!ext) {
      res.status(400).json({
        error: "Unsupported audio format. Use webm, mp3, m4a, wav, ogg, or aac.",
      });
      return;
    }
    let durationSeconds: number;
    try {
      durationSeconds = await getAudioDurationSeconds(file.buffer, ext);
    } catch (err) {
      req.log?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[video] audio duration probe failed",
      );
      res.status(400).json({ error: "Could not read that audio file. Try a different recording." });
      return;
    }
    if (durationSeconds > MAX_VIDEO_SECONDS) {
      res.status(400).json({
        error: `That clip is about ${Math.round(durationSeconds)}s. Audio is capped at ${MAX_VIDEO_SECONDS}s - trim it and try again.`,
        maxSeconds: MAX_VIDEO_SECONDS,
        durationSeconds: Math.round(durationSeconds),
      });
      return;
    }
    try {
      const sourceAudioUrl = await uploadVideoBuffer(
        file.buffer,
        file.mimetype,
        ext,
        "audio.",
      );
      res.json({
        sourceAudioUrl,
        durationSeconds: Math.round(durationSeconds),
        contentType: file.mimetype,
      });
    } catch (err) {
      req.log?.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[video] audio upload store failed",
      );
      res.status(502).json({ error: "Failed to store audio" });
    }
  },
);

/**
 * POST /api/video/image/upload - multipart "image" field. Stores a custom
 * source photo first-party (GCS, served via /api/portal/images/<file>) and
 * returns its internal URL so the client can pass it straight into /generate
 * or /generate-from-audio as sourceImageUrl. Admin-gated like every /video
 * route; no credit is spent here.
 */
router.post(
  "/image/upload",
  imageUpload.single("image"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file || !file.buffer?.length) {
      res.status(400).json({ error: "No image file uploaded" });
      return;
    }
    const ext = imageExtForMime(file.mimetype);
    if (!ext) {
      res.status(400).json({
        error: "Unsupported image format. Use JPG, PNG, or WebP.",
      });
      return;
    }
    try {
      const sourceImageUrl = await uploadVideoBuffer(
        file.buffer,
        file.mimetype,
        ext,
        "custom.",
      );
      res.json({ sourceImageUrl });
    } catch (err) {
      req.log?.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[video] image upload store failed",
      );
      res.status(502).json({ error: "Failed to store image" });
    }
  },
);

// SSRF guard (Task #838 carryover): sourceImage/sourceAudio URLs are fed to
// downloadSourceImageBytes(), which falls back to fetch(url) for anything that
// is not our own GCS object. Restrict client-supplied media URLs to the
// first-party `/api/portal/images/<file>` convention so the server can never be
// coerced into fetching an arbitrary (internal) URL.
const firstPartyMediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^\/api\/portal\/images\/[A-Za-z0-9._-]+$/, "Invalid media URL");

const generateFromAudioSchema = z.object({
  influencerId: z.number().int().positive().nullish(),
  sourceImageUrl: firstPartyMediaUrl,
  sourceAudioUrl: firstPartyMediaUrl,
  stsVoiceId: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional(),
  hook: z.string().trim().max(200).optional(),
  editStyle: z.literal("podcast_clip").nullish(),
});

/**
 * POST /api/video/generate-from-audio - the voice-changer path. Re-checks the
 * stored clip's duration, charges 1 credit, converts it to the chosen
 * ElevenLabs voice via speech-to-speech, stores the converted audio, then asks
 * HeyGen to lip-sync to it. Refunds on any kickoff failure, exactly like the
 * text path.
 */
router.post("/generate-from-audio", async (req: Request, res: Response) => {
  if (!isHeygenConfigured()) {
    res.status(503).json({ error: "Video generation is not configured" });
    return;
  }
  if (!(await isElevenLabsConfigured())) {
    res.status(503).json({ error: "Voice changer is not configured" });
    return;
  }
  const parsed = generateFromAudioSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const portalUserId = req.portalUser!.id;
  const input = parsed.data;

  // Re-fetch the stored clip and re-check duration BEFORE charging (the client
  // upload step is advisory; never trust it for the billing gate).
  let sourceAudio: { buffer: Buffer; contentType: string };
  try {
    sourceAudio = await downloadSourceImageBytes(input.sourceAudioUrl);
  } catch (err) {
    req.log?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[video] source audio fetch failed",
    );
    res.status(400).json({ error: "Could not find the uploaded audio. Re-record and try again." });
    return;
  }
  const srcExt = audioExtForMime(sourceAudio.contentType) ?? "webm";
  let durationSeconds: number;
  try {
    durationSeconds = await getAudioDurationSeconds(sourceAudio.buffer, srcExt);
  } catch {
    res.status(400).json({ error: "Could not read the uploaded audio. Re-record and try again." });
    return;
  }
  if (durationSeconds > MAX_VIDEO_SECONDS) {
    res.status(400).json({
      error: `That clip is about ${Math.round(durationSeconds)}s. Audio is capped at ${MAX_VIDEO_SECONDS}s - trim it and try again.`,
      maxSeconds: MAX_VIDEO_SECONDS,
      durationSeconds: Math.round(durationSeconds),
    });
    return;
  }

  // Per-user concurrency cap (shared with the text path).
  const generating = await db
    .select({ id: videoJobsTable.id })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.portalUserId, portalUserId),
        eq(videoJobsTable.status, "generating"),
      ),
    );
  if (generating.length >= MAX_CONCURRENT_GENERATING) {
    res.status(429).json({
      error: `You already have ${MAX_CONCURRENT_GENERATING} videos generating. Wait for one to finish.`,
    });
    return;
  }

  const cost = VIDEO_CREDIT_COST;
  const [job] = await db
    .insert(videoJobsTable)
    .values({
      portalUserId,
      influencerId: input.influencerId ?? null,
      sourceImageUrl: input.sourceImageUrl,
      script: "",
      voiceId: null,
      inputMode: "audio",
      stsVoiceId: input.stsVoiceId,
      sourceAudioUrl: input.sourceAudioUrl,
      quality: "high",
      aspectRatio: "9:16",
      title: input.title ?? null,
      status: "pending",
      generationCreditsCost: cost,
      editStyle: input.editStyle ?? null,
      // editStatus stays null at generation time. The paid one-click edit
      // (/auto-edit) is the only path that sets editStatus="pending"; the worker
      // claims on that flag, so setting it here would render uncharged edits.
      editStatus: null,
      metadata: input.hook ? { hook: input.hook } : null,
    })
    .returning();

  try {
    // Admins have unlimited credits - skip the wallet debit entirely.
    if (!hasUnlimitedVideoCredits(req)) {
      await debitVideoCredits({
        portalUserId,
        amount: cost,
        type: VIDEO_CREDIT_TX_TYPES.GENERATION_DEBIT,
        reason: "video generation (voice changer)",
        refType: "video_job",
        refId: String(job.id),
        idempotencyKey: `gen:${job.id}`,
      });
    }
  } catch (err) {
    await db.delete(videoJobsTable).where(eq(videoJobsTable.id, job.id));
    if (err instanceof InsufficientVideoCreditsError) {
      res.status(402).json({
        error: "Insufficient video credits",
        required: err.required,
        balance: err.balance,
      });
      return;
    }
    throw err;
  }

  try {
    // 1) ElevenLabs speech-to-speech into the chosen voice.
    const convertedMp3 = await convertSpeechToSpeech({
      voiceId: input.stsVoiceId,
      audio: sourceAudio.buffer,
      contentType: sourceAudio.contentType,
      fileName: `input.${srcExt}`,
    });
    const convertedAudioUrl = await uploadVideoBuffer(
      convertedMp3,
      "audio/mpeg",
      "mp3",
      "audio.",
    );

    // 2) HeyGen must fetch the converted audio over a public URL.
    const base = publicBaseUrl();
    if (!base) {
      throw new Error("No public base URL configured (PUBLIC_URL/REPLIT_DOMAINS) for audio delivery");
    }
    const audioUrl = `${base}${convertedAudioUrl}`;

    const talkingPhotoId = await getOrCreateTalkingPhoto({
      portalUserId,
      influencerId: input.influencerId ?? null,
      sourceImageUrl: input.sourceImageUrl,
    });
    const videoId = await generateTalkingHeadVideo({
      talkingPhotoId,
      audioUrl,
      aspectRatio: "9:16",
      title: input.title,
      callbackId: `video_job:${job.id}`,
    });
    const [updated] = await db
      .update(videoJobsTable)
      .set({
        status: "generating",
        heygenAvatarId: talkingPhotoId,
        heygenVideoId: videoId,
        convertedAudioUrl,
      })
      .where(eq(videoJobsTable.id, job.id))
      .returning();
    res.json({ job: serializeJob(updated ?? job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ jobId: job.id, err: msg }, "[video] audio generation kickoff failed");
    await failJobAndRefund(job, msg);
    res.status(502).json({ error: "Failed to start video generation" });
  }
});

// ---------------------------------------------------------------------------
// Generate a talking-head video
// ---------------------------------------------------------------------------
// Quality is locked to "high" and aspect ratio to 9:16 (Task #837); neither is
// accepted from the client anymore - both are forced server-side below.
const generateSchema = z.object({
  influencerId: z.number().int().positive().nullish(),
  sourceImageUrl: firstPartyMediaUrl,
  script: z.string().trim().min(1).max(5000),
  voiceId: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional(),
  hook: z.string().trim().max(200).optional(),
  editStyle: z.literal("podcast_clip").nullish(),
});

/** POST /api/video/generate - estimate, deduct, create job, call HeyGen. */
router.post("/generate", async (req: Request, res: Response) => {
  if (!isHeygenConfigured()) {
    res.status(503).json({ error: "Video generation is not configured" });
    return;
  }
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const portalUserId = req.portalUser!.id;
  const input = parsed.data;

  // Reject over-length scripts BEFORE charging any credit (Task #837).
  const estSeconds = estimateScriptSeconds(input.script);
  if (estSeconds > MAX_VIDEO_SECONDS) {
    res.status(400).json({
      error: `That script runs about ${Math.round(estSeconds)}s. Videos are capped at ${MAX_VIDEO_SECONDS}s - shorten the script and try again.`,
      maxSeconds: MAX_VIDEO_SECONDS,
      estimatedSeconds: Math.round(estSeconds),
    });
    return;
  }

  // Per-user concurrency cap (Task #828 step 7).
  const generating = await db
    .select({ id: videoJobsTable.id })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.portalUserId, portalUserId),
        eq(videoJobsTable.status, "generating"),
      ),
    );
  if (generating.length >= MAX_CONCURRENT_GENERATING) {
    res.status(429).json({
      error: `You already have ${MAX_CONCURRENT_GENERATING} videos generating. Wait for one to finish.`,
    });
    return;
  }

  // Flat 1 credit per video; quality locked to "high", aspect to 9:16 (Task #837).
  const cost = VIDEO_CREDIT_COST;

  const [job] = await db
    .insert(videoJobsTable)
    .values({
      portalUserId,
      influencerId: input.influencerId ?? null,
      sourceImageUrl: input.sourceImageUrl,
      script: input.script,
      voiceId: input.voiceId,
      quality: "high",
      aspectRatio: "9:16",
      title: input.title ?? null,
      status: "pending",
      generationCreditsCost: cost,
      editStyle: input.editStyle ?? null,
      // editStatus stays null at generation time. The paid one-click edit
      // (/auto-edit) is the only path that sets editStatus="pending"; the worker
      // claims on that flag, so setting it here would render uncharged edits.
      editStatus: null,
      metadata: input.hook ? { hook: input.hook } : null,
    })
    .returning();

  try {
    // Admins have unlimited credits - skip the wallet debit entirely.
    if (!hasUnlimitedVideoCredits(req)) {
      await debitVideoCredits({
        portalUserId,
        amount: cost,
        type: VIDEO_CREDIT_TX_TYPES.GENERATION_DEBIT,
        reason: "video generation",
        refType: "video_job",
        refId: String(job.id),
        idempotencyKey: `gen:${job.id}`,
      });
    }
  } catch (err) {
    await db.delete(videoJobsTable).where(eq(videoJobsTable.id, job.id));
    if (err instanceof InsufficientVideoCreditsError) {
      res.status(402).json({
        error: "Insufficient video credits",
        required: err.required,
        balance: err.balance,
      });
      return;
    }
    throw err;
  }

  try {
    const talkingPhotoId = await getOrCreateTalkingPhoto({
      portalUserId,
      influencerId: input.influencerId ?? null,
      sourceImageUrl: input.sourceImageUrl,
    });
    const videoId = await generateTalkingHeadVideo({
      talkingPhotoId,
      script: input.script,
      voiceId: input.voiceId,
      aspectRatio: "9:16",
      title: input.title,
      callbackId: `video_job:${job.id}`,
    });
    const [updated] = await db
      .update(videoJobsTable)
      .set({ status: "generating", heygenAvatarId: talkingPhotoId, heygenVideoId: videoId })
      .where(eq(videoJobsTable.id, job.id))
      .returning();
    res.json({ job: serializeJob(updated ?? job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ jobId: job.id, err: msg }, "[video] generation kickoff failed");
    await failJobAndRefund(job, msg);
    res.status(502).json({ error: "Failed to start video generation" });
  }
});

// ---------------------------------------------------------------------------
// Job status (also advances generating jobs by polling HeyGen)
// ---------------------------------------------------------------------------
/** GET /api/video/status/:jobId - current job state for the owner. */
router.get("/status/:jobId", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser!.id;
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.portalUserId, portalUserId)))
    .limit(1);
  if (!job || job.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let current = job;
  if (job.status === "generating" && job.heygenVideoId) {
    try {
      current = await resolveAndApplyHeygenStatus(job);
    } catch (err) {
      req.log?.warn(
        { jobId, err: err instanceof Error ? err.message : String(err) },
        "[video] inline status poll failed",
      );
    }
  }
  res.json({ job: serializeJob(current) });
});

// ---------------------------------------------------------------------------
// Gallery list + delete (Task #828 step 4)
// ---------------------------------------------------------------------------
/** GET /api/video/list?status=&limit=&offset= - owner's job gallery. */
router.get("/list", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser!.id;
  const statusFilter =
    typeof req.query.status === "string" &&
    ["pending", "generating", "completed", "failed"].includes(req.query.status)
      ? req.query.status
      : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conditions = [
    eq(videoJobsTable.portalUserId, portalUserId),
    sql`${videoJobsTable.deletedAt} is null`,
  ];
  if (statusFilter) {
    conditions.push(eq(videoJobsTable.status, statusFilter));
  }

  const rows = await db
    .select()
    .from(videoJobsTable)
    .where(and(...conditions))
    .orderBy(desc(videoJobsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(videoJobsTable)
    .where(and(...conditions));

  res.json({
    jobs: rows.map(serializeJob),
    total: Number(count),
    limit,
    offset,
  });
});

/** GET /api/video/stats - per-status counts for the owner's gallery panel. */
router.get("/stats", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser!.id;
  const base = and(
    eq(videoJobsTable.portalUserId, portalUserId),
    sql`${videoJobsTable.deletedAt} is null`,
  );
  const rows = await db
    .select({ status: videoJobsTable.status, count: sql<number>`count(*)::int` })
    .from(videoJobsTable)
    .where(base)
    .groupBy(videoJobsTable.status);
  const [{ edited } = { edited: 0 }] = await db
    .select({ edited: sql<number>`count(*)::int` })
    .from(videoJobsTable)
    .where(and(base, eq(videoJobsTable.editStatus, "completed")));

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.count);
    total += Number(r.count);
  }
  res.json({
    total,
    completed: byStatus.completed ?? 0,
    generating: (byStatus.generating ?? 0) + (byStatus.pending ?? 0),
    failed: byStatus.failed ?? 0,
    edited: Number(edited),
  });
});

/** DELETE /api/video/:jobId - soft-delete a job from the gallery. */
router.delete("/:jobId", async (req: Request, res: Response) => {
  const portalUserId = req.portalUser!.id;
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  // Money-safety (Task #839): refuse to soft-delete while an auto-edit is in
  // flight. The worker + stuck-edit sweep both skip deleted_at rows, so deleting
  // a charged pending/editing job would orphan it - never rendered, never
  // refunded. The buyer just waits for the edit to settle, then deletes.
  const [updated] = await db
    .update(videoJobsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(videoJobsTable.id, jobId),
        eq(videoJobsTable.portalUserId, portalUserId),
        sql`${videoJobsTable.deletedAt} is null`,
        or(isNull(videoJobsTable.editStatus), inArray(videoJobsTable.editStatus, ["completed", "failed"])),
      ),
    )
    .returning({ id: videoJobsTable.id });
  if (!updated) {
    // Distinguish "in-progress edit" (409) from genuinely-not-found (404).
    const [existing] = await db
      .select({ editStatus: videoJobsTable.editStatus })
      .from(videoJobsTable)
      .where(
        and(
          eq(videoJobsTable.id, jobId),
          eq(videoJobsTable.portalUserId, portalUserId),
          sql`${videoJobsTable.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (existing && (existing.editStatus === "pending" || existing.editStatus === "editing")) {
      res.status(409).json({ error: "An edit is in progress. Wait for it to finish, then delete." });
      return;
    }
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Credit packs pricing (display only). The Stripe Elements purchase +
// finalize endpoints were removed with the legacy purchasing stack;
// credits are granted via GoHighLevel entitlement flows.
// ---------------------------------------------------------------------------
/** GET /api/video/credits/packs - buy-any-quantity pricing (Task #837). */
router.get("/credits/packs", (_req: Request, res: Response) => {
  res.json({
    pricePerCreditCents: PRICE_PER_CREDIT_CENTS,
    currency: CREDIT_CURRENCY,
    min: MIN_CREDIT_QTY,
    max: MAX_CREDIT_QTY,
    presets: CREDIT_QTY_PRESETS,
    publishableKey: null,
  });
});

// ---------------------------------------------------------------------------
// One-click podcast auto-edit (Task #839). Runs the FFmpeg SOP pipeline on the
// media worker as a queued job; this route only charges and enqueues.
// ---------------------------------------------------------------------------
/** GET /api/video/edit-styles - available auto-edit styles. */
router.get("/edit-styles", (_req: Request, res: Response) => {
  res.json({ styles: EDIT_STYLES, configured: isEditPipelineConfigured(), cost: EDIT_CREDITS_COST });
});

const autoEditSchema = z.object({
  jobId: z.number().int().positive(),
  style: z.literal("podcast_clip").default("podcast_clip"),
});

/** POST /api/video/auto-edit - charge EDIT_CREDITS_COST, enqueue worker edit. */
router.post("/auto-edit", async (req: Request, res: Response) => {
  if (!isEditPipelineConfigured()) {
    res.status(503).json({ error: "Auto-edit is not configured" });
    return;
  }
  const parsed = autoEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const portalUserId = req.portalUser!.id;
  const { jobId, style } = parsed.data;

  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.portalUserId, portalUserId)))
    .limit(1);
  if (!job || job.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (job.status !== "completed" || !job.rawVideoUrl) {
    res.status(409).json({ error: "Video is not ready to edit yet" });
    return;
  }
  if (job.editStatus === "editing" || job.editStatus === "pending") {
    res.status(409).json({ error: "An edit is already in progress" });
    return;
  }

  // Per-user edit concurrency cap (Task #828 step 7). Advisory pre-check; the
  // atomic claim below is the real guard against duplicate enqueues.
  const editing = await db
    .select({ id: videoJobsTable.id })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.portalUserId, portalUserId),
        inArray(videoJobsTable.editStatus, ["editing", "pending"]),
      ),
    );
  if (editing.length >= MAX_CONCURRENT_EDITING) {
    res.status(429).json({
      error: `You already have ${MAX_CONCURRENT_EDITING} edits in progress. Wait for one to finish.`,
    });
    return;
  }

  // Money-safety (Task #839). Three independent guards close the duplicate-charge
  // and charge-leak paths an earlier review surfaced:
  //  1. Atomic claim: a single conditional UPDATE flips editStatus null/'failed'
  //     -> 'pending'. Postgres re-evaluates the WHERE under the row lock, so only
  //     ONE concurrent request matches a row; losers 409 and never debit.
  //  2. Debit-after-claim, with metadata.editCreditsCharged as the "charge
  //     confirmed" flag stamped ONLY after a successful debit. The worker (and the
  //     stuck-edit sweep's refund) gate on that flag, so the worker can never see
  //     -- or render -- a job before its 0.5 credit actually leaves the ledger.
  //  3. On debit failure we release the claim (editStatus -> null); since the flag
  //     was never stamped the worker could not have grabbed it, so no free render.
  // editCreditsCost is INTEGER and can't hold the fractional 0.5 charge, so the
  // canonical charged value + attempt number live in metadata. attemptNo keys the
  // debit/refund pair so a retried edit charges and refunds the same attempt.
  // Caveat (documented): a process crash in the sub-ms window between the debit
  // committing and the flag being stamped would orphan that one charge; acceptable
  // at this volume, same class as the existing fire-and-forget credit paths.
  const baseMeta =
    job.metadata && typeof job.metadata === "object"
      ? (job.metadata as Record<string, unknown>)
      : {};
  const attemptNo =
    (typeof baseMeta["editAttempts"] === "number" ? (baseMeta["editAttempts"] as number) : 0) + 1;
  const attemptKey = `edit:${jobId}:${attemptNo}`;

  const claimMeta: Record<string, unknown> = { ...baseMeta, editAttempts: attemptNo };
  delete claimMeta["editCreditsCharged"];
  const [claimed] = await db
    .update(videoJobsTable)
    .set({
      editStyle: style,
      editStatus: "pending",
      editErrorMessage: null,
      updatedAt: new Date(),
      metadata: claimMeta,
    })
    .where(
      and(
        eq(videoJobsTable.id, jobId),
        eq(videoJobsTable.portalUserId, portalUserId),
        eq(videoJobsTable.status, "completed"),
        isNotNull(videoJobsTable.rawVideoUrl),
        isNull(videoJobsTable.deletedAt),
        or(isNull(videoJobsTable.editStatus), eq(videoJobsTable.editStatus, "failed")),
      ),
    )
    .returning();
  if (!claimed) {
    res.status(409).json({ error: "An edit is already in progress" });
    return;
  }

  try {
    // Admins have unlimited credits - skip the wallet debit entirely.
    if (!hasUnlimitedVideoCredits(req)) {
      await debitVideoCredits({
        portalUserId,
        amount: EDIT_CREDITS_COST,
        type: VIDEO_CREDIT_TX_TYPES.EDIT_DEBIT,
        reason: "video auto-edit",
        refType: "video_job_edit",
        refId: String(jobId),
        idempotencyKey: attemptKey,
      });
    }
  } catch (err) {
    // No money moved, and the worker could not have claimed this row (no
    // editCreditsCharged flag), so releasing the claim can never strand a render.
    // Compare-and-set on OUR attempt so a stale attempt-N failure cannot clear a
    // row a concurrent retry already advanced to attempt N+1.
    await db
      .update(videoJobsTable)
      .set({ editStatus: null, editStyle: null })
      .where(
        and(
          eq(videoJobsTable.id, jobId),
          eq(videoJobsTable.editStatus, "pending"),
          sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
          sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
        ),
      );
    if (err instanceof InsufficientVideoCreditsError) {
      res
        .status(402)
        .json({ error: "Insufficient video credits", required: err.required, balance: err.balance });
      return;
    }
    throw err;
  }

  // Charge settled: stamp the confirmation flag, which is what unblocks the
  // worker. If THIS update fails to persist (DB transient), the debit already
  // committed but the worker can never claim the job and the sweep won't refund
  // it (both gate on editCreditsCharged) - so compensate by refunding the exact
  // attempt (idempotent key) and releasing the claim, never leaving the buyer
  // charged for an edit that will never run.
  let confirmed;
  try {
    [confirmed] = await db
      .update(videoJobsTable)
      .set({ metadata: { ...claimMeta, editCreditsCharged: EDIT_CREDITS_COST } })
      .where(
        and(
          eq(videoJobsTable.id, jobId),
          eq(videoJobsTable.editStatus, "pending"),
          // Compare-and-set on OUR attempt: a stale attempt-N request must not
          // overwrite metadata for a row a concurrent retry already advanced to
          // attempt N+1 (which would mis-key later refund/dedupe logic and
          // strand the N+1 charge). 0 rows here -> the lost-claim branch below.
          sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
          sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
        ),
      )
      .returning();
  } catch (stampErr) {
    // No-op for admins (unlimited) - they were never debited above.
    if (!hasUnlimitedVideoCredits(req)) {
      await refundVideoCredits({
        portalUserId,
        amount: EDIT_CREDITS_COST,
        reason: "auto-edit could not be enqueued",
        refType: "video_job_edit",
        refId: String(jobId),
        idempotencyKey: `refund:edit:${jobId}:${attemptNo}`,
      }).catch(() => {});
    }
    // Compare-and-set on OUR attempt so a stale attempt-N stamp failure cannot
    // clear a row a concurrent retry already advanced to attempt N+1.
    await db
      .update(videoJobsTable)
      .set({ editStatus: null, editStyle: null })
      .where(
        and(
          eq(videoJobsTable.id, jobId),
          eq(videoJobsTable.editStatus, "pending"),
          sql`(${videoJobsTable.metadata} ->> 'editAttempts') = ${String(attemptNo)}`,
          sql`(${videoJobsTable.metadata} ->> 'editCreditsCharged') IS NULL`,
        ),
      )
      .catch(() => {});
    throw stampErr;
  }
  if (!confirmed) {
    // 0 rows means the row was moved off 'pending' out from under us after our
    // debit committed (e.g. the poller's stuck/unconfirmed reconciler reclaimed
    // it). Refund our own attempt (idempotent on the same key the reconciler
    // would use, so it nets exactly one refund) rather than strand the charge,
    // and report the edit as not enqueued.
    // No-op for admins (unlimited) - they were never debited above.
    if (!hasUnlimitedVideoCredits(req)) {
      await refundVideoCredits({
        portalUserId,
        amount: EDIT_CREDITS_COST,
        reason: "auto-edit could not be enqueued",
        refType: "video_job_edit",
        refId: String(jobId),
        idempotencyKey: `refund:edit:${jobId}:${attemptNo}`,
      }).catch(() => {});
    }
    res.status(409).json({ error: "An edit is already in progress" });
    return;
  }
  res.json({ job: serializeJob(confirmed) });
});

export default router;
