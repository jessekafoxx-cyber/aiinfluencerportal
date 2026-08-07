import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Admin-curated list of bridge page links shown on the
// /done-for-you-pack/bridge-pages sub-page.
//
// Rows can come from two sources:
//   * `source = "manual"` - admin entered them via the portal UI.
//   * `source = "sheet"`  - imported from Greg's Google Sheet by the
//                            weekly importer (T402). `sourceRowKey`
//                            is the stable identity used for upserts.
// The importer never touches manual rows, so admin edits are preserved.
export const dfyBridgePagesTable = pgTable(
  "dfy_bridge_pages",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull(),
    previewImageUrl: text("preview_image_url"),
    downloadUrl: text("download_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    bonusNumber: integer("bonus_number"),
    source: text("source").notNull().default("manual"),
    sourceRowKey: text("source_row_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceKeyUq: uniqueIndex("dfy_bridge_pages_source_key_uq")
      .on(t.source, t.sourceRowKey)
      .where(sql`${t.sourceRowKey} IS NOT NULL`),
  }),
);

export type DfyBridgePage = typeof dfyBridgePagesTable.$inferSelect;
