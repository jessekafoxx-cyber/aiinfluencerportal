// ─────────────────────────────────────────────────────────────────────────────
// Vision QA module. GPT-4o vision gate for the AI Influencer pipeline.
//
//   scoreMasterPortrait(imageUrl, profile)
//     → realism / anatomy / identity-fit / artifacts / lighting / overall
//   scoreScenePlacement(imageUrl, masterUrl, profile, sceneTemplate)
//     → identitySimilarity / realism / sceneFit / anatomy / overall
//
// Thresholds & verdicts live in this file so they're tunable in one
// place. The pipeline reads `verdict` and decides whether to retry.
// ─────────────────────────────────────────────────────────────────────────────

import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import type { CharacterProfile } from "./influencer-character";
import type { SceneTemplate } from "./influencer-scenes-library";
import { summarizeExtractedTraits } from "./influencer-notes-extractor";

const MODEL = "gpt-4o";
const MAX_OUTPUT_TOKENS = 600;

/** Per-call cost in cents for QA. Env-tunable. */
export const COST_CENTS_QA = Number(process.env.INFLUENCER_COST_QA_CENTS ?? 2);

export type Verdict = "pass" | "warn" | "reject";

export type MasterQA = {
  realism: number;
  anatomy: number;
  identityFidelity: number;
  artifacts: number;
  lighting: number;
  // Task #442 - brief-axis sub-scores. The model now rates the master
  // portrait against each user-pinned axis independently so we can reject
  // the master when ANY one of them drifts, instead of letting a high
  // overall score paper over (for example) a 25-32 brief rendered as 40+.
  apparentAgeMatch: number;
  genderMatch: number;
  ethnicityMatch: number;
  facialHairMatch: number;
  hairstyleMatch: number;
  overall: number;
  verdict: Verdict;
  notes: string;
  raw?: unknown;
};

export type SceneQA = {
  identitySimilarity: number;
  realism: number;
  sceneFit: number;
  anatomy: number;
  // Task #442 - mirror the brief-axis sub-scores on scene placements so
  // a scene swap that drifts the apparent age / gender / ethnicity /
  // facial hair / hairstyle is caught even when overall identity
  // similarity reads OK.
  apparentAgeMatch: number;
  genderMatch: number;
  ethnicityMatch: number;
  facialHairMatch: number;
  hairstyleMatch: number;
  overall: number;
  verdict: Verdict;
  notes: string;
  /** Set true when this score is from a strict-prompt retry pass. */
  retried?: boolean;
  raw?: unknown;
};

/** Task #442 - any brief-axis sub-score at or below this number causes
 *  a hard reject, regardless of overall. 5/10 is the same threshold the
 *  pre-existing realism / anatomy gates use, so the new axes inherit
 *  the same conservatism. */
const BRIEF_AXIS_REJECT_BELOW = 5;

// Thresholds (0..10 scale). Tuned conservatively — the QA gate should
// catch obvious failures, not be a bottleneck on borderline images.
const MASTER_PASS_OVERALL = 7;
const MASTER_REJECT_OVERALL = 5;
const MASTER_REJECT_REALISM = 5;

const SCENE_PASS_OVERALL = 7;
const SCENE_PASS_IDENTITY = 7;
const SCENE_REJECT_OVERALL = 5;
const SCENE_REJECT_IDENTITY = 5;

type BriefAxes = Pick<
  MasterQA,
  "apparentAgeMatch" | "genderMatch" | "ethnicityMatch" | "facialHairMatch" | "hairstyleMatch"
>;

function briefAxisRejects(axes: BriefAxes): boolean {
  return (
    axes.apparentAgeMatch <= BRIEF_AXIS_REJECT_BELOW ||
    axes.genderMatch <= BRIEF_AXIS_REJECT_BELOW ||
    axes.ethnicityMatch <= BRIEF_AXIS_REJECT_BELOW ||
    axes.facialHairMatch <= BRIEF_AXIS_REJECT_BELOW ||
    axes.hairstyleMatch <= BRIEF_AXIS_REJECT_BELOW
  );
}

function masterVerdict(scores: Pick<MasterQA, "overall" | "realism" | "anatomy"> & BriefAxes): Verdict {
  if (
    scores.overall <= MASTER_REJECT_OVERALL ||
    scores.realism <= MASTER_REJECT_REALISM ||
    scores.anatomy <= 5 ||
    briefAxisRejects(scores)
  ) {
    return "reject";
  }
  if (scores.overall >= MASTER_PASS_OVERALL && scores.realism >= 6 && scores.anatomy >= 6) {
    return "pass";
  }
  return "warn";
}

