import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  briefIdentityClause,
  buildMasterIdentityPrompt,
  buildScenePlacementPrompt,
} from "./influencer-prompts.ts";
import { buildCharacterProfile } from "./influencer-character.ts";
import { generateIdentityDna } from "./influencer-identity-dna.ts";
import type { SceneTemplate } from "./influencer-scenes-library.ts";

function makeMaleAthleticProfile(overrides: Record<string, unknown> = {}) {
  return buildCharacterProfile({
    ageRange: "25-32",
    ethnicity: "white",
    gender: "male",
    vibe: "Athletic, outdoors, sun-kissed",
    notes: null,
    facialHair: "beard-stubble",
    hairstyle: "high-volume quiff",
    ...overrides,
  });
}

describe("briefIdentityClause", () => {
  it("front-loads age, gender, ethnicity, facial hair and hairstyle for a male brief", () => {
    const profile = makeMaleAthleticProfile();
    const clause = briefIdentityClause(profile);

    assert.match(clause, /BRIEF \(must hold across every image\)/);
    assert.match(clause, /apparent age 25 to 32/);
    assert.match(clause, /NOT 40\+/);
    assert.match(clause, /Gender: man/i);
    assert.match(clause, /Ethnicity: /);
    assert.match(clause, /Facial hair: beard-stubble/);
    assert.match(clause, /Hairstyle: high-volume quiff/);
  });

  it("emits explicit clean-shaven negation when a male brief picks clean shaven", () => {
    const profile = makeMaleAthleticProfile({ facialHair: "clean shaven" });
    const clause = briefIdentityClause(profile);
    assert.match(
      clause,
      /Facial hair: clean shaven \(no beard, no stubble, no mustache\)/,
    );
  });

  it("falls back to DNA beard style when facialHair is not user-pinned", () => {
    const profile = makeMaleAthleticProfile({ facialHair: null });
    const clause = briefIdentityClause(profile);
    assert.match(clause, /Facial hair: /);
  });
});

describe("AGE_DESCRIPTOR suppresses weathered language for young briefs", () => {
  it("18-24 brief has no weathered/aging language (only negations)", () => {
    const profile = makeMaleAthleticProfile({ ageRange: "18-24" });
    assert.match(profile.ageDescriptor, /early twenties/);
    // The descriptor may contain "No weathering. No aging texture." as
    // explicit negations - those are fine. What we want to rule out is
    // any *positive* instruction to add weathered features.
    assert.match(profile.ageDescriptor, /no weathering/i);
    assert.match(profile.ageDescriptor, /no aging texture/i);
    assert.doesNotMatch(profile.ageDescriptor, /\bweathered\b/i);
    assert.doesNotMatch(profile.ageDescriptor, /\bsun-bleached\b/i);
  });

  it("25-32 brief explicitly forbids 40+ and weathering", () => {
    const profile = makeMaleAthleticProfile({ ageRange: "25-32" });
    assert.match(profile.ageDescriptor, /NOT 40\+/);
    assert.match(profile.ageDescriptor, /no weathering/i);
    assert.match(profile.ageDescriptor, /no deep character lines/i);
    assert.doesNotMatch(profile.ageDescriptor, /\bweathered\b/i);
  });
});

describe("buildMasterIdentityPrompt", () => {
  it("front-loads briefIdentityClause before any styling language", () => {
    const profile = makeMaleAthleticProfile();
    const prompt = buildMasterIdentityPrompt(profile);
    const clause = briefIdentityClause(profile);
    assert.ok(prompt.includes(clause), "master prompt must include briefIdentityClause verbatim");
    const idxClause = prompt.indexOf(clause);
    const idxWardrobe = prompt.indexOf("WARDROBE");
    assert.ok(idxClause > -1 && idxWardrobe > -1 && idxClause < idxWardrobe);
  });
});

describe("buildScenePlacementPrompt", () => {
  it("front-loads briefIdentityClause in scene swaps", () => {
    const profile = makeMaleAthleticProfile();
    const scene = {
      id: "test-podcast",
      label: "Studio podcast set",
      category: "indoor",
      nicheAffinity: [],
      environmentType: "indoor podcast studio with warm lamps",
      cameraAngle: "eye-level medium shot",
      lensMm: 50,
      lightingStyle: "warm tungsten",
      aestheticTags: [],
      placementZone: "midground",
      realismScore: 0.6,
      genderHint: "any",
      prompt: () => "Podcast studio scene description.",
    } as unknown as SceneTemplate;
    const prompt = buildScenePlacementPrompt(profile, scene);
    assert.ok(prompt.includes(briefIdentityClause(profile)));
    assert.match(prompt, /beard-stubble/);
    assert.match(prompt, /high-volume quiff/);
  });

  it("repeats the promoted DNA invariants early in the scene placement prompt (Task #673)", () => {
    const base = makeMaleAthleticProfile();
    const dna = generateIdentityDna(
      {
        gender: base.gender,
        ethnicity: base.ethnicity,
        ageRange: base.ageRange,
        facialHair: base.facialHair ?? null,
        hairstyle: base.hairstyle ?? null,
      },
      `seed-task-673-scene`,
    );
    const profile = { ...base, dna };
    const scene = {
      id: "test-podcast",
      label: "Studio podcast set",
      category: "indoor",
      nicheAffinity: [],
      environmentType: "indoor podcast studio with warm lamps",
      cameraAngle: "eye-level medium shot",
      lensMm: 50,
      lightingStyle: "warm tungsten",
      aestheticTags: [],
      placementZone: "midground",
      realismScore: 0.6,
      genderHint: "any",
      prompt: () => "Podcast studio scene description.",
    } as unknown as SceneTemplate;
    const prompt = buildScenePlacementPrompt(profile, scene);
    const cutoff = Math.floor(prompt.length * 0.4);
    for (const needle of ["Eye color:", "Hair color:", "Eyebrows:", "Facial energy:"]) {
      const idx = prompt.indexOf(needle);
      assert.ok(
        idx > -1 && idx < cutoff,
        `Scene prompt missing or late-positioned "${needle}" (idx=${idx}, cutoff=${cutoff})`,
      );
    }
  });
});

