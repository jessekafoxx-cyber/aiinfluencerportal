// ─────────────────────────────────────────────────────────────────────────────
// Cinematic prompt builders. Two public entrypoints:
//
//   buildMasterIdentityPrompt(profile)          → text-to-image (Higgsfield)
//   buildScenePlacementPrompt(profile, scene)   → image-edit (Gemini)
//
// Identity facts come from the CharacterProfile only — we never let scene
// templates invent facial / ethnic / age detail. Strict-identity clauses
// are repeated verbatim in both prompts so the placement step cannot
// drift away from the master portrait.
// ─────────────────────────────────────────────────────────────────────────────

import type { CharacterProfile } from "./influencer-character";
import type { SceneTemplate } from "./influencer-scenes-library";
import { dnaPromptBlock } from "./influencer-identity-dna";
import { renderExtractedTraitLines } from "./influencer-notes-extractor";

const GENDER_NOUN: Record<CharacterProfile["gender"], string> = {
  female: "woman",
  male: "man",
  non_binary: "non-binary person",
};

function identityClause(p: CharacterProfile): string {
  const dna = dnaPromptBlock(p.dna);
  // Task #442 - when the DNA block is present it already carries the
  // canonical hair description (style / texture / density / colour) and
  // the facial-hair line. Repeating `p.hairstyleProfile` here only
  // creates an opportunity for the model to interpolate between two
  // slightly-different hair descriptions, which is one of the drift
  // vectors we are trying to close.
  const hairLine = p.dna ? null : `Hair: ${p.hairstyleProfile}.`;
  return [
    `One single ${p.ageDescriptor} ${p.ethnicityDescriptor} ${GENDER_NOUN[p.gender]}.`,
    `Facial features: ${p.facialStructureTraits}.`,
    `Skin: ${p.skinToneProfile}.`,
    hairLine,
    `Body: ${p.bodyTypeProfile}.`,
    dna,
  ]
    .filter((s): s is string => !!s && s.length > 0)
    .join(" ");
}

/**
 * Task #442 - compact, user-pinned identity clause derived from the
 * Generate-modal brief. Front-loaded into the master prompt and
 * repeated verbatim in every scene-placement prompt so the model can
 * never lose sight of the (age, gender, ethnicity, facial hair,
 * hairstyle) tuple the user picked. Order matters: the apparent-age
 * descriptor sits FIRST so it primes the rest of the prompt.
 */
