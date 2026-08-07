// Server-side audio duration probe (Task #838). Used to reject over-length
// voice-changer recordings BEFORE charging a credit. Uses ffprobe (available
// in the Replit image) against a short-lived temp file.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class AudioDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDurationError";
  }
}

function runFfprobe(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => reject(new AudioDurationError(`ffprobe spawn failed: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new AudioDurationError(`ffprobe exited ${code}: ${err.trim() || "unknown error"}`));
        return;
      }
      const seconds = Number.parseFloat(out.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        reject(new AudioDurationError("ffprobe returned no usable duration (unsupported/corrupt audio)"));
        return;
      }
      resolve(seconds);
    });
  });
}

/**
 * Measure the duration (in seconds) of an in-memory audio buffer. Writes the
 * bytes to a temp file, probes with ffprobe, and always cleans up.
 */
export async function getAudioDurationSeconds(buffer: Buffer, ext: string): Promise<number> {
  const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext : "bin";
  const dir = await mkdtemp(join(tmpdir(), "audio-dur-"));
  const filePath = join(dir, `clip.${safeExt}`);
  try {
    await writeFile(filePath, buffer);
    return await runFfprobe(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
