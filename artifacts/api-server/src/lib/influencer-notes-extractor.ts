// ─────────────────────────────────────────────────────────────────────────────
// Smart identity-trait extractor for the "Anything else?" free-text field on
// the Personalise-your-influencer modal.
//
// The Generate modal stays minimal (we deliberately do NOT add dropdowns for
// hair colour, freckles, tattoos, etc.). Instead the user types whatever
// identity callouts they want into the notes field and this module parses
// them into a structured ExtractedIdentityTraits object that is:
//
//   1. folded back into CharacterProfile.facialHair / .hairstyle when the
//      user did not pin a dropdown value, so the DNA sampler, master prompt,
//      scene-swap prompts, retry prompts and QA scoring all converge on the
//      same canonical value;
//   2. persisted on CharacterProfile.extractedTraits so every downstream
//      prompt builder can render the traits as explicit identity-anchored
//      lines (hair colour, eye colour, freckles, tattoos, ...) instead of
//      dumping the raw notes string;
//   3. surfaced to QA scoring so the model can flag drift on the same
//      callouts the user typed.
//
// Pure regex / keyword based on purpose: no extra API calls, deterministic,
// fast enough to run on every job enqueue.
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractedIdentityTraits = {
  /** Maps onto one of PREF_FACIAL_HAIR_VALUES when confidently recognised
   *  (so the DNA sampler can pin it). Only populated when notes carry a
   *  facial-hair signal. */
  facialHair?: string;
  /** Maps onto one of PREF_HAIRSTYLE_VALUES when confidently recognised. */
  hairstyle?: string;
  /** Canonical hair colour phrase, e.g. "blonde", "auburn", "salt-and-pepper grey". */
  hairColor?: string;
  /** Canonical eye colour phrase, e.g. "blue", "hazel". */
  eyeColor?: string;
  /** Skin / face marks the user explicitly called out. */
  skinMarks?: string[];
  /** Verbatim tattoo callout, e.g. "sleeve tattoo on left arm". */
  tattoos?: string;
  /** Verbatim eyewear callout, e.g. "round black glasses". */
  glasses?: string;
  /** Piercing callouts, e.g. ["nose ring", "septum piercing"]. */
  piercings?: string[];
  /** Build callout, e.g. "tall and lean", "athletic". */
  build?: string;
  /** Other distinctive features, e.g. ["dimples", "strong jawline"]. */
  distinctive?: string[];
  /** Every recognised fragment (debug aid; persisted but not rendered). */
  rawHints: string[];
};

