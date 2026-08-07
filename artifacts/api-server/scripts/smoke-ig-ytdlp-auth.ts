import { spawn } from "node:child_process";
import { access, constants as fsConstants, readFile } from "node:fs/promises";
import { materializeInstagramCookieFile } from "../src/lib/instagram-session-cookies.js";

const TEST_URL = process.argv[2] ?? "https://www.instagram.com/reel/C9X6Q4mIpXh/";

function runYtDlp(args: string[], timeoutMs = 60_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* */ }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  console.log(JSON.stringify({ event: "smoke-ig-ytdlp-auth", phase: "start", testUrl: TEST_URL, ts: new Date().toISOString() }));

  const cookiePath = await materializeInstagramCookieFile();
  console.log(JSON.stringify({
    event: "smoke-ig-ytdlp-auth",
    phase: "materialize",
    cookieSource: cookiePath ? "ig-db-jar" : "none",
    cookieFlagPresent: Boolean(cookiePath),
    pathTailHash: cookiePath ? cookiePath.slice(-12) : null,
  }));
  if (!cookiePath) {
    console.error("ABORT: no IG jar materialized; upload cookies first.");
    process.exit(2);
  }
  let fileReadable = false;
  let cookieFileBytes = 0;
  try {
    await access(cookiePath, fsConstants.R_OK);
    fileReadable = true;
    const buf = await readFile(cookiePath);
    cookieFileBytes = buf.byteLength;
  } catch { /* */ }
  console.log(JSON.stringify({
    event: "smoke-ig-ytdlp-auth",
    phase: "pre-spawn",
    cookieFileReadable: fileReadable,
    cookieFileBytes,
  }));

  const args = [
    "--cookies", cookiePath,
    "--no-warnings",
    "--quiet",
    "--no-progress",
    "--print", "%(extractor)s|%(id)s|%(title).80s|%(duration)s|%(width)sx%(height)s",
    "--no-download",
    TEST_URL,
  ];
  console.log(JSON.stringify({
    event: "smoke-ig-ytdlp-auth",
    phase: "ytdlp-spawn",
    cmdSummary: ["yt-dlp", "--cookies <REDACTED>", "--no-warnings", "--quiet", "--no-progress", "--print", "<fmt>", "--no-download", TEST_URL].join(" "),
    cookieFlagInArgs: args.includes("--cookies"),
  }));

  const result = await runYtDlp(args);
  const stderrLower = result.stderr.toLowerCase();
  const sawAuthHint =
    stderrLower.includes("--cookies-from-browser") ||
    stderrLower.includes("login required") ||
    stderrLower.includes("login_required") ||
    stderrLower.includes("rate-limit reached") ||
    stderrLower.includes("requested format is not available");

  console.log(JSON.stringify({
    event: "smoke-ig-ytdlp-auth",
    phase: "ytdlp-result",
    exitCode: result.code,
    stdoutFirstLine: result.stdout.split(/\r?\n/).find(Boolean) ?? null,
    stderrTail: result.stderr.split(/\r?\n/).filter(Boolean).slice(-5),
    sawAuthHint,
    finalOutcome: result.code === 0 ? "ok" : (sawAuthHint ? "auth-failure" : "other-failure"),
  }));

  process.exit(result.code === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke crashed:", err?.stack || err);
  process.exit(3);
});