function sceneVerdict(scores: Pick<SceneQA, "overall" | "identitySimilarity" | "anatomy"> & BriefAxes): Verdict {
  if (
    scores.overall <= SCENE_REJECT_OVERALL ||
    scores.identitySimilarity <= SCENE_REJECT_IDENTITY ||
    scores.anatomy <= 5 ||
    briefAxisRejects(scores)
  ) {
    return "reject";
  }
  if (scores.overall >= SCENE_PASS_OVERALL && scores.identitySimilarity >= SCENE_PASS_IDENTITY && scores.anatomy >= 6) {
    return "pass";
  }
  return "warn";
}

function clamp10(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
}

export async function scoreMasterPortrait(
  imageUrl: string,
  profile: CharacterProfile,
): Promise<MasterQA> {
  const beardBrief =
    profile.gender === "male"
      ? (profile.facialHair ?? profile.dna?.beardStyle ?? "clean shaven")
      : (profile.facialHair ?? "clean shaven");
  const hairBrief = profile.hairstyle ?? profile.dna?.hairStyle ?? profile.hairstyleProfile;
  // Smart-extracted identity callouts from the free-text notes (hair colour,
  // eye colour, freckles, tattoos, glasses, piercings, build, distinctive
  // features). Folded into the QA brief so the scoring model can flag drift
  // on the same traits the prompt builder asked for.
  const extraTraits = summarizeExtractedTraits(profile.extractedTraits);
  const profileBrief = [
    `apparent age=${profile.ageDescriptor}`,
    `gender=${profile.gender}`,
    `ethnicity=${profile.ethnicityDescriptor}`,
    `facial hair=${beardBrief}`,
    `hairstyle=${hairBrief}`,
    extraTraits ? `extracted traits=${extraTraits}` : null,
    `archetype=${profile.archetype}`,
    `vibe=${profile.vibe}`,
    `realismLevel=${profile.realismLevel}`,
    `cinematicStyle=${profile.cinematicStyle}`,
  ]
    .filter((s): s is string => !!s)
    .join("; ");

  const system =
    "You are a senior creative director and photo retoucher. Score AI-generated portraits against " +
    "a creative brief. You only return a single JSON object that matches the requested schema. " +
    "Be honest and decisive - do not give every image a passing score. " +
    "Brief-axis scores must be strict: if the apparent age, gender, ethnicity, facial hair or " +
    "hairstyle do not visibly match the brief, score that axis 5 or below.";

  const userText =
    `Score this AI-generated master portrait against the brief.\n\n` +
    `Brief: ${profileBrief}.\n\n` +
    `Score each axis 0..10 (10 = perfect):\n` +
    `- realism: does it look like a real DSLR photograph of a real human (not AI art / cartoon / 3D render / plastic skin)?\n` +
    `- anatomy: facial proportions, eye symmetry, hand/finger correctness if visible.\n` +
    `- identityFidelity: overall identity-vs-brief match.\n` +
    `- artifacts: 10 = no AI artifacts, 0 = obvious AI artifacts (extra fingers, warped jewelry, melting features).\n` +
    `- lighting: cinematic, intentional, believable lighting design.\n` +
    `- apparentAgeMatch: does the subject visually read as the brief's apparent age band (NOT older, NOT younger)? Weathered skin / forehead lines / sun-bleached hair on a "early twenties" or "late twenties to early thirties" brief should score 4 or below.\n` +
    `- genderMatch: does the subject's presented gender match the brief?\n` +
    `- ethnicityMatch: does the subject's apparent ethnicity match the brief?\n` +
    `- facialHairMatch: does the facial hair (or absence of it) match the brief? "clean shaven" with visible stubble or beard should score 4 or below; "beard-stubble" with a clean shave should score 4 or below.\n` +
    `- hairstyleMatch: does the hairstyle visually match the brief (length, shape, parting, volume)?\n` +
    `- overall: weighted summary you would give a paying client.\n\n` +
    `Respond with ONLY this JSON shape, no prose:\n` +
    `{"realism":n,"anatomy":n,"identityFidelity":n,"artifacts":n,"lighting":n,"apparentAgeMatch":n,"genderMatch":n,"ethnicityMatch":n,"facialHairMatch":n,"hairstyleMatch":n,"overall":n,"notes":"short critique"}`;

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeJson(raw);
    const realism = clamp10(parsed.realism);
    const anatomy = clamp10(parsed.anatomy);
    const identityFidelity = clamp10(parsed.identityFidelity);
    const artifacts = clamp10(parsed.artifacts);
    const lighting = clamp10(parsed.lighting);
    const apparentAgeMatch = clamp10(parsed.apparentAgeMatch);
    const genderMatch = clamp10(parsed.genderMatch);
    const ethnicityMatch = clamp10(parsed.ethnicityMatch);
    const facialHairMatch = clamp10(parsed.facialHairMatch);
    const hairstyleMatch = clamp10(parsed.hairstyleMatch);
    const overall = clamp10(parsed.overall ?? (realism + anatomy + identityFidelity + artifacts + lighting) / 5);
    const notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 600) : "";
    const verdict = masterVerdict({
      overall,
      realism,
      anatomy,
      apparentAgeMatch,
      genderMatch,
      ethnicityMatch,
      facialHairMatch,
      hairstyleMatch,
    });
    return {
      realism,
      anatomy,
      identityFidelity,
      artifacts,
      lighting,
      apparentAgeMatch,
      genderMatch,
      ethnicityMatch,
      facialHairMatch,
      hairstyleMatch,
      overall,
      verdict,
      notes,
      raw: parsed,
    };
  } catch (err) {
    logger.warn({ err }, "scoreMasterPortrait failed; defaulting to warn");
    return defaultMasterQA();
  }
}

