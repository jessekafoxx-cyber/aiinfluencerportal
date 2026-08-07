import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { automationJobsTable } from "./jobs";

export const automationJobEventsTable = pgTable(
  "automation_job_events",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => automationJobsTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    message: text("message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobIdIdx: index("automation_job_events_job_id_idx").on(t.jobId),
    eventTypeIdx: index("automation_job_events_event_type_idx").on(t.eventType),
  }),
);

export type AutomationJobEvent = typeof automationJobEventsTable.$inferSelect;
export type InsertAutomationJobEvent = typeof automationJobEventsTable.$inferInsert;
