// Seed the dfy_scripts catalog with pre-generated content scripts for
// the AI Influencer Portfolio offer (Done For You Pack > 1,000+ Proven
// Content Scripts).
//
// Re-runnable: existing rows for a given type are deleted before re-seed.
//
// HARD RULES (match Script Writer OS):
// 1) Every hook MUST be lightly adapted from the proven HOOK_LIBRARY.
//    Never invent new hook formulas.
// 2) Every script must be wired to the AI Influencer Portfolio offer
//    (the active brain in the portal). Affiliate-style: the viewer is
//    being moved towards the DFY Portfolio, not building their own.
// 3) Each format follows the documented high-converting structure for
//    that format (podcast / speaking / green screen / selfie yapping).
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx ./src/seed-dfy-scripts.ts
//   pnpm --filter @workspace/scripts exec tsx ./src/seed-dfy-scripts.ts --type podcast-clip
//   pnpm --filter @workspace/scripts exec tsx ./src/seed-dfy-scripts.ts --per-type 60 --parallel

import { db, dfyScriptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { AI_INFLUENCER_PORTFOLIO_OFFER_BRIEF } from "@workspace/prebuilt-brains-seed";
import {
  HOOK_LIBRARY,
  TOTAL_HOOK_COUNT,
} from "../../artifacts/api-server/src/lib/script-writer-hooks";

// Only these 4 formats are seeded for the AI Influencer Portfolio offer.
type Type =
  | "green-screen"
  | "podcast-clip"
  | "speaking-clip"
  | "selfie-clip";

const ALL_TYPES: Type[] = [
  "green-screen",
  "podcast-clip",
  "speaking-clip",
  "selfie-clip",
];

// ---- The offer (AI Influencer Portfolio brain) ----------------------------
// Single source of truth: the canonical brief lives in
// `@workspace/prebuilt-brains-seed` so the SQL seed migration, the api-server
// boot-time safety net, and this script all use the same string.
const OFFER_BRIEF = AI_INFLUENCER_PORTFOLIO_OFFER_BRIEF;

// ---- Per-format structure formulas ---------------------------------------
// These mirror the high-converting structure docs the Script Writer OS uses.
const FORMAT_STRUCTURE: Record<Type, string> = {
  "green-screen": `FORMAT: Green Screen reaction-style short.
The creator is in front of a screenshot/article/headline/post and reacts.
Structure (each beat = its own line in the body):
  1. HOOK - one line on screen, lightly adapted from the proven seed.
  2. CONTEXT - point at the screenshot: what is the article/post about.
  3. CONTRARIAN TAKE or REFRAME - what most people get wrong about it.
  4. PROOF / NUMBER - one of the AI Influencer Portfolio proof numbers.
  5. SIMPLIFY - reduce it to one practical idea anyone can grasp.
  6. FUTURE PACE - paint what life looks like once they're in this model.
  7. SOFT CTA - "comment a word", "DM me 'PORTFOLIO'", or "link in bio".
Voice: smart friend who discovered something early, simplifying it.
NOT: corporate guru, motivational speaker, crypto-2021 wizard.
Sentences are short. Pacing is fast. Visual movement wins.`,

  "podcast-clip": `FORMAT: Podcast clip (30-90s) pulled from a podcast-style
conversation. Side-on / cropped tight, mic visible.
Structure (each beat = its own line):
  1. HOOK - one strong, contrarian or "I realised..." line on screen.
  2. CONTRARIAN STATEMENT - say the thing most people won't say.
  3. WHY - explain the deeper reason in 1-2 lines.
  4. STORY / EXAMPLE / ANALOGY - quick vivid moment, not a lecture.
  5. PRACTICAL TAKEAWAY - what someone watching should actually do.
  6. POSITION THE AI INFLUENCER PORTFOLIO - frame it as the obvious move
     for someone who agrees with the take. Use a proof number naturally.
  7. PUNCHLINE / CTA - clip-ending sword: a hard truth or "comment 'AI'".
Voice: effortless, unfiltered, slightly dangerous, highly opinionated.
The viewer should think "WAIT - that's actually true" or "this guy is wrong"
- both are wins. Avoid "interesting".`,

  "speaking-clip": `FORMAT: Speaking clip from a stage / podcast / interview.
Direct to camera, confident, one big idea.
Structure (each beat = its own line):
  1. HOOK - strong statement / contrarian / future-based / truth bomb.
  2. BIG IDEA - what the core point is, what people misunderstand.
  3. BELIEF REFRAME - why conventional thinking is wrong; what actually works.
  4. PRACTICAL INSIGHT - one principle or framework, no over-teaching.
  5. PROOF - drop one AI Influencer Portfolio number naturally
     (e.g. $57K/day, $700K/month, 32,000+ people, $1K-$3K/day per influencer).
  6. POSITION - frame the Portfolio as the leveraged move for the next 5 years.
  7. POWER ENDING - one quotable, repostable line.
  8. OPTIONAL CTA - softer, e.g. "Comment 'AI' if you want the framework."
Voice: authority, conviction, leadership positioning. Viewer should feel
"this person understands something most people don't."`,

  "selfie-clip": `FORMAT: Selfie 'yapping' clip filmed walking or sitting down.
Casual, raw, conversational, opinion-driven.
Use one of these formulas (pick the best fit for the hook):
  A) Realisation: Observation -> Realisation -> Why most get it wrong -> Lesson
  B) Contrarian Opinion: Strong opinion -> Why people disagree -> Why you
     believe it -> Practical takeaway
  C) Story-Based: Quick story -> Problem -> Realisation -> Lesson
Structure (each beat = its own line):
  1. ON-SCREEN HOOK (also the "hook" field) - lightly adapted proven seed.
  2. NATURAL VERBAL OPENING - "OK so...", "Honest take...", "Here's the thing".
  3. CONVERSATIONAL RANT / STORY - 2-4 lines, real, slightly messy.
  4. INSIGHT / PERSPECTIVE SHIFT - the new lens.
  5. POSITION - tie it to the AI Influencer Portfolio (DFY, not a course,
     under 20 min/day, we close the backend). Use a proof number.
  6. REFLECTIVE ENDING - one quiet, true line.
  7. SOFT CTA - "comment 'AI'", "DM me 'PORTFOLIO'", "link in bio".
Voice: human, raw, emotionally honest, spontaneous, relatable.
NOT polished, lecture-style, or highly structured.`,
};

// Per-type minimum body length (characters) so the model is forced to write a
// real beat-by-beat script, not a few sentences. Speaking & podcast are the
// longest because they have 7-8 distinct beats; selfie/green screen are
// slightly shorter and more conversational.
const MIN_BODY_CHARS: Record<Type, number> = {
  "podcast-clip": 700,
  "speaking-clip": 700,
  "green-screen": 550,
  "selfie-clip": 600,
};

// Default: 122 per type x 4 types = 488 scripts (page title still reads
// "1,000+" because the existing legacy types stay in the DB unless the
// operator explicitly clears them).
const DEFAULT_PER_TYPE = 122;
const BATCH_SIZE = 6; // smaller batch = longer/cleaner outputs per script

function flatHooks(): string[] {
  const all: string[] = [];
  for (const arr of Object.values(HOOK_LIBRARY) as readonly (readonly string[])[]) {
    for (const h of arr) all.push(h);
  }
  return all;
}

function pickHookSeeds(n: number): string[] {
  const all = flatHooks();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(all[Math.floor(Math.random() * all.length)] || all[0]);
  }
  return out;
}

