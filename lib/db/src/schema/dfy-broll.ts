import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// T317: Hosted DFY 70K B-Roll library. Each row is one video file
// imported from the curated Google Drive folders linked from
// artifacts/room30-portal/src/pages/dfy/b-roll.tsx. drive_file_id is
// unique so the importer is idempotent. pack_numbers is an integer
// array because the source list contains duplicate folders that
// appear under more than one pack (e.g. packs 7 & 8 share a folder,
// 14 & 18 share a folder). The Canva packs (9-11) are intentionally
// excluded - they stay as external links.
export const dfyBrollClipsTable = pgTable(
  "dfy_broll_clips",
  {
    id: serial("id").primaryKey(),
    // Generated short stable id (nanoid) used in object keys and the
    // portal-facing playback URL. Independent of the DB serial id so
    // it's safe to reference externally.
    publicId: varchar("public_id", { length: 32 }).notNull(),
    driveFileId: text("drive_file_id").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull().default("video/mp4"),
    fileSize: bigint("file_size", { mode: "number" }),
    objectKey: text("object_key").notNull(),
    playbackUrl: text("playback_url").notNull(),
    // Every pack number this file appeared under in the source list.
    // Postgres int[] - stored as a literal '{1,7,8}' string by drizzle.
    packNumbers: integer("pack_numbers").array().notNull(),
    // imported | failed. Failed rows keep the last error message so
    // a re-run only retries failures (rows in 'imported' are skipped).
    status: varchar("status", { length: 16 }).notNull().default("imported"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    driveUq: uniqueIndex("dfy_broll_clips_drive_uq").on(t.driveFileId),
    publicUq: uniqueIndex("dfy_broll_clips_public_uq").on(t.publicId),
    statusIdx: index("dfy_broll_clips_status_idx").on(t.status),
  }),
);

export type DfyBrollClip = typeof dfyBrollClipsTable.$inferSelect;
export type InsertDfyBrollClip = typeof dfyBrollClipsTable.$inferInsert;
