/* eslint-disable no-console */
/**
 * Styling-diversity verification + benchmark harness for T383.
 *
 * Run:  pnpm --filter @workspace/api-server exec tsx src/scripts/bench-styling-diversity.ts
 *
 * Scope:
 *   Simulates 10 distinct influencers built from IDENTICAL dropdown
 *   inputs (White / European / Male / Soft luxury, quiet wealth) and
 *   measures the diversity properties of every styling-execution layer
 *   above DNA - i.e. exactly what T383 changed:
 *
 *     - aesthetic bucket / sub-lane selection
 *     - 6-axis style variant ids (photo, fashion, lighting, camera,
 *       cinematic, facial)
 *     - 10-angle wardrobe selection (shirt type / dominant color /
 *       sub-lane breakdown)
 *     - scene preference tags
 *     - identity DNA traits (regression sanity)
 *
 *   Image-pixel benchmarks (Gemini / Higgsfield round-trips) are out
 *   of scope because they cost dollars per influencer and take ~20-30
 *   minutes per generation. The deterministic styling layer is what
 *   T383 actually changed, so it is the correct place to verify the
 *   "same dropdowns -> visibly different executions" property.
 */

import {
  generateIdentityDna,
  type IdentityDna,
} from "../lib/influencer-identity-dna";
import type { AiInfluencerJob } from "@workspace/db";
import {
  buildCharacterProfile,
  applyDnaSampledStyle,
  type CharacterProfile,
} from "../lib/influencer-character";
import {
  selectAngleWardrobes,
  type AngleWardrobeSelection,
} from "../lib/influencer-wardrobe";

// ─── inputs ─────────────────────────────────────────────────────────────────

const PREFS: AiInfluencerJob["prefs"] = {
  ageRange: "25-32",
  ethnicity: "white",
  gender: "male",
  vibe: "Soft luxury, quiet wealth",
  notes: null,
};
const N = 20;

// ─── helpers ────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function letterFor(i: number): string {
  return String.fromCharCode(65 + i);
}
function pct(num: number, denom: number): string {
  return `${((num / denom) * 100).toFixed(0)}%`;
}
function distinctCount<T>(xs: T[]): number {
  return new Set(xs.map((x) => JSON.stringify(x))).size;
}
function rule(width = 76): string {
  return "─".repeat(width);
}
function verdict(distinct: number, total: number, minGood = 0.6): string {
  const ratio = distinct / total;
  return ratio >= minGood ? "PASS" : ratio >= 0.4 ? "WARN" : "FAIL";
}
/** Cap-aware verdict: when the catalog only has `poolCap` distinct values
 *  to draw from, the realistic ceiling for "distinct in N samples" is
 *  min(N, poolCap). Compare against that, not the raw N. */
function verdictCapped(distinct: number, n: number, poolCap: number, minGood = 0.6): string {
  const ceiling = Math.min(n, poolCap);
  return verdict(distinct, ceiling, minGood);
}

type Profile = CharacterProfile & {
  wardrobe: AngleWardrobeSelection;
};

// ─── build 10 profiles with identical dropdowns ────────────────────────────

function buildBatch(): Profile[] {
  const out: Profile[] = [];
  for (let i = 0; i < N; i += 1) {
    let p = buildCharacterProfile(PREFS as any);
    // Simulate the route-layer flow: after buildCharacterProfile, the
    // jobs route attaches a freshly-randomized DNA and re-runs
    // applyDnaSampledStyle so the persisted brief is DNA-keyed.
    const dna = generateIdentityDna({
      gender: p.gender,
      ethnicity: p.ethnicity,
    });
    p = { ...p, dna };
    p = applyDnaSampledStyle(p, null);
    const wardrobe = selectAngleWardrobes(p, 10);
    out.push({ ...p, wardrobe } as Profile);
  }
  return out;
}

// ─── section 1: dropdown-aligned aesthetic preservation ─────────────────────

