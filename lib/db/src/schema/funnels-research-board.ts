import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const funnelsResearchBoardItems = pgTable("funnels_research_board_items", {
  id: serial("id").primaryKey(),
  rowKey: text("row_key").notNull().unique(),
  sortIndex: integer("sort_index").notNull(),
  funnelLink: text("funnel_link").notNull(),
  type: text("type"),
  awarenessStage: text("awareness_stage"),
  style: text("style"),
  notes: text("notes"),
  previewSourceUrl: text("preview_source_url"),
  pdfSourceUrl: text("pdf_source_url"),
  previewObjectPath: text("preview_object_path"),
  previewContentType: text("preview_content_type"),
  previewStatus: text("preview_status"),
  previewError: text("preview_error"),
  previewAttempts: integer("preview_attempts").default(0).notNull(),
  previewDownloadedAt: timestamp("preview_downloaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const funnelsResearchBoardSyncStatus = pgTable("funnels_research_board_sync_status", {
  id: integer("id").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncOk: boolean("last_sync_ok"),
  lastSyncError: text("last_sync_error"),
  rowsUpserted: integer("rows_upserted"),
  rowsPruned: integer("rows_pruned"),
  totalRows: integer("total_rows"),
});
