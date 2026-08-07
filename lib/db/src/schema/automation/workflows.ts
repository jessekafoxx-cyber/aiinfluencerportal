import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "../clients";

export const automationWorkflowsTable = pgTable(
  "automation_workflows",
  {
    id: serial("id").primaryKey(),
    /**
     * Owning client. Null means a "shared catalog" workflow that any
     * authenticated user can read and run (used for the original
     * admin-curated seed workflows). New workflows created via the
     * HTTP API are always scoped to the requesting user.
     */
    userId: integer("user_id").references(() => clientsTable.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Two partial unique indexes so that (a) the shared-catalog rows
    // (userId IS NULL) keep slug globally unique within the catalog, and
    // (b) per-user rows are unique within a single user's namespace but
    // a slug like "my-flow" can be reused by different users.
    sharedSlugUnique: uniqueIndex("automation_workflows_shared_slug_unique")
      .on(t.slug)
      .where(sql`user_id IS NULL`),
    userSlugUnique: uniqueIndex("automation_workflows_user_slug_unique")
      .on(t.userId, t.slug)
      .where(sql`user_id IS NOT NULL`),
    userIdx: index("automation_workflows_user_idx").on(t.userId),
    activeIdx: index("automation_workflows_active_idx").on(t.isActive),
  }),
);

export const automationWorkflowStepsTable = pgTable(
  "automation_workflow_steps",
  {
    id: serial("id").primaryKey(),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => automationWorkflowsTable.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    stepType: text("step_type").notNull(),
    providerSlug: text("provider_slug"),
    inputMapping: jsonb("input_mapping").$type<Record<string, unknown>>().notNull().default({}),
    outputKey: text("output_key"),
    isOptional: boolean("is_optional").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workflowIdxUnique: uniqueIndex("automation_workflow_steps_workflow_idx_unique").on(
      t.workflowId,
      t.idx,
    ),
  }),
);

export type AutomationWorkflow = typeof automationWorkflowsTable.$inferSelect;
export type InsertAutomationWorkflow = typeof automationWorkflowsTable.$inferInsert;
export type AutomationWorkflowStep = typeof automationWorkflowStepsTable.$inferSelect;
export type InsertAutomationWorkflowStep = typeof automationWorkflowStepsTable.$inferInsert;