// ── Facial-hair lexicon ─────────────────────────────────────────────────────
// Keys are canonical PREF_FACIAL_HAIR_VALUES entries; patterns are matched
// case-insensitively. Order matters: more specific patterns win.
const FACIAL_HAIR_PATTERNS: Array<{ value: string; re: RegExp }> = [
  { value: "clean shaven", re: /\b(clean[\s-]?shaven|no\s+beard|no\s+facial\s+hair|bare\s+face)\b/i },
  { value: "goatee", re: /\bgoatee\b/i },
  { value: "mustache only", re: /\b(mustache|moustache)\s*(only)?\b/i },
  { value: "thick full beard", re: /\b(thick|heavy|long|bushy|full[\s-]?length)\s+(full\s+)?beard\b/i },
  { value: "medium full beard", re: /\b(full\s+beard|medium\s+beard|proper\s+beard)\b/i },
  { value: "short groomed beard", re: /\b(short|trimmed|groomed|neat|tidy)\s+beard\b/i },
  { value: "beard-stubble", re: /\b(slight|scruffy|scruff|short|patchy)\s+beard\b|\b(beard[\s-]?stubble|heavy\s+stubble|thick\s+stubble)\b/i },
  { value: "moderate stubble", re: /\b(moderate|medium)\s+stubble\b|\b3[\s-]?day\s+stubble\b/i },
  { value: "light stubble", re: /\b(light|slight|fine|short)\s+stubble\b|\b(stubble|scruff|5\s*o[\u2019']?clock\s*shadow)\b/i },
  // Bare "beard" with no qualifier - treat as a short groomed beard.
  { value: "short groomed beard", re: /\bbeard\b/i },
];

// ── Hairstyle lexicon ───────────────────────────────────────────────────────
const HAIRSTYLE_PATTERNS: Array<{ value: string; re: RegExp }> = [
  { value: "buzz cut", re: /\b(buzz[\s-]?cut|buzzed|shaved\s+head|bald|crew[\s-]?cut)\b/i },
  { value: "high-volume quiff", re: /\b(quiff|high[\s-]?volume\s+quiff)\b/i },
  { value: "textured pompadour", re: /\b(pompadour|pomp)\b/i },
  { value: "undercut with longer top", re: /\bundercut\b/i },
  { value: "low fade with textured top", re: /\b(low\s+fade|skin\s+fade|taper\s+fade|fade\s+haircut|fade)\b/i },
  { value: "comb-over with side part", re: /\b(comb[\s-]?over|side[\s-]?part(?:ed)?\s+hair|side\s+parting)\b/i },
  { value: "slicked-back short", re: /\b(slick(?:ed)?[\s-]?back|slick\s+back)\b/i },
  { value: "man bun shoulder-length", re: /\b(man\s+bun|top\s+knot|samurai\s+bun)\b/i },
  { value: "long ponytail", re: /\bponytail\b/i },
  { value: "curtain fringe medium", re: /\bcurtain\s+(fringe|bangs)\b|\bcurtains\b/i },
  { value: "messy fringe", re: /\b(messy|tousled)\s+(fringe|bangs)\b/i },
  { value: "modern fringe", re: /\b(fringe|bangs)\b/i },
  { value: "medium straight bob", re: /\bbob\s*(cut|hair)?\b/i },
  { value: "shoulder-length blunt cut", re: /\b(blunt\s+cut|blunt\s+bob)\b/i },
  { value: "medium textured lob", re: /\blob\b/i },
  { value: "natural curls long", re: /\b(long|long-?length)\s+(curls|curly\s+hair|afro|coils)\b/i },
  { value: "natural curls medium", re: /\b(curls|curly\s+hair|afro|coils|coily\s+hair|kinky\s+curls)\b/i },
  { value: "long beach waves", re: /\b(beach\s+waves|long\s+waves|wavy\s+long)\b/i },
  { value: "loose waves medium", re: /\b(loose\s+waves|waves|wavy)\b/i },
  { value: "long straight", re: /\b(long\s+straight\s+hair|long\s+straight|straight\s+long)\b/i },
  { value: "long shoulder-length", re: /\b(long\s+hair|shoulder[\s-]?length|past[\s-]?shoulder|mid[\s-]?back\s+hair)\b/i },
  { value: "medium soft layers", re: /\b(soft\s+layers|layered\s+hair|layers)\b/i },
  { value: "shoulder-length layered", re: /\b(shoulder[\s-]?length\s+layered)\b/i },
  { value: "medium textured crop", re: /\b(textured\s+crop|french\s+crop|crop\s+cut)\b/i },
  { value: "short tapered", re: /\b(short\s+tapered|short\s+taper|short\s+hair)\b/i },
  { value: "tousled medium", re: /\b(tousled|messy\s+hair|bedhead)\b/i },
  { value: "side-swept medium", re: /\b(side[\s-]?swept)\b/i },
];

// ── Hair colour lexicon ─────────────────────────────────────────────────────
const HAIR_COLOR_PATTERNS: Array<{ value: string; re: RegExp }> = [
  { value: "platinum blonde", re: /\b(platinum\s+blond(?:e)?|icy\s+blond(?:e)?|white\s+blond(?:e)?)\b/i },
  { value: "ash blonde", re: /\b(ash\s+blond(?:e)?|cool\s+blond(?:e)?)\b/i },
  { value: "honey blonde", re: /\b(honey\s+blond(?:e)?|golden\s+blond(?:e)?|sandy\s+blond(?:e)?|dirty\s+blond(?:e)?|caramel\s+blond(?:e)?|strawberry\s+blond(?:e)?)\b/i },
  { value: "blonde", re: /\bblond(?:e)?\b/i },
  { value: "jet black", re: /\b(jet[\s-]?black\s+hair|raven[\s-]?black|inky\s+black)\b/i },
  { value: "auburn", re: /\bauburn\b/i },
  { value: "ginger red", re: /\b(ginger|copper\s+red|copper\s+hair|red\s+head|redhead)\b/i },
  { value: "red", re: /\bred\s+hair\b/i },
  { value: "salt-and-pepper grey", re: /\b(salt[\s-]?and[\s-]?pepper|peppered\s+grey|peppered\s+gray)\b/i },
  { value: "silver grey", re: /\b(silver\s+hair|silver[\s-]?grey|silver[\s-]?gray)\b/i },
  { value: "grey", re: /\b(grey|gray)\s+hair\b|\bgrey[\s-]?haired\b|\bgray[\s-]?haired\b/i },
  { value: "white", re: /\bwhite\s+hair\b/i },
  { value: "dark brown", re: /\b(dark[\s-]?brown\s+hair|dark\s+brunette|chestnut\s+brown)\b/i },
  { value: "light brown", re: /\b(light[\s-]?brown\s+hair|mousy\s+brown|warm\s+brown)\b/i },
  { value: "brunette", re: /\b(brunette|brown\s+hair|chestnut)\b/i },
  { value: "black", re: /\b(black\s+hair|dark[\s-]?haired)\b/i },
];

// ── Eye colour lexicon ──────────────────────────────────────────────────────
const EYE_COLOR_PATTERNS: Array<{ value: string; re: RegExp }> = [
  { value: "icy blue", re: /\b(icy\s+blue|piercing\s+blue|crystal\s+blue|pale\s+blue)\s+eyes?\b/i },
  { value: "deep blue", re: /\b(deep\s+blue|navy\s+blue|dark\s+blue)\s+eyes?\b/i },
  { value: "blue", re: /\bblue[\s-]?eyed\b|\bblue\s+eyes?\b/i },
  { value: "emerald green", re: /\b(emerald\s+green|emerald)\s+eyes?\b/i },
  { value: "green", re: /\bgreen[\s-]?eyed\b|\bgreen\s+eyes?\b/i },
  { value: "hazel", re: /\bhazel[\s-]?eyed\b|\bhazel\s+eyes?\b/i },
  { value: "amber", re: /\bamber\s+eyes?\b/i },
  { value: "grey", re: /\b(grey|gray)[\s-]?eyed\b|\b(grey|gray)\s+eyes?\b/i },
  { value: "warm brown", re: /\b(warm\s+brown|honey\s+brown|chestnut\s+brown)\s+eyes?\b/i },
  { value: "dark brown", re: /\b(dark\s+brown|deep\s+brown|near[\s-]?black)\s+eyes?\b/i },
  { value: "brown", re: /\bbrown[\s-]?eyed\b|\bbrown\s+eyes?\b/i },
];

// ── Skin marks ──────────────────────────────────────────────────────────────
// Matches with optional intensity qualifier; emits a normalised phrase.
const SKIN_MARK_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: "freckles", re: /\b(heavy|dense|lots\s+of|many)\s+freckles\b/i },
  { tag: "light freckles across the nose and cheeks", re: /\b(light|subtle|faint|slight|a\s+few|some)\s+freckles\b/i },
  { tag: "freckles across the nose and cheeks", re: /\bfreckle[ds]?\b|\bfreckled\b/i },
  { tag: "small beauty mark on the cheek", re: /\b(beauty\s+mark|beauty\s+spot)\b/i },
  { tag: "small mole on the face", re: /\b(mole|moles)\b/i },
  { tag: "small scar on the face", re: /\b(scar|small\s+scar|facial\s+scar)\b/i },
  { tag: "dimples", re: /\b(dimples?|dimpled\s+cheeks)\b/i },
  { tag: "birthmark", re: /\bbirthmark\b/i },
];

// ── Piercings ───────────────────────────────────────────────────────────────
const PIERCING_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: "septum piercing", re: /\bseptum\s+(piercing|ring)?\b/i },
  { tag: "nose ring / stud", re: /\b(nose\s+(ring|stud|piercing))\b/i },
  { tag: "eyebrow piercing", re: /\beyebrow\s+piercing\b/i },
  { tag: "lip piercing", re: /\b(lip\s+piercing|labret)\b/i },
  { tag: "small ear piercings", re: /\b(ear\s+piercings?|earrings?)\b/i },
];

