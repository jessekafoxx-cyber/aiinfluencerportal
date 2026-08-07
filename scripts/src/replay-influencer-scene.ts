// ─────────────────────────────────────────────────────────────────────────────
// Task #674 — single-scene replay tool.
//
// Reproduces a single scene swap for a given job + scene slug (template id)
// directly against Gemini, bypassing the worker fan-out and the QA gate. Used
// to diagnose the "swapping_scenes wedged with 0 outputs" failure mode where
// every scene comes back without `inlineData` and the job loops on finalize.
//
// Usage:
//   pnpm --filter @workspace/scripts run replay:influencer-scene -- \
//     --job <id> --scene <templateId>
//
// Output:
//   - prompt length, input image count
//   - raw response shape (b64 length, mime type) on success
//   - normalized provider error (class, code, message) on failure
//   - exit 0 on usable image bytes, exit 1 otherwise (so it can gate CI smoke).
// ─────────────────────────────────────────────────────────────────────────────

import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { db, aiInfluencerJobsTable } from "@workspace/db";

function parseArgs(argv: string[]): {
  jobId: number;
  sceneSlug: string;
  outPath: string | null;
} {
  let jobId: number | null = null;
  let sceneSlug: string | null = null;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--job" && argv[i + 1]) {
      jobId = Number(argv[i + 1]);
      i++;
    } else if (a === "--scene" && argv[i + 1]) {
      sceneSlug = String(argv[i + 1]);
      i++;
    } else if (a === "--out" && argv[i + 1]) {
      outPath = String(argv[i + 1]);
      i++;
    }
  }
  if (!jobId || !Number.isFinite(jobId) || !sceneSlug) {
    console.error(
      "usage: pnpm --filter @workspace/scripts run replay:influencer-scene -- --job <id> --scene <slug> [--out <path>]",
    );
    process.exit(2);
  }
  return { jobId, sceneSlug, outPath };
}

// Mirror the runSceneSwaps remap table so the replay reports the same
// normalized SCENE_SWAP_* class the production pipeline would have
// assigned. Pure string detection keeps this script free of any
// api-server runtime imports beyond the integration adapter.
function normalizeProviderError(err: unknown): {
  errorClass: string;
  code: string;
  message: string;
  finishReason: string | null;
  blockReason: string | null;
  candidateCount: number | null;
  partKinds: string[] | null;
  textSnippet: string | null;
} {
  const e = err as Record<string, unknown> | null;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  const status = typeof e?.status === "number" ? (e.status as number) : null;
  const empty =
    /no image data in response|empty provider output|no payload|empty_output/i.test(
      message,
    );
  const timeout =
    /etimedout|esockettimedout|timed?\s*out/i.test(message) || status === 408;
  const invalid = !empty && !timeout && typeof status === "number" && status >= 400 && status < 500;
  const errorClass = empty
    ? "SCENE_SWAP_EMPTY_RESPONSE"
    : timeout
      ? "SCENE_SWAP_TIMEOUT"
      : invalid
        ? "SCENE_SWAP_INVALID_RESPONSE"
        : "SCENE_SWAP_FAILURE";
  return {
    errorClass,
    code: errorClass,
    message,
    finishReason:
      typeof e?.finishReason === "string" || e?.finishReason === null
        ? ((e?.finishReason as string | null) ?? null)
        : null,
    blockReason:
      typeof e?.blockReason === "string" || e?.blockReason === null
        ? ((e?.blockReason as string | null) ?? null)
        : null,
    candidateCount:
      typeof e?.candidateCount === "number" ? (e.candidateCount as number) : null,
    partKinds: Array.isArray(e?.partKinds) ? (e.partKinds as string[]) : null,
    textSnippet:
      typeof e?.textSnippet === "string" ? (e.textSnippet as string) : null,
  };
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mimeType = r.headers.get("content-type") || "image/png";
  return { data: buf.toString("base64"), mimeType };
}

async function main() {
  const { jobId, sceneSlug, outPath } = parseArgs(process.argv.slice(2));

  const [job] = await db
    .select()
    .from(aiInfluencerJobsTable)
    .where(eq(aiInfluencerJobsTable.id, jobId))
    .limit(1);
  if (!job) {
    console.error(JSON.stringify({ ok: false, reason: "job_not_found", jobId }, null, 2));
    process.exit(1);
  }
  const characterUrl = job.enhancedImageUrl ?? job.baseImageUrl;
  if (!characterUrl) {
    console.error(
      JSON.stringify(
        { ok: false, reason: "no_character_image", jobId, status: job.status },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const { getSceneTemplateById } = await import(
    "../../artifacts/api-server/src/lib/influencer-scenes-library"
  );
  const { buildScenePlacementPrompt } = await import(
    "../../artifacts/api-server/src/lib/influencer-prompts"
  );
  const { readOrInferProfile } = await import(
    "../../artifacts/api-server/src/lib/influencer-character"
  );

  const tpl = getSceneTemplateById(sceneSlug);
  if (!tpl) {
    console.error(
      JSON.stringify({ ok: false, reason: "template_not_found", sceneSlug }, null, 2),
    );
    process.exit(1);
  }
  const profile = readOrInferProfile(job.prefs);
  const prompt = buildScenePlacementPrompt(profile, tpl);

  console.log(
    JSON.stringify(
      {
        phase: "dispatch",
        jobId,
        sceneSlug,
        templateId: tpl.id,
        characterUrl,
        promptLen: prompt.length,
      },
      null,
      2,
    ),
  );

  const charInline = await fetchAsBase64(characterUrl);
  const startedAt = Date.now();
  try {
    const mod = (await import(
      "@workspace/integrations-gemini-ai/image" as string
    )) as unknown as {
      generateProImage: (opts: {
        prompt: string;
        inputImages?: { data: string; mimeType: string }[];
      }) => Promise<{ b64_json: string; mimeType: string }>;
    };
    const result = await mod.generateProImage({
      prompt,
      inputImages: [charInline],
    });
    const latencyMs = Date.now() - startedAt;
    const buf = Buffer.from(result.b64_json, "base64");
    let writtenTo: string | null = null;
    if (outPath) {
      const abs = path.resolve(outPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      writtenTo = abs;
    }
    console.log(
      JSON.stringify(
        {
          phase: "response",
          ok: true,
          latencyMs,
          outputBytes: buf.length,
          mimeType: result.mimeType,
          writtenTo,
        },
        null,
        2,
      ),
    );
    if (buf.length < 8 * 1024) {
      console.error("WARNING: output below MIN_SCENE_BYTES; pipeline would treat as EMPTY_OUTPUT");
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const norm = normalizeProviderError(err);
    console.error(
      JSON.stringify(
        {
          phase: "response",
          ok: false,
          latencyMs,
          errorClass: norm.errorClass,
          code: norm.code,
          errorMessage: norm.message,
          finishReason: norm.finishReason,
          blockReason: norm.blockReason,
          candidateCount: norm.candidateCount,
          partKinds: norm.partKinds,
          textSnippet: norm.textSnippet,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("replay-influencer-scene crashed", err);
  process.exit(1);
});
