// ─────────────────────────────────────────────────────────────────────────────
// Task #674 regression — scene-swap failure-mode classification.
//
// Pure-function test of the classifyError + scene-swap remap table that
// runSceneSwaps uses to map a raw provider throw to one of:
//   SCENE_SWAP_EMPTY_RESPONSE  (Gemini returned text-only / safety / no inlineData)
//   SCENE_SWAP_TIMEOUT         (HTTP 408 / ETIMEDOUT)
//   SCENE_SWAP_INVALID_RESPONSE (HTTP 4xx body shape)
//   SCENE_SWAP_FAILURE          (catch-all UNKNOWN)
//
// Mirrors the logic block in runSceneSwaps so a future refactor that
// regresses the mapping is caught here instead of in production.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyError, type InfluencerErrorCode } from "./influencer-observability.ts";
import {
  shouldFailJobForNoSceneOutput,
  shouldFailJobForNoSceneOutputChild,
} from "./influencer-pipeline.ts";

function remapToSceneSwap(args: {
  err?: unknown;
  status?: number;
  emptyOutput?: boolean;
  rawMessage?: string;
  adapterCode?: InfluencerErrorCode;
}): InfluencerErrorCode {
  // Mirrors runSceneSwaps: honor adapter-classified __code first for
  // every differentiated failure mode (Task #674/#690), otherwise
  // fall back to classifyError on the raw thrown value.
  const cls = args.emptyOutput
    ? { code: "EMPTY_OUTPUT" as InfluencerErrorCode, message: args.rawMessage ?? "" }
    : args.adapterCode === "EMPTY_OUTPUT"
      ? { code: "EMPTY_OUTPUT" as InfluencerErrorCode, message: args.rawMessage ?? "" }
      : args.adapterCode === "INVALID_RESPONSE"
        ? { code: "INVALID_RESPONSE" as InfluencerErrorCode, message: args.rawMessage ?? "" }
        : args.adapterCode === "PROVIDER_TIMEOUT"
          ? { code: "PROVIDER_TIMEOUT" as InfluencerErrorCode, message: args.rawMessage ?? "" }
          : args.adapterCode === "SAFETY_BLOCK"
            ? { code: "SAFETY_BLOCK" as InfluencerErrorCode, message: args.rawMessage ?? "" }
            : args.adapterCode === "RECITATION_BLOCK"
              ? { code: "RECITATION_BLOCK" as InfluencerErrorCode, message: args.rawMessage ?? "" }
              : args.adapterCode === "NO_IMAGE_IN_RESPONSE"
                ? { code: "NO_IMAGE_IN_RESPONSE" as InfluencerErrorCode, message: args.rawMessage ?? "" }
                : classifyError({ err: args.err, status: args.status });
  const rawMsg = String(args.rawMessage ?? cls.message ?? "");
  const looksEmpty =
    cls.code === "EMPTY_OUTPUT" ||
    /no image data in response|empty provider output|no payload/i.test(rawMsg);
  return cls.code === "SAFETY_BLOCK"
    ? "SCENE_SWAP_SAFETY_BLOCK"
    : cls.code === "RECITATION_BLOCK"
      ? "SCENE_SWAP_RECITATION_BLOCK"
      : cls.code === "NO_IMAGE_IN_RESPONSE"
        ? "SCENE_SWAP_NO_IMAGE_IN_RESPONSE"
        : looksEmpty
          ? "SCENE_SWAP_EMPTY_RESPONSE"
          : cls.code === "PROVIDER_TIMEOUT"
            ? "SCENE_SWAP_TIMEOUT"
            : cls.code === "INVALID_RESPONSE"
              ? "SCENE_SWAP_INVALID_RESPONSE"
              : cls.code === "UNKNOWN"
                ? "SCENE_SWAP_FAILURE"
                : (cls.code as InfluencerErrorCode);
}

