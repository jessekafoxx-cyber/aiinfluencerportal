import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { webinarRegistrants } from "./webinar";

/**
 * Task #798 - Webinar Follow-Up Sequence Engine.
 *
 * In-app ("Option A") automated follow-up engine layered on top of the
 * Evergreen Webinar Platform (Task #797). Reuses the existing Resend /
 * WATI / Slack infrastructure instead of GoHighLevel.
 *
 *   - webinar_email_queue : the per-registrant ordered E1-E17 email
 *     queue. The queue builder inserts rows on registration (warm-up +
 *     day-of track) and, after a missed session, the encore track
 *     (E12-E17, no-shows only). A ~5 min scheduler sends any pending
 *     row whose scheduled_at is due (due-by semantics).
 *   - webinar_whatsapp_log : idempotency ledger for the WATI WhatsApp
 *     triggers (registration / 1h-before / morning-after no-show).
 *   - webinar_email_optouts : unsubscribe list keyed by lower(email).
 *     Stops all future webinar follow-up email for that address.
 *   - webinar_ops_notifications : idempotency ledger for the Slack
 *     notifications sent to Reece (per-registration / daily summary /
 *     1h-before roundup).
 */

export const WEBINAR_EMAIL_TYPES = [
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
  "E7",
  "E8",
  "E9",
  "E10",
  "E11",
  "E12",
  "E13",
  "E14",
  "E15",
  "E16",
  "E17",
] as const;
export type WebinarEmailType = (typeof WEBINAR_EMAIL_TYPES)[number];

export const WEBINAR_EMAIL_TRACKS = ["warmup", "encore"] as const;
export type WebinarEmailTrack = (typeof WEBINAR_EMAIL_TRACKS)[number];

export const WEBINAR_EMAIL_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;
export type WebinarEmailStatus = (typeof WEBINAR_EMAIL_STATUSES)[number];

export const webinarEmailQueueTable = pgTable(
  "webinar_email_queue",
  {
    id: serial("id").primaryKey(),
    registrantId: integer("registrant_id")
      .notNull()
      .references(() => webinarRegistrants.id, { onDelete: "cascade" }),
    /** E1 .. E17 */
    emailType: text("email_type").notNull(),
    /** warmup | encore */
    track: text("track").notNull().default("warmup"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** pending | sent | failed | skipped */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    messageId: text("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    regTypeUq: uniqueIndex("webinar_email_queue_reg_type_uq").on(
      t.registrantId,
      t.emailType,
    ),
    statusSchedIdx: index("webinar_email_queue_status_sched_idx").on(
      t.status,
      t.scheduledAt,
    ),
  }),
);

export const webinarWhatsappLogTable = pgTable(
  "webinar_whatsapp_log",
  {
    id: serial("id").primaryKey(),
    registrantId: integer("registrant_id")
      .notNull()
      .references(() => webinarRegistrants.id, { onDelete: "cascade" }),
    /** registration | before_1h | noshow_encore */
    messageType: text("message_type").notNull(),
    /** sent | skipped | failed */
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    regTypeUq: uniqueIndex("webinar_whatsapp_log_reg_type_uq").on(
      t.registrantId,
      t.messageType,
    ),
  }),
);

export const webinarEmailOptoutsTable = pgTable("webinar_email_optouts", {
  /** lower(email) */
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webinarOpsNotificationsTable = pgTable(
  "webinar_ops_notifications",
  {
    id: serial("id").primaryKey(),
    /** Stable idempotency key, e.g. "daily_summary:session:123". */
    dedupeKey: text("dedupe_key").notNull(),
    /** new_registration | daily_summary | before_1h_roundup */
    kind: text("kind").notNull(),
    sessionId: integer("session_id"),
    registrantId: integer("registrant_id"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dedupeUq: uniqueIndex("webinar_ops_notif_dedupe_uq").on(t.dedupeKey),
  }),
);

export type WebinarEmailQueueRow = typeof webinarEmailQueueTable.$inferSelect;
export type WebinarWhatsappLogRow = typeof webinarWhatsappLogTable.$inferSelect;
export type WebinarEmailOptoutRow = typeof webinarEmailOptoutsTable.$inferSelect;
export type WebinarOpsNotificationRow =
  typeof webinarOpsNotificationsTable.$inferSelect;
