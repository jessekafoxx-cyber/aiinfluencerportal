import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Lock, BookOpen, ChevronRight, Download } from "lucide-react";
import {
  VSL_MASTERCLASS_CHAPTERS,
  type Block,
  type Chapter,
} from "@/content/vsl-masterclass";

const MASTERCLASS_VIDEO_WISTIA_ID = "xqucwlyhbe";

function ensureMasterclassWistiaScripts() {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!document.querySelector('script[data-wistia-player="true"]')) {
    const s = document.createElement("script");
    s.src = "https://fast.wistia.com/player.js";
    s.async = true;
    s.setAttribute("data-wistia-player", "true");
    head.appendChild(s);
  }
  const mediaSrc = `https://fast.wistia.com/embed/${MASTERCLASS_VIDEO_WISTIA_ID}.js`;
  if (!document.querySelector(`script[src="${mediaSrc}"]`)) {
    const s = document.createElement("script");
    s.src = mediaSrc;
    s.async = true;
    s.type = "module";
    head.appendChild(s);
  }
}

function MasterclassIntroVideo() {
  useEffect(() => {
    ensureMasterclassWistiaScripts();
  }, []);

  return (
    <div className="mb-10">
      <p className="text-[10.5px] text-[#C9A44C] font-bold uppercase tracking-[0.16em] mb-2">
        Phase 3 / Lesson 2 - Walkthrough
      </p>
      <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-[#050505]">
        <style>{`
          wistia-player[media-id='${MASTERCLASS_VIDEO_WISTIA_ID}']:not(:defined) {
            background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${MASTERCLASS_VIDEO_WISTIA_ID}/swatch');
            display: block;
            filter: blur(5px);
            padding-top: 56.25%;
          }
        `}</style>
        <div
          dangerouslySetInnerHTML={{
            __html: `<wistia-player media-id="${MASTERCLASS_VIDEO_WISTIA_ID}" aspect="1.7777777777777777"></wistia-player>`,
          }}
        />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {}
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#C9A44C]/15 hover:bg-[#C9A44C]/25 text-[#C9A44C] text-[10.5px] font-bold uppercase tracking-wider transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy template"}
    </button>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "para":
      return (
        <p className="text-[14.5px] leading-[1.7] text-white/75">{block.text}</p>
      );
    case "heading": {
      const level = block.level || 2;
      if (level === 3) {
        return (
          <h3
            className="text-[16px] font-bold uppercase tracking-[0.06em] text-white/90 mt-6 mb-2"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {block.text}
          </h3>
        );
      }
      return (
        <h2
          className="text-[20px] md:text-[22px] font-bold uppercase tracking-[0.04em] text-white mt-8 mb-3"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {block.text}
        </h2>
      );
    }
    case "list":
      return block.ordered ? (
        <ol className="list-decimal pl-6 space-y-2 text-[14px] leading-[1.65] text-white/75 marker:text-[#C9A44C]/70">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc pl-6 space-y-2 text-[14px] leading-[1.65] text-white/75 marker:text-[#C9A44C]/60">
          {block.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case "callout": {
      const tone = block.tone || "neutral";
      const styles =
        tone === "gold"
          ? "border-[#C9A44C]/30 bg-[#C9A44C]/[0.06]"
          : tone === "danger"
          ? "border-red-500/25 bg-red-500/[0.05]"
          : "border-white/[0.08] bg-white/[0.03]";
      const titleColor =
        tone === "gold"
          ? "text-[#C9A44C]"
          : tone === "danger"
          ? "text-red-300"
          : "text-white/80";
      return (
        <div className={`border ${styles} rounded-xl p-5`}>
          {block.title && (
            <p
              className={`text-[11px] font-bold uppercase tracking-[0.14em] mb-1.5 ${titleColor}`}
            >
              {block.title}
            </p>
          )}
          <p className="text-[14px] leading-[1.65] text-white/80">{block.text}</p>
        </div>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#0d0d0d]">
          <table className="w-full text-left text-[13px] min-w-[640px]">
            <thead>
              <tr className="bg-white/[0.04] border-b border-white/[0.07]">
                {block.columns.map((c, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#C9A44C]/85"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {block.rows.map((row, ri) => (
                <tr key={ri} className="align-top">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-4 py-3 text-white/75 leading-[1.55]"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "annotation":
      return (
        <div className="border border-white/[0.07] rounded-xl bg-[#0d0d0d] overflow-hidden">
          {block.title && (
            <div className="bg-white/[0.04] px-5 py-2.5 border-b border-white/[0.07]">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]/85">
                {block.title}
              </p>
            </div>
          )}
          <div className="divide-y divide-white/[0.05]">
            {block.rows.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-0"
              >
                <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-white/[0.05] bg-[#0a0a0a]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40 mb-1.5">
                    VSL line
                  </p>
                  <p className="text-[13.5px] leading-[1.6] text-white/85 italic">
                    {r.line}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]/80 mb-1.5">
                    What it's doing &amp; why it works
                  </p>
                  <p className="text-[13.5px] leading-[1.6] text-white/75">
                    {r.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "template":
      return (
        <div className="border border-[#C9A44C]/25 rounded-xl bg-[#0d0d0d] overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-[#C9A44C]/[0.07] px-5 py-2.5 border-b border-[#C9A44C]/20">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]">
              {block.title}
            </p>
            <CopyButton text={block.body} />
          </div>
          <pre className="px-5 py-4 text-[13.5px] leading-[1.65] text-white/80 whitespace-pre-wrap font-sans">
            {block.body}
          </pre>
        </div>
      );
    default:
      return null;
  }
}

function ChapterSection({ chapter }: { chapter: Chapter }) {
  return (
    <section
      id={chapter.slug}
      className="scroll-mt-24 pt-10 first:pt-0 border-t border-white/[0.05] first:border-t-0"
    >
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] mb-1.5">
          Chapter {chapter.number}
        </p>
        <h2
          className="text-[26px] md:text-[32px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {chapter.title}
        </h2>
        {chapter.kicker && (
          <p className="text-[14.5px] text-white/55 mt-2 italic">
            {chapter.kicker}
          </p>
        )}
        {chapter.intro && (
          <p className="text-[15px] leading-[1.7] text-white/80 mt-4">
            {chapter.intro}
          </p>
        )}
      </div>
      <div className="space-y-5">
        {chapter.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </section>
  );
}

function StickyTOC({ chapters, activeSlug }: { chapters: Chapter[]; activeSlug: string }) {
  return (
    <aside className="hidden lg:block w-[260px] shrink-0">
      <div className="sticky top-6">
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/[0.05]">
            <BookOpen className="w-3.5 h-3.5 text-[#C9A44C]" />
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C]">
              Chapters
            </p>
          </div>
          <nav className="space-y-0.5 max-h-[75vh] overflow-y-auto pr-1">
            {chapters.map((c) => {
              const active = activeSlug === c.slug;
              return (
                <a
                  key={c.slug}
                  href={`#${c.slug}`}
                  className={`block px-2.5 py-1.5 rounded-md text-[12px] leading-snug transition-colors ${
                    active
                      ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                      : "text-white/55 hover:text-white/85 hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-[10px] font-bold opacity-60 mr-1.5">
                    {c.number}
                  </span>
                  {c.title}
                </a>
              );
            })}
          </nav>
        </div>
      </div>
    </aside>
  );
}

type PortalMeUser = {
  role?: string | null;
  bump1Paid?: boolean | null;
};
type PortalMeResponse = { user?: PortalMeUser | null };

export default function VslMasterclass() {
  const { data: me } = useQuery<PortalMeResponse>({
    queryKey: ["me"],
    queryFn: api.getMe,
  });
  const isAdmin = me?.user?.role === "admin";
  const paid = !!me?.user?.bump1Paid || isAdmin;

  const [activeSlug, setActiveSlug] = useState<string>(
    () => VSL_MASTERCLASS_CHAPTERS[0]?.slug || ""
  );

  // Pull initial slug from URL hash if present.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && VSL_MASTERCLASS_CHAPTERS.some((c) => c.slug === hash)) {
      setActiveSlug(hash);
      // Defer scroll until after the gate has rendered.
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }, [paid]);

  // Track active chapter via IntersectionObserver for the sticky TOC highlight.
  useEffect(() => {
    if (!paid) return;
    if (typeof window === "undefined") return;
    const sections = VSL_MASTERCLASS_CHAPTERS.map((c) =>
      document.getElementById(c.slug)
    ).filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target?.id) setActiveSlug(visible.target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 1] }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [paid]);

  const chapters = useMemo(() => VSL_MASTERCLASS_CHAPTERS, []);

  const isEmbed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "1";

  const printHref = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/vsl-masterclass/print`;
  // The PDF is generated on the server (Puppeteer + system Chromium against
  // the same chapter data the React print page uses) and cached by content
  // hash, so the browser just needs to GET the file. Cookies travel
  // automatically; the api-server verifies bump1Paid before streaming the PDF.
  const pdfHref = `/api/portal/vsl-masterclass.pdf`;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const handleDownloadPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      // Fetch the PDF as a blob so we can detect server errors and surface
      // them inline instead of dumping a JSON error page on the user. The
      // first request after a deploy can take ~6-10s while Chromium warms up
      // and renders all 26 chapters; subsequent calls are served from the
      // in-memory cache and are instant.
      const res = await fetch(pdfHref, { credentials: "include" });
      if (!res.ok) {
        let msg = `Download failed (${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vsl-masterclass.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the browser has a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 4_000);
    } catch (e: any) {
      console.error("VSL Masterclass PDF download failed", e);
      setPdfError(
        e?.message ||
          "Couldn't build the PDF right now. Opening the print view as a backup…",
      );
      window.open(printHref, "_blank", "noopener,noreferrer");
    } finally {
      setPdfBusy(false);
    }
  };

  const body = (
    <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
                VSL Order Bump · Premium Add-On
              </p>
              <h1
                className="text-[28px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                VSL Masterclass
              </h1>
              <p className="text-[14.5px] text-white/60 mt-2 max-w-[760px] leading-[1.65]">
                The full long-form playbook behind every VSL we ship - rebuilt around the Low Ticket Ascension model.
              </p>
            </div>
            {paid && (
              <div className="shrink-0 md:pt-1">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={pdfBusy}
                  data-testid="button-download-pdf"
                  className="inline-flex items-center gap-2 bg-[#C9A44C] hover:bg-[#D9B45C] disabled:opacity-70 disabled:cursor-wait text-black text-[12px] font-bold uppercase tracking-[0.12em] px-4 py-2.5 rounded-lg transition-colors shadow-[0_4px_18px_rgba(201,164,76,0.2)]"
                  title="Download a polished PDF of all 26 chapters"
                >
                  <Download className="w-3.5 h-3.5" />
                  {pdfBusy ? "Building PDF…" : "Download PDF"}
                </button>
                <p className="text-[10.5px] text-white/40 mt-1.5 text-right max-w-[210px] ml-auto leading-snug">
                  All 26 chapters, branded and page-numbered.{" "}
                  <a
                    href={printHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-print-view"
                    className="text-[#C9A44C]/80 hover:text-[#C9A44C] underline-offset-2 hover:underline"
                  >
                    Print view
                  </a>
                </p>
                {pdfError && (
                  <p
                    className="text-[10.5px] text-red-400/80 mt-1 text-right max-w-[210px] ml-auto leading-snug"
                    data-testid="text-pdf-error"
                  >
                    {pdfError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {!paid ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center max-w-[640px] mx-auto">
            <div className="w-14 h-14 rounded-full bg-[#C9A44C]/15 flex items-center justify-center mx-auto mb-5">
              <Lock className="w-6 h-6 text-[#C9A44C]" />
            </div>
            <h2
              className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-tight mb-3"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              VSL Order Bump Required
            </h2>
            <p className="text-[14px] text-white/60 mb-6 leading-[1.6]">
              The VSL Masterclass is included with the VSL Vault order bump. Unlock it from the sidebar and
              this page (plus the full Templates Pack) becomes available instantly.
            </p>
            <p className="text-[12px] text-white/40">
              Already purchased? Refresh the page — your account will sync within a minute.
            </p>
          </div>
        ) : (
          <div className="flex gap-8 items-start">
            <StickyTOC chapters={chapters} activeSlug={activeSlug} />
            <main className="flex-1 min-w-0 space-y-12">
              <MasterclassIntroVideo />
              {/* Mobile chapter quick-jump */}
              <div className="lg:hidden bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-3">
                <label className="block text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] mb-2">
                  Jump to chapter
                </label>
                <select
                  value={activeSlug}
                  onChange={(e) => {
                    const slug = e.target.value;
                    setActiveSlug(slug);
                    document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
                    if (typeof window !== "undefined") {
                      window.history.replaceState(null, "", `#${slug}`);
                    }
                  }}
                  className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-md px-3 py-2 text-[13px] text-white outline-none focus:border-[#C9A44C]/50"
                >
                  {chapters.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.number} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              {chapters.map((c) => (
                <ChapterSection key={c.slug} chapter={c} />
              ))}

              <div className="border-t border-white/[0.06] pt-8 text-center">
                <a
                  href="#foundations"
                  className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] hover:text-[#D9B45C]"
                >
                  Back to top
                  <ChevronRight className="w-3.5 h-3.5 rotate-[-90deg]" />
                </a>
              </div>
            </main>
          </div>
        )}
      </div>
  );

  if (isEmbed) {
    return (
      <div className="min-h-screen bg-[#050505] text-white">
        {body}
      </div>
    );
  }

  return <PortalLayout>{body}</PortalLayout>;
}
