// Resolve the canonical user-facing host for outbound URLs (emails, redirects,
// CAPI eventSourceUrl, etc.). Replit publishes apps under both the custom
// domain (e.g. room30.ai) and an auto-generated <slug>.replit.app host,
// and REPLIT_DOMAINS is comma-separated with no guaranteed ordering, so a
// naive `.split(",")[0]` can leak the replit.app domain into customer-facing
// links. Worse, in dev/preview deployments REPLIT_DOMAINS only contains a
// `*.replit.dev` host, which returns 502 to public buyers — Task #460 was
// caused by exactly that, with the broken host stamped into Clerk
// invitation `redirect_url` fields that cannot be edited after the fact.
//
// This helper now treats any `*.replit.dev` / `*.replit.app` candidate as
// non-customer-facing: it skips them everywhere, including when picking
// from REPLIT_DOMAINS, and ultimately falls back to `room30.ai` so the
// emailed link always lands somewhere a real buyer can actually load.
//
// Override priority:
//   1. PUBLIC_APP_URL env var (full https://... URL, no trailing slash).
//      A replit.dev/replit.app value here is also rejected so a misconfigured
//      preview env cannot leak into outbound URLs.
//   2. First non-replit.dev/replit.app host in REPLIT_DOMAINS
//   3. CUSTOMER_FALLBACK_HOST (room30.ai)

import { logger } from "./logger.ts";

const CUSTOMER_FALLBACK_HOST = "room30.ai";

function isReplitGeneratedHost(host: string): boolean {
  return /\.replit\.(app|dev)$/i.test(host);
}

function parseDomains(): string[] {
  return (process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

let warnedAboutFallback = false;
function warnFallbackOnce(reason: string, candidates: string[]): void {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  logger.warn(
    { reason, candidates, fallbackHost: CUSTOMER_FALLBACK_HOST },
    "[brand-url] no customer-facing host configured; falling back to room30.ai. Set PUBLIC_APP_URL to silence this.",
  );
}

export function getBrandHost(): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) {
    try {
      const host = new URL(explicit).host;
      if (isReplitGeneratedHost(host)) {
        warnFallbackOnce("public_app_url_is_replit_preview_host", [host]);
      } else {
        return host;
      }
    } catch {
      warnFallbackOnce("public_app_url_unparseable", [explicit]);
    }
  }
  const domains = parseDomains();
  const custom = domains.find((d) => !isReplitGeneratedHost(d));
  if (custom) return custom;
  if (domains.length > 0) {
    warnFallbackOnce("replit_domains_only_has_preview_hosts", domains);
  } else {
    warnFallbackOnce("replit_domains_empty", []);
  }
  return CUSTOMER_FALLBACK_HOST;
}

export function getBrandBaseUrl(): string {
  return `https://${getBrandHost()}`;
}

// Test-only helper to reset the one-shot warning latch so unit tests can
// re-exercise the warn path without leaking state between cases.
export function __resetBrandUrlWarningForTests(): void {
  warnedAboutFallback = false;
}
