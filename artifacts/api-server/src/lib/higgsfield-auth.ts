// Shared Higgsfield auth header builder. Extracted from
// influencer-pipeline.ts so manual scripts (smoke:influencer-base,
// future probes) can reuse the same auth scheme without duplicating
// the dual-key / single-key fallback logic.
//
// Higgsfield's documented auth scheme uses two custom headers:
//   `hf-api-key` (the key id) and `hf-secret` (the secret).
// Some accounts only have one value (id == secret); for those, set
// both env vars to that value. We also keep the legacy Authorization
// headers populated alongside as a belt-and-braces fallback for
// gateways that key off Bearer.

export const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";

export function higgsfieldHeaders(): Record<string, string> | null {
  const id = process.env.HIGGSFIELD_KEY_ID;
  const sec = process.env.HIGGSFIELD_KEY_SECRET;
  const single = process.env.HIGGSFIELD_API_KEY;
  const keyId = id || single;
  const secret = sec || single;
  if (keyId && secret) {
    return {
      "hf-api-key": keyId,
      "hf-secret": secret,
      Authorization: `Key ${keyId}:${secret}`,
      "Content-Type": "application/json",
    };
  }
  if (single) {
    return {
      "hf-api-key": single,
      Authorization: `Bearer ${single}`,
      "Content-Type": "application/json",
    };
  }
  return null;
}
