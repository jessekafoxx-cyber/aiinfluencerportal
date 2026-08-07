/**
 * AI Video Studio (Task #828) - admin-only HeyGen talking-head generation
 * with optional Remotion auto-edit, gallery, and a dedicated "video
 * credits" balance.
 *
 * Deliberately a SEPARATE credit type from research / os-tool / influencer
 * credits. Video credits live in their own wallet (video_credits) + ledger
 * (video_credit_transactions) so the existing balances are never touched.
 *
 * Four tables:
 *   - video_credits             one wallet row per portal_user (balance)
 *   - video_credit_transactions append-only ledger (purchase/debit/refund)
 *   - heygen_avatars            cache of HeyGen photo-avatars keyed by the
 *                               source influencer image (avoid re-uploading)
 *   - video_jobs                one row per generation, carries raw +
 *                               edited outputs and refund accounting
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalUsersTable } from "./portal";

// ---------------------------------------------------------------------------
// Wallet: one row per portal user. Auto-created at zero on first read.
// ---------------------------------------------------------------------------
export const videoCreditsTable = pgTable(
  "video_credits",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    // Fractional-credit ledger (Task #837): balance in 1/100-credit sub-units.
    // Nullable for publish-safe rollout; effective balance = balance_subunits ??
    // balance * 100. Backfilled by a standalone script post-publish.
    balanceSubunits: integer("balance_subunits"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    portalUserUnique: uniqueIndex("video_credits_portal_user_unique").on(t.portalUserId),
  }),
);

export type VideoCreditWallet = typeof videoCreditsTable.$inferSelect;
export type InsertVideoCreditWallet = typeof videoCreditsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Ledger: append-only. Positive amount = credit, negative = debit.
// ---------------------------------------------------------------------------
export const videoCreditTransactionsTable = pgTable(
  "video_credit_transactions",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    // Fractional-credit ledger (Task #837): signed delta + post-balance in
    // 1/100-credit sub-units. Nullable for publish-safe rollout; effective
    // values fall back to amount * 100 / balance_after * 100 when null.
    amountSubunits: integer("amount_subunits"),
    balanceAfterSubunits: integer("balance_after_subunits"),
    reason: text("reason"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    portalUserIdx: index("video_credit_tx_portal_user_idx").on(t.portalUserId),
    idempotencyKeyUnique: uniqueIndex("video_credit_tx_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    stripePiUnique: uniqueIndex("video_credit_tx_stripe_pi_unique")
      .on(t.stripePaymentIntentId)
      .where(sql`stripe_payment_intent_id IS NOT NULL`),
  }),
);

export type VideoCreditTransaction = typeof videoCreditTransactionsTable.$inferSelect;
export type InsertVideoCreditTransaction = typeof videoCreditTransactionsTable.$inferInsert;

export const VIDEO_CREDIT_TX_TYPES = {
  PURCHASE: "purchase",
  GENERATION_DEBIT: "generation_debit",
  EDIT_DEBIT: "edit_debit",
  REFUND: "refund",
  ADMIN_ADJUST: "admin_adjust",
} as const;

export type VideoCreditTxType =
  (typeof VIDEO_CREDIT_TX_TYPES)[keyof typeof VIDEO_CREDIT_TX_TYPES];

// ---------------------------------------------------------------------------
// HeyGen photo-avatar cache. One row per (portal user, source image) so a
// repeat generation from the same influencer photo reuses the avatar id.
// ---------------------------------------------------------------------------
export const heygenAvatarsTable = pgTable(
  "heygen_avatars",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    influencerId: integer("influencer_id"),
    sourceImageUrl: text("source_image_url").notNull(),
    sourceImageHash: text("source_image_hash").notNull(),
    heygenAvatarId: text("heygen_avatar_id"),
    heygenGroupId: text("heygen_group_id"),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    portalUserHashUnique: uniqueIndex("heygen_avatars_user_hash_unique").on(
      t.portalUserId,
      t.sourceImageHash,
    ),
    portalUserIdx: index("heygen_avatars_portal_user_idx").on(t.portalUserId),
  }),
);

export type HeygenAvatar = typeof heygenAvatarsTable.$inferSelect;
export type InsertHeygenAvatar = typeof heygenAvatarsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Generation jobs. One row per talking-head video. Carries the raw HeyGen
// output and, when auto-edited, the Remotion output + refund accounting.
// ---------------------------------------------------------------------------
export const videoJobsTable = pgTable(
  "video_jobs",
  {
    id: serial("id").primaryKey(),
    portalUserId: integer("portal_user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    influencerId: integer("influencer_id"),
    heygenAvatarId: text("heygen_avatar_id"),
    sourceImageUrl: text("source_image_url"),
    // Generation inputs
    script: text("script").notNull(),
    voiceId: text("voice_id"),
    // Voice-changer path (Task #838): record/upload audio -> ElevenLabs
    // speech-to-speech -> HeyGen audio voice. Nullable for publish-safe
    // rollout; a job is "audio mode" when sourceAudioUrl is set (inputMode
    // = 'audio'). stsVoiceId is the ElevenLabs voice id (a SEPARATE namespace
    // from the HeyGen voiceId used by the text path) and is persisted per
    // character so the audio path can auto-select the last-used voice.
    inputMode: text("input_mode"),
    stsVoiceId: text("sts_voice_id"),
    sourceAudioUrl: text("source_audio_url"),
    convertedAudioUrl: text("converted_audio_url"),
    quality: text("quality").notNull().default("high"),
    aspectRatio: text("aspect_ratio").notNull().default("9:16"),
    title: text("title"),
    // Generation lifecycle: pending | generating | completed | failed
    status: text("status").notNull().default("pending"),
    heygenVideoId: text("heygen_video_id"),
    rawVideoUrl: text("raw_video_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    generationCreditsCost: integer("generation_credits_cost").notNull().default(0),
    errorMessage: text("error_message"),
    // Auto-edit (Remotion) lifecycle: null | pending | editing | completed | failed
    editStyle: text("edit_style"),
    editStatus: text("edit_status"),
    remotionRenderId: text("remotion_render_id"),
    editedVideoUrl: text("edited_video_url"),
    editCreditsCost: integer("edit_credits_cost").notNull().default(0),
    editErrorMessage: text("edit_error_message"),
    // Refund accounting (idempotent timeout / failure refunds)
    refundedCredits: integer("refunded_credits").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    portalUserIdx: index("video_jobs_portal_user_idx").on(t.portalUserId),
    statusIdx: index("video_jobs_status_idx").on(t.status),
    heygenVideoIdx: index("video_jobs_heygen_video_idx").on(t.heygenVideoId),
    remotionRenderIdx: index("video_jobs_remotion_render_idx").on(t.remotionRenderId),
  }),
);

export type VideoJob = typeof videoJobsTable.$inferSelect;
export type InsertVideoJob = typeof videoJobsTable.$inferInsert;
