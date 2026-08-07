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
import { sql } from "drizzle-orm";

/**
 * Task #607 - Internal Sales CRM tables. Strictly scoped to the
 * /crm/ artifact and never joined to portal_users / orders. Three
 * roles: admin, leader, member.
 */

export const crmUsers = pgTable(
  "crm_users",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id").unique(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    role: text("role").notNull().default("member"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    emailLowerUq: uniqueIndex("crm_users_email_lower_uq").on(
      sql`lower(${t.email})`,
    ),
  }),
);

export const crmPipelineStages = pgTable("crm_pipeline_stages", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const crmProducts = pgTable("crm_products", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  commissionPct: integer("commission_pct").notNull().default(0),
  commissionFlatCents: integer("commission_flat_cents").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    phone: text("phone"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    source: text("source"),
    stageId: integer("stage_id").references(() => crmPipelineStages.id, {
      onDelete: "set null",
    }),
    assignedTo: integer("assigned_to").references(() => crmUsers.id, {
      onDelete: "set null",
    }),
    valueCents: integer("value_cents").notNull().default(0),
    notes: text("notes"),
    properties: jsonb("properties"),
    /** Task #608 - latest single-use Calendly scheduling link generated for the contact. */
    calendlySchedulingLink: jsonb("calendly_scheduling_link"),
    boardOrder: integer("board_order").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    emailLowerUq: uniqueIndex("crm_contacts_email_lower_uq").on(
      sql`lower(${t.email})`,
    ),
    stageIdx: index("crm_contacts_stage_idx").on(t.stageId),
    assignedIdx: index("crm_contacts_assigned_idx").on(t.assignedTo),
  }),
);

export const crmDeals = pgTable(
  "crm_deals",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => crmProducts.id, {
      onDelete: "set null",
    }),
    ownerId: integer("owner_id").references(() => crmUsers.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull().default(0),
    commissionCents: integer("commission_cents").notNull().default(0),
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    contactIdx: index("crm_deals_contact_idx").on(t.contactId),
    ownerIdx: index("crm_deals_owner_idx").on(t.ownerId),
  }),
);

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => crmUsers.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    subject: text("subject"),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    contactIdx: index("crm_activities_contact_idx").on(t.contactId),
  }),
);

export const crmContactEvents = pgTable(
  "crm_contact_events",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    source: text("source"),
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    contactIdx: index("crm_contact_events_contact_idx").on(t.contactId),
  }),
);

/**
 * Task #608 - Calendly bookings mirrored from Calendly's webhook +
 * hourly pull. `contactId` is nullable because a webhook can land
 * before any matching crm_contacts row exists (we create one in the
 * default stage in that case, but if we cannot derive an email we
 * still want to record the booking so the calendar view shows it).
 */
export const crmCalendarEvents = pgTable(
  "crm_calendar_events",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").references(() => crmContacts.id, {
      onDelete: "set null",
    }),
    calendlyEventUri: text("calendly_event_uri").notNull(),
    calendlyInviteeUri: text("calendly_invitee_uri").notNull(),
    eventTypeUri: text("event_type_uri"),
    eventName: text("event_name"),
    inviteeEmail: text("invitee_email"),
    inviteeName: text("invitee_name"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    /** active | canceled | no_show */
    status: text("status").notNull().default("active"),
    rescheduleUrl: text("reschedule_url"),
    cancelUrl: text("cancel_url"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    eventUriUq: uniqueIndex("crm_calendar_events_event_uri_uq").on(
      t.calendlyEventUri,
    ),
    inviteeUriUq: uniqueIndex("crm_calendar_events_invitee_uri_uq").on(
      t.calendlyInviteeUri,
    ),
    contactIdx: index("crm_calendar_events_contact_idx").on(t.contactId),
    startIdx: index("crm_calendar_events_start_idx").on(t.startTime),
  }),
);

/**
 * Task #608 - singleton Calendly settings row (id=1). Stores the
 * pipeline-stage triggers and the webhook subscription metadata. The
 * signing key is held in plaintext here because it is only ever read
 * inside the API process for HMAC verification - rotate via the
 * Settings panel.
 */
export const crmCalendlySettings = pgTable("crm_calendly_settings", {
  id: serial("id").primaryKey(),
  defaultEventTypeUri: text("default_event_type_uri"),
  sendLinkStageId: integer("send_link_stage_id").references(
    () => crmPipelineStages.id,
    { onDelete: "set null" },
  ),
  cancelOnStageIds: jsonb("cancel_on_stage_ids").$type<number[]>(),
  webhookSubscriptionUri: text("webhook_subscription_uri"),
  webhookSigningKey: text("webhook_signing_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type CrmUser = typeof crmUsers.$inferSelect;
export type CrmPipelineStage = typeof crmPipelineStages.$inferSelect;
export type CrmProduct = typeof crmProducts.$inferSelect;
export type CrmContact = typeof crmContacts.$inferSelect;
export type CrmDeal = typeof crmDeals.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type CrmContactEvent = typeof crmContactEvents.$inferSelect;
export type CrmCalendarEvent = typeof crmCalendarEvents.$inferSelect;
export type CrmCalendlySettings = typeof crmCalendlySettings.$inferSelect;
