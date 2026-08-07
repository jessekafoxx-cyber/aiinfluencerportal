// Task #158: Apify-first auth-health probe. Worker-only.
// Task #159 (T159): Apify session-health probe is now a 3-stage check
// rather than a single dry-run. The original "Apify returned >=1 slide"
// pass conflated three failure modes (token missing, actor unauthorized,
// extraction blocked, escalation broken) into one opaque "degraded"
// status. The new pass runs:
//
//   stage 1  reachability  - Apify v2 actor metadata GET against the
//                            primary IG/FB scraper using APIFY_TOKEN.
//                            This catches missing/expired tokens, 401
//                            from Apify itself, network outages, and
//                            unknown actor names BEFORE we burn a
//                            run-sync compute minute.
//   stage 2  extraction    - the original batchResolveInstagram /
//                            batchResolveFacebook dry-run against a
//                            stable IG reel / FB watch URL. Confirms
//                            the actor produces >=1 slide for a known
//                            healthy session.
//   stage 3  escalation    - escalateAuthWallToApify against the same
//                            URL. Confirms the residential-proxy
//                            recovery path is wired up and Apify still
//                            returns bytes when forced through the
//                            heavier escalation route.
//
// The composite outcome is recorded against auth_health using only the
// existing schema (status / lastError / lastErrorClass / probeUrl). The
// per-stage breakdown is encoded into lastError as a "stage:result"
// triplet so admins can read the full picture without a schema change.

import { logger } from "./logger";
import {
  COOKIE_PLATFORMS,
  type CookiePlatform,
  recordProbeOutcome,
  resolveActiveJar,
} from "./auth-cookies";
import { classifyError } from "./media-downloader-helpers";

const PROBE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.AUTH_HEALTH_PROBE_INTERVAL_MS) || 6 * 60 * 60 * 1000,
);
const PROBE_TIMEOUT_MS = 60_000;
const REACHABILITY_TIMEOUT_MS = 10_000;

// T159: must mirror the actor names media-downloader.ts uses for the
// primary IG/FB scraper. Hard-coded here (rather than imported) so the
// probe is independent of the worker's module init order; if these
// drift, the reachability stage will fail loudly rather than silently
// probing a different actor than production uses.
const PRIMARY_ACTOR: Record<CookiePlatform, string> = {
  ig: "apify~instagram-scraper",
  fb: "apify~facebook-posts-scraper",
};

// Long-lived IG/FB URLs the Apify actors should reliably extract for
// any healthy session. Individual reels/watch pages, NOT public profile
// roots (those frequently load anonymously and would mask a degraded
// session). Overrideable via env so admins can swap when a default rots.
function defaultProbeUrl(platform: CookiePlatform): string {
  if (platform === "ig") {
    return process.env.AUTH_HEALTH_PROBE_URL_IG
      || "https://www.instagram.com/reel/C9X6Q4mIpXh/";
  }
  return process.env.AUTH_HEALTH_PROBE_URL_FB
    || "https://www.facebook.com/watch/?v=10153231379946729";
}

interface StageOutcome {
  ok: boolean;
  errorClass?: string;
  error?: string;
  durationMs: number;
}

interface ProbeOutcome {
  ok: boolean;
  errorClass?: string;
  error?: string;
  slides?: number;
  stages: {
    reachability: StageOutcome;
    extraction: StageOutcome;
    escalation: StageOutcome;
  };
}

