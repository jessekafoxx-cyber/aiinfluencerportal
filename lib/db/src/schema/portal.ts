import { pgTable, text, integer, timestamp, boolean, serial, varchar, jsonb, inet, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portalUsersTable = pgTable("portal_users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").unique(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").default("student").notNull(),
  whopUserId: text("whop_user_id"),
  orderId: text("order_id"),
  // Stripe customer + saved default payment method for one-click portal addon
  // unlocks. Captured during the original bundle checkout via
  // payment_intent_data.setup_future_usage='off_session'.
  stripeCustomerId: text("stripe_customer_id"),
  stripeDefaultPaymentMethodId: text("stripe_default_payment_method_id"),
  stripeDefaultPmBrand: text("stripe_default_pm_brand"),
  stripeDefaultPmLast4: text("stripe_default_pm_last4"),
  // Which portal this user belongs to. Single-tenant since Task #491
  // (the Apex/course-portal frontend was removed); kept as a column so
  // legacy rows and migrations stay consistent. Defaults to 'room30'.
  portalKey: text("portal_key").default("room30").notNull(),
  isActive: boolean("is_active").default(false),
  isAList: boolean("is_a_list").default(false),
  aListJoinedAt: timestamp("a_list_joined_at"),
  inviteToken: text("invite_token"),
  invitedAt: timestamp("invited_at"),
  lastLoginAt: timestamp("last_login_at"),
  researchGenerationsCompleted: integer("research_generations_completed").default(0).notNull(),
  researchPaidCredits: integer("research_paid_credits").default(0).notNull(),
  osToolPaidCredits: integer("os_tool_paid_credits").default(0).notNull(),
  // Cumulative AI usage in cents. The first $10 (1000 cents) is included in
  // the user's purchase and stays silent. Once the user crosses the threshold
  // we send a one-time email and surface a banner + buy-credits CTA in
  // settings. Below the threshold the credit UI is hidden completely.
  aiUsageCents: integer("ai_usage_cents").default(0).notNull(),
  aiOverlimitNotifiedAt: timestamp("ai_overlimit_notified_at"),
  aiOverlimitDismissedAt: timestamp("ai_overlimit_dismissed_at"),
  founderNoticeDismissedAt: timestamp("founder_notice_dismissed_at"),
  // Done-For-You current phase (1=War Map, 2=Build, 3=Launch, 4=Live Workshops).
  // Drives which tab opens by default and which phase is highlighted.
  currentDfyPhase: integer("current_dfy_phase").default(1).notNull(),
  // Task #283: tracks whether the buyer has already seen the one-time
  // celebratory popup announcing the 5 bonus AR influencer generations
  // unlocked by Upsell 2. Stored server-side (not localStorage) so the
  // popup follows the user across devices and only ever fires once. Set
  // to true the first time the buyer dismisses or CTA-clicks the modal.
  // Always defaults to false so the popup fires on the next portal visit
  // for both new buyers and any existing Upsell 2 buyers we backfill.
  upsell2InfluencerUnlockSeen: boolean("upsell2_influencer_unlock_seen")
    .default(false)
    .notNull(),
  // Manual bonus AI Influencer generations granted on top of the
  // base entitlement (1 free + 5 from upsell2Paid). Admins set this
  // from the Buyer Access panel or via the external API to comp
  // arbitrary N additional builds. resolveInfluencerQuota /
  // computePurchaseEntitlements add this value to the bonus pool,
  // so total cap = 1 + (upsell2 ? 5 : 0) + bonusInfluencerQuota.
  // Never negative.
  bonusInfluencerQuota: integer("bonus_influencer_quota").default(0).notNull(),
  // Task #290: timestamp of when the one-time "Welcome to Room30 AI" email
  // was sent the first time the buyer actually signed in (not when their
  // invite went out). NULL means the email has not been sent yet. Set
  // atomically (UPDATE ... WHERE welcome_email_sent_at IS NULL) before
  // dispatching the email so concurrent requests on the same Clerk session
  // can never produce a duplicate. Backfilled to now() in migration 0031
  // for every existing row so the welcome only fires for accounts created
  // after this feature ships.
  welcomeEmailSentAt: timestamp("welcome_email_sent_at"),
  // Task #299: timestamp of when the one-time reactivation reminder email
  // was sent to a buyer who never signed in after their invite/account-
  // ready email. NULL means the reminder has not been sent yet. Set
  // atomically (UPDATE ... WHERE reactivation_email_sent_at IS NULL AND
  // last_login_at IS NULL AND is_active = true AND role != 'admin') by
  // the worker scheduler so concurrent passes can never produce a
  // duplicate. Backfilled to now() in migration 0032 for every existing
  // row so the reminder only fires for accounts created after this
  // feature ships.
  reactivationEmailSentAt: timestamp("reactivation_email_sent_at"),
  // Task #315: Whop affiliate username for the company-wide affiliate
  // leaderboard. Maps Whop's `affiliate_username` (returned on /payments)
  // to a Room30 student so we can roll commissions up by user. Admin-
  // editable. Auto-populated from `orders.affiliate_code` when a unique
  // match exists. Lower-cased on write so case differences in Whop's
  // response cannot create unmapped duplicates.
  whopAffiliateUsername: text("whop_affiliate_username"),
  // Task #584: FirstPromoter promoter mapping. Auto-provisioned the first
  // time the buyer signs into the portal (POST /promoters/create on FP).
  // The `firstpromoter_referral_code` is the FP `cust_id` we hand to FP
  // on create; the buyer's share link is `https://room30.ai/?fpr=<code>`.
  firstpromoterPromoterId: text("firstpromoter_promoter_id"),
  firstpromoterReferralCode: text("firstpromoter_referral_code"),
  // Task #659: optional user-chosen vanity slug for /r/<slug> short
  // links. Lower-case, [a-z0-9-]{3,30}, unique (enforced via a
  // partial unique index in migration 0063). Null = user has not set
  // a custom slug and shares the canonical /r/<cust_id> form.
  firstpromoterUsername: text("firstpromoter_username"),
  // Task #726: stamped the first time we fire the "your affiliate
  // links are live" portal notification + Resend email for this user
  // (set by maybeNotifyAffiliateReady in lib/firstpromoter-ready-notify.ts).
  // Atomic UPDATE ... WHERE firstpromoter_ready_notified_at IS NULL
  // RETURNING gates the send so concurrent /affiliate/me hits cannot
  // double-fire. Null = never notified.
  firstpromoterReadyNotifiedAt: timestamp("firstpromoter_ready_notified_at"),
  // 1-1 Onboarding Call (GHL booking calendar eUBO2GGTIzk59M2DGrN1).
  // onboardingCallPromptSeenAt: stamped the first time the buyer dismisses
  // the one-time first-login "book your onboarding call" popup so it never
  // auto-fires again. Null = never shown. Existing accounts (created before
  // this feature shipped) are excluded from the auto-popup by a createdAt
  // launch-cutoff check, not a backfill, so no UPDATE migration is needed.
  // onboardingCallBookedAt: cached the first time we detect (via the GHL
  // calendar appointments API) that this buyer has booked the onboarding
  // call. Once set we short-circuit all future GHL lookups and hide the
  // sidebar booking link permanently (book-once-ever).
  onboardingCallPromptSeenAt: timestamp("onboarding_call_prompt_seen_at"),
  onboardingCallBookedAt: timestamp("onboarding_call_booked_at"),
  // Task #796: team-member management. Only meaningful when role='team'.
  // teamRole is a preset label ('onboarding_specialist' |
  // 'customer_support_specialist' | 'custom') used purely to seed the
  // permission checkboxes in the admin UI; the source of truth for what a
  // team member can actually do is the `permissions` array. Both are NULL
  // for students/admins (admins implicitly hold every capability). The
  // backend tolerates NULL = no capabilities. No backfill needed.
  teamRole: text("team_role"),
  permissions: jsonb("permissions").$type<string[] | null>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const coursePhasesTable = pgTable("course_phases", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
  // Single-tenant since Task #491; default flipped to 'room30' in
  // Task #558 migration 0053 so new rows can't recreate the legacy drift.
  portalKey: text("portal_key").default("room30").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lessonsTable = pgTable("lessons", {
  id: serial("id").primaryKey(),
  phaseId: integer("phase_id").notNull(),
  slug: text("slug").unique().notNull(),
  title: text("title").notNull(),
  brief: text("brief"),
  // wistiaVideoId tri-state semantics:
  //   NULL  -> lesson has never been touched; boot installer in
  //            artifacts/api-server/src/lib/ensure-lesson-videos.ts will
  //            populate it with the canonical ID if one is mapped.
  //   ""    -> admin deliberately cleared the video via the admin editor
  //            (PUT /portal/admin/lessons/:slug/wistia). Treated as the
  //            empty state by the player; boot installer will NOT refill it.
  //   <id>  -> bare Wistia hashed ID (e.g. "qjbs542d7e"), embedded as
  //            https://fast.wistia.net/embed/iframe/<id>.
  // Anything querying for "missing video" should test for NULL OR length=0.
  wistiaVideoId: text("wistia_video_id"),
  promptTemplate: text("prompt_template"),
  downloadFiles: jsonb("download_files"),
  // Legacy single-task field (kept for back-compat, no longer rendered when
  // actionTasks is populated). Going forward, use actionTasks instead.
  actionTask: text("action_task"),
  // New multi-task field. Array of 1-3 short action items per lesson, or
  // null for lessons that have no actionable task (intros, support, etc).
  actionTasks: jsonb("action_tasks").$type<string[] | null>(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull(),
  durationMinutes: integer("duration_minutes"),
  isPublished: boolean("is_published").default(true),
  // Three-state visibility for admin control.
  //   'published'   — visible with full video access (default)
  //   'coming_soon' — visible but shows Coming Soon badge, no playback
  //   'draft'       — hidden from all members; admin-only
  // Added by boot DDL (ensure-dfy-schema-applied.ts) so it self-heals on
  // any DB (including production). Default 'published' so existing rows
  // without the column get a safe starting point; the seeder then
  // backfills lessons with no video to 'coming_soon' on every boot.
  status: text("status").default("published").notNull(),
  // See coursePhasesTable.portalKey. Single-tenant since Task #491;
  // default flipped to 'room30' in Task #558 migration 0053.
  portalKey: text("portal_key").default("room30").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const lessonProgressTable = pgTable("lesson_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  lessonId: integer("lesson_id").notNull(),
  completed: boolean("completed").default(false),
  // Legacy single-task completion flag, kept in sync when ALL items in
  // actionTasksCompleted are true (used by older code paths and reporting).
  actionTaskCompleted: boolean("action_task_completed").default(false),
  // Per-task completion state, parallel to lessonsTable.actionTasks.
  // Index N in this array corresponds to index N in actionTasks.
  actionTasksCompleted: jsonb("action_tasks_completed").$type<boolean[] | null>(),
  watchTimeSeconds: integer("watch_time_seconds").default(0),
  lastPosition: integer("last_position").default(0),
  promptData: jsonb("prompt_data"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const accessLogsTable = pgTable("access_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  clerkId: text("clerk_id"),
  email: text("email"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  resourcePath: text("resource_path"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  // access_logs is append-only and unbounded (a row per user action). The admin
  // analytics "recent activity" panel does ORDER BY created_at DESC LIMIT 50;
  // without this index Postgres full-scans + sorts the whole table (~11s in
  // prod), which is what made the admin dashboard appear stuck on refresh.
  createdAtIdx: index("access_logs_created_at_idx").on(t.createdAt),
}));

export const invitesTable = pgTable("invites", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  token: text("token").unique().notNull(),
  accessLevel: text("access_level").default("main"),
  // Which portal this invite is for. Drives:
  //   1. Email branding (Room30 logo + copy vs Apex Offers logo + copy)
  //   2. The sign-up link (`/members/sign-up` on room30.ai vs
  //      `/portal/sign-up` on apexoffers.io)
  //   3. /portal/enroll claim filter (a Room30 sign-up can never claim a
  //      pending Apex invite for the same email and vice versa)
  // Stamped server-side from `X-Portal-Key` on the inviting admin's
  // request. Single-tenant since Task #491; default flipped to 'room30'
  // in Task #558 migration 0053.
  portalKey: text("portal_key").default("room30").notNull(),
  status: text("status").default("pending").notNull(),
  sentBy: integer("sent_by"),
  claimedAt: timestamp("claimed_at"),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // What role to give the user when they sign up using this invite.
  // One of "student" | "team" | "admin". Defaults to "student" so older
  // invites without this column behave the same as before.
  role: text("role").default("student"),
  // Per-product access flags to apply at sign-up. Object shape:
  //   { bump1Paid, bump2Paid, bump3Paid, upsell1Paid, upsell2Paid,
  //     upsell3Paid, downsell1Paid, isAList,
  //     tiktokSlideshowPaid, hookDemoPaid, doneForYouPackPaid,
  //     portfolioPaid, platinumPaid } — all optional booleans.
  // The last five flags back the new "Coming soon" sidebar upgrades
  // (TikTok AI Slideshow Masterclass, Hook + Demo Library, Done For
  // You Pack, Our Portfolio, Platinum Club) and exist so admins can
  // grant manual access via invite before checkout is wired in.
  // Applied to the synthetic admin-grant-<userId> order row when the
  // invitee enrolls. Null/empty means no manual grants are applied.
  grants: jsonb("grants"),
  // Task #796: team-member preset + capability list applied when the
  // invitee enrolls (only meaningful when role='team'). Mirrors the
  // matching columns on portal_users. Null for student/admin invites.
  teamRole: text("team_role"),
  permissions: jsonb("permissions").$type<string[] | null>(),
});

export const userAssetsTable = pgTable("user_assets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  lessonSlug: text("lesson_slug"),
  assetType: text("asset_type").default("doc").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserAsset = typeof userAssetsTable.$inferSelect;

export const userBrainProfilesTable = pgTable("user_brain_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  name: text("name"),
  companyName: text("company_name"),
  whoDoYouHelp: text("who_do_you_help"),
  howDoYouHelpThem: text("how_do_you_help_them"),
  keyAchievements: text("key_achievements"),
  website: text("website"),
  landingPages: jsonb("landing_pages").default([]),
  socialProfiles: jsonb("social_profiles").default([]),
  brandColorPrimary: text("brand_color_primary"),
  brandColorSecondary: text("brand_color_secondary"),
  brandGuidelinesUrl: text("brand_guidelines_url"),
  brandColorSource: text("brand_color_source").default("manual"),
  // Brain mode: 'own' (user fills in their own offer) or 'prebuilt' (user
  // picked one of our curated brains so they can promote one of our offers
  // through the OS tools without writing their own positioning first).
  brainMode: text("brain_mode").default("own").notNull(),
  // Slug of the selected entry from prebuilt-brains.ts when brainMode='prebuilt'.
  // Nullable so 'own' mode rows don't have to carry a stale value.
  selectedPrebuiltBrainId: text("selected_prebuilt_brain_id"),
  confirmedLowTicketOffer: jsonb("confirmed_low_ticket_offer"),
  confirmedPremiumOffer: jsonb("confirmed_premium_offer"),
  confirmed100kOffer: jsonb("confirmed_100k_offer"),
  generatedBrain: text("generated_brain"),
  scrapedData: jsonb("scraped_data"),
  status: text("status").default("draft").notNull(),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserBrainProfile = typeof userBrainProfilesTable.$inferSelect;

export const userExpertiseProfilesTable = pgTable("user_expertise_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  answers: jsonb("answers").default({}).notNull(),
  generatedProfile: text("generated_profile"),
  coreExpertise: text("core_expertise"),
  uniqueAngle: text("unique_angle"),
  subNiche: text("sub_niche"),
  whyQualified: text("why_qualified"),
  suggestedOfferDirection: text("suggested_offer_direction"),
  recommendedNextSteps: text("recommended_next_steps"),
  status: text("status").default("draft").notNull(),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserExpertiseProfile = typeof userExpertiseProfilesTable.$inferSelect;

export const supportArticlesTable = pgTable("support_articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  summary: text("summary"),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").default(0),
  isPublished: boolean("is_published").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const supportChatsTable = pgTable("support_chats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  messages: jsonb("messages").default([]).notNull(),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SupportArticle = typeof supportArticlesTable.$inferSelect;
export type SupportChat = typeof supportChatsTable.$inferSelect;

export const leaderboardProfilesTable = pgTable("leaderboard_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  tagName: text("tag_name").notNull(),
  avatarUrl: text("avatar_url"),
  niche: text("niche"),
  whopApiKey: text("whop_api_key"),
  stripeApiKey: text("stripe_api_key"),
  paymentProvider: text("payment_provider"),
  isConnected: boolean("is_connected").default(false),
  isPublic: boolean("is_public").default(true),
  isDummy: boolean("is_dummy").default(false),
  // 'ok' (default) or 'auth_failed' — set when the Stripe/Whop key returns 401/403
  // during a sync. Key itself is preserved so the user can re-validate.
  syncStatus: text("sync_status").default("ok"),
  lastSyncError: text("last_sync_error"),
  lastSyncErrorAt: timestamp("last_sync_error_at"),
  lastSyncSuccessAt: timestamp("last_sync_success_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const leaderboardRevenueTable = pgTable("leaderboard_revenue", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  amount: integer("amount").notNull(),
  saleType: text("sale_type").notNull(),
  description: text("description"),
  recordedAt: timestamp("recorded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type LeaderboardProfile = typeof leaderboardProfilesTable.$inferSelect;
export type LeaderboardRevenue = typeof leaderboardRevenueTable.$inferSelect;

// Task #315: Whop-sourced affiliate commissions. One row per attributed
// payment Whop tells us about. Re-syncing is idempotent on
// (whop_payment_id, product_id) so a buyer who toggled bumps + main
// (multiple line items, same payment id) is preserved correctly. Refunds
// reduce `commissionAmount` (and may flip `refunded=true`) on the next
// sync. Amounts are stored in cents.
export const affiliateCommissionsTable = pgTable("affiliate_commissions", {
  id: serial("id").primaryKey(),
  // Lower-cased Whop affiliate username, the join key onto
  // portal_users.whop_affiliate_username.
  affiliateUsername: text("affiliate_username").notNull(),
  whopPaymentId: text("whop_payment_id").notNull(),
  whopProductId: text("whop_product_id"),
  productLabel: text("product_label").notNull(),
  // Gross sale amount in cents.
  saleAmount: integer("sale_amount").notNull(),
  // Affiliate commission amount in cents (post-refund net).
  commissionAmount: integer("commission_amount").notNull(),
  currency: text("currency").default("usd").notNull(),
  refunded: boolean("refunded").default(false).notNull(),
  refundedAmount: integer("refunded_amount").default(0).notNull(),
  saleAt: timestamp("sale_at").notNull(),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AffiliateCommission = typeof affiliateCommissionsTable.$inferSelect;

// Task #315: Manual commissions credited by an admin. Used for off-Whop
// high-ticket sales (e.g. the $100K offer's $10,000 commission). These
// rows feed the same leaderboard aggregation as `affiliate_commissions`
// and survive Whop re-syncs because they live in their own table. Negative
// amounts are allowed so admins can reverse an entry without deleting it.
export const manualCommissionsTable = pgTable("manual_commissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  productLabel: text("product_label").notNull(),
  // Commission amount in cents. May be negative (clawback / correction).
  commissionAmount: integer("commission_amount").notNull(),
  saleDate: timestamp("sale_date").notNull(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ManualCommission = typeof manualCommissionsTable.$inferSelect;

// Task #315: tiny key/value store for cross-cutting admin toggles. Today
// the only key is `affiliate_leaderboard_public` ("true"/"false") which
// flips the affiliate leaderboard from admin-only to all-users without
// a deploy.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;

export const liveWorkshopsTable = pgTable("live_workshops", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at").notNull(),
  durationMinutes: integer("duration_minutes").default(120).notNull(),
  meetingUrl: text("meeting_url").notNull(),
  recordingUrl: text("recording_url"),
  createdBy: text("created_by"),
  // Set atomically via UPDATE ... WHERE reminder_24h_sent_at IS NULL
  // by workshop-reminder-scheduler so two worker processes cannot
  // double-blast the Platinum Club list during a rolling restart.
  reminder24hSentAt: timestamp("reminder_24h_sent_at"),
  reminder15mSentAt: timestamp("reminder_15m_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type LiveWorkshop = typeof liveWorkshopsTable.$inferSelect;
export const insertLiveWorkshopSchema = createInsertSchema(liveWorkshopsTable);
export type InsertLiveWorkshop = z.infer<typeof insertLiveWorkshopSchema>;

export const aListCallsTable = pgTable("a_list_calls", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  callDate: timestamp("call_date").notNull(),
  duration: integer("duration"),
  recordingUrl: text("recording_url"),
  notes: text("notes"),
  callType: text("call_type").default("one-on-one"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aListTasksTable = pgTable("a_list_tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("pending").notNull(),
  priority: text("priority").default("medium"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aListRoadmapTable = pgTable("a_list_roadmap", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  milestone: text("milestone").notNull(),
  description: text("description"),
  targetDate: timestamp("target_date"),
  status: text("status").default("upcoming").notNull(),
  sortOrder: integer("sort_order").default(0),
  // Phase 1 War Map, 2 Build, 3 Launch, 4 Live Workshops.
  phaseNumber: integer("phase_number").default(2).notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AListCall = typeof aListCallsTable.$inferSelect;
export type AListTask = typeof aListTasksTable.$inferSelect;
export type AListRoadmap = typeof aListRoadmapTable.$inferSelect;

// DFY (Done-For-You) build assets — files / links / docs delivered to a DFY
// client during the productized build engagement. Managed by admins; visible
// to the assigned client. Categories examples: "war-map", "funnel", "ads",
// "emails", "vsl", "automation", "launch".
export const dfyBuildAssetsTable = pgTable("dfy_build_assets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  category: text("category").default("general").notNull(),
  assetType: text("asset_type").default("link").notNull(), // "link" | "file" | "doc"
  url: text("url"),
  notes: text("notes"),
  status: text("status").default("ready").notNull(), // "in-progress" | "ready" | "needs-review"
  sortOrder: integer("sort_order").default(0).notNull(),
  // Phase 1 War Map, 2 Build, 3 Launch, 4 Live Workshops.
  phaseNumber: integer("phase_number").default(2).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DfyBuildAsset = typeof dfyBuildAssetsTable.$inferSelect;

// Two-way channel between admin and DFY client. Admin posts updates,
// admin or client can post requests, and the other party can reply.
// kind: "update" (admin announcement), "request" (waiting on something),
//       "reply" (response in a thread).
// authorRole: "admin" | "client".
// status: "open" | "answered" | "archived".
export const dfyClientUpdatesTable = pgTable("dfy_client_updates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  authorRole: text("author_role").notNull(),
  authorName: text("author_name"),
  kind: text("kind").default("update").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  phaseNumber: integer("phase_number").default(2).notNull(),
  parentId: integer("parent_id"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DfyClientUpdate = typeof dfyClientUpdatesTable.$inferSelect;

// DFY Stripe restricted-key connection per client. Used to read totals
// (7/30/90 day revenue) for the admin DFY view. Mirrors the leaderboard
// stripe pattern but is scoped to a specific user.
export const dfyStripeConnectionsTable = pgTable("dfy_stripe_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  stripeApiKey: text("stripe_api_key").notNull(),
  accountLabel: text("account_label"),
  syncStatus: text("sync_status").default("ok").notNull(), // "ok" | "auth_failed"
  lastSyncError: text("last_sync_error"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DfyStripeConnection = typeof dfyStripeConnectionsTable.$inferSelect;

// DFY Pack Instagram Highlight Covers — a curated library of cover images
// shipped to every paid DFY-Pack buyer. Managed by admins; visible to any
// user with the `doneForYouPackPaid` entitlement (admins always counted).
// `objectName` is the bare filename inside `${PRIVATE_OBJECT_DIR}/` (matching
// the carousel/upload pattern in portal.ts) so the existing
// /portal/images/:fileName serve route can stream the bytes back without
// special-casing this table.
export const dfyHighlightCoversTable = pgTable("dfy_highlight_covers", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  objectName: text("object_name").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").default(0).notNull(),
  originalFilename: text("original_filename"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DfyHighlightCover = typeof dfyHighlightCoversTable.$inferSelect;

// T313: persisted catalog of files we've synced from each configured DFY
// Drive folder. The 250+ Scenes / 100 AI Influencers grids serve from this
// table, with originals + thumbnails mirrored to GCS, instead of proxying
// every thumbnail through Drive on every page load.
export const dfyDriveAssetsTable = pgTable("dfy_drive_assets", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").default("image/jpeg").notNull(),
  width: integer("width"),
  height: integer("height"),
  fileSize: integer("file_size"),
  originalObjectKey: text("original_object_key"),
  thumbObjectKey: text("thumb_object_key"),
  driveModifiedTime: timestamp("drive_modified_time", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortKey: text("sort_key").default("").notNull(),
  // T392: when a slug is in subfolder mode, each row records which Drive
  // subfolder it came from so the portal can render a folder-grid index
  // and per-folder drill-in views. Null for slugs that stay flat.
  subfolderDriveId: text("subfolder_drive_id"),
  subfolderName: text("subfolder_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DfyDriveAsset = typeof dfyDriveAssetsTable.$inferSelect;

// T313: per-slug sync run history. The most recent row per slug powers the
// admin "last synced at" line and lets the periodic worker skip a tick when
// one is already in flight (lease_expires_at acts as the heartbeat-style
// guard so a crashed run can't pin the slug forever).
export const dfyDriveSyncRunsTable = pgTable("dfy_drive_sync_runs", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  status: text("status").default("running").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  added: integer("added").default(0).notNull(),
  updated: integer("updated").default(0).notNull(),
  removed: integer("removed").default(0).notNull(),
  skipped: integer("skipped").default(0).notNull(),
  failed: integer("failed").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  error: text("error"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
});

export type DfyDriveSyncRun = typeof dfyDriveSyncRunsTable.$inferSelect;

// T392: persisted catalog of every Drive subfolder we've discovered for a
// subfolder-mode slug. Tracked independently of `dfy_drive_assets` so an
// empty subfolder still appears as a folder card on the index. Each sync
// reconciles this table - new folders are inserted, removed/renamed
// folders flip is_active=false (and rename their name).
export const dfyDriveSubfoldersTable = pgTable("dfy_drive_subfolders", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  driveSubfolderId: text("drive_subfolder_id").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DfyDriveSubfolder = typeof dfyDriveSubfoldersTable.$inferSelect;

export const termsAcceptancesTable = pgTable("terms_acceptances", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  orderId: text("order_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  checkboxText: text("checkbox_text").notNull(),
  pageUrl: text("page_url"),
  termsVersion: text("terms_version").default("1.0"),
  refundPolicyVersion: text("refund_policy_version").default("1.0"),
  fingerprintHash: text("fingerprint_hash"),
  sessionId: text("session_id"),
  // Where the consent was collected. One of: 'checkout' | 'upsell1' |
  // 'downsell1' | 'upsell2' | 'upsell3' | 'downsell3' | 'portal_addon'.
  // Nullable so legacy rows pre-Task #11 don't blow up; new writes
  // always set it.
  context: text("context"),
  acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  templateType: text("template_type").notNull(),
  status: text("status").default("sent").notNull(),
  metadata: jsonb("metadata"),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const researchGenerationJobsTable = pgTable("research_generation_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | complete | error
  progress: integer("progress").notNull().default(0), // 0–100
  progressLabel: text("progress_label"),
  additionalContext: text("additional_context"),
  errorMessage: text("error_message"),
  marketResearchContent: text("market_research_content"),
  awarenessStagesContent: text("awareness_stages_content"),
  customerAvatarsContent: text("customer_avatars_content"),
  anglesHooksContent: text("angles_hooks_content"),
  marketResearchAssetId: integer("market_research_asset_id"),
  awarenessStagesAssetId: integer("awareness_stages_asset_id"),
  customerAvatarsAssetId: integer("customer_avatars_asset_id"),
  anglesHooksAssetId: integer("angles_hooks_asset_id"),
  creditType: text("credit_type"), // "free" | "paid"
  researchStats: jsonb("research_stats"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const osToolSaveJobsTable = pgTable("os_tool_save_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("pending"), // pending | saving_asset | generating_secondary | done | failed
  step: integer("step").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(1),
  label: text("label"),
  errorMessage: text("error_message"),
  primaryAssetId: integer("primary_asset_id"),
  secondaryAssetId: integer("secondary_asset_id"),
  primaryContent: text("primary_content"),
  primaryTitle: text("primary_title"),
  primaryCategory: text("primary_category"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OsToolSaveJob = typeof osToolSaveJobsTable.$inferSelect;

export const osToolGenerationJobsTable = pgTable("os_tool_generation_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | done | failed
  label: text("label"),
  errorMessage: text("error_message"),
  answers: jsonb("answers"),
  content: text("content"),
  slides: jsonb("slides"),
  // Number of paid credits charged when this job was queued. Refunded if the job fails.
  chargedCredits: integer("charged_credits").default(0).notNull(),
  // Whether the credit refund has already been issued for a failed job. Prevents double-refund.
  creditsRefunded: boolean("credits_refunded").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OsToolGenerationJob = typeof osToolGenerationJobsTable.$inferSelect;

export const researchCreditPurchasesTable = pgTable("research_credit_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  whopSessionId: text("whop_session_id").unique().notNull(),
  whopUserId: text("whop_user_id"),
  whopReceiptId: text("whop_receipt_id"),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").default("pending").notNull(), // pending | granted
  grantedAt: timestamp("granted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ResearchCreditPurchase = typeof researchCreditPurchasesTable.$inferSelect;

export const osToolCreditPurchasesTable = pgTable("os_tool_credit_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  whopSessionId: text("whop_session_id").unique().notNull(),
  whopUserId: text("whop_user_id"),
  whopReceiptId: text("whop_receipt_id"),
  packId: text("pack_id").notNull(), // e.g. "starter" | "standard" | "pro" | "max"
  creditsGranted: integer("credits_granted").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").default("pending").notNull(), // pending | granted
  grantedAt: timestamp("granted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OsToolCreditPurchase = typeof osToolCreditPurchasesTable.$inferSelect;

export type ResearchGenerationJob = typeof researchGenerationJobsTable.$inferSelect;

export type TermsAcceptance = typeof termsAcceptancesTable.$inferSelect;
export type EmailLog = typeof emailLogsTable.$inferSelect;

export const coachingAgreementsTable = pgTable("coaching_agreements", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  companyName: text("company_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address").notNull(),
  signatureDataUrl: text("signature_data_url").notNull(),
  agreementText: text("agreement_text").notNull(),
  agreementVersion: text("agreement_version").default("1.0").notNull(),
  signedDate: text("signed_date").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  fingerprintHash: text("fingerprint_hash"),
  acceptedTerms: boolean("accepted_terms").default(false).notNull(),
  status: text("status").default("signed").notNull(),
  // 'coaching' (legacy $5k/mo Whop subscription) or 'dfy' ($15k one-time Stripe build)
  agreementType: text("agreement_type").default("coaching").notNull(),
  // 'whop' (recurring) or 'stripe' (one-time DFY)
  paymentProvider: text("payment_provider").default("whop").notNull(),
  // Total package price in cents (e.g. 1500000 for $15,000 DFY).
  packagePriceCents: integer("package_price_cents"),
  whopUserId: text("whop_user_id"),
  whopSessionId: text("whop_session_id"),
  whopMembershipId: text("whop_membership_id"),
  // Stripe Checkout Session id and the resolved PaymentIntent id once paid.
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paidAt: timestamp("paid_at"),
  fbp: text("fbp"),
  fbc: text("fbc"),
  // Affiliate attribution. Stamped at first-touch on /coaching/create
  // (priority: body affiliateCode > aff cookie > prior-order lookup by
  // email within 365 days). Mirrors orders.affiliate_code so DFY $15k
  // high-ticket purchases inherit attribution from a buyer's earlier
  // front-end sale even when the cookie has expired or they returned on
  // a different device, fulfilling the 12-month attribution window.
  affiliateCode: text("affiliate_code"),
  affiliateAttributedAt: timestamp("affiliate_attributed_at"),
  // Task #584: FirstPromoter referral id (tid) captured at /coaching/create.
  firstpromoterReferralId: text("firstpromoter_referral_id"),
  // FP promoter id resolved opportunistically (audit parity with orders).
  firstpromoterPromoterId: text("firstpromoter_promoter_id"),
  signedAt: timestamp("signed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CoachingAgreement = typeof coachingAgreementsTable.$inferSelect;

export const userHighTicketFunnelsTable = pgTable("user_high_ticket_funnels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  offerType: text("offer_type"),
  offerName: text("offer_name"),
  offerPrice: text("offer_price"),
  offerDeliverables: jsonb("offer_deliverables").default([]),
  offerSummary: text("offer_summary"),
  offerDetails: text("offer_details"),
  brandPrimary: text("brand_primary"),
  brandAccent: text("brand_accent"),
  brandConfirmed: boolean("brand_confirmed").default(false),
  legalFullName: text("legal_full_name"),
  legalCompanyName: text("legal_company_name"),
  legalAddress: text("legal_address"),
  legalEmail: text("legal_email"),
  legalPhone: text("legal_phone"),
  signatureDataUrl: text("signature_data_url"),
  signedAt: timestamp("signed_at"),
  // Service-agreement personalisation
  agreementTerm: text("agreement_term"),
  agreementTermCustom: text("agreement_term_custom"),
  agreementPaymentOption: text("agreement_payment_option"),
  agreementPaymentCustom: text("agreement_payment_custom"),
  agreementScope: text("agreement_scope"),
  agreementGuarantee: text("agreement_guarantee"),
  agreementJurisdiction: text("agreement_jurisdiction"),
  agreementCity: text("agreement_city"),
  agreementCustomClauses: text("agreement_custom_clauses"),
  vslUrl: text("vsl_url"),
  vslProvider: text("vsl_provider"),
  testimonials: jsonb("testimonials").default([]),
  caseStudies: jsonb("case_studies").default([]),
  proofEmbeds: jsonb("proof_embeds").default([]),
  proofScreenshots: jsonb("proof_screenshots").default([]),
  pulledFromAssets: boolean("pulled_from_assets").default(false),
  status: text("status").default("draft").notNull(),
  lastGeneratedAt: timestamp("last_generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserHighTicketFunnel = typeof userHighTicketFunnelsTable.$inferSelect;

export const userLowTicketFunnelsTable = pgTable("user_low_ticket_funnels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // Branding
  brandTheme: text("brand_theme").default("green"), // green/pink/blue/red/black-gold/white-black
  brandConfirmed: boolean("brand_confirmed").default(false),
  influencerName: text("influencer_name"),
  // Main offer
  offerName: text("offer_name"),
  offerTagline: text("offer_tagline"),
  offerDescription: text("offer_description"),
  mainPrice: text("main_price"),                  // e.g. "$27"
  mainCompareAt: text("main_compare_at"),         // e.g. "$197"
  // Order bumps + upsells (kept simple as strings)
  bumpName: text("bump_name"),
  bumpPrice: text("bump_price"),
  upsell1Name: text("upsell_1_name"),
  upsell1Price: text("upsell_1_price"),
  downsell1Name: text("downsell_1_name"),
  downsell1Price: text("downsell_1_price"),
  upsell2Name: text("upsell_2_name"),
  upsell2Price: text("upsell_2_price"),
  upsell3Name: text("upsell_3_name"),
  upsell3Price: text("upsell_3_price"),
  // Pulled refs
  pulledFromAssets: boolean("pulled_from_assets").default(false),
  status: text("status").default("draft").notNull(),
  lastGeneratedPage: text("last_generated_page"),
  lastGeneratedAt: timestamp("last_generated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserLowTicketFunnel = typeof userLowTicketFunnelsTable.$inferSelect;

export const insertPortalUserSchema = createInsertSchema(portalUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortalUser = z.infer<typeof insertPortalUserSchema>;
export type PortalUser = typeof portalUsersTable.$inferSelect;

export const insertLessonProgressSchema = createInsertSchema(lessonProgressTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLessonProgress = z.infer<typeof insertLessonProgressSchema>;
export type LessonProgress = typeof lessonProgressTable.$inferSelect;

export type CoursePhase = typeof coursePhasesTable.$inferSelect;
export type Lesson = typeof lessonsTable.$inferSelect;
export type AccessLog = typeof accessLogsTable.$inferSelect;
export type Invite = typeof invitesTable.$inferSelect;
