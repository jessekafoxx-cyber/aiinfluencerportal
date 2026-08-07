// ─────────────────────────────────────────────────────────────────────────────
// Character profile inference. Pure, server-only. Persisted into the
// `prefs.characterProfile` JSONB on the influencer job at enqueue-time
// so every downstream prompt (Higgsfield master portrait + Gemini scene
// placements + GPT-4o vision QA) reads the same canonical brief.
//
// Per-influencer DNA also seeds the *styling execution* (photography
// variant, fashion variant, lighting variant, camera variant, cinematic
// grade, facial-traits variant, scene tag subset, and wardrobe sub-lane)
// so two users picking identical dropdowns get visibly different
// styling executions while staying inside the same archetype/vibe.
//
// No schema migration — `prefs` is already JSONB.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { AiInfluencerJob } from "@workspace/db";
import {
  inferAestheticBucket,
  selectSubLane,
  type AestheticBucket,
} from "./influencer-wardrobe";
import {
  extractIdentityTraits,
  type ExtractedIdentityTraits,
} from "./influencer-notes-extractor";

export type Archetype =
  | "fitness"
  | "wellness"
  | "fashion"
  | "luxury"
  | "lifestyle"
  | "travel"
  | "business"
  | "tech"
  | "creative"
  | "foodie"
  | "outdoor"
  | "beauty";

export type RealismLevel = "editorial" | "documentary" | "campaign";
export type CinematicStyle = "warm-natural" | "cool-clean" | "moody-cinematic" | "high-key-bright";
export type QualityTier = "premium" | "standard";

export type CharacterProfile = {
  identitySeed: string;
  gender: "female" | "male" | "non_binary";
  ageRange: string;
  ageDescriptor: string;
  ethnicity: string;
  ethnicityDescriptor: string;
  vibe: string;
  notes: string | null;
  /** User-selected facial hair (Generate-modal dropdown). Only meaningful
   *  for male briefs. `null` means the user did not pin a choice and the
   *  DNA sampler may pick something appropriate within the envelope. */
  facialHair: string | null;
  /** User-selected hairstyle (Generate-modal dropdown). `null` means the
   *  DNA sampler picks from the open pool. */
  hairstyle: string | null;
  /** Structured identity traits parsed out of the free-text "Anything else?"
   *  notes field by `influencer-notes-extractor`. Persisted on the profile
   *  so every downstream prompt builder (master, scene swap, strict retry)
   *  and the GPT-4o vision QA can render and verify the same callouts the
   *  user typed (hair colour, eye colour, freckles, tattoos, ...). `null`
   *  when notes was empty or carried no recognised identity callouts. */
  extractedTraits: ExtractedIdentityTraits | null;
  archetype: Archetype;
  scenePreferenceTags: string[];
  photographyStyle: string;
  fashionStyle: string;
  lightingStyle: string;
  cameraStyle: string;
  facialStructureTraits: string;
  skinToneProfile: string;
  hairstyleProfile: string;
  bodyTypeProfile: string;
  realismLevel: RealismLevel;
  cinematicStyle: CinematicStyle;
  qualityTier: QualityTier;
  /**
   * Per-influencer randomized identity traits (jaw, eyes, nose, hair,
   * build, expression, etc.) sampled within the demographic envelope.
   * Two users picking identical dropdowns get distinct DNA so their
   * generated influencers don't collapse to the same archetype face.
   * See `influencer-identity-dna.ts`.
   */
  dna?: import("./influencer-identity-dna").IdentityDna;
  /**
   * Persisted styling-lane and variant ids so the 10-angle wardrobe
   * pipeline, scene placement prompt builder, and QA all read the same
   * canonical styling brief for this influencer. Legacy rows persist
   * none of these and the readOrInferProfile fallback re-derives them
   * lazily from the DNA hash (without persisting).
   */
  aestheticBucket?: AestheticBucket;
  selectedSubLane?: string;
  photographyVariantId?: number;
  fashionVariantId?: number;
  lightingVariantId?: number;
  cameraVariantId?: number;
  cinematicVariantId?: number;
  facialVariantId?: number;
};

function normalizeGender(g: string): "female" | "male" | "non_binary" {
  const v = (g ?? "").toLowerCase().trim();
  if (v === "male" || v === "m") return "male";
  if (v === "non_binary" || v === "non-binary" || v === "nonbinary" || v === "nb" || v === "enby") return "non_binary";
  return "female";
}

// Age descriptors. Young buckets explicitly negate weathered / character-line
// / wrinkle / aged-skin descriptors so the diffusion model does not slide
// up the apparent-age axis (Task #442: a 25-32 male athletic brief was
// resolving to 40+ weathered faces because every layer of the prompt
// stack carried lived-in / weathered language).
// Task #673 - each descriptor is now a sequence of short imperative
// sentences with the upper-bound negations broken out as discrete
// sentences rather than buried in a single comma-separated clause.
// Diffusion models honor discrete imperative sentences far better than
// long comma chains, and the upper-bound guard was the #1 drift vector
// (25-32 briefs landing as 40+ faces).
const AGE_DESCRIPTOR: Record<string, string> = {
  "18-24":
    "early twenties (apparent age 18 to 24). Fresh youthful features. Smooth unmarked skin. No wrinkles. No character lines. No weathering. No aging texture. NOT 30+. NOT 40+.",
  "25-32":
    "late twenties to early thirties (apparent age 25 to 32). Youthful adult features with healthy skin. Smooth even skin with at most very faint expression lines. NOT 40+. No salt-and-pepper hair. No grey streaks. No crow's feet. No deep nasolabial lines. No deep character lines. No weathering. No aging texture. Smooth jaw skin.",
  "33-40":
    "mid to late thirties (apparent age 33 to 40). Refined adult features with subtle natural maturity. At most very fine expression lines. NOT 50+. No deep character lines. No heavy weathering.",
  "41-50":
    "mid to late forties (apparent age 41 to 50). Distinguished adult features with natural maturity and visible but tasteful character lines. NOT 60+. No heavy weathering.",
  "51-65":
    "fifties to early sixties (apparent age 51 to 65). Dignified mature features with natural aging and visible character lines.",
};

const AGED_FACIAL_RE =
  /(weathered|weather-textured|lived-in|sun-?bleached|sun-?weathered|character lines|forehead expression lines|laughter lines|crinkled smile|fine lines|aged skin|aging texture|wrinkles?)/i;

function ageFilteredFacialPool(ageRange: string, pool: string[]): string[] {
  const young = ageRange === "18-24" || ageRange === "25-32";
  if (!young) return pool;
  const filtered = pool.filter((s) => !AGED_FACIAL_RE.test(s));
  // Belt-and-braces: if every entry was filtered (shouldn't happen, but a
  // safety net so we never end up with an empty pool), fall back to the
  // first three entries which by inspection are always young-safe.
  return filtered.length > 0 ? filtered : pool.slice(0, 3);
}