export function briefIdentityClause(p: CharacterProfile): string {
  const parts: string[] = [];
  // Task #673 - the age descriptor now ends with its own period, so
  // don't append another one (avoids "... Smooth jaw skin..").
  const ageBlock = p.ageDescriptor.endsWith(".") ? p.ageDescriptor : `${p.ageDescriptor}.`;
  parts.push(`BRIEF (must hold across every image): ${ageBlock}`);
  parts.push(`Gender: ${GENDER_NOUN[p.gender]} (do not drift to any other gender).`);
  parts.push(
    `Ethnicity: ${p.ethnicityDescriptor} (do not drift to any other ethnicity).`,
  );
  if (p.gender === "male") {
    const beard = p.facialHair ?? p.dna?.beardStyle ?? "clean shaven";
    parts.push(
      beard === "clean shaven"
        ? `Facial hair: clean shaven (no beard, no stubble, no mustache).`
        : `Facial hair: ${beard} (must be present and clearly visible).`,
    );
  } else if (p.facialHair && p.facialHair !== "clean shaven") {
    parts.push(`Facial hair: ${p.facialHair}.`);
  } else {
    parts.push(`Facial hair: clean shaven.`);
  }
  const hair = p.hairstyle ?? p.dna?.hairStyle ?? p.hairstyleProfile;
  parts.push(`Hairstyle: ${hair} (must be clearly the requested cut).`);
  // Task #673 - reinforce the requested cut with a concrete shape
  // descriptor derived from the DNA (texture / density / colour). When
  // the same axis is described two ways with the same vocabulary the
  // model has nothing to interpolate between, and the requested cut
  // sticks.
  if (p.dna) {
    // Task #673 - when the user-supplied notes pin a hair colour we
    // must NOT include the DNA-sampled colour here, otherwise the
    // same clause emits two conflicting hair-colour instructions
    // (e.g. notes pin "jet black" while DNA sampled "ash blonde").
    // The extracted-colour line below carries the colour invariant in
    // that case; this line only reinforces texture + density.
    const extractedHairColor = p.extractedTraits?.hairColor;
    if (extractedHairColor) {
      parts.push(
        `Hair shape detail: ${p.dna.hairTexture} texture, ${p.dna.hairDensity} density.`,
      );
    } else {
      parts.push(
        `Hair shape detail: ${p.dna.hairTexture} texture, ${p.dna.hairDensity} density, ${p.dna.hairColor} colour.`,
      );
    }
  }
  // Task #673 - explicit fringe negation. "fringe" / "bangs" briefs
  // were drifting to side-part / receding / slicked-back cuts because
  // those silhouettes are dramatically over-represented in the
  // training data for "male portrait headshot".
  if (/\b(fringe|bangs?)\b/i.test(hair)) {
    parts.push(
      "The hairstyle has a visible front fringe falling across the forehead - no side-part, no receding hairline, no slicked-back cut, no exposed forehead.",
    );
  }

  // Task #673 - promote the high-drift DNA invariants (eye colour,
  // hair colour, brow density, facial energy, skin texture) out of
  // the tail DNA paragraph and into the front-loaded brief as discrete
  // imperative sentences. These axes were the largest drift vectors
  // behind 25-32 grey-eyed / medium-brown-fringe briefs landing as
  // 40+ blue-eyed / dark-haired faces. The DNA paragraph still carries
  // them for redundancy, but the brief is now the authoritative source.
  // Notes-extracted overrides (renderExtractedTraitLines below) win
  // over DNA-derived defaults so user-pinned colours never get
  // contradicted by a DNA sample.
  const extracted = p.extractedTraits ?? null;
  if (p.dna?.eyeColor && !extracted?.eyeColor) {
    parts.push(
      `Eye color: ${p.dna.eyeColor} (must be clearly ${p.dna.eyeColor} - do not drift to blue, green, or any other colour).`,
    );
  }
  if (p.dna?.hairColor && !extracted?.hairColor) {
    parts.push(
      `Hair color: ${p.dna.hairColor} (must be unmistakably ${p.dna.hairColor} - no salt-and-pepper, no grey streaks, no recolouring).`,
    );
  }
  if (p.dna?.browDensity) {
    parts.push(
      `Eyebrows: ${p.dna.browDensity} density${p.dna.eyebrows ? `, ${p.dna.eyebrows} shape` : ""} (eyebrows must be clearly visible at the stated density).`,
    );
  }
  if (p.dna?.facialEnergy) {
    parts.push(
      `Facial energy: ${p.dna.facialEnergy} (do not drift to a more rugged, weathered, or older presentation).`,
    );
  }
  if (p.dna?.skinTexture) {
    parts.push(`Skin micro-texture: ${p.dna.skinTexture}.`);
  }

  // Smart-extracted traits from the free-text "Anything else?" notes
  // (hair colour, eye colour, freckles, tattoos, glasses, piercings,
  // build, distinctive features). Each rendered as a discrete
  // identity-anchored line so the model treats them as invariants that
  // must hold across the master portrait AND every scene swap.
  const extractedLines = renderExtractedTraitLines(p.extractedTraits);
  for (const line of extractedLines) parts.push(line);
  if (p.notes && p.notes.length > 0) {
    // Task #442 - cap user notes at 400 chars before folding into the
    // identity clause. The clause is front-loaded into both the master
    // prompt and every scene-swap prompt, so unbounded notes would
    // dilute the brief-axis signal across the prompt window and let
    // identity drift creep back in. 400 chars is enough for two or
    // three concrete callouts ("strong jaw, light freckles, gold chain
    // visible") without crowding out the rest of the brief.
    const NOTES_MAX = 400;
    const notes =
      p.notes.length > NOTES_MAX ? `${p.notes.slice(0, NOTES_MAX - 3)}...` : p.notes;
    parts.push(`User notes: ${notes}.`);
  }
  return parts.join(" ");
}

