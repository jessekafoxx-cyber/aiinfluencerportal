import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Sparkles, FileText, Users, Target, TrendingUp,
  Download, ChevronDown, ChevronUp, Loader2, CheckCircle2,
  AlertCircle, Clock, Zap, ArrowRight, FileDown, Lock, X,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import { stripCodeFences } from "@/lib/utils";

type Entitlement = {
  completedCount: number;
  freeRunsTotal: number;
  freeRunsRemaining: number;
  paidCredits: number;
  canGenerate: boolean;
  isAdmin: boolean;
  creditPriceCents: number;
};

const DOCS = [
  {
    key: "marketResearch",
    contentKey: "marketResearchContent",
    assetKey: "marketResearchAssetId",
    title: "Market Research Doc",
    subtitle: "Overview · Customer Pain Points · Research & Studies",
    icon: TrendingUp,
    color: "#C9A44C",
    progress: [8, 30],
  },
  {
    key: "anglesHooks",
    contentKey: "anglesHooksContent",
    assetKey: "anglesHooksAssetId",
    title: "Marketing Angles & Hooks",
    subtitle: "8 Angle Categories · Headlines · Video Hooks",
    icon: Zap,
    color: "#f59e0b",
    progress: [30, 55],
  },
  {
    key: "awarenessStages",
    contentKey: "awarenessStagesContent",
    assetKey: "awarenessStagesAssetId",
    title: "Market Awareness Stages",
    subtitle: "5 Stages (Schwartz) · Hooks per Stage · Bridge Messages",
    icon: Brain,
    color: "#8b5cf6",
    progress: [55, 78],
  },
  {
    key: "customerAvatars",
    contentKey: "customerAvatarsContent",
    assetKey: "customerAvatarsAssetId",
    title: "5 Customer Avatars",
    subtitle: "Deep Emotional Profiles · Fears · Desires · Objections",
    icon: Users,
    color: "#10b981",
    progress: [78, 100],
  },
];

const STORAGE_KEY = "research_job_id";
const POLL_INTERVAL = 3500;

