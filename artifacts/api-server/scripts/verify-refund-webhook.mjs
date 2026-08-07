// Bundles scripts/verify-refund-webhook.ts the same way build.mjs bundles
// src/index.ts, then executes it. The verification script:
//   1. Inserts a temp orders row with the chosen `*Paid` flag = true
//   2. Invokes handleWhopWebhook with a properly signed refund event
//   3. Asserts that the matching paid flag flipped to false
//   4. Replays the same event and asserts idempotency
//   5. Cleans up the temp row
//
// Run with: pnpm --filter @workspace/api-server exec node scripts/verify-refund-webhook.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(artifactDir, "dist", "verify");
const outFile = path.resolve(outDir, "verify-refund-webhook.mjs");

await mkdir(outDir, { recursive: true });

await esbuild({
  entryPoints: [path.resolve(artifactDir, "scripts/verify-refund-webhook.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
  external: [
    "*.node",
    "sharp",
    "better-sqlite3",
    "sqlite3",
    "pg-native",
    "@workspace/integrations-gemini-ai",
    "@google/genai",
    "@remotion/bundler",
    "@remotion/renderer",
    "esbuild",
  ],
  sourcemap: "linked",
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});

const child = spawn(process.execPath, ["--enable-source-maps", outFile], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