describe("briefIdentityClause promotes high-drift DNA invariants (Task #673)", () => {
  it("emits eye color, hair color, brow density, facial energy and skin texture as discrete imperative lines when DNA is present", () => {
    const base = makeMaleAthleticProfile();
    const dna = generateIdentityDna(
      {
        gender: base.gender,
        ethnicity: base.ethnicity,
        ageRange: base.ageRange,
        facialHair: base.facialHair ?? null,
        hairstyle: base.hairstyle ?? null,
      },
      `seed-task-673-a`,
    );
    const profile = { ...base, dna };
    const clause = briefIdentityClause(profile);

    assert.match(clause, /Eye color: [^.]+\(must be clearly [^)]+\)/);
    assert.match(clause, /Hair color: [^.]+\(must be unmistakably [^)]+\)/);
    assert.match(clause, /Eyebrows: [^.]+density[^.]+\(eyebrows must be clearly visible/);
    assert.match(clause, /Facial energy: [^.]+\(do not drift/);
    assert.match(clause, /Skin micro-texture: /);
    assert.match(clause, /Hair shape detail: [^.]+ texture, [^.]+ density, [^.]+ colour/);
  });

  it("promoted invariants land in the first ~30% of the master prompt, not buried in the DNA tail", () => {
    const base = makeMaleAthleticProfile();
    const dna = generateIdentityDna(
      {
        gender: base.gender,
        ethnicity: base.ethnicity,
        ageRange: base.ageRange,
        facialHair: base.facialHair ?? null,
        hairstyle: base.hairstyle ?? null,
      } as Parameters<typeof generateIdentityDna>[0],
      `seed-task-673-b`,
    );
    const profile = { ...base, dna };
    const prompt = buildMasterIdentityPrompt(profile);
    const cutoff = Math.floor(prompt.length * 0.3);

    const eyeIdx = prompt.indexOf("Eye color:");
    const hairColorIdx = prompt.indexOf("Hair color:");
    const browIdx = prompt.indexOf("Eyebrows:");
    const energyIdx = prompt.indexOf("Facial energy:");
    const hairstyleIdx = prompt.indexOf("Hairstyle:");
    const ageIdx = prompt.indexOf("apparent age");

    assert.ok(eyeIdx > -1 && eyeIdx < cutoff, `Eye color line should be in first 30% but was at ${eyeIdx}/${prompt.length}`);
    assert.ok(hairColorIdx > -1 && hairColorIdx < cutoff, `Hair color line should be in first 30% but was at ${hairColorIdx}/${prompt.length}`);
    assert.ok(browIdx > -1 && browIdx < cutoff, `Eyebrows line should be in first 30%`);
    assert.ok(energyIdx > -1 && energyIdx < cutoff, `Facial energy line should be in first 30%`);
    assert.ok(hairstyleIdx > -1 && hairstyleIdx < cutoff, `Hairstyle line should be in first 30%`);
    assert.ok(ageIdx > -1 && ageIdx < cutoff, `Apparent age should be in first 30%`);
  });

  it("does not contradict notes-extracted hair/eye colour when present", () => {
    // When the user-supplied notes pin a colour, the renderExtractedTraitLines
    // output wins and the DNA-derived line is suppressed.
    const base = makeMaleAthleticProfile({
      notes: "jet black hair, deep brown eyes",
    });
    const dna = generateIdentityDna(
      {
        gender: base.gender,
        ethnicity: base.ethnicity,
        ageRange: base.ageRange,
        facialHair: base.facialHair ?? null,
        hairstyle: base.hairstyle ?? null,
      },
      `seed-task-673-c`,
    );
    const profile = { ...base, dna };
    const clause = briefIdentityClause(profile);

    // Notes-extracted lines use "Hair colour:" / "Eye colour:" (British).
    // DNA-promoted lines use "Hair color:" / "Eye color:" (American).
    // Only the British forms should appear when notes pin the colour.
    assert.match(clause, /Hair colour: /);
    assert.match(clause, /Eye colour: /);
    assert.doesNotMatch(clause, /Hair color: /);
    assert.doesNotMatch(clause, /Eye color: /);

    // Task #673 review fix - "Hair shape detail" must also drop the
    // DNA-sampled colour token when extracted hair colour wins, or
    // we ship two contradictory hair-colour instructions in the same
    // clause. Semantic check: no DNA hair-colour token should appear
    // anywhere in the clause once notes have pinned the colour.
    assert.doesNotMatch(clause, new RegExp(`\\b${dna.hairColor}\\b`, "i"));
    assert.doesNotMatch(clause, /Hair shape detail:[^.]* colour/);
    // And the extracted colour must still appear exactly once.
    const extractedMatches = clause.match(/jet[\s-]?black/gi) ?? [];
    assert.ok(
      extractedMatches.length >= 1,
      `expected the notes-pinned hair colour to be present, got ${extractedMatches.length} matches`,
    );
  });

  it("appends a fringe negation when the hairstyle mentions fringe or bangs", () => {
    const profile = makeMaleAthleticProfile({ hairstyle: "medium textured fringe" });
    const clause = briefIdentityClause(profile);
    assert.match(clause, /visible front fringe/);
    assert.match(clause, /no side-part/);
    assert.match(clause, /no receding hairline/);
    assert.match(clause, /no slicked-back cut/);
  });

  it("does not append a fringe negation for non-fringe cuts", () => {
    const profile = makeMaleAthleticProfile({ hairstyle: "high-volume quiff" });
    const clause = briefIdentityClause(profile);
    assert.doesNotMatch(clause, /visible front fringe/);
  });
});

