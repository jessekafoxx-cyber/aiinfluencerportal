// ─────────────────────────────────────────────────────────────────────────────
// Task #673 - manual smoke harness for the AI Influencer base-image prompt.
//
// Builds the master prompt for a handful of representative fixture profiles
// and (when HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET, or HIGGSFIELD_API_KEY,
// are set) dispatches each one to Higgsfield Soul / text2image. The script
// is intentionally manual-only - it does NOT run in CI - because the goal
// is for a human to eyeball the generated base images and confirm the DNA
// invariants (age, eye colour, hair colour, fringe, brow density, facial
// energy) actually hold.
//
// Usage:
//   pnpm --filter @workspace/scripts run smoke:influencer-base
//     # default: prints the master prompt for each fixture, exits 0
//     # without calling Higgsfield. Safe to run without API keys.
//
//   DISPATCH=1 pnpm --filter @workspace/scripts run smoke:influencer-base
//     # POSTs each prompt to /v1/text2image/soul and prints the
//     # provider request_id so you can fetch the result later.
//
//   DISPATCH=1 POLL=1 pnpm --filter @workspace/scripts run smoke:influencer-base
//     # also polls /v1/job-sets/{id} for up to ~5 minutes per fixture
//     # and writes the resulting image URLs into the report.
//
// All output (prompts, dispatch ids, image urls, markdown report) is
// written to `tmp/smoke-influencer-base/<run-ts>/` so the run history
// is preserved across invocations.
//
// Reviewer workflow:
//   1. Run `DISPATCH=1 POLL=1 pnpm --filter @workspace/scripts run smoke:influencer-base`
//      with real Higgsfield keys in env.
//   2. Open `tmp/smoke-influencer-base/<run-ts>/report.md` in the
//      preview pane; each fixture renders inline against its saved
//      `<slug>.<ext>` image.
//   3. Fill in the rendered columns of the "Intended vs rendered DNA
//      per image" table at the bottom of the report by eyeballing
//      each saved image (age band, eye colour, hair colour, fringe
//      yes/no, brow density, facial energy).
//   4. Acceptance threshold for Task #673: at least 4 of 5 fixtures
//      must hit every promoted invariant. The canonical regression
//      brief (`male-25-32-fringe-grey-eyes`) MUST hit.
//   5. Attach the filled-in report.md as evidence on the task and
//      iterate `briefIdentityClause` wording if the threshold misses.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildCharacterProfile } from "../../artifacts/api-server/src/lib/influencer-character.ts";
import { generateIdentityDna } from "../../artifacts/api-server/src/lib/influencer-identity-dna.ts";
import { buildMasterIdentityPrompt } from "../../artifacts/api-server/src/lib/influencer-prompts.ts";
import {
  HIGGSFIELD_BASE_URL,
  higgsfieldHeaders,
} from "../../artifacts/api-server/src/lib/higgsfield-auth.ts";
import type { AiInfluencerJob } from "@workspace/db";

type FixturePrefs = AiInfluencerJob["prefs"] & {
  facialHair?: string | null;
  hairstyle?: string | null;
};

type Fixture = {
  slug: string;
  description: string;
  prefs: FixturePrefs;
};

const FIXTURES: Fixture[] = [
  {
    slug: "male-25-32-fringe-grey-eyes",
    description:
      "The Task #673 canonical regression: 25-32 white male, medium-brown textured fringe, grey eyes. " +
      "Previously drifted to 40+ blue eyes / dark slicked hair.",
    prefs: {
      ageRange: "25-32",
      ethnicity: "white",
      gender: "male",
      vibe: "Calm, considered, founder energy",
      notes: "grey eyes, medium brown hair, soft warm gaze",
      facialHair: "clean shaven",
      hairstyle: "medium textured fringe falling across the forehead",
    },
  },
  {
    slug: "male-25-32-quiff-beard-stubble",
    description:
      "25-32 white male, high-volume quiff, beard-stubble. Control for the fringe case " +
      "(should NOT trigger the fringe negation).",
    prefs: {
      ageRange: "25-32",
      ethnicity: "white",
      gender: "male",
      vibe: "Athletic, outdoors, sun-kissed",
      notes: null,
      facialHair: "beard-stubble",
      hairstyle: "high-volume quiff",
    },
  },
  {
    slug: "female-18-24-bangs",
    description:
      "18-24 east-asian female with blunt bangs. Verifies the fringe negation fires on " +
      "the female / bangs synonym path and that NOT 30+ / NOT 40+ guards hold.",
    prefs: {
      ageRange: "18-24",
      ethnicity: "east_asian",
      gender: "female",
      vibe: "Bright, considered, beauty creator",
      notes: null,
      facialHair: "clean shaven",
      hairstyle: "blunt fringe / bangs to the eyebrows",
    },
  },
  {
    slug: "male-33-40-hispanic-full-beard",
    description:
      "Older male brief with a full beard - sanity check that the discrete-sentence " +
      "AGE_DESCRIPTOR refactor did not regress middle-age briefs.",
    prefs: {
      ageRange: "33-40",
      ethnicity: "hispanic_latino",
      gender: "male",
      vibe: "Founder-CEO, premium minimalism",
      notes: null,
      facialHair: "full beard",
      hairstyle: "short side-swept cut",
    },
  },
  {
    slug: "female-25-32-black-natural-fro",
    description:
      "25-32 black female with natural afro. Verifies the DNA hair-colour / brow / facial " +
      "energy invariants render correctly for non-european envelopes.",
    prefs: {
      ageRange: "25-32",
      ethnicity: "black",
      gender: "female",
      vibe: "Editorial fashion, magazine cover",
      notes: null,
      facialHair: "clean shaven",
      hairstyle: "natural rounded afro at medium length",
    },
  },
];

