/**
 * HeyGen client for the AI Video Studio (Task #828).
 *
 * Talking-photo flow: an existing influencer photo is uploaded once to
 * HeyGen to mint a `talking_photo_id` (cached by callers in heygen_avatars),
 * then a talking-head video is generated from a script + voice. Status is
 * resolved by webhook (preferred) with a worker-side polling fallback.
 *
 * Every call requires HEYGEN_API_KEY. When unset, helpers throw
 * HeygenNotConfiguredError so routes can return a clear 503 instead of a
 * generic 500.
 */

import { logger } from "./logger";

const HEYGEN_API_BASE = "https://api.heygen.com";
const HEYGEN_UPLOAD_BASE = "https://upload.heygen.com";

export class HeygenNotConfiguredError extends Error {
  constructor() {
    super("HEYGEN_API_KEY is not configured");
    this.name = "HeygenNotConfiguredError";
  }
}

export class HeygenApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HeygenApiError";
    this.status = status;
    this.body = body;
  }
}

export function isHeygenConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY);
}

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new HeygenNotConfiguredError();
  return key;
}

function jsonHeaders(): Record<string, string> {
  return { "X-Api-Key": apiKey(), "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// Aspect ratio -> render dimension.
// ---------------------------------------------------------------------------
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

export function dimensionForAspect(aspect: VideoAspectRatio): {
  width: number;
  height: number;
} {
  switch (aspect) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "9:16":
    default:
      return { width: 1080, height: 1920 };
  }
}

// ---------------------------------------------------------------------------
// Credit cost + length cap (Task #837). Every video is a flat 1 credit and
// capped at 90 seconds. HeyGen TTS speaks at roughly 150 wpm, so the same
// word->seconds formula backs both the frontend length hint and the
// server-side cap that rejects over-length scripts before charging.
// ---------------------------------------------------------------------------
export type VideoQuality = "high";

/** Flat credit cost of one generated video. */
export const VIDEO_CREDIT_COST = 1;

/** Hard cap on generated video length, in seconds. */
export const MAX_VIDEO_SECONDS = 90;

const WORDS_PER_MINUTE = 150;

/** Count of spoken words in a script. */
export function countScriptWords(script: string): number {
  return (script ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** Estimated spoken duration of a script, in seconds, at ~150 wpm. */
export function estimateScriptSeconds(script: string): number {
  return (countScriptWords(script) / WORDS_PER_MINUTE) * 60;
}

/** Flat 1 credit per video, regardless of length or quality (Task #837). */
export function estimateGenerationCredits(): number {
  return VIDEO_CREDIT_COST;
}

/**
 * Fixed cost of one in-Replit podcast auto-edit pass (Task #839): 0.5 credit on
 * top of the 1-credit generation, refunded on failure. NOTE: the
 * video_jobs.edit_credits_cost column is INTEGER, so the true fractional charge
 * is driven off this constant + stamped into metadata.editCreditsCharged - never
 * read the integer column for refund math.
 */
export const EDIT_CREDITS_COST = 0.5;

// ---------------------------------------------------------------------------
// Talking-photo upload. Returns the HeyGen talking_photo_id.
// ---------------------------------------------------------------------------
export async function uploadTalkingPhoto(
  imageBytes: Buffer,
  contentType: string,
): Promise<string> {
  const ct = /jpe?g/i.test(contentType) ? "image/jpeg" : "image/png";
  const resp = await fetch(`${HEYGEN_UPLOAD_BASE}/v1/talking_photo`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey(), "Content-Type": ct },
    body: new Uint8Array(imageBytes),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new HeygenApiError(
      `HeyGen talking_photo upload failed (${resp.status})`,
      resp.status,
      text,
    );
  }
  let data: { data?: { talking_photo_id?: string }; talking_photo_id?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new HeygenApiError("HeyGen upload returned non-JSON", resp.status, text);
  }
  const id = data.data?.talking_photo_id ?? data.talking_photo_id;
  if (!id) {
    throw new HeygenApiError("HeyGen upload missing talking_photo_id", resp.status, text);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Natural TTS pacing (Task: HeyGen-style studio). HeyGen's text-to-speech
// reads punctuation for rhythm but renders a wall of text (or hard line
// breaks) as a flat, rushed monotone. Before we hand a typed script to TTS we
// turn the writer's layout into spoken-rhythm punctuation:
//   - blank lines (paragraph breaks) become a full stop = a longer beat between
//     thoughts.
//   - single line breaks become a comma = a short breath.
//   - the script always closes on terminal punctuation so the last clause
//     doesn't clip.
// Word count is untouched, so the UI's words->seconds length estimate stays in
// lockstep with the server cap. Only the text path is humanized; the
// voice-changer (audio) path lip-syncs to real recorded speech and is left
// exactly as captured.
export function humanizeScriptForTts(script: string): string {
  let s = (script ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return s;
  // Paragraph breaks -> a firm stop.
  s = s.replace(/\n{2,}/g, ". ");
  // Single line breaks -> a brief pause.
  s = s.replace(/[ \t]*\n[ \t]*/g, ", ");
  // Collapse any runs of spaces/tabs the joins introduced.
  s = s.replace(/[ \t]{2,}/g, " ");
  // Tidy doubled punctuation from joining onto a line that already ended in
  // punctuation: ". ," / ". ." / "? ," -> the original terminal mark.
  s = s.replace(/([.!?])[\s,]*[.,](?=\s|$)/g, "$1");
  s = s.replace(/,\s*,/g, ",");
  // No space before punctuation.
  s = s.replace(/\s+([.,!?])/g, "$1");
  // Guarantee a terminal mark so the closing clause lands cleanly.
  if (!/[.!?]["')\]]?$/.test(s)) s += ".";
  return s;
}

// ---------------------------------------------------------------------------
// Video generation. Returns the HeyGen video_id.
// ---------------------------------------------------------------------------
export async function generateTalkingHeadVideo(opts: {
  talkingPhotoId: string;
  // Text path: provide script + voiceId. Voice-changer path (Task #838):
  // provide audioUrl (a public URL to the already-converted audio) instead -
  // HeyGen lip-syncs to the supplied audio and ignores script/voiceId.
  script?: string;
  voiceId?: string;
  audioUrl?: string;
  aspectRatio: VideoAspectRatio;
  title?: string;
  callbackId?: string;
}): Promise<string> {
  const dimension = dimensionForAspect(opts.aspectRatio);
  const voice = opts.audioUrl
    ? { type: "audio", audio_url: opts.audioUrl }
    : {
        type: "text",
        input_text: humanizeScriptForTts(opts.script ?? ""),
        voice_id: opts.voiceId,
      };
  const body: Record<string, unknown> = {
    video_inputs: [
      {
        character: {
          type: "talking_photo",
          talking_photo_id: opts.talkingPhotoId,
        },
        voice,
      },
    ],
    dimension,
  };
  if (opts.title) body.title = opts.title;
  if (opts.callbackId) body.callback_id = opts.callbackId;

  const resp = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new HeygenApiError(
      `HeyGen video generate failed (${resp.status})`,
      resp.status,
      text,
    );
  }
  let data: { data?: { video_id?: string }; error?: { message?: string } | null };
  try {
    data = JSON.parse(text);
  } catch {
    throw new HeygenApiError("HeyGen generate returned non-JSON", resp.status, text);
  }
  const videoId = data.data?.video_id;
  if (!videoId) {
    throw new HeygenApiError(
      data.error?.message ?? "HeyGen generate missing video_id",
      resp.status,
      text,
    );
  }
  return videoId;
}

// ---------------------------------------------------------------------------
// Status polling (worker fallback).
// ---------------------------------------------------------------------------
export type HeygenVideoStatus =
  | { state: "pending" }
  | {
      state: "completed";
      videoUrl: string;
      thumbnailUrl: string | null;
      durationSeconds: number | null;
    }
  | { state: "failed"; errorMessage: string };

export async function getHeygenVideoStatus(
  videoId: string,
): Promise<HeygenVideoStatus> {
  const resp = await fetch(
    `${HEYGEN_API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { method: "GET", headers: jsonHeaders(), signal: AbortSignal.timeout(15_000) },
  );
  if (!resp.ok) {
    // Transient - let the caller keep polling.
    return { state: "pending" };
  }
  const data = (await resp.json()) as {
    data?: {
      status?: string;
      video_url?: string;
      thumbnail_url?: string;
      gif_url?: string;
      duration?: number;
      error?: { message?: string; detail?: string } | null;
    };
  };
  const status = (data.data?.status ?? "").toLowerCase();
  if (status === "completed" || status === "succeeded") {
    const videoUrl = data.data?.video_url;
    if (!videoUrl) {
      return { state: "failed", errorMessage: "completed but missing video_url" };
    }
    return {
      state: "completed",
      videoUrl,
      thumbnailUrl: data.data?.thumbnail_url ?? data.data?.gif_url ?? null,
      durationSeconds:
        typeof data.data?.duration === "number"
          ? Math.round(data.data.duration)
          : null,
    };
  }
  if (status === "failed") {
    return {
      state: "failed",
      errorMessage:
        data.data?.error?.message ??
        data.data?.error?.detail ??
        "HeyGen reported failed",
    };
  }
  return { state: "pending" };
}

// ---------------------------------------------------------------------------
// Voices, cached 24h in-process.
// ---------------------------------------------------------------------------
export interface HeygenVoice {
  voiceId: string;
  name: string;
  language: string | null;
  gender: string | null;
  previewUrl: string | null;
}

const VOICE_TTL_MS = 24 * 60 * 60 * 1000;
let voiceCache: { fetchedAt: number; voices: HeygenVoice[] } | null = null;

export async function listHeygenVoices(force = false): Promise<HeygenVoice[]> {
  if (!force && voiceCache && Date.now() - voiceCache.fetchedAt < VOICE_TTL_MS) {
    return voiceCache.voices;
  }
  const resp = await fetch(`${HEYGEN_API_BASE}/v2/voices`, {
    method: "GET",
    headers: jsonHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    // Serve stale cache if we have one rather than hard-failing the UI.
    if (voiceCache) {
      logger.warn(
        { status: resp.status },
        "[heygen] voices fetch failed, serving stale cache",
      );
      return voiceCache.voices;
    }
    throw new HeygenApiError(
      `HeyGen voices fetch failed (${resp.status})`,
      resp.status,
      text,
    );
  }
  const data = (await resp.json()) as {
    data?: {
      voices?: Array<{
        voice_id?: string;
        name?: string;
        language?: string;
        gender?: string;
        preview_audio?: string;
      }>;
    };
  };
  const voices: HeygenVoice[] = (data.data?.voices ?? [])
    // HeyGen's public library voices ONLY. The account's own instant voice
    // clones + uploaded audio ("Gregory Cooke", "Greg - Voice N", "*.mp3",
    // etc.) come back with no preview_audio, so requiring a preview drops
    // every custom/cloned voice and leaves a clean previewable preset list.
    .filter((v) => v.voice_id && v.preview_audio)
    .map((v) => ({
      voiceId: v.voice_id!,
      name: v.name ?? v.voice_id!,
      language: v.language ?? null,
      gender: v.gender ?? null,
      previewUrl: v.preview_audio ?? null,
    }));
  voiceCache = { fetchedAt: Date.now(), voices };
  return voices;
}
