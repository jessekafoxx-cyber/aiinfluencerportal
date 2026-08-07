// API runtime entrypoint.
//
// Hosts the Express HTTP server only. The media-download queue, queue
// metrics recorder, automation worker host, periodic media processor,
// and every scheduler that can transitively trigger media work
// (ad-research-board, funnels-research-board, knowledge ingestion) run
// in a separate process via `index.worker.ts` (Task #140). This entry
// keeps only boot hooks that affect serving (cache warmups, content
// integrity ensures) so an Apify spike or a yt-dlp storm in the worker
// can never stall API request handlers.
import { bootstrapRuntime } from "./lib/runtime-bootstrap";

bootstrapRuntime("api");

import app from "./app";
import { logger } from "./lib/logger";
import { ensureMainMasterclass } from "./lib/ensure-main-masterclass";
import { ensureDfyScripts } from "./lib/ensure-dfy-scripts";
import { ensureDfyTemplatesBlocklist } from "./lib/ensure-dfy-templates-blocklist";
import { ensureKpiReset } from "./lib/ensure-kpi-reset";
import { ensurePlatinumWorkshopRecording } from "./lib/ensure-platinum-workshop-recording";
import { ensureRoom30SupportArticles } from "./lib/ensure-room30-support-articles";
import { ensureTikTokSlideshowNotes } from "./lib/ensure-tiktok-slideshow-notes";
import { refreshPrebuiltBrainsCache } from "./lib/prebuilt-brains.js";
import { startProviderAuthPreflight } from "./lib/influencer-provider-preflight";
import { ensureBackgroundTrackCodesBackfilled } from "./lib/dfy-background-music-importer";
import { startZeroConversionAlert } from "./lib/zero-conversion-alert";
import { runDfyContentHealthOnBoot } from "./lib/dfy-content-health";
import { ensureDfySchemaApplied } from "./lib/ensure-dfy-schema-applied";

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  logger.info({ port }, "API server listening");
  // Funnel health check (Task #454). Idempotent (start is a no-op if a
  // timer is already set).
  startZeroConversionAlert();
  ensureMainMasterclass().catch((err) =>
    logger.error({ err }, "ensureMainMasterclass boot hook failed"),
  );
  ensureKpiReset().catch((err) => logger.error({ err }, "ensureKpiReset boot hook failed"));
  ensureDfyScripts().catch((err) => logger.error({ err }, "ensureDfyScripts boot hook failed"));
  ensureDfyTemplatesBlocklist().catch((err) =>
    logger.error({ err }, "ensureDfyTemplatesBlocklist boot hook failed"),
  );
  ensurePlatinumWorkshopRecording().catch((err) =>
    logger.error({ err }, "ensurePlatinumWorkshopRecording boot hook failed"),
  );
  ensureRoom30SupportArticles().catch((err) =>
    logger.error({ err }, "ensureRoom30SupportArticles boot hook failed"),
  );
  ensureTikTokSlideshowNotes().catch((err) =>
    logger.error({ err }, "ensureTikTokSlideshowNotes boot hook failed"),
  );
  refreshPrebuiltBrainsCache().catch((err) =>
    logger.error({ err }, "refreshPrebuiltBrainsCache boot hook failed"),
  );
  // Task #261: provider auth preflight loop. Runs in the API process
  // too so /api/healthz can serve providerAuth from a local cache
  // without depending on the worker process.
  startProviderAuthPreflight();
  ensureBackgroundTrackCodesBackfilled().catch((err) =>
    logger.error({ err }, "ensureBackgroundTrackCodesBackfilled boot hook failed"),
  );
  // Task #498: idempotent application of the DFY schema bits the runtime
  // depends on (subfolders catalog, sheet-sync columns, advertorial
  // pages catalog). Self-heals a missed migration on whichever DB this
  // process is pointed at, including prod after Publish. Runs BEFORE
  // the content-health check so the health report reflects post-heal
  // state. Non-blocking.
  ensureDfySchemaApplied()
    .catch((err) =>
      logger.error({ err }, "ensureDfySchemaApplied boot hook failed"),
    )
    .finally(() => {
      // Task #498: surface empty DFY catalogs / failed Drive syncs in deploy
      // logs so a silent regression (missing table, broken sync) is visible
      // before users see empty portal tiles. Non-blocking.
      runDfyContentHealthOnBoot().catch((err) =>
        logger.error({ err }, "runDfyContentHealthOnBoot boot hook failed"),
      );
    });
});
