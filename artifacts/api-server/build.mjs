import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir, copyFile, readdir, stat, lstat, rename, symlink, realpath } from "node:fs/promises";
import { execSync } from "node:child_process";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

// Task #200: build-time identity. The healthz endpoint and the
// runtime bootstrap log line both surface these so an operator can
// confirm exactly which commit is serving without grepping the
// process. `git rev-parse HEAD` is best-effort; we fall back to the
// platform-injected REPLIT_GIT_COMMIT, then the literal "unknown".
function resolveBuildSha() {
  try {
    const v = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (v) return v;
  } catch {}
  return process.env.REPLIT_GIT_COMMIT || process.env.BUILD_SHA || "unknown";
}
const BUILD_SHA = resolveBuildSha();
const BUILT_AT = new Date().toISOString();

async function copyHighTicketTemplates(distDir) {
  const tplOut = path.join(distDir, "templates", "high-ticket-funnel");
  await mkdir(path.join(tplOut, "pages"), { recursive: true });
  await mkdir(path.join(tplOut, "components"), { recursive: true });
  const root = path.resolve(artifactDir, "../landing-page/src");
  const files = [
    ["pages/work-with-me-template.tsx", "pages/work-with-me-template.tsx"],
    ["pages/work-with-me-template-checkout.tsx", "pages/work-with-me-template-checkout.tsx"],
    ["components/template-brand.tsx", "components/template-brand.tsx"],
    ["components/case-study-card.tsx", "components/case-study-card.tsx"],
  ];
  for (const [src, dst] of files) {
    try {
      await copyFile(path.join(root, src), path.join(tplOut, dst));
    } catch (err) {
      console.warn(`[build] template copy skipped: ${src} (${err.message})`);
    }
  }
}

async function copyDirRecursive(srcDir, dstDir) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (e.isDirectory()) {
      await copyDirRecursive(s, d);
    } else if (e.isFile()) {
      await copyFile(s, d);
    }
  }
}

async function copyLowTicketTemplates(distDir) {
  const tplOut = path.join(distDir, "templates", "low-ticket-funnel");
  const tplSrc = path.resolve(artifactDir, "templates/low-ticket-funnel");
  try {
    await stat(tplSrc);
  } catch {
    console.warn(`[build] low-ticket templates source not found: ${tplSrc}`);
    return;
  }
  await copyDirRecursive(tplSrc, tplOut);
}

async function buildAll(outDir) {
  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/index.api.ts"),
      path.resolve(artifactDir, "src/index.worker.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      "@resvg/resvg-js",
      "@resvg/resvg-js-*",
      // NOTE: @workspace/integrations-gemini-ai is intentionally NOT
      // externalized — its sources are .ts files that Node ESM cannot
      // resolve at runtime (extension/loader mismatch). esbuild bundles
      // the wrapper; the underlying @google/genai stays external below.
      "@google/genai",
      "@remotion/bundler",
      "@remotion/renderer",
      "@remotion/compositor-*",
      "@rspack/*",
      "esbuild",
    ],
    sourcemap: "linked",
    define: {
      "process.env.BUILD_SHA": JSON.stringify(BUILD_SHA),
      "process.env.BUILT_AT": JSON.stringify(BUILT_AT),
    },
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
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
}

// Task #620: atomic dist swap via versioned dir + symlink rename.
//
// Previously this script started with `rm -rf dist/` and emitted bundles +
// templates directly into the live directory while another Node process
// (API Server or Media Worker) could still be reading sourcemaps / template
// files from it. That race produced MODULE_NOT_FOUND / ENOENT on rebuilds.
//
// The fix is to make `dist/` a symlink that always points at an
// immutable, fully built versioned directory under `dist.versions/`.
// Each build:
//   1. Emits esbuild output + templates into `dist.versions/build-<pid>-<ts>/`.
//   2. Creates a sibling temp symlink `dist.swap-<pid>` pointing at the
//      new build directory (relative path).
//   3. POSIX-atomically renames that symlink into place as `dist`,
//      replacing the previous symlink in a single syscall. Readers
//      resolving `dist/index.api.mjs` (or any sourcemap / template
//      path) only ever see a complete tree - either the previous one
//      or the new one, never a transient missing dir.
//   4. Garbage-collects older versioned dirs, keeping the previous one
//      so in-flight reads holding the old realpath don't blow up.
//
// One-time migration: on first run after this change, the existing
// real `dist/` directory is removed before the symlink is installed.
// That is the only window the old race can still occur, and only on
// the very next deploy after merging this change.
const VERSIONS_DIR_NAME = "dist.versions";
const KEEP_VERSIONS = 2;

