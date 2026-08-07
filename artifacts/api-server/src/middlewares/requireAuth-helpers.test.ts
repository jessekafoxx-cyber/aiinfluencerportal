// Regression tests for Task #501 ("Fix Room30 cross-portal 403 on AI Influencer").
//
// Locks in two guarantees:
//
//   1. Shell-row claim by email: when requireAuth's WHERE clerk_id=? lookup
//      returns nothing and the resolved Clerk email matches a single
//      portal_users row whose clerk_id IS NULL and whose portal_key
//      equals the request's portal_key, that row is the one we attach -
//      no new insert. This is what unsticks Emma-style buyers whose
//      purchase-enrollment shell row drifted from a later Clerk-side
//      insert and ended up in the 403 state.
//
//   2. Cross-portal denial preserved: a row whose portalKey diverges
//      from the request's portalKey and whose email is NOT in
//      ADMIN_EMAILS still triggers the 403 path. Admins remain
//      whitelisted via either the row email or the live Clerk email.
//
// Run: node --experimental-strip-types --test src/middlewares/requireAuth-helpers.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickClaimableShellRow,
  shouldDenyCrossPortal,
  type PortalUserShellRow,
} from "./requireAuth-helpers.ts";
import { getPortalKey } from "../lib/portal-key.ts";

const shell = (over: Partial<PortalUserShellRow>): PortalUserShellRow => ({
  id: 1,
  email: "emmaparsons87@gmail.com",
  clerkId: null,
  portalKey: "room30",
  firstName: null,
  lastName: null,
  ...over,
});

describe("pickClaimableShellRow", () => {
  it("claims the single shell row that matches portalKey + email", () => {
    const row = shell({});
    const picked = pickClaimableShellRow([row], "room30", "emmaparsons87@gmail.com");
    assert.equal(picked?.id, row.id);
  });

  it("is case-insensitive on email", () => {
    const row = shell({ email: "Emmaparsons87@Gmail.com" });
    const picked = pickClaimableShellRow([row], "room30", "EMMAPARSONS87@gmail.com");
    assert.equal(picked?.id, row.id);
  });

  it("does not claim a row whose portalKey does not match", () => {
    const row = shell({ portalKey: "main" });
    const picked = pickClaimableShellRow([row], "room30", "emmaparsons87@gmail.com");
    assert.equal(picked, null);
  });

  it("does not claim a row that already has a clerk_id", () => {
    const row = shell({ clerkId: "user_xxx" });
    const picked = pickClaimableShellRow([row], "room30", "emmaparsons87@gmail.com");
    assert.equal(picked, null);
  });

  it("refuses to pick when multiple eligible shells exist (anomaly)", () => {
    const a = shell({ id: 1 });
    const b = shell({ id: 2 });
    const picked = pickClaimableShellRow([a, b], "room30", "emmaparsons87@gmail.com");
    assert.equal(picked, null);
  });

  it("returns null when no email is provided", () => {
    const row = shell({});
    assert.equal(pickClaimableShellRow([row], "room30", null), null);
    assert.equal(pickClaimableShellRow([row], "room30", ""), null);
  });
});

describe("shouldDenyCrossPortal", () => {
  const ADMINS = new Set(["greg@cookemedia.io"]);

  // Task #558: single-tenant world. A legacy 'main' row on a room30
  // request used to deny; it now accepts (and requireAuth heals the
  // row's portal_key to 'room30' transparently). The denial path is
  // retained only for hypothetical non-room30 requests, exercised
  // below.
  it("denies a non-admin whose row.portalKey differs from the request (non-room30)", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: { email: "buyer@example.com", portalKey: "room30" },
      requestEmail: "buyer@example.com",
      requestedPortalKey: "legacy-portal",
      adminEmails: ADMINS,
    });
    assert.equal(deny, true);
  });

  it("allows when the row.portalKey already matches the request", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: { email: "emmaparsons87@gmail.com", portalKey: "room30" },
      requestEmail: "emmaparsons87@gmail.com",
      requestedPortalKey: "room30",
      adminEmails: ADMINS,
    });
    assert.equal(deny, false);
  });

  it("allows admins through cross-portal (matched on row email)", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: { email: "greg@cookemedia.io", portalKey: "main" },
      requestEmail: null,
      requestedPortalKey: "room30",
      adminEmails: ADMINS,
    });
    assert.equal(deny, false);
  });

  it("allows admins through cross-portal (matched on request email)", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: { email: "old-handle@cookemedia.io", portalKey: "main" },
      requestEmail: "GREG@cookemedia.io",
      requestedPortalKey: "room30",
      adminEmails: ADMINS,
    });
    assert.equal(deny, false);
  });

  it("does not deny when there is no portalUser yet (first sign-in)", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: null,
      requestEmail: "emmaparsons87@gmail.com",
      requestedPortalKey: "room30",
      adminEmails: ADMINS,
    });
    assert.equal(deny, false);
  });

  // Task #558: single-tenant world. Legacy rows that still carry the
  // historical default portal_key='main' must be accepted on every
  // room30 request - the denial was firing on every legacy buyer who
  // clicked "Start Generation" on the Personalise your influencer modal.
  it("accepts a legacy portalKey='main' row on a room30 request (Task #558)", () => {
    const deny = shouldDenyCrossPortal({
      portalUser: { email: "buyer@example.com", portalKey: "main" },
      requestEmail: "buyer@example.com",
      requestedPortalKey: "room30",
      adminEmails: ADMINS,
    });
    assert.equal(deny, false);
  });

  // Task #558: lock in that the requireAuth insert path stamps
  // portal_key='room30' on fresh rows. The insert uses
  // `portalKey: getPortalKey(req)`, and the single-tenant stub returns
  // "room30" regardless of any header. If a future change re-introduces
  // header-based portal resolution, this test fails loudly so the bug
  // can't re-surface as a silent default drift.
  it("getPortalKey() always returns 'room30' so fresh inserts stamp room30 (Task #558)", () => {
    assert.equal(getPortalKey(), "room30");
    assert.equal(getPortalKey(undefined), "room30");
    assert.equal(getPortalKey({ headers: {} }), "room30");
    assert.equal(
      getPortalKey({ headers: { "x-portal-key": "main" } }),
      "room30",
    );
    assert.equal(
      getPortalKey({ headers: { "x-portal-key": "anything-else" } }),
      "room30",
    );
  });

  it("accepts any non-room30 legacy portalKey on a room30 request", () => {
    for (const legacy of ["main", "apex", "course", ""]) {
      const deny = shouldDenyCrossPortal({
        portalUser: { email: "buyer@example.com", portalKey: legacy },
        requestEmail: "buyer@example.com",
        requestedPortalKey: "room30",
        adminEmails: ADMINS,
      });
      assert.equal(deny, false, `expected accept for legacy="${legacy}"`);
    }
  });
});