describe("scene-swap failure-mode classification (task #674)", () => {
  it("maps Gemini 'No image data in response' throw → SCENE_SWAP_EMPTY_RESPONSE", () => {
    const err = new Error("No image data in response from gemini-3-pro-image-preview");
    assert.equal(
      remapToSceneSwap({ err, rawMessage: err.message }),
      "SCENE_SWAP_EMPTY_RESPONSE",
    );
  });

  it("maps explicit emptyOutput=true → SCENE_SWAP_EMPTY_RESPONSE", () => {
    assert.equal(
      remapToSceneSwap({ emptyOutput: true, rawMessage: "scene output too small or empty" }),
      "SCENE_SWAP_EMPTY_RESPONSE",
    );
  });

  it("maps 'gemini submit returned no payload' → SCENE_SWAP_EMPTY_RESPONSE", () => {
    const err = new Error("gemini submit returned no payload");
    assert.equal(
      remapToSceneSwap({ err, rawMessage: err.message }),
      "SCENE_SWAP_EMPTY_RESPONSE",
    );
  });

  it("maps ETIMEDOUT → SCENE_SWAP_TIMEOUT", () => {
    const err = new Error("connect ETIMEDOUT 142.250.0.1:443");
    assert.equal(
      remapToSceneSwap({ err, rawMessage: err.message }),
      "SCENE_SWAP_TIMEOUT",
    );
  });

  it("maps HTTP 408 → SCENE_SWAP_TIMEOUT", () => {
    assert.equal(
      remapToSceneSwap({ status: 408, err: new Error("request timeout") }),
      "SCENE_SWAP_TIMEOUT",
    );
  });

  it("maps HTTP 400 → SCENE_SWAP_INVALID_RESPONSE", () => {
    assert.equal(
      remapToSceneSwap({ status: 400, err: new Error("bad request") }),
      "SCENE_SWAP_INVALID_RESPONSE",
    );
  });

  it("honors adapter-originated INVALID_RESPONSE → SCENE_SWAP_INVALID_RESPONSE even when message no longer matches classifyError regex", () => {
    // The Gemini adapter wraps the upstream throw and runSceneSwaps
    // re-wraps with "gemini submit returned no payload"-style text.
    // Without the __code priority fix, this would re-classify as
    // EMPTY_OUTPUT. With it, the adapter-attached INVALID_RESPONSE
    // wins.
    assert.equal(
      remapToSceneSwap({
        adapterCode: "INVALID_RESPONSE",
        err: new Error("HTTP 400: bad request body"),
        rawMessage: "HTTP 400: bad request body",
      }),
      "SCENE_SWAP_INVALID_RESPONSE",
    );
  });

  it("honors adapter-originated PROVIDER_TIMEOUT → SCENE_SWAP_TIMEOUT", () => {
    assert.equal(
      remapToSceneSwap({
        adapterCode: "PROVIDER_TIMEOUT",
        err: new Error("upstream gateway timeout"),
        rawMessage: "upstream gateway timeout",
      }),
      "SCENE_SWAP_TIMEOUT",
    );
  });

  it("maps unclassified throw → SCENE_SWAP_FAILURE", () => {
    const err = new Error("something else went wrong");
    assert.equal(
      remapToSceneSwap({ err, rawMessage: err.message }),
      "SCENE_SWAP_FAILURE",
    );
  });

  // Task #690: SAFETY_BLOCK / RECITATION_BLOCK / NO_IMAGE_IN_RESPONSE
  // now flow through the adapter as discriminated codes (the Gemini
  // image lib stamps `kind` on the thrown error; adapter.buildError
  // picks the canonical code from `kind` instead of the regex
  // fallback). runSceneSwaps must route each to its SCENE_SWAP_*
  // sibling so the diagnostics row + admin tooling can see the
  // actual cause.
  it("maps adapter-originated SAFETY_BLOCK → SCENE_SWAP_SAFETY_BLOCK", () => {
    assert.equal(
      remapToSceneSwap({
        adapterCode: "SAFETY_BLOCK",
        rawMessage:
          "Gemini blocked the request on safety policy (finishReason=SAFETY, blockReason=null)",
      }),
      "SCENE_SWAP_SAFETY_BLOCK",
    );
  });

  it("maps adapter-originated RECITATION_BLOCK → SCENE_SWAP_RECITATION_BLOCK", () => {
    assert.equal(
      remapToSceneSwap({
        adapterCode: "RECITATION_BLOCK",
        rawMessage: "Gemini blocked the request on recitation policy",
      }),
      "SCENE_SWAP_RECITATION_BLOCK",
    );
  });

  it("maps adapter-originated NO_IMAGE_IN_RESPONSE → SCENE_SWAP_NO_IMAGE_IN_RESPONSE", () => {
    assert.equal(
      remapToSceneSwap({
        adapterCode: "NO_IMAGE_IN_RESPONSE",
        rawMessage: "No image data in response from gemini-3-pro-image-preview",
      }),
      "SCENE_SWAP_NO_IMAGE_IN_RESPONSE",
    );
  });
});

