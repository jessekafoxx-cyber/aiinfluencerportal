// ─────────────────────────────────────────────────────────────────────────────
// Identity DNA. Each influencer gets a randomly sampled set of fine-grained
// physical traits constrained by the demographic envelope (gender, ethnicity,
// age range). Two users picking the exact same dropdowns still get
// completely different people because DNA randomizes inside each envelope.
//
// The DNA is persisted on the job's prefs.characterProfile.dna and feeds
// every prompt builder (master, angles, settings) so the same person
// shows up consistently across the entire workspace.
//
// Anti-collision: ensureUniqueIdentityDna() compares each candidate
// against this client's recent influencer DNAs and rerolls when the
// trait-overlap exceeds COLLISION_THRESHOLD.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db, aiInfluencerJobsTable } from "@workspace/db";
import { logger } from "./logger";

export type IdentityDna = {
  faceShape: string;
  jawline: string;
  chinShape: string;
  faceWidth: string;
  cheekbones: string;
  eyes: string;
  eyeSpacing: string;
  eyeColor: string;
  eyebrows: string;
  browDensity: string;
  noseBridge: string;
  noseProfile: string;
  lipFullness: string;
  smileStyle: string;
  facialAsymmetry: string;
  /** Length-to-width ratio of the face overall (short, balanced, long). */
  faceLengthRatio: string;
  /** Forehead height and shape relative to the rest of the face. */
  foreheadProportion: string;
  /** Subtle masculine/feminine facial energy along a soft gradient. */
  facialEnergy: string;
  /** Realistic skin micro-texture: pores, fine lines, gloss, matte. */
  skinTexture: string;
  /** Whether ears read prominently, softly tucked under hair, or hidden. */
  earVisibility: string;
  /** Shape of the neck silhouette under the jaw. */
  neckStructure: string;
  skinUndertone: string;
  freckles: string;
  hairStyle: string;
  hairTexture: string;
  hairDensity: string;
  hairColor: string;
  /** Facial hair style. Only meaningful for `gender === "male"` envelopes;
   *  set to "clean shaven" (or the user override) for everyone else. */
  beardStyle: string;
  build: string;
  neckLength: string;
  expressionBaseline: string;
  /** Stable hash of the trait values, used for fast collision comparison. */
  hash: string;
};

// Trait pools. Some are global; some vary by gender or ethnicity. Pools
// are intentionally large so even within a single envelope the
// combinatorial space is in the thousands.
const FACE_SHAPES = [
  "oval", "soft oval", "elongated oval",
  "round", "soft round",
  "square", "soft square",
  "heart", "inverted-heart",
  "diamond", "soft diamond",
  "rectangular", "long rectangular",
  "long", "narrow long",
  "triangular", "soft triangular",
  "pear",
];
const JAWLINES = [
  "sharp angular", "sharply defined", "knife-edge sharp",
  "softly defined", "soft and tapered",
  "broad angular", "broad rounded",
  "narrow tapered", "narrow defined",
  "rounded gentle", "rounded soft",
  "square broad", "square defined",
  "subtle understated", "barely-defined soft",
  "asymmetrically defined left-dominant",
  "asymmetrically defined right-dominant",
];
const CHIN_SHAPES = [
  "pointed narrow", "pointed defined",
  "rounded soft", "rounded full",
  "square broad", "square defined",
  "subtle understated", "barely-projected",
  "prominent forward", "prominent defined",
  "tapered narrow", "tapered soft",
  "cleft subtle", "cleft pronounced",
  "dimpled soft",
  "slightly recessed soft",
];
const FACE_WIDTHS = [
  "narrow", "very-narrow",
  "medium-narrow",
  "medium", "balanced-medium",
  "medium-wide", "broad-medium",
  "wide", "broad",
];
const CHEEKBONES = [
  "high and very prominent",
  "high and softly defined",
  "high and sculptural",
  "mid-height softly defined",
  "mid-height moderate",
  "moderate balanced",
  "subtle softly rounded",
  "subtle understated",
  "wide and high",
  "wide and softly defined",
  "narrow and sharply defined",
  "narrow and softly defined",
  "asymmetric (slightly higher on the right)",
  "asymmetric (slightly higher on the left)",
];

