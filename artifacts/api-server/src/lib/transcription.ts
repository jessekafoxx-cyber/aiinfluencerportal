/**
 * Whisper transcription with word-level timestamps (Task #839).
 *
 * Used by the podcast-edit pipeline to place single-word captions and to
 * detect keyword triggers for b-roll cutaways. Talks directly to the OpenAI
 * audio transcription endpoint with the project's OPENAI_API_KEY.
 */

export type TranscriptWord = { word: string; start: number; end: number };

export function isTranscriptionConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

/**
 * Transcribe an audio buffer and return word-level timing. Throws on any
 * failure so the caller can fail + refund the edit (captions are core to the
 * SOP - a caption-less clip is not an acceptable result).
 */
export async function transcribeWords(
  audio: Buffer,
  fileName: string,
): Promise<TranscriptWord[]> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("transcription_not_configured");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), fileName);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`transcription_failed:${resp.status}:${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    words?: { word: string; start: number; end: number }[];
  };
  return (data.words ?? [])
    .filter(
      (w) =>
        typeof w.word === "string" &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end),
    )
    .map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.word.length > 0);
}