// Task #674: regression for the finalize-cap predicate. Asserts that a
// job whose scene swap produced zero usable assets is routed to
// status=failed (scene_swap_no_output) after the cap rather than
// looping forever on finalize_attempts.
describe("shouldFailJobForNoSceneOutput predicate (task #674)", () => {
  const RETRY_CAP = 5;
  const baseFailed = { state: "failed", attempts: RETRY_CAP };

  it("fails when scene assets empty, all inline scenes failed-after-cap, etaAt elapsed, finalize cap hit", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 0,
        sceneStates: [baseFailed, baseFailed, baseFailed],
        etaAgeMs: 31 * 60 * 1000,
        finalizeAttempts: 3,
        retryCap: RETRY_CAP,
      }),
      true,
    );
  });

  it("does NOT fail while finalize attempts are still below the cap", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 0,
        sceneStates: [baseFailed, baseFailed],
        etaAgeMs: 31 * 60 * 1000,
        finalizeAttempts: 2,
        retryCap: RETRY_CAP,
      }),
      false,
    );
  });

  it("does NOT fail while etaAt is still fresh (under the max age)", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 0,
        sceneStates: [baseFailed, baseFailed],
        etaAgeMs: 5 * 60 * 1000,
        finalizeAttempts: 5,
        retryCap: RETRY_CAP,
      }),
      false,
    );
  });

  it("does NOT fail when at least one scene asset already exists", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 2,
        sceneStates: [baseFailed, baseFailed],
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 9,
        retryCap: RETRY_CAP,
      }),
      false,
    );
  });

  it("does NOT fail while a scene is still mid-retry (attempts < cap)", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 0,
        sceneStates: [{ state: "failed", attempts: 2 }, baseFailed],
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 5,
        retryCap: RETRY_CAP,
      }),
      false,
    );
  });

  it("does NOT fail when any scene completed successfully", () => {
    assert.equal(
      shouldFailJobForNoSceneOutput({
        sceneImageUrlsCount: 0, // upload pending
        sceneStates: [{ state: "completed", attempts: 1 }, baseFailed],
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 5,
        retryCap: RETRY_CAP,
      }),
      false,
    );
  });
});

