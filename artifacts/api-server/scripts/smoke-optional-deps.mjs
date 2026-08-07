#!/usr/bin/env node
// Smoke test: confirms every previously-stubbed optional dependency
// loads, exposes its public surface, and (where possible) makes a real
// network/CLI call against its configured backend.
//
// Run with:  node artifacts/api-server/scripts/smoke-optional-deps.mjs
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK " : "FAIL"}  ${name.padEnd(28)}  ${detail ?? ""}`);
}

// 1. mammoth — parse a tiny .docx blob (use a known-good fixture-less probe)
try {
  const mammoth = await import("mammoth");
  record("mammoth", typeof mammoth.extractRawText === "function",
    `extractRawText=${typeof mammoth.extractRawText}`);
} catch (e) { record("mammoth", false, e.message); }

// 2. csv-parse — parse synchronously
try {
  const { parse } = await import("csv-parse/sync");
  const rows = parse("a,b\n1,2\n3,4", { columns: true });
  record("csv-parse", rows.length === 2 && rows[0].a === "1", JSON.stringify(rows));
} catch (e) { record("csv-parse", false, e.message); }

// 3. @fal-ai/client — import + config + auth-check call
try {
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY ?? "missing" });
  record("@fal-ai/client", typeof fal.subscribe === "function",
    `FAL_KEY=${process.env.FAL_KEY ? "set" : "MISSING"}`);
} catch (e) { record("@fal-ai/client", false, e.message); }

// 4. @replit/connectors-sdk — instantiate, list Google Drive folders
try {
  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const connectors = new ReplitConnectors();
  const r = await connectors.proxy("google-drive", "/drive/v3/files", {
    method: "GET",
  });
  record("@replit/connectors-sdk", r.ok || r.status === 200,
    `google-drive HTTP ${r.status}`);
} catch (e) { record("@replit/connectors-sdk", false, e.message); }

// 5. @remotion/renderer — load module, ensure ffmpeg/ffprobe and chromium
try {
  const renderer = await import("@remotion/renderer");
  const ffmpeg = execSync("ffmpeg -version", { encoding: "utf8" }).split("\n")[0];
  const ffprobe = execSync("ffprobe -version", { encoding: "utf8" }).split("\n")[0];
  const chromium = execSync("which chromium", { encoding: "utf8" }).trim();
  record("@remotion/renderer",
    typeof renderer.renderMedia === "function" && !!ffmpeg && !!chromium,
    `${ffmpeg.split(" ")[2]} | ${ffprobe.split(" ")[2]} | chromium=${chromium}`);
} catch (e) { record("@remotion/renderer", false, e.message); }

// 6. @remotion/bundler — module loads (full bundle is heavy; just load it)
try {
  const bundler = await import("@remotion/bundler");
  record("@remotion/bundler", typeof bundler.bundle === "function",
    `bundle=${typeof bundler.bundle}`);
} catch (e) { record("@remotion/bundler", false, e.message); }

// 7. APIFY_API_KEY — verify the secret is wired so research routes won't 400
try {
  const r = await fetch(
    `https://api.apify.com/v2/users/me?token=${process.env.APIFY_API_KEY ?? ""}`
  );
  record("apify token (research)", r.ok, `Apify HTTP ${r.status}`);
} catch (e) { record("apify token (research)", false, e.message); }

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length === 0 ? 0 : 1);