const REALISM_GUARDRAIL =
  "Photorealistic photograph, NOT illustration, NOT 3D render, NOT painting, NOT AI-art look. " +
  "Real human skin with natural pore texture, natural micro-imperfections, no plastic smoothing, " +
  "no waxy skin, no airbrush, no over-saturation, no cartoonish proportions, no uncanny features. " +
  "Eyes: realistic catchlights, natural sclera (no extra-white), defined iris pattern, no doll-eye look. " +
  "Hands and fingers: anatomically correct count and proportion when visible. " +
  "One person only. No text, no logos, no watermarks, no borders.";

// NEGATIVE_TAIL is split into a structural-only variant (safe for
// gemini-3-pro-image-preview) and a wardrobe-explicit variant used only
// where the underlying model handles negation reliably (Higgsfield Soul).
//
// Task #690: Gemini's safety classifier treats explicit body/nudity
// vocabulary as policy-triggering even when phrased as negatives. The
// long "shirtless / bare-chested / nude / lingerie / swimwear / …"
// list at the end of the scene-placement prompt was a primary cause of
// SAFETY_BLOCK / RECITATION / text-only refusals from the scene-swap
// step. The positive WARDROBE clause already pins the garment, so we
// strip the wardrobe-negative vocabulary from the scene prompt entirely
// and keep it only on the master prompt (Higgsfield).
const NEGATIVE_TAIL_STRUCTURAL =
  "AVOID: extra fingers, extra limbs, malformed hands, distorted face, asymmetric eyes, " +
  "doll-like skin, plastic skin, waxy skin, oversaturated colors, HDR halos, overly smooth skin, " +
  "AI-art aesthetic, cartoon, anime, illustration, painting, render, watermark, signature, text overlay.";

const NEGATIVE_TAIL =
  NEGATIVE_TAIL_STRUCTURAL +
  " AVOID: shirtless, bare-chested, bare-shouldered, topless, nude, partial nudity, towel-only, lingerie, swimwear, " +
  "underwear-only, open shirt, unbuttoned shirt, deep v-neck, plunging neckline, exposed pectorals, " +
  "exposed abs, exposed midriff, exposed cleavage, fitness model torso, bodybuilder pose, " +
  "shirt pulled open, shirt unzipped, robe falling open, low-cut top, crop top, cropped shirt, " +
  "editorial nudity, beach editorial, lingerie editorial, gym shoot, beachwear shoot.";

function tierClause(p: CharacterProfile): string {
  return p.qualityTier === "premium"
    ? "Magazine-cover-grade premium editorial photography, considered composition, intentional lighting design, " +
        "deliberate color grade, deep shadow detail, cinematic restraint."
    : "High-end editorial lifestyle photography, considered composition, intentional natural lighting, " +
        "subtle color grade, real-world believability.";
}

function cinematicGradeClause(p: CharacterProfile): string {
  switch (p.cinematicStyle) {
    case "warm-natural":
      return "Color grade: warm natural — golden highlights, warm midtones, soft amber shadows, gentle film-like falloff.";
    case "cool-clean":
      return "Color grade: cool clean — neutral whites, controlled cool shadows, minimal saturation, magazine-clean.";
    case "moody-cinematic":
      return "Color grade: moody cinematic — deep shadow detail, low-key contrast, refined warm highlights, film-grain restraint.";
    case "high-key-bright":
      return "Color grade: high-key bright — luminous highlights, soft pastels, low contrast, even flattering wrap.";
  }
}