// ── Build ───────────────────────────────────────────────────────────────────
const BUILD_PATTERNS: Array<{ value: string; re: RegExp }> = [
  { value: "tall and athletic build", re: /\btall\s+and\s+athletic\b|\btall,\s+athletic\b/i },
  { value: "tall and lean build", re: /\btall\s+and\s+lean\b|\btall,\s+lean\b|\btall\s+slim\b/i },
  { value: "tall build", re: /\b(tall|6[\s-]?ft|6'[0-9]?|6\s*foot)\b/i },
  { value: "petite build", re: /\b(petite|short\s+in\s+height|small\s+frame|5[\s-]?ft\s+(0|1|2|3))\b/i },
  { value: "athletic and muscular build", re: /\b(very\s+muscular|jacked|ripped|buff|swole|bodybuilder)\b/i },
  { value: "athletic build", re: /\b(athletic\s+build|athletic\s+body|fit\s+build|gym\s+body)\b/i },
  { value: "muscular build", re: /\b(muscular|toned|defined\s+physique|strong\s+build)\b/i },
  { value: "lean build", re: /\b(lean|slim|slender|skinny|wiry)\b/i },
  { value: "curvy build", re: /\b(curvy|curvaceous|hourglass)\b/i },
  { value: "broad-shouldered build", re: /\bbroad[\s-]?shouldered\b|\bbroad\s+shoulders\b/i },
  { value: "stocky build", re: /\b(stocky|stout|thick[\s-]?set)\b/i },
];

// ── Distinctive features ───────────────────────────────────────────────────
const DISTINCTIVE_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: "strong defined jawline", re: /\b(strong|sharp|defined|chiseled|square)\s+(jaw|jawline)\b/i },
  { tag: "soft rounded jawline", re: /\b(soft|round(?:ed)?)\s+(jaw|jawline)\b/i },
  { tag: "high prominent cheekbones", re: /\b(high|prominent|sculpted|sharp)\s+cheekbones?\b/i },
  { tag: "cleft chin", re: /\b(cleft\s+chin|dimpled\s+chin)\b/i },
  { tag: "full lips", re: /\bfull\s+lips\b/i },
  { tag: "gap between front teeth", re: /\b(gap[\s-]?tooth|gap\s+teeth|tooth\s+gap)\b/i },
  { tag: "thick eyebrows", re: /\b(thick|bushy|bold|full)\s+eyebrows?\b/i },
  { tag: "long eyelashes", re: /\b(long|thick)\s+eyelashes\b/i },
];

