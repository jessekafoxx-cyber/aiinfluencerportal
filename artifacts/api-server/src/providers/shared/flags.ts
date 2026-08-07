// ─────────────────────────────────────────────────────────────────────────────
// Slice C: Provider routing feature flags.
//
// All flags default OFF. They are scaffolded now so the adapter layer
// can grow into multi-provider routing later without touching
// orchestration code. NONE of these flags currently change runtime
// behavior - they only gate code paths that do not yet exist.
// ─────────────────────────────────────────────────────────────────────────────

function readFlag(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on";
}

export const ENABLE_PROVIDER_FAILOVER = readFlag("ENABLE_PROVIDER_FAILOVER");
export const ENABLE_PROVIDER_ROUTING = readFlag("ENABLE_PROVIDER_ROUTING");
export const ENABLE_PROVIDER_SCORING = readFlag("ENABLE_PROVIDER_SCORING");

export function flagsSnapshot(): {
  failover: boolean;
  routing: boolean;
  scoring: boolean;
} {
  return {
    failover: ENABLE_PROVIDER_FAILOVER,
    routing: ENABLE_PROVIDER_ROUTING,
    scoring: ENABLE_PROVIDER_SCORING,
  };
}