const ETHNICITY_DESCRIPTOR: Record<string, string> = {
  white: "European heritage, fair to medium complexion",
  black: "African heritage, rich deep complexion",
  east_asian: "East Asian heritage, warm porcelain complexion",
  south_asian: "South Asian heritage, warm golden-brown complexion",
  hispanic_latino: "Hispanic / Latino heritage, warm olive-tan complexion",
  middle_eastern: "Middle Eastern heritage, warm olive complexion",
  mixed: "mixed heritage, distinctive multi-ethnic complexion",
};

const SKIN_TONE_BY_ETHNICITY: Record<string, string> = {
  white: "natural skin texture with visible pores, subtle freckling allowed, no plastic smoothing",
  black: "natural rich melanin tone with healthy sheen, visible pores, no ashiness, no plastic smoothing",
  east_asian: "smooth even skin tone with natural luminosity, fine pore structure, no plastic smoothing",
  south_asian: "warm golden undertones, natural pore structure, soft luminous finish, no plastic smoothing",
  hispanic_latino: "warm olive undertones, healthy natural sheen, visible pores, no plastic smoothing",
  middle_eastern: "warm olive-honey undertones, natural pore detail, soft glow, no plastic smoothing",
  mixed: "blended undertones, natural pore structure, healthy luminosity, no plastic smoothing",
};

const HAIR_BY_ETHNICITY: Record<string, string> = {
  white: "natural hair with realistic strand detail and movement",
  black: "natural textured hair with realistic coil/curl pattern and dimensional volume",
  east_asian: "sleek dark hair with natural sheen and individual strand definition",
  south_asian: "thick dark hair with natural wave and rich pigment",
  hispanic_latino: "rich dark hair with natural body and strand definition",
  middle_eastern: "thick lustrous hair with natural movement and depth",
  mixed: "individually expressive hair with natural strand detail",
};

const BODY_BY_GENDER_AGE: Record<string, string> = {
  female: "natural feminine proportions, balanced shoulders to hips, realistic body weight",
  male: "natural masculine proportions, balanced shoulders to torso, realistic body weight",
  non_binary: "natural balanced proportions, realistic body weight",
};

// Archetype inference. Looks at vibe + notes + (lightly) age. Order
// matters: more specific keywords win over generic "lifestyle".
const ARCHETYPE_RULES: Array<{ archetype: Archetype; keywords: RegExp }> = [
  { archetype: "fitness", keywords: /\b(fit|gym|athlet|workout|crossfit|yoga|pilates|run|train|coach|sport|muscle|wellness coach|nutrition coach)\b/i },
  { archetype: "beauty", keywords: /\b(beauty|makeup|skincare|cosmetic|glam|mua|esthet|lash|brow|hair stylist)\b/i },
  { archetype: "wellness", keywords: /\b(wellness|holistic|mindful|meditat|spirit|healer|therap|coach|self.?care|breath)\b/i },
  { archetype: "fashion", keywords: /\b(fashion|model|stylist|outfit|streetwear|designer|runway|editorial)\b/i },
  { archetype: "luxury", keywords: /\b(luxury|high.?end|wealth|elite|exclusive|champagne|yacht|bentley|rolex|hermes)\b/i },
  { archetype: "travel", keywords: /\b(travel|nomad|wanderlust|abroad|destination|jetset|expat|backpack)\b/i },
  { archetype: "business", keywords: /\b(business|founder|ceo|exec|entrepreneur|investor|startup|consult|finance|coach)\b/i },
  { archetype: "tech", keywords: /\b(tech|developer|engineer|coder|ai|saas|product|crypto|web3|builder)\b/i },
  { archetype: "creative", keywords: /\b(creative|artist|design|filmmaker|photograph|musician|writer|director)\b/i },
  { archetype: "foodie", keywords: /\b(food|chef|recipe|cook|restaurant|culinary|bake|barista|cafe)\b/i },
  { archetype: "outdoor", keywords: /\b(outdoor|hike|surf|ski|snowboard|climb|adventure|nature|camp|van life)\b/i },
];

function inferArchetype(vibe: string, notes: string | null): Archetype {
  const haystack = `${vibe} ${notes ?? ""}`;
  for (const rule of ARCHETYPE_RULES) {
    if (rule.keywords.test(haystack)) return rule.archetype;
  }
  return "lifestyle";
}