/**
 * Master identity prompt — fed to the Higgsfield Soul text-to-image
 * endpoint to generate the canonical identity reference image.
 *
 * Product-direction pivot: the influencer "main image" is now a clean
 * canonical identity reference (think professional ID photo / casting
 * profile / talent headshot), NOT an editorial cinematic portrait.
 * Downstream scene swaps still reference back to this image, and the
 * cleaner the canonical face/skin/lighting, the better identity
 * preservation downstream. So we drop the cinematic/editorial language
 * (deliberate color grade, dramatic lighting, deep shadow detail,
 * environmental styling, hero/magazine framing) and explicitly enforce
 * a passport-style headshot on a plain neutral background.
 */
export function buildMasterIdentityPrompt(p: CharacterProfile): string {
  // Task #442 - `notes` is now folded into briefIdentityClause so it is
  // front-loaded alongside the rest of the user-pinned brief and never
  // appears in two places at once.
  const wardrobe = concreteWardrobe(p);
  return [
    "Clean canonical identity reference photograph: a single subject, vertical 9:16 headshot.",
    // Front-loaded brief so the model anchors apparent age, gender,
    // ethnicity, facial hair and hairstyle before any styling language.
    briefIdentityClause(p),
    `WARDROBE (mandatory): the subject is fully and properly dressed, ${wardrobe}. The garment fully covers the chest, shoulders, collarbone, and upper arms. The garment is clearly visible across the entire torso area shown in frame. This is a fully-clothed professional headshot, not a shirtless, bare-chested, bare-shouldered, towel, lingerie, swimwear, or underwear photograph.`,
    identityClause(p),
    "Background: plain seamless light-neutral studio backdrop (off-white / light grey / soft beige). No environment, no props, no scenery, no textures, no logos.",
    "Composition: front-facing, centered, symmetrical framing. Head and upper torso in frame. Looking directly at the camera with a relaxed, neutral, confident expression.",
    "Lighting: even, soft, balanced studio lighting. Natural skin tones. No dramatic shadows, no rim lighting, no chiaroscuro, no environmental light spill.",
    "Camera: straight-on eye-level lens, professional studio crop, sharp focus across the face, shallow but realistic depth of field on the body only.",
    `Styling reference (use only as styling guidance, do NOT remove the wardrobe described above): ${p.fashionStyle}. Solid plain colors. No loud prints, no celebrity-branded clothing, no visible logos.`,
    `Apparent vibe (subtle, NOT cinematic styling): ${p.vibe}.`,
    "Aesthetic target: professional casting profile / passport-style talent headshot / identity reference card. Realistic, identity-consistency optimized.",
    "AVOID: editorial campaign styling, magazine-cover framing, environmental storytelling, dramatic shadows, deep cinematic color grade, luxury interior backdrops, posed editorial gestures, wide environmental establishing shots.",
    REALISM_GUARDRAIL,
    NEGATIVE_TAIL,
  ].join(" ");
}

/**
 * Concrete, archetype-aware wardrobe description used to front-load the
 * master prompt. Diffusion models like Higgsfield Soul are unreliable at
 * honouring negation ("not shirtless"), so we describe a specific real
 * garment the subject IS wearing. Gender-aware so the language reads
 * naturally and does not produce an awkward gendered swap.
 */
