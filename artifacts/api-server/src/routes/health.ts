import { Router, type IRouter } from "express";
import { getYtDlpRuntimeInfo } from "../lib/media-downloader";
import {
  getProviderAuthSnapshot,
  refreshProviderAuth,
} from "../lib/influencer-provider-preflight";

const router: IRouter = Router();

// Task #200: healthz now exposes build identity so an operator can
// confirm which commit is serving live traffic without grepping the
// process. `buildSha` and `builtAt` are injected at build time by
// esbuild's `define` (see artifacts/api-server/build.mjs); they fall
// back to "unknown" / null when the bundle was built outside of the
// canonical `pnpm build` flow. The HealthCheckResponse zod schema is
// intentionally not used here - the schema is shared with several
// other portal endpoints whose contracts only declare `{ status }` and
// would strip these fields. The healthz contract surface is small
// enough that a hand-rolled response shape is the right tradeoff.
//
// Task #209: surface the cached `ytDlpVersion` (with PyPI-latest +
// `outdated` flag) so an operator can confirm from a single GET which
// extractor binary is live without grepping worker boot logs. Reads
// the cached info populated by the worker boot probe (or this process'
// own first call) - never spawns synchronously inside the request path.
router.get("/healthz", async (_req, res) => {
  let ytDlp: {
    ytDlpVersion: string | null;
    ytDlpLatestVersion: string | null;
    ytDlpOutdated: boolean | null;
    ytDlpCheckedAt: string;
    ytDlpError?: string;
  } | null = null;
  try {
    const info = await getYtDlpRuntimeInfo();
    ytDlp = {
      ytDlpVersion: info.current,
      ytDlpLatestVersion: info.latest,
      ytDlpOutdated: info.outdated,
      ytDlpCheckedAt: info.checkedAt,
      ...(info.error ? { ytDlpError: info.error } : {}),
    };
  } catch {
    ytDlp = null;
  }
  // Task #261: providerAuth surface for the AI Influencer pipeline.
  // Boot health contract: every healthz response must include a
  // populated providerAuth block. On cache miss (first request after
  // boot, before the boot-time preflight has resolved) we await the
  // inflight promise — refreshProviderAuth() de-duplicates so this
  // does not stack a second probe call.
  let providerAuth = getProviderAuthSnapshot();
  if (!providerAuth) {
    providerAuth = await refreshProviderAuth();
  }
  res.json({
    status: "ok",
    buildSha: process.env.BUILD_SHA || "unknown",
    builtAt: process.env.BUILT_AT || null,
    runtime: "api",
    ytDlp,
    providerAuth,
  });
});

export default router;
