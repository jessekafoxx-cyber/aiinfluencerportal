// ─────────────────────────────────────────────────────────────────────────────
// Task #261 - live provider auth preflight for the AI Influencer pipeline.
//
// Cheapest authenticated probe per provider so an operator can confirm
// from /api/healthz (and the worker /healthz) that all three providers
// would accept a real call right now. Results are cached in-memory and
// refreshed at boot + every PREFLIGHT_REFRESH_MS so the healthz read is
// always cheap.
//
// "Stop on 401" rule: when any provider reports ok=false, the
// preflight gate (isLivePipelineEnabled) blocks new live runs from
// being enqueued until the failing provider returns ok=true. The
// preflight itself NEVER throws — failures are captured as structured
// trace data on the cached entry so the healthz consumer always sees
// a stable contract.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from "./logger";

export type ProviderName = "higgsfield" | "enhancor" | "gemini";

export type ProviderAuthResult = {
  ok: boolean;
  status: number | null;
  message: string | null;
  checkedAt: string;
  // Truncated upstream snippet (≤500 chars) so the operator can see
  // what the provider actually said without bloating healthz.
  trace?: string | null;
  // Which env var(s) we read for this probe; helpful when the failure
  // is "credential missing" vs "credential rejected".
  credentialSource?: string;
  // True when the underlying credential is not present at all. Distinct
  // from a 401 (credential present but rejected upstream).
  configMissing?: boolean;
  // How long the probe HTTP call took.
  latencyMs?: number;
};

export type ProviderAuthSnapshot = {
  higgsfield: ProviderAuthResult;
  enhancor: ProviderAuthResult;
  gemini: ProviderAuthResult;
  refreshedAt: string;
};

const PREFLIGHT_TIMEOUT_MS = 8_000;
const PREFLIGHT_REFRESH_MS = Number(
  process.env.INFLUENCER_PREFLIGHT_REFRESH_MS ?? 5 * 60 * 1000,
);

const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";
const ENHANCOR_BASE_URL = "https://apireq.enhancor.ai";

let cached: ProviderAuthSnapshot | null = null;
let inflight: Promise<ProviderAuthSnapshot> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(s: string | null | undefined, max = 500): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function higgsfieldHeaders(): { headers: Record<string, string>; source: string } | null {
  const id = process.env.HIGGSFIELD_KEY_ID;
  const sec = process.env.HIGGSFIELD_KEY_SECRET;
  const single = process.env.HIGGSFIELD_API_KEY;
  // Match the pipeline's auth scheme: send Higgsfield's documented
  // `hf-api-key` + `hf-secret` headers (and Authorization as fallback)
  // so the probe exercises the exact credential path the dispatcher
  // uses. Accounts with a single value should set both env vars to
  // that value.
  const keyId = id || single;
  const secret = sec || single;
  if (keyId && secret) {
    return {
      headers: {
        "hf-api-key": keyId,
        "hf-secret": secret,
        Authorization: `Key ${keyId}:${secret}`,
        "Content-Type": "application/json",
      },
      source: id && sec ? "HIGGSFIELD_KEY_ID+SECRET" : "HIGGSFIELD_API_KEY",
    };
  }
  if (single) {
    return {
      headers: {
        "hf-api-key": single,
        Authorization: `Bearer ${single}`,
        "Content-Type": "application/json",
      },
      source: "HIGGSFIELD_API_KEY",
    };
  }
  return null;
}

