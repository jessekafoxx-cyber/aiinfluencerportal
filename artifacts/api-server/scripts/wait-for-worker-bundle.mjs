// Task #619: dev-only helper for the Media Worker workflow.
//
// The API Server workflow owns the build. This script polls for the
// worker bundle the API Server emits and then execs `node` on it. By
// removing the second `pnpm run build` from the worker workflow, we
// eliminate the dist/-wipe race where two parallel builds would
// `rm -rf dist/` while the other process was between "build finished"
// and `node ./dist/index.<x>.mjs`, producing MODULE_NOT_FOUND.
//
// A timeout (default 180s) is enforced so a wedged API Server build
// fails the worker workflow loudly instead of hanging forever.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "..", "dist");
const workerBundle = path.join(distDir, "index.worker.mjs");

const DEFAULT_TIMEOUT_MS = 180_000;
const rawTimeout = Number(process.env.WORKER_BUNDLE_WAIT_TIMEOUT_MS);
const TIMEOUT_MS =
  Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
const POLL_MS = 500;

async function waitForBundle() {
  const startedAt = Date.now();
  let logged = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const s = await stat(workerBundle);
      if (s.isFile() && s.size > 0) return;
    } catch {
      // not yet
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      console.error(
        `[wait-for-worker-bundle] timed out after ${TIMEOUT_MS}ms waiting for ${workerBundle}. ` +
          `Is the API Server workflow building?`,
      );
      process.exit(1);
    }
    if (!logged) {
      console.log(
        `[wait-for-worker-bundle] waiting for API Server build to emit ${workerBundle} ...`,
      );
      logged = true;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

await waitForBundle();
console.log(`[wait-for-worker-bundle] bundle ready, exec'ing worker`);

const child = spawn(
  process.execPath,
  ["--enable-source-maps", workerBundle],
  { stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
