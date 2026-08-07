import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Copy, Check } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { fetchApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

type Script = { id: number; type: string; hook: string; body: string };

const TYPE_LABELS: Record<string, string> = {
  "podcast-clip": "Podcast Clips",
  "speaking-clip": "Speaking Clips",
  "green-screen": "Green Screen",
  "selfie-clip": "Selfie Yapping",
};
// Only the 4 formats wired to the AI Influencer Portfolio offer are
// shown in the library. Any legacy types still in the DB are filtered
// out below.
const TYPE_ORDER = Object.keys(TYPE_LABELS);
const ALLOWED_TYPES = new Set(TYPE_ORDER);

export default function DfyScripts() {
  const { data, isLoading } = useQuery({
    queryKey: ["dfy-scripts"],
    queryFn: () => fetchApi("/dfy/scripts") as Promise<{ scripts: Script[] }>,
    staleTime: 60_000,
  });
  const scripts = (data?.scripts || []).filter((s) => ALLOWED_TYPES.has(s.type));

  const [activeType, setActiveType] = useState<string>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: scripts.length };
    for (const s of scripts) m[s.type] = (m[s.type] || 0) + 1;
    return m;
  }, [scripts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scripts.filter((s) => {
      if (activeType !== "all" && s.type !== activeType) return false;
      if (!q) return true;
      return s.hook.toLowerCase().includes(q) || s.body.toLowerCase().includes(q);
    });
  }, [scripts, activeType, query]);

  return (
    <DfySubPageShell
      title={`${(scripts.length || 0).toLocaleString()} Proven AI Influencer Portfolio Scripts`}
      description="A library of pre-written scripts across the 4 highest-converting Script Writer formats - Podcast Clip, Speaking Clip, Green Screen, and Selfie Clip - all wired to the AI Influencer Portfolio offer. Filter by type, search by keyword, copy any script with one click."
    >
      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search scripts..."
              className="w-full bg-[#0f0f0f] border border-white/[0.08] rounded-lg px-4 py-2.5 text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/50"
            />
            <div className="flex flex-wrap gap-2">
              <TypePill
                label="All"
                count={counts.all || 0}
                active={activeType === "all"}
                onClick={() => setActiveType("all")}
              />
              {TYPE_ORDER.map((t) => (
                <TypePill
                  key={t}
                  label={TYPE_LABELS[t]}
                  count={counts[t] || 0}
                  active={activeType === t}
                  onClick={() => setActiveType(t)}
                />
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center text-white/55 text-[13px]">
              No scripts match this filter.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filtered.map((s) => (
                <ScriptCard key={s.id} script={s} />
              ))}
            </div>
          )}
        </>
      )}
    </DfySubPageShell>
  );
}

function TypePill({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] transition-colors border ${
        active
          ? "bg-[#C9A44C] text-black border-[#C9A44C]"
          : "bg-white/[0.04] text-white/65 border-white/[0.08] hover:text-white hover:border-white/20"
      }`}
    >
      {label} <span className="opacity-60 ml-1">{count}</span>
    </button>
  );
}

function ScriptCard({ script }: { script: Script }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const text = `${script.hook}\n\n${script.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Script copied",
        description: "Paste it into your editor or Script Writer OS.",
      });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };
  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#C9A44C]/85 bg-[#C9A44C]/10 px-2 py-0.5 rounded">
          {TYPE_LABELS[script.type] || script.type}
        </span>
        <button
          onClick={onCopy}
          className="text-white/45 hover:text-white inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.14em]"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[13.5px] font-semibold text-white leading-[1.4] mb-2">{script.hook}</p>
      <p className="text-[12.5px] text-white/65 leading-[1.6] whitespace-pre-wrap">{script.body}</p>
    </div>
  );
}
