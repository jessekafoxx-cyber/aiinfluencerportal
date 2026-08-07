// ─────────────────────────────────────────────────────────────────────────────
// Vibe-conditioned wardrobe selection for the 10-angle identity grid.
//
// Why this exists: previously the 10 angles either copied the reference
// shirt (everyone in the same beige polo) or drew from a single global
// 10-entry matrix (every "soft luxury" influencer in the same lineup).
// Both collapsed toward a canonical outfit per vibe.
//
// Design: per aesthetic bucket (soft-luxury, bold-creator, athletic-
// outdoor, cozy-warm, editorial-fashion, minimalist-pro) we keep a
// LARGE pool of premium, on-brand wardrobe archetypes. Each entry is
// tagged with one or more named SUB-LANES (e.g. for soft-luxury:
// knit-polo, cashmere-knits, relaxed-shirting, layered-tailoring,
// monochrome-minimal, elevated-creator). For each influencer we
// deterministically pick ONE sub-lane (seeded by DNA hash), filter the
// bucket pool to entries tagged with that sub-lane, and then
// adjacency-shuffle 10 entries out of that sub-lane. Two users picking
// identical dropdowns get different sub-lanes (and therefore visibly
// different styling lanes) because the DNA hash is independently
// randomized per influencer (see influencer-identity-dna.ts).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { CharacterProfile } from "./influencer-character";
import { logger } from "./logger";

export type WardrobeEntry = {
  /** Stable short slug used in logs and the persisted prompt token. */
  label: string;
  /** Prose interpolated into the angle prompt. */
  description: string;
  /** Coarse garment family used for adjacency de-duplication. */
  garmentType: string;
  /** Coarse dominant-color bucket used for adjacency de-duplication. */
  dominantColor: string;
  /** Sub-lane tags (1-2 per entry). An entry is eligible for a sub-lane
   *  selection iff its `subLanes` includes that sub-lane id. */
  subLanes: string[];
};

export type AestheticBucket =
  | "soft-luxury"
  | "bold-creator"
  | "athletic-outdoor"
  | "cozy-warm"
  | "editorial-fashion"
  | "minimalist-pro";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-lane catalog. Each bucket gets 5-6 named sub-lanes that span the
// full premium fashion/styling space inside the bucket's aesthetic.
// These names are persisted on the influencer's characterProfile so
// downstream logging + future analytics can see which lane was chosen.
// ─────────────────────────────────────────────────────────────────────────────

