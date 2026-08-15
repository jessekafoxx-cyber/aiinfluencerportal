import { useState, useEffect } from "react";
import {
  Globe, Sparkles, Loader2, AlertCircle, Copy, ExternalLink,
  ChevronDown, ChevronUp, Clock, CheckCircle2, HelpCircle,
  ArrowLeft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi, api } from "@/lib/api";
import { useLocation } from "wouter";

const GOLD = "#C9A44C";
const SLUG = "domain-name-generator";

// ─── Types ────────────────────────────────────────────────────────────────────

type DomainEntry = {
  domain: string;   // full domain e.g. "promptforge.com"
  tld: string;      // ".com" | ".io" | ".co" | ".ai"
  rationale: string;
  availability: "available" | "taken" | "unknown";
};

type PrefixedEntry = DomainEntry & {
  basedOn: string;
  prefix: string;
};

type GenerateResult = {
  ok: boolean;
  domains: DomainEntry[];
  prefixedAlternatives: PrefixedEntry[];
  note: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stemOf(entry: DomainEntry) {
  return entry.domain.slice(0, entry.domain.length - entry.tld.length);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

// ─── Availability Badge ───────────────────────────────────────────────────────

function AvailBadge({ availability }: { availability: "available" | "taken" | "unknown" }) {
  if (availability === "available") {
    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-500/10 text-emerald-400 uppercase tracking-wide">
        <CheckCircle2 className="w-2.5 h-2.5" /> Likely Available
      </span>
    );
  }
  if (availability === "taken") {
    return (
      <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-red-500/10 text-red-400 uppercase tracking-wide">
        Likely Unavailable
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-white/[0.06] text-white/40 uppercase tracking-wide">
      <HelpCircle className="w-2.5 h-2.5" /> Check Registrar
    </span>
  );
}

// ─── Domain Card ─────────────────────────────────────────────────────────────

function DomainCard({ entry, showPrefix }: { entry: DomainEntry & { prefix?: string; basedOn?: string }; showPrefix?: boolean }) {
  const [copied, setCopied] = useState(false);
  const stem = stemOf(entry);

  const handleCopy = () => {
    copyToClipboard(entry.domain);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-[16px] font-bold text-white leading-tight">{stem}</span>
            <span className="text-[14px] font-semibold leading-tight" style={{ color: GOLD }}>{entry.tld}</span>
          </div>
          {showPrefix && entry.prefix && entry.basedOn && (
            <p className="text-[10.5px] text-white/30 mt-0.5">{entry.prefix} + {entry.basedOn}</p>
          )}
        </div>
        <AvailBadge availability={entry.availability} />
      </div>

      <p className="text-[11.5px] text-white/45 leading-relaxed">{entry.rationale}</p>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white/50 hover:text-white text-[11px] font-medium transition-colors"
        >
          {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
        <a
          href={`https://www.namecheap.com/domains/registration/results/?domain=${entry.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white/50 hover:text-white text-[11px] font-medium transition-colors"
        >
          <ExternalLink className="w-3 h-3" /> Check at Registrar
        </a>
      </div>
    </div>
  );
}

// ─── History Section ──────────────────────────────────────────────────────────

function HistorySection() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["os-tool-saved-list", SLUG],
    queryFn: () => api.getOSToolSavedList(SLUG),
    enabled: open,
  });

  const assets: any[] = (data as any)?.assets ?? [];

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/40" />
          <span className="text-[13px] font-semibold text-white/70">History</span>
          {assets.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-white/40">
              {assets.length}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
      </button>

      {open && (
        <div className="border-t border-white/[0.06]">
          {isLoading && (
            <div className="flex items-center gap-2 px-5 py-4 text-white/40 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
            </div>
          )}
          {!isLoading && assets.length === 0 && (
            <p className="px-5 py-4 text-[13px] text-white/30">No previous generations yet.</p>
          )}
          {!isLoading && assets.map((asset: any, i: number) => {
            const out = asset.output as any;
            const domains: DomainEntry[] = out?.domains ?? [];
            const prefixed: PrefixedEntry[] = out?.prefixedAlternatives ?? [];
            const label = asset.label || asset.input?.offer || "Untitled";
            const date = asset.createdAt ? new Date(asset.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
            const isExp = expanded === i;
            const available = domains.filter(d => d.availability === "available").length;

            return (
              <div key={i} className="border-t border-white/[0.04]">
                <button
                  onClick={() => setExpanded(isExp ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors text-left"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-[13px] font-medium text-white/75 truncate">{label}</p>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {date}{date && " · "}{domains.length} domains{available > 0 ? ` · ${available} likely available` : ""}
                    </p>
                  </div>
                  {isExp ? <ChevronUp className="w-3.5 h-3.5 text-white/30 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />}
                </button>

                {isExp && (
                  <div className="px-5 pb-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {domains.map((d, j) => <DomainCard key={j} entry={d} />)}
                    </div>
                    {prefixed.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/30 mb-3">
                          More .com Options
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {prefixed.map((d, j) => <DomainCard key={j} entry={d} showPrefix />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DomainNameGenerator() {
  const [, setLocation] = useLocation();
  const [offer, setOffer] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (offer.trim().length < 3) {
      setError("Please describe your offer in at least a few words.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchApi("/domain-name-generator/generate", {
        method: "POST",
        body: JSON.stringify({ offer: offer.trim() }),
      }) as GenerateResult;
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Failed to generate domain names. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const domains = result?.domains ?? [];
  const prefixed = result?.prefixedAlternatives ?? [];
  const available = domains.filter(d => d.availability === "available").length;

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Back */}
        <button
          onClick={() => setLocation("/operating-system")}
          className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[12px] font-medium mb-5 transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to Building Your Bridge Page
        </button>

        {/* Phase label */}
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] mb-2" style={{ color: GOLD }}>
          Phase 2 · Bridge Page Build
        </p>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-wide mb-3">
          Domain Name Idea Generator
        </h1>
        <p className="text-[13px] text-white/45 leading-relaxed mb-8 max-w-2xl">
          Drop in a short note about what your offer is about. We will hand you back brandable domain ideas across
          .com, .io, .co and .ai, run a fast availability check on each one, hide anything already taken, and fall
          back to try / get / learn .com variants when the bare name is gone.
        </p>

        {/* Input card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-8">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-3">
            What is your offer about?
          </label>
          <textarea
            rows={3}
            value={offer}
            onChange={e => setOffer(e.target.value.slice(0, 400))}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) generate(); }}
            placeholder="e.g. making money with AI, coaching busy moms back into shape, AI lead gen for solar installers…"
            className="w-full px-3.5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 resize-none mb-4"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/25">{offer.length}/400 characters. Short and direct works best.</span>
            <button
              onClick={generate}
              disabled={loading || offer.trim().length < 3}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: `linear-gradient(135deg, ${GOLD} 0%, #a07830 100%)`, color: "#000" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate 20 Domains
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mb-6 p-5 rounded-2xl flex items-center gap-4 border" style={{ background: `${GOLD}10`, borderColor: `${GOLD}30` }}>
            <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" style={{ color: GOLD }} />
            <div>
              <p className="text-[14px] font-semibold" style={{ color: GOLD }}>Generating domain ideas…</p>
              <p className="text-[12px] mt-0.5" style={{ color: `${GOLD}88` }}>
                Running availability checks on each name. Usually takes 15–30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Empty state (no results yet, not loading) */}
        {!loading && !result && !error && (
          <div className="mb-8 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-10 flex flex-col items-center gap-3 text-center">
            <Globe className="w-8 h-8 text-white/15" />
            <p className="text-[13px] text-white/30">Your domain ideas will appear here once you generate.</p>
          </div>
        )}

        {/* Results */}
        {result && domains.length > 0 && (
          <div className="mb-8 space-y-6">
            {/* Section header */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-black uppercase tracking-[0.15em] text-white">
                  Your Domain Ideas
                </h2>
                <p className="text-[11px] text-white/30 mt-0.5">
                  {domains.length} options{available > 0 ? ` (${available} likely available)` : ""}
                </p>
              </div>
              {result.note && (
                <p className="text-[10.5px] text-white/25 max-w-xs text-right leading-relaxed hidden sm:block">{result.note}</p>
              )}
            </div>

            {/* Domain grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {domains.map((d, i) => <DomainCard key={i} entry={d} />)}
            </div>

            {/* Prefixed alternatives */}
            {prefixed.length > 0 && (
              <div className="space-y-4 pt-2">
                <div>
                  <h2 className="text-[13px] font-black uppercase tracking-[0.15em] text-white">
                    More .com Options with Try / Get / Learn
                  </h2>
                  <p className="text-[11px] text-white/30 mt-1 max-w-xl leading-relaxed">
                    When the bare name is gone, prepending try, get or learn often opens a clean .com on the same idea.
                    Below are the prefixed .com versions that look open right now.
                    {prefixed.length > 0 && ` · ${prefixed.length} extra .com options`}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {prefixed.map((d, i) => <DomainCard key={i} entry={d} showPrefix />)}
                </div>
              </div>
            )}

            {/* Availability note */}
            {result.note && (
              <p className="text-[11px] text-white/25 leading-relaxed sm:hidden">{result.note}</p>
            )}
          </div>
        )}

        {/* No results returned */}
        {result && domains.length === 0 && (
          <div className="mb-8 p-5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[13px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>No domain ideas were returned — this can happen when the model call times out. Try again with a shorter, more specific offer description.</span>
          </div>
        )}

        {/* History */}
        <HistorySection />
      </div>
    </PortalLayout>
  );
}
