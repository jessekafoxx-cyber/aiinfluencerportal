// Regression tests for getBrandBaseUrl / getBrandHost (Task #460).
//
// The bug we are guarding against: in the deploy that sent the bad batch
// of account-setup emails, REPLIT_DOMAINS only contained a *.replit.dev
// preview host and PUBLIC_APP_URL was unset. The old resolver returned
// that host, the host was stamped into Clerk invitation redirect_url
// fields (502s for buyers) and embedded into purchase emails as the
// fallback CTA. Once stamped on a Clerk invitation it cannot be edited.
//
// These tests lock in three guarantees:
//   1. A *.replit.dev / *.replit.app host in REPLIT_DOMAINS is never
//      returned to a customer URL builder; we fall back to room30.ai.
//   2. PUBLIC_APP_URL accidentally set to a replit.dev host is also
//      rejected (same fallback).
//   3. Per-product path selection in buildPurchaseSignUpUrl /
//      buildPurchaseSignInUrl picks /members/* for room30 and
//      /portal/* for the course-portal ("main").
//
// Run with: node --experimental-strip-types --test src/lib/brand-url.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getBrandHost,
  getBrandBaseUrl,
  __resetBrandUrlWarningForTests,
} from "./brand-url.ts";
import {
  buildPurchaseSignUpUrl,
  buildPurchaseSignInUrl,
} from "./purchase-enrollment-urls.ts";

const ORIG_PUBLIC = process.env.PUBLIC_APP_URL;
const ORIG_DOMAINS = process.env.REPLIT_DOMAINS;

function setEnv(publicAppUrl: string | undefined, replitDomains: string | undefined): void {
  if (publicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = publicAppUrl;
  if (replitDomains === undefined) delete process.env.REPLIT_DOMAINS;
  else process.env.REPLIT_DOMAINS = replitDomains;
  __resetBrandUrlWarningForTests();
}

function restoreEnv(): void {
  if (ORIG_PUBLIC === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = ORIG_PUBLIC;
  if (ORIG_DOMAINS === undefined) delete process.env.REPLIT_DOMAINS;
  else process.env.REPLIT_DOMAINS = ORIG_DOMAINS;
  __resetBrandUrlWarningForTests();
}

describe("getBrandHost / getBrandBaseUrl (Task #460)", () => {
  beforeEach(() => __resetBrandUrlWarningForTests());
  afterEach(() => restoreEnv());

  it("uses PUBLIC_APP_URL when it points at a real customer host", () => {
    setEnv("https://room30.ai", "anything.replit.dev");
    assert.equal(getBrandHost(), "room30.ai");
    assert.equal(getBrandBaseUrl(), "https://room30.ai");
  });

  it("rejects a replit.dev value in PUBLIC_APP_URL and falls back", () => {
    setEnv("https://abc.riker.replit.dev", "");
    assert.equal(getBrandHost(), "room30.ai");
    assert.equal(getBrandBaseUrl(), "https://room30.ai");
  });

  it("rejects a replit.app value in PUBLIC_APP_URL and falls back", () => {
    setEnv("https://my-app.replit.app", "");
    assert.equal(getBrandHost(), "room30.ai");
  });

  it("never picks a *.replit.dev host out of REPLIT_DOMAINS", () => {
    setEnv(undefined, "abc.riker.replit.dev,room30.ai");
    assert.equal(getBrandHost(), "room30.ai");
  });

  it("never picks a *.replit.app host out of REPLIT_DOMAINS", () => {
    setEnv(undefined, "my-app.replit.app,room30.ai");
    assert.equal(getBrandHost(), "room30.ai");
  });

  it("falls back to room30.ai when REPLIT_DOMAINS only has preview hosts", () => {
    setEnv(undefined, "abc.riker.replit.dev,xyz.kirk.replit.dev");
    assert.equal(getBrandHost(), "room30.ai");
    assert.equal(getBrandBaseUrl(), "https://room30.ai");
  });

  it("falls back to room30.ai when REPLIT_DOMAINS is empty", () => {
    setEnv(undefined, "");
    assert.equal(getBrandHost(), "room30.ai");
  });

  it("falls back to room30.ai when nothing is set at all", () => {
    setEnv(undefined, undefined);
    assert.equal(getBrandHost(), "room30.ai");
  });

  it("never returns a replit-generated host across a battery of bad configs", () => {
    const cases: Array<[string | undefined, string | undefined]> = [
      [undefined, "foo.replit.dev"],
      [undefined, "foo.replit.app,bar.replit.dev"],
      ["https://foo.replit.dev", "bar.replit.app"],
      ["not a url", "baz.replit.app"],
      ["https://foo.replit.app", undefined],
    ];
    for (const [pub, doms] of cases) {
      setEnv(pub, doms);
      const host = getBrandHost();
      assert.ok(
        !/\.replit\.(app|dev)$/i.test(host),
        `host must not be a replit preview, got ${host} for PUBLIC_APP_URL=${pub} REPLIT_DOMAINS=${doms}`,
      );
    }
  });
});

describe("buildPurchaseSignUpUrl / buildPurchaseSignInUrl per-portal routing (Task #460)", () => {
  beforeEach(() => __resetBrandUrlWarningForTests());
  afterEach(() => restoreEnv());

  it("Room30 buyers land on /members/sign-up under the brand host", () => {
    setEnv("https://room30.ai", undefined);
    assert.equal(buildPurchaseSignUpUrl("room30"), "https://room30.ai/members/sign-up");
    assert.equal(buildPurchaseSignInUrl("room30"), "https://room30.ai/members/sign-in");
  });

  it("legacy 'main' (course-portal) buyers also land on /members/sign-up (Task #661: everything pinned to Room30)", () => {
    setEnv("https://room30.ai", undefined);
    assert.equal(buildPurchaseSignUpUrl("main"), "https://room30.ai/members/sign-up");
    assert.equal(buildPurchaseSignInUrl("main"), "https://room30.ai/members/sign-in");
  });

  it("path selection still works when the host has to fall back from a replit preview", () => {
    setEnv(undefined, "abc.riker.replit.dev");
    assert.equal(buildPurchaseSignUpUrl("room30"), "https://room30.ai/members/sign-up");
    assert.equal(buildPurchaseSignUpUrl("main"), "https://room30.ai/members/sign-up");
  });

  it("never embeds a *.replit.dev host in a purchase URL even when the env is bad", () => {
    setEnv("https://broken.riker.replit.dev", "another.replit.app");
    for (const portal of ["room30", "main"] as const) {
      const up = buildPurchaseSignUpUrl(portal);
      const inn = buildPurchaseSignInUrl(portal);
      assert.ok(!/replit\.(app|dev)/i.test(up), `sign-up URL leaked replit host: ${up}`);
      assert.ok(!/replit\.(app|dev)/i.test(inn), `sign-in URL leaked replit host: ${inn}`);
    }
  });
});
