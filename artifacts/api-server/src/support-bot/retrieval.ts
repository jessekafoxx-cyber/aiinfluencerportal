import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { embedText } from "../lib/knowledge/embeddings";

// Retrieval for Alana: pull the most relevant masterclass chunks for the
// customer's question and format them as a system-prompt block. Fail-open:
// callers must treat errors / empty results as "answer without it".

export interface SupportKnowledgeHit {
  lessonSlug: string;
  lessonTitle: string;
  phaseTitle: string;
  sourceType: string;
  content: string;
  similarity: number;
}

interface RawChunkHit extends SupportKnowledgeHit {
  docId: string;
  chunkIndex: number;
}

const MIN_SIMILARITY = 0.25;
// Chunks this small are almost always doc headers ("Lesson: X / Phase: Y /
// Summary: one line") - the real answer lives in the neighbouring chunks.
const SMALL_CHUNK_CHARS = 400;

export async function searchSupportKnowledge(
  query: string | string[],
  limit = 6,
): Promise<SupportKnowledgeHit[]> {
  const queries = (Array.isArray(query) ? query : [query])
    .map((q) => q.trim())
    .filter(Boolean);
  if (queries.length === 0) return [];
  const cap = Math.max(1, Math.min(limit, 12));
  const perQuery = await Promise.all(
    queries.map((q) => rawChunkSearch(q, cap)),
  );
  // Merge multi-query results by chunk, keeping the best similarity, then
  // keep the overall top `limit` chunks.
  const merged = new Map<string, RawChunkHit>();
  for (const rows of perQuery) {
    for (const r of rows) {
      const key = `${r.docId}:${r.chunkIndex}`;
      const prev = merged.get(key);
      if (!prev || r.similarity > prev.similarity) merged.set(key, r);
    }
  }
  const hits = [...merged.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, cap);
  if (hits.length === 0) return [];
  return await expandWithNeighborChunks(hits);
}

