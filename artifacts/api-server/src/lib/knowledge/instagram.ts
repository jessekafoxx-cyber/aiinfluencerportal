import { runApifyActor } from "./apify";
import type { FetchedDoc } from "./youtube";

interface ApifyIgPost {
  id?: string;
  shortCode?: string;
  shortcode?: string;
  url?: string;
  caption?: string;
  timestamp?: string;
  takenAtTimestamp?: number;
  type?: string;
  productType?: string;
  videoUrl?: string;
  displayUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  ownerUsername?: string;
  hashtags?: string[];
  mentions?: string[];
}

/**
 * Pull recent posts/reels from an Instagram handle via Apify.
 * Uses the well-known `apify/instagram-scraper` actor.
 */
export async function fetchInstagramProfile(handle: string, maxItems: number): Promise<FetchedDoc[]> {
  const username = handle.replace(/^@/, "").replace(/\/$/, "").trim();
  if (!username) return [];
  const limit = Math.max(1, Math.min(maxItems, 100));
  const { items } = await runApifyActor<ApifyIgPost>({
    actorId: "apify/instagram-scraper",
    input: {
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: "posts",
      resultsLimit: limit,
      addParentData: false,
    },
    maxWaitSeconds: 480,
  });

  const docs: FetchedDoc[] = [];
  for (const p of items) {
    const id = p.shortCode || p.shortcode || p.id;
    if (!id) continue;
    const caption = (p.caption || "").trim();
    if (caption.length < 40) continue;
    docs.push({
      externalId: id,
      title: caption.split("\n")[0].slice(0, 120) || `Post ${id}`,
      url: p.url || `https://www.instagram.com/p/${id}/`,
      rawText: caption,
      publishedAt: parseTs(p.timestamp, p.takenAtTimestamp),
      metadata: {
        type: p.type,
        productType: p.productType,
        likesCount: p.likesCount,
        commentsCount: p.commentsCount,
        videoViewCount: p.videoViewCount,
        hashtags: p.hashtags,
        mentions: p.mentions,
        owner: p.ownerUsername,
      },
    });
  }
  return docs;
}

function parseTs(iso?: string, unix?: number): Date | undefined {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }
  if (unix && Number.isFinite(unix)) return new Date(unix * 1000);
  return undefined;
}