async function probeHiggsfield(): Promise<ProviderAuthResult> {
  const start = Date.now();
  const creds = higgsfieldHeaders();
  if (!creds) {
    return {
      ok: false,
      status: null,
      message: "HIGGSFIELD_API_KEY (or HIGGSFIELD_KEY_ID+SECRET) is not set",
      checkedAt: nowIso(),
      trace: null,
      credentialSource: "HIGGSFIELD_API_KEY",
      configMissing: true,
    };
  }
  // Authenticated probe: POST to the Soul text2image endpoint - the
  // real, currently-shipping Higgsfield endpoint family - with an
  // intentionally empty body. With a valid key Higgsfield returns
  // 422 with FastAPI body-validation errors ("body.params: Field
  // required") - proving the credential was accepted before payload
  // validation. With a bad key Higgsfield's UUID header validator
  // rejects with 422 BEFORE reaching the route OR returns 401/403.
  // The classifier distinguishes those: 401/403 + 5xx + 429 are
  // terminal; a 422 with `loc=["body", ...]` means auth was accepted
  // and only the body was rejected. We deliberately do NOT use GET
  // because the platform gateway returns 405 for any GET, before
  // auth is checked (Task #288).
  try {
    const res = await fetch(`${HIGGSFIELD_BASE_URL}/v1/text2image/soul`, {
      method: "POST",
      headers: creds.headers,
      body: "{}",
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - start;
    return classifyProbeResponse({
      provider: "Higgsfield",
      status: res.status,
      text,
      latencyMs,
      credentialSource: creds.source,
    });
  } catch (err) {
    return {
      ok: false,
      status: null,
      message: `Higgsfield probe threw: ${(err as Error).message ?? String(err)}`,
      checkedAt: nowIso(),
      trace: null,
      credentialSource: creds.source,
      latencyMs: Date.now() - start,
    };
  }
}

// Shared classifier so all three probes treat terminal vs accepted
// responses identically. Per task spec: 401/403 (rejected creds), 429
// (quota / rate-limit exceeded), and 5xx (provider unavailable) are
// ALL terminal-for-this-pass and must block enqueue. Only 2xx and 4xx
// codes other than 401/403/429 count as "credential accepted, wrong
// verb / missing payload".
function classifyProbeResponse(input: {
  provider: string;
  status: number;
  text: string;
  latencyMs: number;
  credentialSource: string;
}): ProviderAuthResult {
  const { provider, status, text, latencyMs, credentialSource } = input;
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      message: `${provider} rejected credentials (HTTP ${status})`,
      checkedAt: nowIso(),
      trace: truncate(text),
      credentialSource,
      latencyMs,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      status,
      message: `${provider} quota / rate-limit exceeded (HTTP 429)`,
      checkedAt: nowIso(),
      trace: truncate(text),
      credentialSource,
      latencyMs,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      status,
      message: `${provider} unavailable (HTTP ${status})`,
      checkedAt: nowIso(),
      trace: truncate(text),
      credentialSource,
      latencyMs,
    };
  }
  // Quota messages can also surface as 4xx with a body string. Trip
  // the gate when the response text mentions quota / billing / limits
  // even on a 2xx/4xx so an exhausted-but-not-rate-limited account
  // does not get past the preflight.
  const lower = text.toLowerCase();
  if (
    /\b(quota|billing|insufficient[_ ]?credit|payment[_ ]?required|limit[_ ]?exceeded|exhausted)\b/.test(
      lower,
    )
  ) {
    return {
      ok: false,
      status,
      message: `${provider} reports quota/billing failure (HTTP ${status})`,
      checkedAt: nowIso(),
      trace: truncate(text),
      credentialSource,
      latencyMs,
    };
  }
  // Treat 2xx, 400, and 422-with-body-loc as authoritative
  // auth-accepted. A 400 or 422 with a `loc` starting at "body"
  // means the upstream parsed the credential and got far enough to
  // reject the (intentionally empty) payload at body validation -
  // unambiguous proof the credential was checked. We must NOT accept
  // a bare 422 because Higgsfield's UUID header validator also
  // returns 422 for malformed `hf-api-key` headers BEFORE auth (the
  // loc in that case is `["header","hf-api-key"]`). A 404 or 405
  // could happen BEFORE auth in the upstream's middleware stack and
  // is therefore rejected as an inconclusive probe. Inconclusive
  // probes block live runs by returning ok=false with a precise
  // message so the operator can investigate (Task #261, Task #288).
  let bodyValidation422 = false;
  if (status === 422) {
    try {
      const parsed = JSON.parse(text) as { detail?: Array<{ loc?: unknown[] }> };
      const detail = Array.isArray(parsed?.detail) ? parsed.detail : [];
      bodyValidation422 = detail.some(
        (d) => Array.isArray(d?.loc) && String(d.loc[0] ?? "").toLowerCase() === "body",
      );
    } catch {
      bodyValidation422 = false;
    }
  }
  const authAccepted =
    (status >= 200 && status < 300) || status === 400 || bodyValidation422;
  if (authAccepted) {
    const label =
      status >= 200 && status < 300
        ? "ok"
        : status === 400
          ? "auth accepted (HTTP 400)"
          : "auth accepted (HTTP 422 body validation)";
    return {
      ok: true,
      status,
      message: label,
      checkedAt: nowIso(),
      trace: status >= 200 && status < 300 ? null : truncate(text),
      credentialSource,
      latencyMs,
    };
  }
  return {
    ok: false,
    status,
    message: `${provider} probe inconclusive (HTTP ${status}) - cannot prove credential was accepted`,
    checkedAt: nowIso(),
    trace: truncate(text),
    credentialSource,
    latencyMs,
  };
}