export const SUB_LANES_BY_BUCKET: Record<AestheticBucket, string[]> = {
  "soft-luxury": [
    "knit-polo",
    "cashmere-knits",
    "relaxed-shirting",
    "layered-tailoring",
    "monochrome-minimal",
    "elevated-creator",
  ],
  "bold-creator": [
    "streetwear-hoodies",
    "graphic-tees",
    "statement-jackets",
    "denim-layered",
    "patterned-shirts",
    "saturated-color",
  ],
  "athletic-outdoor": [
    "performance-tops",
    "technical-layers",
    "hiking-shirts",
    "trail-casual",
    "coastal-active",
    "mountain-flannel",
  ],
  "cozy-warm": [
    "chunky-knits",
    "henley-thermal",
    "cardigan-layered",
    "fleece-crewneck",
    "turtleneck-warm",
    "plaid-flannel",
  ],
  "editorial-fashion": [
    "structured-mockneck",
    "tailored-overlayers",
    "silk-and-satin",
    "monochrome-editorial",
    "architectural-knit",
    "denim-editorial",
  ],
  "minimalist-pro": [
    "crisp-shirting",
    "fitted-tees",
    "fine-knit",
    "polo-clean",
    "blazer-and-tee",
    "neutral-henley",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Pools. Every entry must be a torso-covering top so the existing
// wardrobe gate (shirtless / open-shirt / exposed-chest check) keeps
// passing without relaxation. Each entry is tagged with 1-2 sub-lanes
// so a sub-lane-filtered view of the pool always has >=10 entries with
// enough garment/color variety to satisfy adjacency-pick-10.
// ─────────────────────────────────────────────────────────────────────────────

const POOL_SOFT_LUXURY: WardrobeEntry[] = [
  { label: "beige-knit-polo", description: "a fitted beige fine-knit polo shirt with a soft collar, top button fastened, quiet-luxury aesthetic", garmentType: "polo", dominantColor: "beige", subLanes: ["knit-polo", "monochrome-minimal"] },
  { label: "navy-smart-polo", description: "a navy blue smart knit polo shirt with a tipped collar, top button fastened, refined casual", garmentType: "polo", dominantColor: "navy", subLanes: ["knit-polo", "elevated-creator"] },
  { label: "stone-fineknit-polo", description: "a stone-grey fine-knit short-sleeve polo with a subtle tipped collar, top button fastened", garmentType: "polo", dominantColor: "stone", subLanes: ["knit-polo", "monochrome-minimal"] },
  { label: "olive-knit-polo", description: "an olive-green fine-knit polo with a soft collar and the top button fastened, refined casual silhouette", garmentType: "polo", dominantColor: "olive", subLanes: ["knit-polo", "elevated-creator"] },
  { label: "cream-pique-polo", description: "a cream pique-knit polo with a structured collar, top button fastened, soft luxurious cotton", garmentType: "polo", dominantColor: "cream", subLanes: ["knit-polo", "monochrome-minimal"] },
  { label: "charcoal-knit-polo", description: "a charcoal fine-knit polo with a soft collar, top button fastened, refined modern cut", garmentType: "polo", dominantColor: "charcoal", subLanes: ["knit-polo", "elevated-creator"] },

  { label: "cream-cashmere-crew", description: "a cream cashmere crew-neck sweater with a high closed neckline, soft luxurious drape", garmentType: "sweater", dominantColor: "cream", subLanes: ["cashmere-knits", "monochrome-minimal"] },
  { label: "taupe-textured-knit", description: "a taupe textured-knit crew-neck sweater with subtle slub yarn, high closed neckline", garmentType: "sweater", dominantColor: "taupe", subLanes: ["cashmere-knits", "layered-tailoring"] },
  { label: "navy-merino-crew", description: "a navy fine-merino crew-neck sweater with a high closed neckline, refined premium knit", garmentType: "sweater", dominantColor: "navy", subLanes: ["cashmere-knits", "monochrome-minimal"] },
  { label: "camel-cashmere-cardigan", description: "a camel cashmere cardigan buttoned over a plain ivory tee, all buttons fastened, layered soft-luxury knit", garmentType: "cardigan", dominantColor: "camel", subLanes: ["cashmere-knits", "layered-tailoring"] },
  { label: "charcoal-fineknit-turtleneck", description: "a charcoal fine-knit turtleneck with a high closed neckline, sleek soft-luxury silhouette", garmentType: "turtleneck", dominantColor: "charcoal", subLanes: ["cashmere-knits", "monochrome-minimal"] },
  { label: "oat-mockneck-knit", description: "an oat-colored fine-merino long-sleeve mockneck with a high closed neckline, minimal soft drape", garmentType: "mockneck", dominantColor: "oat", subLanes: ["cashmere-knits", "elevated-creator"] },

  { label: "white-linen-button-down", description: "a crisp white linen long-sleeve button-down, all buttons fastened, relaxed premium tailoring", garmentType: "button-down", dominantColor: "white", subLanes: ["relaxed-shirting", "monochrome-minimal"] },
  { label: "sand-silk-buttondown", description: "a sand-colored silk-blend long-sleeve button-down, all buttons fastened, fluid luxury drape", garmentType: "button-down", dominantColor: "sand", subLanes: ["relaxed-shirting", "elevated-creator"] },
  { label: "olive-relaxed-overshirt", description: "an olive green relaxed cotton overshirt buttoned over a plain crew-neck tee, structured casual layering", garmentType: "overshirt", dominantColor: "olive", subLanes: ["relaxed-shirting", "layered-tailoring"] },
  { label: "camel-suede-overshirt", description: "a camel suede-feel overshirt buttoned over a plain cream tee, refined autumnal layering", garmentType: "overshirt", dominantColor: "camel", subLanes: ["relaxed-shirting", "layered-tailoring"] },
  { label: "ecru-linen-shirt", description: "an ecru lightweight linen long-sleeve shirt, all buttons fastened, relaxed soft-luxury cut", garmentType: "button-down", dominantColor: "ecru", subLanes: ["relaxed-shirting", "monochrome-minimal"] },
  { label: "pale-blue-oxford", description: "a pale-blue oxford long-sleeve button-down, all buttons fastened, refined casual shirting", garmentType: "button-down", dominantColor: "light-blue", subLanes: ["relaxed-shirting", "elevated-creator"] },

  { label: "navy-minimal-blazer", description: "a clean unstructured navy blazer worn over a plain black crew-neck tee, polished smart casual", garmentType: "blazer", dominantColor: "navy", subLanes: ["layered-tailoring", "elevated-creator"] },
  { label: "charcoal-blazer-cream-tee", description: "a charcoal unstructured blazer worn over a plain cream crew-neck tee, refined layered tailoring", garmentType: "blazer", dominantColor: "charcoal", subLanes: ["layered-tailoring", "monochrome-minimal"] },
  { label: "stone-blazer-knit", description: "a stone-colored relaxed blazer worn over a fitted black fine-knit crew, refined layered cut", garmentType: "blazer", dominantColor: "stone", subLanes: ["layered-tailoring", "elevated-creator"] },
  { label: "brown-blazer-ivory-knit", description: "a soft brown unstructured blazer worn over an ivory fine-knit crew, warm layered tailoring", garmentType: "blazer", dominantColor: "brown", subLanes: ["layered-tailoring", "cashmere-knits"] },

  { label: "charcoal-luxury-tee", description: "a charcoal grey fitted heavyweight cotton t-shirt with a high closed crew neckline, premium minimal", garmentType: "tee", dominantColor: "charcoal", subLanes: ["monochrome-minimal", "elevated-creator"] },
  { label: "fitted-black-tee", description: "a fitted black premium cotton crew-neck t-shirt with a high closed neckline, modern minimal silhouette", garmentType: "tee", dominantColor: "black", subLanes: ["monochrome-minimal", "elevated-creator"] },
  { label: "offwhite-longsleeve", description: "an off-white long-sleeve fine-rib crew, high closed neckline, soft premium knit", garmentType: "longsleeve", dominantColor: "white", subLanes: ["monochrome-minimal", "elevated-creator"] },
  { label: "cream-luxury-hoodie", description: "a lightweight cream loopback-cotton hoodie worn with the hood down, high closed neckline, elevated leisure", garmentType: "hoodie", dominantColor: "cream", subLanes: ["elevated-creator", "monochrome-minimal"] },
  { label: "graphite-luxury-hoodie", description: "a graphite heavyweight loopback hoodie worn hood-down with a high closed neckline, elevated leisure", garmentType: "hoodie", dominantColor: "graphite", subLanes: ["elevated-creator", "monochrome-minimal"] },
  { label: "brown-henley", description: "a muted brown long-sleeve henley with the placket fully buttoned, high closed neckline, soft brushed cotton", garmentType: "henley", dominantColor: "brown", subLanes: ["elevated-creator", "cashmere-knits"] },

  // Top-ups so every soft-luxury sub-lane has >=10 viable entries.
  { label: "tipped-knit-polo-cream", description: "a cream fine-knit polo with a contrasting tipped collar in soft taupe, top button fastened, refined luxury cut", garmentType: "polo", dominantColor: "cream-tipped", subLanes: ["knit-polo", "layered-tailoring"] },
  { label: "silk-blend-knit-polo", description: "an ivory silk-blend short-sleeve knit polo with a soft collar, top button fastened, fluid luxury drape", garmentType: "polo", dominantColor: "ivory", subLanes: ["knit-polo", "relaxed-shirting"] },
  { label: "waffle-knit-polo-sand", description: "a sand-colored waffle-knit short-sleeve polo with a soft collar, top button fastened, textured premium knit", garmentType: "polo", dominantColor: "sand-waffle", subLanes: ["knit-polo", "cashmere-knits"] },
  { label: "linen-knit-polo-stone", description: "a stone linen-blend short-sleeve knit polo with a soft collar, top button fastened, relaxed luxury silhouette", garmentType: "polo", dominantColor: "stone-linen", subLanes: ["knit-polo", "relaxed-shirting"] },
  { label: "powder-blue-silk-shirt", description: "a powder-blue silk-blend long-sleeve button-down, all buttons fastened, fluid soft-luxury drape", garmentType: "button-down", dominantColor: "powder-blue", subLanes: ["relaxed-shirting", "layered-tailoring"] },
  { label: "olive-silk-button-down", description: "a muted olive silk-blend long-sleeve button-down, all buttons fastened, considered soft-luxury drape", garmentType: "button-down", dominantColor: "olive-silk", subLanes: ["relaxed-shirting", "layered-tailoring"] },
  { label: "taupe-knit-vest-shirt", description: "a taupe fine-knit cardigan-vest buttoned over a long-sleeve ivory button-down with all buttons fastened, refined layered tailoring", garmentType: "layered-knit", dominantColor: "taupe-layer", subLanes: ["cashmere-knits", "layered-tailoring"] },
  { label: "biscuit-relaxed-buttondown", description: "a biscuit-colored relaxed cotton long-sleeve button-down, all buttons fastened, soft-luxury weekend cut", garmentType: "button-down", dominantColor: "biscuit", subLanes: ["relaxed-shirting", "cashmere-knits"] },
];

const POOL_BOLD_CREATOR: WardrobeEntry[] = [
  { label: "black-streetwear-hoodie", description: "a black heavyweight streetwear hoodie worn with the hood down, high closed neckline, bold casual silhouette", garmentType: "hoodie", dominantColor: "black", subLanes: ["streetwear-hoodies", "saturated-color"] },
  { label: "forest-green-hoodie", description: "a forest-green heavyweight hoodie worn with the hood down, high closed neckline, casual bold layering", garmentType: "hoodie", dominantColor: "green", subLanes: ["streetwear-hoodies", "saturated-color"] },
  { label: "vivid-red-crewneck", description: "a vivid red fleece crew-neck sweatshirt with a high closed neckline, energetic creator aesthetic", garmentType: "crewneck", dominantColor: "red", subLanes: ["streetwear-hoodies", "saturated-color"] },
  { label: "orange-crewneck", description: "a saturated orange fleece crew-neck sweatshirt with a high closed neckline, bold creator energy", garmentType: "crewneck", dominantColor: "orange", subLanes: ["streetwear-hoodies", "saturated-color"] },
  { label: "graphite-streetwear-hoodie", description: "a graphite heavyweight streetwear hoodie with raised seams, hood down, high closed neckline, bold modern cut", garmentType: "hoodie", dominantColor: "graphite", subLanes: ["streetwear-hoodies", "graphic-tees"] },
  { label: "navy-bold-crewneck", description: "a navy heavyweight fleece crew-neck sweatshirt with bold proportions, high closed neckline", garmentType: "crewneck", dominantColor: "navy", subLanes: ["streetwear-hoodies", "saturated-color"] },

  { label: "bright-white-graphic-tee", description: "a bright white heavyweight cotton crew-neck t-shirt with a subtle minimal chest graphic, high closed neckline", garmentType: "tee", dominantColor: "white", subLanes: ["graphic-tees", "saturated-color"] },
  { label: "electric-blue-tee", description: "an electric-blue oversized cotton crew-neck t-shirt with a high closed neckline, modern bold cut", garmentType: "tee", dominantColor: "blue", subLanes: ["graphic-tees", "saturated-color"] },
  { label: "vintage-faded-tee", description: "a faded vintage-style black graphic tee with subtle washed print, high closed neckline, bold creator energy", garmentType: "tee", dominantColor: "black", subLanes: ["graphic-tees", "denim-layered"] },
  { label: "burgundy-bold-tee", description: "a burgundy oversized cotton crew-neck t-shirt with a high closed neckline, saturated creator cut", garmentType: "tee", dominantColor: "burgundy", subLanes: ["graphic-tees", "saturated-color"] },
  { label: "ochre-vintage-tee", description: "an ochre-yellow vintage-washed crew-neck tee with subtle minimal print, high closed neckline", garmentType: "tee", dominantColor: "ochre", subLanes: ["graphic-tees", "saturated-color"] },
  { label: "cobalt-bold-tee", description: "a cobalt-blue heavyweight crew-neck tee with bold proportions, high closed neckline", garmentType: "tee", dominantColor: "cobalt", subLanes: ["graphic-tees", "saturated-color"] },

  { label: "yellow-bomber", description: "a saturated yellow varsity-style bomber jacket fully zipped to a high mock collar over a plain dark tee", garmentType: "jacket", dominantColor: "yellow", subLanes: ["statement-jackets", "saturated-color"] },
  { label: "cobalt-track-jacket", description: "a cobalt-blue zip-up track jacket with the zipper fully closed to the high mock collar, sporty creator energy", garmentType: "jacket", dominantColor: "cobalt", subLanes: ["statement-jackets", "saturated-color"] },
  { label: "scarlet-bomber", description: "a scarlet satin-finish bomber jacket fully zipped to a high mock collar over a plain black tee", garmentType: "jacket", dominantColor: "red", subLanes: ["statement-jackets", "saturated-color"] },
  { label: "olive-utility-jacket", description: "an olive utility-style zip-up jacket fully zipped to a high mock collar over a plain cream tee, bold workwear cut", garmentType: "jacket", dominantColor: "olive", subLanes: ["statement-jackets", "denim-layered"] },

  { label: "denim-trucker-jacket", description: "a mid-blue denim trucker jacket buttoned over a plain white tee, all buttons fastened, classic creator layering", garmentType: "jacket", dominantColor: "denim-blue", subLanes: ["denim-layered", "statement-jackets"] },
  { label: "monochrome-layered-tee", description: "a black crew-neck tee layered under an open-neck black overshirt that stays fully buttoned, high closed neckline", garmentType: "layered-tee", dominantColor: "black", subLanes: ["denim-layered", "graphic-tees"] },
  { label: "white-oxford-rolled", description: "a crisp white oxford long-sleeve button-down with sleeves rolled to the forearm, all body buttons fastened", garmentType: "button-down", dominantColor: "white", subLanes: ["denim-layered", "patterned-shirts"] },
  { label: "black-denim-trucker", description: "a black washed-denim trucker jacket buttoned over a white crew tee, all buttons fastened, modern creator layering", garmentType: "jacket", dominantColor: "black", subLanes: ["denim-layered", "statement-jackets"] },
  { label: "indigo-chambray-shirt", description: "an indigo chambray long-sleeve button-down, all buttons fastened, relaxed denim-style shirting", garmentType: "button-down", dominantColor: "indigo", subLanes: ["denim-layered", "patterned-shirts"] },
  { label: "vintage-tee-flannel", description: "a faded vintage-style dark graphic tee layered under a buttoned red-and-black plaid flannel overshirt", garmentType: "layered-tee", dominantColor: "red", subLanes: ["denim-layered", "patterned-shirts"] },

  { label: "bold-pattern-buttondown", description: "a bold patterned long-sleeve button-down shirt, all buttons fastened, high-energy print on dark base", garmentType: "button-down", dominantColor: "patterned-dark", subLanes: ["patterned-shirts", "graphic-tees"] },
  { label: "olive-utility-shirt", description: "an olive cotton utility shirt with chest pockets, all buttons fastened, rugged creator workwear", garmentType: "utility-shirt", dominantColor: "olive", subLanes: ["patterned-shirts", "denim-layered"] },
  { label: "color-block-shirt", description: "a two-tone color-blocked long-sleeve button-down in deep teal and cream, all buttons fastened, graphic creator cut", garmentType: "button-down", dominantColor: "teal", subLanes: ["patterned-shirts", "saturated-color"] },
  { label: "checkered-overshirt", description: "a black-and-white micro-checkered overshirt buttoned over a plain charcoal tee, all buttons fastened, bold graphic layering", garmentType: "overshirt", dominantColor: "patterned-dark", subLanes: ["patterned-shirts", "denim-layered"] },

  // Top-ups so every bold-creator sub-lane has >=10 viable entries.
  { label: "cobalt-streetwear-hoodie", description: "a cobalt-blue heavyweight streetwear hoodie worn with the hood down, high closed neckline, bold creator energy", garmentType: "hoodie", dominantColor: "cobalt-hoodie", subLanes: ["streetwear-hoodies", "statement-jackets"] },
  { label: "ivory-creator-hoodie", description: "an ivory loopback-cotton hoodie worn with the hood down, high closed neckline, elevated bold creator", garmentType: "hoodie", dominantColor: "ivory-hoodie", subLanes: ["streetwear-hoodies", "graphic-tees"] },
  { label: "burgundy-streetwear-hoodie", description: "a burgundy heavyweight streetwear hoodie worn with the hood down, high closed neckline, bold creator cut", garmentType: "hoodie", dominantColor: "burgundy-hoodie", subLanes: ["streetwear-hoodies", "statement-jackets"] },
  { label: "purple-bold-crewneck", description: "a saturated purple fleece crew-neck sweatshirt with a high closed neckline, energetic creator energy", garmentType: "crewneck", dominantColor: "purple", subLanes: ["streetwear-hoodies", "saturated-color"] },
  { label: "crimson-track-jacket", description: "a crimson zip-up track jacket with the zipper fully closed to a high mock collar over a plain dark tee, sporty creator energy", garmentType: "jacket", dominantColor: "crimson", subLanes: ["statement-jackets", "saturated-color"] },
  { label: "mustard-bomber-jacket", description: "a mustard-yellow varsity-style bomber jacket fully zipped to a high mock collar over a plain ecru tee", garmentType: "jacket", dominantColor: "mustard-bomber", subLanes: ["statement-jackets", "patterned-shirts"] },
  { label: "teal-bomber-jacket", description: "a deep-teal satin-finish bomber jacket fully zipped to a high mock collar over a plain charcoal tee", garmentType: "jacket", dominantColor: "teal-bomber", subLanes: ["statement-jackets", "saturated-color"] },
  { label: "olive-print-buttondown", description: "an olive base printed long-sleeve button-down with a subtle abstract pattern, all buttons fastened, bold creator shirting", garmentType: "button-down", dominantColor: "olive-print", subLanes: ["patterned-shirts", "statement-jackets"] },
  { label: "floral-dark-buttondown", description: "a deep-charcoal base printed long-sleeve button-down with a tonal floral motif, all buttons fastened, refined creator pattern", garmentType: "button-down", dominantColor: "floral-dark", subLanes: ["patterned-shirts", "graphic-tees"] },
  { label: "striped-buttondown", description: "a navy-and-cream awning-striped long-sleeve button-down, all buttons fastened, graphic creator shirting", garmentType: "button-down", dominantColor: "striped-navy", subLanes: ["patterned-shirts", "denim-layered"] },
];

const POOL_ATHLETIC_OUTDOOR: WardrobeEntry[] = [
  { label: "heather-athletic-tee", description: "a heather-grey athletic crew-neck performance t-shirt with a high closed neckline, technical fabric", garmentType: "tee", dominantColor: "heather-grey", subLanes: ["performance-tops", "trail-casual"] },
  { label: "black-training-tee", description: "a black fitted training crew-neck performance t-shirt with a high closed neckline, technical fabric", garmentType: "tee", dominantColor: "black", subLanes: ["performance-tops", "coastal-active"] },
  { label: "navy-performance-polo", description: "a navy moisture-wicking performance polo shirt with the top button fastened, athletic clean cut", garmentType: "polo", dominantColor: "navy", subLanes: ["performance-tops", "trail-casual"] },
  { label: "coral-running-tee", description: "a saturated coral short-sleeve running crew-neck performance tee with a high closed neckline", garmentType: "tee", dominantColor: "coral", subLanes: ["performance-tops", "coastal-active"] },
  { label: "olive-performance-henley", description: "an olive performance long-sleeve henley with the placket fully buttoned, high closed neckline, technical knit", garmentType: "henley", dominantColor: "olive", subLanes: ["performance-tops", "trail-casual"] },
  { label: "graphite-training-longsleeve", description: "a graphite long-sleeve fitted training crew-neck base layer with a high closed neckline, technical fabric", garmentType: "longsleeve", dominantColor: "graphite", subLanes: ["performance-tops", "technical-layers"] },

  { label: "white-quarter-zip", description: "a white short-sleeve quarter-zip performance top with the zipper closed to a high mock collar", garmentType: "quarter-zip", dominantColor: "white", subLanes: ["technical-layers", "performance-tops"] },
  { label: "charcoal-longsleeve-crew", description: "a charcoal long-sleeve athletic crew-neck base layer with a high closed neckline, fitted technical knit", garmentType: "longsleeve", dominantColor: "charcoal", subLanes: ["technical-layers", "performance-tops"] },
  { label: "cream-technical-fleece", description: "a cream technical-fleece pullover with a high closed mock-neck zip fully zipped, outdoor premium layering", garmentType: "fleece", dominantColor: "cream", subLanes: ["technical-layers", "mountain-flannel"] },
  { label: "softshell-layer", description: "a forest-green softshell outdoor jacket fully zipped to a high mock collar over a plain crew tee", garmentType: "jacket", dominantColor: "green", subLanes: ["technical-layers", "mountain-flannel"] },
  { label: "lightgrey-zipneck", description: "a light grey zip-neck pullover with the zipper closed to a high mock collar, performance knit", garmentType: "quarter-zip", dominantColor: "light-grey", subLanes: ["technical-layers", "performance-tops"] },
  { label: "slate-softshell", description: "a slate softshell outdoor jacket fully zipped to a high mock collar over a plain heather tee, technical layered fit", garmentType: "jacket", dominantColor: "slate", subLanes: ["technical-layers", "mountain-flannel"] },

  { label: "sand-hiking-shirt", description: "a sand-colored long-sleeve hiking button-down with technical venting, all buttons fastened", garmentType: "button-down", dominantColor: "sand", subLanes: ["hiking-shirts", "trail-casual"] },
  { label: "stone-hiking-buttondown", description: "a stone-grey long-sleeve hiking button-down, all buttons fastened, structured outdoor casual", garmentType: "button-down", dominantColor: "stone", subLanes: ["hiking-shirts", "trail-casual"] },
  { label: "khaki-hiking-shirt", description: "a khaki long-sleeve hiking button-down with chest pockets, all buttons fastened, rugged outdoor cut", garmentType: "button-down", dominantColor: "khaki", subLanes: ["hiking-shirts", "trail-casual"] },
  { label: "olive-trail-buttondown", description: "an olive long-sleeve trail button-down with technical venting, all buttons fastened, outdoor utility shirting", garmentType: "button-down", dominantColor: "olive", subLanes: ["hiking-shirts", "mountain-flannel"] },

  { label: "sunfaded-vintage-tee", description: "a sun-faded vintage-style dusty-blue crew-neck t-shirt with a high closed neckline, outdoor relaxed casual", garmentType: "tee", dominantColor: "dusty-blue", subLanes: ["trail-casual", "performance-tops"] },
  { label: "rust-trail-tee", description: "a rust-colored heavyweight outdoor crew-neck tee with a high closed neckline, relaxed trail casual", garmentType: "tee", dominantColor: "rust", subLanes: ["trail-casual", "performance-tops"] },
  { label: "earth-trail-henley", description: "an earth-toned long-sleeve henley with the placket fully buttoned, high closed neckline, relaxed outdoor cotton", garmentType: "henley", dominantColor: "brown", subLanes: ["trail-casual", "hiking-shirts"] },

  { label: "ocean-blue-rashguard", description: "an ocean-blue short-sleeve athletic rashguard-style crew with a high closed neckline, fitted technical fabric", garmentType: "tee", dominantColor: "blue", subLanes: ["coastal-active", "performance-tops"] },
  { label: "teal-coastal-longsleeve", description: "a teal long-sleeve rashguard-style crew with a high closed neckline, fitted technical fabric for coastal sun", garmentType: "longsleeve", dominantColor: "teal", subLanes: ["coastal-active", "technical-layers"] },
  { label: "white-coastal-quarterzip", description: "a white short-sleeve athletic quarter-zip with the zipper closed to a high mock collar, coastal sun-protective knit", garmentType: "quarter-zip", dominantColor: "white", subLanes: ["coastal-active", "performance-tops"] },

  { label: "mountain-green-flannel", description: "a mountain-green plaid flannel overshirt buttoned over a plain grey tee, all buttons fastened", garmentType: "flannel", dominantColor: "green", subLanes: ["mountain-flannel", "hiking-shirts"] },
  { label: "rust-plaid-flannel", description: "a rust-and-charcoal plaid flannel overshirt buttoned over a plain ecru tee, all buttons fastened, warm trail layering", garmentType: "flannel", dominantColor: "rust", subLanes: ["mountain-flannel", "hiking-shirts"] },
  { label: "navy-plaid-flannel", description: "a navy-and-cream plaid flannel button-down, all buttons fastened, classic mountain casual", garmentType: "flannel", dominantColor: "navy", subLanes: ["mountain-flannel", "hiking-shirts"] },

  // Top-ups so every athletic-outdoor sub-lane has >=10 viable entries.
  { label: "surf-blue-rashguard", description: "a surf-blue short-sleeve athletic rashguard-style crew with a high closed neckline, fitted technical fabric", garmentType: "tee", dominantColor: "surf-blue", subLanes: ["coastal-active", "performance-tops"] },
  { label: "seafoam-coastal-tee", description: "a seafoam-green relaxed crew-neck performance tee with a high closed neckline, coastal trail energy", garmentType: "tee", dominantColor: "seafoam", subLanes: ["coastal-active", "trail-casual"] },
  { label: "sand-coastal-longsleeve", description: "a sand-colored long-sleeve sun-protective rashguard crew with a high closed neckline, coastal technical knit", garmentType: "longsleeve", dominantColor: "sand-coastal", subLanes: ["coastal-active", "technical-layers"] },
  { label: "coral-coastal-longsleeve", description: "a soft-coral long-sleeve rashguard-style crew with a high closed neckline, sun-protective coastal knit", garmentType: "longsleeve", dominantColor: "coral-coastal", subLanes: ["coastal-active", "performance-tops"] },
  { label: "driftwood-coastal-quarterzip", description: "a driftwood-taupe short-sleeve athletic quarter-zip with the zipper closed to a high mock collar, coastal sun-protective", garmentType: "quarter-zip", dominantColor: "driftwood", subLanes: ["coastal-active", "technical-layers"] },
  { label: "forest-flannel-shirt", description: "a deep-forest plaid flannel button-down with chest pockets, all buttons fastened, warm trail layering", garmentType: "flannel", dominantColor: "forest-plaid", subLanes: ["mountain-flannel", "hiking-shirts"] },
  { label: "mustard-mountain-flannel", description: "a mustard-and-charcoal plaid flannel overshirt buttoned over a plain ecru tee, all buttons fastened, warm mountain layering", garmentType: "flannel", dominantColor: "mustard-plaid", subLanes: ["mountain-flannel", "hiking-shirts"] },
  { label: "dark-stone-flannel", description: "a dark-stone plaid flannel button-down, all buttons fastened, refined mountain casual", garmentType: "flannel", dominantColor: "stone-plaid", subLanes: ["mountain-flannel", "hiking-shirts"] },
  { label: "moss-trail-buttondown", description: "a moss-green long-sleeve trail button-down with technical venting, all buttons fastened, structured outdoor cut", garmentType: "button-down", dominantColor: "moss", subLanes: ["hiking-shirts", "trail-casual"] },
];

const POOL_COZY_WARM: WardrobeEntry[] = [
  { label: "oatmeal-chunky-knit", description: "an oatmeal chunky-knit crew-neck sweater with a high closed neckline, cozy textured wool", garmentType: "sweater", dominantColor: "oatmeal", subLanes: ["chunky-knits", "cardigan-layered"] },
  { label: "ivory-cable-knit", description: "an ivory cable-knit crew-neck sweater with a high closed neckline, classic cozy texture", garmentType: "sweater", dominantColor: "ivory", subLanes: ["chunky-knits", "turtleneck-warm"] },
  { label: "lightgrey-marled-sweater", description: "a light-grey marled-yarn crew-neck sweater with a high closed neckline, textured cozy knit", garmentType: "sweater", dominantColor: "light-grey", subLanes: ["chunky-knits", "fleece-crewneck"] },
  { label: "ecru-oversized-sweater", description: "an ecru oversized crew-neck sweater with a high closed neckline, relaxed cozy silhouette", garmentType: "sweater", dominantColor: "ecru", subLanes: ["chunky-knits", "cardigan-layered"] },
  { label: "moss-cable-knit", description: "a moss-green cable-knit crew-neck sweater with a high closed neckline, textured cozy wool", garmentType: "sweater", dominantColor: "green", subLanes: ["chunky-knits", "plaid-flannel"] },
  { label: "navy-chunky-sweater", description: "a navy chunky-knit crew-neck sweater with a high closed neckline, warm textured wool", garmentType: "sweater", dominantColor: "navy", subLanes: ["chunky-knits", "turtleneck-warm"] },

  { label: "rust-henley", description: "a rust-orange long-sleeve henley with the placket fully buttoned, high closed neckline, soft brushed cotton", garmentType: "henley", dominantColor: "rust", subLanes: ["henley-thermal", "cardigan-layered"] },
  { label: "cream-waffle-thermal", description: "a cream waffle-knit long-sleeve thermal crew with a high closed neckline, soft cozy texture", garmentType: "longsleeve", dominantColor: "cream", subLanes: ["henley-thermal", "fleece-crewneck"] },
  { label: "toast-henley", description: "a toast-brown long-sleeve henley with the placket fully buttoned, high closed neckline, brushed cotton", garmentType: "henley", dominantColor: "toast-brown", subLanes: ["henley-thermal", "cardigan-layered"] },
  { label: "mustard-waffle-longsleeve", description: "a mustard-yellow waffle-knit long-sleeve crew with a high closed neckline, cozy textured layer", garmentType: "longsleeve", dominantColor: "mustard", subLanes: ["henley-thermal", "fleece-crewneck"] },
  { label: "olive-thermal-henley", description: "an olive waffle-knit long-sleeve henley with the placket fully buttoned, high closed neckline, cozy textured cotton", garmentType: "henley", dominantColor: "olive", subLanes: ["henley-thermal", "plaid-flannel"] },
  { label: "ivory-thermal-longsleeve", description: "an ivory waffle-knit long-sleeve crew with a high closed neckline, soft cozy layering", garmentType: "longsleeve", dominantColor: "ivory", subLanes: ["henley-thermal", "turtleneck-warm"] },

  { label: "camel-cardigan", description: "a camel chunky-knit cardigan buttoned over a plain ivory tee, all buttons fastened, cozy layered look", garmentType: "cardigan", dominantColor: "camel", subLanes: ["cardigan-layered", "chunky-knits"] },
  { label: "forest-wool-cardigan", description: "a forest-green wool cardigan buttoned over a plain cream tee, all buttons fastened, warm layered look", garmentType: "cardigan", dominantColor: "green", subLanes: ["cardigan-layered", "plaid-flannel"] },
  { label: "charcoal-knit-cardigan", description: "a charcoal chunky-knit cardigan buttoned over a plain white tee, all buttons fastened, cozy layered look", garmentType: "cardigan", dominantColor: "charcoal", subLanes: ["cardigan-layered", "henley-thermal"] },
  { label: "rust-knit-cardigan", description: "a rust chunky-knit cardigan buttoned over a plain cream tee, all buttons fastened, warm cozy layering", garmentType: "cardigan", dominantColor: "rust", subLanes: ["cardigan-layered", "henley-thermal"] },

  { label: "burgundy-fleece", description: "a burgundy fleece pullover sweatshirt with a high closed neckline, warm relaxed layer", garmentType: "fleece", dominantColor: "burgundy", subLanes: ["fleece-crewneck", "henley-thermal"] },
  { label: "heather-brown-crew", description: "a heather brown crew-neck sweatshirt with a high closed neckline, soft warm fleece", garmentType: "crewneck", dominantColor: "brown", subLanes: ["fleece-crewneck", "chunky-knits"] },
  { label: "terracotta-crewneck", description: "a terracotta crew-neck sweatshirt with a high closed neckline, soft warm fleece", garmentType: "crewneck", dominantColor: "terracotta", subLanes: ["fleece-crewneck", "henley-thermal"] },
  { label: "olive-fleece-crew", description: "an olive fleece crew-neck sweatshirt with a high closed neckline, soft warm relaxed fit", garmentType: "fleece", dominantColor: "olive", subLanes: ["fleece-crewneck", "plaid-flannel"] },

  { label: "mocha-turtleneck", description: "a mocha-brown fine-knit turtleneck with a high closed neckline, soft warm layering", garmentType: "turtleneck", dominantColor: "brown", subLanes: ["turtleneck-warm", "chunky-knits"] },
  { label: "cream-chunky-turtleneck", description: "a cream chunky-knit turtleneck with a high closed neckline, textured warm wool", garmentType: "turtleneck", dominantColor: "cream", subLanes: ["turtleneck-warm", "chunky-knits"] },
  { label: "rust-turtleneck", description: "a rust fine-knit turtleneck with a high closed neckline, soft warm autumn layering", garmentType: "turtleneck", dominantColor: "rust", subLanes: ["turtleneck-warm", "henley-thermal"] },
  { label: "charcoal-turtleneck", description: "a charcoal fine-knit turtleneck with a high closed neckline, cozy warm minimalism", garmentType: "turtleneck", dominantColor: "charcoal", subLanes: ["turtleneck-warm", "fleece-crewneck"] },

  { label: "olive-plaid-flannel", description: "an olive-and-cream plaid flannel button-down, all buttons fastened, warm relaxed casual", garmentType: "flannel", dominantColor: "olive", subLanes: ["plaid-flannel", "cardigan-layered"] },
  { label: "red-plaid-flannel", description: "a red-and-black plaid flannel button-down, all buttons fastened, classic warm casual layering", garmentType: "flannel", dominantColor: "red", subLanes: ["plaid-flannel", "fleece-crewneck"] },
  { label: "blue-plaid-flannel", description: "a blue-and-cream plaid flannel button-down, all buttons fastened, warm cozy casual", garmentType: "flannel", dominantColor: "blue", subLanes: ["plaid-flannel", "henley-thermal"] },

  // Top-ups so every cozy-warm sub-lane has >=10 viable entries.
  { label: "cream-soft-cardigan", description: "a cream soft-knit cardigan buttoned over an ivory long-sleeve crew with a high closed neckline, refined cozy layering", garmentType: "cardigan", dominantColor: "cream-cardi", subLanes: ["cardigan-layered", "plaid-flannel"] },
  { label: "terracotta-fleece-crew", description: "a terracotta-faded fleece crew-neck sweatshirt with a high closed neckline, warm casual cozy", garmentType: "fleece", dominantColor: "terracotta-fleece", subLanes: ["fleece-crewneck", "turtleneck-warm"] },
  { label: "ivory-soft-turtleneck", description: "an ivory soft-wool turtleneck pullover with a high closed neckline, warm minimal cozy", garmentType: "turtleneck", dominantColor: "ivory-turtle", subLanes: ["turtleneck-warm", "fleece-crewneck"] },
  { label: "ochre-warm-turtleneck", description: "an ochre fine-knit turtleneck pullover with a high closed neckline, warm earthy cozy", garmentType: "turtleneck", dominantColor: "ochre-turtle", subLanes: ["turtleneck-warm", "plaid-flannel"] },
  { label: "forest-plaid-flannel-warm", description: "a forest-green plaid flannel button-down, all buttons fastened, warm cozy weekend", garmentType: "flannel", dominantColor: "forest-plaid-warm", subLanes: ["plaid-flannel", "turtleneck-warm"] },
  { label: "brown-plaid-flannel-cozy", description: "a warm-brown plaid flannel button-down, all buttons fastened, cozy weekend layering", garmentType: "flannel", dominantColor: "brown-plaid", subLanes: ["plaid-flannel", "cardigan-layered"] },
];

const POOL_EDITORIAL_FASHION: WardrobeEntry[] = [
  { label: "structured-black-turtleneck", description: "a structured black fine-knit turtleneck with a high closed neckline, editorial minimal silhouette", garmentType: "turtleneck", dominantColor: "black", subLanes: ["structured-mockneck", "monochrome-editorial"] },
  { label: "navy-mockneck", description: "a minimalist navy fine-knit mockneck long-sleeve, high closed neckline, sleek editorial line", garmentType: "mockneck", dominantColor: "navy", subLanes: ["structured-mockneck", "architectural-knit"] },
  { label: "ivory-silk-mockneck", description: "an ivory silk-blend long-sleeve mockneck with a high closed neckline, minimal editorial drape", garmentType: "mockneck", dominantColor: "ivory", subLanes: ["structured-mockneck", "silk-and-satin"] },
  { label: "charcoal-mockneck-merino", description: "a charcoal fine-merino long-sleeve mockneck with a high closed neckline, sleek editorial knit", garmentType: "mockneck", dominantColor: "charcoal", subLanes: ["structured-mockneck", "architectural-knit"] },
  { label: "ecru-turtleneck-structured", description: "an ecru structured fine-knit turtleneck with a high closed neckline, sculptural editorial line", garmentType: "turtleneck", dominantColor: "ecru", subLanes: ["structured-mockneck", "monochrome-editorial"] },
  { label: "graphite-mockneck", description: "a graphite long-sleeve fine-knit mockneck with a high closed neckline, refined editorial cut", garmentType: "mockneck", dominantColor: "graphite", subLanes: ["structured-mockneck", "monochrome-editorial"] },

  { label: "cream-wool-coat-tee", description: "an oversized cream wool coat worn buttoned to the top over a plain black crew tee, editorial layering", garmentType: "coat", dominantColor: "cream", subLanes: ["tailored-overlayers", "monochrome-editorial"] },
  { label: "camel-blazer-silk-tee", description: "a camel relaxed-fit blazer worn over a plain ivory silk-blend tee, polished editorial layering", garmentType: "blazer", dominantColor: "camel", subLanes: ["tailored-overlayers", "silk-and-satin"] },
  { label: "black-tailored-overcoat", description: "an oversized black tailored overcoat worn buttoned over a plain black tee, sculptural editorial layering", garmentType: "coat", dominantColor: "black", subLanes: ["tailored-overlayers", "monochrome-editorial"] },
  { label: "charcoal-blazer-knit", description: "a charcoal architectural blazer worn over an ivory fine-knit crew, refined editorial layering", garmentType: "blazer", dominantColor: "charcoal", subLanes: ["tailored-overlayers", "architectural-knit"] },
  { label: "taupe-trench-knit", description: "a taupe long trench coat worn buttoned over a plain black knit crew, fluid editorial layering", garmentType: "coat", dominantColor: "taupe", subLanes: ["tailored-overlayers", "denim-editorial"] },

  { label: "ivory-silk-blouse", description: "an ivory silk long-sleeve blouse-style top with a high closed neckline, fluid editorial drape", garmentType: "blouse", dominantColor: "ivory", subLanes: ["silk-and-satin", "structured-mockneck"] },
  { label: "black-satin-buttondown", description: "a black satin long-sleeve button-down, all buttons fastened, glossy editorial finish", garmentType: "button-down", dominantColor: "black", subLanes: ["silk-and-satin", "monochrome-editorial"] },
  { label: "champagne-silk-shirt", description: "a champagne silk long-sleeve button-down, all buttons fastened, fluid editorial drape", garmentType: "button-down", dominantColor: "champagne", subLanes: ["silk-and-satin", "tailored-overlayers"] },
  { label: "navy-satin-blouse", description: "a navy satin long-sleeve blouse-style top with a high closed neckline, fluid editorial sheen", garmentType: "blouse", dominantColor: "navy", subLanes: ["silk-and-satin", "structured-mockneck"] },

  { label: "monochrome-tee-shirt-layer", description: "a black crew tee layered under a buttoned black long-sleeve overshirt, high closed neckline, all-black editorial", garmentType: "layered-tee", dominantColor: "black", subLanes: ["monochrome-editorial", "tailored-overlayers"] },
  { label: "charcoal-asymmetric-top", description: "a charcoal asymmetric long-sleeve top with a sculptural high closed neckline, editorial cut", garmentType: "longsleeve", dominantColor: "charcoal", subLanes: ["monochrome-editorial", "architectural-knit"] },
  { label: "beige-black-colorblock-tee", description: "a color-blocked beige-and-black long-sleeve crew with a high closed neckline, graphic editorial cut", garmentType: "longsleeve", dominantColor: "beige", subLanes: ["monochrome-editorial", "architectural-knit"] },
  { label: "all-cream-tee-layer", description: "a cream crew tee layered under a buttoned cream long-sleeve overshirt, high closed neckline, monochrome editorial", garmentType: "layered-tee", dominantColor: "cream", subLanes: ["monochrome-editorial", "tailored-overlayers"] },

  { label: "grey-wool-crew", description: "a structured medium-grey wool crew-neck sweater with a high closed neckline, refined editorial cut", garmentType: "sweater", dominantColor: "grey", subLanes: ["architectural-knit", "structured-mockneck"] },
  { label: "architectural-cream-knit", description: "a sculptural cream chunky-knit crew-neck sweater with an architectural high closed neckline, editorial texture", garmentType: "sweater", dominantColor: "cream", subLanes: ["architectural-knit", "monochrome-editorial"] },
  { label: "olive-boxy-tailored-shirt", description: "an olive boxy tailored long-sleeve shirt, all buttons fastened, architectural editorial silhouette", garmentType: "button-down", dominantColor: "olive", subLanes: ["architectural-knit", "denim-editorial"] },
  { label: "black-architectural-knit", description: "a black sculptural fine-knit crew-neck sweater with an architectural high closed neckline, sleek editorial line", garmentType: "sweater", dominantColor: "black", subLanes: ["architectural-knit", "monochrome-editorial"] },

  { label: "editorial-denim-shirt", description: "a deep-indigo Japanese-denim long-sleeve shirt, all buttons fastened, structured editorial workwear", garmentType: "button-down", dominantColor: "indigo", subLanes: ["denim-editorial", "architectural-knit"] },
  { label: "white-oxford-pin", description: "a crisp white oxford long-sleeve button-down with a discreet collar pin, all body buttons fastened", garmentType: "button-down", dominantColor: "white", subLanes: ["denim-editorial", "tailored-overlayers"] },
  { label: "raw-denim-shirt", description: "a raw indigo selvedge denim long-sleeve button-down, all buttons fastened, refined editorial workwear", garmentType: "button-down", dominantColor: "indigo", subLanes: ["denim-editorial", "tailored-overlayers"] },
  { label: "black-denim-editorial", description: "a black washed-denim long-sleeve button-down, all buttons fastened, sleek editorial workwear", garmentType: "button-down", dominantColor: "black", subLanes: ["denim-editorial", "monochrome-editorial"] },

  // Top-ups so every editorial-fashion sub-lane has >=10 viable entries.
  { label: "champagne-silk-mockneck", description: "a champagne silk-blend long-sleeve mockneck with a high closed neckline, fluid editorial sheen", garmentType: "mockneck", dominantColor: "champagne-mock", subLanes: ["silk-and-satin", "structured-mockneck"] },
  { label: "ivory-satin-blouse", description: "an ivory satin long-sleeve blouse-style top with a high closed neckline, glossy editorial drape", garmentType: "blouse", dominantColor: "ivory-satin", subLanes: ["silk-and-satin", "denim-editorial"] },
  { label: "graphite-silk-shirt", description: "a graphite silk long-sleeve button-down, all buttons fastened, fluid editorial sheen", garmentType: "button-down", dominantColor: "graphite-silk", subLanes: ["silk-and-satin", "denim-editorial"] },
  { label: "emerald-silk-shirt", description: "an emerald silk long-sleeve button-down, all buttons fastened, jewel-toned editorial drape", garmentType: "button-down", dominantColor: "emerald-silk", subLanes: ["silk-and-satin", "denim-editorial"] },
  { label: "black-denim-overshirt", description: "a black washed-denim overshirt buttoned over a plain black fine-knit mockneck, all buttons fastened, structured editorial workwear", garmentType: "overshirt", dominantColor: "black-denim-over", subLanes: ["denim-editorial", "structured-mockneck"] },
  { label: "faded-blue-denim-shirt", description: "a faded mid-blue washed-denim long-sleeve button-down, all buttons fastened, refined editorial workwear", garmentType: "button-down", dominantColor: "faded-denim", subLanes: ["denim-editorial", "structured-mockneck"] },
];

const POOL_MINIMALIST_PRO: WardrobeEntry[] = [
  { label: "white-oxford-buttondown", description: "a crisp white oxford long-sleeve button-down, all buttons fastened, sharp business-casual cut", garmentType: "button-down", dominantColor: "white", subLanes: ["crisp-shirting", "blazer-and-tee"] },
  { label: "lightblue-oxford", description: "a light-blue oxford long-sleeve button-down, all buttons fastened, classic clean business-casual", garmentType: "button-down", dominantColor: "light-blue", subLanes: ["crisp-shirting", "blazer-and-tee"] },
  { label: "white-linen-shortsleeve", description: "a white linen short-sleeve button-down, all buttons fastened, clean premium-casual cut", garmentType: "button-down", dominantColor: "white", subLanes: ["crisp-shirting", "fitted-tees"] },
  { label: "charcoal-oxford", description: "a charcoal oxford long-sleeve button-down, all buttons fastened, clean modern business-casual", garmentType: "button-down", dominantColor: "charcoal", subLanes: ["crisp-shirting", "blazer-and-tee"] },
  { label: "pale-grey-shirt", description: "a pale-grey poplin long-sleeve button-down, all buttons fastened, sharp clean business-casual cut", garmentType: "button-down", dominantColor: "light-grey", subLanes: ["crisp-shirting", "fine-knit"] },
  { label: "ecru-poplin-shirt", description: "an ecru poplin long-sleeve button-down, all buttons fastened, refined minimal business-casual cut", garmentType: "button-down", dominantColor: "ecru", subLanes: ["crisp-shirting", "polo-clean"] },

  { label: "crisp-white-tee", description: "a crisp white fitted crew-neck cotton t-shirt with a high closed neckline, clean minimal cut", garmentType: "tee", dominantColor: "white", subLanes: ["fitted-tees", "blazer-and-tee"] },
  { label: "black-fitted-tee", description: "a black fitted crew-neck premium cotton t-shirt with a high closed neckline, minimal modern cut", garmentType: "tee", dominantColor: "black", subLanes: ["fitted-tees", "blazer-and-tee"] },
  { label: "heather-grey-crewneck", description: "a heather-grey crew-neck sweatshirt with a high closed neckline, relaxed minimal professional", garmentType: "crewneck", dominantColor: "heather-grey", subLanes: ["fitted-tees", "fine-knit"] },
  { label: "navy-fitted-tee", description: "a navy fitted crew-neck premium cotton t-shirt with a high closed neckline, clean minimal cut", garmentType: "tee", dominantColor: "navy", subLanes: ["fitted-tees", "polo-clean"] },
  { label: "ecru-fitted-tee", description: "an ecru fitted crew-neck premium cotton t-shirt with a high closed neckline, soft clean minimalism", garmentType: "tee", dominantColor: "ecru", subLanes: ["fitted-tees", "fine-knit"] },

  { label: "lightgrey-crew-sweater", description: "a light-grey fine-knit crew-neck sweater with a high closed neckline, clean professional layer", garmentType: "sweater", dominantColor: "light-grey", subLanes: ["fine-knit", "blazer-and-tee"] },
  { label: "charcoal-mockneck", description: "a charcoal long-sleeve mockneck in fine merino-style knit with a high closed neckline, sleek and professional", garmentType: "mockneck", dominantColor: "charcoal", subLanes: ["fine-knit", "neutral-henley"] },
  { label: "ivory-merino-crew", description: "an ivory fine-merino crew-neck sweater with a high closed neckline, clean premium minimalism", garmentType: "sweater", dominantColor: "ivory", subLanes: ["fine-knit", "blazer-and-tee"] },
  { label: "black-turtleneck", description: "a clean black fine-knit turtleneck with a high closed neckline, minimal professional silhouette", garmentType: "turtleneck", dominantColor: "black", subLanes: ["fine-knit", "blazer-and-tee"] },
  { label: "navy-longsleeve-crew", description: "a navy long-sleeve fitted crew-neck with a high closed neckline, minimal professional layer", garmentType: "longsleeve", dominantColor: "navy", subLanes: ["fine-knit", "neutral-henley"] },
  { label: "stone-fineknit-crew", description: "a stone-grey fine-knit crew-neck sweater with a high closed neckline, refined minimal professional", garmentType: "sweater", dominantColor: "stone", subLanes: ["fine-knit", "polo-clean"] },

  { label: "navy-fitted-polo", description: "a navy fitted knit polo shirt with the top button fastened, sharp minimal silhouette", garmentType: "polo", dominantColor: "navy", subLanes: ["polo-clean", "crisp-shirting"] },
  { label: "stone-fineknit-polo", description: "a stone-grey fine-knit short-sleeve polo with the top button fastened, clean professional finish", garmentType: "polo", dominantColor: "stone", subLanes: ["polo-clean", "neutral-henley"] },
  { label: "white-clean-polo", description: "a crisp white fitted knit polo shirt with the top button fastened, sharp clean minimal cut", garmentType: "polo", dominantColor: "white", subLanes: ["polo-clean", "crisp-shirting"] },
  { label: "charcoal-clean-polo", description: "a charcoal fitted knit polo shirt with the top button fastened, clean professional silhouette", garmentType: "polo", dominantColor: "charcoal", subLanes: ["polo-clean", "fitted-tees"] },

  { label: "charcoal-blazer-white-tee", description: "a charcoal smart-casual unstructured blazer worn over a plain crisp-white crew-neck tee, polished professional", garmentType: "blazer", dominantColor: "charcoal", subLanes: ["blazer-and-tee", "fine-knit"] },
  { label: "navy-blazer-grey-knit", description: "a clean navy unstructured blazer worn over a light-grey fine-knit crew, polished professional layering", garmentType: "blazer", dominantColor: "navy", subLanes: ["blazer-and-tee", "fine-knit"] },
  { label: "black-blazer-fitted-tee", description: "a black unstructured blazer worn over a plain black fitted crew tee, sleek minimal professional", garmentType: "blazer", dominantColor: "black", subLanes: ["blazer-and-tee", "fitted-tees"] },
  { label: "stone-blazer-white-tee", description: "a stone unstructured blazer worn over a crisp white crew tee, refined minimal professional", garmentType: "blazer", dominantColor: "stone", subLanes: ["blazer-and-tee", "fitted-tees"] },

  { label: "taupe-soft-henley", description: "a soft taupe long-sleeve henley with the placket fully buttoned, high closed neckline, minimal clean cut", garmentType: "henley", dominantColor: "taupe", subLanes: ["neutral-henley", "fine-knit"] },
  { label: "charcoal-henley", description: "a charcoal long-sleeve henley with the placket fully buttoned, high closed neckline, clean minimal cotton", garmentType: "henley", dominantColor: "charcoal", subLanes: ["neutral-henley", "fitted-tees"] },
  { label: "ecru-henley", description: "an ecru long-sleeve henley with the placket fully buttoned, high closed neckline, refined minimal cotton", garmentType: "henley", dominantColor: "ecru", subLanes: ["neutral-henley", "fine-knit"] },
  { label: "olive-henley", description: "an olive long-sleeve henley with the placket fully buttoned, high closed neckline, clean minimal cotton", garmentType: "henley", dominantColor: "olive", subLanes: ["neutral-henley", "polo-clean"] },

  // Top-ups so every minimalist-pro sub-lane has >=10 viable entries.
  { label: "cream-crisp-shirt", description: "a cream poplin long-sleeve button-down, all buttons fastened, refined clean business-casual cut", garmentType: "button-down", dominantColor: "cream-poplin", subLanes: ["crisp-shirting", "polo-clean"] },
  { label: "navy-poplin-shirt", description: "a navy poplin long-sleeve button-down, all buttons fastened, sharp clean business-casual cut", garmentType: "button-down", dominantColor: "navy-poplin", subLanes: ["crisp-shirting", "neutral-henley"] },
  { label: "heather-grey-henley", description: "a heather-grey long-sleeve henley with the placket fully buttoned, high closed neckline, clean minimal cotton", garmentType: "henley", dominantColor: "heather-henley", subLanes: ["neutral-henley", "polo-clean"] },
  { label: "stone-henley", description: "a stone-grey long-sleeve henley with the placket fully buttoned, high closed neckline, refined minimal cotton", garmentType: "henley", dominantColor: "stone-henley", subLanes: ["neutral-henley", "crisp-shirting"] },
  { label: "graphite-henley", description: "a graphite long-sleeve henley with the placket fully buttoned, high closed neckline, sleek minimal cotton", garmentType: "henley", dominantColor: "graphite-henley", subLanes: ["neutral-henley", "polo-clean"] },
];

const WARDROBE_POOLS: Record<AestheticBucket, WardrobeEntry[]> = {
  "soft-luxury": POOL_SOFT_LUXURY,
  "bold-creator": POOL_BOLD_CREATOR,
  "athletic-outdoor": POOL_ATHLETIC_OUTDOOR,
  "cozy-warm": POOL_COZY_WARM,
  "editorial-fashion": POOL_EDITORIAL_FASHION,
  "minimalist-pro": POOL_MINIMALIST_PRO,
};

// ─────────────────────────────────────────────────────────────────────────────
// Vibe → bucket routing. Keyword rules first (most specific), then a
// fallback by inferred archetype so legacy free-text vibes still
// resolve. Order matters within rules: more specific keywords win.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_RULES: Array<{ bucket: AestheticBucket; keywords: RegExp }> = [
  { bucket: "soft-luxury", keywords: /\b(soft\s*luxury|quiet\s*(wealth|luxury)|understated|refined|elegant|luxur|premium|high.?end|elite|aspirational|polished\s*wealth)\b/i },
  { bucket: "editorial-fashion", keywords: /\b(editorial|fashion.?forward|magazine|runway|model|stylist|haute|designer)\b/i },
  { bucket: "athletic-outdoor", keywords: /\b(athletic|outdoors?|sun.?kissed|fit(?:ness)?|gym|adventure|active|sporty|hiking|surf|run(?:ner|ning)?)\b/i },
  { bucket: "cozy-warm", keywords: /\b(cozy|warm|relatable|homey|comfort|approachable|friendly|wholesome|hygge)\b/i },
  { bucket: "bold-creator", keywords: /\b(bold|high.?energy|creator|vibrant|loud|streetwear|hype|edgy|punchy)\b/i },
  { bucket: "minimalist-pro", keywords: /\b(minimal(?:ist)?|clean|professional|business|founder|exec(?:utive)?|polished|sleek|corporate)\b/i },
];

export function inferAestheticBucket(profile: CharacterProfile): AestheticBucket {
  const hay = `${profile.vibe} ${profile.notes ?? ""}`;
  for (const rule of BUCKET_RULES) {
    if (rule.keywords.test(hay)) return rule.bucket;
  }
  // Archetype-based fallback for vibes that didn't match a keyword.
  switch (profile.archetype) {
    case "luxury":
      return "soft-luxury";
    case "fashion":
    case "beauty":
      return "editorial-fashion";
    case "fitness":
    case "outdoor":
    case "travel":
      return "athletic-outdoor";
    case "business":
    case "tech":
      return "minimalist-pro";
    case "foodie":
    case "wellness":
      return "cozy-warm";
    case "creative":
      return "editorial-fashion";
    case "lifestyle":
    default:
      return "soft-luxury";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic per-influencer sampling.
//
// Seed comes from the influencer's DNA hash (randomized per generation
// in influencer-identity-dna.ts) so two users with identical dropdowns
// get different wardrobes. Falls back to identitySeed for legacy rows,
// and finally to a fresh random seed so we never silently collapse.
// ─────────────────────────────────────────────────────────────────────────────

function seedFromHex(hex: string): number {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const slice = (clean || "0").padEnd(8, "0").slice(0, 8);
  return parseInt(slice, 16) >>> 0;
}

function makeRng(seed: number): () => number {
  let state = (seed || 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick `count` entries from `pool` such that no two adjacent picks
 * share BOTH garmentType AND dominantColor (i.e. at least one of the
 * two differs). Uses depth-first backtracking over a deterministically-
 * shuffled candidate order so the result is fully replay-idempotent
 * for a given seed.
 *
 * Why "OR" instead of strict "AND-differ": sub-lane pools intentionally
 * concentrate on a thematic styling lane, which means same-garmentType
 * adjacencies are expected within a lane (e.g. multiple polos in the
 * knit-polo sub-lane). The previous strict rule required different
 * garmentType AND different color which made some sub-lane pools
 * un-pickable. The OR rule still rejects exact duplicates and
 * back-to-back identical looks while letting sub-lanes work.
 */
function pickWithAdjacency<T extends WardrobeEntry>(
  pool: T[],
  count: number,
  rng: () => number,
): T[] {
  const order = shuffle(pool, rng);
  const used = new Array<boolean>(order.length).fill(false);
  const picked: T[] = [];

  const ok = (last: T | undefined, cand: T): boolean =>
    !last || cand.garmentType !== last.garmentType || cand.dominantColor !== last.dominantColor;

  const backtrack = (slot: number): boolean => {
    if (slot === count) return true;
    const last = picked[slot - 1];
    for (let i = 0; i < order.length; i += 1) {
      if (used[i]) continue;
      const cand = order[i];
      if (!ok(last, cand)) continue;
      used[i] = true;
      picked.push(cand);
      if (backtrack(slot + 1)) return true;
      picked.pop();
      used[i] = false;
    }
    return false;
  };

  if (!backtrack(0)) {
    throw new Error(
      `pickWithAdjacency: could not satisfy adjacency constraint with pool of ${pool.length} for count ${count}`,
    );
  }
  return picked;
}

export type AngleWardrobeSelection = {
  bucket: AestheticBucket;
  subLane: string;
  entries: WardrobeEntry[];
  /** True when the chosen sub-lane had fewer entries than requested and the
   *  picker expanded to the full bucket pool. Always false in healthy
   *  operation; surfaced for observability / data-quality alerting. */
  subLaneFallback: boolean;
};

/**
 * Pick a sub-lane for this influencer from the bucket's catalog.
 * Deterministic on the seed: two influencers with the same DNA hash
 * resolve to the same sub-lane (idempotent replays), while two
 * influencers with different DNA hashes - including two users with
 * identical dropdowns - resolve to different sub-lanes most of the
 * time.
 *
 * Honors an optional pinned `preferred` sub-lane (used by the legacy
 * fallback path so an inferred profile remains stable on re-render).
 */
export function selectSubLane(
  bucket: AestheticBucket,
  seedHex: string,
  preferred?: string | null,
): string {
  const lanes = SUB_LANES_BY_BUCKET[bucket];
  if (preferred && lanes.includes(preferred)) return preferred;
  const rng = makeRng(seedFromHex(seedHex));
  return lanes[Math.floor(rng() * lanes.length) % lanes.length];
}

/**
 * Build the wardrobe lineup for an influencer's 10 identity angles.
 * Deterministic per-influencer (seeded by DNA hash) so re-runs and
 * idempotent replays produce the same mapping, but two influencers in
 * the same vibe get different sub-lanes (and therefore visibly
 * different wardrobe executions inside the same aesthetic bucket).
 *
 * The chosen sub-lane is sourced from `profile.selectedSubLane` when
 * persisted; otherwise it's resampled from the DNA hash (legacy rows).
 */
export function selectAngleWardrobes(
  profile: CharacterProfile,
  count = 10,
): AngleWardrobeSelection {
  const bucket = inferAestheticBucket(profile);
  const bucketPool = WARDROBE_POOLS[bucket];

  const seedSource =
    profile.dna?.hash ?? profile.identitySeed ?? crypto.randomBytes(4).toString("hex");
  const subLane = selectSubLane(bucket, seedSource, profile.selectedSubLane);

  // Filter the bucket pool to entries tagged with the chosen sub-lane.
  // The catalog above is authored so every (bucket, subLane) has >=10
  // viable entries. If a future edit ever leaves a sub-lane thin, we
  // surface it as a data-quality warning rather than silently expand
  // back to the full bucket and hide the regression.
  const filtered = bucketPool.filter((e) => e.subLanes.includes(subLane));
  let pool = filtered;
  let subLaneFallback = false;
  if (pool.length < count) {
    subLaneFallback = true;
    pool = bucketPool;
    logger.warn(
      {
        bucket,
        subLane,
        taggedEntries: filtered.length,
        required: count,
        bucketPoolSize: bucketPool.length,
      },
      "[wardrobe-sub-lane-deficit] sub-lane tagged pool below requested count; falling back to full bucket pool",
    );
  }

  // Use a downstream-seeded RNG (different from the sub-lane seed) so
  // the wardrobe shuffle inside the lane is not fully correlated with
  // the lane choice itself.
  const rng = makeRng(seedFromHex(seedSource) ^ 0xa1b2c3d4);
  const entries = pickWithAdjacency(pool, count, rng);
  return { bucket, subLane, entries, subLaneFallback };
}
