import { pgTable, text, integer, timestamp, boolean, serial, jsonb, customType, index, uniqueIndex } from "drizzle-orm/pg-core";

export const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string) {
    if (Array.isArray(value)) return value as unknown as number[];
    if (typeof value !== "string") return [];
    const trimmed = value.replace(/^\[|\]$/g, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((n) => Number(n));
  },
});

export const knowledgeCategoriesTable = pgTable("knowledge_categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // What this person/category is known for. Free text. Greg AI references this
  // when retrieving and attributing chunks (e.g. "World-class Facebook ads strategist").
  expertContext: text("expert_context").default("").notNull(),
  icon: text("icon"),
  color: text("color"),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  // Kind of source: youtube_channel | youtube_playlist | instagram_handle | drive_folder | manual_text
  sourceType: text("source_type").notNull(),
  // URL / handle / drive folder ID. Null for manual_text.
  sourceUrl: text("source_url"),
  // For manual_text sources: the actual content body.
  manualContent: text("manual_content"),
  scrapeFrequency: text("scrape_frequency").default("weekly"),
  // Auto-resync interval in hours (0 disables cron). Default 168 = weekly.
  syncFrequencyHours: integer("sync_frequency_hours").default(168).notNull(),
  // Cap on docs pulled per sync.
  maxDocuments: integer("max_documents").default(50).notNull(),
  lastScrapedAt: timestamp("last_scraped_at"),
  // idle | queued | running | success | error
  syncStatus: text("sync_status").default("idle").notNull(),
  lastSyncError: text("last_sync_error"),
  lastSyncDocumentCount: integer("last_sync_document_count").default(0).notNull(),
  isActive: boolean("is_active").default(true),
  config: jsonb("config"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const knowledgeDocumentsTable = pgTable("knowledge_documents", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  categoryId: integer("category_id").notNull(),
  // Stable upstream ID (videoId / IG shortcode / drive fileId / content hash for manual).
  externalId: text("external_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  // Hash of content so we know when to re-embed.
  contentHash: text("content_hash"),
  summary: text("summary"),
  sourceUrl: text("source_url"),
  contentType: text("content_type").default("text"),
  metadata: jsonb("metadata"),
  publishedAt: timestamp("published_at"),
  wordCount: integer("word_count").default(0),
  isProcessed: boolean("is_processed").default(false),
  // Number of vector chunks this doc has produced.
  chunkCount: integer("chunk_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const knowledgeChunksTable = pgTable("knowledge_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  sourceId: integer("source_id").notNull(),
  categoryId: integer("category_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").default(0).notNull(),
  embedding: vector1536("embedding"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  docIdx: index("knowledge_chunks_doc_idx").on(table.documentId),
  sourceIdx: index("knowledge_chunks_source_idx").on(table.sourceId),
  catIdx: index("knowledge_chunks_cat_idx").on(table.categoryId),
}));

export const gregAiConversationsTable = pgTable("greg_ai_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title"),
  lastMessageAt: timestamp("last_message_at"),
  messageCount: integer("message_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const gregAiMessagesTable = pgTable("greg_ai_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gregAiSystemPromptTable = pgTable("greg_ai_system_prompt", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  isActive: boolean("is_active").default(true),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Task #762: per-session voice/chat duration log for the Platinum Club
// Greg AI doorway. Monthly usage is summed per calendar month (UTC) from
// `startedAt` so the 120-minute (7200s) allowance resets automatically on
// the 1st with no reset job. Independent of the aiUsageCents $10-credit model.
export const gregAiUsageSessionsTable = pgTable("greg_ai_usage_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // 'voice' | 'chat'
  channel: text("channel").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  // Task #764: client-generated key for a single in-progress session. While a
  // voice call / chat view is open the client posts periodic heartbeats with
  // the CUMULATIVE elapsed seconds keyed by this value, so the server upserts
  // one row per session (idempotent). A hard tab-close then only loses the
  // last heartbeat interval instead of the whole session. NULL for legacy
  // one-shot rows written before heartbeats existed.
  sessionKey: text("session_key"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userStartedIdx: index("greg_ai_usage_sessions_user_started_idx").on(
    table.userId,
    table.startedAt,
  ),
  // One row per (user, session). NULLs are distinct in Postgres, so legacy
  // one-shot rows (session_key IS NULL) never collide.
  userSessionKeyUnique: uniqueIndex("greg_ai_usage_sessions_user_session_key_idx").on(
    table.userId,
    table.sessionKey,
  ),
}));

export const KNOWLEDGE_SOURCE_TYPES = [
  "youtube_channel",
  "youtube_playlist",
  "instagram_handle",
  "drive_folder",
  "manual_text",
] as const;

export type KnowledgeCategory = typeof knowledgeCategoriesTable.$inferSelect;
export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
export type GregAiConversation = typeof gregAiConversationsTable.$inferSelect;
export type GregAiMessage = typeof gregAiMessagesTable.$inferSelect;
export type GregAiSystemPrompt = typeof gregAiSystemPromptTable.$inferSelect;
export type GregAiUsageSession = typeof gregAiUsageSessionsTable.$inferSelect;