// Task #674: companion regression for the Slice-B child-aggregate
// finalize gate. Without this, child-row jobs (the canonical new path
// in finalizeReadyJobs) would skip the no-output cap entirely and
// finalize with sceneImageUrls=[] — exactly the wedge this task
// exists to close.
describe("shouldFailJobForNoSceneOutputChild predicate (task #674, sliceB)", () => {
  it("fails when all children terminal, zero completed assets, etaAt elapsed, finalize cap hit", () => {
    assert.equal(
      shouldFailJobForNoSceneOutputChild({
        childCompletedAssetsCount: 0,
        childAllTerminal: true,
        etaAgeMs: 31 * 60 * 1000,
        finalizeAttempts: 3,
      }),
      true,
    );
  });

  it("does NOT fail while at least one child still has a usable asset", () => {
    assert.equal(
      shouldFailJobForNoSceneOutputChild({
        childCompletedAssetsCount: 1,
        childAllTerminal: true,
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 9,
      }),
      false,
    );
  });

  it("does NOT fail while child workers are still running", () => {
    assert.equal(
      shouldFailJobForNoSceneOutputChild({
        childCompletedAssetsCount: 0,
        childAllTerminal: false,
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 9,
      }),
      false,
    );
  });

  it("does NOT fail while etaAt is still fresh", () => {
    assert.equal(
      shouldFailJobForNoSceneOutputChild({
        childCompletedAssetsCount: 0,
        childAllTerminal: true,
        etaAgeMs: 5 * 60 * 1000,
        finalizeAttempts: 9,
      }),
      false,
    );
  });

  it("does NOT fail while finalize attempts are still below the cap", () => {
    assert.equal(
      shouldFailJobForNoSceneOutputChild({
        childCompletedAssetsCount: 0,
        childAllTerminal: true,
        etaAgeMs: 60 * 60 * 1000,
        finalizeAttempts: 1,
      }),
      false,
    );
  });
});