async function probeEnhancor(): Promise<ProviderAuthResult> {
  const start = Date.now();
  const apiKey = process.env.ENHANCOR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: null,
      message: "ENHANCOR_API_KEY is not set",
      checkedAt: nowIso(),
      trace: null,
      credentialSource: "ENHANCOR_API_KEY",
      configMissing: true,
    };
  }
  // Authenticated probe: POST to the same queue endpoint the pipeline
  // uses, with an intentionally invalid empty body. With a valid key
  // Enhancor returns 400 ("missing img_url"), proving auth was
  // accepted before payload validation. With a bad key it returns
  // 401/403. GET would return 405 before auth is checked which is
  // not a credential proof (Task #261 review feedback).
  try {
    const res = await fetch(`${ENHANCOR_BASE_URL}/api/realistic-skin/v1/queue`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - start;
    return classifyProbeResponse({
      provider: "Enhancor",
      status: res.status,
      text,
      latencyMs,
      credentialSource: "ENHANCOR_API_KEY",
    });
  } catch (err) {
    return {
      ok: false,
      status: null,
      message: `Enhancor probe threw: ${(err as Error).message ?? String(err)}`,
      checkedAt: nowIso(),
      trace: null,
      credentialSource: "ENHANCOR_API_KEY",
      latencyMs: Date.now() - start,
    };
  }
}

