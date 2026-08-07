// ─────────────────────────────────────────────────────────────────────────────
// Code-first scene template library. Curated cinematic placements that
// describe (in cinematography language) where the master portrait should
// be re-staged. Each template knows which archetypes it suits, how the
// camera/lens/lighting should behave, and exposes a `prompt(profile)`
// builder so per-archetype detail can flavor the scene description
// without inventing new identity facts.
//
// This library AUGMENTS the existing Drive-backed `ai_influencer_scenes`
// catalog: the Drive scene supplies a stable reference image; this
// template attaches code-side metadata + cinematic prompt guidance that
// pickScenesForProfile uses to choose and prompt them.
//
// Migration path: once we want DB-backed templates, move SCENE_TEMPLATES
// into a table; the loader signature stays the same.
// ─────────────────────────────────────────────────────────────────────────────

import type { Archetype, CharacterProfile } from "./influencer-character";

export type SceneCategory =
  | "indoor-luxury"
  | "indoor-warm"
  | "indoor-clean"
  | "outdoor-urban"
  | "outdoor-nature"
  | "studio"
  | "transit"
  | "active";

export type PlacementZone =
  | "centered"
  | "rule-of-thirds-left"
  | "rule-of-thirds-right"
  | "environmental-wide"
  | "tight-portrait";

export type GenderHint = "any" | "female" | "male";

export type SceneTemplate = {
  id: string;
  label: string;
  category: SceneCategory;
  nicheAffinity: Archetype[];
  environmentType: string;
  cameraAngle: string;
  lensMm: number;
  lightingStyle: string;
  aestheticTags: string[];
  placementZone: PlacementZone;
  realismScore: number; // 0..1 — how unposed/candid vs editorial
  genderHint: GenderHint;
  /** Per-scene cinematic guidance. Keep this DESCRIPTIVE (camera, light,
   *  composition, environment) — identity facts come from the profile. */
  prompt: (p: CharacterProfile) => string;
};

const T = (t: SceneTemplate): SceneTemplate => t;

