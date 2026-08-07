import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "../clients";
import { aiInfluencersTable } from "../influencers";

export const automationJobsTable = pgTable(
  "automation_jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id"),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id"),
    influencerId: integer("influencer_id").references(() => aiInfluencersTable.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    idempotencyKeyUnique: uniqueIndex("automation_jobs_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    statusRunAtPriorityIdx: index("automation_jobs_status_run_at_priority_idx").on(
      t.status,
      t.runAt,
      t.priority,
    ),
    userIdIdx: index("automation_jobs_user_id_idx").on(t.userId),
    workflowIdIdx: index("automation_jobs_workflow_id_idx").on(t.workflowId),
    typeIdx: index("automation_jobs_type_idx").on(t.type),
    lockedByIdx: index("automation_jobs_locked_by_idx").on(t.lockedBy),
  }),
);

export type AutomationJob = typeof automationJobsTable.$inferSelect;
export type InsertAutomationJob = typeof automationJobsTable.$inferInsert;

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  RETRYING: "retrying",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