// Stage 1: Apify v2 actor metadata reachability. Pure HTTP GET, no
// run-sync compute consumed. A 401/403 means APIFY_TOKEN is missing or
// invalid; 404 means the actor name drifted; network errors mean Apify
// itself is unreachable. Any of those should down-rank session health
// before we even attempt an extraction.
async function checkApifyReachability(actor: string): Promise<StageOutcome> {
  const startedAt = Date.now();
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return {
      ok: false,
      errorClass: "apify-token-missing",
      error: "APIFY_TOKEN env var not set; Apify cannot run.",
      durationMs: Date.now() - startedAt,
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}` +
        `?token=${encodeURIComponent(token)}`,
      { method: "GET", signal: ctrl.signal },
    );
    if (resp.status === 401 || resp.status === 403) {
      return {
        ok: false,
        errorClass: "apify-unauthorized",
        error: `Apify rejected APIFY_TOKEN (HTTP ${resp.status}); rotate the operator token.`,
        durationMs: Date.now() - startedAt,
      };
    }
    if (resp.status === 404) {
      return {
        ok: false,
        errorClass: "apify-actor-missing",
        error: `Apify actor ${actor} not found (HTTP 404); update PRIMARY_ACTOR.`,
        durationMs: Date.now() - startedAt,
      };
    }
    if (!resp.ok) {
      return {
        ok: false,
        errorClass: classifyError(`apify reachability HTTP ${resp.status}`),
        error: `Apify metadata HTTP ${resp.status}`,
        durationMs: Date.now() - startedAt,
      };
    }
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    const aborted = (err?.name === "AbortError");
    return {
      ok: false,
      errorClass: aborted ? "timeout" : classifyError(err?.message || String(err)),
      error: aborted
        ? `Apify reachability timeout (${REACHABILITY_TIMEOUT_MS}ms)`
        : (err?.message || String(err)).slice(0, 300),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Stage 2: original Apify dry-run via batchResolve*. Returns slide
// count on success so the dashboard can surface "extracted N slides"
// rather than just "ok".
async function checkExtraction(
  platform: CookiePlatform,
  url: string,
): Promise<StageOutcome & { slides?: number }> {
  const md = await import("./media-downloader");
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<StageOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        errorClass: "timeout",
        error: `apify extraction timeout (${PROBE_TIMEOUT_MS}ms)`,
        durationMs: Date.now() - startedAt,
      });
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
  });
  const workPromise: Promise<StageOutcome & { slides?: number }> = (async () => {
    try {
      const out: Map<string, { slides?: unknown[] }> = platform === "ig"
        ? await md.batchResolveInstagram([url])
        : await md.batchResolveFacebook([url], { residentialProxy: true });
      const id = md.urlIdentity(url);
      const entry = id ? out.get(id) : undefined;
      const slides = Array.isArray(entry?.slides) ? entry!.slides : [];
      if (slides.length > 0) {
        return { ok: true, slides: slides.length, durationMs: Date.now() - startedAt };
      }
      const err = "apify dry-run returned no slides";
      return {
        ok: false,
        errorClass: classifyError(err),
        error: err,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      return {
        ok: false,
        errorClass: classifyError(msg),
        error: msg.slice(0, 400),
        durationMs: Date.now() - startedAt,
      };
    }
  })();
  try {
    return await Promise.race([workPromise, timeoutPromise]) as StageOutcome & { slides?: number };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Stage 3: residential-proxy escalation. Confirms the recovery path
// production uses when yt-dlp hits an auth wall actually produces
// bytes. We only run this if extraction passed, because an extraction
// failure already implies escalation is unreliable and there's no
// reason to burn a residential-proxy run on a known-broken pipeline.
async function checkEscalation(
  platform: CookiePlatform,
  url: string,
): Promise<StageOutcome> {
  const md = await import("./media-downloader");
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<StageOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        errorClass: "timeout",
        error: `apify escalation timeout (${PROBE_TIMEOUT_MS}ms)`,
        durationMs: Date.now() - startedAt,
      });
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
  });
  const workPromise: Promise<StageOutcome> = (async () => {
    try {
      const result = await md.escalateAuthWallToApify(url, {
        rowKey: `auth-health:${platform}`,
        adLink: url,
        strategy: "auth-health-probe",
      });
      if (result.ok) {
        return { ok: true, durationMs: Date.now() - startedAt };
      }
      return {
        ok: false,
        errorClass: classifyError(result.error),
        error: (result.error || "escalation failed").slice(0, 300),
        durationMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      return {
        ok: false,
        errorClass: classifyError(msg),
        error: msg.slice(0, 300),
        durationMs: Date.now() - startedAt,
      };
    }
  })();
  try {
    return await Promise.race([workPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Compose a single auth_health-shaped outcome from the per-stage
// results. The first failing stage drives the recorded errorClass; the
// composite error string includes every stage so the dashboard can
// render the full breakdown without a schema change.
function composeOutcome(stages: ProbeOutcome["stages"], slides: number): ProbeOutcome {
  const tag = (name: string, s: StageOutcome) =>
    `${name}=${s.ok ? "ok" : (s.errorClass || "fail")}(${s.durationMs}ms)${s.ok ? "" : `: ${s.error || ""}`}`;
  const breakdown = [
    tag("reachability", stages.reachability),
    tag("extraction", stages.extraction),
    tag("escalation", stages.escalation),
  ].join(" | ");
  // First failing stage drives the headline classifier, with reachability
  // taking precedence (it gates everything downstream).
  const firstFail = !stages.reachability.ok
    ? stages.reachability
    : !stages.extraction.ok
      ? stages.extraction
      : !stages.escalation.ok
        ? stages.escalation
        : null;
  if (!firstFail) {
    return {
      ok: true,
      slides,
      stages,
    };
  }
  return {
    ok: false,
    errorClass: firstFail.errorClass || "auth-health-failed",
    error: breakdown,
    slides,
    stages,
  };
}

async function runProbeForPlatform(
  platform: CookiePlatform,
  probeUrl: string,
): Promise<ProbeOutcome> {
  const reachability = await checkApifyReachability(PRIMARY_ACTOR[platform]);
  // Skip downstream stages when reachability fails - they will all
  // fail with the same root cause and just burn time.
  if (!reachability.ok) {
    const skipped: StageOutcome = {
      ok: false,
      errorClass: "skipped",
      error: "skipped due to reachability failure",
      durationMs: 0,
    };
    return composeOutcome(
      { reachability, extraction: skipped, escalation: skipped },
      0,
    );
  }
  const extraction = await checkExtraction(platform, probeUrl);
  if (!extraction.ok) {
    const skipped: StageOutcome = {
      ok: false,
      errorClass: "skipped",
      error: "skipped due to extraction failure",
      durationMs: 0,
    };
    return composeOutcome(
      { reachability, extraction, escalation: skipped },
      extraction.slides ?? 0,
    );
  }
  const escalation = await checkEscalation(platform, probeUrl);
  return composeOutcome(
    { reachability, extraction, escalation },
    extraction.slides ?? 0,
  );
}

// Exported so the admin "Run Probe Now" button can force a pass without
// waiting for the 6h cadence. Same code path as the periodic timer.
export async function runProbeOnce(): Promise<void> {
  for (const platform of COOKIE_PLATFORMS) {
    try {
      const probeUrl = defaultProbeUrl(platform);
      const outcome = await runProbeForPlatform(platform, probeUrl);
      await recordProbeOutcome({
        platform,
        ok: outcome.ok,
        errorClass: outcome.errorClass ?? null,
        error: outcome.error ?? null,
        probeUrl,
      });
      logger.info(
        {
          platform,
          probeUrl,
          ok: outcome.ok,
          slides: outcome.slides ?? 0,
          errorClass: outcome.errorClass,
          stages: {
            reachability: { ok: outcome.stages.reachability.ok, ms: outcome.stages.reachability.durationMs },
            extraction: { ok: outcome.stages.extraction.ok, ms: outcome.stages.extraction.durationMs },
            escalation: { ok: outcome.stages.escalation.ok, ms: outcome.stages.escalation.durationMs },
          },
        },
        "auth-health-probe: apify session-health result",
      );
    } catch (err: any) {
      logger.error({ err: err?.message || String(err), platform }, "auth-health-probe: unexpected failure");
    }
  }
}

let probeTimer: NodeJS.Timeout | null = null;
function scheduleNextProbe(): void {
  // ±10% jitter so concurrent worker restarts don't all probe in lockstep.
  const jitter = Math.floor((Math.random() * 0.2 - 0.1) * PROBE_INTERVAL_MS);
  const wait = Math.max(60_000, PROBE_INTERVAL_MS + jitter);
  probeTimer = setTimeout(() => {
    runProbeOnce()
      .catch((err) => logger.error({ err }, "auth-health-probe pass failed"))
      .finally(() => scheduleNextProbe());
  }, wait);
  probeTimer.unref?.();
}

// Admin diagnostics: run a single Apify dry-run against an arbitrary
// URL. Returns whether authenticated extraction succeeded, the
// classified error if not, and the slide count Apify produced. Read-
// only - does not write to auth_health, so an admin can sanity-check
// any URL without polluting the dashboard signal.
//
// T159: jarId is reported for operator context only (so an admin can
// correlate an Apify result with a legacy jar still on disk). It MUST
// NOT gate ok/fail - the Apify session is the source of truth, and a
// missing jar is irrelevant when the path no longer uses cookies.
export interface DiagnosticStage {
  ok: boolean;
  errorClass: string | null;
  error: string | null;
  durationMs: number;
}

export interface DiagnosticResult {
  ok: boolean;
  url: string;
  platform: CookiePlatform | null;
  jarId: number | null;
  slideCount: number;
  errorClass: string | null;
  error: string | null;
  durationMs: number;
  // T159: per-stage breakdown so the admin Diagnose URL panel can show
  // exactly which capability of the Apify session is broken (rather
  // than collapsing all three checks into one boolean). Same triad the
  // scheduled probe runs.
  stages: {
    reachability: DiagnosticStage;
    extraction: DiagnosticStage;
    escalation: DiagnosticStage;
  };
}

function toDiagnosticStage(s: StageOutcome): DiagnosticStage {
  return {
    ok: s.ok,
    errorClass: s.ok ? null : (s.errorClass ?? null),
    error: s.ok ? null : (s.error ?? null),
    durationMs: s.durationMs,
  };
}

const SKIPPED_STAGE: DiagnosticStage = {
  ok: false,
  errorClass: "skipped",
  error: "skipped due to upstream stage failure",
  durationMs: 0,
};

function makeSkippedStage(): StageOutcome {
  return {
    ok: false,
    errorClass: "skipped",
    error: "skipped due to upstream stage failure",
    durationMs: 0,
  };
}

export async function runDiagnostic(opts: {
  url: string;
  platformOverride?: CookiePlatform | null;
}): Promise<DiagnosticResult> {
  const { platformFromUrl } = await import("./auth-cookies");
  const platform = opts.platformOverride ?? platformFromUrl(opts.url);
  if (!platform) {
    return {
      ok: false,
      url: opts.url,
      platform: null,
      jarId: null,
      slideCount: 0,
      errorClass: "unknown-platform",
      error: "URL hostname is not Instagram or Facebook; pass platformOverride to force.",
      durationMs: 0,
      stages: {
        reachability: { ...SKIPPED_STAGE },
        extraction: { ...SKIPPED_STAGE },
        escalation: { ...SKIPPED_STAGE },
      },
    };
  }
  // Operator-context only - never gates ok/fail. Wrapped in try so a
  // jar-table read failure doesn't block the diagnostic itself.
  let jarId: number | null = null;
  try {
    const jar = await resolveActiveJar(platform);
    jarId = jar?.id ?? null;
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), platform },
      "auth-health-probe: resolveActiveJar failed in runDiagnostic; reporting jarId=null",
    );
  }
  const startedAt = Date.now();
  // T159: full 3-stage capability check, mirroring runProbeForPlatform
  // exactly. Read-only - we do NOT call recordProbeOutcome here, so
  // the dashboard's auth_health signal is untouched.
  const reachability = await checkApifyReachability(PRIMARY_ACTOR[platform]);
  let extraction: StageOutcome & { slides?: number } = { ...makeSkippedStage(), slides: 0 };
  let escalation: StageOutcome = makeSkippedStage();
  if (reachability.ok) {
    extraction = await checkExtraction(platform, opts.url);
    if (extraction.ok) {
      escalation = await checkEscalation(platform, opts.url);
    }
  }
  const composed = composeOutcome(
    { reachability, extraction, escalation },
    extraction.slides ?? 0,
  );
  return {
    ok: composed.ok,
    url: opts.url,
    platform,
    jarId,
    slideCount: extraction.slides ?? 0,
    errorClass: composed.ok ? null : (composed.errorClass ?? null),
    error: composed.ok ? null : (composed.error ?? null),
    durationMs: Date.now() - startedAt,
    stages: {
      reachability: toDiagnosticStage(reachability),
      extraction: toDiagnosticStage(extraction),
      escalation: toDiagnosticStage(escalation),
    },
  };
}

export function startAuthHealthProbe(): void {
  if (process.env.AUTH_HEALTH_PROBE_DISABLED === "1") {
    logger.warn("AUTH_HEALTH_PROBE_DISABLED=1 set; auth health probe will not run");
    return;
  }
  // Run an initial pass shortly after boot so the dashboard has fresh
  // data on every restart, then settle into the periodic cadence.
  setTimeout(() => {
    runProbeOnce()
      .catch((err) => logger.error({ err }, "auth-health-probe boot pass failed"))
      .finally(() => scheduleNextProbe());
  }, 30_000).unref?.();
  logger.info({ intervalMs: PROBE_INTERVAL_MS }, "auth-health-probe: scheduled (apify 3-stage)");
}
