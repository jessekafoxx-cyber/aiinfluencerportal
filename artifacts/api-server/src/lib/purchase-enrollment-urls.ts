// Per-portal post-purchase URL builders. Split out from
// `purchase-enrollment.ts` so brand/url regression tests can import the
// builders without pulling in the DB / Clerk runtime.
//
// See `purchase-enrollment.ts` for routing rationale (Task #460).

import { getBrandBaseUrl } from "./brand-url.ts";

export type PurchasePortalKey = "room30" | "main";

function baseUrl(): string {
  return getBrandBaseUrl();
}
export function signUpPath(_portalKey: PurchasePortalKey): string {
  return "/members/sign-up";
}

export function signInPath(_portalKey: PurchasePortalKey): string {
  return "/members/sign-in";
}

export function brandLabel(_portalKey: PurchasePortalKey): string {
  return "AI Influencer Portfolio";
}

export function buildPurchaseSignUpUrl(portalKey: PurchasePortalKey): string {
  return `${baseUrl()}${signUpPath(portalKey)}`;
}

export function buildPurchaseSignInUrl(portalKey: PurchasePortalKey): string {
  return `${baseUrl()}${signInPath(portalKey)}`;
}
