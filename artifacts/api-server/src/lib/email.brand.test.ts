// Regression tests that lock the AI Influencer Portfolio shell rendered by
// `bodyToHtml` and the from-address resolution in `resolveFromEmail`.
//
// Task #661 collapsed the email brand layer to a single brand. The
// historical `"main"` (Apex Offers) brand value still compiles for
// back-compat with the dozens of call sites that thread a brand
// through, but it now resolves to the AI Influencer Portfolio config so
// no outbound email can leak Apex branding.
//
// The forbidden list also covers the retired "Room30" display name: the
// room30.ai sending domain is still live (and asserted below), but the
// words "Room30 AI" / "Room 30" / "Cooke Media" must never appear as
// visible brand copy again.
//
// Run with: node --experimental-strip-types --test src/lib/email.brand.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bodyToHtml,
  resolveFromEmail,
  DEFAULT_FROM_EMAIL,
  getBrandConfig,
} from "./email-render.ts";

const FORBIDDEN = [
  /apex\s*offers/i,
  /apexoffers\.io/i,
  /apexoffers\.io\/logo-white\.png/i,
  // Retired brand display names. `room30.ai` (the sending domain)
  // deliberately does NOT match these patterns - only the human-readable
  // brand label does.
  /Room\s?30\s+AI/i,
  /Room 30/i,
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

describe("bodyToHtml — AI Influencer Portfolio branded shell (default brand)", () => {
  it("renders the wordmark, kicker, and neutral footer copy", () => {
    const html = bodyToHtml("Hello there.", "Welcome to AI Influencer Portfolio");

    assert.match(html, />\s*AI Influencer Portfolio\s*</);
    assert.match(html, /your member portal/);
    assert.ok(!/room30/i.test(html), `shell must not leak room30 copy:\n${html}`);
    assertNoLegacyBrand(html, "branded shell HTML");
  });

  it("never leaks legacy brand markers when brand is explicitly room30", () => {
    const html = bodyToHtml(
      "Plain text body the customer sees.",
      "Your account update",
      undefined,
      "room30",
    );
    assertNoLegacyBrand(html, "explicit room30 shell");
  });

  it("drops the old registered street address from the footer", () => {
    const html = bodyToHtml("Hello there.", "Your account update");
    assert.ok(
      !/Shelton Street/i.test(html),
      `footer must not contain the old street address, got:\n${html}`,
    );
  });
});

describe("bodyToHtml — legacy 'main' brand value still renders the neutral shell", () => {
  it("renders the AI Influencer Portfolio shell even when a legacy `main` value is passed", () => {
    const html = bodyToHtml(
      "Hello there.",
      "Your account update",
      undefined,
      "main",
    );

    assert.match(html, />\s*AI Influencer Portfolio\s*</);
    assert.ok(!/room30/i.test(html), `legacy main shell must not leak room30 copy:\n${html}`);
    assertNoLegacyBrand(html, "legacy main shell HTML");
  });
});

describe("getBrandConfig", () => {
  it("returns the neutral config for 'room30'", () => {
    const c = getBrandConfig("room30");
    assert.equal(c.kicker, "AI Influencer Portfolio");
    assert.equal(c.wordmark, "AI Influencer Portfolio");
    assert.match(c.fromEmail, /AI Influencer Portfolio/);
  });

  it("returns the neutral config even when a legacy 'main' value is passed", () => {
    const c = getBrandConfig("main");
    assert.equal(c.kicker, "AI Influencer Portfolio");
    assert.match(c.fromEmail, /AI Influencer Portfolio/);
    assert.ok(!/room30/i.test(c.footerCopy), "footer copy must not mention room30");
  });

  it("defaults to the neutral brand when brand is undefined", () => {
    const c = getBrandConfig(undefined);
    assert.equal(c.kicker, "AI Influencer Portfolio");
  });
});

describe("resolveFromEmail — verified AI Influencer Portfolio sender", () => {
  it("default from-address is the AI Influencer Portfolio sender", () => {
    assert.match(DEFAULT_FROM_EMAIL, /users\.room30\.ai>?\s*$/);
    assert.match(DEFAULT_FROM_EMAIL, /AI Influencer Portfolio/);
    assertNoLegacyBrand(DEFAULT_FROM_EMAIL, "default from-address");
  });

  it("falls back to the default sender when no connector value and no brand", () => {
    delete process.env.RESEND_FROM_EMAIL;
    assert.equal(resolveFromEmail(undefined), DEFAULT_FROM_EMAIL);
    assert.equal(resolveFromEmail(""), DEFAULT_FROM_EMAIL);
  });

  it("returns the AI Influencer Portfolio from-name even when a legacy 'main' brand is passed", () => {
    delete process.env.RESEND_FROM_EMAIL;
    const resolved = resolveFromEmail(undefined, "main");
    assert.match(resolved, /AI Influencer Portfolio/);
    assert.match(resolved, /users\.room30\.ai>?\s*$/);
    assert.ok(!/Apex/i.test(resolved), `must not contain Apex, got: ${resolved}`);
  });

  it("ignores legacy connector from-addresses pointing at apexoffers.io", () => {
    delete process.env.RESEND_FROM_EMAIL;
    const resolved = resolveFromEmail("Apex Offers <team@apexoffers.io>");
    assert.equal(resolved, DEFAULT_FROM_EMAIL);
  });

  it("rejects a connector value carrying the legacy Apex friendly name even on the room30 sender domain", () => {
    delete process.env.RESEND_FROM_EMAIL;
    const resolved = resolveFromEmail("Apex Offers <team@users.room30.ai>");
    assert.equal(resolved, DEFAULT_FROM_EMAIL);
    assert.ok(!/Apex/i.test(resolved), `must not contain Apex, got: ${resolved}`);
  });

  it("ignores legacy connector from-addresses pointing at payxagroup.com", () => {
    delete process.env.RESEND_FROM_EMAIL;
    assert.equal(
      resolveFromEmail("Payxa <hello@payxagroup.com>"),
      DEFAULT_FROM_EMAIL,
    );
  });

  it("trusts a neutrally-named connector value when it points at the verified sending domain", () => {
    delete process.env.RESEND_FROM_EMAIL;
    const value = "AI Influencer Portfolio <hello@users.room30.ai>";
    assert.equal(resolveFromEmail(value), value);
  });

  it("rejects a connector value carrying a legacy Room30 display name on the verified domain", () => {
    delete process.env.RESEND_FROM_EMAIL;
    const resolved = resolveFromEmail("Room30 AI <hello@users.room30.ai>");
    assert.equal(resolved, DEFAULT_FROM_EMAIL);
    assert.ok(
      !/room\s*30 ai/i.test(resolved.split("<")[0] ?? ""),
      `display name must not contain a legacy brand, got: ${resolved}`,
    );
  });

  it("respects the RESEND_FROM_EMAIL override", () => {
    process.env.RESEND_FROM_EMAIL =
      "AI Influencer Portfolio <override@users.room30.ai>";
    try {
      const resolved = resolveFromEmail("ignored@apexoffers.io");
      assert.equal(
        resolved,
        "AI Influencer Portfolio <override@users.room30.ai>",
      );
    } finally {
      delete process.env.RESEND_FROM_EMAIL;
    }
  });
});
