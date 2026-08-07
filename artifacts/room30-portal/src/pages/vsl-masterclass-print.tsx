import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Redirect } from "wouter";
import {
  VSL_MASTERCLASS_CHAPTERS,
  type Block,
  type Chapter,
} from "@/content/vsl-masterclass";

type PortalMeUser = {
  role?: string | null;
  bump1Paid?: boolean | null;
};
type PortalMeResponse = { user?: PortalMeUser | null };

function PrintBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "para":
      return <p className="vp-para">{block.text}</p>;
    case "heading": {
      const level = block.level || 2;
      if (level === 3) return <h3 className="vp-h3">{block.text}</h3>;
      return <h2 className="vp-h2">{block.text}</h2>;
    }
    case "list":
      return block.ordered ? (
        <ol className="vp-list vp-list-ol">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      ) : (
        <ul className="vp-list vp-list-ul">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case "callout": {
      const tone = block.tone || "neutral";
      return (
        <div className={`vp-callout vp-callout-${tone}`}>
          {block.title && <p className="vp-callout-title">{block.title}</p>}
          <p className="vp-callout-text">{block.text}</p>
        </div>
      );
    }
    case "table":
      return (
        <table className="vp-table">
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "annotation":
      return (
        <div className="vp-annotation">
          {block.title && (
            <p className="vp-annotation-title">{block.title}</p>
          )}
          {block.rows.map((r, i) => (
            <div key={i} className="vp-annotation-row">
              <div className="vp-annotation-line">
                <p className="vp-annotation-label">VSL line</p>
                <p className="vp-annotation-text vp-annotation-italic">
                  {r.line}
                </p>
              </div>
              <div className="vp-annotation-note">
                <p className="vp-annotation-label vp-annotation-label-gold">
                  What it&apos;s doing &amp; why it works
                </p>
                <p className="vp-annotation-text">{r.note}</p>
              </div>
            </div>
          ))}
        </div>
      );
    case "template":
      return (
        <div className="vp-template">
          <p className="vp-template-title">{block.title}</p>
          <pre className="vp-template-body">{block.body}</pre>
        </div>
      );
    default:
      return null;
  }
}

function PrintChapter({
  chapter,
  index,
}: {
  chapter: Chapter;
  index: number;
}) {
  return (
    <section
      id={`ch-${chapter.slug}`}
      className={`vp-chapter ${index === 0 ? "vp-chapter-first" : ""}`}
    >
      <p className="vp-chapter-number">Chapter {chapter.number}</p>
      <h1 className="vp-chapter-title">{chapter.title}</h1>
      {chapter.kicker && <p className="vp-chapter-kicker">{chapter.kicker}</p>}
      {chapter.intro && <p className="vp-chapter-intro">{chapter.intro}</p>}
      <div className="vp-chapter-blocks">
        {chapter.blocks.map((block, i) => (
          <PrintBlock key={i} block={block} />
        ))}
      </div>
    </section>
  );
}

