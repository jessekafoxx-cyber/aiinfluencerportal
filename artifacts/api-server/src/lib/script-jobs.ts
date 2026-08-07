import { db } from "@workspace/db";
import { scriptJobs, type ScriptJob } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";

// In-process async job runner for the Script Writer OS. The HTTP route
// validates inputs and uploads any images synchronously, then calls
// `enqueueScriptJob` which:
//   1. Inserts a row in `script_jobs` with status "queued"
//   2. Returns the new jobId so the route can respond 202 immediately
//   3. Schedules the heavy work (OpenAI calls, parsing, etc) on the next
//      tick so the HTTP response is not blocked
//   4. Persists progress + final result + errors back into the row
//
// The frontend polls `/portal/script-writer/jobs/:id` every ~1.5s for
// status + progress + (when ready) result. It also reads
// `/portal/script-writer/jobs?type=<sop>` to render "Recent Scripts".

export type ScriptJobType =
  | "green-screen"
  | "hook-demo"
  | "podcast-clip"
  | "speaking-clip"
  | "selfie-clip"
  | "slideshow"
  | "carousel"
  | "overlay"
  | "fastmotion"
  | "green-screen-ideas"
  | "hook-demo-ideas"
  | "podcast-ideas"
  | "speaking-ideas"
  | "selfie-ideas"
  | "slideshow-ideas"
  | "carousel-ideas"
  | "overlay-ideas"
  | "fastmotion-ideas";

export interface JobContext {
  jobId: number;
  log: Logger | undefined;
  updateProgress: (pct: number, stage: string) => Promise<void>;
}

interface EnqueueArgs<T> {
  clerkId: string;
  type: ScriptJobType;
  inputPayload: Record<string, unknown>;
  label: string | null;
  log?: Logger;
  work: (ctx: JobContext) => Promise<T>;
}

export async function enqueueScriptJob<T>({
  clerkId,
  type,
  inputPayload,
  label,
  log,
  work,
}: EnqueueArgs<T>): Promise<number> {
  const [row] = await db
    .insert(scriptJobs)
    .values({
      clerkId,
      type,
      inputPayload: inputPayload as any,
      label: label || null,
      status: "queued",
      progressPct: 0,
      stage: "Queued",
    })
    .returning({ id: scriptJobs.id });

  const jobId = row.id;

  const ctx: JobContext = {
    jobId,
    log,
    updateProgress: async (pct, stage) => {
      const clamped = Math.max(0, Math.min(99, Math.round(pct)));
      await db
        .update(scriptJobs)
        .set({ progressPct: clamped, stage, status: "running", updatedAt: new Date() })
        .where(eq(scriptJobs.id, jobId));
    },
  };

  // Kick off work after returning the jobId. Using setImmediate so the
  // HTTP response can flush first.
  setImmediate(async () => {
    try {
      await db
        .update(scriptJobs)
        .set({ status: "running", progressPct: 1, stage: "Starting", updatedAt: new Date() })
        .where(eq(scriptJobs.id, jobId));
      const result = await work(ctx);
      await db
        .update(scriptJobs)
        .set({
          status: "succeeded",
          progressPct: 100,
          stage: "Done",
          result: result as any,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(scriptJobs.id, jobId));
    } catch (err: any) {
      log?.error?.({ err: err?.message, stack: err?.stack, jobId, type }, "script-job failed");
      await db
        .update(scriptJobs)
        .set({
          status: "failed",
          stage: "Failed",
          errorMessage: err?.message || "Unknown error",
          updatedAt: new Date(),
        })
        .where(eq(scriptJobs.id, jobId));
    }
  });

  return jobId;
}

// Owner-scoped job lookup. The HTTP route filters by clerkId so users
// can only ever read their own jobs.
export async function getScriptJob(
  clerkId: string,
  jobId: number,
): Promise<ScriptJob | null> {
  const [row] = await db
    .select()
    .from(scriptJobs)
    .where(and(eq(scriptJobs.id, jobId), eq(scriptJobs.clerkId, clerkId)));
  return row || null;
}

export async function listScriptJobs(
  clerkId: string,
  type: ScriptJobType,
  limit = 20,
): Promise<ScriptJob[]> {
  const rows = await db
    .select()
    .from(scriptJobs)
    .where(and(eq(scriptJobs.clerkId, clerkId), eq(scriptJobs.type, type)))
    .orderBy(desc(scriptJobs.createdAt))
    .limit(Math.max(1, Math.min(50, limit)));
  return rows;
}

// Owner-scoped lookup for the single newest in-flight job (queued or
// running) across every SOP type. Powers cross-device / cross-tab resume:
// when a user opens the Script Writer on a different machine than the one
// that started the job, the page can re-attach to it instead of relying on
// the originating browser's localStorage.
export async function getActiveScriptJob(
  clerkId: string,
): Promise<ScriptJob | null> {
  const [row] = await db
    .select()
    .from(scriptJobs)
    .where(
      and(
        eq(scriptJobs.clerkId, clerkId),
        inArray(scriptJobs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(scriptJobs.createdAt))
    .limit(1);
  return row || null;
}
