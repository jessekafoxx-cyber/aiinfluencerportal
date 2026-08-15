import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Brain, Download, ArrowLeft, Copy, Pencil, RefreshCw,
  ChevronRight,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import { useLocation } from "wouter";

const SLUG = "direct-offer-ad-generator";
const POLL_MS = 3000;
const GOLD = "#C9A44C";

// ─── Output Section ───────────────────────────────────────────────────────────

function GeneratedOutput({
  content,
  onRegenerate,
  isGenerating,
}: {
  content: string;
  onRegenerate: () => void;
  isGenerating: boolean;
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
    a.download = "direct-offer-ad-generator.doc";
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

  return (
    <div className="space-y-6">
      {/* Output header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-[13px] font-semibold text-white uppercase tracking-wide">
            Generated Direct Offer Ad Generator
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
          <button
            onClick={onRegenerate}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: GOLD, color: "#000" }}
          >
            {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Regenerate
          </button>
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
              .doag-output h2 { font-size: 13px; font-weight: 800; color: ${GOLD}; text-transform: uppercase; letter-spacing: 0.1em; margin: 28px 0 14px; padding-bottom: 6px; border-bottom: 1px solid rgba(201,164,76,0.2); }
              .doag-output h2:first-child { margin-top: 0; }
              .doag-output h3 { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.1em; margin: 20px 0 10px; }
              .doag-output p { font-size: 13.5px; color: rgba(255,255,255,0.75); line-height: 1.75; margin: 6px 0; }
              .doag-output p strong { color: rgba(255,255,255,0.95); font-weight: 700; }
              .doag-output ul, .doag-output ol { padding-left: 20px; margin: 8px 0; }
              .doag-output li { font-size: 13.5px; color: rgba(255,255,255,0.70); line-height: 1.75; margin: 5px 0; }
              .doag-output em { color: rgba(255,255,255,0.45); font-style: italic; }
              .doag-variant { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 18px 20px; margin: 12px 0; }
            `}</style>
            <div className="doag-output" dangerouslySetInnerHTML={{ __html: currentContent }} />
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
          Tell the AI exactly what to change. e.g. "Make the hooks more aggressive" or "Change the CTA to focus on speed."
          {" "}Tip: press Ctrl+Enter to submit. Refining counts as up to 80 seconds.
        </p>
        <textarea
          value={refinePrompt}
          onChange={e => setRefinePrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleRefine(); }}
          rows={3}
          placeholder="e.g. Make the hooks more fear-based. Add more specificity to the dollar figures in Body 1…"
          className="w-full px-3.5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 resize-none"
        />
        <div className="flex justify-end">
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

      {/* Footer note */}
      <p className="text-[11.5px] text-white/25 leading-relaxed text-center pb-4">
        This is your saved Direct Offer Ad Pack. Edit, refine with AI, or regenerate from scratch with a fresh brain snapshot.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DirectOfferAdGenerator() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: brainData } = useQuery({
    queryKey: ["brain-profile"],
    queryFn: () => api.getBrainProfile(),
  });

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
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "#10b98122" }}>
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white uppercase tracking-wide mb-1">
                Direct Offer Ad Generator
              </h1>
              <p className="text-[13px] text-white/45 leading-relaxed max-w-2xl">
                Generate a modular direct-response ad pack — 10 hooks, 3 bodies, 2 CTAs — built from your low-ticket
                offer, brain, and OS. Use it for the Direct Sales Campaign in Phase 5.
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/[0.05] border border-white/[0.08]" style={{ color: GOLD }}>
                  <Brain className="w-3 h-3" />
                  Brain Connector: AI Influencer Publishing / Prompt &amp; Build
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                  <RefreshCw className="w-3 h-3" /> Regenerate anytime
                </span>
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
                  ? "Your Brain is still generating — hang tight, you'll be able to generate your ad pack once it's ready."
                  : "Set up your Brain first. This tool uses your brain profile to tailor every hook, body, and CTA to your specific offer, audience, and transformation."}
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

        {/* How it works — only before first generation */}
        {!isDone && !isActive && !isFailed && (
          <div className="mb-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-white mb-1">How it works</h2>
              <p className="text-[13px] text-white/45 leading-relaxed">
                Click <strong className="text-white/70">Generate</strong> and the AI reads your Brain profile and saved offers to produce a complete,
                ready-to-record modular ad pack. No inputs required — it pulls everything from your OS.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "10 Hooks", desc: "Result-led, avatar, pain, authority, mechanism, speed, old-way, skill, tired-of, and tried-everything angles" },
                { label: "3 Bodies + 2 CTAs", desc: "3-step mechanism, destroy old models, and speed bodies — each paired with direct CTAs" },
                { label: "Best Combinations", desc: "Recording instructions and the top hook + body + CTA combos to film first" },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="text-[12px] font-semibold mb-1 text-emerald-400">{item.label}</p>
                  <p className="text-[11.5px] text-white/40 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
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
              <p className="text-[14px] font-semibold" style={{ color: GOLD }}>Building your ad pack…</p>
              <p className="text-[12px] mt-0.5" style={{ color: `${GOLD}88` }}>
                Quality output takes time. This typically takes 1–3 minutes — sometimes longer for complex builds. We won't rush it.
              </p>
              <p className="text-[12px] mt-1" style={{ color: `${GOLD}70` }}>
                Feel free to navigate away or close this tab — generation continues in the background.
              </p>
            </div>
          </div>
        )}

        {/* Generate button */}
        {!isDone && !isActive && (
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-[15px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-6"
            style={{ background: GOLD, color: "#000" }}
          >
            {generateMutation.isPending
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Starting…</>
              : <><Sparkles className="w-5 h-5" /> {isFailed ? "Try Again" : "Generate Direct Offer Ad Pack"}</>}
          </button>
        )}

        {/* Generated output */}
        {isDone && job?.content && (
          <GeneratedOutput
            content={job.content}
            onRegenerate={() => generateMutation.mutate()}
            isGenerating={generateMutation.isPending || isActive}
          />
        )}
      </div>
    </PortalLayout>
  );
}