export default function VslMasterclassPrint() {
  const { data: me, isLoading } = useQuery<PortalMeResponse>({
    queryKey: ["me"],
    queryFn: api.getMe,
  });
  const isAdmin = me?.user?.role === "admin";
  const paid = !!me?.user?.bump1Paid || isAdmin;
  const [autoPrintFired, setAutoPrintFired] = useState(false);

  useEffect(() => {
    if (!paid || autoPrintFired) return;
    if (typeof window === "undefined") return;
    // Allow opting out via ?autoprint=0 (used by automated tests, since
    // headless browsers can hang on window.print()).
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") === "0") {
      setAutoPrintFired(true);
      return;
    }
    // Wait for fonts/layout, then fire the print dialog automatically.
    const t = window.setTimeout(() => {
      window.print();
      setAutoPrintFired(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [paid, autoPrintFired]);

  if (isLoading) {
    return (
      <div className="vp-loading">
        <p>Preparing your masterclass for download…</p>
      </div>
    );
  }

  if (!paid) return <Redirect to="/vsl-masterclass" />;

  const chapters = VSL_MASTERCLASS_CHAPTERS;

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="vp-root">
        {/* Screen-only toolbar (hidden in print) */}
        <div className="vp-toolbar">
          <div className="vp-toolbar-inner">
            <div>
              <p className="vp-toolbar-label">VSL Masterclass · Print Edition</p>
              <p className="vp-toolbar-hint">
                Your browser&apos;s print dialog should open automatically. Pick
                <strong> &ldquo;Save as PDF&rdquo;</strong> as the destination.
              </p>
            </div>
            <button
              type="button"
              className="vp-toolbar-button"
              onClick={() => window.print()}
            >
              Open print dialog
            </button>
          </div>
        </div>

        {/* Cover page */}
        <section className="vp-cover">
          <p className="vp-cover-eyebrow">Prompt &amp; Build</p>
          <h1 className="vp-cover-title">VSL Masterclass</h1>
          <p className="vp-cover-sub">
            The full long-form playbook behind every VSL we ship — rebuilt
            around the Low Ticket Ascension model. Frameworks, banks, line-by-line
            breakdowns, and the editing SOP.
          </p>
          <div className="vp-cover-meta">
            <p>{chapters.length} chapters</p>
            <p>Premium add-on · VSL Vault order bump</p>
          </div>
        </section>

        {/* Chapter index */}
        <section className="vp-toc">
          <p className="vp-toc-eyebrow">Contents</p>
          <h2 className="vp-toc-title">Chapter Index</h2>
          <ol className="vp-toc-list">
            {chapters.map((c) => (
              <li key={c.slug} className="vp-toc-item">
                <span className="vp-toc-num">{c.number}</span>
                <span className="vp-toc-name">{c.title}</span>
                {c.kicker && (
                  <span className="vp-toc-kicker"> — {c.kicker}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Chapters */}
        <div className="vp-chapters">
          {chapters.map((c, i) => (
            <PrintChapter key={c.slug} chapter={c} index={i} />
          ))}
        </div>

        {/* End plate */}
        <section className="vp-end">
          <p className="vp-end-line">— End of Masterclass —</p>
          <p className="vp-end-sub">
            Prompt &amp; Build · VSL Masterclass · Print edition
          </p>
        </section>
      </div>
    </>
  );
}

const PRINT_STYLES = `
  /* Page setup — A4 with comfortable margins and footer page numbers. */
  @page {
    size: A4;
    margin: 18mm 16mm 22mm 16mm;
    @bottom-center {
      content: "VSL Masterclass · Page " counter(page) " of " counter(pages);
      font-family: Georgia, "Times New Roman", serif;
      font-size: 9pt;
      color: #666;
    }
  }
  @page :first {
    margin: 0;
    @bottom-center { content: ""; }
  }

  /* Screen-only background (so the user can preview the layout) */
  html, body {
    background: #f4f1ec;
  }

  .vp-root {
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 32px 80px;
    background: #ffffff;
    color: #111111;
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.55;
    font-size: 12pt;
  }

  .vp-loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    background: #0a0a0a;
    font-family: system-ui, sans-serif;
    font-size: 14px;
  }

  /* Toolbar — screen only */
  .vp-toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #0d0d0d;
    color: #fff;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    margin: -24px -32px 32px;
    padding: 14px 32px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .vp-toolbar-inner {
    max-width: 820px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .vp-toolbar-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #C9A44C;
    margin: 0 0 2px;
  }
  .vp-toolbar-hint {
    font-size: 12.5px;
    color: rgba(255,255,255,0.65);
    margin: 0;
    line-height: 1.45;
  }
  .vp-toolbar-hint strong { color: #fff; }
  .vp-toolbar-button {
    background: #C9A44C;
    color: #111;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 10px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  .vp-toolbar-button:hover { background: #d6b25c; }

  @media print {
    html, body { background: #ffffff; }
    .vp-root { max-width: none; margin: 0; padding: 0; box-shadow: none; }
    .vp-toolbar { display: none !important; }
  }

  /* Cover page */
  .vp-cover {
    page-break-after: always;
    break-after: page;
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 24px 8px;
    border-bottom: 1px solid #e8e3d8;
    margin-bottom: 24px;
  }
  @media print {
    .vp-cover {
      min-height: 257mm; /* A4 height minus margins, roughly */
      padding: 24mm 18mm;
      margin: 0;
      border-bottom: none;
      background: #111;
      color: #fff;
    }
    .vp-cover .vp-cover-eyebrow { color: #C9A44C; }
    .vp-cover .vp-cover-title { color: #fff; }
    .vp-cover .vp-cover-sub { color: rgba(255,255,255,0.78); }
    .vp-cover .vp-cover-meta { color: rgba(255,255,255,0.6); border-top-color: rgba(255,255,255,0.2); }
  }
  .vp-cover-eyebrow {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #B8902F;
    margin: 0 0 12px;
  }
  .vp-cover-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 44pt;
    font-weight: 800;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    line-height: 1.02;
    margin: 0 0 18px;
  }
  .vp-cover-sub {
    font-size: 13pt;
    line-height: 1.55;
    max-width: 560px;
    color: #333;
    margin: 0 0 32px;
  }
  .vp-cover-meta {
    border-top: 1px solid #d8d0bd;
    padding-top: 14px;
    font-size: 10pt;
    color: #555;
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
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #B8902F;
    margin: 0 0 6px;
  }
  .vp-toc-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 22pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    margin: 0 0 18px;
    color: #111;
  }
  .vp-toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid #ddd;
  }
  .vp-toc-item {
    display: block;
    padding: 8px 0;
    border-bottom: 1px solid #ddd;
    font-size: 11pt;
    line-height: 1.4;
    page-break-inside: avoid;
  }
  .vp-toc-num {
    display: inline-block;
    width: 32px;
    color: #B8902F;
    font-weight: 700;
    font-family: "Helvetica Neue", Arial, sans-serif;
  }
  .vp-toc-name {
    font-weight: 700;
    color: #111;
  }
  .vp-toc-kicker {
    color: #666;
    font-style: italic;
  }

  /* Chapter */
  .vp-chapter {
    page-break-before: always;
    break-before: page;
    padding-top: 12px;
  }
  .vp-chapter-first {
    page-break-before: auto;
  }
  .vp-chapter-number {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #B8902F;
    margin: 0 0 6px;
  }
  .vp-chapter-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 26pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    line-height: 1.1;
    color: #111;
    margin: 0 0 10px;
  }
  .vp-chapter-kicker {
    font-style: italic;
    color: #555;
    font-size: 12pt;
    margin: 0 0 14px;
  }
  .vp-chapter-intro {
    font-size: 12.5pt;
    color: #222;
    margin: 0 0 16px;
    line-height: 1.55;
  }
  .vp-chapter-blocks > * + * { margin-top: 14px; }

  /* Block styles */
  .vp-para {
    font-size: 11.5pt;
    color: #1a1a1a;
    margin: 0;
    line-height: 1.6;
    orphans: 3;
    widows: 3;
  }
  .vp-h2 {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 15pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: #111;
    margin: 18px 0 6px;
    page-break-after: avoid;
  }
  .vp-h3 {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 12pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #222;
    margin: 14px 0 4px;
    page-break-after: avoid;
  }
  .vp-list {
    margin: 0;
    padding-left: 22px;
    font-size: 11.5pt;
    line-height: 1.55;
  }
  .vp-list li { margin: 4px 0; }
  .vp-list-ol li::marker { color: #B8902F; font-weight: 700; }
  .vp-list-ul li::marker { color: #B8902F; }

  /* Callout */
  .vp-callout {
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 12px 14px;
    background: #fafafa;
    page-break-inside: avoid;
  }
  .vp-callout-gold {
    border-color: #C9A44C;
    background: #fbf6e8;
  }
  .vp-callout-danger {
    border-color: #e6b3b3;
    background: #fbecec;
  }
  .vp-callout-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    margin: 0 0 4px;
    color: #555;
  }
  .vp-callout-gold .vp-callout-title { color: #8a6f1e; }
  .vp-callout-danger .vp-callout-title { color: #a02525; }
  .vp-callout-text {
    font-size: 11pt;
    line-height: 1.55;
    color: #1a1a1a;
    margin: 0;
  }

  /* Table */
  .vp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
    page-break-inside: auto;
  }
  .vp-table th {
    text-align: left;
    background: #f3eedd;
    color: #6e561a;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 8px 10px;
    border: 1px solid #d6cfb8;
  }
  .vp-table td {
    padding: 8px 10px;
    border: 1px solid #d6cfb8;
    vertical-align: top;
    color: #1a1a1a;
    line-height: 1.5;
  }
  .vp-table tr {
    page-break-inside: avoid;
  }
  .vp-table tbody tr:nth-child(even) td {
    background: #faf8f1;
  }

  /* Annotation */
  .vp-annotation {
    border: 1px solid #ddd;
    border-radius: 6px;
    overflow: hidden;
    page-break-inside: auto;
  }
  .vp-annotation-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6e561a;
    margin: 0;
    padding: 8px 12px;
    background: #f3eedd;
    border-bottom: 1px solid #ddd;
  }
  .vp-annotation-row {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    border-bottom: 1px solid #eee;
    page-break-inside: avoid;
  }
  .vp-annotation-row:last-child { border-bottom: none; }
  .vp-annotation-line {
    padding: 10px 12px;
    border-right: 1px solid #eee;
    background: #fafafa;
  }
  .vp-annotation-note {
    padding: 10px 12px;
  }
  .vp-annotation-label {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #888;
    margin: 0 0 4px;
  }
  .vp-annotation-label-gold { color: #8a6f1e; }
  .vp-annotation-text {
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    margin: 0;
  }
  .vp-annotation-italic { font-style: italic; }

  /* Template */
  .vp-template {
    border: 1px solid #C9A44C;
    border-radius: 6px;
    overflow: hidden;
    background: #fbf6e8;
    page-break-inside: auto;
  }
  .vp-template-title {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6e561a;
    margin: 0;
    padding: 8px 12px;
    background: #f3eedd;
    border-bottom: 1px solid #e6dcb8;
  }
  .vp-template-body {
    margin: 0;
    padding: 12px;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* End plate */
  .vp-end {
    page-break-before: always;
    break-before: page;
    text-align: center;
    padding: 80px 0 0;
  }
  .vp-end-line {
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 13pt;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #B8902F;
    margin: 0 0 8px;
  }
  .vp-end-sub {
    font-size: 10pt;
    color: #888;
    margin: 0;
  }
`;