function concreteWardrobe(p: CharacterProfile): string {
  const isMale = p.gender === "male";
  switch (p.archetype) {
    case "fitness":
      return isMale
        ? "wearing a fitted plain crew-neck cotton t-shirt in a solid neutral color (charcoal, off-white, or olive)"
        : "wearing a fitted high-neck athletic top with full shoulder coverage in a solid neutral color (charcoal, off-white, or olive)";
    case "wellness":
      return "wearing a relaxed-fit linen or cotton crew-neck top in cream, sand, or soft beige with full shoulder and chest coverage";
    case "fashion":
      return isMale
        ? "wearing a structured solid-color knit sweater or fine-gauge turtleneck in a sculptural neutral palette"
        : "wearing a sculptural solid-color knit top or fine-gauge turtleneck with full shoulder and chest coverage";
    case "luxury":
      return isMale
        ? "wearing a tailored fine-knit merino sweater or pressed solid-color button-down shirt in a refined neutral (camel, charcoal, ivory)"
        : "wearing a tailored silk blouse or fine-knit merino top in a refined neutral (camel, charcoal, ivory) with full shoulder and chest coverage";
    case "lifestyle":
      return "wearing a clean solid-color crew-neck cotton t-shirt or lightweight knit top in a soft neutral with full shoulder and chest coverage";
    case "travel":
      return "wearing a relaxed lightweight long-sleeve solid-color top or layered henley in earth tones";
    case "business":
      return isMale
        ? "wearing a crisp pressed solid-color button-down shirt (white, light blue, or charcoal) with collar visible, optionally under a tailored blazer"
        : "wearing a tailored solid-color blouse or fine knit top with full shoulder coverage, optionally under a structured blazer";
    case "tech":
      return isMale
        ? "wearing a premium plain solid-color crew-neck t-shirt or fine-gauge knit in monochrome neutrals (black, charcoal, off-white)"
        : "wearing a premium plain solid-color crew-neck top or fine-gauge knit in monochrome neutrals (black, charcoal, off-white)";
    case "creative":
      return "wearing a layered textured top - a solid crew-neck shirt under an open overshirt or jacket - in considered earth tones";
    case "foodie":
      return "wearing a relaxed solid-color crew-neck shirt in warm earth tones, optionally with a clean apron over the top";
    case "outdoor":
      return "wearing a technical performance long-sleeve top or zipped fleece in earth-tone neutrals";
    case "beauty":
      return "wearing a clean solid-color high-neck or crew-neck top in a luxurious neutral fabric with full shoulder and chest coverage";
  }
}

/**
 * Stronger-constraint variant used when the QA pass rejects a master
 * identity reference and we want to retry with extra realism + identity
 * guardrails.
 */
export function buildMasterIdentityPromptStrict(p: CharacterProfile, qaNotes: string | null = null): string {
  const base = buildMasterIdentityPrompt(p);
  const reinforce =
    "REINFORCED REALISM: this image MUST look like a real DSLR studio headshot of a real human being, " +
    "not generated art. Skin must have visible pores and natural micro-texture. " +
    "Eyes must have realistic asymmetric catchlights and natural sclera (not pure white). " +
    "Facial proportions must match a real human face exactly. No plastic, no wax, no airbrushing. " +
    "REINFORCED CANONICAL FRAMING: front-facing, centered, plain neutral background, even studio lighting, " +
    "no cinematic styling, no environmental scenery. " +
    (qaNotes ? `Address these previous QA findings explicitly: ${qaNotes}.` : "");
  return `${base} ${reinforce}`;
}

/**
 * Scene-placement prompt for the Gemini image-edit step. The first
 * input image is the master portrait (identity source); the second
 * input image is the scene reference (environment source).
 */
