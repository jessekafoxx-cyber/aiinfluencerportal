import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// T441: Admin-curated list of advertorial page templates shown on the
// /done-for-you-pack/advertorial-pages sub-page. Mirrors
// `dfy_bridge_pages` but for advertorial-page templates.
//
// Rows can come from two sources:
//   * `source = "manual"` - admin entered them via the portal UI.
//   * `source = "sheet"`  - imported from Greg's Google Sheet by the
//                            weekly importer. `sourceRowKey` is the
//                            stable identity used for upserts.
// The importer never touches manual rows, so admin edits are preserved.
export const dfyAdvertorialPagesTable = pgTable(
  "dfy_advertorial_pages",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    templateNumber: integer("template_number"),
    previewUrl: text("preview_url").notNull(),
    installUrl: text("install_url"),
    previewImageUrl: text("preview_image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    source: text("source").notNull().default("manual"),
    sourceRowKey: text("source_row_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceKeyUq: uniqueIndex("dfy_advertorial_pages_source_key_uq")
      .on(t.source, t.sourceRowKey)
      .where(sql`${t.sourceRowKey} IS NOT NULL`),
  }),
);

export type DfyAdvertorialPage = typeof dfyAdvertorialPagesTable.$inferSelect;
