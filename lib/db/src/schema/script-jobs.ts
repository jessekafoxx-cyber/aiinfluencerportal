import { pgTable, serial, text, varchar, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";

// Persisted async jobs for the Script Writer OS. One row per generation
// (any of the 9 SOPs: green-screen, hook-demo, podcast-clip, speaking-clip,
// selfie-clip, slideshow, carousel, overlay, fastmotion). The HTTP endpoints
// return { jobId } immediately; the actual OpenAI work runs in-process and
// pushes progress + final result back into this row. The frontend polls
// /portal/script-writer/jobs/:id every ~1.5s for progress + result, and
// reads /portal/script-writer/jobs?type=<sop>&limit=20 to render the
// per-SOP "Recent Scripts" history. Persisting input + result also gives
// us navigate-away-and-resume.
export const scriptJobs = pgTable(
  "script_jobs",
  {
    id: serial("id").primaryKey(),
    clerkId: varchar("clerk_id", { length: 255 }).notNull(),
    // SOP slug: "green-screen" | "hook-demo" | "podcast-clip" | ...
    type: varchar("type", { length: 32 }).notNull(),
    // The validated, image-stripped input payload we want to show on the
    // history card (context preview, idea, target seconds, etc).
    inputPayload: jsonb("input_payload").notNull().default({}),
    // Short label shown in the recent-scripts list (idea title or the
    // first sentence of context).
    label: text("label"),
    // "queued" | "running" | "succeeded" | "failed"
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    // 0-100. Progress is REAL: each step in the runner advances this when
    // the server actually reaches that step, never on a fake timer.
    progressPct: integer("progress_pct").notNull().default(0),
    // Human-readable label for the current step ("Analyzing images...",
    // "Drafting script...", "Cleaning output...").
    stage: text("stage"),
    // Final OpenAI result. The frontend uses this in two places: (a) live
    // when the job finishes during this session, (b) when the user opens
    // a Recent Scripts entry.
    result: jsonb("result"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clerkTypeIdx: index("script_jobs_clerk_type_idx").on(t.clerkId, t.type, t.createdAt),
  }),
);

export type ScriptJob = typeof scriptJobs.$inferSelect;
export type InsertScriptJob = typeof scriptJobs.$inferInsert;
