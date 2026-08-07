// Slice C verification probes. Pure functions only (no network).
// Exercises normalizeWebhook, classifyFailure, reliability rollup,
// capabilities, and STAGE_PROVIDER_CHAINS to confirm the adapter
// surface area matches the legacy inline-extraction parity. Does NOT
// spin up the API server, the worker, or talk to any provider.
//
// Run with: pnpm --filter @workspace/api-server exec tsx src/providers/__verify__/slice-c-probe.ts
import { higgsfieldAdapter } from "../higgsfield/adapter";
import { enhancorAdapter } from "../enhancor/adapter";
import { geminiAdapter } from "../gemini/adapter";
import {
  capabilityMatrix,
  STAGE_PROVIDER_CHAINS,
  providerChainFor,
  providersSnapshot,
  getProvider,
} from "../shared/manager";
import {
  recordReliabilityEvent,
  getReliabilitySnapshot,
  _resetReliabilityForTests,
} from "../shared/reliability";
import {
  classifyToFailureClass,
  failureRetryability,
} from "../shared/types";

type Verdict = "PASS" | "FAIL";
const results: { name: string; verdict: Verdict; detail?: string }[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  results.push({ name, verdict: cond ? "PASS" : "FAIL", detail });
}

// ────────────────────────────────────────────────────────────────────────
// Area 1: capabilities + registry
// ────────────────────────────────────────────────────────────────────────
const matrix = capabilityMatrix();
check(
  "capability.higgsfield.webhook=true && polling=true",
  matrix.higgsfield.webhook === true && matrix.higgsfield.polling === true,
);
check(
  "capability.enhancor.webhook=true && polling=false",
  matrix.enhancor.webhook === true && matrix.enhancor.polling === false,
);
check(
  "capability.gemini.webhook=false && polling=false",
  matrix.gemini.webhook === false && matrix.gemini.polling === false,
);
check(
  "registry.getProvider(higgsfield).id === higgsfield",
  getProvider("higgsfield").id === "higgsfield",
);
check(
  "registry.getProvider(enhancor).id === enhancor",
  getProvider("enhancor").id === "enhancor",
);
check(
  "registry.getProvider(gemini).id === gemini",
  getProvider("gemini").id === "gemini",
);
check(
  "STAGE_PROVIDER_CHAINS.base_generation === [higgsfield]",
  JSON.stringify(STAGE_PROVIDER_CHAINS.base_generation) ===
    JSON.stringify(["higgsfield"]),
);
check(
  "STAGE_PROVIDER_CHAINS.base_fallback === [gemini]",
  JSON.stringify(STAGE_PROVIDER_CHAINS.base_fallback) ===
    JSON.stringify(["gemini"]),
);
check(
  "STAGE_PROVIDER_CHAINS.enhancement === [enhancor]",
  JSON.stringify(STAGE_PROVIDER_CHAINS.enhancement) ===
    JSON.stringify(["enhancor"]),
);
check(
  "STAGE_PROVIDER_CHAINS.scene_swap === [gemini]",
  JSON.stringify(STAGE_PROVIDER_CHAINS.scene_swap) ===
    JSON.stringify(["gemini"]),
);
check("providerChainFor(unknown) === []", providerChainFor("nope").length === 0);

