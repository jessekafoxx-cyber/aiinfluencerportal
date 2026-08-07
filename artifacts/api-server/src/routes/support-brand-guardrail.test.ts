// Regression guard for the white-label rebrand of the member-facing SUPPORT
// surfaces.
//
// Two separate support stacks are reachable by members:
//
//   1. The legacy portal support page  -> `src/routes/support.ts`
//      (`/portal/support/chat` system prompt, canned refund/fallback replies,
//      and the `/portal/support/seed-articles` article bodies) rendered by
//      `artifacts/room30-portal/src/pages/support.tsx`.
//   2. The embeddable support bot      -> `src/support-bot/system-prompt.ts`,
//      `src/support-bot/knowledge.ts`, `src/support-bot/widget-assets.ts`,
//      `src/support-bot/purchase-lookup.ts`, `src/support-bot/refund.ts`
//      and the canned replies in `src/routes/support-bot.ts`.
//
// Both were scrubbed of the retired founder name ("Greg" / "Gregory" /
// "Cooke"), the retired brand label ("Room30" / "Room 30") and the retired
// public mailbox (`hello@room30.ai`). Every one of those strings is either
// rendered directly to a member or injected into an LLM prompt that then
// quotes it back to a member, so a reintroduction is a customer-visible
// branding regression.
//
// HOW THIS TEST WORKS
//
// It scans the raw source of each file line by line and fails on any
// forbidden token. Internal identifiers legitimately still contain the old
// names (file paths, exported symbol names, DB slugs, route paths, portal
// keys, the internal escalation inbox, log prefixes, and the allow-list
// constants that must literally spell the legacy tokens in order to match
// them). Those are skipped via ALLOWED_LINE_PATTERNS below.
//
// If you add a new internal-only occurrence, add a narrowly-scoped pattern
// to ALLOWED_LINE_PATTERNS with a comment explaining why it is not member
// visible. Do NOT widen the FORBIDDEN patterns.
//
// Run with:
//   node --experimental-strip-types --test src/routes/support-brand-guardrail.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");

// Every member-reachable support surface, relative to `src/`.
const SUPPORT_SOURCES = [
  "routes/support.ts",
  "routes/support-bot.ts",
  "support-bot/system-prompt.ts",
  "support-bot/knowledge.ts",
  "support-bot/widget-assets.ts",
  "support-bot/purchase-lookup.ts",
  "support-bot/refund.ts",
  "lib/ensure-room30-support-articles.ts",
];

// Retired tokens. Deliberately case-insensitive and substring-based so
// "Greg", "Gregory", "greg's", "Room30", "Room 30" and "@lowticketgreg" all
// trip the guard.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/hello@room30\.ai/i, "retired public support mailbox hello@room30.ai"],
  [/room\s?30/i, 'retired brand label "Room30" / "Room 30"'],
  [/greg/i, 'retired founder name "Greg" / "Gregory" / "@lowticketgreg"'],
  [/cooke/i, 'retired founder surname "Cooke"'],
];

