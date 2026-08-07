import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Task #797 - Evergreen Webinar Platform.
 *
 * Self-contained tables for the `/webinar/` artifact: a pre-recorded
 * video disguised as a nightly "live" webinar. Strictly scoped to the
 * webinar artifact and never joined to portal_users / orders (the $27
 * fast-track offer reuses the existing Stripe funnel `main` slug, which
 * writes its own orders row independently).
 *
 *   - webinar_settings : singleton (id=1) config for video, schedule,
 *     copy, attendee-counter curve, AI host chat, and the registration
 *     webhook.
 *   - webinar_sessions : one row per nightly "live" airing.
 *   - webinar_registrants : people who registered, keyed by a single-use
 *     access token.
 *   - webinar_chat_messages : scripted + AI host chat lines replayed in
 *     the live room.
 */

export const webinarSettings = pgTable("webinar_settings", {
  id: serial("id").primaryKey(),

  // ---- Video ----------------------------------------------------------
  /** wistia | youtube | mp4 | hls */
  videoProvider: text("video_provider").notNull().default("mp4"),
  /** Wistia media id, YouTube id, or full mp4/hls URL depending on provider. */
  videoSrc: text("video_src").notNull().default(""),
  videoDurationSeconds: integer("video_duration_seconds").notNull().default(3600),

  // ---- Schedule (source of truth America/New_York) --------------------
  /** Default airing time in 24h "HH:MM" wall-clock, interpreted in scheduleTimezone. */
  scheduleTime: text("schedule_time").notNull().default("20:00"),
  scheduleTimezone: text("schedule_timezone").notNull().default("America/New_York"),
  /** How many upcoming session slots to show on the registration page. */
  upcomingCount: integer("upcoming_count").notNull().default(4),
  /** Minutes after start that the room stays open before showing "ended". */
  roomGraceMinutes: integer("room_grace_minutes").notNull().default(30),

  // ---- In-room timed events (offsets in seconds from video start) -----
  ctaAppearSeconds: integer("cta_appear_seconds").notNull().default(1500),
  chatOpenSeconds: integer("chat_open_seconds").notNull().default(0),
  ctaUrl: text("cta_url").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default("Claim Your Spot"),

  // ---- Attendee counter curve -----------------------------------------
  counterBase: integer("counter_base").notNull().default(180),
  /** Peak multiplier applied to base at the ramp plateau (x100, so 150 = 1.5x). */
  counterRampPct: integer("counter_ramp_pct").notNull().default(150),
  /** +/- random jitter applied each poll, as a percent of current value. */
  counterVariancePct: integer("counter_variance_pct").notNull().default(6),

  // ---- AI host chat ----------------------------------------------------
  botEnabled: boolean("bot_enabled").notNull().default(true),
  botName: text("bot_name").notNull().default("Reece"),
  botPrompt: text("bot_prompt").notNull().default(""),

  // ---- Copy (page headlines / subheads) -------------------------------
  copy: jsonb("copy").$type<Record<string, string>>(),

  // ---- VSL / extra resource URLs --------------------------------------
  vslUrls: jsonb("vsl_urls").$type<Record<string, string>>(),

  // ---- Registration webhook -------------------------------------------
  webhookUrl: text("webhook_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webinarSessions = pgTable(
  "webinar_sessions",
  {
    id: serial("id").primaryKey(),
    /** Absolute UTC instant the "live" airing starts. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** scheduled | live | ended | canceled */
    status: text("status").notNull().default("scheduled"),
    /** Snapshot of the video duration at generation time (seconds). */
    videoDurationSeconds: integer("video_duration_seconds").notNull().default(3600),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    startsAtUq: uniqueIndex("webinar_sessions_starts_at_uq").on(t.startsAt),
    statusIdx: index("webinar_sessions_status_idx").on(t.status),
  }),
);

export const webinarRegistrants = pgTable(
  "webinar_registrants",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => webinarSessions.id, { onDelete: "cascade" }),
    /** High-entropy single-use access token (the unique join link). */
    token: text("token").notNull(),
    firstName: text("first_name"),
    email: text("email").notNull(),
    phone: text("phone"),

    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    /** Cumulative seconds the registrant watched (server-tracked heartbeat). */
    watchDurationSeconds: integer("watch_duration_seconds").notNull().default(0),
    ctaClicked: boolean("cta_clicked").notNull().default(false),
    ctaClickedAt: timestamp("cta_clicked_at", { withTimezone: true }),
    /** True once the $27 fast-track offer is paid (set by the thank-you flow). */
    offer27Paid: boolean("offer27_paid").notNull().default(false),
    offer27PaidAt: timestamp("offer27_paid_at", { withTimezone: true }),

    /** Stamped once the registration webhook fires (fire-and-forget). */
    webhookFiredAt: timestamp("webhook_fired_at", { withTimezone: true }),

    // Lightweight attribution captured at registration time.
    source: text("source"),
    referrer: text("referrer"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tokenUq: uniqueIndex("webinar_registrants_token_uq").on(t.token),
    sessionIdx: index("webinar_registrants_session_idx").on(t.sessionId),
    emailIdx: index("webinar_registrants_email_idx").on(t.email),
  }),
);

export const webinarChatMessages = pgTable(
  "webinar_chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").references(() => webinarSessions.id, {
      onDelete: "cascade",
    }),
    /** host | attendee | bot | system */
    role: text("role").notNull().default("attendee"),
    authorName: text("author_name").notNull().default("Guest"),
    body: text("body").notNull(),
    /** Replay offset in seconds from video start. NULL = real-time (live) message. */
    displayAtSeconds: integer("display_at_seconds"),
    /** True for the scripted/seeded simulated chat (vs a live AI/human line). */
    scripted: boolean("scripted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("webinar_chat_messages_session_idx").on(t.sessionId),
    displayIdx: index("webinar_chat_messages_display_idx").on(t.displayAtSeconds),
  }),
);

export type WebinarSettings = typeof webinarSettings.$inferSelect;
export type WebinarSession = typeof webinarSessions.$inferSelect;
export type WebinarRegistrant = typeof webinarRegistrants.$inferSelect;
export type WebinarChatMessage = typeof webinarChatMessages.$inferSelect;
