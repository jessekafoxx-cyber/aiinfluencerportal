import { db, knowledgeCategoriesTable, knowledgeSourcesTable, knowledgeChunksTable, knowledgeDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ingestSource } from "../src/lib/knowledge/ingest";
import { searchKnowledge } from "../src/lib/knowledge/search";

const SLUG = "kb-smoke-test";

async function main() {
  let [cat] = await db.select().from(knowledgeCategoriesTable).where(eq(knowledgeCategoriesTable.slug, SLUG));
  if (!cat) {
    [cat] = await db.insert(knowledgeCategoriesTable).values({
      slug: SLUG,
      name: "Charlie Lawrance (Smoke Test)",
      description: "Throwaway test expert",
      expertContext: "Facebook ads expert",
      icon: "Target",
      color: "#C9A44C",
    }).returning();
  }
  console.log("category:", cat.id, cat.name);

  await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.categoryId, cat.id));

  const [src] = await db.insert(knowledgeSourcesTable).values({
    categoryId: cat.id,
    name: "Charlie's Notes (manual)",
    sourceType: "manual_text",
    sourceUrl: null,
    manualContent: `Charlie Lawrance teaches Facebook advertising. His core framework is the "ABO vs CBO" decision. Use ABO when you need granular budget control across audiences. Use CBO when you have a proven hero ad and want Meta's algorithm to allocate spend. Always start with three creatives per ad set, kill any creative below 1% CTR after 5,000 impressions, and scale winning ad sets by 20% every 48 hours. Never duplicate winning ad sets more than twice in a 24 hour window because Meta will rebid against itself and inflate your CPM.

For lookalike audiences, build off purchase events with at least 500 events. 1% lookalikes are best for direct response. 3-5% lookalikes work better when paired with broad targeting. Pixel quality matters more than audience size.

Creative principles: hook in the first 1.3 seconds, scroll-stopping visual, on-screen text for the 85% of users watching without sound, single clear call to action.`,
    scrapeFrequency: "weekly",
    syncFrequencyHours: 168,
    maxDocuments: 50,
  }).returning();
  console.log("source:", src.id, src.name);

  console.log("\n--- INGESTING ---");
  const result = await ingestSource(src.id);
  console.log("ingest result:", result);

  const docs = await db.select().from(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.sourceId, src.id));
  const chunks = await db.select().from(knowledgeChunksTable).where(eq(knowledgeChunksTable.sourceId, src.id));
  console.log(`docs in DB: ${docs.length}, chunks in DB: ${chunks.length}`);

  console.log("\n--- SEARCHING ---");
  const hits = await searchKnowledge("how should I scale winning Facebook ad sets?", { limit: 3 });
  for (const h of hits) {
    console.log(`  [${h.similarity.toFixed(3)}] ${h.categoryName} | ${h.expertContext} | ${h.documentTitle}`);
    console.log(`    ${h.content.slice(0, 200).replace(/\n/g, " ")}`);
  }

  console.log("\n--- IDEMPOTENCY ---");
  const result2 = await ingestSource(src.id);
  console.log("re-ingest result:", result2, "(should be 0 new, 0 updated)");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