const EYE_SHAPES = [
  "almond classic", "soft almond", "deep-set almond",
  "round wide", "round soft",
  "hooded subtle", "hooded pronounced",
  "monolid soft", "monolid defined",
  "upturned cat-eye", "upturned soft",
  "downturned soft", "downturned defined",
  "wide-set almond", "wide-set round",
  "close-set almond", "close-set soft",
  "doe-eyed soft", "doe-eyed round",
  "narrow elongated", "narrow defined",
  "slightly asymmetric (left higher)",
];
const EYE_SPACING = [
  "close-set narrow", "close-set",
  "slightly-close-set",
  "average-set balanced",
  "average-set wide",
  "slightly-wide-set",
  "wide-set",
  "wide-set pronounced",
];
const EYEBROWS = [
  "thick straight", "thick arched", "thick feathered",
  "medium straight", "medium arched", "medium softly arched",
  "thin straight", "thin arched", "thin softly tapered",
  "feathered natural", "feathered bushy",
  "tapered angular", "tapered soft",
  "high-arched expressive",
  "low-set serious",
  "slightly asymmetric (left higher)",
];
const BROW_DENSITY = [
  "very thin sparse", "thin sparse",
  "thin medium-density",
  "medium softly filled", "medium full",
  "thick full", "thick bushy",
  "very thick bushy",
  "groomed and defined",
];

const EYE_COLORS_BY_ETHNICITY: Record<string, string[]> = {
  white: ["blue", "green", "hazel", "light brown", "grey", "deep brown"],
  black: ["deep brown", "dark brown", "amber-brown", "hazel"],
  east_asian: ["dark brown", "black-brown", "warm brown"],
  south_asian: ["dark brown", "deep brown", "amber-brown", "hazel"],
  hispanic_latino: ["dark brown", "warm brown", "hazel", "amber"],
  middle_eastern: ["dark brown", "warm brown", "hazel", "amber-green"],
  mixed: ["hazel", "amber", "light brown", "grey-green", "deep brown"],
};

const NOSE_BRIDGES = [
  "straight narrow", "straight medium", "straight wide",
  "slightly curved soft", "slightly curved pronounced",
  "subtle dorsal hump", "pronounced dorsal hump",
  "low bridge narrow", "low bridge wide",
  "high bridge narrow", "high bridge medium",
  "Roman aquiline",
  "softly scooped",
  "asymmetric subtle deviation",
];
const NOSE_PROFILES = [
  "refined narrow tip", "refined tapered tip",
  "rounded soft tip", "rounded full tip",
  "tapered narrow tip", "tapered defined tip",
  "button soft tip", "button rounded tip",
  "broad soft tip", "broad defined tip",
  "upturned subtle", "upturned pronounced",
  "downturned subtle", "downturned pronounced",
  "bulbous soft",
  "narrow projecting",
];

const LIP_FULLNESS = [
  "thin both lips", "thin upper full lower",
  "medium-thin balanced",
  "medium balanced", "medium with defined cupid's bow",
  "medium-full balanced", "medium-full lower-heavy",
  "full balanced top-bottom", "full lower-heavy",
  "very full balanced",
  "asymmetric (one corner higher)",
];
const SMILE_STYLES = [
  "closed-lip subtle",
  "closed-lip warm",
  "soft half-smile left-side",
  "soft half-smile right-side",
  "warm balanced full",
  "wide and bright",
  "wide showing upper teeth only",
  "wide showing full teeth",
  "asymmetric one-sided right",
  "asymmetric one-sided left",
  "controlled and reserved",
  "quietly amused closed-lip",
  "open laughing crinkled-eyes",
  "soft Mona Lisa subtle",
];
const FACIAL_ASYMMETRY = [
  "very subtle (almost imperceptible)",
  "barely perceptible (one brow slightly higher)",
  "slight (one eye slightly larger)",
  "slight (one cheek slightly fuller)",
  "slight (subtle mouth-corner offset)",
  "slight (subtle nose-tip deviation)",
];