describe("buildMasterIdentityPromptStrict inherits promoted DNA invariants (Task #673)", () => {
  it("strict-mode master prompt still front-loads eye / hair / brow / energy invariants", async () => {
    const { buildMasterIdentityPromptStrict } = await import("./influencer-prompts.js");
    const base = makeMaleAthleticProfile();
    const dna = generateIdentityDna(
      {
        gender: base.gender,
        ethnicity: base.ethnicity,
        ageRange: base.ageRange,
        facialHair: base.facialHair ?? null,
        hairstyle: base.hairstyle ?? null,
      },
      `seed-task-673-strict`,
    );
    const profile = { ...base, dna };
    const prompt = buildMasterIdentityPromptStrict(profile, "QA: previous render drifted to blue eyes");
    const cutoff = Math.floor(prompt.length * 0.4);
    for (const needle of ["Eye color:", "Hair color:", "Eyebrows:", "Facial energy:"]) {
      const idx = prompt.indexOf(needle);
      assert.ok(
        idx > -1 && idx < cutoff,
        `Strict prompt missing or late-positioned "${needle}" (idx=${idx}, cutoff=${cutoff})`,
      );
    }
  });
});

describe("AGE_DESCRIPTOR upper-bound negations are discrete sentences (Task #673)", () => {
  it("25-32 brief breaks NOT 40+ guard into its own sentence near the start", () => {
    const profile = makeMaleAthleticProfile({ ageRange: "25-32" });
    // The descriptor must contain discrete sentences (multiple "." chars),
    // and the upper-bound negations must appear as standalone clauses.
    const periods = (profile.ageDescriptor.match(/\./g) ?? []).length;
    assert.ok(periods >= 4, `Expected the 25-32 descriptor to be multi-sentence, got ${periods} periods`);
    assert.match(profile.ageDescriptor, /\. NOT 40\+\./);
    assert.match(profile.ageDescriptor, /No salt-and-pepper hair/);
    assert.match(profile.ageDescriptor, /No crow's feet/);
  });

  it("18-24 brief breaks NOT 30+ and NOT 40+ guards into discrete sentences", () => {
    const profile = makeMaleAthleticProfile({ ageRange: "18-24" });
    assert.match(profile.ageDescriptor, /\. NOT 30\+\./);
    assert.match(profile.ageDescriptor, /\. NOT 40\+\./);
  });
});

describe("DNA envelope locks beard style when overridden", () => {
  it("returns the user-pinned beard style on every reroll", () => {
    for (let i = 0; i < 5; i++) {
      const dna = generateIdentityDna(
        {
          gender: "male",
          ethnicity: "white",
          ageRange: "25-32",
          facialHair: "beard-stubble",
          hairstyle: "high-volume quiff",
        },
        `seed-${1000 + i}`,
      );
      assert.equal(dna.beardStyle, "beard-stubble");
      assert.equal(dna.hairStyle, "high-volume quiff");
    }
  });

  it("does not select aged facial energies for young briefs", () => {
    const agedRe = /(weathered|character lines|lived-in|sun-?bleached|forehead expression lines|aging texture)/i;
    for (let i = 0; i < 25; i++) {
      const dna = generateIdentityDna(
        {
          gender: "male",
          ethnicity: "white",
          ageRange: "25-32",
        },
        `seed-${7000 + i}`,
      );
      const blob = `${dna.facialEnergy ?? ""} ${dna.skinTexture ?? ""}`;
      assert.doesNotMatch(blob, agedRe, `DNA[${i}] leaked aged language: ${blob}`);
    }
  });
});