export function buildScenePlacementPrompt(p: CharacterProfile, scene: SceneTemplate): string {
  return [
    `Place the SAME PERSON from the first reference image into a new scene composed below.`,
    // Task #442 - repeat the user-pinned brief verbatim so the
    // scene-swap model cannot drift the apparent age, gender, ethnicity,
    // facial-hair, or hairstyle axes away from what we just generated
    // in the master portrait.
    briefIdentityClause(p),
    // Task #690 — softened identity-preservation clause. The original
    // version listed each axis with "no X drift" phrasing per axis,
    // which read as a wall of negative directives and statistically
    // raised the rate of gemini-3-pro-image-preview text-only refusals
    // and SAFETY_BLOCK responses. The positive form ("must be the same
    // person") conveys the same constraint without negative pile-up.
    `IDENTITY PRESERVATION (highest priority): the person in the output must be the same individual ` +
      `as the first reference image. Preserve their face, facial structure, jaw line, cheekbones, ` +
      `nose, lips, eye shape and colour, eyebrows, hair colour, hair length, hairstyle, facial hair, ` +
      `skin tone, skin texture, body proportions, height, build, and apparent age. ` +
      `Match the first reference image exactly on these attributes.`,
    `SCENE: ${scene.environmentType}.`,
    scene.prompt(p),
    `WARDROBE: keep wardrobe consistent with ${p.fashionStyle} and the scene context above; the ` +
      `subject is fully and properly dressed throughout. Do not invent celebrity-branded clothing or ` +
      `visible logos.`,
    `INTEGRATION: match the lighting direction, colour grade, white balance, depth of field, ` +
      `and perspective described above so the person looks naturally photographed inside that scene. ` +
      `${cinematicGradeClause(p)}`,
    tierClause(p),
    `OUTPUT FORMAT: vertical 9:16 aspect ratio, Instagram Reel / TikTok portrait format ` +
      `(1080x1920 or higher). Crisp, ultra-high-resolution photograph — sharp focus, clean detail in ` +
      `skin, hair, fabric, and background. Output exactly ONE image.`,
    REALISM_GUARDRAIL,
    // Task #690: structural-only negatives (no nudity/body vocabulary).
    // The wardrobe clause above already establishes "fully and properly
    // dressed"; the master-prompt path retains the long NEGATIVE_TAIL
    // (Higgsfield Soul handles negation correctly).
    NEGATIVE_TAIL_STRUCTURAL,
  ].join(" ");
}

/**
 * Maximally-softened scene-placement prompt used for a single one-shot
 * NO_IMAGE_IN_RESPONSE retry (Task #690).
 *
 * When Gemini returns a candidate with no inlineData and no terminal
 * SAFETY/RECITATION signal (i.e. `kind="no_image"`), the pipeline gets
 * one retry against this variant before marking the scene terminal.
 * The variant strips:
 *   - the REALISM_GUARDRAIL paragraph (the "Hands and fingers: anatomically
 *     correct count and proportion" / "no plastic skin" wording sometimes
 *     reads as anatomical fixation to the safety classifier)
 *   - the structural NEGATIVE_TAIL ("AVOID: extra fingers, extra limbs,
 *     malformed hands, …" — long negative list)
 *   - the long IDENTITY PRESERVATION paragraph (replaced with a single
 *     positive sentence)
 *   - the tierClause editorial-photography wording
 *
 * What remains is the minimum needed for a usable swap: place the same
 * person in the new scene, keep wardrobe consistent, output a single
 * 9:16 photograph.
 */
export function buildScenePlacementPromptSoftened(
  p: CharacterProfile,
  scene: SceneTemplate,
): string {
  return [
    `Place the same person from the first reference image into a new scene.`,
    briefIdentityClause(p),
    `Keep the same face, hairstyle, and overall appearance as the reference.`,
    `SCENE: ${scene.environmentType}.`,
    scene.prompt(p),
    `WARDROBE: keep wardrobe consistent with ${p.fashionStyle} and the scene context; the subject is fully dressed.`,
    `${cinematicGradeClause(p)}`,
    `OUTPUT: a single vertical 9:16 photograph.`,
  ].join(" ");
}

/** Tightened scene placement prompt for QA-failed scene retries. */
export function buildScenePlacementPromptStrict(
  p: CharacterProfile,
  scene: SceneTemplate,
  qaNotes: string | null = null,
): string {
  const base = buildScenePlacementPrompt(p, scene);
  const reinforce =
    "REINFORCED IDENTITY MATCH: the previous attempt drifted from the source identity. " +
    "Compare against the first reference image again — the face MUST be unmistakably the same person. " +
    "Do NOT change ethnicity, gender, age, hair colour, hair length, eye colour, or facial structure. " +
    (qaNotes ? `Specifically address: ${qaNotes}.` : "");
  return `${base} ${reinforce}`;
}