export async function scoreScenePlacement(
  imageUrl: string,
  masterImageUrl: string,
  profile: CharacterProfile,
  scene: SceneTemplate,
): Promise<SceneQA> {
  const system =
    "You are a senior creative director and photo retoucher. Compare two photographs and score the " +
    "second against the first for identity preservation, realism, and how well it integrates into a " +
    "described scene. Respond with a single JSON object only.";

  const beardBrief =
    profile.gender === "male"
      ? (profile.facialHair ?? profile.dna?.beardStyle ?? "clean shaven")
      : (profile.facialHair ?? "clean shaven");
  const hairBrief = profile.hairstyle ?? profile.dna?.hairStyle ?? profile.hairstyleProfile;
  // Smart-extracted identity callouts from the free-text notes. Folded into
  // the subject brief so the scene-placement scorer flags drift on the same
  // traits the prompt builder pinned (hair colour, eye colour, freckles,
  // tattoos, glasses, piercings, build, distinctive features).
  const extraTraits = summarizeExtractedTraits(profile.extractedTraits);
  const extraTraitsClause = extraTraits ? `; extracted traits=${extraTraits}` : "";
  const userText =
    `IMAGE 1 (reference identity): the master portrait of the subject.\n` +
    `IMAGE 2 (scene placement): the same subject re-staged into a new scene.\n\n` +
    `Scene brief: ${scene.label} - ${scene.environmentType}.\n` +
    `Subject brief: apparent age=${profile.ageDescriptor}; gender=${profile.gender}; ethnicity=${profile.ethnicityDescriptor}; facial hair=${beardBrief}; hairstyle=${hairBrief}${extraTraitsClause}; archetype=${profile.archetype}.\n\n` +
    `Score each axis 0..10 (10 = perfect):\n` +
    `- identitySimilarity: is IMAGE 2 unmistakably the same person as IMAGE 1 (face, hair, eye colour, body type, age, ethnicity)?\n` +
    `- realism: does IMAGE 2 look like a real DSLR photograph (not AI art / plastic skin / cartoon)?\n` +
    `- sceneFit: does the lighting / colour grade / depth of field of IMAGE 2 match the described scene cohesively?\n` +
    `- anatomy: facial proportions, eye symmetry, hand/finger correctness if visible.\n` +
    `- apparentAgeMatch: does IMAGE 2 visually read as the brief's apparent age band (NOT older)? Score 4 or below if it drifted older or younger.\n` +
    `- genderMatch: does IMAGE 2's presented gender match the brief?\n` +
    `- ethnicityMatch: does IMAGE 2's apparent ethnicity match the brief?\n` +
    `- facialHairMatch: does facial hair in IMAGE 2 match the brief? Score 4 or below if a clean-shaven brief grew stubble or a bearded brief was shaved.\n` +
    `- hairstyleMatch: does the hairstyle in IMAGE 2 match the brief (length, shape, parting, volume)?\n` +
    `- overall: weighted summary you would give a paying client.\n\n` +
    `Respond with ONLY this JSON shape, no prose:\n` +
    `{"identitySimilarity":n,"realism":n,"sceneFit":n,"anatomy":n,"apparentAgeMatch":n,"genderMatch":n,"ethnicityMatch":n,"facialHairMatch":n,"hairstyleMatch":n,"overall":n,"notes":"short critique"}`;

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: masterImageUrl } },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeJson(raw);
    const identitySimilarity = clamp10(parsed.identitySimilarity);
    const realism = clamp10(parsed.realism);
    const sceneFit = clamp10(parsed.sceneFit);
    const anatomy = clamp10(parsed.anatomy);
    const apparentAgeMatch = clamp10(parsed.apparentAgeMatch);
    const genderMatch = clamp10(parsed.genderMatch);
    const ethnicityMatch = clamp10(parsed.ethnicityMatch);
    const facialHairMatch = clamp10(parsed.facialHairMatch);
    const hairstyleMatch = clamp10(parsed.hairstyleMatch);
    const overall = clamp10(parsed.overall ?? (identitySimilarity + realism + sceneFit + anatomy) / 4);
    const notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 600) : "";
    const verdict = sceneVerdict({
      overall,
      identitySimilarity,
      anatomy,
      apparentAgeMatch,
      genderMatch,
      ethnicityMatch,
      facialHairMatch,
      hairstyleMatch,
    });
    return {
      identitySimilarity,
      realism,
      sceneFit,
      anatomy,
      apparentAgeMatch,
      genderMatch,
      ethnicityMatch,
      facialHairMatch,
      hairstyleMatch,
      overall,
      verdict,
      notes,
      raw: parsed,
    };
  } catch (err) {
    logger.warn({ err }, "scoreScenePlacement failed; defaulting to warn");
    return defaultSceneQA();
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wardrobe validator. Hard post-generation gate that rejects shirtless /
// open-shirt / exposed-torso / fitness-physique outputs regardless of the
// prompt. Used by master, angles, and settings to enforce the "creator /
// business-casual" wardrobe contract deterministically (prompt tuning
// alone is unreliable - diffusion models routinely violate negation).
// ─────────────────────────────────────────────────────────────────────────────

export type WardrobeQA = {
  visibleAbs: boolean;
  exposedChestPercentage: number; // 0..100
  openShirtDepth: number; // 0..10 (0 = closed, 10 = robe falling open)
  shirtlessProbability: number; // 0..1
  torsoSkinRatio: number; // 0..1 fraction of torso area showing bare skin
  pass: boolean;
  reason: string;
  notes: string;
  raw?: unknown;
};

// Thresholds. Tuned conservatively per the "creator / podcast guest /
// business casual / premium minimalism" target aesthetic.
const WARDROBE_MAX_EXPOSED_CHEST_PCT = 8; // a buttoned collar gap is fine
const WARDROBE_MAX_OPEN_SHIRT_DEPTH = 2; // at most 1-2 buttons undone
const WARDROBE_MAX_SHIRTLESS_PROB = 0.15;
const WARDROBE_MAX_TORSO_SKIN_RATIO = 0.1;

function clampPct(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
function clampUnit(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export async function scoreWardrobe(imageUrl: string): Promise<WardrobeQA> {
  const system =
    "You are a strict content-safety reviewer for a B2B creator-portrait pipeline. The target aesthetic is " +
    "creator / entrepreneur / podcast guest / business casual / premium minimalism. Shirtless, open-shirt, " +
    "exposed-torso, exposed-cleavage, fitness-model, beach-editorial, and lingerie aesthetics are NEVER " +
    "acceptable, regardless of artistic intent. Respond with a single JSON object only.";

  const userText =
    `Inspect this AI-generated portrait/composite. Score the wardrobe state objectively:\n\n` +
    `- visibleAbs (bool): are abdominal muscles or any part of the abdomen visible?\n` +
    `- exposedChestPercentage (0..100): what percentage of the upper-chest / sternum / pectoral area is bare skin (not covered by clothing)? A buttoned crew-neck or polo collar is 0-3. A T-shirt with normal neckline is 0-5. An open-collar shirt with one button undone is 5-10. A deep V-neck or blazer with no shirt under is 20-40. A shirt unbuttoned to the sternum is 40-60. Open shirt / robe is 60-100.\n` +
    `- openShirtDepth (0..10): if wearing a buttoned shirt, how far is it open? 0 = fully buttoned, 2 = top button only, 5 = unbuttoned to sternum, 8 = chest fully exposed, 10 = robe falling off.\n` +
    `- shirtlessProbability (0..1): probability the subject is effectively shirtless or wearing only an open garment that exposes the bare torso.\n` +
    `- torsoSkinRatio (0..1): fraction of the visible torso area (chest + abdomen + shoulders) that is bare skin rather than fabric.\n\n` +
    `Respond with ONLY this JSON shape, no prose:\n` +
    `{"visibleAbs":true|false,"exposedChestPercentage":n,"openShirtDepth":n,"shirtlessProbability":n,"torsoSkinRatio":n,"notes":"one short sentence describing the wardrobe"}`;

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeJson(raw);
    const visibleAbs = Boolean(parsed.visibleAbs);
    const exposedChestPercentage = clampPct(parsed.exposedChestPercentage);
    const openShirtDepth = clamp10(parsed.openShirtDepth);
    const shirtlessProbability = clampUnit(parsed.shirtlessProbability);
    const torsoSkinRatio = clampUnit(parsed.torsoSkinRatio);
    const notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 400) : "";

    let reason = "ok";
    let pass = true;
    if (visibleAbs) {
      pass = false;
      reason = "visible_abs";
    } else if (shirtlessProbability > WARDROBE_MAX_SHIRTLESS_PROB) {
      pass = false;
      reason = "shirtless_probability";
    } else if (exposedChestPercentage > WARDROBE_MAX_EXPOSED_CHEST_PCT) {
      pass = false;
      reason = "exposed_chest_percentage";
    } else if (openShirtDepth > WARDROBE_MAX_OPEN_SHIRT_DEPTH) {
      pass = false;
      reason = "open_shirt_depth";
    } else if (torsoSkinRatio > WARDROBE_MAX_TORSO_SKIN_RATIO) {
      pass = false;
      reason = "torso_skin_ratio";
    }

    return {
      visibleAbs,
      exposedChestPercentage,
      openShirtDepth,
      shirtlessProbability,
      torsoSkinRatio,
      pass,
      reason,
      notes,
      raw: parsed,
    };
  } catch (err) {
    // Fail-OPEN on validator error to avoid blocking the pipeline on
    // OpenAI outages. Caller still logs [wardrobe-check] so failures
    // are observable.
    logger.warn({ err, imageUrl }, "scoreWardrobe failed; defaulting to pass");
    return {
      visibleAbs: false,
      exposedChestPercentage: 0,
      openShirtDepth: 0,
      shirtlessProbability: 0,
      torsoSkinRatio: 0,
      pass: true,
      reason: "validator_error",
      notes: "QA call failed; defaulted to pass.",
    };
  }
}

/**
 * Strict wardrobe override block injected on retry attempts after a
 * wardrobe rejection. Front-load with positive description (diffusion
 * models honor positive direction better than negation), then negate.
 */
export const STRICT_WARDROBE_OVERRIDE =
  "MANDATORY WARDROBE OVERRIDE: the subject is fully clothed in a fitted premium crew-neck shirt, fine-knit " +
  "sweater, or business-casual top. The garment FULLY covers the chest, sternum, collarbone, shoulders, and " +
  "upper torso. The neckline is high and closed. Buttons (if any) are fully fastened. " +
  "ABSOLUTELY NO: shirtless, bare chest, bare shoulders, exposed pectorals, exposed abs, exposed midriff, " +
  "exposed cleavage, open shirt, unbuttoned shirt, deep v-neck, plunging neckline, robe falling open, " +
  "fitness-model torso, bodybuilder pose, beach editorial, lingerie editorial, gym shoot. " +
  "The aesthetic is creator / entrepreneur / podcast guest / business casual / premium minimalism, " +
  "NOT underwear model, fashion editorial, or physique showcase.";

function defaultMasterQA(): MasterQA {
  return {
    realism: 6,
    anatomy: 6,
    identityFidelity: 6,
    artifacts: 6,
    lighting: 6,
    apparentAgeMatch: 6,
    genderMatch: 6,
    ethnicityMatch: 6,
    facialHairMatch: 6,
    hairstyleMatch: 6,
    overall: 6,
    verdict: "warn",
    notes: "QA call failed; defaulted to warn.",
  };
}
function defaultSceneQA(): SceneQA {
  return {
    identitySimilarity: 6,
    realism: 6,
    sceneFit: 6,
    anatomy: 6,
    apparentAgeMatch: 6,
    genderMatch: 6,
    ethnicityMatch: 6,
    facialHairMatch: 6,
    hairstyleMatch: 6,
    overall: 6,
    verdict: "warn",
    notes: "QA call failed; defaulted to warn.",
  };
}
