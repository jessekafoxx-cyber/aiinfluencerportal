import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { clientsTable } from "../clients";

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id"),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id"),
    providerSlug: text("provider_slug").notNull(),
    units: integer("units").notNull().default(0),
    costCredits: integer("cost_credits").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("usage_events_user_id_idx").on(t.userId),
    jobIdIdx: index("usage_events_job_id_idx").on(t.jobId),
    providerIdx: index("usage_events_provider_idx").on(t.providerSlug),
  }),
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;
export type InsertUsageEvent = typeof usageEventsTable.$inferInsert;

export const providerCostEventsTable = pgTable(
  "provider_cost_events",
  {
    id: serial("id").primaryKey(),
    providerSlug: text("provider_slug").notNull(),
    externalRef: text("external_ref"),
    costInCents: integer("cost_in_cents").notNull().default(0),
    units: integer("units").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index("provider_cost_events_provider_idx").on(t.providerSlug),
    externalRefIdx: index("provider_cost_events_external_ref_idx").on(t.externalRef),
  }),
);

export type ProviderCostEvent = typeof providerCostEventsTable.$inferSelect;
export type InsertProviderCostEvent = typeof providerCostEventsTable.$inferInsert;