async function isSymlink(p) {
  try {
    const s = await lstat(p);
    return s.isSymbolicLink();
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function pruneOldVersions(versionsDir, currentBuildName) {
  let entries;
  try {
    entries = await readdir(versionsDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  // Keep the current build, plus the most recent (N-1) others so any
  // process still holding the previous realpath can finish reading.
  const dirs = entries
    .filter((e) => e.isDirectory() && e.name !== currentBuildName)
    .map((e) => e.name)
    .sort(); // names embed timestamps, lex sort == chronological
  const toDelete = dirs.slice(0, Math.max(0, dirs.length - (KEEP_VERSIONS - 1)));
  for (const name of toDelete) {
    await rm(path.join(versionsDir, name), { recursive: true, force: true }).catch(
      (err) => {
        console.warn(
          `[build] failed to prune old version ${name}: ${err.message}`,
        );
      },
    );
  }
}

// Task #621: sweep orphan tmp dirs/symlinks left by SIGKILL'd builds.
//
// Happy-path cleanup of `dist.swap-<pid>` (and the per-pid versioned dir
// under `dist.versions/`) is handled inline in atomicSwapDist(). But if
// the build process is preempted (Replit deploy OOM/SIGKILL) mid-build,
// orphans can linger and the only signal is creeping disk usage.
//
// At the start of every build, remove any sibling artifact-dir entry
// matching the known temp patterns whose mtime is older than the
// staleness threshold. The age gate is what makes this safe against a
// concurrent in-progress build of a different pid: a real in-flight
// build's swap link / build dir will have an mtime of "right now" and
// is skipped. We also explicitly never touch our own current-pid swap
// link (atomicSwapDist handles that with full knowledge).
const ORPHAN_STALENESS_MS = 10 * 60 * 1000;
const ORPHAN_PATTERNS = [
  // Current Task #620 scheme:
  /^dist\.swap-\d+$/,
  // Legacy / future-proof patterns from prior iterations of the
  // atomic-swap scheme. Cheap to keep covered.
  /^dist\.tmp-/,
  /^dist\.old-/,
];

async function sweepOrphanBuildDirs() {
  const ownSwapName = `dist.swap-${process.pid}`;
  let entries;
  try {
    entries = await readdir(artifactDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    throw err;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (entry.name === ownSwapName) continue;
    if (!ORPHAN_PATTERNS.some((re) => re.test(entry.name))) continue;
    const full = path.join(artifactDir, entry.name);
    let mtimeMs;
    try {
      const s = await lstat(full);
      mtimeMs = s.mtimeMs;
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      console.warn(`[build] orphan sweep stat failed for ${entry.name}: ${err.message}`);
      continue;
    }
    if (now - mtimeMs < ORPHAN_STALENESS_MS) continue;
    await rm(full, { recursive: true, force: true }).catch((err) => {
      console.warn(`[build] orphan sweep rm failed for ${entry.name}: ${err.message}`);
    });
  }
}

async function atomicSwapDist() {
  const distLink = path.resolve(artifactDir, "dist");
  const versionsDir = path.resolve(artifactDir, VERSIONS_DIR_NAME);
  const buildName = `build-${Date.now()}-${process.pid}`;
  const buildDir = path.join(versionsDir, buildName);
  const swapLink = path.resolve(artifactDir, `dist.swap-${process.pid}`);

  await sweepOrphanBuildDirs();
  await mkdir(versionsDir, { recursive: true });
  // Defensive: a previous crashed build of this same pid could have left
  // these around. They are pid-scoped so no concurrent build owns them.
  await rm(buildDir, { recursive: true, force: true });
  await rm(swapLink, { force: true }).catch(() => {});

  try {
    await buildAll(buildDir);
    await copyHighTicketTemplates(buildDir);
    await copyLowTicketTemplates(buildDir);
  } catch (err) {
    await rm(buildDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // Stage a symlink with a unique name, then atomically `rename()` it
  // over `dist`. POSIX rename replaces an existing symlink atomically
  // (single syscall), so any concurrent path resolution either sees the
  // previous target or the new target - never a missing entry.
  const linkTarget = path.join(VERSIONS_DIR_NAME, buildName);
  await symlink(linkTarget, swapLink, "dir");

  const linkState = await isSymlink(distLink);
  if (linkState === false) {
    // One-time migration: replace a real directory with the symlink
    // scheme. After this first deploy, every future build is a pure
    // atomic symlink swap with no missing-path window.
    await rm(distLink, { recursive: true, force: true });
  }

  try {
    await rename(swapLink, distLink);
  } catch (err) {
    await rm(swapLink, { force: true }).catch(() => {});
    await rm(buildDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  await pruneOldVersions(versionsDir, buildName);

  try {
    const realDist = await realpath(distLink);
    console.log(`[build] dist -> ${path.relative(artifactDir, realDist)}`);
  } catch {}
}

atomicSwapDist().catch((err) => {
  console.error(err);
  process.exit(1);
});
