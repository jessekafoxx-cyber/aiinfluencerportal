// Server-side PDF generator for the VSL Masterclass.
//
// Renders the same chapter data the React print page uses (`@workspace/vsl-masterclass-content`)
// into a self-contained HTML document, then drives a headless Chromium via
// puppeteer-core to print it to A4 PDF. The generated buffer is cached in
// memory keyed by a hash of the chapter content so subsequent downloads are
// instant and only re-render when the source content actually changes.
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  VSL_MASTERCLASS_CHAPTERS,
  type Block,
  type Chapter,
} from "@workspace/vsl-masterclass-content";

let cachedPdf: { hash: string; buffer: Buffer } | null = null;
let inFlight: Promise<Buffer> | null = null;

let resolvedChromiumPath: string | null = null;
function findChromium(): string {
  if (resolvedChromiumPath) return resolvedChromiumPath;
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROMIUM_PATH ||
    process.env.CHROME_PATH;
  if (envPath) {
    resolvedChromiumPath = envPath;
    return envPath;
  }
  const candidates = ["chromium", "chromium-browser", "google-chrome", "chrome"];
  for (const cmd of candidates) {
    try {
      const out = execSync(`command -v ${cmd}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (out) {
        resolvedChromiumPath = out;
        return out;
      }
    } catch {}
  }
  throw new Error(
    "Could not locate a Chromium binary. Set PUPPETEER_EXECUTABLE_PATH or install pkgs.chromium.",
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "para":
      return `<p class="vp-para">${escapeHtml(block.text)}</p>`;
    case "heading": {
      const level = block.level || 2;
      const cls = level === 3 ? "vp-h3" : "vp-h2";
      const tag = level === 3 ? "h3" : "h2";
      return `<${tag} class="${cls}">${escapeHtml(block.text)}</${tag}>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const cls = block.ordered ? "vp-list vp-list-ol" : "vp-list vp-list-ul";
      const items = block.items
        .map((it) => `<li>${escapeHtml(it)}</li>`)
        .join("");
      return `<${tag} class="${cls}">${items}</${tag}>`;
    }
    case "callout": {
      const tone = block.tone || "neutral";
      const title = block.title
        ? `<p class="vp-callout-title">${escapeHtml(block.title)}</p>`
        : "";
      return `<div class="vp-callout vp-callout-${tone}">${title}<p class="vp-callout-text">${escapeHtml(
        block.text,
      )}</p></div>`;
    }
    case "table": {
      const head = `<thead><tr>${block.columns
        .map((c) => `<th>${escapeHtml(c)}</th>`)
        .join("")}</tr></thead>`;
      const body = `<tbody>${block.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td>${escapeHtml(cell)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody>`;
      return `<table class="vp-table">${head}${body}</table>`;
    }
    case "annotation": {
      const title = block.title
        ? `<p class="vp-annotation-title">${escapeHtml(block.title)}</p>`
        : "";
      const rows = block.rows
        .map(
          (r) => `
          <div class="vp-annotation-row">
            <div class="vp-annotation-line">
              <p class="vp-annotation-label">VSL line</p>
              <p class="vp-annotation-text vp-annotation-italic">${escapeHtml(r.line)}</p>
            </div>
            <div class="vp-annotation-note">
              <p class="vp-annotation-label vp-annotation-label-gold">What it&#39;s doing &amp; why it works</p>
              <p class="vp-annotation-text">${escapeHtml(r.note)}</p>
            </div>
          </div>`,
        )
        .join("");
      return `<div class="vp-annotation">${title}${rows}</div>`;
    }
    case "template":
      return `<div class="vp-template"><p class="vp-template-title">${escapeHtml(
        block.title,
      )}</p><pre class="vp-template-body">${escapeHtml(block.body)}</pre></div>`;
    default:
      return "";
  }
}

function renderChapter(chapter: Chapter, index: number): string {
  const blocks = chapter.blocks.map(renderBlock).join("");
  const kicker = chapter.kicker
    ? `<p class="vp-chapter-kicker">${escapeHtml(chapter.kicker)}</p>`
    : "";
  const intro = chapter.intro
    ? `<p class="vp-chapter-intro">${escapeHtml(chapter.intro)}</p>`
    : "";
  return `
    <section class="vp-chapter ${index === 0 ? "vp-chapter-first" : ""}">
      <p class="vp-chapter-number">Chapter ${escapeHtml(chapter.number)}</p>
      <h1 class="vp-chapter-title">${escapeHtml(chapter.title)}</h1>
      ${kicker}
      ${intro}
      <div class="vp-chapter-blocks">${blocks}</div>
    </section>`;
}

function renderHtml(chapters: readonly Chapter[]): string {
  const cover = `
    <section class="vp-cover">
      <p class="vp-cover-eyebrow">Prompt &amp; Build</p>
      <h1 class="vp-cover-title">VSL Masterclass</h1>
      <p class="vp-cover-sub">The full long-form playbook behind every VSL we ship — rebuilt around the Low Ticket Ascension model. Frameworks, banks, line-by-line breakdowns, and the editing SOP.</p>
      <div class="vp-cover-meta">
        <p>${chapters.length} chapters</p>
        <p>Premium add-on · VSL Vault order bump</p>
      </div>
    </section>`;

  const tocItems = chapters
    .map(
      (c) => `
        <li class="vp-toc-item">
          <span class="vp-toc-num">${escapeHtml(c.number)}</span>
          <span class="vp-toc-name">${escapeHtml(c.title)}</span>
          ${c.kicker ? `<span class="vp-toc-kicker"> — ${escapeHtml(c.kicker)}</span>` : ""}
        </li>`,
    )
    .join("");

  const toc = `
    <section class="vp-toc">
      <p class="vp-toc-eyebrow">Contents</p>
      <h2 class="vp-toc-title">Chapter Index</h2>
      <ol class="vp-toc-list">${tocItems}</ol>
    </section>`;

  const chaptersHtml = chapters.map(renderChapter).join("");

  const end = `
    <section class="vp-end">
      <p class="vp-end-line">— End of Masterclass —</p>
      <p class="vp-end-sub">Prompt &amp; Build · VSL Masterclass · Print edition</p>
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>VSL Masterclass</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<div class="vp-root">
  ${cover}
  ${toc}
  <div class="vp-chapters">${chaptersHtml}</div>
  ${end}
</div>
</body>
</html>`;
}

// Mirror of the @page + .vp-* CSS used by `vsl-masterclass-print.tsx` so the
// server-rendered PDF is visually identical to the in-browser print view.
const PRINT_STYLES = `
  @page {
    size: A4;
    margin: 18mm 16mm 22mm 16mm;
  }
  @page :first {
    margin: 0;
  }
  html, body { background: #ffffff; margin: 0; padding: 0; }
  .vp-root {
    color: #111111;
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.55;
    font-size: 12pt;
  }

  /* Cover */
  .vp-cover {
    page-break-after: always;
    break-after: page;
    min-height: 257mm;
    padding: 24mm 18mm;
    background: #111;
    color: #fff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
  }
  .vp-cover .vp-cover-eyebrow { color: #C9A44C; }
  .vp-cover .vp-cover-title { color: #fff; }
  .vp-cover .vp-cover-sub { color: rgba(255,255,255,0.78); }
  .vp-cover .vp-cover-meta { color: rgba(255,255,255,0.6); border-top-color: rgba(255,255,255,0.2); }
  .vp-cover-eyebrow {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt; font-weight: 700; letter-spacing: 0.22em;
    text-transform: uppercase; color: #B8902F; margin: 0 0 12px;
  }
  .vp-cover-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 44pt; font-weight: 800; letter-spacing: -0.01em;
    text-transform: uppercase; line-height: 1.02; margin: 0 0 18px;
  }
  .vp-cover-sub {
    font-size: 13pt; line-height: 1.55; max-width: 560px;
    color: #333; margin: 0 0 32px;
  }
  .vp-cover-meta {
    border-top: 1px solid #d8d0bd; padding-top: 14px;
    font-size: 10pt; color: #555;
    font-family: "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.04em;
  }
  .vp-cover-meta p { margin: 2px 0; }

  /* TOC */
  .vp-toc {
    page-break-after: always;
    break-after: page;
    padding: 8px 0 24px;
  }
  .vp-toc-eyebrow {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt; font-weight: 700; letter-spacing: 0.22em;
    text-transform: uppercase; color: #B8902F; margin: 0 0 6px;
  }
  .vp-toc-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 22pt; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.01em; margin: 0 0 18px; color: #111;
  }
  .vp-toc-list { list-style: none; padding: 0; margin: 0; border-top: 1px solid #ddd; }
  .vp-toc-item {
    display: block; padding: 8px 0; border-bottom: 1px solid #ddd;
    font-size: 11pt; line-height: 1.4; page-break-inside: avoid;
  }
  .vp-toc-num {
    display: inline-block; width: 32px; color: #B8902F; font-weight: 700;
    font-family: "Helvetica Neue", Arial, sans-serif;
  }
  .vp-toc-name { font-weight: 700; color: #111; }
  .vp-toc-kicker { color: #666; font-style: italic; }

  /* Chapter */
  .vp-chapter { page-break-before: always; break-before: page; padding-top: 12px; }
  .vp-chapter-first { page-break-before: auto; }
  .vp-chapter-number {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt; font-weight: 700; letter-spacing: 0.2em;
    text-transform: uppercase; color: #B8902F; margin: 0 0 6px;
  }
  .vp-chapter-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 26pt; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.01em; line-height: 1.1; color: #111; margin: 0 0 10px;
  }
  .vp-chapter-kicker { font-style: italic; color: #555; font-size: 12pt; margin: 0 0 14px; }
  .vp-chapter-intro { font-size: 12.5pt; color: #222; margin: 0 0 16px; line-height: 1.55; }
  .vp-chapter-blocks > * + * { margin-top: 14px; }

  /* Block styles */
  .vp-para { font-size: 11.5pt; color: #1a1a1a; margin: 0; line-height: 1.6; orphans: 3; widows: 3; }
  .vp-h2 {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 15pt; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.02em; color: #111; margin: 18px 0 6px;
    page-break-after: avoid;
  }
  .vp-h3 {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #222; margin: 14px 0 4px;
    page-break-after: avoid;
  }
  .vp-list { margin: 0; padding-left: 22px; font-size: 11.5pt; line-height: 1.55; }
  .vp-list li { margin: 4px 0; }
  .vp-list-ol li::marker { color: #B8902F; font-weight: 700; }
  .vp-list-ul li::marker { color: #B8902F; }

  /* Callout */
  .vp-callout {
    border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px;
    background: #fafafa; page-break-inside: avoid;
  }
  .vp-callout-gold { border-color: #C9A44C; background: #fbf6e8; }
  .vp-callout-danger { border-color: #e6b3b3; background: #fbecec; }
  .vp-callout-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; margin: 0 0 4px; color: #555;
  }
  .vp-callout-gold .vp-callout-title { color: #8a6f1e; }
  .vp-callout-danger .vp-callout-title { color: #a02525; }
  .vp-callout-text { font-size: 11pt; line-height: 1.55; color: #1a1a1a; margin: 0; }

  /* Table */
  .vp-table { width: 100%; border-collapse: collapse; font-size: 10.5pt; page-break-inside: auto; }
  .vp-table th {
    text-align: left; background: #f3eedd; color: #6e561a;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.1em; padding: 8px 10px; border: 1px solid #d6cfb8;
  }
  .vp-table td {
    padding: 8px 10px; border: 1px solid #d6cfb8; vertical-align: top;
    color: #1a1a1a; line-height: 1.5;
  }
  .vp-table tr { page-break-inside: avoid; }
  .vp-table tbody tr:nth-child(even) td { background: #faf8f1; }

  /* Annotation */
  .vp-annotation { border: 1px solid #ddd; border-radius: 6px; overflow: hidden; page-break-inside: auto; }
  .vp-annotation-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase; color: #6e561a; margin: 0;
    padding: 8px 12px; background: #f3eedd; border-bottom: 1px solid #ddd;
  }
  .vp-annotation-row {
    display: grid; grid-template-columns: 1.05fr 1fr;
    border-bottom: 1px solid #eee; page-break-inside: avoid;
  }
  .vp-annotation-row:last-child { border-bottom: none; }
  .vp-annotation-line { padding: 10px 12px; border-right: 1px solid #eee; background: #fafafa; }
  .vp-annotation-note { padding: 10px 12px; }
  .vp-annotation-label {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase; color: #888; margin: 0 0 4px;
  }
  .vp-annotation-label-gold { color: #8a6f1e; }
  .vp-annotation-text { font-size: 10.5pt; line-height: 1.55; color: #1a1a1a; margin: 0; }
  .vp-annotation-italic { font-style: italic; }

  /* Template */
  .vp-template {
    border: 1px solid #C9A44C; border-radius: 6px; overflow: hidden;
    background: #fbf6e8; page-break-inside: auto;
  }
  .vp-template-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase; color: #6e561a; margin: 0;
    padding: 8px 12px; background: #f3eedd; border-bottom: 1px solid #e6dcb8;
  }
  .vp-template-body {
    margin: 0; padding: 12px;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.55; color: #1a1a1a;
    white-space: pre-wrap; word-wrap: break-word;
  }

  /* End plate */
  .vp-end {
    page-break-before: always; break-before: page; text-align: center;
    padding: 80px 0 0;
  }
  .vp-end-line {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 13pt; font-weight: 700; letter-spacing: 0.18em;
    text-transform: uppercase; color: #B8902F; margin: 0 0 8px;
  }
  .vp-end-sub { font-size: 10pt; color: #888; margin: 0; }
`;

const FOOTER_TEMPLATE = `
  <div style="
    width: 100%;
    text-align: center;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 9pt;
    color: #666;
    padding: 0 16mm;
  ">
    VSL Masterclass · Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>`;
const HEADER_TEMPLATE = `<div></div>`;

function contentHash(): string {
  const json = JSON.stringify(VSL_MASTERCLASS_CHAPTERS);
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function renderPdfBuffer(): Promise<Buffer> {
  // puppeteer-core is bundled-external (see api-server build.mjs). It may
  // not be installed in some local dev environments — fail loudly with a clear
  // message rather than crashing on a missing module.
  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = await import("puppeteer-core");
  } catch (e: any) {
    throw new Error(
      `puppeteer-core is not installed. Run \`pnpm install\` in the workspace. (${e?.message || e})`,
    );
  }

  const executablePath = findChromium();
  const html = renderHtml(VSL_MASTERCLASS_CHAPTERS);

  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "18mm", right: "16mm", bottom: "22mm", left: "16mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Returns a server-rendered PDF buffer of the VSL Masterclass.
 *
 * Result is cached in memory keyed by a hash of the chapter content. The cache
 * stays warm for the lifetime of the process; when the chapter source changes
 * (and the api-server restarts after deploy), the hash changes and we
 * re-render once. Concurrent callers share an in-flight promise so we never
 * launch two Chromium instances at the same time.
 */
export async function getVslMasterclassPdf(): Promise<{
  buffer: Buffer;
  hash: string;
  cached: boolean;
}> {
  const hash = contentHash();
  if (cachedPdf && cachedPdf.hash === hash) {
    return { buffer: cachedPdf.buffer, hash, cached: true };
  }
  if (!inFlight) {
    inFlight = renderPdfBuffer()
      .then((buf) => {
        cachedPdf = { hash, buffer: buf };
        return buf;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  const buffer = await inFlight;
  return { buffer, hash, cached: false };
}
