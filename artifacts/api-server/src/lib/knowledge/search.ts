import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { embedText } from "./embeddings";

export interface KnowledgeHit {
  chunkId: number;
  documentId: number;
  sourceId: number;
  categoryId: number;
  categoryName: string;
  expertContext: string;
  sourceName: string;
  documentTitle: string;
  documentUrl: string | null;
  content: string;
  similarity: number;
}

// Cache embeddings for repeated questions for a short window. The voice agent
// often asks the same question two or three different ways inside one call,
// and embedding spend is the dominant variable cost on this endpoint.
const EMBED_CACHE_TTL_MS = 5 * 60 * 1000;
const EMBED_CACHE_MAX = 200;
const embedCache = new Map<string, { vec: number[]; at: number }>();

function cacheKey(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

async function getEmbedding(query: string): Promise<number[]> {
  const key = cacheKey(query);
  const hit = embedCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < EMBED_CACHE_TTL_MS) return hit.vec;
  const vec = await embedText(query);
  embedCache.set(key, { vec, at: now });
  if (embedCache.size > EMBED_CACHE_MAX) {
    // Drop oldest. Map iteration order is insertion order.
    const oldest = embedCache.keys().next().value;
    if (oldest) embedCache.delete(oldest);
  }
  return vec;
}

export async function searchKnowledge(
  query: string,
  opts: { limit?: number; categoryIds?: number[] } = {},
): Promise<KnowledgeHit[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));
  const cleaned = query.trim();
  if (!cleaned) return [];

  const embedding = await getEmbedding(cleaned);
  const vec = `[${embedding.join(",")}]`;

  const categoryFilter = opts.categoryIds && opts.categoryIds.length > 0
    ? sql`AND c.category_id = ANY(${opts.categoryIds})`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      c.id              AS "chunkId",
      c.document_id     AS "documentId",
      c.source_id       AS "sourceId",
      c.category_id     AS "categoryId",
      cat.name          AS "categoryName",
      cat.expert_context AS "expertContext",
      s.name            AS "sourceName",
      d.title           AS "documentTitle",
      d.source_url      AS "documentUrl",
      c.content         AS "content",
      1 - (c.embedding <=> ${vec}::vector) AS "similarity"
    FROM knowledge_chunks c
    INNER JOIN knowledge_categories cat ON cat.id = c.category_id AND cat.is_active = true
    INNER JOIN knowledge_sources s ON s.id = c.source_id AND s.is_active = true
    INNER JOIN knowledge_documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
    ${categoryFilter}
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);

  const rows = ((result as any).rows ?? result) as KnowledgeHit[];
  return rows.map((r) => ({
    ...r,
    similarity: Number(r.similarity ?? 0),
  }));
}
