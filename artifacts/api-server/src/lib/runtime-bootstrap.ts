// Task #140: per-runtime bootstrap shared by `index.api.ts` and
// `index.worker.ts`.
//
// We mutate the singleton logger's bindings via `pino.setBindings` at
// boot. This propagates the `runtime: "api" | "worker"` field to every
// subsequent log line, including library modules that import the
// `logger` singleton (media-downloader, workers/, ad-research-board-sync,
// pino-http request logs, etc.) without having to thread a child logger
// through every call site.
import { logger as rootLogger } from "./logger";

export type RuntimeName = "api" | "worker";

let bootstrappedAs: RuntimeName | null = null;

export function bootstrapRuntime(name: RuntimeName): void {
  if (bootstrappedAs) {
    if (bootstrappedAs !== name) {
      throw new Error(
        `bootstrapRuntime called twice with different runtime names: ${bootstrappedAs} then ${name}`,
      );
    }
    return;
  }

  rootLogger.setBindings({ runtime: name });

  process.on("uncaughtException", (err) => {
    rootLogger.error({ err }, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    rootLogger.error({ err: reason }, "unhandledRejection");
  });

  // Task #200: emit build identity on boot for both api + worker
  // entrypoints so an operator can prove which commit is running
  // straight from the workflow logs.
  rootLogger.info(
    {
      pid: process.pid,
      node: process.version,
      buildSha: process.env.BUILD_SHA || "unknown",
      builtAt: process.env.BUILT_AT || null,
    },
    "runtime bootstrap",
  );

  bootstrappedAs = name;
}
