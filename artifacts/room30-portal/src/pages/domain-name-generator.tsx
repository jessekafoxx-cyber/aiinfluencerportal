import { useState } from "react";
import { Globe, Sparkles, Loader2, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi } from "@/lib/api";

type DomainResult = {
  name: string;
  tld: string;
  rationale: string;
  available?: boolean | null;
};

export default function DomainNameGenerator() {
  const [offer, setOffer] = useState("");
  const [results, setResults] = useState<DomainResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!offer.trim() || offer.trim().length < 3) {
      setError("Please describe your offer in at least a few words.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const data: any = await fetchApi("/domain-name-generator/generate", {
        method: "POST",
        body: JSON.stringify({ offer: offer.trim() }),
      });
      setResults(data.domains ?? []);
    } catch (e: any) {
      setError(e?.message || "Failed to generate domain names. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0">
            <Globe className="w-5 h-5 text-[#C9A44C]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Domain Name Generator</h1>
            <p className="text-white/40 text-[12px] mt-0.5">20 brandable domain ideas across .com, .io, .co and .ai — instantly</p>
          </div>
        </div>

        {/* Input */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 mb-6">
          <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            Describe Your Offer
          </label>
          <textarea
            rows={3}
            value={offer}
            onChange={e => setOffer(e.target.value)}
            placeholder="e.g. A done-for-you AI influencer system that builds a faceless content business generating $1K–$3K/day in profit"
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40 resize-none mb-4"
          />
          <button
            onClick={generate}
            disabled={loading || offer.trim().length < 3}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Generating…" : "Generate Domain Names"}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {loading && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 text-[#C9A44C] text-[13px] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Generating 20 domain ideas with availability checks…
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[13px] font-semibold text-white">{results.length} Domain Ideas</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {results.map((d, i) => (
                <div key={i} className="flex items-start gap-4 px-6 py-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[15px] font-bold text-white">{d.name}</span>
                      <span className="text-[13px] font-semibold text-[#C9A44C]">{d.tld}</span>
                      {d.available === true && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">Available</span>
                      )}
                      {d.available === false && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-400">Taken</span>
                      )}
                    </div>
                    <p className="text-[12px] text-white/40 leading-relaxed">{d.rationale}</p>
                  </div>
                  <a
                    href={`https://www.namecheap.com/domains/registration/results/?domain=${d.name}${d.tld}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors"
                  >
                    Check <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