function firstMatch<T extends { re: RegExp }>(
  notes: string,
  pool: T[],
): T | null {
  for (const entry of pool) {
    if (entry.re.test(notes)) return entry;
  }
  return null;
}

function collectMatches<T extends { re: RegExp; tag: string }>(
  notes: string,
  pool: T[],
): string[] {
  const out = new Set<string>();
  for (const entry of pool) {
    if (entry.re.test(notes)) out.add(entry.tag);
  }
  return [...out];
}

function extractTattoos(notes: string): string | undefined {
  if (!/\b(tattoo|tatt|inked|sleeve|sleeved|ink\s+work)\b/i.test(notes)) return undefined;
  // Capture a short descriptive phrase around the tattoo keyword so the
  // prompt reads naturally. We grab up to ~80 chars of context, trim
  // sentence boundaries, and fall back to a generic phrase if nothing
  // structured is recognisable.
  const re = /([\w\s,'-]{0,40})\b(sleeve\s+tattoo|neck\s+tattoo|hand\s+tattoo|face\s+tattoo|chest\s+tattoo|tattoos?|tatt(?:s|ed)?|inked|ink\s+work)\b([\w\s,'-]{0,40})/i;
  const m = notes.match(re);
  if (!m) return "visible tattoos";
  const phrase = `${m[1] ?? ""}${m[2]}${m[3] ?? ""}`.replace(/\s+/g, " ").trim();
  // Cap the phrase length so it can't dominate the brief.
  return phrase.length > 80 ? phrase.slice(0, 77) + "..." : phrase;
}

