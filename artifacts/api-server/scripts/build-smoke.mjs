import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const common = {
  platform: "node",
  bundle: true,
  format: "esm",
  external: ["pg-native", "*.node", "@workspace/integrations-gemini-ai", "@google/genai", "@remotion/bundler", "@remotion/renderer", "esbuild"],
  banner: { js: "import { createRequire as __r } from 'node:module'; globalThis.require = __r(import.meta.url);" },
  logLevel: "error",
};
await Promise.all([
  build({ ...common, entryPoints: [path.resolve(here, "smoke-knowledge.ts")], outfile: path.resolve(here, "../dist/smoke-knowledge.mjs") }),
  build({ ...common, entryPoints: [path.resolve(here, "smoke-day4.ts")], outfile: path.resolve(here, "../dist/smoke-day4.mjs") }),
]);
console.log("ok");