// Broader per-archetype scene tag pools (12-15 entries) so two
// same-dropdown influencers get a randomized subset + ordering and
// downstream scene placement varies between them.
const SCENE_TAG_POOLS: Record<Archetype, string[]> = {
  fitness: ["gym", "studio", "outdoor-active", "athletic-wear", "morning-routine", "post-workout", "rooftop-track", "park-run", "boxing-gym", "yoga-studio", "kitchen-meal-prep", "stretch-area", "trail-run", "mirror-selfie-gym"],
  wellness: ["spa", "studio-soft", "kitchen-clean", "outdoor-calm", "morning-light", "self-care", "meditation-room", "garden-tea", "yoga-studio", "linen-bedroom", "rooftop-calm", "balcony-tea", "candlelit-bath", "forest-walk"],
  fashion: ["urban-street", "rooftop", "studio-editorial", "boutique", "showroom", "back-of-house", "gallery", "cobblestone-street", "vintage-mirror", "studio-loft", "alley-edgy", "marble-foyer", "atelier", "runway-backstage"],
  luxury: ["penthouse", "yacht", "private-jet", "boutique-suite", "five-star-lobby", "rooftop-bar", "private-club", "champagne-suite", "marble-foyer", "cigar-lounge", "garage-supercar", "estate-garden", "art-collector-suite", "first-class-cabin"],
  lifestyle: ["cafe", "apartment", "urban-walk", "rooftop", "park", "weekend-brunch", "kitchen-warm", "bookstore", "morning-routine", "balcony-coffee", "rooftop-golden-hour", "stylish-bedroom", "studio-apartment", "art-museum"],
  travel: ["airport", "hotel-suite", "scenic-overlook", "european-street", "tropical-resort", "rental-car", "train-window", "boat-deck", "beach-cabana", "cobblestone-cafe", "rooftop-overseas", "vineyard", "mountain-cabin", "souk-market"],
  business: ["office-modern", "co-working", "rooftop-meeting", "boardroom", "podcast-set", "speaker-stage", "skyscraper-window", "executive-suite", "private-lounge", "library-study", "lobby-marble", "press-room", "balcony-city", "fireside-interview"],
  tech: ["co-working", "laptop-cafe", "modern-office", "podcast-set", "studio-clean", "conference", "data-center", "rooftop-laptop", "studio-loft", "warehouse-startup", "demo-day", "monitor-wall", "creator-desk", "library-study"],
  creative: ["studio-loft", "art-gallery", "photo-studio", "urban-edgy", "behind-the-scenes", "rooftop-golden-hour", "atelier", "warehouse-shoot", "gallery-opening", "neon-alley", "concrete-loft", "stage-rehearsal", "vinyl-store", "rooftop-blue-hour"],
  foodie: ["restaurant-warm", "cafe", "kitchen-warm", "market", "bakery", "rooftop-dining", "wine-cellar", "chefs-counter", "farmers-market", "supper-club", "garden-table", "trattoria", "patisserie-window", "pop-up-kitchen"],
  outdoor: ["mountain", "beach", "forest-trail", "lakeside", "campfire", "scenic-overlook", "desert-sunset", "alpine-meadow", "river-crossing", "cliff-edge", "snowy-peak", "canyon-rim", "ocean-cove", "redwood-trail"],
  beauty: ["studio-soft", "vanity-mirror", "boutique", "rooftop-golden-hour", "spa", "selfie-window-light", "linen-bedroom", "marble-bathroom", "skincare-lab", "boudoir-window", "rooftop-pool", "balcony-soft", "studio-beauty-dish", "morning-routine"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-archetype styling-variant pools. Each archetype carries multiple
// on-brand variants for photography / fashion / lighting / camera /
// cinematic / facial-structure. The pool index is sampled from the
// DNA hash so two same-dropdown influencers get different executions
// inside the same archetype.
//
// qualityTier and realismLevel intentionally stay deterministic per
// archetype - they are correctness gates, not style knobs.
// ─────────────────────────────────────────────────────────────────────────────

type StylePools = {
  photography: string[];
  fashion: string[];
  lighting: string[];
  camera: string[];
  cinematic: CinematicStyle[];
  facial: string[];
};

const STYLE_POOLS_BY_ARCHETYPE: Record<Archetype, StylePools> = {
  fitness: {
    photography: [
      "athletic editorial photography, kinetic energy, real-body realism",
      "documentary fitness photography, candid post-workout moments, authentic sweat detail",
      "magazine-grade performance photography, deliberate motion, sculpted hero framing",
      "hybrid editorial-and-lifestyle fitness photography, glossy yet real, balanced energy",
      "athletic campaign photography, controlled studio cleanliness with real athletic intensity",
    ],
    fashion: [
      "premium athleisure, technical fabrics, neutral palette with one bold accent",
      "performance training wardrobe in muted earth tones, technical knits, minimal logo",
      "clean monochrome training fit, fitted tees and joggers, controlled palette",
      "elevated street-athletic wardrobe, performance fabrics with creator-grade tailoring",
      "premium running kit in muted technical tones, layered with a lightweight shell",
    ],
    lighting: [
      "directional gym lighting or golden-hour outdoor light, defined musculature shadowing",
      "soft overcast outdoor light, even fill, real performance atmosphere",
      "low-key studio key with controlled shadow, defined edge light along the silhouette",
      "bright top-down sun with athletic shadow contrast, clean horizon fill",
      "warm sunrise side light, defined catchlights, energetic warmth",
    ],
    camera: [
      "85mm prime, f/2.0, slight low angle, tight framing on subject",
      "50mm prime, f/2.0, mid framing with environmental context",
      "35mm prime, f/2.8, environmental low angle, kinetic crop",
      "85mm prime, f/1.8, eye-level hero crop, sharp focus on the face",
      "70-200mm telephoto compression, f/2.8, isolated subject with blurred backdrop",
    ],
    cinematic: ["warm-natural", "cool-clean", "warm-natural", "moody-cinematic"],
    facial: [
      "defined jawline, healthy cheekbone structure, expressive eyes, natural symmetry",
      "sharp angular jawline, athletic high cheekbones, intent focused gaze, balanced symmetry",
      "softer jawline with healthy fitness glow, warm focused eyes, natural symmetry",
      "broad squared jawline, wide cheekbones, deep-set eyes, weathered athletic character",
      "narrow tapered jawline, sculpted cheekbones, refined nose-bridge, lean athletic features",
      "balanced jawline, mid-height cheekbones, almond eyes with crinkled smile lines, athletic glow",
      "rugged jawline with subtle stubble shadow, broad cheekbones, deep-set narrow eyes, weathered skin texture",
      "youthful sharp jawline, high softly defined cheekbones, bright clear eyes, smooth athletic skin",
      "boxer-broad jawline, dense brows, slightly asymmetric nose, lived-in athletic skin",
      "lean refined jawline, narrow defined cheekbones, wide-set eyes, hint of laughter lines",
    ],
  },
  wellness: {
    photography: [
      "soft documentary wellness photography, calm authentic moments",
      "linen-and-light wellness editorial, quiet considered composition",
      "candid lifestyle wellness photography, slow shutter feel, natural intimacy",
      "minimal magazine-style wellness photography, considered negative space",
      "garden-light wellness photography, gentle storytelling, real human moments",
    ],
    fashion: [
      "natural fibers, linen and cotton, neutral cream and sand palette",
      "soft tonal layered loungewear in oat, ivory and stone, fluid drape",
      "elevated yoga-and-life wardrobe in muted earth tones, fitted knits",
      "minimal linen separates in warm neutrals, considered drape",
      "tonal cashmere-and-linen wellness wardrobe, soft refined palette",
    ],
    lighting: [
      "soft diffused window light, low contrast, gentle shadows",
      "morning golden window light from camera-left, warm linen bounce fill",
      "open shade outdoor light, even cool fill, painterly falloff",
      "candle-and-window blend, warm low-key ambient, soft glow",
      "north-facing window light, controlled cool fill, considered shadow",
    ],
    camera: [
      "50mm prime, f/1.8, eye-level, mid framing with negative space",
      "35mm prime, f/2.0, environmental framing with linen context",
      "85mm prime, f/1.8, intimate tight portrait with soft falloff",
      "50mm prime, f/2.8, calm balanced rule-of-thirds composition",
      "35mm prime, f/2.8, wide environmental wellness scene",
    ],
    cinematic: ["warm-natural", "high-key-bright", "warm-natural", "cool-clean"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "soft refined features, calm grounded expression, gentle warm gaze",
      "balanced symmetrical features with subtle natural asymmetry, serene presence, soft attentive gaze",
      "softly heart-shaped face, gentle high cheekbones, doe-soft eyes, glowing skin texture",
      "softly oval face, low-key brows, full balanced lips, calm meditative gaze",
      "narrow tapered jawline, mid-height cheekbones, almond eyes, light freckle scatter",
      "soft square jawline, balanced cheekbones, hooded warm eyes, lived-in skin with fine laughter lines",
      "long balanced face, refined nose-bridge, full lower lip, dewy natural skin texture",
      "softly diamond face, sculptural cheekbones, wide-set warm eyes, untouched natural skin",
      "rounded soft face, full cheeks, button nose tip, glowing healthy skin",
    ],
  },
  fashion: {
    photography: [
      "editorial fashion photography, magazine-grade composition",
      "high-contrast editorial campaign photography, sculptural framing",
      "documentary fashion-week photography, candid backstage energy",
      "minimal architectural fashion photography, considered negative space",
      "playful editorial fashion photography, bold attitude, graphic framing",
    ],
    fashion: [
      "designer-forward styling, sculptural silhouettes, considered color blocking",
      "monochrome sculptural styling, architectural silhouettes, refined drape",
      "layered tailoring with statement outerwear, controlled tonal palette",
      "elevated streetwear-meets-editorial, mixed proportions, refined cut",
      "silk-and-knit editorial styling, fluid drape, premium textures",
    ],
    lighting: [
      "controlled studio strobe or contrasty street light, defined catchlights",
      "hard editorial key light with deep shadow detail, defined sculpting",
      "soft beauty dish key with bounce fill, even editorial wrap",
      "blue-hour ambient with warm rim, cinematic editorial mood",
      "split lighting, defined shadow on the off-side, dramatic sculpt",
    ],
    camera: [
      "85mm prime, f/1.4, slight low angle, fashion-editorial framing",
      "35mm prime, f/2.0, environmental editorial composition",
      "50mm prime, f/1.8, slightly off-axis editorial portrait",
      "85mm prime, f/2.0, tight beauty-editorial framing",
      "telephoto 105mm, f/2.8, compressed editorial crop",
    ],
    cinematic: ["cool-clean", "moody-cinematic", "high-key-bright", "cool-clean"],
    facial: [
      "balanced symmetrical features, defined cheekbones, expressive eyes, refined nose, well-proportioned lips",
      "high cheekbones, sharp angular jawline, sculptural facial structure, refined nose",
      "soft editorial features, defined cheekbones, expressive almond eyes, balanced lips",
      "long balanced face, narrow tapered jawline, wide-set almond eyes, sculptural nose-bridge",
      "diamond face shape, high prominent cheekbones, downturned soft eyes, full balanced lips",
      "soft heart-shaped face, mid-height cheekbones, doe-eyed wide gaze, full lower lip",
      "rectangular face, broad squared jawline, hooded defined eyes, Roman aquiline nose",
      "narrow oval face, sculpted high cheekbones, monolid defined eyes, refined narrow tip",
      "soft square face, balanced cheekbones, expressive upturned eyes, defined cupid's bow lips",
      "androgynous-leaning features, sharp narrow jawline, narrow defined cheekbones, asymmetric mouth corners",
    ],
  },
  luxury: {
    photography: [
      "high-end campaign photography, polished and aspirational",
      "private-life luxury editorial, intimate aspirational candidness",
      "magazine cover luxury photography, controlled refinement, deliberate restraint",
      "cinematic luxury portrait photography, considered composition, deep shadow detail",
      "documentary luxury photography, real moments inside a refined world",
    ],
    fashion: [
      "tailored luxury wardrobe, neutral and metallic palette, subtle high-end accessories",
      "soft-luxury layered wardrobe in camel, ivory and charcoal, refined drape",
      "monochrome refined wardrobe, sculptural tailoring, considered metallic accent",
      "fluid silk-and-cashmere wardrobe in warm neutrals, premium understated drape",
      "tailored business-luxury wardrobe, considered cut, low-key statement details",
    ],
    lighting: [
      "warm directional rim light over a soft fill, deep shadow detail",
      "low-key chandelier ambient with warm directional key, refined deep shadow",
      "blue-hour soft ambient with warm interior bounce, cinematic restraint",
      "soft window key from camera-left, deep luxury shadow detail",
      "controlled studio key with golden-tinted fill, refined low-key sculpt",
    ],
    camera: [
      "85mm prime, f/1.8, considered low angle, cinematic widescreen framing",
      "50mm prime, f/1.8, calm refined three-quarter framing",
      "35mm prime, f/2.0, environmental luxury composition",
      "85mm prime, f/1.4, intimate refined portrait crop",
      "70-200mm telephoto, f/2.8, compressed cinematic luxury framing",
    ],
    cinematic: ["moody-cinematic", "warm-natural", "moody-cinematic", "cool-clean"],
    facial: [
      "refined balanced features, calm confident expression, soft warm gaze",
      "sculpted refined features, composed attentive expression, intent warm gaze",
      "softly elegant features, quietly amused expression, refined warm gaze",
      "long oval face, narrow tapered jawline, deep-set hooded eyes, Roman aquiline nose, controlled reserved mouth",
      "soft square face, mid-height cheekbones, almond eyes with subtle laughter lines, balanced lips, lived-in skin texture",
      "diamond face shape, high sculptural cheekbones, narrow defined eyes, refined narrow nose tip",
      "rectangular face, broad defined jawline, wide-set composed eyes, straight medium bridge, full lower lip",
      "softly heart-shaped face, gentle high cheekbones, downturned soft eyes, refined narrow nose, soft Mona Lisa smile",
      "narrow oval face, subtle understated jawline, monolid defined eyes, downturned soft mouth, refined skin micro-texture",
      "balanced oval face with subtle nose-bridge deviation, mid-height cheekbones, hooded eyes, full balanced lips, weathered character",
    ],
  },
  lifestyle: {
    photography: [
      "lifestyle editorial photography, candid and aspirational",
      "documentary urban-lifestyle photography, real moments with editorial polish",
      "soft magazine-grade lifestyle photography, considered composition",
      "rooftop golden-hour lifestyle photography, warm storytelling",
      "interior lifestyle editorial, considered styling, intimate framing",
    ],
    fashion: [
      "elevated everyday wardrobe, neutral palette with texture",
      "tonal layered casual wardrobe, soft drape, considered accessory",
      "premium minimalist wardrobe in muted neutrals, fitted basics",
      "creator-grade casual wardrobe, refined fabrics, soft palette",
      "elevated weekend wardrobe, layered knits and tailoring, warm tones",
    ],
    lighting: [
      "natural soft daylight, golden-hour preferred, gentle shadow falloff",
      "open shade urban light, even cool fill, considered shadow",
      "warm tungsten interior with soft window fill, cozy ambient",
      "low-key window light from camera-left, considered shadow detail",
      "bright midday sun with overhang shaded fill, clean lifestyle warmth",
    ],
    camera: [
      "50mm prime, f/2.0, eye-level, balanced rule-of-thirds framing",
      "35mm prime, f/2.0, environmental lifestyle composition",
      "85mm prime, f/2.0, intimate lifestyle portrait crop",
      "50mm prime, f/1.8, slight off-axis lifestyle framing",
      "35mm prime, f/2.8, wide environmental lifestyle scene",
    ],
    cinematic: ["warm-natural", "cool-clean", "warm-natural", "moody-cinematic"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "softly refined features, calm relaxed expression, warm attentive gaze",
      "balanced symmetrical features with subtle natural asymmetry, open friendly expression, gentle gaze",
      "soft oval face, mid-height cheekbones, almond warm eyes, full balanced lips, glowing healthy skin",
      "softly square face, balanced jawline, upturned eyes with smile lines, full lower lip",
      "diamond face shape, sculpted cheekbones, hooded soft eyes, refined narrow nose, lived-in skin",
      "narrow oval face, narrow tapered jawline, wide-set warm eyes, straight medium bridge, soft laughter lines",
      "heart-shaped face, gentle high cheekbones, doe-eyed wide gaze, button soft nose tip, dewy skin",
      "rectangular face, broad rounded jawline, deep-set warm eyes, slightly curved nose-bridge, weathered character",
      "long balanced face, sculpted high cheekbones, downturned soft eyes, full lower lip, light freckle scatter",
    ],
  },
  travel: {
    photography: [
      "destination travel editorial, environment-forward composition",
      "documentary travel photography, candid wayfarer energy",
      "magazine-cover travel editorial, deliberate hero framing",
      "soft golden-hour travel photography, warm wanderlust mood",
      "blue-hour travel editorial, cinematic ambient and rim light",
    ],
    fashion: [
      "elevated travel wardrobe, layered neutrals, signature accessory",
      "linen-and-knit resort wardrobe in warm earth tones, fluid drape",
      "premium jet-set wardrobe in muted refined neutrals, layered tailoring",
      "creator-grade travel wardrobe, technical fabrics with editorial polish",
      "monochrome travel wardrobe, considered drape, refined accessories",
    ],
    lighting: [
      "natural location light, golden hour or bright midday with sky as fill",
      "open-shade tropical light, cool fill with warm sky bounce",
      "low-key cabin light with warm window fill, cinematic warmth",
      "blue-hour ambient with warm rim, cinematic travel atmosphere",
      "directional afternoon sun, sky-bounce fill, warm wanderlust glow",
    ],
    camera: [
      "35mm prime, f/2.8, environmental framing with subject anchored in scene",
      "50mm prime, f/2.0, balanced environmental travel portrait",
      "85mm prime, f/2.0, compressed travel portrait with blurred backdrop",
      "24mm wide, f/2.8, expansive environmental travel scene",
      "35mm prime, f/2.0, candid mid-stride travel framing",
    ],
    cinematic: ["warm-natural", "cool-clean", "warm-natural", "moody-cinematic"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "softly refined features, sun-kissed glow, warm attentive gaze",
      "balanced symmetrical features, wanderlust-curious expression, gentle gaze",
      "weather-textured skin, broad rounded jawline, deep-set narrow eyes, slightly sun-bleached brows",
      "soft oval face, mid-height cheekbones, almond warm eyes, light freckle scatter from sun, balanced lips",
      "diamond face, high sculptural cheekbones, downturned soft eyes, refined narrow nose, lived-in travel-worn skin",
      "narrow tapered jawline, wide-set hazel eyes, slightly curved nose-bridge, full lower lip, weathered character",
      "rectangular face, broad squared jawline, hooded defined eyes, Roman aquiline nose, sun-kissed skin texture",
      "long balanced face, sculpted cheekbones, almond eyes with crinkled smile lines, sun-glow on cheekbones",
      "softly heart-shaped face, gentle high cheekbones, doe-eyed wide gaze, button soft nose tip, dewy traveler glow",
    ],
  },
  business: {
    photography: [
      "executive editorial photography, confident and decisive",
      "documentary founder photography, candid working moments with editorial polish",
      "magazine cover business portrait, deliberate authority framing",
      "podcast-set editorial photography, intimate yet authoritative",
      "minimal architectural business portrait, considered negative space",
    ],
    fashion: [
      "tailored business-casual or modern suiting, refined neutral palette",
      "premium minimalist business wardrobe in monochrome neutrals",
      "layered smart-casual wardrobe, blazer over fitted knit, refined cut",
      "creator-grade business wardrobe, fitted tees with tailored layering",
      "considered tonal business wardrobe in stone, navy, and charcoal",
    ],
    lighting: [
      "clean directional key with soft fill, controlled contrast",
      "low-key window light with cool fill, refined authority shadow",
      "soft beauty dish key with bounce fill, even editorial wrap",
      "warm tungsten interior with controlled fill, cinematic authority",
      "split lighting with controlled shadow, sculpted authority",
    ],
    camera: [
      "85mm prime, f/2.0, slight low angle, authority-forward framing",
      "50mm prime, f/2.0, balanced executive portrait composition",
      "35mm prime, f/2.8, environmental business composition",
      "85mm prime, f/1.8, intimate tight authority crop",
      "70-200mm telephoto, f/2.8, compressed executive framing",
    ],
    cinematic: ["cool-clean", "moody-cinematic", "cool-clean", "warm-natural"],
    facial: [
      "refined balanced features, calm confident expression, soft warm gaze",
      "sharp refined features, intent focused expression, decisive warm gaze",
      "composed balanced features, quietly authoritative expression, warm steady gaze",
      "rectangular face, broad defined jawline, deep-set hooded eyes, Roman aquiline nose, controlled mouth",
      "long oval face, narrow tapered jawline, almond eyes with subtle laughter lines, straight medium bridge",
      "soft square face, mid-height cheekbones, wide-set composed eyes, refined narrow nose tip, defined cupid's bow",
      "diamond face shape, high sculptural cheekbones, narrow defined eyes, refined narrow nose, full lower lip",
      "broad squared face, prominent forward chin, dense brows, monolid defined eyes, weathered authority skin",
      "narrow oval face, subtle understated jawline, downturned soft eyes, slightly curved bridge, balanced lips",
      "softly heart-shaped face, gentle high cheekbones, hooded warm eyes, refined narrow tip, lived-in fine lines",
    ],
  },
  tech: {
    photography: [
      "modern founder editorial, clean and forward-looking",
      "documentary builder photography, candid creative working moments",
      "minimal architectural tech-founder portrait, considered negative space",
      "podcast-set tech editorial, intimate creative authority",
      "magazine cover builder portrait, deliberate hero framing",
    ],
    fashion: [
      "elevated minimalist wardrobe, monochrome neutrals, premium basics",
      "creator-grade tech wardrobe, fitted tees with refined outerwear",
      "tonal layered builder wardrobe, fine knits and minimal tailoring",
      "premium-basic tech wardrobe, considered drape, low-key palette",
      "monochrome smart-casual wardrobe in charcoal, black, and off-white",
    ],
    lighting: [
      "clean window light or controlled studio key, low-key shadow",
      "low-key ambient with controlled rim, refined creative shadow",
      "soft beauty dish key with bounce fill, even editorial wrap",
      "blue-hour ambient with warm interior bounce, cinematic mood",
      "directional window key from camera-left, low-key tech shadow",
    ],
    camera: [
      "50mm prime, f/2.0, eye-level, considered negative space",
      "85mm prime, f/1.8, intimate builder portrait crop",
      "35mm prime, f/2.8, environmental tech-studio composition",
      "50mm prime, f/1.8, slight off-axis creator framing",
      "85mm prime, f/2.0, tight magazine cover framing",
    ],
    cinematic: ["cool-clean", "moody-cinematic", "cool-clean", "warm-natural"],
    facial: [
      "refined balanced features, calm confident expression, soft warm gaze",
      "softly angular features, intent focused expression, thoughtful warm gaze",
      "balanced symmetrical features, quietly curious expression, attentive gaze",
      "long oval face, narrow tapered jawline, hooded thoughtful eyes, refined narrow nose-bridge",
      "soft square face, balanced cheekbones, almond eyes with fine lines, straight medium bridge, balanced lips",
      "diamond face, sculpted cheekbones, monolid defined eyes, refined narrow tip, low-key brow density",
      "narrow oval face, subtle understated jawline, deep-set composed eyes, slightly curved nose-bridge",
      "rectangular face, broad rounded jawline, wide-set warm eyes, soft Mona Lisa smile, lived-in skin texture",
      "softly heart-shaped face, gentle high cheekbones, downturned soft eyes, button soft nose tip, dewy skin",
      "androgynous-leaning narrow face, sharp narrow jawline, narrow defined cheekbones, asymmetric brow line",
    ],
  },
  creative: {
    photography: [
      "documentary creative-portrait photography, expressive and textured",
      "studio-loft creative editorial, considered atmosphere",
      "magazine cover artist portrait, deliberate hero framing",
      "behind-the-scenes creative photography, intimate working moments",
      "high-contrast moody creative editorial, sculpted shadow detail",
    ],
    fashion: [
      "individual signature wardrobe, layered textures, considered details",
      "tonal layered creative wardrobe, knits with statement outerwear",
      "elevated streetwear-meets-editorial creative wardrobe, refined cut",
      "monochrome sculptural creative wardrobe, architectural drape",
      "silk-and-denim editorial-creative wardrobe, fluid premium drape",
    ],
    lighting: [
      "moody directional light, defined shadows, painterly falloff",
      "low-key tungsten ambient with warm directional key, cinematic mood",
      "open-shade studio loft light, soft cool fill, considered shadow",
      "blue-hour ambient with warm rim, cinematic creative atmosphere",
      "split lighting with deep shadow detail, sculpted creative mood",
    ],
    camera: [
      "50mm prime, f/1.8, intimate framing, slight off-axis angle",
      "35mm prime, f/2.0, environmental creative-studio composition",
      "85mm prime, f/1.8, sculpted creative portrait crop",
      "85mm prime, f/2.0, tight magazine-cover creative framing",
      "70-200mm telephoto, f/2.8, compressed creative framing",
    ],
    cinematic: ["moody-cinematic", "cool-clean", "warm-natural", "moody-cinematic"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "sculpted refined features, intent expressive gaze, considered presence",
      "softly textured features, warm creative expression, attentive gaze",
      "long oval face, narrow tapered jawline, deep-set hooded eyes, slightly curved nose-bridge, lived-in skin texture",
      "diamond face shape, high sculptural cheekbones, monolid defined eyes, refined narrow tip, asymmetric mouth",
      "soft square face, balanced cheekbones, downturned soft eyes, full lower lip, fine forehead expression lines",
      "rectangular face, broad rounded jawline, almond eyes with crinkled smile lines, Roman aquiline nose",
      "narrow oval face, subtle understated jawline, wide-set warm eyes, button soft nose tip, dewy textured skin",
      "softly heart-shaped face, gentle high cheekbones, upturned cat-eye gaze, defined cupid's bow lips",
      "androgynous-leaning soft features, sharp narrow jawline, narrow defined cheekbones, asymmetric brow line",
    ],
  },
  foodie: {
    photography: [
      "warm editorial food-and-people photography, sensory and inviting",
      "documentary chef-and-table photography, candid kitchen warmth",
      "magazine cover culinary portrait, deliberate hero framing",
      "kitchen-loft editorial photography, considered composition",
      "supper-club editorial photography, intimate ambient warmth",
    ],
    fashion: [
      "relaxed elevated wardrobe with apron or signature piece, warm earth tones",
      "linen-and-knit kitchen wardrobe in cream, sand, and rust, fluid drape",
      "creator-grade chef wardrobe, refined apron over fitted tee",
      "tonal layered foodie wardrobe in warm earth neutrals, considered drape",
      "premium casual foodie wardrobe, considered apron detail, warm palette",
    ],
    lighting: [
      "warm tungsten or soft window light, golden warmth, gentle shadow",
      "low-key pendant ambient with warm key, cozy kitchen warmth",
      "open-shade outdoor light at a garden table, warm sky-bounce fill",
      "candle-and-tungsten supper-club light, refined low-key warmth",
      "warm window light from camera-left, considered linen bounce fill",
    ],
    camera: [
      "50mm prime, f/2.0, eye-level, environmental framing with kitchen or table context",
      "35mm prime, f/2.0, environmental culinary composition",
      "85mm prime, f/1.8, intimate chef portrait crop",
      "50mm prime, f/1.8, slight off-axis warm framing",
      "85mm prime, f/2.0, tight magazine-cover culinary framing",
    ],
    cinematic: ["warm-natural", "moody-cinematic", "warm-natural", "high-key-bright"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "softly warm features, open inviting expression, gentle attentive gaze",
      "balanced symmetrical features, warm focused chef gaze, considered presence",
      "soft oval face, mid-height cheekbones, almond warm eyes, full lower lip, kitchen-glow skin",
      "softly square face, balanced jawline, hooded warm eyes, refined narrow tip, fine laughter lines",
      "broad rounded face, full cheeks, button soft nose tip, full balanced lips, glowing healthy skin",
      "long balanced face, narrow tapered jawline, wide-set warm eyes, slightly curved nose-bridge",
      "soft heart-shaped face, gentle high cheekbones, doe-eyed wide gaze, full lower lip, dewy skin",
      "diamond face shape, sculpted cheekbones, almond eyes with crinkled smile lines, refined narrow nose",
      "rectangular face, broad rounded jawline, deep-set warm eyes, dense brows, lived-in chef character",
    ],
  },
  outdoor: {
    photography: [
      "outdoor adventure editorial, natural and expansive",
      "documentary outdoor photography, candid expedition moments",
      "magazine cover outdoor portrait, deliberate environmental hero framing",
      "alpine-light outdoor editorial, considered atmosphere",
      "campfire-and-blue-hour outdoor editorial, cinematic warmth",
    ],
    fashion: [
      "performance outdoor wardrobe, technical layers, earth-tone palette",
      "elevated mountain wardrobe, fleece and shell layering in muted earth tones",
      "tonal trail wardrobe in olive, rust, and stone, refined technical drape",
      "creator-grade outdoor wardrobe, technical fabrics with editorial polish",
      "premium hiking wardrobe, fitted base layers under shell outerwear",
    ],
    lighting: [
      "natural location light, golden hour or overcast diffuse, real environmental fill",
      "open-shade alpine light, cool environmental fill, considered shadow",
      "blue-hour ambient with warm campfire bounce, cinematic mood",
      "directional sunrise light, defined catchlights, energetic warmth",
      "high-altitude bright sun with sky-bounce fill, clean outdoor warmth",
    ],
    camera: [
      "35mm prime, f/2.8, environmental framing with landscape context",
      "24mm wide, f/2.8, expansive environmental outdoor scene",
      "50mm prime, f/2.0, balanced environmental outdoor portrait",
      "85mm prime, f/2.0, compressed outdoor portrait with blurred landscape",
      "35mm prime, f/2.0, candid mid-stride trail framing",
    ],
    cinematic: ["warm-natural", "cool-clean", "moody-cinematic", "warm-natural"],
    facial: [
      "natural balanced features, warm authentic expression, friendly approachable gaze",
      "sun-weathered refined features, intent focused gaze, considered outdoor presence",
      "softly resilient features, warm attentive gaze, considered presence",
      "rectangular face, broad squared jawline, deep-set narrow eyes, slightly curved bridge, weathered alpine skin",
      "long balanced face, sculpted high cheekbones, almond eyes with crinkled smile lines, sun-bleached brows",
      "soft square face, balanced cheekbones, hooded resilient eyes, refined narrow nose, sun-textured cheeks",
      "broad rounded face, full cheeks, button soft nose tip, light freckle scatter from sun, dense brows",
      "diamond face shape, sharply defined cheekbones, downturned focused eyes, Roman aquiline nose, lived-in skin",
      "narrow tapered jawline, wide-set warm eyes, prominent forward chin, weathered character lines",
      "androgynous-leaning outdoor face, sharp narrow jawline, narrow defined cheekbones, asymmetric mouth corners",
    ],
  },
  beauty: {
    photography: [
      "beauty editorial photography, skin-and-feature forward composition",
      "magazine cover beauty portrait, deliberate hero framing",
      "documentary beauty photography, candid intimate moments",
      "studio beauty-dish editorial, considered controlled composition",
      "linen-bedroom beauty editorial, soft intimate ambient",
    ],
    fashion: [
      "minimal styling, focus on skin and features, luxurious texture",
      "tonal silk-and-knit beauty wardrobe, fluid premium drape",
      "monochrome refined beauty wardrobe, considered drape, premium texture",
      "creator-grade beauty wardrobe, fitted tonal basics, refined accessory",
      "soft-luxury beauty wardrobe, fluid silk top in warm neutral",
    ],
    lighting: [
      "soft beauty dish or large window with bounce, even flattering light, defined catchlights",
      "ring light with controlled bounce fill, even high-key beauty wrap",
      "low-key window key with deep shadow detail, refined editorial sculpt",
      "soft north-facing window light, cool fill, considered beauty shadow",
      "split lighting with controlled shadow, sculpted beauty editorial",
    ],
    camera: [
      "85mm prime, f/2.8, eye-level, tight beauty framing",
      "85mm prime, f/2.0, intimate beauty portrait crop",
      "105mm prime, f/2.8, compressed beauty crop",
      "50mm prime, f/2.0, slightly off-axis beauty framing",
      "85mm prime, f/1.8, tight magazine-cover beauty framing",
    ],
    cinematic: ["high-key-bright", "cool-clean", "moody-cinematic", "high-key-bright"],
    facial: [
      "balanced symmetrical features, defined cheekbones, expressive eyes, refined nose, well-proportioned lips",
      "softly luminous features, expressive almond eyes, refined balanced lips",
      "sculpted refined features, defined cheekbones, soft attentive gaze",
      "long oval face, narrow tapered jawline, wide-set doe-eyed gaze, refined narrow nose, full balanced lips",
      "diamond face shape, high sculptural cheekbones, upturned cat-eye gaze, defined cupid's bow lips",
      "softly heart-shaped face, gentle high cheekbones, hooded soft eyes, full lower lip, dewy luminous skin",
      "soft square face, balanced cheekbones, almond eyes with subtle laughter lines, button soft nose tip",
      "narrow oval face, subtle understated jawline, downturned soft eyes, refined narrow tip, defined cupid's bow",
      "rectangular face, broad rounded jawline, monolid defined eyes, refined narrow nose, full balanced lips",
      "androgynous-leaning soft features, narrow defined cheekbones, asymmetric mouth corners, glowing micro-texture skin",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DNA-seeded variant samplers. All seeded off the DNA hash with
// per-axis salts so the photo / fashion / lighting / camera variants
// are NOT identical indices.
// ─────────────────────────────────────────────────────────────────────────────

function hashSalt(seed: string, salt: string): number {
  const h = crypto.createHash("sha256").update(`${seed}|${salt}`).digest("hex");
  return parseInt(h.slice(0, 8), 16) >>> 0;
}

function pickIndex(seed: string, salt: string, size: number): number {
  if (size <= 1) return 0;
  return hashSalt(seed, salt) % size;
}

function pickSceneTagSubset(seed: string, pool: string[], take: number): string[] {
  // Deterministic Fisher-Yates seeded by salted hash, then slice the
  // first `take` entries. Provides a per-influencer randomized subset
  // and order from the broader scene-tag pool.
  let state = hashSalt(seed, "scene-tags");
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(take, a.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// Build / read profile
// ─────────────────────────────────────────────────────────────────────────────

export function buildCharacterProfile(prefs: AiInfluencerJob["prefs"]): CharacterProfile {
  const vibe = (prefs.vibe ?? "").trim();
  const notes = prefs.notes?.trim() || null;
  const extPrefs = prefs as AiInfluencerJob["prefs"] & {
    facialHair?: string | null;
    hairstyle?: string | null;
  };
  const pinnedFacialHair = (extPrefs.facialHair ?? "").trim() || null;
  const pinnedHairstyle = (extPrefs.hairstyle ?? "").trim() || null;
  // Smart-extract structured identity traits from the free-text notes
  // field. When the user did NOT pin a facialHair / hairstyle dropdown
  // value but the notes carry a recognisable callout ("slight beard",
  // "quiff hairstyle"), fold the extracted canonical value into the
  // profile so the DNA sampler, master prompt, scene swaps, retry
  // prompts and QA all converge on the same value. Dropdown picks
  // always win - the notes are a smart override layer, not a replacement
  // for an explicit user choice.
  const extractedTraits = extractIdentityTraits(notes);
  const facialHair = pinnedFacialHair ?? extractedTraits?.facialHair ?? null;
  const hairstyle = pinnedHairstyle ?? extractedTraits?.hairstyle ?? null;
  const archetype = inferArchetype(vibe, notes);
  const ageDescriptor = AGE_DESCRIPTOR[prefs.ageRange] ?? prefs.ageRange;
  const ethnicityDescriptor = ETHNICITY_DESCRIPTOR[prefs.ethnicity] ?? prefs.ethnicity;
  const skinToneProfile = SKIN_TONE_BY_ETHNICITY[prefs.ethnicity] ?? "natural skin texture with visible pores";
  const hairstyleProfile = HAIR_BY_ETHNICITY[prefs.ethnicity] ?? "natural hair with realistic strand detail";
  const bodyTypeProfile = BODY_BY_GENDER_AGE[prefs.gender] ?? "natural balanced proportions";

  // Stable identity seed so repeat generations of the same job share a
  // derivable hash for downstream identity-fidelity logging.
  const identitySeed = crypto
    .createHash("sha256")
    .update(`${prefs.gender}|${prefs.ethnicity}|${prefs.ageRange}|${vibe}|${notes ?? ""}`)
    .digest("hex")
    .slice(0, 16);

  // Premium tier when archetype carries a luxury / editorial expectation
  // or vibe contains explicit premium signals. Standard otherwise.
  const premiumKw = /\b(luxury|premium|high.?end|editorial|magazine|campaign|elite|exclusive)\b/i;
  const qualityTier: QualityTier =
    archetype === "luxury" || archetype === "fashion" || archetype === "beauty" || premiumKw.test(`${vibe} ${notes ?? ""}`)
      ? "premium"
      : "standard";

  // Realism level: editorial portraits for fashion/beauty/luxury (more
  // posed, more polish), documentary for wellness/foodie/outdoor (real
  // candid moments), campaign for everything else (in-between).
  const realismLevel: RealismLevel =
    archetype === "fashion" || archetype === "beauty" || archetype === "luxury"
      ? "editorial"
      : archetype === "wellness" || archetype === "foodie" || archetype === "outdoor"
        ? "documentary"
        : "campaign";

  return applyDnaSampledStyle(
    {
      identitySeed,
      gender: normalizeGender(prefs.gender),
      ageRange: prefs.ageRange,
      ageDescriptor,
      ethnicity: prefs.ethnicity,
      ethnicityDescriptor,
      vibe,
      notes,
      facialHair,
      hairstyle,
      extractedTraits,
      archetype,
      // Placeholders - filled by applyDnaSampledStyle below.
      scenePreferenceTags: [],
      photographyStyle: "",
      fashionStyle: "",
      lightingStyle: "",
      cameraStyle: "",
      facialStructureTraits: "",
      skinToneProfile,
      hairstyleProfile,
      bodyTypeProfile,
      realismLevel,
      cinematicStyle: "warm-natural",
      qualityTier,
    },
    // dna may be missing at first build (collision check assigns it
    // later) - applyDnaSampledStyle handles that and falls back to
    // identitySeed so the same job re-resolves consistently.
    null,
  );
}

/**
 * Compute the styling-variant fields (subLane, photographyStyle,
 * fashionStyle, etc.) for `profile` using a DNA-derived seed. Pure -
 * returns a new profile object with the fields populated. Safe to call
 * with or without DNA persisted (falls back to identitySeed).
 *
 * The `pinned` argument lets the legacy fallback re-render lazily with
 * the SAME variant ids it would have persisted on a fresh build, so
 * old rows render stably across processes.
 */
export function applyDnaSampledStyle(
  base: CharacterProfile,
  pinned: {
    aestheticBucket?: AestheticBucket;
    selectedSubLane?: string;
    photographyVariantId?: number;
    fashionVariantId?: number;
    lightingVariantId?: number;
    cameraVariantId?: number;
    cinematicVariantId?: number;
    facialVariantId?: number;
  } | null,
): CharacterProfile {
  const seedSource = base.dna?.hash ?? base.identitySeed;
  const pools = STYLE_POOLS_BY_ARCHETYPE[base.archetype];
  // Filter the facial-structure pool for young age buckets so a 25-32
  // brief can never land on a "weathered athletic character" / "lived-in
  // skin" entry. The filter is a no-op for older age buckets.
  const filteredFacial = ageFilteredFacialPool(base.ageRange, pools.facial);

  const photoIdx = pinned?.photographyVariantId ?? pickIndex(seedSource, "photo", pools.photography.length);
  const fashionIdx = pinned?.fashionVariantId ?? pickIndex(seedSource, "fashion", pools.fashion.length);
  const lightingIdx = pinned?.lightingVariantId ?? pickIndex(seedSource, "lighting", pools.lighting.length);
  const cameraIdx = pinned?.cameraVariantId ?? pickIndex(seedSource, "camera", pools.camera.length);
  const cinematicIdx = pinned?.cinematicVariantId ?? pickIndex(seedSource, "cinematic", pools.cinematic.length);
  const rawFacialIdx =
    pinned?.facialVariantId ?? pickIndex(seedSource, "facial", filteredFacial.length);
  // Clamp persisted indices (which may have been computed against the
  // unfiltered pool on a legacy row) into the filtered pool's range.
  const facialIdx = filteredFacial.length > 0 ? rawFacialIdx % filteredFacial.length : 0;

  const bucket =
    pinned?.aestheticBucket ?? inferAestheticBucket({ ...base, scenePreferenceTags: [] } as CharacterProfile);
  const subLane = selectSubLane(bucket, seedSource, pinned?.selectedSubLane);

  const scenePool = SCENE_TAG_POOLS[base.archetype];
  const scenePreferenceTags = pickSceneTagSubset(seedSource, scenePool, 6);

  return {
    ...base,
    aestheticBucket: bucket,
    selectedSubLane: subLane,
    photographyVariantId: photoIdx,
    fashionVariantId: fashionIdx,
    lightingVariantId: lightingIdx,
    cameraVariantId: cameraIdx,
    cinematicVariantId: cinematicIdx,
    facialVariantId: facialIdx,
    photographyStyle: pools.photography[photoIdx],
    fashionStyle: pools.fashion[fashionIdx],
    lightingStyle: pools.lighting[lightingIdx],
    cameraStyle: pools.camera[cameraIdx],
    cinematicStyle: pools.cinematic[cinematicIdx],
    facialStructureTraits: filteredFacial[facialIdx] ?? pools.facial[facialIdx % pools.facial.length],
    scenePreferenceTags,
  };
}

/** Read the persisted profile from a job's prefs, computing a fresh
 *  one (without persisting) as a fallback for legacy rows. Legacy rows
 *  may not have `dna` or styling-variant ids yet - we lazily synthesize
 *  both (without persisting) so every prompt builder downstream sees a
 *  populated brief. Mirrors the existing fallback pattern for `dna`. */
export function readOrInferProfile(prefs: AiInfluencerJob["prefs"]): CharacterProfile {
  const stored = (prefs as { characterProfile?: CharacterProfile } | undefined)?.characterProfile;
  if (stored && typeof stored === "object" && stored.identitySeed) {
    let profile: CharacterProfile = stored;
    if (!profile.dna) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateIdentityDna } = require("./influencer-identity-dna") as typeof import("./influencer-identity-dna");
      profile = {
        ...profile,
        dna: generateIdentityDna(
          {
            gender: profile.gender,
            ethnicity: profile.ethnicity,
            ageRange: profile.ageRange,
            facialHair: profile.facialHair ?? null,
            hairstyle: profile.hairstyle ?? null,
          },
          profile.identitySeed,
        ),
      };
    }
    // Legacy rows that predate the styling-variant fields, or partially-
    // populated rows where some variants are persisted but others are
    // missing: lazily re-derive any missing fields from the DNA hash so
    // the same row renders the same lane / photo / lighting / etc.
    // variant on every read. Pinned (already-set) values are preserved.
    if (
      profile.selectedSubLane === undefined ||
      profile.photographyVariantId === undefined ||
      profile.fashionVariantId === undefined ||
      profile.lightingVariantId === undefined ||
      profile.cameraVariantId === undefined ||
      profile.cinematicVariantId === undefined ||
      profile.facialVariantId === undefined ||
      profile.aestheticBucket === undefined
    ) {
      profile = applyDnaSampledStyle(profile, {
        aestheticBucket: profile.aestheticBucket,
        selectedSubLane: profile.selectedSubLane,
        photographyVariantId: profile.photographyVariantId,
        fashionVariantId: profile.fashionVariantId,
        lightingVariantId: profile.lightingVariantId,
        cameraVariantId: profile.cameraVariantId,
        cinematicVariantId: profile.cinematicVariantId,
        facialVariantId: profile.facialVariantId,
      });
    }
    return profile;
  }
  return buildCharacterProfile(prefs);
}