function reportVibeConsistency(ps: Profile[]) {
  console.log(rule());
  console.log(" 4. VIBE CONSISTENCY (premium / soft-luxury / editorial)");
  console.log(rule());
  const buckets = new Set(ps.map((p) => p.aestheticBucket));
  const qualityTiers = new Set(ps.map((p) => p.qualityTier));
  const realism = new Set(ps.map((p) => p.realismLevel));
  console.log(` aestheticBucket  : ${[...buckets].join(", ")}`);
  console.log(` qualityTier      : ${[...qualityTiers].join(", ")}`);
  console.log(` realismLevel     : ${[...realism].join(", ")}`);
  const allSoftLuxury = buckets.size === 1 && buckets.has("soft-luxury");
  const allPremium = qualityTiers.size === 1 && qualityTiers.has("premium");
  console.log(
    `   ${allSoftLuxury ? "PASS" : "FAIL"}  every profile stays inside the soft-luxury aesthetic boundary`,
  );
  console.log(
    `   ${allPremium ? "PASS" : "FAIL"}  every profile is qualityTier=premium`,
  );
  console.log("");
}

// ─── section 2: identity uniqueness (regression sanity for DNA) ────────────

function reportIdentityUniqueness(ps: Profile[]) {
  console.log(rule());
  console.log(" 1. IDENTITY UNIQUENESS (DNA-driven, regression sanity)");
  console.log(rule());
  const axes: Array<{ label: string; pick: (d: IdentityDna) => string; cap: number }> = [
    { label: "face shape (incl. length-ratio + forehead)", pick: (d) => `${d.faceShape}|${d.faceLengthRatio}|${d.foreheadProportion}|${d.faceWidth}`, cap: 99 },
    { label: "jawline + chin",      pick: (d) => `${d.jawline}|${d.chinShape}`, cap: 99 },
    { label: "cheekbones",          pick: (d) => `${d.cheekbones}`, cap: 14 },
    { label: "eyes (shape+spacing)",pick: (d) => `${d.eyes}|${d.eyeSpacing}|${d.eyeColor}`, cap: 99 },
    { label: "brows (style+density)", pick: (d) => `${d.eyebrows}|${d.browDensity}`, cap: 99 },
    { label: "nose",                pick: (d) => `${d.noseBridge}|${d.noseProfile}`, cap: 99 },
    { label: "lips + smile",        pick: (d) => `${d.lipFullness}|${d.smileStyle}`, cap: 99 },
    { label: "facial energy",       pick: (d) => `${d.facialEnergy}`, cap: 7 },
    { label: "skin texture",        pick: (d) => `${d.skinTexture}`, cap: 10 },
    { label: "ears",                pick: (d) => `${d.earVisibility}`, cap: 6 },
    { label: "neck (length+structure)", pick: (d) => `${d.neckLength}|${d.neckStructure}`, cap: 99 },
    { label: "asymmetry nuance",    pick: (d) => `${d.facialAsymmetry}`, cap: 6 },
    { label: "hair",                pick: (d) => `${d.hairStyle}|${d.hairColor}|${d.hairTexture}|${d.hairDensity}`, cap: 99 },
    { label: "expression",          pick: (d) => `${d.expressionBaseline}|${d.smileStyle}`, cap: 99 },
    { label: "body proportions",    pick: (d) => `${d.build}|${d.neckLength}`, cap: 99 },
  ];
  console.log(" axis                                   distinct (cap-aware)   verdict");
  console.log(" " + rule(68));
  for (const a of axes) {
    const xs = ps.map((p) => a.pick(p.dna!));
    const d = distinctCount(xs);
    const ceiling = Math.min(N, a.cap);
    console.log(`   ${pad(a.label, 38)} ${pad(`${d}/${ceiling}`, 12)}   ${verdictCapped(d, N, a.cap, 0.6)}`);
  }
  console.log("");
}

// ─── section 3: wardrobe diversity (T383 core) ─────────────────────────────

