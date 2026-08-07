import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Platinum Club "Agency Growth Blueprint" content library. Each row is one
// downloadable/openable resource shown inside the Platinum Club -> Blueprint
// tab once that month's drop goes live.
//
// Two delivery modes (mutually exclusive per row):
//   - driveFileId set  -> streamed on-demand through the platinum-gated
//     /api/portal/platinum-club/resources/:id/download proxy (Google Drive
//     bytes piped through the api-server; members never see a raw Drive
//     "request access" wall). coverDriveFileId, when set, streams the cover
//     image through .../:id/cover the same way.
//   - externalUrl set  -> opened in a new tab (Google Docs, Canva, page
//     previews, Drive folders, large ZIP bundles - anything that is
//     inherently a link rather than a single hostable file).
//
// `section` buckets the row into one of the blueprint sections (main_offer,
// bonuses, bumps, upsells, creation_assets, content_scripts, ads,
// sales_assets, top_ads, custom_graphics). `displayOrder` orders rows within
// a section. Seeding is owned by ensure-platinum-club-resources.ts which is
// idempotent (publish ships the table via ADD TABLE; the boot loader fills
// the rows since publish skips data backfills).
export const platinumClubResourcesTable = pgTable(
  "platinum_club_resources",
  {
    id: serial("id").primaryKey(),
    section: text("section").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // pdf | docx | audio | zip | google_doc | drive_folder | link | image
    resourceType: text("resource_type").notNull(),
    driveFileId: text("drive_file_id"),
    externalUrl: text("external_url"),
    coverDriveFileId: text("cover_drive_file_id"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    sectionIdx: index("platinum_club_resources_section_idx").on(t.section),
    activeIdx: index("platinum_club_resources_active_idx").on(t.isActive),
  }),
);

export const insertPlatinumClubResourceSchema = createInsertSchema(
  platinumClubResourcesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatinumClubResource = z.infer<typeof insertPlatinumClubResourceSchema>;
export type PlatinumClubResource = typeof platinumClubResourcesTable.$inferSelect;
