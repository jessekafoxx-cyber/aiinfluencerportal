import {
  pgTable,
  text,
  integer,
  timestamp,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { vector1536 } from "./greg-ai";

// Steph (support bot) knowledge store. Kept separate from the Greg AI
// knowledge_* tables so support retrieval never mixes with Greg's brain
// content. Masterclass docs track one source per lesson (notes or Wistia
// transcript) with a content hash so re-ingestion is cheap and idempotent.
// Admin-added custom docs reuse the same shape: sourceType 'manual' or
// 'youtube', lessonSlug = a generated stable key, phaseTitle = group label.

export const supportKnowledgeDocsTable = pgTable(
  "support_knowledge_docs",
  {
    id: serial("id").primaryKey(),
    // 'lesson_notes' | 'lesson_transcript' | 'manual' | 'youtube'
    sourceType: text("source_type").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    lessonTitle: text("lesson_title").notNull(),
    phaseTitle: text("phase_title").notNull().default(""),
    // Original URL for externally sourced docs (YouTube video link).
    sourceUrl: text("source_url"),
    contentHash: text("content_hash").notNull(),
    chunkCount: integer("chunk_count").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("support_knowledge_docs_source_lesson_uq").on(
      t.sourceType,
      t.lessonSlug,
    ),
  ],
);

export const supportKnowledgeChunksTable = pgTable(
  "support_knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    docId: integer("doc_id")
      .notNull()
      .references(() => supportKnowledgeDocsTable.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    embedding: vector1536("embedding"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("support_knowledge_chunks_doc_idx").on(t.docId)],
);

export type SupportKnowledgeDoc = typeof supportKnowledgeDocsTable.$inferSelect;
export type SupportKnowledgeChunk =
  typeof supportKnowledgeChunksTable.$inferSelect;
