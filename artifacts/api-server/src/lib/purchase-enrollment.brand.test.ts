// Regression tests that lock the AI Influencer Portfolio brand into the per-feature
// purchase-enrollment email body builders. These are the bodies handed to
// `sendEmail({ bodyHtml })` when a buyer is auto-enrolled after a Stripe
// (or legacy Whop) payment.
//
// Task #661 collapsed the brand layer to AI Influencer Portfolio only. The legacy
// `"main"` (Apex Offers) portal value still exists in the DB but
// `brandLabel(...)` now returns "AI Influencer Portfolio" for every input, and the
// body builders default to the same value.
//
// Run with: node --experimental-strip-types --test src/lib/purchase-enrollment.brand.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  newAccountBodyHtml,
  existingAccountBodyHtml,
} from "./purchase-enrollment-emails.ts";
import {
  brandLabel,
  signUpPath,
  signInPath,
  buildPurchaseSignUpUrl,
  buildPurchaseSignInUrl,
} from "./purchase-enrollment-urls.ts";

const FORBIDDEN = [
  /apex\s*offers/i,
  /apexoffers\.io/i,
  /payxa/i,
  // Retired brand display labels. The room30.ai domain itself is still
  // live and deliberately does not match these patterns.
  /Room\s?30\s+AI/i,
  /Room 30\b/i,
  /Cooke Media/i,
];

function assertNoLegacyBrand(html: string, label: string): void {
  for (const pattern of FORBIDDEN) {
    assert.ok(
      !pattern.test(html),
      `${label} must not contain ${pattern}, got:\n${html}`,
    );
  }
}

// Set (or unset) env vars for the duration of `fn`, restoring the previous
// values afterwards so cases cannot leak state into each other.
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("purchase-enrollment — newAccountBodyHtml (AI Influencer Portfolio branded)", () => {
  it("addresses the buyer as joining AI Influencer Portfolio and signs off as the AI Influencer Portfolio team", () => {
    const html = newAccountBodyHtml(
      "buyer@example.com",
      "https://accounts.example.com/setup?token=abc",
    );
    assert.match(html, /Thanks for joining AI Influencer Portfolio/);
    assert.match(html, /The AI Influencer Portfolio team/);
    assertNoLegacyBrand(html, "newAccountBodyHtml");
  });

  it("renders the CTA button pointing at the supplied invite URL", () => {
    const url = "https://accounts.example.com/setup?token=xyz";
    const html = newAccountBodyHtml("buyer@example.com", url);
    assert.ok(html.includes(url), "CTA URL must be embedded in the body");
    assert.match(html, /Set Up Your Account/);
  });

  it("escapes user-supplied email so it cannot smuggle markup or legacy brand", () => {
    const html = newAccountBodyHtml(
      `attacker+"<img src=x>"@example.com`,
      "https://example.com/cta",
    );
    assert.ok(!html.includes("<img src=x>"), "must escape raw HTML in email");
    assertNoLegacyBrand(html, "newAccountBodyHtml escaped");
  });
});

describe("purchase-enrollment — existingAccountBodyHtml (AI Influencer Portfolio branded)", () => {
  it("tells returning buyers their training is unlocked under their AI Influencer Portfolio account", () => {
    const html = existingAccountBodyHtml("https://members.example.com/sign-in");
    assert.match(html, /AI Influencer Portfolio account/);
    assert.match(html, /The AI Influencer Portfolio team/);
    assert.match(html, /Open The Portal/);
    assertNoLegacyBrand(html, "existingAccountBodyHtml");
  });

  it("embeds the sign-in URL into both the CTA button and the fallback link", () => {
    const url = "https://members.example.com/sign-in";
    const html = existingAccountBodyHtml(url);
    const matches = html.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [];
    assert.ok(matches.length >= 2, `expected sign-in URL twice, found ${matches.length}`);
  });
});

describe("purchase-enrollment-urls — AI Influencer Portfolio for every portal value", () => {
  it("brandLabel returns 'AI Influencer Portfolio' for room30", () => {
    assert.equal(brandLabel("room30"), "AI Influencer Portfolio");
  });

  it("brandLabel returns 'AI Influencer Portfolio' even for legacy 'main' portal_users rows", () => {
    assert.equal(brandLabel("main"), "AI Influencer Portfolio");
  });

  it("signUpPath always lands buyers on /members/sign-up", () => {
    assert.equal(signUpPath("room30"), "/members/sign-up");
    assert.equal(signUpPath("main"), "/members/sign-up");
  });

  it("signInPath always lands buyers on /members/sign-in", () => {
    assert.equal(signInPath("room30"), "/members/sign-in");
    assert.equal(signInPath("main"), "/members/sign-in");
  });

  it("buildPurchaseSignUpUrl uses the configured customer-facing host for every portal value", () => {
    withEnv({ PUBLIC_APP_URL: "https://members.example.com" }, () => {
      assert.equal(
        buildPurchaseSignUpUrl("room30"),
        "https://members.example.com/members/sign-up",
      );
      assert.equal(
        buildPurchaseSignUpUrl("main"),
        "https://members.example.com/members/sign-up",
      );
    });
  });

  it("buildPurchaseSignInUrl uses the configured customer-facing host for every portal value", () => {
    withEnv({ PUBLIC_APP_URL: "https://members.example.com" }, () => {
      assert.equal(
        buildPurchaseSignInUrl("room30"),
        "https://members.example.com/members/sign-in",
      );
      assert.equal(
        buildPurchaseSignInUrl("main"),
        "https://members.example.com/members/sign-in",
      );
    });
  });

  it("never emails a replit preview host, which returns 502 to public buyers", () => {
    withEnv(
      {
        PUBLIC_APP_URL: undefined,
        REPLIT_DOMAINS: "some-replit-preview.replit.dev",
      },
      () => {
        assert.ok(
          !/replit\.(dev|app)/i.test(buildPurchaseSignUpUrl("main")),
          "sign-up URL must not use a replit preview host",
        );
        assert.ok(
          !/replit\.(dev|app)/i.test(buildPurchaseSignInUrl("room30")),
          "sign-in URL must not use a replit preview host",
        );
      },
    );
  });
});