// ────────────────────────────────────────────────────────────────────────
// Area 2: Higgsfield normalizeWebhook parity vs legacy inline parser.
// Legacy webhook handler order:
//   body.images?.[0]?.url
//   body.imageUrl
//   body.image_url
//   normalized.assetUrls[0]   ← only matters when the first 3 miss
//
// The legacy handler in routes/influencer-jobs.ts does NOT consume
// inner.results.raw.url or top-level results.raw.url itself. The
// adapter's normalizeWebhook DOES surface those (because that is the
// real Higgsfield job-sets shape), and is wired in only as the 4th
// fallback - so any payload the legacy parser already decoded keeps
// winning. We verify both halves: legacy-shape webhooks normalize to
// `null` assetUrls (so they fall through to the legacy path), and
// job-sets shapes get a usable url that fills the gap.
// ────────────────────────────────────────────────────────────────────────
{
  // Job-sets shape (the production async response). Legacy parser
  // CANNOT decode this; adapter MUST surface the url so the 4th
  // fallback in the route catches it.
  const jobSetsCompleted = {
    jobs: [
      {
        id: "abc-123",
        status: "completed",
        results: {
          raw: { url: "https://hf.example/raw.png" },
          min: { url: "https://hf.example/min.png" },
        },
      },
    ],
  };
  const n = higgsfieldAdapter.normalizeWebhook(jobSetsCompleted);
  check(
    "hf.normalizeWebhook(jobs[0] completed) -> status=completed",
    n.status === "completed",
  );
  check(
    "hf.normalizeWebhook(jobs[0] completed) -> raw.url preferred over min.url",
    n.assetUrls[0] === "https://hf.example/raw.png",
  );
  check(
    "hf.normalizeWebhook(jobs[0] completed) -> providerJobId=abc-123",
    n.providerJobId === "abc-123",
  );
  check(
    "hf.normalizeWebhook(jobs[0] completed) -> terminal && !degraded && !error",
    n.terminal === true && n.degraded === false && n.error === null,
  );
}
{
  // In-progress payload (status != completed). Adapter MUST report
  // in_progress and emit zero asset urls.
  const inProgress = { jobs: [{ id: "x", status: "running" }] };
  const n = higgsfieldAdapter.normalizeWebhook(inProgress);
  check(
    "hf.normalizeWebhook(in_progress) -> status=in_progress",
    n.status === "in_progress" && n.assetUrls.length === 0,
  );
  check(
    "hf.normalizeWebhook(in_progress) -> retryable=true && terminal=false",
    n.retryable === true && n.terminal === false,
  );
}
{
  // Completed-but-no-url. Adapter MUST flag degraded + EMPTY_OUTPUT.
  const completedNoUrl = { jobs: [{ id: "x", status: "completed" }] };
  const n = higgsfieldAdapter.normalizeWebhook(completedNoUrl);
  check(
    "hf.normalizeWebhook(completed-no-url) -> degraded + EMPTY_OUTPUT",
    n.degraded === true &&
      n.error !== null &&
      n.error.class === "EMPTY_OUTPUT",
  );
}
{
  // Top-level single-job shape (the alternate Higgsfield callback).
  const topLevel = {
    status: "completed",
    results: { raw: { url: "https://hf.example/top.png" } },
  };
  const n = higgsfieldAdapter.normalizeWebhook(topLevel);
  check(
    "hf.normalizeWebhook(top-level completed) -> url surfaced",
    n.assetUrls[0] === "https://hf.example/top.png" && n.status === "completed",
  );
}
{
  // Legacy webhook shape (body.images[0].url). The legacy inline
  // parser handles this directly. Adapter need not surface a url for
  // this shape - if it does, that's a bonus, but the contract is that
  // the legacy parser owns this case.
  const legacyShape = { images: [{ url: "https://hf.example/legacy.png" }] };
  const n = higgsfieldAdapter.normalizeWebhook(legacyShape as any);
  // Adapter does NOT pull from body.images[]. assetUrls[0] is therefore
  // expected to be undefined, and the legacy parser owns this path.
  check(
    "hf.normalizeWebhook(images[0].url) -> adapter does NOT shadow legacy parser",
    n.assetUrls[0] === undefined,
    "legacy-only field; legacy handler still wins",
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area 3: Enhancor normalizeWebhook parity.
// Legacy inline parser order:
//   body.output_url
//   body.outputUrl
//   body.image_url
//   body.imageUrl
//   body.url
//   body.result?.url
//   normalized.assetUrls[0]
//
// Adapter pickEnhancorUrl order:
//   imageUrl > image_url > data.url > output(string|.url) > result(string|.url)
//
// Note: enhancor adapter does NOT decode body.output_url / body.url
// (the legacy-only fields). That's by design - those are owned by the
// inline parser. The adapter covers the modern shapes the legacy
// parser does not (data.url, output as object, result as string).
// ────────────────────────────────────────────────────────────────────────
{
  const a = enhancorAdapter.normalizeWebhook({ imageUrl: "https://e/a.png" });
  check("en.normalizeWebhook(imageUrl)", a.assetUrls[0] === "https://e/a.png");
  const b = enhancorAdapter.normalizeWebhook({ image_url: "https://e/b.png" });
  check("en.normalizeWebhook(image_url)", b.assetUrls[0] === "https://e/b.png");
  const c = enhancorAdapter.normalizeWebhook({
    data: { url: "https://e/c.png" },
  });
  check("en.normalizeWebhook(data.url)", c.assetUrls[0] === "https://e/c.png");
  const d = enhancorAdapter.normalizeWebhook({
    output: { url: "https://e/d.png" },
  });
  check(
    "en.normalizeWebhook(output.url)",
    d.assetUrls[0] === "https://e/d.png",
  );
  const e = enhancorAdapter.normalizeWebhook({ output: "https://e/e.png" });
  check(
    "en.normalizeWebhook(output as string)",
    e.assetUrls[0] === "https://e/e.png",
  );
  const f = enhancorAdapter.normalizeWebhook({
    result: { url: "https://e/f.png" },
  });
  check(
    "en.normalizeWebhook(result.url)",
    f.assetUrls[0] === "https://e/f.png",
  );
  const g = enhancorAdapter.normalizeWebhook({ result: "https://e/g.png" });
  check(
    "en.normalizeWebhook(result as string)",
    g.assetUrls[0] === "https://e/g.png",
  );
}
{
  // Empty payload -> degraded + EMPTY_OUTPUT + ENHANCOR_DEGRADED code.
  // This is the same shape Slice A uses to advance to ready_degraded.
  const empty = enhancorAdapter.normalizeWebhook({});
  check(
    "en.normalizeWebhook({}) -> degraded + EMPTY_OUTPUT class",
    empty.degraded === true &&
      empty.error !== null &&
      empty.error.class === "EMPTY_OUTPUT",
  );
  check(
    "en.normalizeWebhook({}) -> code=ENHANCOR_DEGRADED",
    empty.error?.code === "ENHANCOR_DEGRADED",
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area 4: Gemini normalizeWebhook (no channel) -> TERMINAL.
// ────────────────────────────────────────────────────────────────────────
{
  const n = geminiAdapter.normalizeWebhook({});
  check(
    "gemini.normalizeWebhook(any) -> terminal failure",
    n.status === "failed" && n.terminal === true && n.retryable === false,
  );
  check(
    "gemini.normalizeWebhook(any) -> class=TERMINAL",
    n.error?.class === "TERMINAL" && n.error?.code === "WEBHOOK_FAILURE",
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area 5: classifyFailure mapping parity (matches legacy classifyError).
// We sweep status codes + message patterns and confirm each adapter
// returns the same NormalizedError shape and the right FailureClass.
// ────────────────────────────────────────────────────────────────────────
const adapters = [
  { name: "hf", a: higgsfieldAdapter },
  { name: "en", a: enhancorAdapter },
  { name: "gem", a: geminiAdapter },
];
for (const { name, a } of adapters) {
  const e408 = a.classifyFailure({ status: 408 });
  check(
    `${name}.classifyFailure(408) -> TIMEOUT class & PROVIDER_TIMEOUT code`,
    e408.class === "TIMEOUT" && e408.code === "PROVIDER_TIMEOUT",
  );
  const e429 = a.classifyFailure({ status: 429 });
  check(
    `${name}.classifyFailure(429) -> RATE_LIMIT`,
    e429.class === "RATE_LIMIT" && e429.code === "RATE_LIMIT",
  );
  const e401 = a.classifyFailure({ status: 401 });
  check(
    `${name}.classifyFailure(401) -> AUTH_FAILURE class`,
    e401.class === "AUTH_FAILURE" && e401.terminal === true,
  );
  const e500 = a.classifyFailure({ status: 500 });
  check(
    `${name}.classifyFailure(500) -> TIMEOUT class (legacy maps 5xx to PROVIDER_TIMEOUT)`,
    e500.class === "TIMEOUT" && e500.code === "PROVIDER_TIMEOUT",
  );
  const eEmpty = a.classifyFailure({ emptyOutput: true });
  check(
    `${name}.classifyFailure(emptyOutput) -> EMPTY_OUTPUT`,
    eEmpty.class === "EMPTY_OUTPUT" && eEmpty.code === "EMPTY_OUTPUT",
  );
  const eUnknown = a.classifyFailure({ err: new Error("kaboom") });
  check(
    `${name}.classifyFailure(generic) -> TRANSIENT class (UNKNOWN code)`,
    eUnknown.class === "TRANSIENT" && eUnknown.code === "UNKNOWN",
  );
  const eTimeoutMsg = a.classifyFailure({ err: new Error("Request aborted") });
  check(
    `${name}.classifyFailure(aborted) -> TIMEOUT class (PROVIDER_TIMEOUT code)`,
    eTimeoutMsg.class === "TIMEOUT" && eTimeoutMsg.code === "PROVIDER_TIMEOUT",
  );
}

// classifyToFailureClass + failureRetryability exhaustive sweep
const codes = [
  "PROVIDER_TIMEOUT",
  "RATE_LIMIT",
  "INVALID_RESPONSE",
  "EMPTY_OUTPUT",
  "WEBHOOK_FAILURE",
  "SCENE_SWAP_FAILURE",
  "PARTIAL_BATCH_FAILURE",
  "DELIVERY_FAILURE",
  "CONFIG_MISSING",
  "ENHANCOR_DEGRADED",
  "UNKNOWN",
] as const;
for (const c of codes) {
  const fc = classifyToFailureClass(c);
  const r = failureRetryability(fc);
  check(
    `classifyToFailureClass(${c}) -> defined && retryability resolvable`,
    typeof fc === "string" && typeof r.retryable === "boolean",
  );
}
// Spot-check the critical retryability decisions the orchestration
// layer depends on (CONFIG_MISSING must be terminal so the pipeline
// does not retry an unconfigured provider forever).
{
  const fc = classifyToFailureClass("CONFIG_MISSING");
  const r = failureRetryability(fc);
  check(
    "CONFIG_MISSING -> AUTH_FAILURE class -> terminal=true, retryable=false",
    fc === "AUTH_FAILURE" && r.terminal === true && r.retryable === false,
  );
}
{
  const fc = classifyToFailureClass("RATE_LIMIT");
  const r = failureRetryability(fc);
  check(
    "RATE_LIMIT -> retryable=true, terminal=false",
    fc === "RATE_LIMIT" && r.retryable === true && r.terminal === false,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area 6: reliability rollup math + ring-buffer cap.
// ────────────────────────────────────────────────────────────────────────
_resetReliabilityForTests();
recordReliabilityEvent({
  provider: "higgsfield",
  ts: Date.now(),
  success: true,
  latencyMs: 100,
});
recordReliabilityEvent({
  provider: "higgsfield",
  ts: Date.now(),
  success: false,
  latencyMs: 200,
  errorClass: "TIMEOUT",
});
recordReliabilityEvent({
  provider: "higgsfield",
  ts: Date.now(),
  success: false,
  errorClass: "EMPTY_OUTPUT",
});
const snap = getReliabilitySnapshot().find((s) => s.provider === "higgsfield");
check("reliability.sampleSize=3", snap?.sampleSize === 3);
check(
  "reliability.successRate≈0.333",
  Math.abs((snap?.successRate ?? 0) - 1 / 3) < 0.001,
);
check("reliability.timeoutRate≈0.333", Math.abs((snap?.timeoutRate ?? 0) - 1 / 3) < 0.001);
check(
  "reliability.emptyOutputRate≈0.333",
  Math.abs((snap?.emptyOutputRate ?? 0) - 1 / 3) < 0.001,
);
check("reliability.avgLatency=150", snap?.avgLatency === 150);
// Ring buffer cap: 600 events should clamp to 500.
_resetReliabilityForTests();
for (let i = 0; i < 600; i++) {
  recordReliabilityEvent({
    provider: "gemini",
    ts: Date.now(),
    success: true,
    latencyMs: 1,
  });
}
const gemSnap = getReliabilitySnapshot().find((s) => s.provider === "gemini");
check("reliability.ring buffer caps at 500", gemSnap?.sampleSize === 500);

// ────────────────────────────────────────────────────────────────────────
// Area 7: providersSnapshot shape (admin/diagnostic surface).
// ────────────────────────────────────────────────────────────────────────
{
  const s = providersSnapshot();
  check(
    "providersSnapshot.providers length=3",
    s.providers.length === 3,
  );
  check(
    "providersSnapshot.flags has failover/routing/scoring",
    typeof s.flags.failover === "boolean" &&
      typeof s.flags.routing === "boolean" &&
      typeof s.flags.scoring === "boolean",
  );
  check(
    "providersSnapshot flags default OFF",
    s.flags.failover === false &&
      s.flags.routing === false &&
      s.flags.scoring === false,
  );
  check(
    "providersSnapshot.chains has all 4 stages",
    Object.keys(s.chains).sort().join(",") ===
      ["base_fallback", "base_generation", "enhancement", "scene_swap"]
        .sort()
        .join(","),
  );
  check(
    "providersSnapshot.reliability returns 3 provider entries",
    s.reliability.length === 3,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.verdict === "PASS").length;
const failed = results.filter((r) => r.verdict === "FAIL").length;
for (const r of results) {
  const icon = r.verdict === "PASS" ? "[PASS]" : "[FAIL]";
  console.log(`${icon} ${r.name}${r.detail ? "  -- " + r.detail : ""}`);
}
console.log(`\n${passed} passed, ${failed} failed (${results.length} total).`);
if (failed > 0) process.exit(1);