// New axes the user asked for.
const FACE_LENGTH_RATIOS = [
  "short and balanced",
  "balanced classic 1:1",
  "balanced slightly long",
  "moderately long",
  "long and elongated",
];
const FOREHEAD_PROPORTIONS = [
  "short and softly curved",
  "balanced height with rounded hairline",
  "balanced height with straight hairline",
  "balanced height with widow's peak",
  "tall and rounded",
  "tall and straight-set",
  "tall with widow's peak",
  "broad with squared hairline",
  "narrow with rounded hairline",
];
const FACIAL_ENERGIES_BY_GENDER: Record<string, string[]> = {
  // intentionally soft labels so the model reads them as energy not gender swap
  male: [
    "softly masculine, refined and approachable",
    "classically masculine, balanced and grounded",
    "strongly masculine with sharp angular notes",
    "rugged masculine with weathered character",
    "boyish masculine, youthful and open",
    "androgynous-leaning soft masculine",
    "stoic masculine, composed and quiet",
  ],
  female: [
    "softly feminine, romantic and warm",
    "classically feminine, balanced and refined",
    "strongly feminine with sculpted high features",
    "androgynous-leaning soft feminine",
    "youthful feminine, fresh and open",
    "quietly powerful feminine, composed",
    "earthy feminine, grounded and warm",
  ],
  non_binary: [
    "soft androgynous, balanced features",
    "sharply androgynous, defined high features",
    "warmly androgynous, approachable and open",
    "cool androgynous, composed and quiet",
    "youthful androgynous, fresh and unmarked",
  ],
};
const SKIN_TEXTURES = [
  "smooth even skin with visible micro-pores at the t-zone",
  "smooth skin with light natural sheen on the cheekbones",
  "matte natural skin with subtle pore detail across the cheeks",
  "soft skin with very fine laughter lines at the eyes",
  "lived-in skin with subtle forehead expression lines",
  "weather-textured skin with light sun character",
  "balanced skin with a subtle natural glow on the cheekbones and nose-bridge",
  "soft skin with a hint of dryness at the brow and a glow at the cheekbones",
  "youthful smooth skin with light natural luminosity",
  "softly textured skin with a faint freckle scatter and natural pores",
];
const EAR_VISIBILITY = [
  "ears fully visible, neutral protrusion",
  "ears fully visible, close to the head",
  "ears partially hidden by hair on one side",
  "ears mostly hidden under hair",
  "ears tucked behind the hairline, lobes visible",
  "ears prominent, slightly protruding",
];
const NECK_STRUCTURES = [
  "slim with defined sternocleidomastoid",
  "average columnar neck, soft contour",
  "broad with a subtle Adam's apple shadow",
  "broad and muscular with defined trapezius rise",
  "long and slim with a soft contour",
  "short with a slightly fuller jowl line",
  "balanced with defined collarbone shadow",
];

const SKIN_UNDERTONES_BY_ETHNICITY: Record<string, string[]> = {
  white: ["cool pink", "cool neutral", "warm peach", "warm golden", "neutral beige"],
  black: ["warm red-brown", "cool blue-brown", "warm golden-brown", "neutral deep-brown", "warm honey"],
  east_asian: ["warm yellow", "neutral porcelain", "cool pink-porcelain", "warm honey"],
  south_asian: ["warm golden", "warm honey", "neutral wheat", "warm caramel"],
  hispanic_latino: ["warm olive", "warm honey", "neutral tan", "warm caramel"],
  middle_eastern: ["warm olive", "warm honey", "neutral wheat", "warm caramel"],
  mixed: ["warm caramel", "neutral honey", "warm golden", "neutral tan"],
};