// HIGGSFIELD_BASE_URL + higgsfieldHeaders() are imported from
// `artifacts/api-server/src/lib/higgsfield-auth.ts` so this script
// uses the same auth scheme (dual-key headers + bearer fallback) as
// the production dispatch path in influencer-pipeline.ts.

async function dispatchOne(prompt: string, headers: Record<string, string>): Promise<{ requestId: string | null; error?: string }> {
  const res = await fetch(`${HIGGSFIELD_BASE_URL}/v1/text2image/soul`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      params: {
        prompt,
        width_and_height: "1536x1536",
        quality: "1080p",
        batch_size: 1,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { requestId: null, error: `${res.status} ${text.slice(0, 300)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; request_id?: string };
  return { requestId: json.request_id ?? json.id ?? null };
}

async function pollOne(
  requestId: string,
  headers: Record<string, string>,
  maxAttempts = 60,
  delayMs = 5_000,
): Promise<{ imageUrl: string | null; status: string }> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await fetch(`${HIGGSFIELD_BASE_URL}/v1/job-sets/${requestId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      jobs?: Array<{ status?: string; results?: { raw?: { url?: string }; min?: { url?: string } } }>;
    };
    const status = json.status ?? json.jobs?.[0]?.status ?? "unknown";
    const url = json.jobs?.[0]?.results?.raw?.url ?? json.jobs?.[0]?.results?.min?.url ?? null;
    if (url) return { imageUrl: url, status };
    if (status === "failed" || status === "canceled") return { imageUrl: null, status };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { imageUrl: null, status: "timeout" };
}

async function main() {
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join("tmp", "smoke-influencer-base", runTs);
  await mkdir(outDir, { recursive: true });

  const dispatch = process.env.DISPATCH === "1";
  const poll = process.env.POLL === "1";
  const headers = dispatch ? higgsfieldHeaders() : null;
  if (dispatch && !headers) {
    console.error(
      "DISPATCH=1 set but no Higgsfield credentials in env (HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET, or HIGGSFIELD_API_KEY). Aborting.",
    );
    process.exit(1);
  }

  const report: string[] = [];
  const summaryRows: Array<{
    slug: string;
    intendedAge: string;
    intendedEye: string;
    intendedHair: string;
    intendedFringe: string;
    intendedBrow: string;
    intendedEnergy: string;
    requestId: string;
    imagePath: string;
  }> = [];
  report.push(`# Influencer base-image smoke run\n`);
  report.push(`Run timestamp: ${runTs}\n`);
  report.push(`Dispatch enabled: ${dispatch}\n`);
  report.push(`Poll enabled: ${poll}\n`);
  report.push(`\n---\n`);

  for (const fixture of FIXTURES) {
    console.log(`\n=== fixture: ${fixture.slug} ===`);
    console.log(fixture.description);

    // Build the character profile and stamp a deterministic DNA on it
    // so re-runs of the same fixture produce identical prompts.
    const baseProfile = buildCharacterProfile(fixture.prefs);
    const dna = generateIdentityDna(
      {
        gender: baseProfile.gender,
        ethnicity: baseProfile.ethnicity,
        ageRange: baseProfile.ageRange,
        facialHair: baseProfile.facialHair ?? null,
        hairstyle: baseProfile.hairstyle ?? null,
      },
      `smoke-${fixture.slug}`,
    );
    const profile = { ...baseProfile, dna };
    const prompt = buildMasterIdentityPrompt(profile);

    await writeFile(join(outDir, `${fixture.slug}.prompt.txt`), prompt, "utf8");
    const fringeIntended = /\b(fringe|bangs?)\b/i.test(profile.hairstyle ?? "") ? "yes" : "no";
    const row = {
      slug: fixture.slug,
      intendedAge: profile.ageRange,
      intendedEye: dna.eyeColor,
      intendedHair: dna.hairColor,
      intendedFringe: fringeIntended,
      intendedBrow: dna.browDensity,
      intendedEnergy: dna.facialEnergy,
      requestId: "(dispatch skipped)",
      imagePath: "n/a",
    };
    report.push(`## ${fixture.slug}\n`);
    report.push(`${fixture.description}\n`);
    report.push(`\n**DNA:** age=${profile.ageRange}; eye=${dna.eyeColor}; hair=${dna.hairColor}; brow=${dna.browDensity}; energy=${dna.facialEnergy}; fringe-requested=${fringeIntended}\n`);
    report.push(`\n**Prompt:**\n\n\`\`\`text\n${prompt}\n\`\`\`\n`);

    if (!dispatch || !headers) {
      console.log(`prompt written to ${outDir}/${fixture.slug}.prompt.txt (dispatch skipped)`);
      summaryRows.push(row);
      continue;
    }

    const { requestId, error } = await dispatchOne(prompt, headers);
    if (error || !requestId) {
      console.error(`dispatch failed: ${error ?? "no request_id"}`);
      report.push(`\n**Dispatch FAILED:** \`${error ?? "no request_id"}\`\n`);
      row.requestId = `FAILED: ${error ?? "no request_id"}`;
      summaryRows.push(row);
      continue;
    }
    console.log(`dispatched: request_id=${requestId}`);
    report.push(`\n**Dispatch:** request_id=\`${requestId}\`\n`);
    row.requestId = requestId;

    if (!poll) {
      summaryRows.push(row);
      continue;
    }
    const { imageUrl, status } = await pollOne(requestId, headers);
    console.log(`poll result: status=${status}, url=${imageUrl ?? "n/a"}`);
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ext = (imageUrl.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
          const localPath = join(outDir, `${fixture.slug}.${ext}`);
          await writeFile(localPath, buf);
          row.imagePath = localPath;
          report.push(
            `\n**Result:** status=\`${status}\`, image=\`${localPath}\` (also: [remote](${imageUrl}))\n`,
          );
          report.push(`\n![${fixture.slug}](${fixture.slug}.${ext})\n`);
        } else {
          row.imagePath = `download failed: HTTP ${imgRes.status}`;
          report.push(`\n**Result:** status=\`${status}\`, image=[remote](${imageUrl}) (local download failed: HTTP ${imgRes.status})\n`);
        }
      } catch (err) {
        row.imagePath = `download error: ${String(err).slice(0, 120)}`;
        report.push(`\n**Result:** status=\`${status}\`, image=[remote](${imageUrl}) (local download threw)\n`);
      }
    } else {
      report.push(`\n**Result:** status=\`${status}\`, image=n/a\n`);
    }
    summaryRows.push(row);
  }

  // Side-by-side intended-vs-rendered comparison table. The
  // "rendered" columns are placeholders so a reviewer can fill each
  // axis in after eyeballing the saved image - one column per
  // promoted DNA invariant (age band, eye color, hair color, fringe,
  // brow density, facial energy) instead of a single free-form note.
  report.push(`\n---\n\n## Intended vs rendered DNA per image (fill in after eyeballing)\n`);
  report.push(
    `| Fixture | Request id | Image | Age (intended → rendered) | Eye (intended → rendered) | Hair (intended → rendered) | Fringe (intended → rendered) | Brow (intended → rendered) | Energy (intended → rendered) |`,
  );
  report.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of summaryRows) {
    report.push(
      `| ${r.slug} | \`${r.requestId}\` | ${r.imagePath} | ${r.intendedAge} → ___ | ${r.intendedEye} → ___ | ${r.intendedHair} → ___ | ${r.intendedFringe} → ___ | ${r.intendedBrow} → ___ | ${r.intendedEnergy} → ___ |`,
    );
  }

  await writeFile(join(outDir, "report.md"), report.join("\n"), "utf8");
  console.log(`\nReport written to ${join(outDir, "report.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