function reportWardrobeDiversity(ps: Profile[]) {
  console.log(rule());
  console.log(" 2. WARDROBE DIVERSITY (T383 core)");
  console.log(rule());

  // a) sub-lane diversity across influencers
  const subLanes = ps.map((p) => p.wardrobe.subLane);
  const fallbacks = ps.filter((p) => p.wardrobe.subLaneFallback).length;
  console.log(` sub-lane spread (across 10 influencers):`);
  const subLaneHist: Record<string, number> = {};
  for (const s of subLanes) subLaneHist[s] = (subLaneHist[s] ?? 0) + 1;
  for (const [lane, n] of Object.entries(subLaneHist).sort()) {
    console.log(`   ${pad(lane, 22)} ${"#".repeat(n)} (${n})`);
  }
  const subLaneDistinct = new Set(subLanes).size;
  console.log(
    `   distinct sub-lanes: ${subLaneDistinct}/6 available -> ${verdict(subLaneDistinct, 6, 0.5)}`,
  );
  console.log(
    `   sub-lane-fallback expansions: ${fallbacks}/${N} ${fallbacks === 0 ? "PASS" : "WARN (data-quality)"} `,
  );
  console.log("");

  // b) across-influencer 10-angle outfit-lineup diversity
  console.log(" 10-angle outfit lineups (per influencer):");
  console.log(" id  subLane                first-3 angles (label / garment / color)");
  console.log(" " + rule(72));
  ps.forEach((p, i) => {
    const sample = p.wardrobe.entries
      .slice(0, 3)
      .map((e) => `${e.label}[${e.garmentType}/${e.dominantColor}]`)
      .join("  ");
    console.log(`  ${letterFor(i)}  ${pad(p.wardrobe.subLane, 22)} ${sample}`);
  });
  console.log("");

  // c) cross-influencer diversity per axis
  // Soft-luxury bucket catalog caps (counted from influencer-wardrobe.ts):
  //   garmentType  : 13 distinct values across the pool
  //   sub-lane     : 6
  //   color tokens : 30+ (effectively uncapped at N=10*10 picks)
  //   labels       : 36 entries in the pool
  const axes: Array<{ label: string; cap: number; pick: (e: { garmentType: string; dominantColor: string; subLanes: readonly string[]; label: string }) => string }> = [
    { label: "shirt type (garmentType)",    cap: 13, pick: (e) => e.garmentType },
    { label: "dominant color",              cap: 30, pick: (e) => e.dominantColor },
    { label: "sub-lane tag",                cap: 6,  pick: (e) => e.subLanes[0] },
    { label: "exact wardrobe label",        cap: 36, pick: (e) => e.label },
  ];
  console.log(" axis                            distinct (cap-aware vs catalog ceiling)");
  console.log(" " + rule(72));
  for (const a of axes) {
    const all = ps.flatMap((p) => p.wardrobe.entries.map(a.pick));
    const d = new Set(all).size;
    const ceiling = Math.min(all.length, a.cap);
    console.log(
      `   ${pad(a.label, 32)} ${pad(`${d}/${ceiling}`, 12)} ${verdict(d, ceiling, 0.6)}`,
    );
  }

  // d) per-influencer within-lineup diversity (no influencer should
  //    wear 10 identical shirts)
  console.log("");
  console.log(" within-lineup variety (each influencer's own 10 picks):");
  console.log(" id  distinct labels  distinct garments  distinct colors");
  console.log(" " + rule(60));
  let allLineupsDiverse = true;
  ps.forEach((p, i) => {
    const labels = new Set(p.wardrobe.entries.map((e) => e.label)).size;
    const garments = new Set(p.wardrobe.entries.map((e) => e.garmentType)).size;
    const colors = new Set(p.wardrobe.entries.map((e) => e.dominantColor)).size;
    if (labels < 8 || garments < 3 || colors < 5) allLineupsDiverse = false;
    console.log(
      `  ${letterFor(i)}   ${pad(`${labels}/10`, 16)} ${pad(`${garments}/10`, 18)} ${colors}/10`,
    );
  });
  console.log(`   ${allLineupsDiverse ? "PASS" : "WARN"} every lineup keeps within-lineup variety`);
  console.log("");
}

// ─── section 4: composition / styling-variant fingerprints ─────────────────