const FRECKLES_BY_ETHNICITY: Record<string, string[]> = {
  white: ["none", "light freckling across nose-bridge", "moderate freckling on cheeks", "scattered light freckles", "single small mole near jaw"],
  black: ["none", "subtle birthmark on cheek", "single small mole near lip"],
  east_asian: ["none", "single small mole near eye", "subtle birthmark on jaw"],
  south_asian: ["none", "single small mole near lip", "subtle birthmark"],
  hispanic_latino: ["none", "light freckling across nose", "single small mole near eye"],
  middle_eastern: ["none", "subtle birthmark", "single small mole on cheek"],
  mixed: ["none", "scattered light freckles", "single small mole", "subtle birthmark"],
};

const HAIR_STYLES_MALE = [
  "short tapered",
  "medium textured crop",
  "side-swept medium",
  "tousled medium",
  "slicked-back short",
  "modern fringe",
  "buzz cut",
  "loose curls medium",
  "long shoulder-length",
  "high-volume quiff",
  "textured pompadour",
  "messy fringe",
  "curtain fringe medium",
  "undercut with longer top",
  "low fade with textured top",
  "comb-over with side part",
  "man bun shoulder-length",
  "loose waves medium",
];
const HAIR_STYLES_FEMALE = ["long straight", "long loose waves", "medium soft layers", "medium straight bob", "long beach waves", "shoulder-length blunt cut", "long ponytail", "medium textured lob", "natural curls long", "natural curls medium"];
const HAIR_STYLES_NB = ["medium textured crop", "shoulder-length layered", "medium straight bob", "long loose waves", "side-swept medium", "natural curls medium"];

// Beard / facial hair pool for male envelopes. Other genders default
// to "clean shaven" unless the user overrides.
const BEARD_STYLES_MALE = [
  "clean shaven",
  "clean shaven",
  "light stubble",
  "moderate stubble",
  "beard-stubble",
  "short groomed beard",
  "medium full beard",
  "thick full beard",
  "goatee",
  "mustache only",
];

/** Age buckets where any "weathered / lived-in / aged-skin" descriptors must
 *  be suppressed. Influencers asked for a 25-32 male must not come out with
 *  forehead expression lines, sun-bleached brows, or other aging traits. */
const YOUNG_AGE_RANGES = new Set(["18-24", "25-32"]);

const AGED_DESCRIPTOR_RE =
  /(weathered|weather-textured|lived-in|sun-?bleached|sun-?weathered|character lines|forehead expression lines|laughter lines|crinkled smile|fine lines|aged skin|aging texture|wrinkles?)/i;

const AGED_ENERGY_RE = /(rugged|stoic|weathered|earthy)/i;

const HAIR_TEXTURES = ["fine straight", "medium straight", "thick straight", "fine wavy", "medium wavy", "thick wavy", "loose curls", "tight curls", "coily"];
const HAIR_DENSITY = ["thin", "medium", "thick"];

const HAIR_COLORS_BY_ETHNICITY: Record<string, string[]> = {
  white: ["dark brown", "medium brown", "light brown", "honey blonde", "ash blonde", "platinum blonde", "auburn", "ginger red", "black"],
  black: ["natural black", "dark brown", "warm dark brown"],
  east_asian: ["natural black", "dark brown", "warm dark brown"],
  south_asian: ["natural black", "dark brown", "warm dark brown"],
  hispanic_latino: ["natural black", "dark brown", "warm dark brown", "medium brown"],
  middle_eastern: ["natural black", "dark brown", "warm dark brown", "medium brown"],
  mixed: ["dark brown", "warm dark brown", "medium brown", "auburn"],
};