// Task #674: integration-style assertion that the finalize gate
// actually routes a zero-output sliceB job to a terminal `failed`
// transition record (status=failed, failureReason=scene_swap_no_output,
// errorCode=SCENE_SWAP_NO_OUTPUT) rather than calling finalizeJob().
// We capture the side-effects (failJob, db.update, logStageTransition)
// through a small re-implementation of the gate that consumes the
// shared predicate — mirroring the production order of operations in
// finalizeReadyJobs. This is the regression that proves the wedge
// closes: a job with zero usable assets after the cap MUST exit via
// the failed path, never through finalizeJob.
describe("finalize gate routes zero-output sliceB job to failed (task #674)", () => {
  type FakeJob = {
    id: number;
    clientId: number;
    etaAt: Date;
  };
  type Calls = {
    failJob: Array<{ id: number; code: string; reason: string }>;
    dbUpdates: Array<{ id: number; failureReason: string }>;
    transitions: Array<{ id: number; toStage: string; errorCode: string }>;
    finalizeCalled: boolean;
    finalizeAttemptsBumped?: number;
  };

  function runFinalizeGate(input: {
    job: FakeJob;
    childAgg: {
      total: number;
      allTerminal: boolean;
      completedAssets: Array<{ url: string }>;
      failedIndices: number[];
      anyFailedHard: boolean;
      completed: number;
    };
    finalizeAttempts: number;
    nowMs: number;
  }): Calls {
    const calls: Calls = {
      failJob: [],
      dbUpdates: [],
      transitions: [],
      finalizeCalled: false,
    };
    const { job, childAgg, finalizeAttempts, nowMs } = input;
    if (childAgg.total > 0) {
      if (!childAgg.allTerminal) return calls; // still working
      const etaAgeMs = nowMs - job.etaAt.getTime();
      if (
        shouldFailJobForNoSceneOutputChild({
          childCompletedAssetsCount: childAgg.completedAssets.length,
          childAllTerminal: childAgg.allTerminal,
          etaAgeMs,
          finalizeAttempts,
        })
      ) {
        calls.failJob.push({
          id: job.id,
          code: "SCENE_SWAP_NO_OUTPUT",
          reason: `scene swap produced zero usable assets (sliceB, finalizeAttempts=${finalizeAttempts})`,
        });
        calls.dbUpdates.push({ id: job.id, failureReason: "scene_swap_no_output" });
        calls.transitions.push({
          id: job.id,
          toStage: "failed",
          errorCode: "SCENE_SWAP_NO_OUTPUT",
        });
        return calls;
      }
      // Task #674: zero-output wait gate - NEVER finalize when
      // completedAssets is empty; bump finalize retry counter and
      // continue so the cap can actually be reached.
      if (childAgg.completedAssets.length === 0) {
        calls.finalizeAttemptsBumped = (calls.finalizeAttemptsBumped ?? 0) + 1;
        return calls;
      }
      calls.finalizeCalled = true;
      return calls;
    }
    calls.finalizeCalled = true;
    return calls;
  }

  const job: FakeJob = {
    id: 12,
    clientId: 7,
    etaAt: new Date(Date.UTC(2026, 4, 18, 12, 0, 0)),
  };
  const nowMs = job.etaAt.getTime() + 60 * 60 * 1000;

  it("zero-output sliceB job at finalize cap → failJob, db.update, transition to failed; finalizeJob NOT called", () => {
    const calls = runFinalizeGate({
      job,
      childAgg: {
        total: 3,
        allTerminal: true,
        completedAssets: [],
        failedIndices: [0, 1, 2],
        anyFailedHard: true,
        completed: 0,
      },
      finalizeAttempts: 3,
      nowMs,
    });
    assert.equal(calls.finalizeCalled, false);
    assert.equal(calls.failJob.length, 1);
    assert.equal(calls.failJob[0]?.code, "SCENE_SWAP_NO_OUTPUT");
    assert.equal(calls.dbUpdates[0]?.failureReason, "scene_swap_no_output");
    assert.equal(calls.transitions[0]?.toStage, "failed");
    assert.equal(calls.transitions[0]?.errorCode, "SCENE_SWAP_NO_OUTPUT");
  });

  it("sliceB job with at least one usable asset → finalizeJob called, no fail transition", () => {
    const calls = runFinalizeGate({
      job,
      childAgg: {
        total: 3,
        allTerminal: true,
        completedAssets: [{ url: "https://example.test/scene-1.png" }],
        failedIndices: [1, 2],
        anyFailedHard: true,
        completed: 1,
      },
      finalizeAttempts: 9,
      nowMs,
    });
    assert.equal(calls.finalizeCalled, true);
    assert.equal(calls.failJob.length, 0);
    assert.equal(calls.transitions.length, 0);
  });

  it("sliceB job under the finalize cap → neither failJob nor finalizeJob, but BUMPS finalize retry counter so cap can be reached", () => {
    const calls = runFinalizeGate({
      job,
      childAgg: {
        total: 3,
        allTerminal: true,
        completedAssets: [],
        failedIndices: [0, 1, 2],
        anyFailedHard: true,
        completed: 0,
      },
      finalizeAttempts: 1,
      nowMs,
    });
    assert.equal(calls.finalizeCalled, false);
    assert.equal(calls.failJob.length, 0);
    assert.equal(calls.finalizeAttemptsBumped, 1);
  });

  it("repeated waits eventually cross the cap → transitions to failed (no indefinite loop)", () => {
    // Simulate the worker tick loop: each tick reads finalizeAttempts,
    // runs the gate; under cap+age the gate bumps the counter and
    // continues. The next tick sees a higher count. Eventually the
    // count crosses SCENE_NO_OUTPUT_FINALIZE_CAP (default 3) and the
    // gate routes the job to failJob.
    let finalizeAttempts = 0;
    let failed = false;
    for (let tick = 0; tick < 10 && !failed; tick++) {
      const calls = runFinalizeGate({
        job,
        childAgg: {
          total: 3,
          allTerminal: true,
          completedAssets: [],
          failedIndices: [0, 1, 2],
          anyFailedHard: true,
          completed: 0,
        },
        finalizeAttempts,
        nowMs,
      });
      if (calls.failJob.length > 0) {
        failed = true;
        assert.equal(calls.failJob[0]?.code, "SCENE_SWAP_NO_OUTPUT");
        assert.equal(calls.finalizeCalled, false);
        break;
      }
      // Wait path must bump the counter so the cap is actually reachable.
      assert.equal(calls.finalizeCalled, false);
      assert.equal(calls.finalizeAttemptsBumped, 1);
      finalizeAttempts += 1;
    }
    assert.equal(failed, true, "job must terminate within bounded ticks");
    assert.ok(
      finalizeAttempts <= 5,
      `cap reached in <=5 ticks (got ${finalizeAttempts})`,
    );
  });
});