// Lines that may legitimately contain a forbidden token because the token is
// an internal identifier, not member-visible copy.
const ALLOWED_LINE_PATTERNS: Array<[RegExp, string]> = [
  // Source-file comments and doc headers. Never rendered.
  [/^\s*(\/\/|\/\*|\*)/, "code comment"],

  // Import specifiers and module paths (file names are out of scope).
  [/^\s*import\b/, "import statement"],
  [/from\s+["'][^"']*["']\s*;?\s*$/, "module specifier"],

  // Exported/declared symbol names and type names keep their legacy spelling
  // (renaming them is explicitly out of scope for the rebrand).
  [/\bROOM30_SUPPORT_ARTICLES\b/, "exported constant name"],
  [/\bensureRoom30SupportArticles\b/, "exported function name"],
  [/\bROOM30_PORTAL_KEY\b/, "internal portal-key constant name"],

  // DB slugs / portal keys / route paths are stable identifiers.
  [/\bslug:\s*["']([a-z0-9-]*(?:room30|greg)[a-z0-9-]*)["']/i, "DB article slug"],
  [/^\s*["'][a-z0-9-]*(?:room30|greg)[a-z0-9-]*["'],?\s*$/i, "bare slug in a slug list"],
  [/portalKey:\s*["']room30["']/, "portal key column value"],
  [/["'`]\/(?:portal|members|room30)\/[^"'`]*["'`]/, "route path"],

  // The internal destination inbox for escalated transcripts. Sent TO the
  // team, never shown to the customer.
  [/\bSUPPORT_INBOX\b/, "internal escalation inbox constant"],

  // Log/metric prefixes and logger message strings are ops-only.
  [/\blogger\.(info|warn|error|debug)\b/, "log call"],
  [/\[room30-portal\]|\[support-bot\]/, "log prefix"],

  // The re-seed guard constants must literally spell the legacy tokens in
  // order to detect pre-rebrand rows.
  [/\bLEGACY_(APEX_SLUGS|BRAND_MARKERS|TITLE_RENAMES)\b/, "legacy-detection constant"],

  // The widget's URL auto-linker matches known domains; it is matching
  // logic, not rendered copy.
  [/_linkify|var re = \//, "linkify regex"],
];

function isAllowed(line: string): string | null {
  for (const [re, why] of ALLOWED_LINE_PATTERNS) {
    if (re.test(line)) return why;
  }
  return null;
}

function scan(relPath: string): string[] {
  const abs = path.join(SRC, relPath);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const violations: string[] = [];
  lines.forEach((line, i) => {
    if (isAllowed(line)) return;
    for (const [re, label] of FORBIDDEN) {
      if (re.test(line)) {
        violations.push(
          `${relPath}:${i + 1} contains ${label}\n    ${line.trim().slice(0, 200)}`,
        );
        return;
      }
    }
  });
  return violations;
}

describe("support surfaces carry no retired Greg/Room30 branding", () => {
  for (const relPath of SUPPORT_SOURCES) {
    it(`${relPath} has no member-visible legacy brand tokens`, () => {
      const violations = scan(relPath);
      assert.deepEqual(
        violations,
        [],
        `Member-visible legacy branding found:\n\n${violations.join("\n\n")}\n\n` +
          `Neutralise the copy, or if this really is an internal identifier ` +
          `add a narrow pattern to ALLOWED_LINE_PATTERNS in ` +
          `src/routes/support-brand-guardrail.test.ts.`,
      );
    });
  }
});

describe("legacy portal support route keeps neutral escalation copy", () => {
  const supportSrc = fs.readFileSync(path.join(SRC, "routes/support.ts"), "utf8");

  it("never tells a member to email a support address", () => {
    assert.equal(
      /email(ing)?\s+<?strong>?\s*[\w.+-]+@[\w.-]+/i.test(supportSrc),
      false,
      "support.ts still instructs members to email a mailbox; direct them to the in-portal support chat instead.",
    );
  });

  it("still points members at the in-portal support chat", () => {
    assert.match(
      supportSrc,
      /support chat/i,
      "support.ts should direct members to the in-portal support chat when a human is needed.",
    );
  });
});

describe("support bot escalation contract stays wired", () => {
  const promptSrc = fs.readFileSync(
    path.join(SRC, "support-bot/system-prompt.ts"),
    "utf8",
  );
  const routeSrc = fs.readFileSync(path.join(SRC, "routes/support-bot.ts"), "utf8");

  // The escalation box used to be triggered by the bot printing the public
  // support email. That email is gone, so the trigger is now a phrase. If
  // either side drifts, escalation silently stops working.
  const PHRASE = "over to the team";

  it("system prompt instructs the model to use the escalation phrase", () => {
    assert.ok(
      promptSrc.toLowerCase().includes(PHRASE),
      `system-prompt.ts must tell the model to say "${PHRASE}" when handing off to a human.`,
    );
  });

  it("route detects the same escalation phrase", () => {
    assert.ok(
      routeSrc.includes(`ESCALATION_PHRASE = "${PHRASE}"`),
      `support-bot.ts must detect "${PHRASE}" to show the escalation box.`,
    );
    assert.match(
      routeSrc,
      /reply\.toLowerCase\(\)\.includes\(ESCALATION_PHRASE\)/,
      "the escalate flag must be derived from ESCALATION_PHRASE.",
    );
  });
});
