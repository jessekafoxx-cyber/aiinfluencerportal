import { eq, sql, and, inArray, gt } from "drizzle-orm";
import type { db as DBType } from "@workspace/db";
import { aiInfluencerRunsTable, automationJobsTable, JOB_STATUS } from "@workspace/db";
import type { JobQueue } from "@workspace/job-queue";
import type { WorkflowDefinition, WorkflowStartContext, WorkflowStepCompleteContext } from "./types";

type Db = typeof DBType;

/** Single source of truth for the AI-Influencer pipeline credit cost. */
export const AI_INFLUENCER_CREDIT_ESTIMATE = 10;

function nextUtcHourOccurrence(hour: number): Date {
  const now = new Date();
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

interface BuildDeps {
  db: Db;
  jobQueue: JobQueue;
}

export function buildBuiltinWorkflows(deps?: BuildDeps): WorkflowDefinition[] {
  return [
    {
      slug: "generate_script",
      name: "Generate Script",
      maxAttempts: 3,
      steps: [
        {
          name: "draft",
          provider: "claude",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const topic = String(input["topic"] ?? "");
            const tone = String(input["tone"] ?? "energetic");
            const targetSeconds = Number(input["targetSeconds"] ?? 30);
            return {
              systemPrompt:
                "You are a short-form video scriptwriter. Output a single tight script optimized for vertical video.",
              prompt: [
                `Topic: ${topic}`,
                `Tone: ${tone}`,
                `Target duration: ${targetSeconds} seconds`,
                "Write the script as plain text with no headings.",
              ].join("\n"),
              maxTokens: 800,
            };
          },
          outputKey: "script",
        },
      ],
    },
    {
      slug: "render_avatar_video",
      name: "Render Avatar Video",
      maxAttempts: 3,
      steps: [
        {
          name: "video",
          provider: "heygen",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            return {
              script: String(input["script"] ?? ""),
              avatarId: input["avatarId"] as string | undefined,
              voiceId: input["voiceId"] as string | undefined,
              aspectRatio:
                (input["aspectRatio"] as "16:9" | "9:16" | "1:1" | undefined) ?? "9:16",
            };
          },
          outputKey: "video",
        },
      ],
    },
    {
      slug: "generate_thumbnail",
      name: "Generate Thumbnail",
      maxAttempts: 3,
      steps: [
        {
          name: "image",
          provider: "higgsfield",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            return {
              op: "text_to_image" as const,
              prompt: String(input["prompt"] ?? ""),
              resolution: (input["resolution"] as string | undefined) ?? "2K",
              aspectRatio: (input["aspectRatio"] as string | undefined) ?? "1:1",
            };
          },
          outputKey: "thumbnail",
        },
      ],
    },
    {
      slug: "schedule_social_post",
      name: "Schedule Social Post",
      maxAttempts: 3,
      steps: [
        {
          name: "schedule",
          provider: "internal_scheduler",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const {
              scheduledAt: _sched,
              publishWorkflow: _wf,
              priority: _pri,
              maxAttempts: _ma,
              ...publishPayload
            } = input as Record<string, unknown>;
            return {
              scheduledAt: input["scheduledAt"] as string | Date,
              publishWorkflow: String(input["publishWorkflow"] ?? "publish_post"),
              payload: { input: publishPayload },
            };
          },
          outputKey: "schedule",
        },
      ],
    },
    {
      slug: "schedule_post",
      name: "Schedule Post",
      maxAttempts: 3,
      steps: [
        {
          name: "schedule",
          provider: "internal_scheduler",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const publishWorkflow = String(input["publishWorkflow"] ?? "publish_post");
            const {
              scheduledAt: _sched,
              publishWorkflow: _wf,
              priority: _pri,
              maxAttempts: _ma,
              ...publishPayload
            } = input as Record<string, unknown>;
            return {
              scheduledAt: input["scheduledAt"] as string | Date,
              publishWorkflow,
              payload: { input: publishPayload },
              priority: input["priority"] as number | undefined,
              maxAttempts: input["maxAttempts"] as number | undefined,
            };
          },
          outputKey: "schedule",
        },
      ],
    },
    {
      slug: "publish_post",
      name: "Publish Post",
      maxAttempts: 3,
      steps: [
        {
          name: "post",
          provider: "blotato",
          inputMapping: (state) => buildBlotatoInput(state, { scheduled: false }),
          outputKey: "post",
        },
      ],
    },
    {
      slug: "generate_caption",
      name: "Generate Caption",
      maxAttempts: 3,
      steps: [
        {
          name: "caption",
          provider: "claude",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const topic = String(input["topic"] ?? "");
            const platform = String(input["platform"] ?? "tiktok");
            const tone = String(input["tone"] ?? "energetic");
            return {
              systemPrompt:
                "You write tight, scroll-stopping social-media captions. No emojis unless asked. Output the caption only.",
              prompt: [
                `Platform: ${platform}`,
                `Tone: ${tone}`,
                `Topic: ${topic}`,
                `Hashtags: ${input["hashtags"] ? "yes, append 3-5" : "no"}`,
              ].join("\n"),
              maxTokens: 300,
            };
          },
          outputKey: "caption",
        },
      ],
    },
    {
      slug: "generate_video",
      name: "Generate Video",
      maxAttempts: 3,
      steps: [
        {
          name: "video",
          provider: "heygen",
          inputMapping: (state) => buildHeygenInput(state),
          outputKey: "video",
        },
      ],
    },
    {
      slug: "render_captioned_video",
      name: "Render Captioned Video",
      maxAttempts: 3,
      steps: [
        {
          name: "render",
          provider: "creatomate",
          skipWhen: (state) => upstreamCaptionsBurnedIn(state, "video"),
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const upstreamVideo = (outputs["video"] as { videoUrl?: string } | undefined)
              ?.videoUrl;
            return {
              templateId: String(input["templateId"] ?? ""),
              modifications: {
                ...((input["modifications"] as Record<string, unknown> | undefined) ?? {}),
                ...(upstreamVideo ? { "video.source": upstreamVideo } : {}),
                ...(input["caption"] ? { "caption.text": String(input["caption"]) } : {}),
              },
              outputFormat: (input["outputFormat"] as "mp4" | "gif" | "jpg" | undefined) ?? "mp4",
            };
          },
          outputKey: "render",
        },
      ],
    },
    {
      slug: "full_daily_ai_post",
      name: "Full Daily AI Post",
      maxAttempts: 3,
      steps: [
        {
          name: "script",
          provider: "claude",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            return {
              systemPrompt:
                "You are a short-form video scriptwriter. Output a single tight script optimized for vertical video.",
              prompt: [
                `Topic: ${String(input["topic"] ?? "")}`,
                `Tone: ${String(input["tone"] ?? "energetic")}`,
                `Target duration: ${Number(input["targetSeconds"] ?? 30)} seconds`,
              ].join("\n"),
              maxTokens: 800,
            };
          },
          outputKey: "script",
        },
        {
          name: "caption",
          provider: "claude",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const script = (outputs["script"] as { text?: string } | undefined)?.text ?? "";
            return {
              systemPrompt:
                "Write one scroll-stopping caption (<= 280 chars) for the script below. Output the caption only.",
              prompt: `Platform: ${String(input["platform"] ?? "tiktok")}\nScript:\n${script}`,
              maxTokens: 200,
            };
          },
          outputKey: "caption",
        },
        {
          name: "avatar_video",
          provider: "heygen",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const script = (outputs["script"] as { text?: string } | undefined)?.text ?? "";
            return {
              script,
              avatarId: input["avatarId"] as string | undefined,
              voiceId: input["voiceId"] as string | undefined,
              aspectRatio:
                (input["aspectRatio"] as "16:9" | "9:16" | "1:1" | undefined) ?? "9:16",
            };
          },
          outputKey: "avatar_video",
        },
        {
          name: "rendered_video",
          provider: "creatomate",
          optional: true,
          skipWhen: (state) => upstreamCaptionsBurnedIn(state, "avatar_video"),
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const upstreamVideo = (outputs["avatar_video"] as { videoUrl?: string } | undefined)
              ?.videoUrl;
            const caption = (outputs["caption"] as { text?: string } | undefined)?.text ?? "";
            return {
              templateId: String(input["renderTemplateId"] ?? ""),
              modifications: {
                ...(upstreamVideo ? { "video.source": upstreamVideo } : {}),
                "caption.text": caption,
              },
              outputFormat: "mp4" as const,
            };
          },
          outputKey: "rendered_video",
        },
        {
          name: "schedule",
          provider: "internal_scheduler",
          optional: true,
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const rendered = (outputs["rendered_video"] as { url?: string } | null | undefined)
              ?.url;
            const fallback = (outputs["avatar_video"] as { videoUrl?: string } | undefined)
              ?.videoUrl;
            const caption = (outputs["caption"] as { text?: string } | undefined)?.text ?? "";
            return {
              scheduledAt: input["scheduledAt"] as string | Date,
              publishWorkflow: "publish_post",
              payload: {
                input: {
                  accountId: String(input["accountId"] ?? ""),
                  platform: String(input["platform"] ?? "tiktok"),
                  caption,
                  videoUrl: rendered ?? fallback,
                  hashtags: input["hashtags"] as string[] | undefined,
                },
              },
            };
          },
          outputKey: "schedule",
        },
        {
          name: "publish",
          provider: "blotato",
          skipWhen: (state) => {
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const sched = outputs["schedule"] as { scheduledJobId?: number } | null | undefined;
            return sched?.scheduledJobId != null;
          },
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const rendered = (outputs["rendered_video"] as { url?: string } | null | undefined)
              ?.url;
            const fallback = (outputs["avatar_video"] as { videoUrl?: string } | undefined)
              ?.videoUrl;
            const caption = (outputs["caption"] as { text?: string } | undefined)?.text ?? "";
            return {
              accountId: String(input["accountId"] ?? ""),
              platform: String(input["platform"] ?? "tiktok"),
              caption,
              videoUrl: rendered ?? fallback,
              hashtags: input["hashtags"] as string[] | undefined,
            };
          },
          outputKey: "publish",
        },
      ],
    },
    {
      slug: "ai-influencer",
      name: "AI Influencer Pipeline",
      maxAttempts: 3,
      estimateCredits: async () => AI_INFLUENCER_CREDIT_ESTIMATE,
      steps: [
        {
          name: "generate-script",
          provider: "claude",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const persona = String(
              input["characterPersona"] ?? "A knowledgeable expert sharing insights.",
            );
            const avatarType = String(input["avatarType"] ?? "talking_head");
            const wordCount = Number(input["wordCount"] ?? 200);

            const typePrompts: Record<string, { system: string; user: string }> = {
              podcast: {
                system: `You are a scriptwriter for AI influencer PODCAST-STYLE content clips.\n\nCHARACTER:\n${persona}\n\nRULES:\n- Write in first person as this character\n- Open with a bold, provocative hook\n- Use authority markers and insider knowledge framing\n- Script should be ${wordCount}-${wordCount + 20} words\n- Write ONLY spoken words, no stage directions\n\nAlso generate a social caption (2-3 sentences + hashtags).\n\nReturn JSON: {"script":"...","caption":"..."}`,
                user: "Generate a fresh, bold podcast-style topic based on this character's expertise. Be specific and contrarian.",
              },
              demo_hook: {
                system: `You are a scriptwriter for SHORT hook clips (2-3 seconds).\n\nCHARACTER:\n${persona}\n\nRULES:\n- Maximum 8-12 words\n- Create curiosity for a demo that follows\n- Write ONLY spoken words\n\nReturn JSON: {"script":"...","caption":"..."}`,
                user: "Write a short curiosity-driven hook (8-12 words) that makes people want to watch the demo that follows.",
              },
              talking_head: {
                system: `You are a scriptwriter for AI avatar social media videos.\n\nCHARACTER:\n${persona}\n\nRULES:\n- Write in first person as this character\n- Conversational, warm, and authentic tone\n- ${wordCount}-${wordCount + 20} words\n- Start with a hook, end with a reflection\n- Write ONLY spoken words\n\nAlso generate a social caption (2-3 sentences + hashtags).\n\nReturn JSON: {"script":"...","caption":"..."}`,
                user: "Generate a fresh, engaging social media video topic based on the character's expertise. Be specific and authentic.",
              },
            };

            const prompts = typePrompts[avatarType] ?? typePrompts["talking_head"]!;
            return {
              systemPrompt: prompts.system,
              prompt: prompts.user,
              maxTokens: 1024,
              estimatedCredits: 2,
            };
          },
          outputKey: "generate-script",
        },
        {
          name: "render-video",
          provider: "heygen",
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const scriptOutput = outputs["generate-script"] as
              | { text?: string }
              | null
              | undefined;
            let scriptText = scriptOutput?.text ?? "";
            try {
              const parsed = JSON.parse(scriptText);
              if (parsed && typeof parsed === "object" && "script" in parsed) {
                scriptText = String(parsed.script);
              }
            } catch {
              // raw text
            }
            return {
              script: scriptText || String(input["script"] ?? ""),
              avatarId: input["avatarId"] as string | undefined,
              voiceId: input["voiceId"] as string | undefined,
              aspectRatio: "9:16" as const,
              estimatedCredits: 6,
            };
          },
          outputKey: "render-video",
        },
        {
          name: "add-captions",
          provider: "creatomate",
          optional: true,
          skipWhen: (state) => {
            if (!process.env["CREATOMATE_API_KEY"]) return true;
            return upstreamCaptionsBurnedIn(state, "render-video");
          },
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const videoOutput = outputs["render-video"] as
              | { videoUrl?: string }
              | null
              | undefined;
            return {
              templateId: String(input["creatomateTemplateId"] ?? ""),
              modifications: {
                ...(videoOutput?.videoUrl ? { "video.source": videoOutput.videoUrl } : {}),
              },
              outputFormat: "mp4" as const,
              estimatedCredits: 1,
            };
          },
          outputKey: "add-captions",
        },
        {
          name: "post-video",
          provider: "blotato",
          optional: true,
          // Skip only when the server-side keys are absent — accountId and
          // platform are resolved from env vars at execution time so job input
          // never needs to carry sensitive posting credentials.
          skipWhen: () => {
            return !process.env["BLOTATO_API_KEY"] || !process.env["BLOTATO_ACCOUNT_ID"];
          },
          inputMapping: (state) => {
            const input = (state["input"] ?? {}) as Record<string, unknown>;
            const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
            const captionOutput = outputs["add-captions"] as
              | { url?: string }
              | null
              | undefined;
            const videoOutput = outputs["render-video"] as
              | { videoUrl?: string }
              | null
              | undefined;
            const scriptOutput = outputs["generate-script"] as
              | { text?: string }
              | null
              | undefined;
            let caption = "";
            try {
              const parsed = JSON.parse(scriptOutput?.text ?? "");
              if (parsed && typeof parsed === "object" && "caption" in parsed) {
                caption = String(parsed.caption);
              }
            } catch {
              // ignore
            }
            // accountId and platform come from server-side env vars so they
            // are never exposed in job payloads or client-facing settings.
            return {
              accountId: process.env["BLOTATO_ACCOUNT_ID"] ?? String(input["accountId"] ?? ""),
              platform: process.env["BLOTATO_PLATFORM"] ?? String(input["platform"] ?? "tiktok"),
              caption: caption || String(input["caption"] ?? ""),
              videoUrl: captionOutput?.url ?? videoOutput?.videoUrl,
              estimatedCredits: 1,
            };
          },
          outputKey: "post-video",
        },
      ],
      onStart: async (ctx: WorkflowStartContext) => {
        if (!deps) return;
        // Write reservationId back into the run row — critical for scheduled runs
        // where the API handler creates the row before reservation occurs in the runner.
        // No inner catch: let the runner's outer try/catch surface DB errors.
        await deps.db
          .update(aiInfluencerRunsTable)
          .set({
            reservationId: ctx.reservationId,
            statusTransitions: sql`COALESCE(${aiInfluencerRunsTable.statusTransitions}, '[]'::jsonb) || ${JSON.stringify([{ status: "running", at: new Date().toISOString() }])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(aiInfluencerRunsTable.jobId, ctx.jobId));
      },
      onStepComplete: async (ctx: WorkflowStepCompleteContext) => {
        if (!deps) return;
        const { jobId, stepName, costCredits, providerCostCents } = ctx;
        const nowIso = new Date().toISOString();
        // Merge per-step cost into providerCostBreakdown and record step transition.
        // No inner catch: let the runner's outer try/catch surface DB errors.
        await deps.db
          .update(aiInfluencerRunsTable)
          .set({
            providerCostBreakdown: sql`
              COALESCE(${aiInfluencerRunsTable.providerCostBreakdown}, '{}'::jsonb)
              || ${JSON.stringify({ [stepName]: costCredits })}::jsonb
            `,
            statusTransitions: sql`
              COALESCE(${aiInfluencerRunsTable.statusTransitions}, '[]'::jsonb)
              || ${JSON.stringify([{ status: "step_completed", step: stepName, costCredits, providerCostCents, at: nowIso }])}::jsonb
            `,
            updatedAt: new Date(),
          })
          .where(eq(aiInfluencerRunsTable.jobId, jobId));
      },
      onComplete: async (ctx) => {
        if (!deps) return;
        const { jobId, userId, state, totalCreditsCost, providerCostBreakdown } = ctx;
        const outputs = state.outputs;
        const input = state.input;

        const renderVideoOutput = outputs["render-video"] as { videoUrl?: string } | null | undefined;
        const addCaptionsOutput = outputs["add-captions"] as { url?: string } | null | undefined;
        const rawVideoUrl = renderVideoOutput?.videoUrl ?? null;
        const finalVideoUrl = addCaptionsOutput?.url ?? rawVideoUrl;

        const nowIso = new Date().toISOString();
        await deps.db
          .update(aiInfluencerRunsTable)
          .set({
            creditActual: Math.ceil(totalCreditsCost),
            providerCostBreakdown: providerCostBreakdown as Record<string, unknown>,
            rawVideoUrl,
            finalVideoUrl,
            statusTransitions: sql`COALESCE(${aiInfluencerRunsTable.statusTransitions}, '[]'::jsonb) || ${JSON.stringify([{ status: "succeeded", at: nowIso }])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(aiInfluencerRunsTable.jobId, jobId));

        // Daily recurrence: re-enqueue the next occurrence at the same UTC hour.
        // Guard: skip if a newer schedule already queued a future job for this user
        // (handles the race where a running job finishes after PUT /schedule replaced it).
        const scheduledHour = typeof input["scheduledHour"] === "number" ? input["scheduledHour"] : null;
        if (scheduledHour !== null) {
          const alreadyQueued = await deps.db
            .select({ id: automationJobsTable.id })
            .from(automationJobsTable)
            .where(
              and(
                eq(automationJobsTable.userId, userId),
                eq(automationJobsTable.type, "ai-influencer"),
                inArray(automationJobsTable.status, [JOB_STATUS.QUEUED]),
                gt(automationJobsTable.runAt, new Date()),
              ),
            )
            .limit(1);

          if (alreadyQueued.length === 0) {
            const runAt = nextUtcHourOccurrence(scheduledHour);
            const idempotencyKey = `ai-influencer-schedule:${userId}:${scheduledHour}:${runAt.toISOString().slice(0, 13)}`;
            const nextJob = await deps.jobQueue.enqueue({
              type: "ai-influencer",
              userId,
              payload: { input },
              idempotencyKey,
              runAt,
              maxAttempts: 3,
            });
            if (nextJob.enqueued) {
              await deps.db
                .insert(aiInfluencerRunsTable)
                .values({
                  jobId: nextJob.job.id,
                  userId,
                  creditEstimate: AI_INFLUENCER_CREDIT_ESTIMATE,
                  statusTransitions: [{ status: "scheduled", at: new Date().toISOString(), runAt: runAt.toISOString() }],
                })
                .onConflictDoNothing()
                .catch(() => undefined);
            }
          }
        }
      },
      onFailed: async (ctx) => {
        if (!deps) return;
        const { jobId, userId, state, errorMessage } = ctx;
        const nowIso = new Date().toISOString();
        await deps.db
          .update(aiInfluencerRunsTable)
          .set({
            errorMessage,
            statusTransitions: sql`COALESCE(${aiInfluencerRunsTable.statusTransitions}, '[]'::jsonb) || ${JSON.stringify([{ status: "failed", at: nowIso }])}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(aiInfluencerRunsTable.jobId, jobId));

        // Daily recurrence: re-enqueue even on failure so daily scheduling is
        // durable. Same guard as onComplete: skip if a replacement schedule has
        // already queued a future job.
        const input = state.input;
        const scheduledHour = typeof input["scheduledHour"] === "number" ? input["scheduledHour"] : null;
        if (scheduledHour !== null) {
          const alreadyQueued = await deps.db
            .select({ id: automationJobsTable.id })
            .from(automationJobsTable)
            .where(
              and(
                eq(automationJobsTable.userId, userId),
                eq(automationJobsTable.type, "ai-influencer"),
                inArray(automationJobsTable.status, [JOB_STATUS.QUEUED]),
                gt(automationJobsTable.runAt, new Date()),
              ),
            )
            .limit(1);

          if (alreadyQueued.length === 0) {
            const runAt = nextUtcHourOccurrence(scheduledHour);
            const idempotencyKey = `ai-influencer-schedule:${userId}:${scheduledHour}:${runAt.toISOString().slice(0, 13)}`;
            const nextJob = await deps.jobQueue.enqueue({
              type: "ai-influencer",
              userId,
              payload: { input },
              idempotencyKey,
              runAt,
              maxAttempts: 3,
            });
            if (nextJob.enqueued) {
              await deps.db
                .insert(aiInfluencerRunsTable)
                .values({
                  jobId: nextJob.job.id,
                  userId,
                  creditEstimate: AI_INFLUENCER_CREDIT_ESTIMATE,
                  statusTransitions: [{ status: "scheduled", at: new Date().toISOString(), runAt: runAt.toISOString() }],
                })
                .onConflictDoNothing()
                .catch(() => undefined);
            }
          }
        }
      },
    },
  ];
}

function upstreamCaptionsBurnedIn(
  state: Record<string, unknown>,
  upstreamKey: string,
): boolean {
  const outputs = (state["outputs"] ?? {}) as Record<string, unknown>;
  const upstream = outputs[upstreamKey] as { captionsBurnedIn?: boolean } | undefined;
  return upstream?.captionsBurnedIn === true;
}

function buildHeygenInput(state: Record<string, unknown>): Record<string, unknown> {
  const input = (state["input"] ?? {}) as Record<string, unknown>;
  const upstreamScript =
    (state["script"] as { text?: string } | undefined)?.text ??
    (input["script"] as string | undefined);
  return {
    script: String(upstreamScript ?? ""),
    avatarId: input["avatarId"] as string | undefined,
    voiceId: input["voiceId"] as string | undefined,
    aspectRatio: (input["aspectRatio"] as "16:9" | "9:16" | "1:1" | undefined) ?? "9:16",
  };
}

function buildBlotatoInput(
  state: Record<string, unknown>,
  opts: { scheduled: boolean },
): Record<string, unknown> {
  const input = (state["input"] ?? {}) as Record<string, unknown>;
  return {
    accountId: String(input["accountId"] ?? ""),
    platform: String(input["platform"] ?? "tiktok"),
    caption: String(input["caption"] ?? ""),
    videoUrl: input["videoUrl"] as string | undefined,
    imageUrl: input["imageUrl"] as string | undefined,
    hashtags: input["hashtags"] as string[] | undefined,
    ...(opts.scheduled ? { scheduledAt: input["scheduledAt"] as string | undefined } : {}),
  };
}