async function rawChunkSearch(
  query: string,
  limit: number,
): Promise<RawChunkHit[]> {
  const embedding = await embedText(query);
  const vec = `[${embedding.join(",")}]`;
  const result = await db.execute(sql`
    SELECT
      c.doc_id        AS "docId",
      c.chunk_index   AS "chunkIndex",
      d.lesson_slug   AS "lessonSlug",
      d.lesson_title  AS "lessonTitle",
      d.phase_title   AS "phaseTitle",
      d.source_type   AS "sourceType",
      c.content       AS "content",
      1 - (c.embedding <=> ${vec}::vector) AS "similarity"
    FROM support_knowledge_chunks c
    INNER JOIN support_knowledge_docs d ON d.id = c.doc_id
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);
  const rows = ((result as any).rows ?? result) as RawChunkHit[];
  return rows
    .map((r) => ({
      ...r,
      similarity: Number(r.similarity ?? 0),
      chunkIndex: Number(r.chunkIndex ?? 0),
    }))
    .filter((r) => r.similarity >= MIN_SIMILARITY);
}

// A vector hit often lands on a header/summary chunk or mid-sentence slice
// while the actual answer (tool names, steps, links) sits in the chunks
// right next to it. For each hit, pull the surrounding chunks of the same
// doc (±1 normally, ±2 when the hit chunk is a tiny header) and stitch them
// back together in document order so the model sees a coherent passage.
async function expandWithNeighborChunks(
  hits: RawChunkHit[],
): Promise<SupportKnowledgeHit[]> {
  const wanted = new Map<string, Set<number>>();
  for (const h of hits) {
    const set = wanted.get(h.docId) ?? new Set<number>();
    const radius = h.content.length < SMALL_CHUNK_CHARS ? 2 : 1;
    for (let i = h.chunkIndex - radius; i <= h.chunkIndex + radius; i++) {
      if (i >= 0) set.add(i);
    }
    wanted.set(h.docId, set);
  }
  const docIds = [...wanted.keys()];
  let neighborRows: Array<{
    docId: string;
    chunkIndex: number;
    content: string;
  }> = [];
  try {
    const result = await db.execute(sql`
      SELECT
        c.doc_id      AS "docId",
        c.chunk_index AS "chunkIndex",
        c.content     AS "content"
      FROM support_knowledge_chunks c
      WHERE c.doc_id IN (${sql.join(
        docIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    `);
    neighborRows = ((result as any).rows ?? result) as typeof neighborRows;
  } catch {
    // Fail-open: fall back to the raw hit chunks unchanged.
    return hits.map(({ docId: _d, chunkIndex: _i, ...hit }) => hit);
  }
  const byDoc = new Map<string, Map<number, string>>();
  for (const row of neighborRows) {
    const idx = Number(row.chunkIndex ?? 0);
    if (!wanted.get(row.docId)?.has(idx)) continue;
    const m = byDoc.get(row.docId) ?? new Map<number, string>();
    m.set(idx, row.content);
    byDoc.set(row.docId, m);
  }
  // One expanded hit per doc, keeping the best similarity and the first
  // hit's metadata; chunks joined in document order.
  const seenDocs = new Set<string>();
  const out: SupportKnowledgeHit[] = [];
  for (const h of hits) {
    if (seenDocs.has(h.docId)) continue;
    seenDocs.add(h.docId);
    const chunkMap = byDoc.get(h.docId);
    const content = chunkMap
      ? [...chunkMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, c]) => c)
          .join("\n")
      : h.content;
    const best = Math.max(
      ...hits.filter((x) => x.docId === h.docId).map((x) => x.similarity),
    );
    out.push({
      lessonSlug: h.lessonSlug,
      lessonTitle: h.lessonTitle,
      phaseTitle: h.phaseTitle,
      sourceType: h.sourceType,
      content,
      similarity: best,
    });
  }
  return out;
}

const MAX_CONTEXT_CHARS = 28000;
// One giant transcript must never crowd out the other retrieved lessons.
const MAX_BLOCK_CHARS = 6000;

export function formatSupportKnowledgeForPrompt(
  hits: SupportKnowledgeHit[],
): string {
  if (hits.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const hit of hits) {
    let block: string;
    if (hit.sourceType === "manual") {
      block = `[Support doc: ${hit.lessonTitle}]\n${hit.content}`;
    } else if (hit.sourceType === "youtube") {
      block = `[YouTube video transcript: ${hit.lessonTitle}]\n${hit.content}`;
    } else if (hit.sourceType === "wistia") {
      block = `[Video transcript: ${hit.phaseTitle} > ${hit.lessonTitle}]\n${hit.content}`;
    } else {
      const label =
        hit.sourceType === "lesson_transcript"
          ? "video transcript"
          : "lesson notes";
      block = `[Masterclass: ${hit.phaseTitle} > ${hit.lessonTitle} (${label})]\n${hit.content}`;
    }
    if (block.length > MAX_BLOCK_CHARS) {
      block = block.slice(0, MAX_BLOCK_CHARS) + "\n[...truncated]";
    }
    if (used + block.length > MAX_CONTEXT_CHARS) {
      // Don't stop at the first oversized block - a giant transcript early
      // in the list must not starve out smaller, highly relevant lessons
      // further down. Truncate if there's meaningful room, else skip.
      const remaining = MAX_CONTEXT_CHARS - used;
      if (remaining < 1500) continue;
      block = block.slice(0, remaining) + "\n[...truncated]";
    }
    parts.push(block);
    used += block.length;
  }
  if (parts.length === 0) return "";
  return (
    `\n\n=== KNOWLEDGE RETRIEVED FOR THIS QUESTION ===\n` +
    `The following is real reference content matched to the customer's question. Each block is labeled with its source: masterclass lesson notes/transcripts, YouTube video transcripts, or internal support docs. USE IT. Teach the actual steps, settings, tools and advice from it in your reply, in your own words, like you know the material inside out. When the content names specific tools, apps, sites or links, you MUST name them explicitly in your answer (e.g. the exact tool and feature to use) - never replace them with vague phrases like "the tools inside the portal" or "the section for that". Give the concrete answer FIRST; only mention a lesson name and phase as a pointer to go deeper when the block is masterclass content, and only AFTER you have actually answered. Never present YouTube or support-doc content as a masterclass lesson. If the content below does not cover the question, say you're not sure rather than guessing.\n\n` +
    parts.join("\n\n---\n\n")
  );
}