export const SCENE_TEMPLATES: SceneTemplate[] = [
  T({
    id: "cafe-window-morning",
    label: "Cafe Window, Morning",
    category: "indoor-warm",
    nicheAffinity: ["lifestyle", "creative", "tech", "business", "wellness", "foodie"],
    environmentType: "warm specialty coffee shop interior, exposed wood, ceramic mug on table",
    cameraAngle: "eye-level, slight three-quarter angle on subject",
    lensMm: 50,
    lightingStyle: "soft window light from camera-left, warm golden ambient fill, gentle shadow",
    aestheticTags: ["warm", "morning", "candid", "cafe"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject seated at a warm specialty coffee shop near a sunlit window, ceramic mug in hand. ` +
      `Soft window light from camera-left wraps the face; warm interior ambient as fill. ` +
      `Background: tasteful out-of-focus cafe interior with warm wood and brass accents (no recognizable brand logos). ` +
      `Camera: ${p.cameraStyle}, eye-level with a slight three-quarter angle. Vertical 9:16 framing. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "rooftop-golden-hour",
    label: "Rooftop, Golden Hour",
    category: "outdoor-urban",
    nicheAffinity: ["lifestyle", "fashion", "luxury", "business", "creative", "beauty"],
    environmentType: "modern city rooftop terrace at golden hour, distant skyline soft-blurred",
    cameraAngle: "slight low angle, hero framing",
    lensMm: 85,
    lightingStyle: "golden-hour back/rim light, warm key from camera-right, defined catchlights",
    aestheticTags: ["golden-hour", "urban", "premium", "rooftop"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a modern city rooftop at golden hour, soft-blurred skyline behind. ` +
      `Warm rim light from behind catches hair edges; soft key light wraps the face. ` +
      `Camera: ${p.cameraStyle}, slight low angle, hero framing. Vertical 9:16 portrait. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "modern-office-window",
    label: "Modern Office, Window Light",
    category: "indoor-clean",
    nicheAffinity: ["business", "tech", "creative"],
    environmentType: "minimalist modern office, large window, neutral palette, leather chair",
    cameraAngle: "eye-level, three-quarter angle",
    lensMm: 50,
    lightingStyle: "clean north-facing window light, soft fill, controlled contrast",
    aestheticTags: ["clean", "executive", "modern", "office"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.75,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a minimalist modern office beside a large window, neutral architectural palette. ` +
      `Clean north-facing window light models the face with soft fill; controlled contrast. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter angle. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "co-working-laptop",
    label: "Co-Working, Laptop",
    category: "indoor-clean",
    nicheAffinity: ["tech", "business", "creative"],
    environmentType: "premium co-working lounge, leather and oak, laptop on table",
    cameraAngle: "eye-level, slight off-axis",
    lensMm: 50,
    lightingStyle: "soft daylight from camera-left, warm interior fill",
    aestheticTags: ["work", "lounge", "candid", "tech"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject working at a laptop in a premium co-working lounge with leather and oak finishes. ` +
      `Soft daylight from camera-left, warm interior fill. ` +
      `Camera: ${p.cameraStyle}, eye-level slight off-axis. Vertical 9:16 framing. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "podcast-studio",
    label: "Podcast Studio",
    category: "studio",
    nicheAffinity: ["business", "tech", "creative", "wellness"],
    environmentType: "professional podcast set, condenser mic on boom arm, warm wood-paneled wall",
    cameraAngle: "eye-level three-quarter, mic in foreground",
    lensMm: 50,
    lightingStyle: "warm tungsten key from camera-right, soft fill, deep wood-tone background",
    aestheticTags: ["podcast", "warm", "intentional", "studio"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject seated on a professional podcast set; condenser microphone on boom arm in foreground. ` +
      `Warm tungsten key from camera-right with soft fill against a deep wood-paneled background. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter framing. Vertical 9:16 portrait. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "boardroom-confident",
    label: "Boardroom, Confident",
    category: "indoor-luxury",
    nicheAffinity: ["business", "luxury", "tech"],
    environmentType: "executive boardroom, glass walls, city view soft-blurred behind",
    cameraAngle: "slight low angle, authority framing",
    lensMm: 85,
    lightingStyle: "directional key with controlled shadow, soft cool fill from window",
    aestheticTags: ["executive", "premium", "city", "boardroom"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.65,
    genderHint: "any",
    prompt: (p) =>
      `Subject standing in an executive boardroom; glass walls reveal a soft-blurred city view. ` +
      `Directional key light models the face with controlled shadow; soft cool fill from the window side. ` +
      `Camera: ${p.cameraStyle}, slight low angle for authority framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "luxury-penthouse",
    label: "Luxury Penthouse",
    category: "indoor-luxury",
    nicheAffinity: ["luxury", "fashion", "lifestyle", "business"],
    environmentType: "high-floor luxury penthouse interior, marble and brass, floor-to-ceiling windows",
    cameraAngle: "low angle, cinematic widescreen feel",
    lensMm: 85,
    lightingStyle: "warm rim from window, soft directional key, deep shadow detail",
    aestheticTags: ["luxury", "premium", "penthouse", "marble"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.6,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a high-floor luxury penthouse interior with marble flooring and brass accents; ` +
      `floor-to-ceiling windows behind reveal a soft-blurred premium skyline. ` +
      `Warm rim light from window, soft directional key, deep shadow detail. ` +
      `Camera: ${p.cameraStyle}, low angle, cinematic feel. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "five-star-lobby",
    label: "Five-Star Hotel Lobby",
    category: "indoor-luxury",
    nicheAffinity: ["luxury", "travel", "fashion", "business"],
    environmentType: "five-star hotel lobby, soft-glow chandelier, marble floor, velvet seating",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm chandelier ambient, soft directional fill, gentle warm reflections",
    aestheticTags: ["hotel", "luxury", "warm", "premium"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a five-star hotel lobby; warm chandelier ambient, marble floor, velvet seating soft-blurred. ` +
      `Soft directional fill on the face, gentle warm reflections. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "gym-strength-floor",
    label: "Gym Strength Floor",
    category: "active",
    nicheAffinity: ["fitness", "wellness"],
    environmentType: "modern gym strength floor, racks soft-blurred, rubber matting",
    cameraAngle: "slight low angle, kinetic framing",
    lensMm: 50,
    lightingStyle: "directional gym key light with cool fill, defined shadow on physique",
    aestheticTags: ["fitness", "athletic", "kinetic", "gym"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a modern gym strength floor; racks softly blurred, rubber matting underfoot. ` +
      `Directional gym key with cool fill defines musculature with realistic shadow. ` +
      `Camera: ${p.cameraStyle}, slight low angle, kinetic framing. Vertical 9:16. ` +
      `Wardrobe: premium athleisure consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "yoga-studio-morning",
    label: "Yoga Studio, Morning",
    category: "active",
    nicheAffinity: ["wellness", "fitness", "beauty"],
    environmentType: "minimalist yoga studio, hardwood floor, soft natural light through tall windows",
    cameraAngle: "eye-level, balanced composition",
    lensMm: 50,
    lightingStyle: "soft diffused window light, warm wood reflection, gentle shadow",
    aestheticTags: ["yoga", "calm", "wellness", "morning"],
    placementZone: "centered",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a minimalist yoga studio at morning; hardwood floor, tall windows behind. ` +
      `Soft diffused window light wraps the figure; warm wood reflection as fill. ` +
      `Camera: ${p.cameraStyle}, eye-level balanced composition. Vertical 9:16. ` +
      `Wardrobe: refined wellness wear consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "outdoor-running-trail",
    label: "Outdoor Running Trail",
    category: "active",
    nicheAffinity: ["fitness", "outdoor", "wellness"],
    environmentType: "tree-lined park trail, morning mist, dappled sunlight",
    cameraAngle: "eye-level, mid-stride",
    lensMm: 50,
    lightingStyle: "natural morning sunlight through trees, golden warmth, motion realism",
    aestheticTags: ["outdoor", "active", "morning", "running"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject running on a tree-lined park trail at morning; dappled sunlight through canopy. ` +
      `Natural morning warmth, gentle motion realism, real environmental fill. ` +
      `Camera: ${p.cameraStyle}, eye-level mid-stride. Vertical 9:16. ` +
      `Wardrobe: technical running wear consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "kitchen-warm-cooking",
    label: "Warm Kitchen, Cooking",
    category: "indoor-warm",
    nicheAffinity: ["foodie", "lifestyle", "wellness"],
    environmentType: "warm modern kitchen, marble counter, copper cookware, soft pendant lighting",
    cameraAngle: "eye-level three-quarter, hands engaged",
    lensMm: 50,
    lightingStyle: "warm pendant key, soft window fill, golden ambient",
    aestheticTags: ["kitchen", "warm", "cooking", "candid"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a warm modern kitchen, marble counter and copper cookware visible, hands engaged with food prep. ` +
      `Warm pendant key with soft window fill, golden ambient. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "restaurant-warm-table",
    label: "Warm Restaurant Table",
    category: "indoor-warm",
    nicheAffinity: ["foodie", "luxury", "lifestyle"],
    environmentType: "intimate restaurant interior, warm pendant glow, plated dish on table",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm pendant key from above, gentle ambient bounce",
    aestheticTags: ["restaurant", "warm", "intimate", "dining"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject seated at an intimate restaurant table; warm pendant glow above, plated dish softly visible. ` +
      `Warm pendant key, gentle ambient bounce. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "boutique-shopping",
    label: "Boutique, Shopping",
    category: "indoor-warm",
    nicheAffinity: ["fashion", "luxury", "beauty", "lifestyle"],
    environmentType: "high-end boutique interior, racks soft-blurred, warm pendant lighting",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm pendant key, soft fill, premium boutique ambient",
    aestheticTags: ["boutique", "fashion", "shopping", "warm"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.75,
    genderHint: "any",
    prompt: (p) =>
      `Subject inside a high-end boutique; racks soft-blurred behind, warm pendant lighting. ` +
      `Warm pendant key, soft fill, premium boutique ambient. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "studio-editorial-portrait",
    label: "Studio Editorial Portrait",
    category: "studio",
    nicheAffinity: ["fashion", "beauty", "luxury", "creative"],
    environmentType: "professional photo studio, seamless neutral backdrop",
    cameraAngle: "eye-level, slight off-axis editorial framing",
    lensMm: 85,
    lightingStyle: "controlled studio strobe with beauty dish key and soft fill, defined catchlights",
    aestheticTags: ["studio", "editorial", "polished", "portrait"],
    placementZone: "centered",
    realismScore: 0.55,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a professional photo studio against a seamless neutral backdrop. ` +
      `Beauty-dish key with soft fill, defined catchlights, deliberate shadow detail. ` +
      `Camera: ${p.cameraStyle}, eye-level slight off-axis editorial framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "studio-soft-beauty",
    label: "Soft Beauty Studio",
    category: "studio",
    nicheAffinity: ["beauty", "fashion", "wellness"],
    environmentType: "soft beauty set, large diffuser, neutral cream backdrop",
    cameraAngle: "eye-level, tight beauty framing",
    lensMm: 85,
    lightingStyle: "large beauty dish key with bounce fill, even flattering wrap",
    aestheticTags: ["beauty", "skin", "soft", "studio"],
    placementZone: "centered",
    realismScore: 0.55,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a soft beauty set; large diffuser, neutral cream backdrop. ` +
      `Beauty-dish key with bounce fill, even flattering wrap, defined catchlights. ` +
      `Camera: ${p.cameraStyle}, eye-level tight beauty framing. Vertical 9:16. ` +
      `Skin: ${p.skinToneProfile}.`,
  }),
  T({
    id: "art-gallery-quiet",
    label: "Art Gallery, Quiet",
    category: "indoor-clean",
    nicheAffinity: ["creative", "fashion", "luxury", "lifestyle"],
    environmentType: "minimalist art gallery, white walls, soft directional spot lighting",
    cameraAngle: "eye-level, considered negative space",
    lensMm: 50,
    lightingStyle: "directional gallery spots, soft ambient bounce, gentle shadow",
    aestheticTags: ["gallery", "minimal", "considered", "art"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a minimalist art gallery; white walls, abstract art softly visible behind. ` +
      `Directional gallery spot light models the face; soft ambient bounce as fill. ` +
      `Camera: ${p.cameraStyle}, eye-level with considered negative space. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "studio-loft-creative",
    label: "Studio Loft, Creative",
    category: "indoor-warm",
    nicheAffinity: ["creative", "fashion", "tech"],
    environmentType: "loft creative studio, exposed brick, large windows, drafting elements",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "large window key from camera-left, warm interior fill",
    aestheticTags: ["loft", "creative", "warm", "studio"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a loft creative studio; exposed brick, large windows, drafting elements behind. ` +
      `Large window key from camera-left, warm interior fill. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "urban-street-walk",
    label: "Urban Street Walk",
    category: "outdoor-urban",
    nicheAffinity: ["fashion", "lifestyle", "creative", "luxury", "travel"],
    environmentType: "premium urban street, modern architecture, daytime city ambient",
    cameraAngle: "eye-level, mid-stride",
    lensMm: 50,
    lightingStyle: "natural daylight, soft shadow side, considered shaded fill",
    aestheticTags: ["urban", "street", "candid", "fashion"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject mid-stride on a premium urban street; modern architecture soft-blurred behind. ` +
      `Natural daylight, soft shadow side, considered shaded fill on the face. ` +
      `Camera: ${p.cameraStyle}, eye-level mid-stride. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "european-cobblestone",
    label: "European Cobblestone Street",
    category: "outdoor-urban",
    nicheAffinity: ["travel", "fashion", "luxury", "lifestyle"],
    environmentType: "european old town cobblestone street, soft-blurred ochre buildings",
    cameraAngle: "eye-level, environmental framing",
    lensMm: 35,
    lightingStyle: "warm afternoon sun, gentle shaded side, golden ambient",
    aestheticTags: ["travel", "europe", "warm", "street"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a European old town cobblestone street; soft-blurred ochre buildings behind. ` +
      `Warm afternoon sun with gentle shaded fill side, golden ambient. ` +
      `Camera: ${p.cameraStyle}, eye-level environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "tropical-resort-pool",
    label: "Tropical Resort Pool",
    category: "outdoor-nature",
    nicheAffinity: ["travel", "luxury", "lifestyle", "fashion"],
    environmentType: "luxury tropical resort poolside, palm shadows, turquoise water",
    cameraAngle: "eye-level, environmental framing",
    lensMm: 35,
    lightingStyle: "bright golden tropical sun, defined palm shadow, sky as fill",
    aestheticTags: ["resort", "tropical", "luxury", "travel"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject at a luxury tropical resort poolside; palm shadows, turquoise water soft-blurred. ` +
      `Bright golden tropical sun with sky as fill; defined natural palm shadow. ` +
      `Camera: ${p.cameraStyle}, eye-level environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "scenic-overlook",
    label: "Scenic Overlook",
    category: "outdoor-nature",
    nicheAffinity: ["travel", "outdoor", "lifestyle", "wellness"],
    environmentType: "mountain scenic overlook, expansive valley behind, golden-hour sky",
    cameraAngle: "slight low angle, hero environmental framing",
    lensMm: 35,
    lightingStyle: "golden-hour back/rim light, warm key from camera-right",
    aestheticTags: ["nature", "scenic", "golden-hour", "expansive"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject at a mountain scenic overlook; expansive valley behind, golden-hour sky. ` +
      `Warm rim light from behind, soft key from camera-right. ` +
      `Camera: ${p.cameraStyle}, slight low angle hero environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "beach-golden-hour",
    label: "Beach, Golden Hour",
    category: "outdoor-nature",
    nicheAffinity: ["travel", "outdoor", "wellness", "lifestyle", "fashion"],
    environmentType: "wide ocean beach at golden hour, soft surf, warm sand",
    cameraAngle: "eye-level, environmental framing",
    lensMm: 50,
    lightingStyle: "golden-hour back light, warm key, sky as soft fill",
    aestheticTags: ["beach", "golden-hour", "warm", "ocean"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a wide ocean beach at golden hour; soft surf, warm sand. ` +
      `Golden-hour back light, warm key on the face, sky as soft fill. ` +
      `Camera: ${p.cameraStyle}, eye-level environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "forest-trail",
    label: "Forest Trail",
    category: "outdoor-nature",
    nicheAffinity: ["outdoor", "wellness", "creative", "lifestyle"],
    environmentType: "tall forest trail with dappled sunlight, mossy underbrush",
    cameraAngle: "eye-level, environmental framing",
    lensMm: 50,
    lightingStyle: "dappled sunlight through canopy, soft green ambient bounce",
    aestheticTags: ["forest", "nature", "calm", "outdoor"],
    placementZone: "centered",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a tall forest trail; dappled sunlight through canopy, mossy underbrush. ` +
      `Dappled sunlight key with soft green ambient bounce. ` +
      `Camera: ${p.cameraStyle}, eye-level environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "lakeside-calm",
    label: "Lakeside, Calm Morning",
    category: "outdoor-nature",
    nicheAffinity: ["outdoor", "wellness", "lifestyle", "travel"],
    environmentType: "calm lakeside dock at morning, mist over water, distant tree line",
    cameraAngle: "eye-level, environmental framing",
    lensMm: 50,
    lightingStyle: "soft morning sun, cool mist ambient fill, gentle warmth on subject",
    aestheticTags: ["lake", "calm", "morning", "outdoor"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject on a calm lakeside dock at morning; mist over water, distant tree line soft-blurred. ` +
      `Soft morning sun key with cool mist ambient as fill. ` +
      `Camera: ${p.cameraStyle}, eye-level environmental framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "airport-lounge",
    label: "Airport Lounge",
    category: "transit",
    nicheAffinity: ["travel", "luxury", "business"],
    environmentType: "premium airport lounge, leather seating, runway view soft-blurred behind",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm interior key, cool runway-window fill, balanced contrast",
    aestheticTags: ["travel", "transit", "premium", "lounge"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a premium airport lounge; leather seating, runway view soft-blurred behind. ` +
      `Warm interior key, cool runway-window fill, balanced contrast. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "back-of-suv",
    label: "Back of Premium SUV",
    category: "transit",
    nicheAffinity: ["luxury", "business", "fashion"],
    environmentType: "back seat of a premium black SUV, warm leather interior, city lights soft-blurred outside",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm interior cabin light, soft window glow as fill",
    aestheticTags: ["luxury", "transit", "warm", "premium"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject seated in the back of a premium black SUV; warm leather interior, city lights soft-blurred outside the window. ` +
      `Warm interior cabin light key, soft window glow as fill. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "spa-treatment-room",
    label: "Spa Treatment Room",
    category: "indoor-warm",
    nicheAffinity: ["wellness", "beauty", "luxury"],
    environmentType: "minimalist luxury spa room, warm wood, soft candle ambient",
    cameraAngle: "eye-level, calm framing",
    lensMm: 50,
    lightingStyle: "soft warm candle/lamp ambient, low-key shadow, spa serenity",
    aestheticTags: ["spa", "wellness", "warm", "calm"],
    placementZone: "centered",
    realismScore: 0.8,
    genderHint: "any",
    prompt: (p) =>
      `Subject in a minimalist luxury spa room; warm wood, soft candle ambient. ` +
      `Soft warm ambient key, low-key shadow, spa serenity. ` +
      `Camera: ${p.cameraStyle}, eye-level calm framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "rooftop-bar-evening",
    label: "Rooftop Bar, Evening",
    category: "outdoor-urban",
    nicheAffinity: ["luxury", "lifestyle", "fashion", "creative"],
    environmentType: "rooftop bar at blue-hour, ambient string lights, skyline soft-blurred behind",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm string-light ambient key, cool blue-hour fill, defined catchlights",
    aestheticTags: ["bar", "evening", "blue-hour", "luxury"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.7,
    genderHint: "any",
    prompt: (p) =>
      `Subject at a rooftop bar at blue-hour; warm ambient string lights, skyline soft-blurred behind. ` +
      `Warm string-light ambient key, cool blue-hour fill, defined catchlights. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "apartment-living-room",
    label: "Apartment Living Room",
    category: "indoor-warm",
    nicheAffinity: ["lifestyle", "creative", "wellness", "tech"],
    environmentType: "elevated modern apartment living room, warm neutrals, large window",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "soft window key, warm interior bounce fill",
    aestheticTags: ["home", "warm", "candid", "lifestyle"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject in an elevated modern apartment living room; warm neutrals, large window behind. ` +
      `Soft window key, warm interior bounce fill. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "selfie-window-light",
    label: "Window-Light Selfie Vibe",
    category: "indoor-warm",
    nicheAffinity: ["beauty", "lifestyle", "fashion", "wellness"],
    environmentType: "intimate room with strong window light, neutral interior",
    cameraAngle: "eye-level, tight portrait framing",
    lensMm: 50,
    lightingStyle: "large window key from camera-left, soft bounce fill, defined catchlights",
    aestheticTags: ["selfie", "warm", "intimate", "skin"],
    placementZone: "tight-portrait",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject in an intimate interior with strong window light; neutral background. ` +
      `Large window key from camera-left with soft bounce fill, defined catchlights, real skin texture. ` +
      `Camera: ${p.cameraStyle}, eye-level tight portrait framing. Vertical 9:16. ` +
      `Skin: ${p.skinToneProfile}.`,
  }),
  T({
    id: "weekend-brunch",
    label: "Weekend Brunch",
    category: "indoor-warm",
    nicheAffinity: ["lifestyle", "foodie", "wellness", "fashion"],
    environmentType: "warm brunch spot, ceramic plate, fresh florals on table, sunlight on linen",
    cameraAngle: "eye-level three-quarter",
    lensMm: 50,
    lightingStyle: "warm window light, gentle linen bounce fill",
    aestheticTags: ["brunch", "warm", "candid", "weekend"],
    placementZone: "rule-of-thirds-left",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject at a warm weekend brunch spot; ceramic plate and fresh florals on the table, sunlight on linen. ` +
      `Warm window light key, gentle linen bounce fill. ` +
      `Camera: ${p.cameraStyle}, eye-level three-quarter. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "speaker-stage",
    label: "Speaker Stage",
    category: "indoor-clean",
    nicheAffinity: ["business", "tech", "creative"],
    environmentType: "modern conference stage, soft-blurred audience, branded backdrop neutral",
    cameraAngle: "slight low angle, authority framing",
    lensMm: 85,
    lightingStyle: "directional stage key, soft fill, deep shadow detail",
    aestheticTags: ["speaker", "stage", "authority", "event"],
    placementZone: "centered",
    realismScore: 0.65,
    genderHint: "any",
    prompt: (p) =>
      `Subject mid-talk on a modern conference stage; soft-blurred audience, neutral branded backdrop (no recognizable logo). ` +
      `Directional stage key, soft fill, deep shadow detail. ` +
      `Camera: ${p.cameraStyle}, slight low angle authority framing. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
  T({
    id: "park-walking",
    label: "Park, Walking",
    category: "outdoor-nature",
    nicheAffinity: ["lifestyle", "wellness", "outdoor", "fashion"],
    environmentType: "city park path, soft-blurred trees, gentle daylight",
    cameraAngle: "eye-level, mid-stride",
    lensMm: 50,
    lightingStyle: "soft natural daylight, gentle shaded fill",
    aestheticTags: ["park", "walking", "candid", "natural"],
    placementZone: "rule-of-thirds-right",
    realismScore: 0.85,
    genderHint: "any",
    prompt: (p) =>
      `Subject walking on a city park path; soft-blurred trees, gentle daylight. ` +
      `Soft natural daylight key, gentle shaded fill. ` +
      `Camera: ${p.cameraStyle}, eye-level mid-stride. Vertical 9:16. ` +
      `Wardrobe consistent with ${p.fashionStyle}.`,
  }),
];

/**
 * Pick `count` scenes appropriate for the given character profile.
 *
 * Strategy:
 *   1. Score every template by archetype affinity (exact match = 3,
 *      adjacent niche overlap = 1) and gender-hint compatibility.
 *   2. Sort descending by score; break ties with realism distance from
 *      the profile's preferred realism level.
 *   3. Greedily pick down the list while enforcing diversity: no more
 *      than 2 templates from the same `category`.
 *   4. If we still don't have enough, fall back to the next-best
 *      ignoring the diversity cap.
 */
export function pickScenesForProfile(
  profile: CharacterProfile,
  count = 10,
): SceneTemplate[] {
  const targetRealism =
    profile.realismLevel === "documentary" ? 0.85 : profile.realismLevel === "campaign" ? 0.75 : 0.6;
  const genderOk = (g: GenderHint) =>
    g === "any" ||
    (g === "female" && profile.gender === "female") ||
    (g === "male" && profile.gender === "male");

  type Scored = { tpl: SceneTemplate; score: number; realismDist: number };
  const scored: Scored[] = SCENE_TEMPLATES.filter((t) => genderOk(t.genderHint)).map((tpl) => {
    const exact = tpl.nicheAffinity.includes(profile.archetype) ? 3 : 0;
    // Light affinity bonus when the scene's category aligns with the
    // archetype's preference tags (e.g. "rooftop" / "luxury" / "spa").
    const tagBonus = tpl.aestheticTags.some((tag) =>
      profile.scenePreferenceTags.some((pref) => pref.includes(tag) || tag.includes(pref)),
    )
      ? 1
      : 0;
    return { tpl, score: exact + tagBonus, realismDist: Math.abs(tpl.realismScore - targetRealism) };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.realismDist - b.realismDist));

  const picked: SceneTemplate[] = [];
  const perCategory = new Map<SceneCategory, number>();
  const CATEGORY_CAP = 2;
  for (const s of scored) {
    if (picked.length >= count) break;
    const cur = perCategory.get(s.tpl.category) ?? 0;
    if (cur >= CATEGORY_CAP) continue;
    picked.push(s.tpl);
    perCategory.set(s.tpl.category, cur + 1);
  }
  if (picked.length < count) {
    for (const s of scored) {
      if (picked.length >= count) break;
      if (picked.includes(s.tpl)) continue;
      picked.push(s.tpl);
    }
  }
  return picked.slice(0, count);
}

export function getSceneTemplateById(id: string): SceneTemplate | null {
  return SCENE_TEMPLATES.find((t) => t.id === id) ?? null;
}