function reportStylingVariants(ps: Profile[]) {
  console.log(rule());
  console.log(" 3. STYLING-VARIANT FINGERPRINTS (composition / lighting / camera)");
  console.log(rule());
  // Pool caps for the "luxury" archetype (the archetype "Soft luxury,
  // quiet wealth" maps to). Counted directly from
  // STYLE_POOLS_BY_ARCHETYPE.luxury in influencer-character.ts:
  //   photography:5  fashion:5  lighting:5  camera:5
  //   cinematic:3 (4 entries with one duplicated for warm-natural bias)
  //   facial:3
  const axes = [
    { key: "photographyVariantId", cap: 5 },
    { key: "fashionVariantId",     cap: 5 },
    { key: "lightingVariantId",    cap: 5 },
    { key: "cameraVariantId",      cap: 5 },
    { key: "cinematicVariantId",   cap: 3 },
    { key: "facialVariantId",      cap: 3 },
  ] as const;
  console.log(" id  photo fashion light camera cinematic facial   cinematicStyle");
  console.log(" " + rule(72));
  ps.forEach((p, i) => {
    const row = axes
      .map((a) => pad(String((p as Record<string, unknown>)[a.key] ?? "?"), a.key === "photographyVariantId" ? 5 : 7))
      .join(" ");
    console.log(`  ${letterFor(i)}   ${row}  ${p.cinematicStyle}`);
  });
  console.log("");
  console.log(" axis                  distinct (cap-aware vs pool ceiling)");
  console.log(" " + rule(54));
  for (const a of axes) {
    const xs = ps.map((p) => (p as Record<string, unknown>)[a.key]);
    const d = new Set(xs).size;
    const ceiling = Math.min(N, a.cap);
    console.log(`   ${pad(a.key, 22)} ${pad(`${d}/${ceiling}`, 12)}   ${verdictCapped(d, N, a.cap, 0.6)}`);
  }
  // scene-tag diversity
  const tagSets = ps.map((p) => p.scenePreferenceTags.join("|"));
  const distinctTagSets = new Set(tagSets).size;
  console.log(
    `   ${pad("scenePreferenceTags", 22)} ${pad(`${distinctTagSets}/${N}`, 12)}   ${verdict(distinctTagSets, N, 0.6)}`,
  );

  // also check that the resolved style STRINGS differ (not just the
  // ids) so we know the variant pools actually map to different text.
  console.log("");
  console.log(" resolved style-string diversity (the text the prompt actually sees):");
  const styleAxes = [
    "photographyStyle",
    "fashionStyle",
    "lightingStyle",
    "cameraStyle",
    "facialStructureTraits",
  ] as const;
  for (const a of styleAxes) {
    const xs = ps.map((p) => p[a]);
    const d = new Set(xs).size;
    console.log(`   ${pad(a, 22)} ${pad(`${d}/${N}`, 12)}   ${verdict(d, N, 0.4)}`);
  }
  console.log("");
}

// ─── section 5: pairwise collapse check ────────────────────────────────────

function reportPairwiseCollapse(ps: Profile[]) {
  console.log(rule());
  console.log(" PAIRWISE COLLAPSE CHECK (any two influencers with identical styling?)");
  console.log(rule());
  const fingerprint = (p: Profile) =>
    [
      p.aestheticBucket,
      p.wardrobe.subLane,
      p.photographyVariantId,
      p.fashionVariantId,
      p.lightingVariantId,
      p.cameraVariantId,
      p.cinematicVariantId,
      p.facialVariantId,
    ].join("|");
  const fps = ps.map(fingerprint);
  const uniq = new Set(fps).size;
  console.log(` distinct (bucket,subLane,6-variant) fingerprints: ${uniq}/${N}`);
  if (uniq < N) {
    console.log(" COLLISIONS:");
    const seen: Record<string, number[]> = {};
    fps.forEach((f, i) => {
      (seen[f] ??= []).push(i);
    });
    for (const [f, idxs] of Object.entries(seen)) {
      if (idxs.length > 1) {
        console.log(`   [${idxs.map(letterFor).join(", ")}]  ${f}`);
      }
    }
  } else {
    console.log("   PASS  no two influencers share the same styling fingerprint");
  }
  console.log("");
}

// ─── main ──────────────────────────────────────────────────────────────────

function main() {
  console.log("");
  console.log(rule());
  console.log(" T383 STYLING-DIVERSITY BENCHMARK");
  console.log(rule());
  console.log(
    ` Inputs : gender=${PREFS.gender} ethnicity=${PREFS.ethnicity} ageRange=${PREFS.ageRange}`,
  );
  console.log(`          vibe="${PREFS.vibe}"`);
  console.log(` N      : ${N} influencers with IDENTICAL dropdown selections`);
  console.log("");

  const ps = buildBatch();

  reportVibeConsistency(ps);
  reportIdentityUniqueness(ps);
  reportWardrobeDiversity(ps);
  reportStylingVariants(ps);
  reportPairwiseCollapse(ps);

  console.log(rule());
  console.log(" SCOPE NOTE");
  console.log(rule());
  console.log(
    " This harness measures the deterministic styling layer that T383 changed.",
  );
  console.log(
    " End-to-end checks (angle-identity preservation across the 10 rendered angles,",
  );
  console.log(
    " scene-swap face drift, category hydration, queue/delayed-UX, workspace",
  );
  console.log(
    " hydration, fallback-portrait leakage) require running paid OpenAI/Gemini",
  );
  console.log(
    " jobs and are NOT exercised here. They are validated separately at runtime.",
  );
  console.log("");
}

main();
