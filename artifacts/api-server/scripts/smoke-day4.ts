// Day 4 smoke: Drive ingest + reprocess + ElevenLabs tool sync.
// Run via: cd artifacts/api-server && node scripts/build-smoke.mjs && node dist/smoke-day4.mjs
//
// Cleans up after itself by deleting the test category and its sources/docs/chunks.

import { db, knowledgeCategoriesTable, knowledgeSourcesTable, knowledgeDocumentsTable, knowledgeChunksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ingestSource } from "../src/lib/knowledge/ingest";
import { searchKnowledge } from "../src/lib/knowledge/search";
import { fetchDriveFolder } from "../src/lib/knowledge/drive";
import {
  syncSearchGregKnowledgeTool,
  getElevenLabsAgentId,
} from "../src/lib/elevenlabs";
import { chunkText, embedBatch, approxTokens } from "../src/lib/knowledge/embeddings";
import { createHash } from "node:crypto";

const SLUG = "kb-smoke-day4";
const DRIVE_FOLDER_CONTENT = "1czps_p8zbOebyXSZi-cISsZwVgIiE51U";

interface Section {
  name: string;
  fn: () => Promise<void>;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

async function run(section: Section): Promise<void> {
  console.log(`\n=== ${section.name} ===`);
  try {
    await section.fn();
    results.push({ name: section.name, ok: true, detail: "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${msg}`);
    results.push({ name: section.name, ok: false, detail: msg });
  }
}

async function ensureCategory() {
  let [cat] = await db.select().from(knowledgeCategoriesTable).where(eq(knowledgeCategoriesTable.slug, SLUG));
  if (!cat) {
    [cat] = await db.insert(knowledgeCategoriesTable).values({
      slug: SLUG,
      name: "Day 4 Drive Smoke",
      description: "Throwaway test expert (Day 4)",
      expertContext: "Drive folder smoke test",
      icon: "FolderOpen",
      color: "#4285F4",
    }).returning();
  }
  return cat;
}

async function reprocessDocument(docId: number): Promise<number> {
  const [doc] = await db.select().from(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, docId));
  if (!doc) throw new Error("doc missing");
  const [category] = await db.select().from(knowledgeCategoriesTable).where(eq(knowledgeCategoriesTable.id, doc.categoryId));
  if (!category) throw new Error("category missing");
  const text = doc.content || "";
  const chunks = chunkText(text);
  const attribution = `[${category.name}${category.expertContext ? ` — ${category.expertContext}` : ""}] ${doc.title}`;
  const embeddings = await embedBatch(chunks.map((c) => `${attribution}\n\n${c}`));
  await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, docId));
  const rows = chunks.map((content, i) => ({
    documentId: docId,
    sourceId: doc.sourceId,
    categoryId: doc.categoryId,
    chunkIndex: i,
    content,
    tokenCount: approxTokens(content),
    embedding: embeddings[i],
  }));
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(knowledgeChunksTable).values(rows.slice(i, i + 100));
  }
  await db.update(knowledgeDocumentsTable).set({
    contentHash: createHash("sha256").update(text).digest("hex"),
    chunkCount: chunks.length,
    isProcessed: true,
    updatedAt: new Date(),
  }).where(eq(knowledgeDocumentsTable.id, docId));
  return rows.length;
}

async function main() {
  const cat = await ensureCategory();
  console.log("category:", cat.id, cat.name);

  // Wipe any stale sources from a previous run.
  const stale = await db.select({ id: knowledgeSourcesTable.id }).from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.categoryId, cat.id));
  for (const s of stale) {
    await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, s.id));
    await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.sourceId, s.id));
  }
  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.categoryId, cat.id));

  let driveSourceId: number | null = null;
  let firstDocId: number | null = null;

  await run({
    name: "Drive folder list (raw fetcher)",
    fn: async () => {
      const docs = await fetchDriveFolder(DRIVE_FOLDER_CONTENT, 5);
      console.log(`  fetched ${docs.length} text-extractable items from Drive folder`);
      for (const d of docs.slice(0, 3)) {
        console.log(`   - ${d.title} (${d.rawText.length} chars)`);
      }
    },
  });

  await run({
    name: "Drive ingestSource end-to-end",
    fn: async () => {
      const [src] = await db.insert(knowledgeSourcesTable).values({
        categoryId: cat.id,
        name: "Drive smoke (Content folder)",
        sourceType: "drive_folder",
        sourceUrl: DRIVE_FOLDER_CONTENT,
        scrapeFrequency: "weekly",
        syncFrequencyHours: 168,
        maxDocuments: 5,
      }).returning();
      driveSourceId = src.id;
      const result = await ingestSource(src.id);
      console.log("  ingest result:", JSON.stringify(result));
      if (!result.ok) throw new Error(`ingest failed: ${result.error}`);
      const docs = await db.select().from(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.sourceId, src.id));
      const chunks = await db.select({ id: knowledgeChunksTable.id }).from(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, src.id));
      console.log(`  docs in DB: ${docs.length}, chunks in DB: ${chunks.length}`);
      if (docs.length === 0) {
        console.log("  (no extractable text files in folder — that's fine; ingest succeeded with 0 docs)");
      } else {
        firstDocId = docs[0].id;
      }
    },
  });

  await run({
    name: "Reprocess single document",
    fn: async () => {
      if (!firstDocId) {
        console.log("  skipped (no docs from Drive folder)");
        return;
      }
      const before = await db.select({ id: knowledgeChunksTable.id }).from(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, firstDocId));
      const written = await reprocessDocument(firstDocId);
      const after = await db.select({ id: knowledgeChunksTable.id }).from(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, firstDocId));
      console.log(`  reprocess: chunks before=${before.length}, written=${written}, after=${after.length}`);
      if (after.length !== written) throw new Error(`reprocess chunk count mismatch: written=${written} after=${after.length}`);
    },
  });

  await run({
    name: "Search across kb (sanity)",
    fn: async () => {
      const hits = await searchKnowledge("what is in the content folder?", { limit: 3 });
      console.log(`  ${hits.length} hits`);
      for (const h of hits.slice(0, 3)) {
        console.log(`   [${h.similarity.toFixed(3)}] ${h.categoryName} | ${h.documentTitle}`);
      }
    },
  });

  await run({
    name: "ElevenLabs tool sync",
    fn: async () => {
      const agentId = getElevenLabsAgentId();
      // Use a stable placeholder base URL for the smoke; in real admin use the
      // actual public URL. We just want to prove the API call shape works.
      const baseUrl = process.env.PUBLIC_API_BASE_URL || "https://example.com";
      const result = await syncSearchGregKnowledgeTool(agentId, baseUrl);
      console.log("  sync result:", JSON.stringify(result));
      if (!result.ok || !result.toolId) throw new Error("sync did not return ok+toolId");
    },
  });

  // Cleanup.
  console.log("\n--- CLEANUP ---");
  if (driveSourceId) {
    await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, driveSourceId));
    await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.sourceId, driveSourceId));
  }
  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.categoryId, cat.id));
  await db.delete(knowledgeCategoriesTable).where(eq(knowledgeCategoriesTable.id, cat.id));
  console.log("  deleted test category, sources, docs, chunks");

  console.log("\n=== RESULTS ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK   " : "FAIL "} ${r.name}${r.detail ? `  -- ${r.detail}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