function extractGlasses(notes: string): string | undefined {
  if (!/\b(glasses|spectacles|eyewear|specs)\b/i.test(notes)) return undefined;
  // Sunglasses are a wardrobe prop, not an identity trait, so exclude
  // them from glasses extraction.
  if (/\bsunglasses\b/i.test(notes) && !/\b(prescription|reading|round|square|wire|frame)\s+glasses\b/i.test(notes)) {
    return undefined;
  }
  const re = /([\w\s'-]{0,20})\b(glasses|spectacles|eyewear|specs)\b/i;
  const m = notes.match(re);
  if (!m) return "wears glasses";
  const phrase = `${m[1] ?? ""}${m[2]}`.replace(/\s+/g, " ").trim();
  return phrase.length > 60 ? phrase.slice(0, 57) + "..." : `wears ${phrase}`;
}

export function extractIdentityTraits(
  notes: string | null | undefined,
): ExtractedIdentityTraits | null {
  if (!notes) return null;
  const text = notes.trim();
  if (!text) return null;

  const rawHints: string[] = [];
  const traits: ExtractedIdentityTraits = { rawHints };

  const facial = firstMatch(text, FACIAL_HAIR_PATTERNS);
  if (facial) {
    traits.facialHair = facial.value;
    rawHints.push(`facialHair=${facial.value}`);
  }

  const hair = firstMatch(text, HAIRSTYLE_PATTERNS);
  if (hair) {
    traits.hairstyle = hair.value;
    rawHints.push(`hairstyle=${hair.value}`);
  }

  const hairColor = firstMatch(text, HAIR_COLOR_PATTERNS);
  if (hairColor) {
    traits.hairColor = hairColor.value;
    rawHints.push(`hairColor=${hairColor.value}`);
  }

  const eyeColor = firstMatch(text, EYE_COLOR_PATTERNS);
  if (eyeColor) {
    traits.eyeColor = eyeColor.value;
    rawHints.push(`eyeColor=${eyeColor.value}`);
  }

  const skinMarks = collectMatches(text, SKIN_MARK_PATTERNS);
  if (skinMarks.length > 0) {
    // Dedupe near-duplicates (e.g. "freckles" + "light freckles..." both
    // matching) by preferring the most specific freckle phrase.
    const dedup = dedupeFreckles(skinMarks);
    traits.skinMarks = dedup;
    rawHints.push(...dedup.map((s) => `skinMark=${s}`));
  }

  const tattoos = extractTattoos(text);
  if (tattoos) {
    traits.tattoos = tattoos;
    rawHints.push(`tattoos=${tattoos}`);
  }

  const glasses = extractGlasses(text);
  if (glasses) {
    traits.glasses = glasses;
    rawHints.push(`glasses=${glasses}`);
  }

  const piercings = collectMatches(text, PIERCING_PATTERNS);
  if (piercings.length > 0) {
    traits.piercings = piercings;
    rawHints.push(...piercings.map((p) => `piercing=${p}`));
  }

  const build = firstMatch(text, BUILD_PATTERNS);
  if (build) {
    traits.build = build.value;
    rawHints.push(`build=${build.value}`);
  }

  const distinctive = collectMatches(text, DISTINCTIVE_PATTERNS);
  if (distinctive.length > 0) {
    traits.distinctive = distinctive;
    rawHints.push(...distinctive.map((d) => `distinctive=${d}`));
  }

  return rawHints.length > 0 ? traits : null;
}

function dedupeFreckles(marks: string[]): string[] {
  const hasSpecific = marks.some(
    (m) => m.includes("light freckles") || m === "freckles",
  );
  if (!hasSpecific) return marks;
  // If we caught both a specific freckle phrase and the generic
  // "freckles across the nose and cheeks", keep only the most specific.
  const filtered = marks.filter((m) => m !== "freckles across the nose and cheeks");
  return filtered.length > 0 ? filtered : marks;
}

/**
 * Render the extracted traits as discrete identity-anchored prompt lines.
 * The result is folded into briefIdentityClause and repeated verbatim in
 * every scene placement / strict retry prompt so the model treats these
 * callouts as identity invariants, not optional flavour.
 *
 * Returns an empty array when there is nothing to render.
 */
export function renderExtractedTraitLines(
  traits: ExtractedIdentityTraits | null | undefined,
): string[] {
  if (!traits) return [];
  const lines: string[] = [];
  if (traits.hairColor) lines.push(`Hair colour: ${traits.hairColor} (must hold across every image).`);
  if (traits.eyeColor) lines.push(`Eye colour: ${traits.eyeColor} (must hold across every image).`);
  if (traits.skinMarks && traits.skinMarks.length > 0) {
    lines.push(`Skin features: ${traits.skinMarks.join(", ")} (must be present and visible).`);
  }
  if (traits.tattoos) lines.push(`Tattoos: ${traits.tattoos} (must be present and visible if framing allows).`);
  if (traits.glasses) lines.push(`Eyewear: ${traits.glasses} (must be present).`);
  if (traits.piercings && traits.piercings.length > 0) {
    lines.push(`Piercings: ${traits.piercings.join(", ")} (must be present).`);
  }
  if (traits.build) lines.push(`Build: ${traits.build} (must hold across every image).`);
  if (traits.distinctive && traits.distinctive.length > 0) {
    lines.push(`Distinctive features: ${traits.distinctive.join(", ")} (must hold across every image).`);
  }
  return lines;
}

/** Compact one-line summary for QA briefs and logs. */
export function summarizeExtractedTraits(
  traits: ExtractedIdentityTraits | null | undefined,
): string | null {
  if (!traits) return null;
  const parts: string[] = [];
  if (traits.hairColor) parts.push(`hair=${traits.hairColor}`);
  if (traits.eyeColor) parts.push(`eyes=${traits.eyeColor}`);
  if (traits.skinMarks?.length) parts.push(`skin=${traits.skinMarks.join("/")}`);
  if (traits.tattoos) parts.push(`tattoos=${traits.tattoos}`);
  if (traits.glasses) parts.push(`glasses=${traits.glasses}`);
  if (traits.piercings?.length) parts.push(`piercings=${traits.piercings.join("/")}`);
  if (traits.build) parts.push(`build=${traits.build}`);
  if (traits.distinctive?.length) parts.push(`distinctive=${traits.distinctive.join("/")}`);
  return parts.length > 0 ? parts.join("; ") : null;
}