async function probeGemini(): Promise<ProviderAuthResult> {
  const start = Date.now();
  const integrationKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const integrationBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const directKey = process.env.GEMINI_API_KEY;
  const apiKey = integrationKey || directKey;
  const credentialSource = integrationKey
    ? "AI_INTEGRATIONS_GEMINI_API_KEY"
    : directKey
      ? "GEMINI_API_KEY"
      : "GEMINI_API_KEY";
  if (!apiKey) {
    return {
      ok: false,
      status: null,
      message: "GEMINI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY) is not set",
      checkedAt: nowIso(),
      trace: null,
      credentialSource,
      configMissing: true,
    };
  }
  // Authenticated probe: POST to generateContent with an intentionally
  // empty body. With a valid key Gemini returns 400 ("contents is
  // required"); with an invalid key it returns 401/403. Using POST
  // against the same endpoint family the pipeline calls avoids
  // gateway 404/405 false positives that GET /models was producing
  // through the integration proxy (Task #261 review feedback).
  const baseUrl = (integrationBase && integrationKey)
    ? integrationBase.replace(/\/$/, "")
    : "https://generativelanguage.googleapis.com/v1beta";
  const probePath = "/models/gemini-2.5-flash:generateContent";
  const url = integrationKey && integrationBase
    ? `${baseUrl}${probePath}`
    : `${baseUrl}${probePath}?key=${encodeURIComponent(apiKey)}`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (integrationKey && integrationBase) {
      headers.Authorization = `Bearer ${integrationKey}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - start;
    return classifyProbeResponse({
      provider: "Gemini",
      status: res.status,
      text,
      latencyMs,
      credentialSource,
    });
  } catch (err) {
    return {
      ok: false,
      status: null,
      message: `Gemini probe threw: ${(err as Error).message ?? String(err)}`,
      checkedAt: nowIso(),
      trace: null,
      credentialSource,
      latencyMs: Date.now() - start,
    };
  }
}

async function runAllProbes(): Promise<ProviderAuthSnapshot> {
  const [higgsfield, enhancor, gemini] = await Promise.all([
    probeHiggsfield(),
    probeEnhancor(),
    probeGemini(),
  ]);
  const snapshot: ProviderAuthSnapshot = {
    higgsfield,
    enhancor,
    gemini,
    refreshedAt: nowIso(),
  };
  cached = snapshot;
  // Loud log so the operator sees provider auth state in the boot
  // tail without having to hit the endpoint.
  const summary = {
    higgsfield: { ok: higgsfield.ok, status: higgsfield.status, message: higgsfield.message },
    enhancor: { ok: enhancor.ok, status: enhancor.status, message: enhancor.message },
    gemini: { ok: gemini.ok, status: gemini.status, message: gemini.message },
  };
  const allGreen = higgsfield.ok && enhancor.ok && gemini.ok;
  if (allGreen) {
    logger.info({ providerAuth: summary }, "influencer providerAuth preflight: all green");
  } else {
    logger.warn(
      { providerAuth: summary },
      "influencer providerAuth preflight: at least one provider FAILED — live runs blocked",
    );
  }
  return snapshot;
}

/**
 * Trigger a fresh preflight pass. De-duped if one is already inflight.
 * The result is cached and returned. Never throws.
 */
export async function refreshProviderAuth(): Promise<ProviderAuthSnapshot> {
  if (inflight) return inflight;
  inflight = runAllProbes()
    .catch((err): ProviderAuthSnapshot => {
      logger.error({ err }, "influencer providerAuth preflight crashed");
      const fallback: ProviderAuthResult = {
        ok: false,
        status: null,
        message: `preflight crashed: ${(err as Error).message ?? String(err)}`,
        checkedAt: nowIso(),
      };
      const snap: ProviderAuthSnapshot = {
        higgsfield: fallback,
        enhancor: fallback,
        gemini: fallback,
        refreshedAt: nowIso(),
      };
      cached = snap;
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Return the cached snapshot, or null if preflight has not run yet. */
export function getProviderAuthSnapshot(): ProviderAuthSnapshot | null {
  return cached;
}

/** True when the cached snapshot reports every provider ok. False if
 *  the snapshot is missing (preflight never ran) or any provider is
 *  not ok. Used by the route handler to gate new live runs. */
export function isLivePipelineEnabled(): boolean {
  if (!cached) return false;
  return cached.higgsfield.ok && cached.enhancor.ok && cached.gemini.ok;
}

/** Return the list of providers currently failing the preflight. Used
 *  by the route handler to surface a precise error to the caller. */
export function failingProviders(): ProviderName[] {
  if (!cached) return ["higgsfield", "enhancor", "gemini"];
  const out: ProviderName[] = [];
  if (!cached.higgsfield.ok) out.push("higgsfield");
  if (!cached.enhancor.ok) out.push("enhancor");
  if (!cached.gemini.ok) out.push("gemini");
  return out;
}

/** Boot hook. Kicks the first preflight IMMEDIATELY (synchronously
 *  starts the inflight promise so a healthz read can `await` it via
 *  `refreshProviderAuth()` and never see a `null` snapshot), then
 *  re-runs every PREFLIGHT_REFRESH_MS. Honors a kill switch so a
 *  quiet env can skip outbound provider calls entirely. */
export function startProviderAuthPreflight(): void {
  if (refreshTimer) return;
  if (process.env.INFLUENCER_PREFLIGHT_DISABLED === "1") {
    logger.warn("INFLUENCER_PREFLIGHT_DISABLED=1 — provider auth preflight will not run");
    return;
  }
  // Kick the first probe immediately so the inflight promise is set
  // before the first /healthz read. Boot health contract: the snapshot
  // is populated before the first request returns (healthz awaits the
  // inflight promise on cache miss).
  void refreshProviderAuth();
  refreshTimer = setInterval(() => {
    void refreshProviderAuth();
  }, PREFLIGHT_REFRESH_MS);
  refreshTimer.unref?.();
}

export function stopProviderAuthPreflight(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
