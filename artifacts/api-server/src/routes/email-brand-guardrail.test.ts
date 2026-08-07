// Forward-looking guardrail tests for the route files listed in task #301
// (`support.ts`, `dfy.ts`, and the marketing-tool daily-email route) that
// the original task called out as places a developer could hand-write a
// new transactional email and quietly reintroduce legacy brand copy
// without tripping any existing test.
//
// At time of writing none of these files calls `sendEmail()` directly. So
// rather than test a body builder that does not yet exist, this file
// scans the source text and:
//
//   1. Forbids inline legacy brand strings ("Apex Offers", "apexoffers.io",
//      "payxa") inside any future transactional-email payload built in
//      these files. The marketing-tool daily-email file is exempt for
//      `apexoffers.io` because it intentionally renders Greg's
//      @lowticketgreg offer-ladder URLs (covered by the positive contract
//      in `marketing-tool/daily-email/brand.test.ts`), but it is still
//      forbidden from saying "Apex Offers" as a brand label.
//
//   2. Requires that any `sendEmail({ ... bodyHtml: "..." })` call added
//      to these files in the future uses a value that mentions
//      "AI Influencer Portfolio" (so the body actually carries the brand,
//      not just the shared shell). This is enforced by failing if a
//      `bodyHtml:` field ever appears here without it nearby.
//
//   3. Forbids the retired "Room30" / "Room 30" / "Cooke Media" display
//      labels from reappearing inside an email payload. The `room30.ai`
//      domain (links, mailboxes, the logo asset) is still live and is
//      deliberately not matched by these patterns.
//
// If you intentionally need an off-brand email body builder in one of
// these files (e.g. another product brand), extract it into its own
// dedicated module with its own positive-contract brand test, then update
// the allow-list below.
//
// Run with: node --experimental-strip-types --test src/routes/email-brand-guardrail.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORT_TS = path.resolve(__dirname, "./support.ts");
const DFY_TS = path.resolve(__dirname, "./dfy.ts");

function readSource(p: string): string {
  return fs.readFileSync(p, "utf8");
}

// Match any sendEmail({...}) block. Crude but good enough for a guardrail
// — captures everything from "sendEmail(" to the matching close paren on
// the same logical block (greedy until the next blank line that ends in
// `})`).
function extractSendEmailBlocks(src: string): string[] {
  const blocks: string[] = [];
  const re = /sendEmail\s*\(\s*\{[\s\S]*?\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

// Retired brand display labels. The `room30.ai` domain (links, mailboxes,
// logo asset filename) is still live, so these patterns deliberately only
// match the human-readable label, never a bare `room30.ai` URL/address.
const RETIRED_BRAND_LABELS: Array<[RegExp, string]> = [
  [/Room\s?30\s+AI/i, "Room30 AI"],
  [/Room 30\b/i, "Room 30"],
  [/Cooke Media/i, "Cooke Media"],
];

function assertNoRetiredBrandLabel(block: string, file: string): void {
  for (const [pattern, label] of RETIRED_BRAND_LABELS) {
    assert.ok(
      !pattern.test(block),
      `${file} has a sendEmail() block containing the retired '${label}' brand label:\n${block}`,
    );
  }
}

describe("support.ts — transactional email guardrail (AI Influencer Portfolio brand)", () => {
  const src = readSource(SUPPORT_TS);

  it("does not embed an inline 'Apex Offers' brand label inside any sendEmail() body payload", () => {
    for (const block of extractSendEmailBlocks(src)) {
      assert.ok(
        !/apex\s+offers/i.test(block),
        `support.ts has a sendEmail() block containing legacy 'Apex Offers' brand copy:\n${block}`,
      );
      assert.ok(
        !/payxa/i.test(block),
        `support.ts has a sendEmail() block containing legacy 'payxa' brand copy:\n${block}`,
      );
    }
  });

  it("does not reintroduce the retired Room30 / Cooke Media display labels in a sendEmail() payload", () => {
    for (const block of extractSendEmailBlocks(src)) {
      assertNoRetiredBrandLabel(block, "support.ts");
    }
  });

  it("requires every future sendEmail() bodyHtml in support.ts to carry the AI Influencer Portfolio brand string", () => {
    for (const block of extractSendEmailBlocks(src)) {
      if (/bodyHtml\s*:/i.test(block)) {
        assert.match(
          block,
          /AI Influencer Portfolio/,
          `support.ts sendEmail() with bodyHtml must mention 'AI Influencer Portfolio' in the body so the brand is locked in:\n${block}`,
        );
      }
    }
  });
});

describe("dfy.ts — transactional email guardrail (AI Influencer Portfolio brand)", () => {
  const src = readSource(DFY_TS);

  it("does not embed an inline 'Apex Offers' brand label inside any sendEmail() body payload", () => {
    for (const block of extractSendEmailBlocks(src)) {
      assert.ok(
        !/apex\s+offers/i.test(block),
        `dfy.ts has a sendEmail() block containing legacy 'Apex Offers' brand copy:\n${block}`,
      );
      assert.ok(
        !/payxa/i.test(block),
        `dfy.ts has a sendEmail() block containing legacy 'payxa' brand copy:\n${block}`,
      );
    }
  });

  it("does not reintroduce the retired Room30 / Cooke Media display labels in a sendEmail() payload", () => {
    for (const block of extractSendEmailBlocks(src)) {
      assertNoRetiredBrandLabel(block, "dfy.ts");
    }
  });

  it("requires every future sendEmail() bodyHtml in dfy.ts to carry the AI Influencer Portfolio brand string", () => {
    for (const block of extractSendEmailBlocks(src)) {
      if (/bodyHtml\s*:/i.test(block)) {
        assert.match(
          block,
          /AI Influencer Portfolio/,
          `dfy.ts sendEmail() with bodyHtml must mention 'AI Influencer Portfolio' in the body so the brand is locked in:\n${block}`,
        );
      }
    }
  });
});

// NOTE: the marketing-tool/daily-email guardrail describe block was removed
// along with the marketing-tool route (retired with the funnel/purchase stack).
