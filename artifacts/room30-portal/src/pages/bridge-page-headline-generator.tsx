import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Brain, Download, ArrowLeft, Copy, Pencil, Coins, Lock,
  RefreshCw, ChevronRight,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import { useLocation } from "wouter";

const SLUG = "bridge-page-headlines";
const POLL_MS = 3000;
const GOLD = "#C9A44C";

// ─── Quota Badge ──────────────────────────────────────────────────────────────

function QuotaBadge({ quota }: { quota: ReturnType<typeof useQuery>["data"] }) {
  if (!quota) return null;
  const q = quota as any;
  if (q.isAdmin || q.unlimited) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> Unlimited
      </span>
    );
  }
  const remaining = Math.max(0, q.freeRemaining ?? 0);
  const total = q.freeQuota ?? 3;
  if (remaining > 0) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: GOLD, background: `${GOLD}18` }}>
        <Sparkles className="w-3 h-3" /> {remaining} of {total} free uses remaining
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
      <Lock className="w-3 h-3" /> Free uses exhausted — credits needed
    </span>
  );
}

// ─── Output Section ───────────────────────────────────────────────────────────

function GeneratedOutput({
  content,
  onRegenerate,
  isGenerating,
  quota,
  onBuyCredits,
}: {
  content: string;
  onRegenerate: () => void;
  isGenerating: boolean;
  quota: any;
  onBuyCredits: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [refinePrompt, setRefinePrompt] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [currentContent, setCurrentContent] = useState(content);

  useEffect(() => { setCurrentContent(content); }, [content]);

  const handleCopy = () => {
    const div = document.createElement("div");
    div.innerHTML = currentContent;
    navigator.clipboard.writeText(div.textContent || div.innerText || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadWord = () => {
    const blob = new Blob([
      `<!DOCTYPE html><html><head><meta charset="UTF-8">
       <style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 32px;color:#1a1a1a}
       h2{font-size:17px;font-weight:700;margin:28px 0 10px;border-bottom:2px solid #C9A44C;padding-bottom:6px;text-transform:uppercase}
       h3{font-size:14px;font-weight:700;margin:18px 0 8px;color:#444}
       p{line-height:1.75;margin:8px 0;font-size:14px}
       ul,ol{padding-left:24px;margin:8px 0}
       li{line-height:1.75;margin:4px 0;font-size:14px}
       strong{font-weight:700}</style></head>
       <body>${currentContent}</body></html>`
    ], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bridge-page-headlines.doc";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefine = async () => {
    if (!refinePrompt.trim() || isRefining) return;
    setIsRefining(true);
    try {
      const result = await api.refineOSTool(SLUG, currentContent, refinePrompt);
      if ((result as any)?.content) {
        setCurrentContent((result as any).content);
        setRefinePrompt("");
      }
    } catch (err: any) {
      alert(err?.message || "Refine failed — please try again.");
    } finally {
      setIsRefining(false);
    }
  };

  const canRegenerate = !!(quota?.isAdmin || quota?.unlimited || (quota?.freeRemaining ?? 0) > 0);

  return (
    <div className="space-y-6">
      {/* Output header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-[13px] font-semibold text-white uppercase tracking-wide">
            Generated Bridge Page Headline Generator
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white/60 hover:text-white text-[12px] font-medium transition-colors"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleDownloadWord}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white/60 hover:text-white text-[12px] font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Word
          </button>
          <button
            onClick={() => { setEditMode(v => !v); setEditContent(currentContent); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white/60 hover:text-white text-[12px] font-medium transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> {editMode ? "Preview" : "Edit Manually"}
          </button>
          {canRegenerate ? (
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: GOLD, color: "#000" }}
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate
            </button>
          ) : (
            <button
              onClick={onBuyCredits}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white/[0.06] border border-white/10 text-white/60 hover:text-white transition-colors"
            >
              <Coins className="w-3.5 h-3.5" /> Buy Credits
            </button>
          )}
        </div>
      </div>

      {/* Output content */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.01] overflow-hidden">
        {editMode ? (
          <div className="p-5">
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={30}
              className="w-full bg-transparent text-white/70 text-[12.5px] font-mono leading-relaxed resize-y focus:outline-none"
            />
            <button
              onClick={() => { setCurrentContent(editContent); setEditMode(false); }}
              className="mt-3 px-4 py-2 rounded-lg text-[13px] font-semibold text-black"
              style={{ background: GOLD }}
            >
              Save Edits
            </button>
          </div>
        ) : (
          <div className="p-6 sm:p-8">
            <style>{`
              .bphg-output h2 { font-size: 13px; font-weight: 800; color: ${GOLD}; text-transform: uppercase; letter-spacing: 0.1em; margin: 28px 0 14px; padding-bottom: 6px; border-bottom: 1px solid rgba(201,164,76,0.2); }
              .bphg-output h2:first-child { margin-top: 0; }
              .bphg-output h3 { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.1em; margin: 20px 0 10px; }
              .bphg-output p { font-size: 13.5px; color: rgba(255,255,255,0.75); line-height: 1.75; margin: 6px 0; }
              .bphg-output p strong { color: rgba(255,255,255,0.95); font-weight: 700; }
              .bphg-output ul, .bphg-output ol { padding-left: 20px; margin: 8px 0; }
              .bphg-output li { font-size: 13.5px; color: rgba(255,255,255,0.70); line-height: 1.75; margin: 5px 0; }
              .bphg-output em { color: rgba(255,255,255,0.45); font-style: italic; }
              .bphg-variant { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 18px 20px; margin: 12px 0; }
              .bphg-variant p { margin: 4px 0; }
            `}</style>
            <div className="bphg-output" dangerouslySetInnerHTML={{ __html: currentContent }} />
          </div>
        )}
      </div>

      {/* Refine with AI */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.01] p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4" style={{ color: GOLD }} />
          <span className="text-[13px] font-semibold text-white">Refine with AI</span>
        </div>
        <p className="text-[12px] text-white/40">
          Tell the AI exactly what to change. Be specific — e.g. "Make headline 3 more aggressive" or "Add urgency to all sub-headlines."
          {" "}Tip: press Ctrl+Enter to submit. Refining counts as up to 80 seconds.
        </p>
        <textarea
          value={refinePrompt}
          onChange={e => setRefinePrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleRefine(); }}
          rows={3}
          placeholder="e.g. Make the headlines more aggressive and fear-based. Add more specific dollar figures…"
          className="w-full px-3.5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 resize-none"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-white/25">
            {quota?.isAdmin || quota?.unlimited
              ? "Unlimited refinements available"
              : `${Math.max(0, quota?.freeRemaining ?? 0)} free generation${(quota?.freeRemaining ?? 0) !== 1 ? "s" : ""} remaining`}
          </p>
          <div className="flex items-center gap-2">
            {!canRegenerate && (
              <button
                onClick={onBuyCredits}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/[0.06] border border-white/10 text-white/60 hover:text-white"
              >
                <Coins className="w-3.5 h-3.5" /> Buy Credits
              </button>
            )}
            <button
              onClick={handleRefine}
              disabled={!refinePrompt.trim() || isRefining}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: GOLD }}
            >
              {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Refine with AI
            </button>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[11.5px] text-white/25 leading-relaxed text-center pb-4">
        This is your saved Bridge Page Headlines. Edit them, refine with AI, or re-generate from scratch with a new brain snapshot.{" "}
        {quota?.isAdmin || quota?.unlimited
          ? "Unlimited generations available."
          : (quota?.freeRemaining ?? 0) > 0
            ? `You have ${quota?.freeRemaining} free generation${(quota?.freeRemaining ?? 0) !== 1 ? "s" : ""} left. Each re-generate counts as 1 use.`
            : "You've used all your free generations. Buy a credit to re-generate, or buy a credit pack to get to work."}
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BridgePageHeadlineGenerator() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: brainData } = useQuery({
    queryKey: ["brain-profile"],
    queryFn: () => api.getBrainProfile(),
  });

  const { data: quota } = useQuery({
    queryKey: ["os-tool-quota", SLUG],
    queryFn: () => api.getOSToolGenerationQuota(SLUG),
  });

  const { data: meData } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const brainReady = (brainData as any)?.profile?.status === "generated";

  // Load any existing job on mount
  useEffect(() => {
    api.getActiveOSToolGenerationJob(SLUG).then(d => {
      if (d.job) {
        setJob(d.job);
        setJobId(d.job.id);
      }
    }).catch(() => {});
  }, []);

  // Poll while in-flight
  useEffect(() => {
    const isActive = job?.status === "pending" || job?.status === "processing";
    if (isActive && jobId) {
      pollingRef.current = setInterval(async () => {
        try {
          const d = await api.getOSToolGenerationJob(jobId);
          setJob(d.job);
          if (d.job.status === "done" || d.job.status === "failed") {
            clearInterval(pollingRef.current!);
            queryClient.invalidateQueries({ queryKey: ["os-tool-quota", SLUG] });
          }
        } catch {}
      }, POLL_MS);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [job?.status, jobId, queryClient]);

  const generateMutation = useMutation({
    mutationFn: () => api.generateOSTool(SLUG, {}),
    onSuccess: (data) => {
      setJobId((data as any).job.id);
      setJob((data as any).job);
      setError(null);
    },
    onError: (err: any) => setError(err?.message || "Failed to start generation"),
  });

  const isActive = job?.status === "pending" || job?.status === "processing";
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  const q = quota as any;
  const canGenerate = !q || q.isAdmin || q.unlimited || (q.freeRemaining ?? 0) > 0;
  const freeRemaining = q?.freeRemaining ?? 0;
  const freeQuota = q?.freeQuota ?? 3;

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Back button */}
        <button
          onClick={() => setLocation("/operating-system")}
          className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[12px] font-medium mb-6 transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to Operating System
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${GOLD}22` }}>
              <FileText className="w-5 h-5" style={{ color: GOLD }} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white uppercase tracking-wide mb-1">
                Bridge Page Headline Generator
              </h1>
              <p className="text-[13px] text-white/45 leading-relaxed max-w-2xl">
                Generate 11 headline + sub-headline variants and 3 bullet point sets for your affiliate bridge page.
                The only job of a bridge page is the click — this tool writes copy engineered to get it.
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/[0.05] border border-white/[0.08]" style={{ color: GOLD }}>
                  <Brain className="w-3 h-3" />
                  Brain Connector: AI Influencer Publishing / Prompt &amp; Build
                </span>
                {q && <QuotaBadge quota={quota} />}
              </div>
            </div>
          </div>
        </div>

        {/* Brain warning */}
        {!brainReady && (
          <div className="mb-6 p-4 rounded-xl border flex items-start gap-3" style={{ background: `${GOLD}12`, borderColor: `${GOLD}30` }}>
            <Brain className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: GOLD }} />
            <div className="flex-1">
              <p className="text-[13px] leading-relaxed" style={{ color: GOLD }}>
                {(brainData as any)?.profile?.status === "generating"
                  ? "Your Brain is still generating — hang tight, you'll be able to generate headlines once it's ready."
                  : "Set up your Brain first. This tool uses your brain profile to tailor every headline to your specific offer, audience, and transformation."}
              </p>
              {(brainData as any)?.profile?.status !== "generating" && (
                <button
                  onClick={() => setLocation("/your-brain")}
                  className="mt-2.5 flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-black"
                  style={{ background: GOLD }}
                >
                  Set Up Brain <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Free quota info banner — only when no generation yet */}
        {!isDone && !isActive && !isFailed && (
          <div className="mb-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-white mb-1">How it works</h2>
              <p className="text-[13px] text-white/45 leading-relaxed">
                Click <strong className="text-white/70">Generate</strong> and the AI will read your Brain profile, identify your offer's mechanism, audience, and proof elements,
                then produce 11 ready-to-use headline + sub-headline pairs across all 7 bridge-page hook categories — plus 2 curated bullet point sets and usage guidance.
                No inputs required.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "11 Headline Variants", desc: "All 7 hook categories covered so no two variants sound the same" },
                { label: "2 Bullet Point Sets", desc: "Outcome-led and curiosity-stack bullets you can paste directly" },
                { label: "Usage Guide", desc: "How to A/B test, what to change, and which variant to run first" },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-[12px] font-semibold mb-1" style={{ color: GOLD }}>{item.label}</p>
                  <p className="text-[11.5px] text-white/40 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* Quota display */}
            {q && !q.isAdmin && !q.unlimited && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px]">
                <span className="text-white/50">
                  Free generations: <span className="font-semibold text-white">{freeRemaining} of {freeQuota} remaining</span>
                </span>
                {freeRemaining === 0 && (
                  <button
                    onClick={() => setShowBuyCredits(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-black text-[12px]"
                    style={{ background: GOLD }}
                  >
                    <Coins className="w-3 h-3" /> Buy Credits
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Failed job state */}
        {isFailed && !error && (
          <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{job?.errorMessage || "Generation failed — please try again."}</span>
          </div>
        )}

        {/* In-flight */}
        {isActive && (
          <div className="mb-6 p-5 rounded-2xl flex items-center gap-4 border" style={{ background: `${GOLD}10`, borderColor: `${GOLD}30` }}>
            <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" style={{ color: GOLD }} />
            <div>
              <p className="text-[14px] font-semibold" style={{ color: GOLD }}>Generating your headlines…</p>
              <p className="text-[12px] mt-0.5" style={{ color: `${GOLD}88` }}>
                The AI is reading your Brain and writing all 11 variants. This usually takes 30–90 seconds.
              </p>
            </div>
          </div>
        )}

        {/* Generate button — shown when no done job, or after failure */}
        {!isDone && !isActive && (
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !canGenerate}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-[15px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-6"
            style={{ background: canGenerate ? GOLD : "rgba(255,255,255,0.06)", color: canGenerate ? "#000" : "#fff" }}
          >
            {generateMutation.isPending
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Starting…</>
              : <><Sparkles className="w-5 h-5" /> {isFailed ? "Try Again" : "Generate Bridge Page Headlines"}</>}
          </button>
        )}

        {!canGenerate && !isDone && !isActive && (
          <div className="mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-white/50">
              You've used all 3 free generations. Buy credits to continue generating.
            </p>
            <button
              onClick={() => setShowBuyCredits(true)}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-black"
              style={{ background: GOLD }}
            >
              <Coins className="w-4 h-4" /> Buy Credits
            </button>
          </div>
        )}

        {/* Generated output */}
        {isDone && job?.content && (
          <GeneratedOutput
            content={job.content}
            onRegenerate={() => generateMutation.mutate()}
            isGenerating={generateMutation.isPending || isActive}
            quota={q}
            onBuyCredits={() => setShowBuyCredits(true)}
          />
        )}

        {/* Buy credits modal */}
        {showBuyCredits && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0f0f0f] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold text-white">Buy OS Tool Credits</h3>
                <button onClick={() => setShowBuyCredits(false)} className="text-white/40 hover:text-white/70 text-[20px] leading-none">×</button>
              </div>
              <p className="text-[13px] text-white/50 leading-relaxed">
                Credits power every OS tool. Once your free uses run out, each generation costs credits based on the tool's AI complexity.
              </p>
              <button
                onClick={() => { setShowBuyCredits(false); setLocation("/settings"); }}
                className="w-full py-3 rounded-xl text-[14px] font-bold text-black"
                style={{ background: GOLD }}
              >
                Buy Credits in Settings
              </button>
              <button onClick={() => setShowBuyCredits(false)} className="w-full py-2.5 text-[13px] text-white/40 hover:text-white/60">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
