import { runApifyActor } from "./apify";

interface ApifyYoutubeVideo {
  id?: string;
  url?: string;
  title?: string;
  text?: string;
  description?: string;
  date?: string;
  uploadDate?: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: number;
  subtitles?: Array<{ srt?: string; plaintext?: string; text?: string; language?: string }>;
  transcript?: Array<{ text?: string; start?: number }>;
  captions?: string;
}

export interface FetchedDoc {
  externalId: string;
  title: string;
  url: string;
  rawText: string;
  publishedAt?: Date;
  metadata: Record<string, unknown>;
}

/**
 * Pull recent videos + transcripts from a YouTube channel via Apify.
 * Uses the well-known `streamers/youtube-scraper` actor which supports both
 * channel listing and transcript extraction.
 */
export async function fetchYoutubeChannel(channelUrl: string, maxItems: number): Promise<FetchedDoc[]> {
  const limit = Math.max(1, Math.min(maxItems, 100));
  const { items } = await runApifyActor<ApifyYoutubeVideo>({
    actorId: "streamers/youtube-scraper",
    input: {
      startUrls: [{ url: channelUrl }],
      maxResults: limit,
      maxResultsShorts: 0,
      maxResultStreams: 0,
      subtitlesLanguage: "en",
      subtitlesFormat: "plaintext",
      downloadSubtitles: true,
    },
    maxWaitSeconds: 480,
  });

  const docs: FetchedDoc[] = [];
  for (const v of items) {
    const id = v.id || (v.url ? extractVideoId(v.url) : null);
    if (!id) continue;
    const transcript = pickTranscript(v);
    const description = v.text || v.description || "";
    const rawText = [transcript, description].filter(Boolean).join("\n\n").trim();
    if (!rawText || rawText.length < 80) continue;
    docs.push({
      externalId: id,
      title: v.title || `Video ${id}`,
      url: v.url || `https://www.youtube.com/watch?v=${id}`,
      rawText,
      publishedAt: parseDate(v.date || v.uploadDate),
      metadata: {
        durationSeconds: v.durationSeconds,
        duration: v.duration,
        viewCount: v.viewCount,
        hasTranscript: Boolean(transcript),
      },
    });
  }
  return docs;
}

function pickTranscript(v: ApifyYoutubeVideo): string {
  if (v.captions && typeof v.captions === "string") return v.captions;
  if (Array.isArray(v.transcript)) {
    return v.transcript.map((s) => s.text || "").join(" ");
  }
  if (Array.isArray(v.subtitles) && v.subtitles.length > 0) {
    const en = v.subtitles.find((s) => s.language?.toLowerCase().startsWith("en")) || v.subtitles[0];
    return en?.plaintext || en?.text || "";
  }
  return "";
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}
