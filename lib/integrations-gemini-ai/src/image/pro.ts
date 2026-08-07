import { ai } from "../client";
import { Modality, type GenerateContentParameters } from "@google/genai";

export interface GeneratedImage {
  b64_json: string;
  mimeType: string;
}

export interface ProImageInput {
  data: string;
  mimeType: string;
}

// Task #674: when the model returns no inlineData part we attach the
// upstream finishReason / safety / refusal text to the thrown error so
// the caller's structured log can tell "SAFETY block" apart from
// "RECITATION" / "MAX_TOKENS" / plain text-only refusal. Without this,
// every zero-image response collapsed to a generic
// `No image data in response` Error and the scene-swap pipeline
// classified every cause as the same SCENE_SWAP_FAILURE.
//
// Task #690 follow-up: also stamp a structured `kind` discriminator so
// the adapter layer doesn't have to re-derive it from string matching.
// `kind` is one of:
//   - "safety_block"      — finishReason in {SAFETY, PROHIBITED_CONTENT,
//                            IMAGE_SAFETY, BLOCKLIST, SPII} or top-level
//                            promptFeedback.blockReason is set
//   - "recitation_block"  — finishReason === "RECITATION"
//   - "no_image"          — model returned text-only or empty candidates
//                            without a terminal safety/recitation signal
export type GeminiNoImageKind =
  | "safety_block"
  | "recitation_block"
  | "no_image";

export interface GeminiNoImageError extends Error {
  kind: GeminiNoImageKind;
  candidateCount: number;
  finishReason: string | null;
  blockReason: string | null;
  partKinds: string[];
  textSnippet: string | null;
  promptFeedback: unknown;
  safetyRatings: unknown;
}

const SAFETY_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_SAFETY",
  "BLOCKLIST",
  "SPII",
]);

export async function generateProImage(opts: {
  prompt: string;
  inputImages?: ProImageInput[];
}): Promise<GeneratedImage> {
  const parts: any[] = [];
  for (const img of opts.inputImages ?? []) {
    parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }
  parts.push({ text: opts.prompt });

  // Task #690 root-cause fix:
  // - Drop Modality.TEXT from responseModalities. With TEXT allowed,
  //   gemini-3-pro-image-preview frequently chose a text-only refusal
  //   on long prescriptive prompts (the "no inlineData part" wedge
  //   that produced job 14's stream of INVALID_RESPONSE/empty payloads).
  //   IMAGE-only forces the model to either return image bytes or fail
  //   with an explicit finishReason we can classify.
  // - Pin imageConfig.aspectRatio to "9:16" — the scene-placement prompt
  //   already asks for vertical Reel/TikTok output, and pinning it via
  //   the typed config removes the ambiguity that caused some attempts
  //   to come back as 1:1 (and then fail downstream size checks).
  const request: GenerateContentParameters = {
    model: "gemini-3-pro-image-preview",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: { aspectRatio: "9:16" },
    },
  };
  const response = await ai.models.generateContent(request);

  const candidates = response.candidates ?? [];
  // Walk every candidate (not just the first) so a refusal in slot 0
  // does not mask a usable image in slot 1. Some upstream responses
  // place safety refusals in the first candidate and the actual image
  // alongside.
  let imagePart:
    | { inlineData?: { data?: string; mimeType?: string } }
    | undefined;
  for (const cand of candidates) {
    const found = cand?.content?.parts?.find(
      (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData?.data,
    );
    if (found) {
      imagePart = found;
      break;
    }
  }

  if (!imagePart?.inlineData?.data) {
    const cand0 = candidates[0];
    const firstParts = cand0?.content?.parts ?? [];
    const partKinds = firstParts.map((p: Record<string, unknown>) => {
      if ("inlineData" in p) return "inlineData";
      if ("text" in p) return "text";
      if ("fileData" in p) return "fileData";
      return Object.keys(p)[0] ?? "unknown";
    });
    const textSnippet = (() => {
      const txt = firstParts.find(
        (p: { text?: string }) => typeof p.text === "string",
      ) as { text?: string } | undefined;
      return typeof txt?.text === "string" ? txt.text.slice(0, 300) : null;
    })();
    const finishReason =
      (cand0 as { finishReason?: string })?.finishReason ?? null;
    const blockReason =
      (response as { promptFeedback?: { blockReason?: string } })?.promptFeedback
        ?.blockReason ?? null;
    const safetyRatings =
      (cand0 as { safetyRatings?: unknown })?.safetyRatings ??
      (response as { promptFeedback?: { safetyRatings?: unknown } })
        ?.promptFeedback?.safetyRatings ??
      null;

    // Task #690: discriminate terminal policy/recitation blocks from
    // generic text-only refusals so the pipeline can stop burning the
    // retry budget on calls that will never succeed.
    let kind: GeminiNoImageKind = "no_image";
    if (blockReason || (finishReason && SAFETY_FINISH_REASONS.has(finishReason))) {
      kind = "safety_block";
    } else if (finishReason === "RECITATION") {
      kind = "recitation_block";
    }

    const messageByKind: Record<GeminiNoImageKind, string> = {
      safety_block: `Gemini blocked the request on safety policy (finishReason=${finishReason ?? "?"}, blockReason=${blockReason ?? "?"})`,
      recitation_block: "Gemini blocked the request on recitation policy",
      no_image:
        "No image data in response from gemini-3-pro-image-preview",
    };
    const err = new Error(messageByKind[kind]) as GeminiNoImageError;
    err.kind = kind;
    err.candidateCount = candidates.length;
    err.finishReason = finishReason;
    err.blockReason = blockReason;
    err.partKinds = partKinds;
    err.textSnippet = textSnippet;
    err.promptFeedback =
      (response as { promptFeedback?: unknown })?.promptFeedback ?? null;
    err.safetyRatings = safetyRatings;
    throw err;
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