function buildPrompt(type: Type, hookSeeds: string[]) {
  const minBody = MIN_BODY_CHARS[type];
  return `You are generating short-form content scripts for the Done For You
Pack content library inside the GREGORY. Low-Ticket Acquisition portal.

Every single script in this batch is for ONE specific offer:

${OFFER_BRIEF}

${FORMAT_STRUCTURE[type]}

HARD RULES:
- The "hook" MUST be lightly adapted from one of the proven hook seeds below
  (placeholder slots filled in for this offer). Do NOT invent a new hook
  formula. Stay within the spirit of the listed seed.
- Every script must clearly tie back to the AI Influencer Portfolio offer.
  Do NOT pivot to luxury coaching, generic low-ticket, dropshipping, or any
  other model. The viewer is being moved towards Greg's DFY Portfolio.
- Use only the proof numbers listed in the offer brief. Never invent new ones.
- Tone: direct, confident, numbers-heavy. No "game-changer", "revolutionary",
  "secret", "unlock", "hack", or fake urgency.
- Use ASCII hyphens with spaces around them. NEVER use em dashes (-) or en
  dashes (-). The output must be plain text.
- Body length: minimum ${minBody} characters of substance. Each beat of the
  structure is its own line, separated by a single newline. No markdown,
  no asterisks, no headers, no numbered lists in the output - just the
  spoken / on-screen lines back to back.

Proven hook seeds for this batch (use one each, in order):
${hookSeeds.map((h, i) => `${i + 1}. ${h}`).join("\n")}

For each script return:
- "hook": a single tight on-screen line, max ~140 chars, adapted from the
  proven seed for this offer.
- "body": the full beat-by-beat script body following the format structure
  above. Plain text, line breaks between beats, end on the soft CTA.

Return ONLY a JSON object of the form:
{ "scripts": [ { "hook": "...", "body": "..." }, ... ] }

Generate exactly ${hookSeeds.length} scripts. Each one must be different from
the others (different angle, different proof point used, different beat
emphasis).`;
}

