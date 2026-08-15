import { createHash } from "crypto";
import { upsertSupportDoc } from "./knowledge-ingest";
import { fetchYoutubeChannel } from "../lib/knowledge/youtube";
import { logger } from "../lib/logger";

// Admin-added custom knowledge for Alana: pasted docs and YouTube
// videos/channels. Stored in the same support_knowledge_* tables as the
// masterclass content, under sourceType 'manual' | 'youtube', so retrieval
// picks everything up with zero extra plumbing.

const MAX_MANUAL_CHARS = 200_000;

export async function addManualSupportDoc(input: {
  title: string;
  content: string;
}): Promise<{ slug: string }> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("Title is required");
  if (content.length < 40) {
    throw new Error("Content is too short to be useful (min 40 characters)");
  }
  if (content.length > MAX_MANUAL_CHARS) {
    throw new Error("Content is too large (max 200,000 characters)");
  }
  // Stable slug from the title so re-adding the same doc updates it
  // instead of duplicating.
  const slug =
    "manual:" +
    createHash("sha256").update(title.toLowerCase()).digest("hex").slice(0, 16);
  await upsertSupportDoc({
    sourceType: "manual",
    lessonSlug: slug,
    lessonTitle: title,
    phaseTitle: "Support Docs",
    body: `${title}\n\n${content}`,
  });
  return { slug };
}

// --- YouTube ingestion (background job; Apify runs take minutes) ---

export interface YoutubeJobStatus {
  state: "idle" | "running" | "done" | "failed";
  url: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  videosFound: number;
  videosIngested: number;
  videosSkipped: number;
  error: string | null;
}

let youtubeJob: YoutubeJobStatus = {
  state: "idle",
  url: null,
  startedAt: null,
  finishedAt: null,
  videosFound: 0,
  videosIngested: 0,
  videosSkipped: 0,
  error: null,
};

export function getYoutubeJobStatus(): YoutubeJobStatus {
  return { ...youtubeJob };
}

const MIN_TRANSCRIPT_CHARS = 300;

export function startYoutubeIngest(url: string, maxVideos: number): void {
  if (youtubeJob.state === "running") {
    throw new Error(
      "A YouTube import is already running - wait for it to finish",
    );
  }
  if (!process.env.APIFY_TOKEN) {
    throw new Error("APIFY_TOKEN is not configured on the server");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL");
  }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(parsed.hostname)) {
    throw new Error("Only YouTube links are supported here");
  }
  const limit = Math.max(1, Math.min(maxVideos || 25, 100));

  youtubeJob = {
    state: "running",
    url,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    videosFound: 0,
    videosIngested: 0,
    videosSkipped: 0,
    error: null,
  };

  void (async () => {
    try {
      const docs = await fetchYoutubeChannel(url, limit);
      youtubeJob.videosFound = docs.length;
      for (const doc of docs) {
        try {
          // Filter: only keep videos with a real transcript worth
          // learning from - skip description-only or tiny results.
          if (
            !doc.metadata?.hasTranscript ||
            doc.rawText.length < MIN_TRANSCRIPT_CHARS
          ) {
            youtubeJob.videosSkipped += 1;
            continue;
          }
          const r = await upsertSupportDoc({
            sourceType: "youtube",
            lessonSlug: `youtube:${doc.externalId}`,
            lessonTitle: doc.title,
            phaseTitle: "YouTube",
            sourceUrl: doc.url,
            body: `YouTube video: ${doc.title}\n\nTranscript:\n\n${doc.rawText}`,
          });
          if (r === "ingested") youtubeJob.videosIngested += 1;
          else youtubeJob.videosSkipped += 1;
        } catch (err) {
          youtubeJob.videosSkipped += 1;
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              video: doc.externalId,
            },
            "[support-knowledge] youtube video ingest failed",
          );
        }
      }
      youtubeJob.state = "done";
      youtubeJob.finishedAt = new Date().toISOString();
      logger.info(
        {
          url,
          found: youtubeJob.videosFound,
          ingested: youtubeJob.videosIngested,
          skipped: youtubeJob.videosSkipped,
        },
        "[support-knowledge] youtube import complete",
      );
    } catch (err) {
      youtubeJob.state = "failed";
      youtubeJob.finishedAt = new Date().toISOString();
      youtubeJob.error = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: youtubeJob.error, url },
        "[support-knowledge] youtube import failed",
      );
    }
  })();
}
