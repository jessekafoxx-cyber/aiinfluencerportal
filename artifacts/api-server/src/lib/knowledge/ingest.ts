import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  knowledgeCategoriesTable,
  knowledgeSourcesTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
} from "@workspace/db";

type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
import { embedBatch, chunkText, approxTokens } from "./embeddings";
import { fetchYoutubeChannel, type FetchedDoc } from "./youtube";
import { fetchInstagramProfile } from "./instagram";
import { fetchDriveFolder } from "./drive";
import { fetchManual } from "./manual";
import { fetchCourseLessons } from "./masterclass";

export interface IngestResult {
  ok: boolean;
  documentsFetched: number;
  documentsNew: number;
  documentsUpdated: number;
  chunksWritten: number;
  error?: string;
}

export async function ingestSource(sourceId: number): Promise<IngestResult> {
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.id, sourceId))
    .limit(1);
  if (!source) {
    return { ok: false, documentsFetched: 0, documentsNew: 0, documentsUpdated: 0, chunksWritten: 0, error: "Source not found" };
  }

  const [category] = await db
    .select()
    .from(knowledgeCategoriesTable)
    .where(eq(knowledgeCategoriesTable.id, source.categoryId))
    .limit(1);
  if (!category) {
    return { ok: false, documentsFetched: 0, documentsNew: 0, documentsUpdated: 0, chunksWritten: 0, error: "Category not found" };
  }

  await db
    .update(knowledgeSourcesTable)
    .set({ syncStatus: "running", lastSyncError: null, updatedAt: new Date() })
    .where(eq(knowledgeSourcesTable.id, sourceId));

  try {
    const docs = await fetchForSource(source);
    let docsNew = 0;
    let docsUpdated = 0;
    let chunksWritten = 0;

    for (const doc of docs) {
      const hash = createHash("sha256").update(doc.rawText).digest("hex");
      const externalId = doc.externalId;

      const [existing] = await db
        .select()
        .from(knowledgeDocumentsTable)
        .where(
          and(
            eq(knowledgeDocumentsTable.sourceId, sourceId),
            eq(knowledgeDocumentsTable.externalId, externalId),
          ),
        )
        .limit(1);

      if (existing && existing.contentHash === hash) {
        // Unchanged — skip re-embedding.
        continue;
      }

      const chunks = chunkText(doc.rawText);
      if (chunks.length === 0) continue;

      // Prefix every chunk with category name + expert context so retrieval
      // is self-describing in the vector neighborhood.
      const attribution = `[${category.name}${category.expertContext ? ` — ${category.expertContext}` : ""}] ${doc.title}`;
      const prefixed = chunks.map((c) => `${attribution}\n\n${c}`);
      const embeddings = await embedBatch(prefixed);

      const wordCount = doc.rawText.split(/\s+/).filter(Boolean).length;

      let docId: number;
      if (existing) {
        await db
          .update(knowledgeDocumentsTable)
          .set({
            title: doc.title,
            content: doc.rawText,
            contentHash: hash,
            sourceUrl: doc.url,
            metadata: doc.metadata,
            publishedAt: doc.publishedAt,
            wordCount,
            isProcessed: true,
            chunkCount: chunks.length,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeDocumentsTable.id, existing.id));
        await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, existing.id));
        docId = existing.id;
        docsUpdated += 1;
      } else {
        const [inserted] = await db
          .insert(knowledgeDocumentsTable)
          .values({
            sourceId,
            categoryId: source.categoryId,
            externalId,
            title: doc.title,
            content: doc.rawText,
            contentHash: hash,
            sourceUrl: doc.url,
            contentType: source.sourceType,
            metadata: doc.metadata,
            publishedAt: doc.publishedAt,
            wordCount,
            isProcessed: true,
            chunkCount: chunks.length,
          })
          .returning({ id: knowledgeDocumentsTable.id });
        docId = inserted.id;
        docsNew += 1;
      }

      const rows = chunks.map((content, i) => ({
        documentId: docId,
        sourceId,
        categoryId: source.categoryId,
        chunkIndex: i,
        content,
        tokenCount: approxTokens(content),
        embedding: embeddings[i],
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await db.insert(knowledgeChunksTable).values(rows.slice(i, i + 100));
      }
      chunksWritten += rows.length;
    }

    await db
      .update(knowledgeSourcesTable)
      .set({
        syncStatus: "success",
        lastScrapedAt: new Date(),
        lastSyncError: null,
        lastSyncDocumentCount: docs.length,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSourcesTable.id, sourceId));

    return {
      ok: true,
      documentsFetched: docs.length,
      documentsNew: docsNew,
      documentsUpdated: docsUpdated,
      chunksWritten,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[knowledge/ingest] Source ${sourceId} failed:`, err);
    await db
      .update(knowledgeSourcesTable)
      .set({
        syncStatus: "error",
        lastSyncError: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSourcesTable.id, sourceId));
    return { ok: false, documentsFetched: 0, documentsNew: 0, documentsUpdated: 0, chunksWritten: 0, error: message };
  }
}

async function fetchForSource(source: KnowledgeSource): Promise<FetchedDoc[]> {
  const max = source.maxDocuments || 50;
  switch (source.sourceType) {
    case "youtube_channel":
    case "youtube_playlist":
      if (!source.sourceUrl) throw new Error("YouTube source has no URL.");
      return fetchYoutubeChannel(source.sourceUrl, max);
    case "instagram_handle":
      if (!source.sourceUrl) throw new Error("Instagram source has no handle.");
      return fetchInstagramProfile(source.sourceUrl, max);
    case "drive_folder":
      if (!source.sourceUrl) throw new Error("Drive source has no folder ID.");
      return fetchDriveFolder(source.sourceUrl, max);
    case "manual_text":
      return fetchManual(source.name, source.manualContent || "");
    case "course_lessons":
      // Pulls every published lesson from the portal's lessons table. No
      // external URL needed; the source row is just a marker that lets the
      // standard ingest and embed pipeline run on internal content.
      return fetchCourseLessons(max);
    default:
      throw new Error(`Unsupported source type: ${source.sourceType}`);
  }
}
