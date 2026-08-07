/**
 * In-Replit podcast-edit render engine (Task #839).
 *
 * Replaces the external Remotion stub. Runs ENTIRELY on the media worker (never
 * the autoscale web server) as a queued job. Applies the Podcast Clip Edit SOP
 * in a single ffmpeg pass:
 *   1. white-border crop (4px L/R) -> fill 1080x1920
 *   2. keyword b-roll cutaways (full-screen, 4s, at trigger timestamps)
 *   3. hook overlay card for the first 5s
 *   4. single-word burned captions (brand Bauhaus Desk ExtraBold)
 *   5. background music (25%, fades) mixed under the voice
 *
 * Captions are core to the SOP, so a transcription failure throws (the worker
 * fails + refunds). B-roll / hook / music are best-effort and degrade silently.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { existsSync } from "fs";
import { logger } from "./logger";
import { downloadSourceImageBytes, uploadVideoBuffer } from "./video-storage";
import { transcribeWords, type TranscriptWord } from "./transcription";
import {
  planBrollCutaways,
  resolveBrollClip,
  BROLL_CLIP_LEN,
} from "./podcast-broll";
import type { VideoJob } from "@workspace/db";

export type EditStyle = "podcast_clip";

export const EDIT_STYLES: readonly {
  id: EditStyle;
  label: string;
  description: string;
}[] = [
  {
    id: "podcast_clip",
    label: "Podcast Clip",
    description:
      "Crops the frame, adds single-word captions, keyword b-roll cutaways, a hook card, and background music.",
  },
] as const;

/** The engine needs OpenAI (Whisper) for captions; everything else degrades. */
export function isEditPipelineConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

// ---------------------------------------------------------------------------
// Asset resolution (music + caption font).
// ---------------------------------------------------------------------------

function resolveEditAssetDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "assets/edit"),
    path.resolve(process.cwd(), "artifacts/api-server/assets/edit"),
    path.resolve(__dirname, "../assets/edit"),
    path.resolve(__dirname, "../../assets/edit"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small process runner.
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd}_timeout`));
    }, opts.timeoutMs);
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

async function ffprobeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Captions (ASS).
// ---------------------------------------------------------------------------

const CAPTION_START_FLOOR = 5; // SOP: captions begin after the 5s intro

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cc = Math.min(99, cs);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

function buildCaptionAss(words: TranscriptWord[]): { ass: string; events: number } {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Bauhaus Desk Display,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,40,40,700,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  let events = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start < CAPTION_START_FLOOR) continue;
    const text = escapeAss(w.word).toUpperCase().trim();
    if (!text) continue;
    let end = w.end;
    const next = words[i + 1];
    if (next && next.start < end) end = next.start;
    if (end - w.start < 0.12) end = w.start + 0.12;
    lines.push(
      `Dialogue: 0,${assTime(w.start)},${assTime(end)},Caption,,0,0,0,,${text}`,
    );
    events++;
  }
  return { ass: [...header, ...lines].join("\n") + "\n", events };
}

// ---------------------------------------------------------------------------
// Hook card (ImageMagick, best-effort).
// ---------------------------------------------------------------------------

async function buildHookCard(
  hook: string,
  fontFile: string | null,
  workdir: string,
): Promise<string | null> {
  const text = hook.trim();
  if (!text) return null;
  const out = path.join(workdir, "hook.png");
  const plate = path.join(workdir, "hook_plate.png");
  const fontArgs = fontFile && existsSync(fontFile) ? ["-font", fontFile] : [];

  // 1) text on a padded white plate
  try {
    const r1 = await run(
      "convert",
      [
        "-background",
        "white",
        "-fill",
        "#111111",
        ...fontArgs,
        "-pointsize",
        "58",
        "-gravity",
        "center",
        "-size",
        "880x",
        `caption:${text}`,
        "-bordercolor",
        "white",
        "-border",
        "44x32",
        plate,
      ],
      { cwd: workdir, timeoutMs: 30_000 },
    );
    if (r1.code !== 0) return null;
  } catch {
    return null;
  }

  // 2) round the corners + drop shadow (fall back to the plate on failure)
  try {
    const r2 = await run(
      "convert",
      [
        plate,
        "(",
        "+clone",
        "-alpha",
        "extract",
        "-draw",
        "fill black polygon 0,0 0,28 28,0 fill white circle 28,28 28,0",
        "(",
        "+clone",
        "-flip",
        ")",
        "-compose",
        "Multiply",
        "-composite",
        "(",
        "+clone",
        "-flop",
        ")",
        "-compose",
        "Multiply",
        "-composite",
        ")",
        "-alpha",
        "off",
        "-compose",
        "CopyOpacity",
        "-composite",
        "(",
        "+clone",
        "-background",
        "black",
        "-shadow",
        "55x16+0+8",
        ")",
        "+swap",
        "-background",
        "none",
        "-layers",
        "merge",
        "+repage",
        out,
      ],
      { cwd: workdir, timeoutMs: 30_000 },
    );
    if (r2.code === 0 && existsSync(out)) return out;
  } catch {
    // fall through to plate
  }
  return existsSync(plate) ? plate : null;
}

// ---------------------------------------------------------------------------
// Main render.
// ---------------------------------------------------------------------------

export async function runPodcastEdit(job: VideoJob): Promise<string> {
  if (!job.rawVideoUrl) throw new Error("edit_no_raw_video");
  if (!isEditPipelineConfigured()) throw new Error("edit_pipeline_not_configured");

  const assetDir = resolveEditAssetDir();
  const musicPath = assetDir ? path.join(assetDir, "podcast-music.mp3") : "";
  const fontsDir = assetDir ? path.join(assetDir, "fonts") : "";
  const captionFont =
    assetDir && existsSync(path.join(fontsDir, "BauhausDeskDisplay-ExtraBold.ttf"))
      ? path.join(fontsDir, "BauhausDeskDisplay-ExtraBold.ttf")
      : null;
  const hasMusic = Boolean(musicPath && existsSync(musicPath));

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "podcast-edit-"));
  try {
    // 1) Download raw video.
    const rawPath = path.join(workdir, "raw.mp4");
    const { buffer: rawBuf } = await downloadSourceImageBytes(job.rawVideoUrl);
    await fs.writeFile(rawPath, rawBuf);

    const dur = await ffprobeDuration(rawPath);
    if (dur <= 0) throw new Error("edit_probe_failed");

    // 2) Extract audio + transcribe (captions are mandatory).
    const audioPath = path.join(workdir, "audio.mp3");
    const ax = await run(
      "ffmpeg",
      ["-y", "-i", rawPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath],
      { cwd: workdir, timeoutMs: 120_000 },
    );
    if (ax.code !== 0) throw new Error("edit_audio_extract_failed");
    const audioBuf = await fs.readFile(audioPath);
    const words = await transcribeWords(audioBuf, "audio.mp3");

    const { ass, events } = buildCaptionAss(words);
    const captionsPath = path.join(workdir, "captions.ass");
    if (events > 0) await fs.writeFile(captionsPath, ass);

    // 3) Plan + resolve b-roll cutaways (best-effort).
    const planned = planBrollCutaways(words);
    const broll: { path: string; ts: number }[] = [];
    for (const cut of planned) {
      const clip = await resolveBrollClip(cut.categoryId);
      if (clip) broll.push({ path: clip, ts: cut.startSec });
    }

    // 4) Hook card (best-effort).
    const hook =
      job.metadata && typeof job.metadata === "object"
        ? ((job.metadata as Record<string, unknown>)["hook"] as string | undefined)
        : undefined;
    const hookCard = hook
      ? await buildHookCard(hook, captionFont, workdir)
      : null;

    // 5) Assemble ffmpeg inputs + filtergraph.
    const inputs: string[] = [];
    const addInput = (p: string): number => {
      inputs.push(p);
      return inputs.length - 1;
    };
    const rawIdx = addInput(rawPath); // 0
    const musicIdx = hasMusic ? addInput(musicPath) : -1;
    const hookIdx = hookCard ? addInput(hookCard) : -1;
    const brollInputs = broll.map((b) => ({ i: addInput(b.path), ts: b.ts }));

    const parts: string[] = [];
    parts.push(
      `[${rawIdx}:v]crop=iw-8:ih:4:0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]`,
    );
    let lastV = "base";
    brollInputs.forEach((b, k) => {
      parts.push(
        `[${b.i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,trim=0:${BROLL_CLIP_LEN},setpts=PTS-STARTPTS+${b.ts}/TB[bk${k}]`,
      );
      parts.push(
        `[${lastV}][bk${k}]overlay=0:0:enable='between(t,${b.ts},${b.ts + BROLL_CLIP_LEN})'[ov${k}]`,
      );
      lastV = `ov${k}`;
    });
    if (hookIdx >= 0) {
      parts.push(
        `[${lastV}][${hookIdx}:v]overlay=(W-w)/2:220:enable='lt(t,5)'[vh]`,
      );
      lastV = "vh";
    }
    let voutLabel: string;
    if (events > 0) {
      const fd = fontsDir ? `:fontsdir=${fontsDir}` : "";
      parts.push(`[${lastV}]ass=captions.ass${fd}[vout]`);
      voutLabel = "[vout]";
    } else {
      voutLabel = `[${lastV}]`;
    }

    let aoutLabel: string;
    if (musicIdx >= 0) {
      const fadeOut = Math.max(0, dur - 3);
      parts.push(
        `[${musicIdx}:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.25,afade=t=in:st=0:d=2,afade=t=out:st=${fadeOut.toFixed(3)}:d=3[mus]`,
      );
      parts.push(`[${rawIdx}:a][mus]amix=inputs=2:normalize=0:duration=first[aout]`);
      aoutLabel = "[aout]";
    } else {
      aoutLabel = `[${rawIdx}:a]`;
    }

    const filterPath = path.join(workdir, "filter.txt");
    await fs.writeFile(filterPath, parts.join(";\n"));

    const outPath = path.join(workdir, "out.mp4");
    const ffArgs = ["-y"];
    for (const inp of inputs) ffArgs.push("-i", inp);
    ffArgs.push(
      "-filter_complex_script",
      filterPath,
      "-map",
      voutLabel,
      "-map",
      aoutLabel,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-t",
      dur.toFixed(3),
      outPath,
    );

    logger.info(
      {
        jobId: job.id,
        durationSec: dur,
        captionEvents: events,
        brollCutaways: brollInputs.length,
        hook: hookIdx >= 0,
        music: musicIdx >= 0,
      },
      "[video-edit] rendering podcast edit",
    );

    const r = await run("ffmpeg", ffArgs, { cwd: workdir, timeoutMs: 8 * 60_000 });
    if (r.code !== 0 || !existsSync(outPath)) {
      logger.error(
        { jobId: job.id, code: r.code, stderr: r.stderr.slice(-1500) },
        "[video-edit] ffmpeg render failed",
      );
      throw new Error("edit_render_failed");
    }

    const outBuf = await fs.readFile(outPath);
    if (outBuf.length === 0) throw new Error("edit_render_empty");
    const url = await uploadVideoBuffer(outBuf, "video/mp4", "mp4", "edit.");
    return url;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
