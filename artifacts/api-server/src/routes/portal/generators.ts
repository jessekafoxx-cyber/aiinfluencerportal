import type { RequestHandler, Router } from "express";
import { db } from "@workspace/db";
import { userBrainProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { resolveEffectiveBrain } from "../../lib/prebuilt-brains.js";
import { getPortalKey } from "../../lib/portal-key";
import { saveToolGeneration } from "../../lib/tool-generations";

export interface GeneratorsDeps {
  requireAuth: RequestHandler;
  requireActive: RequestHandler;
}

/**
 * Prompt Generator + Bio Generator endpoints, extracted from
 * routes/portal.ts as part of the multi-phase portal.ts split. Middleware
 * is injected to avoid a circular import with portal.ts.
 *
 * No behavior change: paths, middleware order, handler bodies, prompts,
 * model parameters, error responses, and JSON shapes are byte-for-byte
 * identical to the original inline registrations.
 */
export function registerGeneratorRoutes(
  portalRouter: Router,
  { requireAuth, requireActive }: GeneratorsDeps,
): void {
  // =====================================================================
  // Prompt Generator (lightweight, one-shot starter prompt for masterclass
  // portal-creation lesson). The full multi-pass blueprint generator lives
  // in /portal/os-tools/portal-creation/generate behind the upsell.
  // =====================================================================
  portalRouter.post("/portal/prompt-generator/generate", requireAuth, requireActive, async (req: any, res) => {
    try {
      const userId = req.portalUser.id;
      const rawKind =
        typeof req.body?.kind === "string" ? req.body.kind : "portal";
      const kind: "portal" | "support-bot" =
        rawKind === "support-bot" ? "support-bot" : "portal";

      const [profileRow] = await db
        .select()
        .from(userBrainProfilesTable)
        .where(eq(userBrainProfilesTable.userId, userId))
        .limit(1);
      const profile = resolveEffectiveBrain(profileRow, getPortalKey(req));

      if (!profile) {
        res.status(400).json({
          error:
            "Please fill in Your Brain first so we can personalise the prompt.",
        }); return;
      }

      const safe = (v: any, fallback = "") =>
        typeof v === "string" && v.trim() ? v.trim() : fallback;

      const lowTicket: any = profile.confirmedLowTicketOffer || {};
      const lowTicketName = safe(lowTicket?.name) || safe(lowTicket?.title);
      const lowTicketPrice =
        lowTicket?.price !== undefined && lowTicket?.price !== null
          ? String(lowTicket.price)
          : "";
      const lowTicketDescription =
        safe(lowTicket?.description) || safe(lowTicket?.summary);

      const brandPrimary = safe(profile.brandColorPrimary, "#E32652");
      const brandSecondary = safe(profile.brandColorSecondary, "#0a0a0a");
      const companyName =
        safe(profile.companyName) || safe(profile.name) || "Your Brand";
      const founderName = safe(profile.name);
      const whoYouHelp = safe(profile.whoDoYouHelp, "your customers");
      const howYouHelp = safe(
        profile.howDoYouHelpThem,
        "the transformation you deliver",
      );
      const achievements = safe(profile.keyAchievements);

      const openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      });

      const portalSystemPrompt = `You are an expert Replit prompt engineer. The creator has ALREADY imported a pre-built member portal template into their Replit project. Your job is to write ONE detailed, copy-paste Replit prompt that tells Replit how to BRAND THAT TEMPLATE UP for this specific business. You are NOT rebuilding the portal. You are not changing structure, routes, database, auth, or features. You are restyling and rewording it to match the creator's brand.

CRITICAL RULES:
- Output PLAIN TEXT only - no markdown headings, no triple backticks, no HTML, no commentary. Just the prompt the user will paste into Replit.
- Do NOT introduce yourself, do NOT say "Here is your prompt" - start directly with the instructions to Replit.
- Address Replit directly in second person ("Update the portal to...", "Replace the placeholder colours with...", "Reword the dashboard headline to...").
- Be SPECIFIC and personalised. Bake in the creator's brand colours, company name, who they help, what they sell, and the transformation they deliver. Avoid generic placeholders like "[YOUR BRAND]".
- Length: roughly 500-900 words. Detailed but tight. No padding.
- Do NOT instruct Replit to add new pages, new database tables, new auth, new routes, new features, or change the stack. Structure stays exactly as the imported template provides it.
- Cover ONLY branding and copy:
  1) Brand colour system: replace the template's placeholder primary and secondary colours with the creator's exact hex values, and tell Replit which Tailwind tokens / CSS variables to update across the project.
  2) Typography direction: recommend a heading font and body font pairing that fits the brand's vibe (modern, premium, friendly, sporty, etc.) - either Google Fonts names or system stack. Tell Replit how to wire them in.
  3) Logo / wordmark text: the company name as it should appear in the sidebar and any headers, plus a short tagline if one is implied by the brand.
  4) Voice and tone: 2-4 sentences on how the portal should speak to the customer (warm, direct, no-fluff, witty, calm, etc.), grounded in who they help and how.
  5) Page-by-page copy rewrites: for each major page in the template (dashboard / landing, sidebar nav labels, settings, login / signup, empty states, button labels), give Replit the exact replacement copy to use - personalised to the offer and the customer.
  6) Imagery and iconography direction: short guidance on photo/illustration style and icon style that matches the brand.
  7) Light vs dark theme guidance based on the brand colours provided.
- Frame everything as "find the placeholder X in the template and replace with Y" so Replit knows it's editing existing files, not creating new ones.
- NEVER mention competitors, gurus, or third-party brand names (no Sabri, Suby, Hormozi, Schwartz, ClickFunnels, Kajabi, Skool, etc.).
- NEVER use em dashes or en dashes. Use a regular hyphen with spaces ( - ) instead.
- End with one short paragraph telling Replit to ask the creator before doing anything destructive, to apply the changes incrementally page by page, and to leave existing functionality untouched.

Make it feel hand-written for THIS specific business.`;

      const portalUserPrompt = `Write the Replit branding prompt for this creator. The pre-built portal template is already imported into their Replit project; the prompt's job is to rebrand it.

CREATOR / BUSINESS CONTEXT
Founder name: ${founderName || "(not provided)"}
Company / brand name: ${companyName}
Who they help: ${whoYouHelp}
How they help them (transformation / method): ${howYouHelp}
${achievements ? `Notable proof / achievements: ${achievements}\n` : ""}Brand primary colour: ${brandPrimary}
Brand secondary colour: ${brandSecondary}

THEIR FRONT-END OFFER (the thing the portal delivers to buyers - use this when rewriting dashboard / nav copy)
${lowTicketName ? `Offer name: ${lowTicketName}` : "Offer name: (not provided - infer from niche)"}
${lowTicketPrice ? `Price: $${lowTicketPrice}` : ""}
${lowTicketDescription ? `Offer description: ${lowTicketDescription}` : ""}

Now produce the prompt. Remember: plain text only, start directly with the instructions to Replit, branding and copy ONLY (no new features or structure changes), personalised heavily to this brand.`;

      const supportSystemPrompt = `You are an expert Replit prompt engineer. Your job is to write ONE long, detailed, copy-paste Replit prompt that a creator will paste INTO THEIR EXISTING REPLIT PROJECT (their member portal) to add a customer support AI bot.

CRITICAL RULES:
- Output PLAIN TEXT only — no markdown headings, no triple backticks, no HTML, no commentary. Just the prompt the user will paste into Replit.
- Do NOT introduce yourself, do NOT say "Here is your prompt" — start directly with the instructions to Replit.
- Do NOT use em dashes or en dashes anywhere. Use a regular hyphen with spaces (" - ") instead.
- Do NOT mention or recommend any specific competitor products, gurus, courses, or named third-party SaaS support tools (Intercom, Zendesk, Crisp, etc.). Stay generic.
- Assume the project ALREADY has: a working member portal with auth, a database (Postgres + Drizzle ORM is fine to assume), a Stripe integration for the front-end offer, and existing brand styling. The bot is being ADDED to this project, not built from scratch.
- Personalise the prompt to the creator's niche, brand, and offer.
- Write it long and specific (think 600-1000 words) so Replit has enough context to one-shot it well.

WHAT THE PROMPT MUST INSTRUCT REPLIT TO BUILD:
1. A floating chat widget (bottom-right of the portal) the logged-in member can open. Branded with the creator's primary colour. Closeable, minimisable, persists open/closed state.
2. A backend chat endpoint (POST) that takes the user's message + the conversation history and returns an AI reply. Use the OpenAI SDK with gpt-4o (or gpt-4o-mini for cost). Stream is optional; non-streaming JSON is fine for v1.
3. Persistent per-user message history: a new "support_messages" table (id, user_id, role, content, created_at) so the bot remembers previous conversations for that member. Load the last ~30 messages on widget open.
4. An FAQ knowledge base table ("support_faqs": id, question, answer, created_at, updated_at) plus a simple admin page (/admin/support-faqs) where the creator can CRUD FAQs. The bot's system prompt must inject the current FAQ list as authoritative context every call.
5. The bot's system prompt (the one Replit will hardcode in the backend) must: be written in the creator's brand voice, know the creator's offer name and what it delivers, treat the FAQ list as the source of truth, refuse to make up policies, and politely escalate ("I'll have the team email you back") when it doesn't know.
6. Refund policy wired to Stripe: if the user clearly asks for a refund and it's within the creator's stated refund window, the bot offers a button "Request refund". Clicking it calls a backend route that uses the Stripe SDK to issue a refund on the original charge for that user (look up the charge by their Stripe customer id which is already on the user record). On success, post a confirmation message back into the chat. On failure, fall back to "I'll have the team email you back". Include clear TODO comments where the creator must paste their refund window (e.g. "30 days") and any conditions.
7. Optional VAPI voice agent: include a clearly-labelled OPTIONAL section at the end of the prompt that tells Replit how to add a "Talk to support" button that opens a VAPI voice agent using the same system prompt + FAQ context. Include a prominent COST WARNING in the prompt itself stating that VAPI charges per minute of voice usage and the creator should set a hard monthly cap before enabling this in production. Make it skippable - the creator can ignore this section if they don't want voice.
8. End with one short paragraph telling Replit to ask the user before doing anything destructive, to add the support_messages and support_faqs tables via the existing migration workflow, and to wire the widget into the portal layout so it shows on every authenticated page.

Make it feel hand-written for THIS specific business.`;

      const supportUserPrompt = `Write the Replit support-bot prompt for this creator.

CREATOR / BUSINESS CONTEXT
Founder name: ${founderName || "(not provided)"}
Company / brand name: ${companyName}
Who they help: ${whoYouHelp}
How they help them (transformation / method): ${howYouHelp}
${achievements ? `Notable proof / achievements: ${achievements}\n` : ""}Brand primary colour: ${brandPrimary}
Brand secondary colour: ${brandSecondary}

THEIR FRONT-END OFFER (the thing the support bot will be answering questions about)
${lowTicketName ? `Offer name: ${lowTicketName}` : "Offer name: (not provided - infer from niche)"}
${lowTicketPrice ? `Price: $${lowTicketPrice}` : ""}
${lowTicketDescription ? `Offer description: ${lowTicketDescription}` : ""}

Now produce the prompt. Remember: plain text only, start directly with the instructions to Replit, personalise the bot's voice and example FAQs to this niche, and keep the VAPI section clearly optional with the cost warning.`;

      const systemPrompt =
        kind === "support-bot" ? supportSystemPrompt : portalSystemPrompt;
      const userPrompt =
        kind === "support-bot" ? supportUserPrompt : portalUserPrompt;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 4000,
      });

      let prompt = completion.choices[0]?.message?.content || "";
      if (!prompt.trim()) {
        res
          .status(500)
          .json({ error: "AI did not return a prompt. Please try again." });
        return;
      }

      // Scrub em/en dashes per house style.
      prompt = prompt.replace(/\u2014/g, " - ").replace(/\u2013/g, " - ");
      // Strip stray markdown fences if the model emits them anyway.
      prompt = prompt.replace(/^```[a-zA-Z]*\n?/gm, "").replace(/```$/gm, "");
      // Strip a leading "Here is..." / "Sure," intro line if present.
      prompt = prompt.replace(/^(sure[!,.]?|here(?:'s| is)[^\n]*)\n+/i, "");

      const finalPrompt = prompt.trim();
      res.json({ prompt: finalPrompt });
      void saveToolGeneration({
        portalUserId: userId,
        toolSlug: "prompt-generator",
        label:
          kind === "support-bot"
            ? `Support bot prompt - ${companyName}`
            : `Brand portal prompt - ${companyName}`,
        input: { kind, companyName, founderName, whoYouHelp, lowTicketName, brandPrimary, brandSecondary },
        output: { prompt: finalPrompt, kind },
      });
      return;
    } catch (error: any) {
      console.error("Prompt generator error:", error?.message || error);
      res
        .status(500)
        .json({ error: "Failed to generate prompt. Please try again." });
      return;
    }
  });

  // =====================================================================
  // Bio Generator (Instagram / TikTok profile bio - 3 variations,
  // pulled from the user's brain + offer. Used inline in the
  // "correct-profile-setup" lesson tab.)
  // =====================================================================
  portalRouter.post("/portal/bio-generator/generate", requireAuth, requireActive, async (req: any, res) => {
    try {
      const userId = req.portalUser.id;

      const [profileRow] = await db
        .select()
        .from(userBrainProfilesTable)
        .where(eq(userBrainProfilesTable.userId, userId))
        .limit(1);
      const profile = resolveEffectiveBrain(profileRow, getPortalKey(req));

      if (!profile) {
        res.status(400).json({
          error:
            "Please fill in Your Brain first so we can personalise your bios.",
        }); return;
      }

      const safe = (v: any, fallback = "") =>
        typeof v === "string" && v.trim() ? v.trim() : fallback;

      const lowTicket: any = profile.confirmedLowTicketOffer || {};
      const lowTicketName = safe(lowTicket?.name) || safe(lowTicket?.title);
      const lowTicketPrice =
        lowTicket?.price !== undefined && lowTicket?.price !== null
          ? String(lowTicket.price)
          : "";
      const lowTicketDescription =
        safe(lowTicket?.description) || safe(lowTicket?.summary);

      const companyName =
        safe(profile.companyName) || safe(profile.name) || "Your Brand";
      const founderName = safe(profile.name);
      const whoYouHelp = safe(profile.whoDoYouHelp, "your customers");
      const howYouHelp = safe(
        profile.howDoYouHelpThem,
        "the transformation you deliver",
      );
      const achievements = safe(profile.keyAchievements);

      const openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      });

      const systemPrompt = `You are an expert direct-response copywriter who writes high-converting Instagram and TikTok profile bios for solo founders, coaches, consultants and creators.

You will produce THREE distinct bio variations for the same person. Each bio must follow this proven 3-4 line framework:

LINE 1: What they do, ideally with a concrete result baked in. (e.g. "I help experts sell $100K+ offers." / "I help coaches grow & sell more without ads")
LINE 2: A proof point or supporting line - revenue, client count, mechanism, or differentiator. (e.g. "I make $724K/mo with zero employees." / "1000+ business owners helped" / "With content that attracts, connects and converts")
LINE 3 (optional but recommended): The transformation / dream outcome they deliver, or a second proof point. (e.g. "Turn $27 buyers into $100K+ dream deals.")
LINE 4: Call-to-action with a down arrow pointing to the link. ALWAYS use the unicode arrow character: ↓. Examples: "↓ Install my OS", "↓ Start selling more"

CRITICAL RULES:
- Output STRICT JSON ONLY. No markdown, no commentary, no fences. Schema: {"bios":[{"label":"string","lines":["string","string","string","string"]}]}. Exactly 3 items in the bios array. Each "lines" array has 3 or 4 entries.
- "label" should be a short tag for the angle of the variation, like "Result-led", "Proof-led" or "Story-led".
- Each line is its own entry in the array - DO NOT include "\\n" inside any line. The frontend joins them with newlines.
- HARD CHARACTER LIMIT: When you join the lines with a single newline character between them, the TOTAL length (every visible character + every newline) must be <= 145 characters per bio. Instagram caps at 150 and we want a safety buffer. Count carefully before responding. If a bio is over, rewrite it shorter before sending. Prefer shorter, punchier copy over cramming.
- Be SPECIFIC and personalised to the brain provided. If they have a real revenue number, client count, or notable proof - use it. Do NOT invent numbers, do NOT use placeholders like "[X]" or "$XXX".
- The 3 variations should each take a different angle: one result/revenue-led, one mechanism / how-they-do-it led, one story / personality led. Vary the hook style.
- Plain text. No emojis unless the brand clearly leans creative/casual (default: no emojis - the example bios provided do not use them). Never use em dashes or en dashes - use a regular hyphen with spaces.
- Never name-drop competitors, gurus, or other brands.
- Final line MUST start with "↓ " followed by a verb-led CTA (Install / Start / Get / Steal / Grab / Download / Watch etc.) tied to their offer.

REFERENCE EXAMPLES (do not copy, just match the rhythm and density):
"I help experts sell $100K+ offers.\\nI make $724K/mo with zero employees.\\nTurn $27 buyers into $100K+ dream deals.\\n↓ Install my OS"
"I help coaches grow & sell more without ads\\nWith content that attracts, connects and converts\\n1000+ business owners helped\\n↓ Start selling more"`;

      const userPromptBase = `Write 3 Instagram bio variations for this creator.

CREATOR / BUSINESS CONTEXT
Founder name: ${founderName || "(not provided)"}
Company / brand name: ${companyName}
Who they help: ${whoYouHelp}
How they help them: ${howYouHelp}
${achievements ? `Notable proof / achievements / numbers: ${achievements}\n` : ""}
THEIR FRONT-END OFFER (use this to shape the CTA and the result lines)
${lowTicketName ? `Offer name: ${lowTicketName}` : "Offer name: (not provided)"}
${lowTicketPrice ? `Price: $${lowTicketPrice}` : ""}
${lowTicketDescription ? `Offer description: ${lowTicketDescription}` : ""}

Now produce the JSON. EXACTLY 3 bios. Each bio's joined text (lines joined with single newlines) must be <= 145 characters. Each bio must have 3 or 4 lines. The final line of every bio must start with "↓ " (down arrow + space) followed by a verb-led CTA. Vary the angle across the three (result-led, mechanism-led, story-led).`;

      type ParsedBio = { label: string; lines: string[]; text: string };

      const parseBios = (raw: string): ParsedBio[] => {
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return [];
        }
        const arr = Array.isArray(parsed?.bios) ? parsed.bios : [];
        return arr.map((b: any): ParsedBio => {
          const label =
            typeof b?.label === "string" && b.label.trim()
              ? b.label.trim()
              : "Variation";
          const lines = Array.isArray(b?.lines)
            ? b.lines
                .map((l: any) =>
                  typeof l === "string"
                    ? l
                        .replace(/\u2014/g, " - ")
                        .replace(/\u2013/g, " - ")
                        .replace(/\r?\n/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()
                    : "",
                )
                .filter((l: string) => l.length > 0)
            : [];
          return { label, lines, text: lines.join("\n") };
        });
      };

      // STRICT check used only to decide whether a retry is worth doing - a
      // bio that passes this is shipped as-is. A bio that fails is NOT thrown
      // away; it is repaired by normalizeBio below and shipped anyway. The old
      // behaviour 500'd the whole request unless EXACTLY 3 bios passed every
      // rule (<=145 chars, 3-4 lines, final line literally starting with
      // "↓ "), which gpt-4o misses often enough that the tool felt broken.
      const validateBio = (b: ParsedBio): string | null => {
        if (b.lines.length < 3 || b.lines.length > 4) {
          return `must have 3 or 4 lines (had ${b.lines.length})`;
        }
        if (b.text.length > 145) {
          return `total length is ${b.text.length}, must be <= 145`;
        }
        const lastLine = b.lines[b.lines.length - 1] || "";
        if (!/^↓\s+\S/.test(lastLine)) {
          return `final line must start with "↓ " followed by a CTA`;
        }
        return null;
      };

      // Best-effort repair so common near-misses still ship instead of failing
      // the request: strip any arrow glyph the model used on the CTA line and
      // re-add the canonical "↓ " prefix, and cap to 4 lines.
      const normalizeBio = (b: ParsedBio): ParsedBio => {
        const lines = b.lines.slice(0, 4);
        if (lines.length > 0) {
          const last = lines[lines.length - 1] || "";
          if (!/^↓\s+\S/.test(last)) {
            const cleaned = last
              .replace(/[↓⬇➡⏬]/gu, "")
              .replace(/\uFE0F/g, "")
              .replace(/\uD83D[\uDC47\uDC49]/g, "") // 👇 / 👉 surrogate pairs
              .replace(/^[\s>\-•.]+/, "")
              .trim();
            lines[lines.length - 1] = cleaned ? `↓ ${cleaned}` : last;
          }
        }
        return { label: b.label, lines, text: lines.join("\n") };
      };

      // A salvaged bio is shippable if it has at least 2 real lines and is not
      // absurdly long. Instagram hard-caps at 150; we allow a little slack and
      // let the UI flag anything over 150 rather than dropping a good bio.
      const isShippable = (b: ParsedBio): boolean =>
        b.lines.length >= 2 && b.lines.length <= 4 && b.text.length <= 200;

      const messages: any[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptBase },
      ];

      let bios: ParsedBio[] = [];
      let fallbackBios: ParsedBio[] = [];
      let lastRaw = "";

      for (let attempt = 0; attempt < 3; attempt++) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          temperature: 0.8,
          max_completion_tokens: 1200,
          response_format: { type: "json_object" },
        });

        lastRaw = completion.choices[0]?.message?.content || "";
        if (!lastRaw.trim()) break;

        const parsed = parseBios(lastRaw);
        const validated: ParsedBio[] = [];
        const issues: string[] = [];
        for (let i = 0; i < parsed.length; i++) {
          const issue = validateBio(parsed[i]);
          if (issue) {
            issues.push(`Bio ${i + 1} (${parsed[i].label}): ${issue}`);
          } else {
            validated.push(parsed[i]);
          }
        }

        // Keep the best repaired set from every attempt as a floor so we never
        // fall back to a 500 when the model actually returned usable content.
        const salvaged = parsed.map(normalizeBio).filter(isShippable);
        if (salvaged.length > fallbackBios.length) fallbackBios = salvaged;

        if (validated.length >= 3) {
          bios = validated.slice(0, 3);
          break;
        }

        if (attempt < 2) {
          messages.push({ role: "assistant", content: lastRaw });
          messages.push({
            role: "user",
            content: `Your output had problems:\n${issues.join("\n") || "Wrong number of bios returned (need exactly 3)."}\n\nReturn the corrected JSON now. Same schema. EXACTLY 3 bios. Each joined text <= 145 chars. Each has 3-4 lines. Final line starts with "↓ ". JSON only, no commentary.`,
          });
        }
      }

      // Prefer fully-valid bios; otherwise ship the best-effort repaired set so
      // the user still gets usable copy. Only 500 when nothing usable came back
      // across every attempt.
      if (bios.length === 0) bios = fallbackBios.slice(0, 3);

      if (bios.length === 0) {
        console.error(
          "Bio generator: no usable bios after retries. Last raw:",
          lastRaw.slice(0, 500),
        );
        res.status(500).json({
          error: "AI did not return usable bios. Please try again.",
        }); return;
      }

      res.json({ bios });
      void saveToolGeneration({
        portalUserId: userId,
        toolSlug: "bio-generator",
        label: `Bios - ${companyName || founderName || "Untitled"}`,
        input: { companyName, founderName, whoYouHelp, howYouHelp, lowTicketName },
        output: { bios },
      });
      return;
    } catch (error: any) {
      console.error("Bio generator error:", error?.message || error);
      res
        .status(500)
        .json({ error: "Failed to generate bios. Please try again." });
      return;
    }
  });
}