function downloadAsWord(title: string, htmlContent: string) {
  const htmlDoc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name=ProgId content=Word.Document>
  <meta name=Generator content="Microsoft Word 15">
  <title>${title}</title>
  <style>
    body { font-family: 'Calibri', sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; max-width: 800px; margin: 40px auto; }
    h1 { font-size: 22pt; font-weight: bold; color: #1a1a1a; border-bottom: 2px solid #C9A44C; padding-bottom: 8px; margin-top: 24px; }
    h2 { font-size: 16pt; font-weight: bold; color: #1a1a1a; margin-top: 20px; }
    h3 { font-size: 13pt; font-weight: bold; color: #333; margin-top: 16px; }
    p { margin: 8px 0; }
    ul, ol { margin: 8px 0; padding-left: 24px; }
    li { margin: 4px 0; }
    strong { font-weight: bold; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${htmlContent}
</body>
</html>`;
  const blob = new Blob([htmlDoc], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, "_")}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAsPDF(title: string, htmlContent: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; padding: 32px 48px; }
    h1 { font-size: 20pt; font-weight: 700; border-bottom: 2px solid #C9A44C; padding-bottom: 8px; margin-top: 24px; }
    h2 { font-size: 14pt; font-weight: 700; margin-top: 20px; }
    h3 { font-size: 12pt; font-weight: 600; margin-top: 14px; color: #333; }
    p { margin: 6px 0; }
    ul, ol { padding-left: 22px; margin: 6px 0; }
    li { margin: 3px 0; }
    strong { font-weight: 600; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${htmlContent}
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function parseAvatarSections(html: string): { index: number; name: string; html: string }[] {
  if (typeof window === "undefined" || !html || !html.includes("data-avatar-index")) return [];
  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
    const sections = Array.from(doc.querySelectorAll("section[data-avatar-index]"));
    if (sections.length === 0) return [];
    return sections
      .map((s) => ({
        index: parseInt(s.getAttribute("data-avatar-index") || "0", 10) || 0,
        name: s.getAttribute("data-avatar-name") || `Avatar ${s.getAttribute("data-avatar-index")}`,
        html: s.innerHTML,
      }))
      .sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

function AvatarTabs({ content, color }: { content: string; color: string }) {
  const avatars = parseAvatarSections(content);
  const [active, setActive] = useState<number>(avatars[0]?.index ?? 1);
  if (avatars.length === 0) {
    return (
      <div
        className="prose-research text-white/80 text-[13px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: stripCodeFences(content) }}
      />
    );
  }
  const current = avatars.find((a) => a.index === active) || avatars[0];
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-white/[0.05]">
        {avatars.map((a) => {
          const isActive = a.index === current.index;
          return (
            <button
              key={a.index}
              onClick={() => setActive(a.index)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors"
              style={{
                background: isActive ? `${color}20` : "rgba(255,255,255,0.04)",
                color: isActive ? color : "rgba(255,255,255,0.55)",
                border: `1px solid ${isActive ? `${color}40` : "rgba(255,255,255,0.08)"}`,
              }}
            >
              Avatar {a.index}: {a.name}
            </button>
          );
        })}
      </div>
      <div
        className="prose-research text-white/80 text-[13px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: stripCodeFences(current.html) }}
      />
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  "tier1-primary": "Tier 1 (Peer-reviewed / .gov / .edu)",
  "tier2-major": "Tier 2 (Major analyst / top-tier news)",
  "tier3-supporting": "Tier 3 (Supporting)",
};

const CATEGORY_LABELS: Record<string, string> = {
  "academic-clinical": "Academic & Clinical",
  "analyst-business": "Analyst & Business",
  "latest-news": "Latest News",
  "market-sizing": "Market Sizing & Regulatory",
  "voice-of-customer": "Voice of Customer",
  "competitors": "Competitive Landscape",
};

function ResearchStatsPanel({ stats, color }: { stats: any; color: string }) {
  if (!stats) return null;
  const perDomain: Record<string, number> = stats.perDomain || {};
  const perTier: Record<string, number> = stats.perTier || {};
  const perCategory: Record<string, number> = stats.perCategory || {};
  const domainEntries = Object.entries(perDomain).sort((a, b) => b[1] - a[1]);
  const maxDomainCount = domainEntries.reduce((m, [, n]) => Math.max(m, n), 1);
  const totalUsable = stats.usable || 0;

  const Stat = ({ label, value }: { label: string; value: any }) => (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold"
        style={{ fontFamily: "var(--app-font-display)" }}>{label}</p>
      <p className="text-[16px] font-black text-white/85 mt-1">{value}</p>
    </div>
  );

  return (
    <div className="mb-5 rounded-xl border p-4"
      style={{ background: "rgba(245,181,0,0.04)", borderColor: "rgba(245,181,0,0.18)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,181,0,0.18)", color: "#f5b500", fontFamily: "var(--app-font-display)" }}>
          Admin Only
        </span>
        <span className="text-[12px] font-bold text-white/70 uppercase tracking-wider"
          style={{ fontFamily: "var(--app-font-display)" }}>
          Source Pipeline Stats
        </span>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
        <Stat label="Queries" value={stats.queriesPlanned ?? 0} />
        <Stat label="Searches" value={stats.searchesRun ?? 0} />
        <Stat label="Raw hits" value={stats.rawHits ?? 0} />
        <Stat label="Unique" value={stats.uniqueCandidates ?? 0} />
        <Stat label="Crawled" value={stats.crawled ?? 0} />
        <Stat label="Usable" value={stats.usable ?? 0} />
      </div>

      {Object.keys(perTier).length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2"
            style={{ fontFamily: "var(--app-font-display)" }}>
            Credibility Tier Mix
          </p>
          <div className="flex flex-wrap gap-2">
            {(["tier1-primary", "tier2-major", "tier3-supporting"] as const).map((t) => {
              const n = perTier[t] || 0;
              const pct = totalUsable > 0 ? Math.round((n / totalUsable) * 100) : 0;
              const tierColor = t === "tier1-primary" ? "#10b981" : t === "tier2-major" ? "#3b82f6" : "#8b5cf6";
              return (
                <div key={t} className="rounded-lg px-3 py-1.5 flex items-center gap-2"
                  style={{ background: `${tierColor}15`, border: `1px solid ${tierColor}30` }}>
                  <span className="text-[11px] font-bold" style={{ color: tierColor }}>{TIER_LABELS[t] || t}</span>
                  <span className="text-[11px] text-white/60">{n} <span className="text-white/55">({pct}%)</span></span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(perCategory).length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2"
            style={{ fontFamily: "var(--app-font-display)" }}>
            Category Breakdown
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(perCategory).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
              <span key={cat} className="rounded-md px-2 py-1 text-[11px] bg-white/[0.04] border border-white/[0.06] text-white/65">
                {CATEGORY_LABELS[cat] || cat}: <strong className="text-white/85">{n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {domainEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/50"
              style={{ fontFamily: "var(--app-font-display)" }}>
              Per-Domain Source Mix ({domainEntries.length} domains)
            </p>
            {domainEntries[0] && totalUsable > 0 && (domainEntries[0][1] / totalUsable) > 0.3 && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                ⚠ {domainEntries[0][0]} dominates ({Math.round((domainEntries[0][1] / totalUsable) * 100)}%)
              </span>
            )}
          </div>
          <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
            {domainEntries.map(([domain, n]) => {
              const widthPct = (n / maxDomainCount) * 100;
              const sharePct = totalUsable > 0 ? Math.round((n / totalUsable) * 100) : 0;
              return (
                <div key={domain} className="flex items-center gap-2 text-[11px]">
                  <span className="w-[180px] truncate text-white/70" title={domain}>{domain}</span>
                  <div className="flex-1 h-3 rounded-sm bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-sm"
                      style={{ width: `${widthPct}%`, background: color }} />
                  </div>
                  <span className="w-[64px] text-right text-white/50 tabular-nums">
                    {n} <span className="text-white/50">({sharePct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {typeof stats.totalChars === "number" && stats.totalChars > 0 && (
        <p className="text-[10px] text-white/55 mt-3">
          Total scraped content sent to LLM: {stats.totalChars.toLocaleString()} characters.
        </p>
      )}
    </div>
  );
}

function DocCard({ doc, job, isOpen, onToggle, isAdmin }: {
  doc: typeof DOCS[0]; job: any; isOpen: boolean; onToggle: () => void; isAdmin?: boolean;
}) {
  const Icon = doc.icon;
  const content = job?.[doc.contentKey];
  const jobProgress = job?.progress || 0;
  const docMin = doc.progress[0];
  const docMax = doc.progress[1];

  const isComplete = jobProgress >= docMax && !!content;
  const isGenerating = jobProgress >= docMin && jobProgress < docMax;
  const isPending = jobProgress < docMin;

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ borderColor: isComplete ? `${doc.color}30` : "rgba(255,255,255,0.06)" }}>
      <button
        className="w-full flex items-center gap-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
        onClick={onToggle}
        disabled={!isComplete}
      >
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: isComplete ? `${doc.color}18` : "rgba(255,255,255,0.04)" }}>
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: doc.color }} />
          ) : isComplete ? (
            <Icon className="w-4 h-4" style={{ color: doc.color }} />
          ) : (
            <Clock className="w-4 h-4 text-white/45" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-white uppercase tracking-wide"
              style={{ fontFamily: "var(--app-font-display)", opacity: isPending ? 0.35 : 1 }}>
              {doc.title}
            </span>
            {isComplete && (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: doc.color }} />
            )}
            {isGenerating && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                style={{ background: `${doc.color}18`, color: doc.color }}>
                Writing...
              </span>
            )}
          </div>
          <p className="text-[11px] text-white/55 mt-0.5">{doc.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isComplete && (
            <>
              <button
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                title="Download as Word"
                onClick={(e) => { e.stopPropagation(); downloadAsWord(doc.title, content); }}
              >
                <FileDown className="w-3.5 h-3.5 text-white/65 hover:text-white/70" />
              </button>
              <button
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                title="Download as PDF"
                onClick={(e) => { e.stopPropagation(); downloadAsPDF(doc.title, content); }}
              >
                <Download className="w-3.5 h-3.5 text-white/65 hover:text-white/70" />
              </button>
            </>
          )}
          {isComplete && (
            isOpen
              ? <ChevronUp className="w-4 h-4 text-white/55" />
              : <ChevronDown className="w-4 h-4 text-white/55" />
          )}
        </div>
      </button>

      {isOpen && isComplete && content && (
        <div className="border-t border-white/[0.05] p-5">
          {/* Download bar */}
          <div className="flex gap-2 mb-5 pb-4 border-b border-white/[0.05]">
            <button
              onClick={() => downloadAsWord(doc.title, content)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors"
              style={{ background: `${doc.color}15`, color: doc.color, border: `1px solid ${doc.color}25` }}
            >
              <FileDown className="w-3 h-3" />
              Download Word
            </button>
            <button
              onClick={() => downloadAsPDF(doc.title, content)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white/70 transition-colors"
            >
              <Download className="w-3 h-3" />
              Download PDF
            </button>
          </div>
          {/* Admin-only stats panel for market research */}
          {isAdmin && doc.key === "marketResearch" && job?.researchStats && (
            <ResearchStatsPanel stats={job.researchStats} color={doc.color} />
          )}
          {/* Rich content */}
          {doc.key === "customerAvatars" ? (
            <AvatarTabs content={content} color={doc.color} />
          ) : (
            <div
              className="prose-research text-white/80 text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: stripCodeFences(content) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function ResearchGeneration() {
  const [, setLocation] = useLocation();
  const [additionalContext, setAdditionalContext] = useState("");
  const [jobId, setJobId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored) : null;
  });
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallError, setPaywallError] = useState<string | null>(null);
  const [creditFlash, setCreditFlash] = useState<string | null>(null);
  const [creditConfirming, setCreditConfirming] = useState(false);
  const [redirectingToCheckout, setRedirectingToCheckout] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  const { data: entitlement, refetch: refetchEnt } = useQuery<Entitlement>({
    queryKey: ["research-entitlement"],
    queryFn: () => api.getResearchEntitlement(),
  });

  const { data: expertiseData } = useQuery({
    queryKey: ["expertise-profile"],
    queryFn: () => api.getExpertiseProfile(),
  });

  useEffect(() => {
    const ep = (expertiseData as any)?.profile;
    if (ep?.subNiche && !additionalContext) {
      const lines = [
        `Sub-niche from your Expertise Profile: ${ep.subNiche}`,
        ep.uniqueAngle ? `Unique angle: ${ep.uniqueAngle}` : null,
        ep.suggestedOfferDirection ? `Suggested offer direction: ${ep.suggestedOfferDirection}` : null,
      ].filter(Boolean);
      setAdditionalContext(lines.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertiseData]);

  const { data: latestJobData } = useQuery({
    queryKey: ["research-latest"],
    queryFn: () => api.getLatestResearchJob(),
    enabled: jobId === null,
  });

  const { data: jobData, refetch: refetchJob } = useQuery({
    queryKey: ["research-job", jobId],
    queryFn: () => api.getResearchJob(jobId!),
    enabled: jobId !== null,
  });

  const job = jobData?.job || latestJobData?.job || null;
  const isAdmin = (jobData as any)?.isAdmin ?? (latestJobData as any)?.isAdmin ?? entitlement?.isAdmin ?? false;
  const isActive = job && (job.status === "pending" || job.status === "processing");
  const isComplete = job?.status === "complete";
  const isError = job?.status === "error";

  // On mount, if we returned from Stripe Checkout, confirm the credit purchase.
  useEffect(() => {
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("credit_session_id");
    const cancelled = url.searchParams.get("credit_cancelled");
    if (cancelled) {
      url.searchParams.delete("credit_cancelled");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
      setCreditFlash("Payment was cancelled - no charge was made.");
      return;
    }
    if (!sid) return;
    setCreditConfirming(true);
    api.confirmResearchCredit(sid)
      .then((data: any) => {
        if (data?.granted) {
          setCreditFlash("Payment confirmed - you now have 1 regeneration credit available.");
        } else if (data?.alreadyGranted) {
          setCreditFlash("This credit has already been applied to your account.");
        }
        refetchEnt();
        queryClient.invalidateQueries({ queryKey: ["research-entitlement"] });
      })
      .catch((err: any) => {
        setCreditFlash(`Could not confirm payment: ${err?.message || "unknown error"}`);
      })
      .finally(() => {
        setCreditConfirming(false);
        url.searchParams.delete("credit_session_id");
        window.history.replaceState({}, "", url.pathname + (url.search || ""));
      });
  }, []);

  // Auto-open first completed doc when done
  useEffect(() => {
    if (isComplete && !openDoc) {
      setOpenDoc("marketResearch");
    }
  }, [isComplete]);

  // Poll when job is in progress
  useEffect(() => {
    if (isActive && jobId) {
      pollingRef.current = setInterval(() => { refetchJob(); }, POLL_INTERVAL);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [isActive, jobId, refetchJob]);

  // Persist job ID to localStorage
  useEffect(() => {
    if (jobId) localStorage.setItem(STORAGE_KEY, String(jobId));
  }, [jobId]);

  // Sync job ID from latest job if it's in progress
  useEffect(() => {
    if (!jobId && latestJobData?.job && (latestJobData.job.status === "pending" || latestJobData.job.status === "processing")) {
      setJobId(latestJobData.job.id);
    }
  }, [latestJobData, jobId]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const result = await api.startResearchGenerationRaw(additionalContext);
      if (result.ok) return result.body;
      const code = result.body?.code;
      const err: any = new Error(result.body?.error || `Failed (${result.status})`);
      err.status = result.status;
      err.code = code;
      err.entitlement = result.body?.entitlement;
      throw err;
    },
    onSuccess: (data: any) => {
      setJobId(data.jobId);
      localStorage.setItem(STORAGE_KEY, String(data.jobId));
      setTimeout(() => refetchJob(), 1000);
      refetchEnt();
    },
    onError: (err: any) => {
      if (err?.status === 402 && err?.code === "needs_credit") {
        setPaywallError(null);
        setPaywallOpen(true);
      }
    },
  });

  const handleStart = () => {
    // Client-side guard — if we know they're out of allowance, open paywall immediately
    if (entitlement && !entitlement.canGenerate) {
      setPaywallError(null);
      setPaywallOpen(true);
      return;
    }
    setJobId(null);
    setOpenDoc(null);
    startMutation.mutate();
  };

  const purchaseMutation = useMutation({
    mutationFn: () => api.purchaseResearchCredit(),
    onSuccess: (data: any) => {
      if (data?.url) {
        setRedirectingToCheckout(true);
        window.location.href = data.url;
      } else {
        setPaywallError("Could not start checkout — no URL returned.");
      }
    },
    onError: (err: any) => {
      setPaywallError(err?.message || "Could not start checkout.");
    },
  });

  const progress = job?.progress || 0;
  const progressLabel = job?.progressLabel || "";

  const hasAnyPreviousJob = !!job;
  const showForm = !isActive && !isComplete;

  return (
    <PortalLayout>
      <style>{`
        .prose-research h2 {
          font-size: 15px;
          font-weight: 700;
          color: #ffffff;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 24px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-family: var(--app-font-display);
        }
        .prose-research h3 {
          font-size: 13px;
          font-weight: 700;
          color: rgba(255,255,255,0.85);
          margin: 18px 0 8px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-family: var(--app-font-display);
        }
        .prose-research p {
          font-size: 13px;
          color: rgba(255,255,255,0.65);
          line-height: 1.75;
          margin: 6px 0;
        }
        .prose-research ul {
          padding-left: 18px;
          margin: 8px 0;
        }
        .prose-research li {
          font-size: 13px;
          color: rgba(255,255,255,0.60);
          line-height: 1.65;
          margin: 4px 0;
          list-style-type: disc;
        }
        .prose-research strong {
          color: rgba(255,255,255,0.90);
          font-weight: 600;
        }
        .prose-research ol {
          padding-left: 18px;
          margin: 8px 0;
        }
        .prose-research ol li {
          list-style-type: decimal;
        }
      `}</style>

      <div className={`${PORTAL_PAGE_CLASS} space-y-6`}>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}>
            Research Generation
          </h1>
          <p className="text-[14px] text-white/60 leading-relaxed mt-2">
            Four deep research documents — market research, awareness stages, customer avatars, and marketing angles — all built from your brain profile.
          </p>
        </div>

        {/* Credit confirmation flash */}
        {(creditFlash || creditConfirming) && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 flex items-start gap-3">
            {creditConfirming
              ? <Loader2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0 animate-spin" />
              : <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            }
            <p className="text-[13px] text-emerald-100/85 flex-1">
              {creditConfirming ? "Confirming your payment..." : creditFlash}
            </p>
            {!creditConfirming && (
              <button
                onClick={() => setCreditFlash(null)}
                className="text-emerald-300/60 hover:text-emerald-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Allowance / paid-credit chip — shown only after they've used at least one free run */}
        {entitlement && !entitlement.isAdmin && entitlement.completedCount >= entitlement.freeRunsTotal && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 flex items-center gap-3">
            <Lock className="w-4 h-4 text-amber-400/70 shrink-0" />
            <p className="text-[12px] text-white/55 leading-relaxed flex-1">
              You've used your <strong className="text-white/80">{entitlement.freeRunsTotal} free generations</strong>.
              {" "}
              {entitlement.paidCredits > 0
                ? <>You have <strong className="text-emerald-300">{entitlement.paidCredits} paid regeneration credit{entitlement.paidCredits === 1 ? "" : "s"}</strong> ready to use.</>
                : <>Each new regeneration costs $5 to cover the AI + scraping costs.</>
              }
            </p>
          </div>
        )}

        {/* What you'll get */}
        {showForm && (
          <div className="grid grid-cols-2 gap-2">
            {DOCS.map((doc) => {
              const Icon = doc.icon;
              return (
                <div key={doc.key} className="flex items-start gap-2.5 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${doc.color}15` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: doc.color }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-white uppercase tracking-wide"
                      style={{ fontFamily: "var(--app-font-display)" }}>{doc.title}</p>
                    <p className="text-[11px] text-white/55 mt-0.5">{doc.subtitle}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
            <div>
              <label className="block text-[12px] font-bold text-white/60 uppercase tracking-wider mb-2"
                style={{ fontFamily: "var(--app-font-display)" }}>
                Add any further context (optional)
              </label>
              <textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                rows={4}
                placeholder="Any specifics about your niche, offer, ideal customer, or anything you want the research to focus on... or leave blank and we'll use everything linked into Your Brain."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 text-[13px] text-white/80 placeholder-white/20 resize-none focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <Clock className="w-4 h-4 text-amber-400/70 mt-0.5 shrink-0" />
              <p className="text-[12px] text-white/45 leading-relaxed">
                <strong className="text-white/65">This will take 5–10 minutes.</strong> All four documents are generated in sequence using your brain profile. You can navigate away or close this tab — the generation continues in the background. Come back and your documents will be waiting.
              </p>
            </div>

            <button
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[13px] uppercase tracking-widest transition-all disabled:opacity-50"
              style={{
                fontFamily: "var(--app-font-display)",
                background: "linear-gradient(135deg, #C9A44C 0%, #B8902F 100%)",
                color: "#fff",
              }}
            >
              {startMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Starting Generation...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Generate My Research Docs</>
              )}
            </button>
          </div>
        )}

        {/* Progress State */}
        {isActive && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(201,164,76,0.12)" }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#C9A44C" }} />
              </div>
              <div>
                <p className="text-[14px] font-black text-white uppercase tracking-wide"
                  style={{ fontFamily: "var(--app-font-display)" }}>
                  Generating Your Research
                </p>
                <p className="text-[12px] text-white/65 mt-0.5">{progressLabel || "Processing..."}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[11px] text-white/55 uppercase tracking-wider">Progress</span>
                <span className="text-[11px] font-bold" style={{ color: "#C9A44C" }}>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #C9A44C, #ff6b8a)",
                  }}
                />
              </div>
            </div>

            {/* Doc status indicators */}
            <div className="grid grid-cols-2 gap-2">
              {DOCS.map((doc) => {
                const Icon = doc.icon;
                const docMin = doc.progress[0];
                const docMax = doc.progress[1];
                const docComplete = progress >= docMax;
                const docActive = progress >= docMin && progress < docMax;
                return (
                  <div key={doc.key}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: docComplete ? `${doc.color}0f` : docActive ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)" }}>
                    {docComplete
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: doc.color }} />
                      : docActive
                        ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: doc.color }} />
                        : <div className="w-3.5 h-3.5 shrink-0 rounded-full border border-white/10" />
                    }
                    <span className="text-[11px] uppercase tracking-wide font-bold"
                      style={{
                        fontFamily: "var(--app-font-display)",
                        color: docComplete ? doc.color : docActive ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)"
                      }}>
                      {doc.title}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-white/50 text-center">
              Generation continues in the background — safe to navigate away or close this tab.
            </p>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06]">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] font-bold text-amber-400 mb-1">Generation Failed</p>
              <p className="text-[12px] text-white/65">{job?.errorMessage || "An error occurred. Please try again."}</p>
            </div>
            <button onClick={handleStart}
              className="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
              Retry
            </button>
          </div>
        )}

        {/* Completed — show all 4 docs */}
        {isComplete && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" style={{ color: "#10b981" }} />
                <span className="text-[12px] font-bold text-white/60 uppercase tracking-wider"
                  style={{ fontFamily: "var(--app-font-display)" }}>
                  4 Research Documents Complete
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setLocation("/your-brain")}
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white/70 transition-colors"
                >
                  View in Brain
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  onClick={handleStart}
                  className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border text-white/50 hover:text-white/70 transition-colors"
                  style={{ borderColor: "rgba(255,255,255,0.08)" }}
                >
                  <Sparkles className="w-3 h-3" />
                  Regenerate
                </button>
              </div>
            </div>

            {DOCS.map((doc) => (
              <DocCard
                key={doc.key}
                doc={doc}
                job={job}
                isOpen={openDoc === doc.key}
                onToggle={() => setOpenDoc(openDoc === doc.key ? null : doc.key)}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        )}

        {/* Resume banner — job is still running and user returned */}
        {isActive && (
          <div className="text-center">
            <p className="text-[11px] text-white/50">
              You can safely navigate away. Return to this page to see your completed documents.
            </p>
          </div>
        )}
      </div>

      {/* Paywall modal */}
      {paywallOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
          onClick={() => !redirectingToCheckout && !purchaseMutation.isPending && setPaywallOpen(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-2xl border border-white/[0.08] p-6 md:p-7 relative"
            style={{ background: "linear-gradient(180deg, #1a1a1f 0%, #141418 100%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPaywallOpen(false)}
              className="absolute top-4 right-4 text-white/55 hover:text-white/60"
              disabled={redirectingToCheckout || purchaseMutation.isPending}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
              style={{ background: "rgba(245,181,0,0.12)" }}>
              <Lock className="w-5 h-5 text-amber-400" />
            </div>

            <h3 className="text-[20px] font-black uppercase tracking-wide text-white mb-2"
              style={{ fontFamily: "var(--app-font-display)" }}>
              Pay $5 to regenerate
            </h3>

            <p className="text-[13px] text-white/55 leading-relaxed mb-3">
              You've already used your <strong className="text-white/80">2 free runs</strong>. Each new regeneration scrapes <strong className="text-white/80">16+ live web sources</strong> via paid scraper APIs and runs multiple OpenAI calls to write the four full documents.
            </p>
            <p className="text-[13px] text-white/55 leading-relaxed mb-5">
              <strong className="text-white/80">This isn't us profiting</strong> — the $5 covers the AI and scraping credits this run will burn through. Pay once, get one full regeneration. To run again after that, pay again.
            </p>

            {paywallError && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 mb-4">
                <p className="text-[12px] text-amber-300">{paywallError}</p>
              </div>
            )}

            <button
              onClick={() => {
                setPaywallError(null);
                purchaseMutation.mutate();
              }}
              disabled={purchaseMutation.isPending || redirectingToCheckout}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[13px] uppercase tracking-widest transition-all disabled:opacity-50"
              style={{
                fontFamily: "var(--app-font-display)",
                background: "linear-gradient(135deg, #C9A44C 0%, #B8902F 100%)",
                color: "#fff",
              }}
            >
              {purchaseMutation.isPending || redirectingToCheckout ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Opening Secure Checkout...</>
              ) : (
                <>Pay $5 &amp; Regenerate</>
              )}
            </button>

            <button
              onClick={() => setPaywallOpen(false)}
              disabled={purchaseMutation.isPending || redirectingToCheckout}
              className="w-full mt-2 py-2 text-[11px] uppercase tracking-wider text-white/65 hover:text-white/60 transition-colors disabled:opacity-40"
            >
              Maybe later
            </button>

            <p className="text-[10px] text-white/50 text-center mt-4 leading-relaxed">
              Secure payment via Stripe. You'll be brought back here automatically.
            </p>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