async function generateBatch(
  client: OpenAI,
  type: Type,
  hookSeeds: string[],
): Promise<{ hook: string; body: string }[]> {
  const resp = await client.chat.completions.create({
    model: "gpt-5.2",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise short-form scriptwriter for Greg Cooke's AI Influencer Portfolio offer. Output strict JSON only. Never invent proof numbers. Never use em dashes.",
      },
      { role: "user", content: buildPrompt(type, hookSeeds) },
    ],
  });
  const txt = resp.choices?.[0]?.message?.content || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(txt);
  } catch {
    throw new Error(`Bad JSON from model: ${txt.slice(0, 200)}`);
  }
  const scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
  return scripts
    .filter((s: any) => typeof s?.hook === "string" && typeof s?.body === "string")
    .map((s: any) => ({
      // Final dash-rule safety net: scrub em/en dashes from model output.
      hook: s.hook.trim().replace(/[\u2014\u2013]/g, " - "),
      body: s.body.trim().replace(/[\u2014\u2013]/g, " - "),
    }))
    .filter(
      (s: { hook: string; body: string }) =>
        s.body.length >= Math.floor(MIN_BODY_CHARS[type] * 0.75),
    );
}

async function seedType(
  client: OpenAI,
  type: Type,
  perType: number,
  opts: { append: boolean },
) {
  let sortOrder = 0;
  if (opts.append) {
    const existing = await db
      .select()
      .from(dfyScriptsTable)
      .where(eq(dfyScriptsTable.type, type));
    if (existing.length >= perType) {
      console.log(`[seed] ${type}: already has ${existing.length} rows, skipping (--append).`);
      return;
    }
    sortOrder = existing.length;
    console.log(
      `[seed] ${type}: appending ${perType - existing.length} (existing=${existing.length})`,
    );
    perType = perType - existing.length;
  } else {
    console.log(`\n[seed] ${type}: clearing existing rows...`);
    await db.delete(dfyScriptsTable).where(eq(dfyScriptsTable.type, type));
  }

  let inserted = 0;
  while (inserted < perType) {
    const want = Math.min(BATCH_SIZE, perType - inserted);
    const seeds = pickHookSeeds(want);
    let batch: { hook: string; body: string }[] = [];
    try {
      batch = await generateBatch(client, type, seeds);
    } catch (err: any) {
      console.warn(`[seed] ${type}: batch failed, retrying once -`, err?.message);
      try {
        batch = await generateBatch(client, type, seeds);
      } catch (err2: any) {
        console.error(`[seed] ${type}: batch failed twice, skipping. -`, err2?.message);
        continue;
      }
    }
    if (batch.length === 0) continue;
    await db.insert(dfyScriptsTable).values(
      batch.map((s) => ({
        type,
        hook: s.hook,
        body: s.body,
        sortOrder: sortOrder++,
      })),
    );
    inserted += batch.length;
    console.log(`[seed] ${type}: ${inserted}/${perType}`);
  }
}

async function main() {
  if (
    !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
    !process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  ) {
    throw new Error(
      "Missing AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY env vars.",
    );
  }
  const client = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });

  const args = process.argv.slice(2);
  const typeArgIdx = args.indexOf("--type");
  const perArgIdx = args.indexOf("--per-type");
  const onlyType =
    typeArgIdx >= 0 ? (args[typeArgIdx + 1] as Type | undefined) : undefined;
  const perType =
    perArgIdx >= 0 ? Number(args[perArgIdx + 1]) || DEFAULT_PER_TYPE : DEFAULT_PER_TYPE;
  const append = args.includes("--append");
  const parallel = args.includes("--parallel");

  const types: Type[] = onlyType ? [onlyType] : ALL_TYPES;
  console.log(
    `[seed] hook library size = ${TOTAL_HOOK_COUNT}, types = ${types.join(", ")}, per-type = ${perType}, append = ${append}, parallel = ${parallel}`,
  );

  if (parallel) {
    await Promise.all(types.map((t) => seedType(client, t, perType, { append })));
  } else {
    for (const t of types) await seedType(client, t, perType, { append });
  }
  console.log("[seed] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});
