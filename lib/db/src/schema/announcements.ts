import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Task #689 - Admin Announcements composer.
//
// Admins compose rich announcements (headline, sanitized body HTML, optional
// media stored under PRIVATE_OBJECT_DIR/uploads/..., optional CTA button,
// audience all-users vs admins-only, draft/publish lifecycle). Portal users
// see them in a bell + panel and can dismiss them; dismissals are per-user
// and persistent.

export const ANNOUNCEMENT_STATUSES = ["draft", "published", "unpublished"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_AUDIENCES = ["all", "admins"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

// "image" / "video" = direct asset (uploaded to GCS OR a direct https URL
// ending in a known image/video extension). "embed" = third-party iframe
// embed (Wistia, YouTube, Vimeo, Loom) whose normalized embed URL lives in
// `mediaPath`. Column is plain `text` in Postgres so adding a new value
// here is a TypeScript-only change and is publish-safe.
export const ANNOUNCEMENT_MEDIA_KINDS = ["image", "video", "embed"] as const;
export type AnnouncementMediaKind = (typeof ANNOUNCEMENT_MEDIA_KINDS)[number];

export const announcementsTable = pgTable(
  "announcements",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    // Server-sanitized HTML (allowlist: p, br, strong, em, u, a, ul, ol, li,
    // h2, h3, blockquote). Stored as-is and rendered with dangerouslySetInnerHTML.
    bodyHtml: text("body_html").notNull().default(""),
    // /objects/<id> path returned by ObjectStorageService.normalizeObjectEntityPath
    mediaPath: text("media_path"),
    mediaKind: text("media_kind"),
    ctaLabel: text("cta_label"),
    ctaHref: text("cta_href"),
    ctaNewTab: boolean("cta_new_tab").notNull().default(true),
    audience: text("audience").notNull().default("all"),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("announcements_status_idx").on(t.status),
    index("announcements_published_at_idx").on(t.publishedAt),
  ],
);

export const announcementDismissalsTable = pgTable(
  "announcement_dismissals",
  {
    id: serial("id").primaryKey(),
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => announcementsTable.id, { onDelete: "cascade" }),
    portalUserId: integer("portal_user_id").notNull(),
    dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("announcement_dismissals_uq").on(
      t.announcementId,
      t.portalUserId,
    ),
    index("announcement_dismissals_user_idx").on(t.portalUserId),
  ],
);

// Task #719 - Real impression tracking.
//
// Previously the admin "Seen" count was just `dismissedCount` (a floor:
// only counted users who explicitly hit X / Later / CTA / Esc). Users
// who saw the popup but closed the tab / navigated away were invisible.
//
// We now record one row per (announcement, portal_user) the first time
// the popup actually renders for that user (or the archive lists it).
// Unique per (announcement_id, portal_user_id) + onConflictDoNothing so
// replays / refetches don't inflate the count.
export const announcementImpressionsTable = pgTable(
  "announcement_impressions",
  {
    id: serial("id").primaryKey(),
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => announcementsTable.id, { onDelete: "cascade" }),
    portalUserId: integer("portal_user_id").notNull(),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("announcement_impressions_uq").on(
      t.announcementId,
      t.portalUserId,
    ),
    index("announcement_impressions_user_idx").on(t.portalUserId),
  ],
);

export type Announcement = typeof announcementsTable.$inferSelect;
export type InsertAnnouncement = typeof announcementsTable.$inferInsert;
export type AnnouncementDismissal = typeof announcementDismissalsTable.$inferSelect;
export type AnnouncementImpression = typeof announcementImpressionsTable.$inferSelect;
