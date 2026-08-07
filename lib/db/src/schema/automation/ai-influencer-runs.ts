import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { automationJobsTable } from "./jobs";
import { clientsTable } from "../clients";

export const aiInfluencerRunsTable = pgTable(
  "ai_influencer_runs",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => automationJobsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    reservationId: integer("reservation_id"),
    avatarSettingId: text("avatar_setting_id"),
    creditEstimate: integer("credit_estimate").notNull().default(0),
    creditActual: integer("credit_actual"),
    providerCostBreakdown: jsonb("provider_cost_breakdown")
      .$type<Record<string, unknown>>()
      .default({}),
    statusTransitions: jsonb("status_transitions")
      .$type<Array<Record<string, unknown>>>()
      .default([]),
    rawVideoUrl: text("raw_video_url"),
    finalVideoUrl: text("final_video_url"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    jobIdUniq: uniqueIndex("ai_influencer_runs_job_id_uniq").on(t.jobId),
    userIdIdx: index("ai_influencer_runs_user_id_idx").on(t.userId),
  }),
);

export type AiInfluencerRun = typeof aiInfluencerRunsTable.$inferSelect;
export type InsertAiInfluencerRun = typeof aiInfluencerRunsTable.$inferInsert;