const BUILDS = ["lean athletic", "lean", "slim toned", "average balanced", "athletic muscular", "broad athletic", "stocky", "tall lean", "tall athletic"];
const NECK_LENGTHS = ["short", "average", "long"];
const EXPRESSIONS = [
  "calm confident",
  "warm approachable",
  "subtle resting smile",
  "intent focused",
  "soft thoughtful",
  "open and friendly",
  "composed and observant",
  "quietly amused",
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Mulberry32 deterministic PRNG. We seed it from a high-entropy source
 * so each generation is unique unless the caller pins a seed for tests.
 */
function makeRng(seedHex: string): () => number {
  let state = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTraits(values: string[]): string {
  return crypto.createHash("sha256").update(values.join("|")).digest("hex").slice(0, 16);
}

export type DnaEnvelope = {
  gender: "male" | "female" | "non_binary";
  ethnicity: string;
  /** Optional age bucket (e.g. "25-32"). When set to one of the young
   *  buckets, the sampler suppresses weathered / aged-skin / rugged
   *  descriptors so a "25-32 male athletic" brief never resolves to a
   *  40-year-old weathered face. */
  ageRange?: string;
  /** Optional user-selected facial hair. When provided, locks the DNA's
   *  `beardStyle` to the user's choice instead of sampling. */
  facialHair?: string | null;
  /** Optional user-selected hairstyle. When provided, locks the DNA's
   *  `hairStyle` to the user's choice instead of sampling. */
  hairstyle?: string | null;
};

/**
 * Sample a fresh IdentityDna from the demographic envelope. `seed` is
 * optional - defaults to crypto-strong randomness so two calls with the
 * same envelope return different DNA (which is the entire point).
 */
export function generateIdentityDna(envelope: DnaEnvelope, seed?: string): IdentityDna {
  const seedHex = seed ?? crypto.randomBytes(16).toString("hex");
  const rng = makeRng(seedHex);

  const eyeColors =
    EYE_COLORS_BY_ETHNICITY[envelope.ethnicity] ?? EYE_COLORS_BY_ETHNICITY.mixed;
  const undertones =
    SKIN_UNDERTONES_BY_ETHNICITY[envelope.ethnicity] ??
    SKIN_UNDERTONES_BY_ETHNICITY.mixed;
  const freckles =
    FRECKLES_BY_ETHNICITY[envelope.ethnicity] ?? FRECKLES_BY_ETHNICITY.mixed;
  const hairColors =
    HAIR_COLORS_BY_ETHNICITY[envelope.ethnicity] ?? HAIR_COLORS_BY_ETHNICITY.mixed;
  const hairStyles =
    envelope.gender === "male"
      ? HAIR_STYLES_MALE
      : envelope.gender === "female"
        ? HAIR_STYLES_FEMALE
        : HAIR_STYLES_NB;

  const isYoung = envelope.ageRange ? YOUNG_AGE_RANGES.has(envelope.ageRange) : false;
  const facialEnergiesAll =
    FACIAL_ENERGIES_BY_GENDER[envelope.gender] ?? FACIAL_ENERGIES_BY_GENDER.non_binary;
  const facialEnergies = isYoung
    ? facialEnergiesAll.filter((s) => !AGED_ENERGY_RE.test(s))
    : facialEnergiesAll;
  const skinTextures = isYoung
    ? SKIN_TEXTURES.filter((s) => !AGED_DESCRIPTOR_RE.test(s))
    : SKIN_TEXTURES;

  const trimmedHairOverride = envelope.hairstyle?.trim() || null;
  const trimmedFacialOverride = envelope.facialHair?.trim() || null;

  const sampledHair = pick(rng, hairStyles);
  const sampledBeard =
    envelope.gender === "male" ? pick(rng, BEARD_STYLES_MALE) : "clean shaven";

  const traits = {
    faceShape: pick(rng, FACE_SHAPES),
    jawline: pick(rng, JAWLINES),
    chinShape: pick(rng, CHIN_SHAPES),
    faceWidth: pick(rng, FACE_WIDTHS),
    cheekbones: pick(rng, CHEEKBONES),
    eyes: pick(rng, EYE_SHAPES),
    eyeSpacing: pick(rng, EYE_SPACING),
    eyeColor: pick(rng, eyeColors),
    eyebrows: pick(rng, EYEBROWS),
    browDensity: pick(rng, BROW_DENSITY),
    noseBridge: pick(rng, NOSE_BRIDGES),
    noseProfile: pick(rng, NOSE_PROFILES),
    lipFullness: pick(rng, LIP_FULLNESS),
    smileStyle: pick(rng, SMILE_STYLES),
    facialAsymmetry: pick(rng, FACIAL_ASYMMETRY),
    faceLengthRatio: pick(rng, FACE_LENGTH_RATIOS),
    foreheadProportion: pick(rng, FOREHEAD_PROPORTIONS),
    facialEnergy: pick(rng, facialEnergies),
    skinTexture: pick(rng, skinTextures),
    earVisibility: pick(rng, EAR_VISIBILITY),
    neckStructure: pick(rng, NECK_STRUCTURES),
    skinUndertone: pick(rng, undertones),
    freckles: pick(rng, freckles),
    hairStyle: trimmedHairOverride ?? sampledHair,
    hairTexture: pick(rng, HAIR_TEXTURES),
    hairDensity: pick(rng, HAIR_DENSITY),
    hairColor: pick(rng, hairColors),
    beardStyle:
      envelope.gender === "male"
        ? (trimmedFacialOverride ?? sampledBeard)
        : (trimmedFacialOverride ?? "clean shaven"),
    build: pick(rng, BUILDS),
    neckLength: pick(rng, NECK_LENGTHS),
    expressionBaseline: pick(rng, EXPRESSIONS),
  };
  return {
    ...traits,
    hash: hashTraits(Object.values(traits)),
  };
}

/**
 * Render the DNA as a "PHYSICAL IDENTITY DETAILS" prompt fragment.
 * Diffusion models honor positive concrete description far better than
 * abstract identity hashes - so we lay out the traits as a single
 * declarative paragraph the model can lock onto.
 */
export function dnaPromptBlock(dna: IdentityDna | null | undefined): string {
  if (!dna) return "";
  return [
    "PHYSICAL IDENTITY DETAILS (lock these traits exactly):",
    `face shape: ${dna.faceShape}; face length ratio: ${dna.faceLengthRatio ?? "balanced classic 1:1"}; face width: ${dna.faceWidth}; forehead: ${dna.foreheadProportion ?? "balanced height with rounded hairline"}; jawline: ${dna.jawline}; chin: ${dna.chinShape}; cheekbones: ${dna.cheekbones}.`,
    `eyes: ${dna.eyes}, ${dna.eyeSpacing}, ${dna.eyeColor} colour; eyebrows: ${dna.eyebrows}, ${dna.browDensity ?? "medium softly filled"} density.`,
    `nose: ${dna.noseBridge} bridge with ${dna.noseProfile}.`,
    `lips: ${dna.lipFullness}; resting expression: ${dna.expressionBaseline}; characteristic smile: ${dna.smileStyle}.`,
    `skin: ${dna.skinUndertone} undertone, ${dna.freckles}; skin micro-texture: ${dna.skinTexture ?? "balanced skin with a subtle natural glow on the cheekbones and nose-bridge"}.`,
    `ears: ${dna.earVisibility ?? "ears fully visible, neutral protrusion"}.`,
    // Task #442 - hairstyle name and facial-hair line removed from the
    // DNA block. The brief-identity clause (front-loaded in master and
    // scene prompts) is now the single authoritative source for the
    // hairstyle / facial-hair axes; repeating them here let the model
    // interpolate between two slightly-different descriptions and was
    // one of the drift vectors behind the 25-32 brief returning a 40+
    // weathered face. The DNA block still carries the texture / density
    // / colour fidelity the brief clause does not.
    `hair: ${dna.hairColor}, ${dna.hairTexture} texture, ${dna.hairDensity} density.`,
    `overall facial energy: ${dna.facialEnergy ?? "balanced and grounded"}.`,
    `build: ${dna.build}; neck length: ${dna.neckLength}; neck structure: ${dna.neckStructure ?? "average columnar neck, soft contour"}; subtle natural facial asymmetry: ${dna.facialAsymmetry}.`,
    "These exact traits must be reproduced consistently across every image of this person. Do not idealize, smooth, or symmetrize - keep the realistic asymmetries and micro-texture above.",
  ].join(" ");
}

/**
 * Count how many traits two DNAs share. Used by the anti-collision pass.
 * Returns an integer 0..N (where N is the number of compared traits).
 */
function dnaTraitOverlap(a: IdentityDna, b: IdentityDna): number {
  let n = 0;
  if (a.faceShape === b.faceShape) n += 1;
  if (a.jawline === b.jawline) n += 1;
  if (a.chinShape === b.chinShape) n += 1;
  if (a.cheekbones === b.cheekbones) n += 1;
  if (a.eyes === b.eyes) n += 1;
  if (a.eyeColor === b.eyeColor) n += 1;
  if (a.eyebrows === b.eyebrows) n += 1;
  if (a.noseBridge === b.noseBridge) n += 1;
  if (a.noseProfile === b.noseProfile) n += 1;
  if (a.lipFullness === b.lipFullness) n += 1;
  if (a.skinUndertone === b.skinUndertone) n += 1;
  if (a.hairStyle === b.hairStyle) n += 1;
  if (a.hairColor === b.hairColor) n += 1;
  if (a.hairTexture === b.hairTexture) n += 1;
  if ((a.beardStyle ?? "clean shaven") === (b.beardStyle ?? "clean shaven")) n += 1;
  if (a.build === b.build) n += 1;
  return n;
}

const COLLISION_TRAIT_THRESHOLD = 8; // out of 15 compared traits
const RECENT_LOOKBACK = 50;
const MAX_REROLLS = 3;

/**
 * Query the most recent influencer jobs for this client (within the same
 * gender / ethnicity / age envelope) and return their stored DNAs.
 */
async function loadRecentDnas(
  clientId: number,
  envelope: DnaEnvelope & { ageRange: string },
): Promise<IdentityDna[]> {
  try {
    const rows = await db.execute<{ dna: IdentityDna | null }>(sql`
      SELECT (prefs -> 'characterProfile' -> 'dna')::jsonb AS dna
      FROM ${aiInfluencerJobsTable}
      WHERE client_id = ${clientId}
        AND prefs ->> 'gender' = ${envelope.gender}
        AND prefs ->> 'ethnicity' = ${envelope.ethnicity}
        AND prefs ->> 'ageRange' = ${envelope.ageRange}
        AND prefs -> 'characterProfile' -> 'dna' IS NOT NULL
      ORDER BY id DESC
      LIMIT ${RECENT_LOOKBACK}
    `);
    const list = (rows as unknown as { rows?: Array<{ dna: IdentityDna | null }> }).rows ?? [];
    return list.map((r) => r.dna).filter((d): d is IdentityDna => !!d && typeof d === "object");
  } catch (err) {
    logger.warn({ err, clientId }, "[identity-dna] loadRecentDnas failed; treating as no collisions");
    return [];
  }
}

/**
 * Generate a DNA candidate and reroll it if it collides with any of
 * this client's recent influencers. Caps at MAX_REROLLS to avoid
 * starving a small demographic envelope.
 */
export async function ensureUniqueIdentityDna(
  clientId: number,
  envelope: DnaEnvelope & { ageRange: string },
): Promise<IdentityDna> {
  const recent = await loadRecentDnas(clientId, envelope);
  let candidate = generateIdentityDna(envelope);
  for (let attempt = 1; attempt <= MAX_REROLLS; attempt += 1) {
    const collision = recent.find((r) => dnaTraitOverlap(candidate, r) >= COLLISION_TRAIT_THRESHOLD);
    if (!collision) {
      logger.info(
        { clientId, attempt, hash: candidate.hash, recentCount: recent.length },
        "[identity-dna] unique DNA generated",
      );
      return candidate;
    }
    logger.warn(
      {
        clientId,
        attempt,
        candidateHash: candidate.hash,
        collidingHash: collision.hash,
        overlap: dnaTraitOverlap(candidate, collision),
        threshold: COLLISION_TRAIT_THRESHOLD,
      },
      "[identity-dna-collision] rerolling DNA",
    );
    candidate = generateIdentityDna(envelope);
  }
  logger.warn(
    { clientId, finalHash: candidate.hash, max: MAX_REROLLS },
    "[identity-dna] reroll cap reached; accepting last candidate",
  );
  return candidate;
}
