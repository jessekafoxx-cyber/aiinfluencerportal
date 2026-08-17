import { useState } from "react";
import {
  Instagram, Sparkles, Loader2, AlertCircle, CheckCircle2,
  Copy, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi } from "@/lib/api";

const IG_PINK = "#e1306c";

type Bio = {
  pattern: string;
  patternName: string;
  lines: string[];
  rationale: string;
};

type Result = {
  bios: Bio[];
  influencerName?: string;
};

const PATTERN_LABELS: Record<string, string> = {
  A: "I help X do Y without Z",
  B: "Founder story → transformation → handle",
  C: "Big-number proof stack + CTA",
  D: "Resume credential → social proof → CTA",
  E: "Bullet manifesto",
};

function CharBadge({ text }: { text: string }) {
  const len = text.length;
  const over = len > 150;
  return (
    <span
      className="text-[10px] font-mono ml-1"
      style={{ color: over ? "#f87171" : len > 130 ? "#fbbf24" : "#6ee7b7" }}
    >
      {len}/150
    </span>
  );
}

function BioCard({ bio, index }: { bio: Bio; index: number }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(index === 0);

  const fullText = bio.lines.join("\n");
  const totalChars = fullText.length;
  const over = totalChars > 150;

  const copy = () => {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="rounded-xl border overflow-hidden transition-all"
      style={{ borderColor: expanded ? `${IG_PINK}40` : "rgba(255,255,255,0.08)" }}
    >
      {/* Card header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{ background: `${IG_PINK}25`, color: IG_PINK }}
          >
            {bio.pattern || String.fromCharCode(64 + index + 1)}
          </span>
          <div className="text-left">
            <div className="text-[13px] font-semibold text-white leading-tight">
              {bio.patternName || PATTERN_LABELS[bio.pattern] || `Variation ${index + 1}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              over ? "bg-red-500/15 text-red-400" : "bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {totalChars}/150
          </span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-white/30" />
            : <ChevronDown className="w-4 h-4 text-white/30" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          {/* Bio lines — styled like an actual IG bio */}
          <div
            className="rounded-xl p-4 mb-3 font-[Inter,system-ui,sans-serif]"
            style={{ background: "rgba(225,48,108,0.05)", border: "1px solid rgba(225,48,108,0.15)" }}
          >
            {bio.lines.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-3 group">
                <p className="text-[14px] text-white leading-snug py-0.5">{line}</p>
                <CharBadge text={line} />
              </div>
            ))}
          </div>

          {bio.rationale && (
            <p className="text-[11px] text-white/35 mb-3 italic leading-relaxed">
              {bio.rationale}
            </p>
          )}

          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-all"
            style={{
              background: copied ? "#10b981" + "25" : `${IG_PINK}20`,
              color: copied ? "#10b981" : IG_PINK,
            }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy bio"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function IgBioGenerator() {
  const [igHandle, setIgHandle] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await fetchApi("/ig-bio-generator", {
        method: "POST",
        body: JSON.stringify({
          igHandle: igHandle.trim().replace(/^@+/, "") || null,
          extraNotes: extraNotes.trim() || null,
        }),
      });
      if (!data?.bios?.length) throw new Error("No bios returned — please try again.");
      setResult(data as Result);
    } catch (e: any) {
      setError(e?.message || "Failed to generate bios. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${IG_PINK}20` }}
          >
            <Instagram className="w-5 h-5" style={{ color: IG_PINK }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">IG Bio Generator</h1>
            <p className="text-white/40 text-[12px] mt-0.5">
              5 scroll-stopping Instagram bio variations pulled straight from Your Brain — one per proven framework
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 mb-4">
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">
              Instagram handle
              <span className="normal-case tracking-normal text-white/25 font-normal ml-1">(optional)</span>
              <input
                value={igHandle}
                onChange={e => setIgHandle(e.target.value)}
                placeholder="@yourhandle"
                maxLength={65}
                className="mt-1.5 w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#e1306c]/40 font-normal tracking-normal normal-case"
              />
            </label>
          </div>

          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
            Extra direction
            <span className="normal-case tracking-normal text-white/25 font-normal ml-1">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={extraNotes}
            onChange={e => setExtraNotes(e.target.value.slice(0, 600))}
            placeholder="e.g. Emphasise the speed angle. Keep it playful. We sell to female entrepreneurs in the UK."
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#e1306c]/40 resize-none mb-1"
          />
          <div className="flex justify-end mb-4">
            <span className="text-[10px] text-white/25">{extraNotes.length}/600</span>
          </div>

          <div className="text-[11px] text-white/30 mb-4 leading-relaxed">
            Your bio is personalised from <strong className="text-white/50">Your Brain</strong>. Make sure it's filled in before generating — the richer the Brain, the sharper the bios.
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: `linear-gradient(135deg, ${IG_PINK} 0%, #833ab4 100%)`, color: "#fff" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Writing your bios…" : "Generate 5 Bios"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            className="mb-6 p-4 rounded-xl text-[13px] flex items-center gap-2"
            style={{ background: `${IG_PINK}10`, border: `1px solid ${IG_PINK}25`, color: IG_PINK }}
          >
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Reading your Brain and writing 5 bio variations…
          </div>
        )}

        {/* Results */}
        {result && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[13px] font-semibold text-white">
                5 bios ready
                {result.influencerName ? ` for ${result.influencerName}` : ""}
              </span>
              <span className="text-[11px] text-white/30 ml-1">
                — pick your favourite, copy with line breaks included, paste straight into your profile
              </span>
            </div>

            <div className="space-y-3">
              {result.bios.map((bio, i) => (
                <BioCard key={i} bio={bio} index={i} />
              ))}
            </div>

            <div
              className="mt-4 p-3.5 rounded-xl text-[11px] text-white/35 leading-relaxed"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <strong className="text-white/50">Tip:</strong> Instagram's bio field caps at 150 characters total (all lines combined). The character counter on each bio shows whether you're within the limit. Bios marked in red need a quick trim before posting.
            </div>

            <button
              onClick={() => { setResult(null); setError(null); }}
              className="mt-4 text-[12px] text-white/30 hover:text-white/60 transition-colors"
            >
              ← Generate new variations
            </button>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
