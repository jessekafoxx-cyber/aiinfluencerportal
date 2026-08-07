import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { clientsTable } from "../clients";
import { automationWorkflowsTable } from "./workflows";

export const automationSchedulesTable = pgTable(
  "automation_schedules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => automationWorkflowsTable.id, { onDelete: "cascade" }),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    nextRunIdx: index("automation_schedules_next_run_idx").on(t.isActive, t.nextRunAt),
    userIdx: index("automation_schedules_user_idx").on(t.userId),
    workflowIdx: index("automation_schedules_workflow_idx").on(t.workflowId),
  }),
);

export type AutomationSchedule = typeof automationSchedulesTable.$inferSelect;
export type InsertAutomationSchedule = typeof automationSchedulesTable.$inferInsert;
