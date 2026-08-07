import { Search, ExternalLink, RefreshCw, Inbox, Play, ImageOff, Loader2, X, ChevronDown, Download, FileText, Maximize2, Layers, AlertTriangle, ChevronLeft, ChevronRight, Lightbulb, ArrowDownNarrowWide, Trash2, Settings } from "lucide-react";
import { AdminCookiesSettings } from "@/components/admin-cookies-panels";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AdResearchBoardItem, type FunnelsResearchBoardItem, type AdResearchBoardQuery, type SyncSession } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type TabKey = "ads" | "funnels";
type AdsSortMode = "default" | "newest";
// Page size matches the server default. Kept small (12) so first paint is
// fast even on a 200+ row board — pagination is server-side now and the
// previous "render hundreds of cards client-side" approach is gone.
const ADS_PAGE_SIZE = 12;

// Debounce free-text search so we aren't sending a request per keystroke.
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.length > 1 ? u.pathname : "";
    const full = `${host}${path}`;
    return full.length > 48 ? full.slice(0, 45) + "..." : full;
  } catch {
    return url.length > 48 ? url.slice(0, 45) + "..." : url;
  }
}

// Backend assigns "auto-<sha1>" rowKeys to sheet rows that don't have a
// human-authored ID in column A. That's an internal implementation detail -
// users should never see "auto" labels on cards. Render those rows with a
// clean sequential index (`#<id>`) using the row's serial primary key so
// every card on the board shows a consistent index-style title.
function displayRowKey(item: { rowKey: string; id: number }): string {
  if (!/^auto-[a-f0-9]+$/i.test(item.rowKey)) return item.rowKey;
  return `#${item.id}`;
}

// Some older rows have `mediaKind` null on the row but a valid
// `mediaContentType`. Derive the kind from the MIME type so the grid
// can still pick the correct render path (video tile vs image tile)
// instead of silently falling through to "Preview unavailable".
function deriveMediaKind(
  kind: "video" | "image" | null | undefined,
  contentType: string | null | undefined,
): "video" | "image" | null {
  if (kind === "video" || kind === "image") return kind;
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  return null;
}

function platformLabel(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("instagram")) return "Instagram";
    if (h.includes("facebook") || h.includes("fb.com")) return "Facebook";
    if (h.includes("youtube") || h.includes("youtu.be")) return "YouTube";
    if (h.includes("tiktok")) return "TikTok";
    if (h.includes("twitter") || h.includes("x.com")) return "X / Twitter";
    return h.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

export default function AdResearchBoard() {
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = (me?.user as any)?.role === "admin";
  const paid = !!(me?.user as any)?.bump2Paid || isAdmin;

  // Auto-collapse the sidebar the first time the user lands on the daily
  // research board this session. Lives here (not in PortalLayout) so the
  // collapse only fires once the lazy chunk has loaded and this page has
  // actually mounted - not while the Suspense fallback is on-screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SESSION_KEY = "apex-portal-board-autocollapsed";
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;
      window.sessionStorage.setItem(SESSION_KEY, "1");
      window.localStorage.setItem("apex-portal-sidebar-collapsed", "1");
      window.dispatchEvent(new Event("apex-portal-sidebar-collapsed-changed"));
    } catch {
      /* ignore storage failures */
    }
  }, []);

  return (
    <>
      {/* Header */}
        <div className="mb-7">
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Premium Add-On
          </p>
          <h1
            className="text-[30px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Daily Research Boards
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[700px]">
            Our live research board. Winning ads updated daily with notes on
            why they work so you can see what's converting right now and steal
            the structure for your own offers.
          </p>
        </div>

        {meLoading ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : !paid ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-[#C9A44C]/15 flex items-center justify-center mx-auto mb-5">
              <Search className="w-6 h-6 text-[#C9A44C]" />
            </div>
            <p className="text-[14px] text-white/60">
              You don't have access to this add-on yet. Use the sidebar to unlock it.
            </p>
          </div>
        ) : (
          <AdsTab isAdmin={isAdmin} />
        )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-colors ${
        active
          ? "bg-[#C9A44C]/20 text-[#C9A44C]"
          : "text-white/55 hover:text-white/85 hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

// Task #194: worker-offline banner. Renders only when the backend's
// queue-health snapshot reports `worker.isStale=true`, meaning the
// Media Worker has missed more than `staleThresholdSec` of heartbeats
// AND there are zero rows currently leased. We deliberately gate on
// both signals so the normal "queue is drained, nothing to process"
// state stays quiet - in that case the worker is alive and still
// emitting heartbeats so `isStale` is false. When the banner appears,
// no media is being processed and the operator needs to look at the
// Media Worker workflow.
function WorkerOfflineBanner({
  worker,
}: {
  worker: {
    lastSnapshotAt: string | null;
    ageSeconds: number | null;
    staleThresholdSec: number;
    activeLeases: number;
    isStale: boolean;
  } | undefined;
}) {
  if (!worker || !worker.isStale) return null;
  const ageLabel = worker.ageSeconds == null
    ? "no heartbeat ever recorded"
    : worker.ageSeconds >= 3600
      ? `${Math.floor(worker.ageSeconds / 3600)}h ${Math.floor((worker.ageSeconds % 3600) / 60)}m since last heartbeat`
      : worker.ageSeconds >= 60
        ? `${Math.floor(worker.ageSeconds / 60)}m ${worker.ageSeconds % 60}s since last heartbeat`
        : `${worker.ageSeconds}s since last heartbeat`;
  const thresholdMin = Math.round(worker.staleThresholdSec / 60);
  return (
    <div
      role="alert"
      className="bg-red-500/[0.08] border-2 border-red-500/50 rounded-2xl px-5 py-4 mb-4 flex items-start gap-3"
    >
      <div className="text-red-300 text-[20px] leading-none mt-0.5">⚠</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold uppercase tracking-wider text-red-200">
          Media Worker offline - no media is being processed
        </div>
        <div className="text-[11.5px] text-red-100/80 mt-1 leading-relaxed">
          The worker has not posted a heartbeat for longer than {thresholdMin} minute{thresholdMin === 1 ? "" : "s"}
          {" "}({ageLabel}) and has zero rows leased. Downloads, periodic processing, queue metrics,
          automation jobs, and the ad / funnels research syncs are all paused.
          Restart the <span className="font-mono text-red-100">Media Worker</span> workflow to recover.
        </div>
        {worker.lastSnapshotAt && (
          <div className="text-[10.5px] text-red-100/55 mt-1 font-mono">
            last heartbeat: {new Date(worker.lastSnapshotAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}

// Global dashboard mode: LIVE = scoped to the latest sync_session
// (current runtime only); HISTORICAL = rolling 24h aggregates from the
// queue-health snapshot. Defaults to LIVE so an operator sees the
// current sync session's outcomes first.
type DashboardMode = "live" | "historical" | "settings";

// Shared live-session query. Polls every 3s while the session is
// running and 15s otherwise.
function useLiveSyncSession(
  board: "ad-research" | "funnels-research",
  isAdmin: boolean,
) {
  return useQuery({
    queryKey: ["sync-session", board, "live"],
    queryFn:
      board === "ad-research"
        ? api.adminAdResearchBoardLiveSession
        : api.adminFunnelsResearchBoardLiveSession,
    enabled: isAdmin,
    refetchInterval: (q) => {
      const data = q.state.data as { session?: { status?: string } } | undefined;
      const running = data?.session?.status === "running";
      return running ? 3_000 : 15_000;
    },
  });
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
        active
          ? "bg-[#C9A44C]/15 text-[#C9A44C]"
          : "text-white/55 hover:text-white/85 hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

function DashboardModeBar({
  mode,
  onChange,
  sessionId,
  sessionStatus,
}: {
  mode: DashboardMode;
  onChange: (m: DashboardMode) => void;
  sessionId?: number | null;
  sessionStatus?: string | null;
}) {
  const liveLabel = sessionId
    ? `Live Session #${sessionId}${sessionStatus === "running" ? " - running" : ""}`
    : "Live Session (Current Runtime)";
  return (
    <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl mb-4 flex items-center gap-1 p-2 flex-wrap">
      <ModeButton active={mode === "live"} onClick={() => onChange("live")}>
        {liveLabel}
      </ModeButton>
      <ModeButton active={mode === "historical"} onClick={() => onChange("historical")}>
        Historical Analytics (Long-Term Trends)
      </ModeButton>
      <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wider px-2">
        {mode === "live"
          ? "current runtime - latest sync session only"
          : mode === "historical"
            ? "rolling 24h aggregates"
            : "session cookies for Apify scrapers"}
      </span>
      <ModeButton active={mode === "settings"} onClick={() => onChange("settings")}>
        <span className="inline-flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5" />
          Settings
        </span>
      </ModeButton>
    </div>
  );
}

// Session-scoped severity verdict used by the LIVE-mode top strip. Mirrors
// the runtime-aware state machine in course-portal: classifies by real
// workload signals (attempts, auth share, retries, escalations) instead of
// raw success-rate math, so an idle sync (0/0) renders as IDLE rather than
// being mis-flagged CRITICAL. successPct is null when no extraction was
// attempted; consumers must render "N/A" in that case.
type SessionState = "FAILED" | "RUNNING" | "IDLE" | "HEALTHY" | "PARTIAL" | "DEGRADED" | "CRITICAL";

interface LiveSessionSeverity {
  state: SessionState;
  label: string;
  description: string;
  cls: string;
  border: string;
  tint: string;
  pill: string;
  successPct: number | null;
  attempted: number;
}

function liveSessionSeverity(s: SyncSession | null): LiveSessionSeverity {
  if (!s) {
    return {
      state: "IDLE",
      label: "IDLE",
      description: "No sync session has run yet on this runtime",
      cls: "text-sky-300",
      border: "border-sky-500/30",
      tint: "bg-sky-500/[0.03]",
      pill: "bg-sky-500/15 text-sky-200 border-sky-500/40",
      successPct: null,
      attempted: 0,
    };
  }
  // Real extraction-attempt denominator: only rows the worker actually
  // tried to extract (successful + auth-blocked terminal). Pre-claim
  // filter rejections (invalidUrls) NEVER hit yt-dlp / Apify, so they
  // are not extraction attempts. Without this distinction, a sync that
  // filtered out 5 invalid URLs and queued 0 real extraction work would
  // render as "0% success rate -> CRITICAL" even though no extraction
  // was attempted at all.
  const attempted = s.successfulExtractions + s.authFailures;
  const successPct = attempted > 0 ? (s.successfulExtractions / attempted) * 100 : null;

  if (s.status === "failed") {
    return {
      state: "FAILED",
      label: "FAILED",
      description: "Session execution failed",
      cls: "text-red-400",
      border: "border-red-700/50",
      tint: "bg-red-900/[0.06]",
      pill: "bg-red-900/30 text-red-200 border-red-700/50",
      successPct,
      attempted,
    };
  }
  if (
    s.status === "completed" &&
    attempted === 0 &&
    s.retries === 0 &&
    s.escalations === 0
  ) {
    return {
      state: "IDLE",
      label: "IDLE",
      description: "No new extraction workload detected",
      cls: "text-sky-300",
      border: "border-sky-500/30",
      tint: "bg-sky-500/[0.03]",
      pill: "bg-sky-500/15 text-sky-200 border-sky-500/40",
      successPct: null,
      attempted,
    };
  }
  const authShare = attempted > 0 ? s.authFailures / attempted : 0;
  if (
    (successPct != null && successPct < 50) ||
    s.authFailures > 100 ||
    authShare > 0.5
  ) {
    return {
      state: "CRITICAL",
      label: "CRITICAL",
      description: "Systemic extraction/runtime instability",
      cls: "text-red-300",
      border: "border-red-500/40",
      tint: "bg-red-500/[0.04]",
      pill: "bg-red-500/15 text-red-200 border-red-500/40",
      successPct,
      attempted,
    };
  }
  if (
    (successPct != null && successPct < 80) ||
    s.authFailures > 20 ||
    s.escalations > 50
  ) {
    return {
      state: "DEGRADED",
      label: "DEGRADED",
      description: "Elevated extraction instability",
      cls: "text-orange-300",
      border: "border-orange-500/40",
      tint: "bg-orange-500/[0.04]",
      pill: "bg-orange-500/15 text-orange-200 border-orange-500/40",
      successPct,
      attempted,
    };
  }
  if (
    (successPct != null && successPct < 95) ||
    s.authFailures > 0 ||
    s.escalations > 0 ||
    s.deadContent > 0 ||
    s.invalidUrls > 0
  ) {
    return {
      state: "PARTIAL",
      label: "PARTIAL",
      description: "Recoverable extraction issues detected",
      cls: "text-yellow-300",
      border: "border-yellow-500/30",
      tint: "bg-yellow-500/[0.03]",
      pill: "bg-yellow-500/15 text-yellow-200 border-yellow-500/40",
      successPct,
      attempted,
    };
  }
  if (s.status === "running") {
    return {
      state: "RUNNING",
      label: "RUNNING",
      description: "Sync in progress",
      cls: "text-cyan-300",
      border: "border-cyan-500/30",
      tint: "bg-cyan-500/[0.03]",
      pill: "bg-cyan-500/15 text-cyan-200 border-cyan-500/40",
      successPct,
      attempted,
    };
  }
  return {
    state: "HEALTHY",
    label: "HEALTHY",
    description: "Extraction pipeline operating normally",
    cls: "text-emerald-300",
    border: "border-emerald-500/30",
    tint: "bg-emerald-500/[0.03]",
    pill: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
    successPct,
    attempted,
  };
}

// Task #152: admin-only top summary strip. Mode-aware:
//   LIVE       - scoped to the latest sync_session counters (current
//                runtime only). Mirrors the second image: LIVE / state /
//                session success / usable media / auth failures / retries
//                / escalations / recoveries / queue depth.
//   HISTORICAL - rolling 24h aggregates from the queue-health snapshot.
//                Same numbers as `QueueHealthPanel` so they always agree.
function OperationalSummaryStrip({
  data,
  loading,
  error,
  mode,
  liveSession,
  liveHealth,
}: {
  data: Awaited<ReturnType<typeof api.adminAdResearchBoardQueueHealth>> | undefined;
  loading: boolean;
  error: Error | null;
  mode: DashboardMode;
  liveSession: SyncSession | null;
  // Task #401: current-state-only health snapshot from /live-health.
  // Drives the LIVE severity badge so terminal failures and 24h
  // aggregates can never poison it.
  liveHealth: Awaited<ReturnType<typeof api.adminAdResearchBoardLiveHealth>> | undefined;
}) {
  if (mode === "live") {
    if (!liveSession) {
      return (
        <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-2.5 mb-4 text-[11px] text-white/55">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-white/45 mr-3">LIVE - SESSION</span>
          No sync session has run yet on this runtime. The next manual / scheduled sync will create one.
        </div>
      );
    }
    const s = liveSession;
    const sev = liveSessionSeverity(s);
    const successPct = sev.successPct;
    const successDisplay = successPct == null ? "N/A" : `${successPct.toFixed(1)}%`;
    const successColor = successPct == null
      ? "text-white/45"
      : successPct >= 90 ? "text-emerald-300" : successPct >= 70 ? "text-amber-300" : "text-red-300";
    const successHint = successPct == null
      ? `no extraction attempts in session #${s.id} (${s.rowsProcessed.toLocaleString()} rows processed)`
      : `${s.successfulExtractions.toLocaleString()} ok / ${sev.attempted.toLocaleString()} attempted - session #${s.id}`;
    const tiles: Array<[string, string, string, string]> = [
      ["session success", successDisplay, successColor, successHint],
      ["auth failures", s.authFailures.toLocaleString(),
        s.authFailures > 0 ? "text-orange-300" : "text-white/45",
        "auth-blocked rows in this session"],
      ["retries", s.retries.toLocaleString(),
        s.retries > 0 ? "text-amber-300" : "text-white/45",
        "retry attempts scheduled in this session"],
      ["escalations", s.escalations.toLocaleString(),
        s.escalations > 0 ? "text-amber-300" : "text-white/45",
        "yt-dlp -> Apify escalations in this session"],
      ["recoveries", s.recoveries.toLocaleString(),
        s.recoveries > 0 ? "text-emerald-300" : "text-white/45",
        "rows recovered after a recoverable failure in this session"],
      ["queue depth", s.queueDepth.toLocaleString(),
        s.queueDepth > 0 ? "text-white/85" : "text-white/45",
        "rows still queued at the latest session snapshot"],
    ];
    // Task #401: append a current-state severity badge sourced from
    // /live-health. Strictly reads current row state, never 24h
    // aggregates - so terminal/exhausted rows can never tip it.
    const lh = liveHealth;
    const lhSevLabel = lh ? lh.severity.toUpperCase() : null;
    const lhSevColor = lh
      ? (lh.severity === "critical" ? "text-red-300" : lh.severity === "warning" ? "text-amber-300" : "text-emerald-300")
      : null;
    return (
      <div className={`${sev.tint} border ${sev.border} rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2`}>
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-white/45" title="Live mode - scoped to latest sync_session">
          LIVE
        </span>
        {lh && lhSevLabel && (
          <span
            className="inline-flex items-baseline gap-1.5"
            title={`Current-state health: ${lh.pending} pending, ${lh.retryableFailures} retryable, ${lh.stuckDownloading} stuck. No 24h aggregates.`}
          >
            <span className="text-[9.5px] uppercase tracking-wider text-white/45">health</span>
            <span className={`text-[12.5px] font-bold ${lhSevColor}`}>{lhSevLabel}</span>
          </span>
        )}
        {tiles.map(([label, n, cls, hint]) => (
          <span key={label} className="inline-flex items-baseline gap-1.5" title={hint}>
            <span className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</span>
            <span className={`text-[12.5px] font-bold ${cls}`}>{n}</span>
          </span>
        ))}
        {lh && (
          <span
            className="inline-flex items-baseline gap-1.5"
            title={`Downloading rows whose lease expired >${lh.stuckThresholdMinutes}min ago (current state)`}
          >
            <span className="text-[9.5px] uppercase tracking-wider text-white/45">stuck</span>
            <span className={`text-[12.5px] font-bold ${lh.stuckDownloading > 0 ? "text-red-300" : "text-white/45"}`}>
              {lh.stuckDownloading.toLocaleString()}
            </span>
          </span>
        )}
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-2.5 mb-4 text-[11px] text-white/55">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-white/45 mr-3">HISTORICAL - 24H</span>
        Loading operational metrics...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-500/[0.06] border border-red-500/30 rounded-xl px-4 py-2.5 mb-4 text-[11px] text-red-300">
        Operational metrics unavailable: {error.message}
      </div>
    );
  }
  if (!data) return null;
  const successPct = data.outcomes.totalProcessed > 0
    ? (data.outcomes.successRateBp / 100)
    : null;
  const isCritical = (successPct != null && successPct < 70) || data.outcomes.authBlocked > 50;
  const isWarning = !isCritical && (
    (successPct != null && successPct < 90) ||
    data.outcomes.authBlocked > 0 ||
    data.outcomes.rateLimited > 0 ||
    data.outcomes.terminalFailures > 0
  );
  const border = isCritical
    ? "border-red-500/40"
    : isWarning ? "border-amber-500/40" : "border-white/[0.08]";
  const tint = isCritical
    ? "bg-red-500/[0.04]"
    : isWarning ? "bg-amber-500/[0.04]" : "bg-[#0a0a0a]";
  const successColor = successPct == null
    ? "text-white/45"
    : successPct >= 90 ? "text-emerald-300" : successPct >= 70 ? "text-amber-300" : "text-red-300";
  const sevLabel = isCritical ? "CRITICAL" : isWarning ? "DEGRADED" : "HEALTHY";
  const sevColor = isCritical
    ? "text-red-300"
    : isWarning ? "text-amber-300" : "text-emerald-300";
  const tiles: Array<[string, string, string, string]> = [
    ["success rate", successPct == null ? "-" : `${successPct.toFixed(1)}%`, successColor,
      `${data.outcomes.usableMedia.toLocaleString()} usable / ${data.outcomes.totalProcessed.toLocaleString()} processed`],
    ["terminal fail", data.outcomes.terminalFailures.toLocaleString(),
      data.outcomes.terminalFailures > 0 ? "text-red-300" : "text-white/45",
      "exhausted retries (24h scope, includes dismissed-with-failure)"],
    ["auth blocked", data.outcomes.authBlocked.toLocaleString(),
      data.outcomes.authBlocked > 0 ? "text-orange-300" : "text-white/45",
      "ig-login-required, fb-auth-wall, generic auth"],
    ["rate limited", data.outcomes.rateLimited.toLocaleString(),
      data.outcomes.rateLimited > 0 ? "text-yellow-300" : "text-white/45",
      "ig-rate-limited"],
    ["retrying", data.outcomes.retrying.toLocaleString(),
      data.outcomes.retrying > 0 ? "text-amber-300" : "text-white/45",
      "failed rows still under MAX_ATTEMPTS"],
    ["stuck", data.status.stuck.toLocaleString(),
      data.status.stuck > 0 ? "text-red-300" : "text-white/45",
      "downloading rows whose lease expired"],
  ];
  return (
    <div className={`${tint} border ${border} rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2`}>
      {tiles.map(([label, n, cls, hint]) => (
        <span key={label} className="inline-flex items-baseline gap-1.5" title={hint}>
          <span className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</span>
          <span className={`text-[12.5px] font-bold ${cls}`}>{n}</span>
        </span>
      ))}
    </div>
  );
}


// Task #137 (next-stage hardening): admin-only queue-health dashboard.
// Renders the snapshot returned by `getQueueHealth()` on the API. All
// data is server-aggregated; the panel only formats it for display.
function QueueHealthPanel({
  data,
  loading,
  error,
  onFilterByErrorClass,
}: {
  data: Awaited<ReturnType<typeof api.adminAdResearchBoardQueueHealth>> | undefined;
  loading: boolean;
  error: Error | null;
  onFilterByErrorClass?: (klass: string) => void;
}) {
  if (loading && !data) {
    return (
      <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-6 mb-4 text-[12px] text-white/55">
        Loading queue health...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-500/[0.06] border border-red-500/30 rounded-2xl p-6 mb-4 text-[12px] text-red-300">
        Queue health unavailable: {error.message}
      </div>
    );
  }
  if (!data) return null;
  const fmtMs = (n: number | null) => (n == null ? "-" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);
  const successPct = data.outcomes.totalProcessed > 0
    ? (data.outcomes.successRateBp / 100)
    : null;
  const stale = Date.now() - new Date(data.generatedAt).getTime() > 90_000;
  const isCritical = (successPct != null && successPct < 70) || data.outcomes.authBlocked > 50;
  const isWarning = !isCritical && (
    (successPct != null && successPct < 90) ||
    data.outcomes.authBlocked > 0 ||
    data.outcomes.rateLimited > 0 ||
    data.outcomes.terminalFailures > 0
  );
  const headerBorder = isCritical
    ? "border-red-500/40"
    : isWarning ? "border-amber-500/40" : "border-white/[0.08]";
  const headerTint = isCritical
    ? "bg-red-500/[0.04]"
    : isWarning ? "bg-amber-500/[0.04]" : "bg-[#0a0a0a]";
  const successColor = successPct == null
    ? "text-white/45"
    : successPct >= 90 ? "text-emerald-300" : successPct >= 70 ? "text-amber-300" : "text-red-300";
  // copy URL to clipboard with hidden-textarea fallback
  // so this works in non-secure contexts (the dashboard is on a
  // subdomain that may or may not have HTTPS depending on deploy stage).
  const copyToClipboard = (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
        return;
      }
    } catch { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* noop */ }
    document.body.removeChild(ta);
  };
  const platformChip: Record<string, string> = {
    ig: "bg-pink-500/[0.12] text-pink-300 border-pink-500/30",
    fb: "bg-blue-500/[0.12] text-blue-300 border-blue-500/30",
    yt: "bg-red-500/[0.12] text-red-300 border-red-500/30",
    other: "bg-white/[0.06] text-white/65 border-white/15",
  };
  const bucketChip: Record<string, string> = {
    auth: "bg-orange-500/[0.12] text-orange-300 border-orange-500/30",
    "rate-limit": "bg-yellow-500/[0.12] text-yellow-300 border-yellow-500/30",
    quota: "bg-fuchsia-500/[0.12] text-fuchsia-300 border-fuchsia-500/30",
    unavailable: "bg-sky-500/[0.12] text-sky-300 border-sky-500/30",
    dead: "bg-zinc-500/[0.18] text-zinc-300 border-zinc-500/40",
    retryable: "bg-violet-500/[0.12] text-violet-300 border-violet-500/30",
  };
  const statusPillLabel = isCritical ? "Critical" : isWarning ? "Warning" : "Healthy";
  const statusPillCls = isCritical
    ? "bg-red-500/15 text-red-200 border-red-500/40"
    : isWarning
      ? "bg-amber-500/15 text-amber-200 border-amber-500/40"
      : "bg-emerald-500/15 text-emerald-200 border-emerald-500/40";
  return (
    <div className={`${headerTint} border ${headerBorder} rounded-2xl p-5 mb-4 space-y-4`}>
      {/* Task #165: at-a-glance summary. Answers "is the queue healthy
          right now?" without requiring the operator to read internals. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${statusPillCls}`}>
          {statusPillLabel}
        </span>
        <div className="text-[10px] text-white/35">
          worker {data.workerId} - updated {new Date(data.generatedAt).toLocaleTimeString()}{stale ? " (stale)" : ""}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {([
          ["Success Rate", successPct == null ? "-" : `${successPct.toFixed(1)}%`, successColor],
          ["Pending", data.status.pending.toLocaleString(), "text-white/85"],
          ["Failed", data.outcomes.terminalFailures.toLocaleString(), data.outcomes.terminalFailures > 0 ? "text-red-300" : "text-white/85"],
          ["Stuck", data.status.stuck.toLocaleString(), data.status.stuck > 0 ? "text-red-300" : "text-white/85"],
          ["Retries", data.outcomes.retrying.toLocaleString(), data.outcomes.retrying > 0 ? "text-amber-300" : "text-white/85"],
          ["Processed", data.outcomes.totalProcessed.toLocaleString(), "text-white/85"],
        ] as Array<[string, string, string]>).map(([label, n, cls]) => (
          <div key={label} className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
            <div className={`text-[20px] font-bold ${cls} mt-1`}>{n}</div>
          </div>
        ))}
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-white/85 select-none border-t border-white/[0.06] pt-3">
          <span>Advanced Diagnostics</span>
          <span className="text-white/35 transition-transform inline-block group-open:rotate-90">▸</span>
        </summary>
        <div className="space-y-4 mt-4">
          {/* Task #165: throughput moved here so the default summary
              stays focused on a single health verdict. */}
          <div className="text-[10.5px] text-white/55 font-mono">
            throughput: {data.throughput.last1h}/h - {data.throughput.last24h}/24h
          </div>

          {/* Task #165 (parity): per-provider observability strip,
              ported from course-portal. */}
          {data.providers && (
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/65">
                  Provider Mix (since last snapshot)
                </div>
                <div className="text-[10px] text-white/35">
                  escalation recovery: {(data.providers.escalationRecoveryRate * 100).toFixed(0)}% ({data.providers.escalationRecovered}/{data.providers.escalationCount})
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                {([
                  ["apify success", data.providers.apifySuccess, "text-emerald-300", "rows persisted via Apify (IG/FB primary path)"],
                  ["yt-dlp success", data.providers.ytdlpSuccess, "text-blue-300", "rows persisted via yt-dlp (non-IG/FB fallback path)"],
                  ["escalations", data.providers.escalationCount, data.providers.escalationCount > 0 ? "text-amber-300" : "text-white/45", "yt-dlp hit an auth wall and escalated to Apify"],
                  ["recovered", data.providers.escalationRecovered, data.providers.escalationRecovered > 0 ? "text-emerald-300" : "text-white/45", "escalations that succeeded after Apify retry"],
                ] as Array<[string, number, string, string]>).map(([label, n, cls, hint]) => (
                  <div key={label} title={hint} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 cursor-help">
                    <div className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</div>
                    <div className={`text-[15px] font-bold ${n > 0 ? cls : "text-white/35"}`}>{n}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
        {([
          ["success rate", successPct == null ? "-" : `${successPct.toFixed(1)}%`, successColor, `${data.outcomes.usableMedia.toLocaleString()} usable / ${data.outcomes.totalProcessed.toLocaleString()} processed`],
          ["total processed", data.outcomes.totalProcessed.toLocaleString(), "text-white/85", "usable + failed + dismissed-with-failure"],
          ["retrying", data.outcomes.retrying.toLocaleString(), data.outcomes.retrying > 0 ? "text-amber-300" : "text-white/45", "failed rows still under MAX_ATTEMPTS"],
          ["terminal failures", data.outcomes.terminalFailures.toLocaleString(), data.outcomes.terminalFailures > 0 ? "text-red-300" : "text-white/45", "exhausted retries (24h scope)"],
          ["dismissed", data.outcomes.dismissedTotal.toLocaleString(), "text-white/55", "rows dismissed with a failure recorded"],
        ] as Array<[string, string, string, string]>).map(([label, n, cls, hint]) => (
          <div key={label} title={hint} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 cursor-help">
            <div className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</div>
            <div className={`text-[15px] font-bold ${cls}`}>{n}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[11px]">
        {([
          ["auth blocked", data.outcomes.authBlocked, "text-orange-300"],
          ["rate limited", data.outcomes.rateLimited, "text-yellow-300"],
          ["quota", data.outcomes.buckets.quota, "text-fuchsia-300"],
          ["unavailable", data.outcomes.buckets.unavailable, "text-sky-300"],
          ["dead", data.outcomes.buckets.dead, "text-zinc-300"],
          ["provider failures", data.outcomes.providerFailures, "text-violet-300"],
        ] as Array<[string, number, string]>).map(([label, n, cls]) => (
          <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
            <div className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</div>
            <div className={`text-[15px] font-bold ${n > 0 ? cls : "text-white/35"}`}>{n}</div>
          </div>
        ))}
      </div>

      {/* Task #366: source-sync block. Surfaces the gap between the
          source sheet's row count and what the board actually ingested,
          so an admin sees rows the sync silently dropped (empty link,
          rowKey collisions) without digging into logs. */}
      {data.sourceSync && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/65">
              Source Sync (last)
            </div>
            <div className="text-[10px] text-white/35">
              session #{data.sourceSync.sessionId} - {data.sourceSync.status}
              {data.sourceSync.completedAt
                ? ` - ${new Date(data.sourceSync.completedAt).toLocaleString()}`
                : ` - started ${new Date(data.sourceSync.startedAt).toLocaleString()}`}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {([
              ["rows fetched", data.sourceSync.rowsFetched, "text-white/85", "rows read from the source sheet"],
              ["rows processed", data.sourceSync.rowsProcessed, "text-emerald-300", "rows upserted into the board"],
              ["rows skipped", data.sourceSync.rowsSkipped, data.sourceSync.rowsSkipped > 0 ? "text-amber-300" : "text-white/45", "source rows silently dropped (empty link cell, rowKey collision)"],
            ] as Array<[string, number, string, string]>).map(([label, n, cls, hint]) => (
              <div key={label} title={hint} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 cursor-help">
                <div className="text-[9.5px] uppercase tracking-wider text-white/45">{label}</div>
                <div className={`text-[15px] font-bold ${cls}`}>{n.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy queue mechanics row, demoted but kept - operators still */}
      {/* want to see how many rows are physically in each pipeline state. */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-[10.5px]">
        {([
          ["ok", data.status.ok, "text-emerald-300/80"],
          ["pending", data.status.pending, "text-white/55"],
          ["downloading", data.status.downloading, "text-blue-300/80"],
          ["partial", data.status.partial, "text-amber-300/80"],
          ["stuck", data.status.stuck, data.status.stuck > 0 ? "text-red-300" : "text-white/35"],
        ] as Array<[string, number, string]>).map(([label, n, cls]) => (
          <div key={label} className="bg-white/[0.02] border border-white/[0.04] rounded px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-white/35">{label}</div>
            <div className={`text-[12px] font-semibold ${cls}`}>{n}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">Active Workers ({data.active.rows} rows leased)</div>
          {data.active.workers.length === 0 ? (
            <div className="text-[11px] text-white/35">No active workers</div>
          ) : (
            <div className="space-y-1">
              {data.active.workers.map((w) => (
                <div key={w.owner} className="flex items-center justify-between text-[11px] bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5 font-mono">
                  <span className="truncate text-white/65" title={w.owner}>{w.owner}</span>
                  <span className="text-white/55">{w.rows} rows - {w.oldestLeaseSecLeft != null ? `${w.oldestLeaseSecLeft}s left` : "-"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">Processing Latency (last 200, 24h)</div>
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5">
              <div className="text-[9px] uppercase text-white/45">avg</div>
              <div className="text-white/85 font-mono">{fmtMs(data.processingMs.avg)}</div>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5">
              <div className="text-[9px] uppercase text-white/45">p50</div>
              <div className="text-white/85 font-mono">{fmtMs(data.processingMs.p50)}</div>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5">
              <div className="text-[9px] uppercase text-white/45">p95</div>
              <div className="text-white/85 font-mono">{fmtMs(data.processingMs.p95)}</div>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5">
              <div className="text-[9px] uppercase text-white/45">max</div>
              <div className="text-white/85 font-mono">{fmtMs(data.processingMs.max)}</div>
            </div>
          </div>
          <div className="text-[10px] text-white/35 mt-1">sample size: {data.processingMs.count}</div>
        </div>
      </div>

      <div>
        <div
          className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2"
          title="Counts include dismissed failures. Clicking a chip filters the board to triageable (non-dismissed) rows, so the filtered list may be shorter than the chip count."
        >Failure Breakdown (24h) <span className="text-white/30 font-normal normal-case tracking-normal">- chip click filters to triageable rows</span></div>
        {Object.keys(data.errorClasses).length === 0 ? (
          <div className="text-[11px] text-white/35">No failures in last 24h</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.errorClasses)
              .sort((a, b) => b[1] - a[1])
              .map(([klass, n]) => {
                const bucket = (
                  klass === "ig-login-required" || klass === "fb-auth-wall" || klass === "auth" ? "auth" :
                  klass === "ig-rate-limited" ? "rate-limit" :
                  klass === "apify-quota-exceeded" ? "quota" :
                  klass === "unavailable-content" ? "unavailable" :
                  (klass === "dead-media" || klass === "http-416" || klass === "not-found") ? "dead" :
                  "retryable"
                );
                const interactive = !!onFilterByErrorClass;
                return (
                  <button
                    type="button"
                    key={klass}
                    onClick={interactive ? () => onFilterByErrorClass(klass) : undefined}
                    disabled={!interactive}
                    title={interactive ? `Filter board by ${klass}` : undefined}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10.5px] font-mono ${bucketChip[bucket]} ${interactive ? "cursor-pointer hover:brightness-125 transition" : ""}`}
                  >
                    {klass}: {n}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">Attempts Histogram</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.attemptsHistogram)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/[0.04] border border-white/[0.08] text-[10.5px] text-white/65 font-mono">
                {k}x: {n}
              </span>
            ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">Recent Failures (last 25)</div>
        {data.recentFailures.length === 0 ? (
          <div className="text-[11px] text-white/35">No recent failures</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(() => {
              const groups: Array<{ head: typeof data.recentFailures[number]; count: number }> = [];
              for (const f of data.recentFailures) {
                const last = groups[groups.length - 1];
                if (last && last.head.platform === f.platform && (last.head.mediaErrorClass || "other") === (f.mediaErrorClass || "other")) {
                  last.count += 1;
                } else {
                  groups.push({ head: f, count: 1 });
                }
              }
              return groups.map(({ head: f, count }) => (
                <div key={`${f.rowKey}-${count}`} className="flex items-center gap-2 text-[10.5px] bg-white/[0.02] border border-white/[0.05] rounded px-2 py-1.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded border font-mono text-[9.5px] uppercase shrink-0 ${platformChip[f.platform] || platformChip.other}`}>
                    {f.platform}
                  </span>
                  <span className={`inline-block px-1.5 py-0.5 rounded border font-mono text-[9.5px] shrink-0 ${bucketChip[f.bucket] || bucketChip.retryable}`}>
                    {f.mediaErrorClass || "other"}
                  </span>
                  {count > 1 && (
                    <span className="inline-block px-1.5 py-0.5 rounded font-mono text-[9.5px] shrink-0 bg-amber-500/[0.18] text-amber-200 border border-amber-500/40" title={`${count} consecutive ${f.platform}/${f.mediaErrorClass || "other"} failures`}>
                      x{count}
                    </span>
                  )}
                  <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-[9.5px] shrink-0 ${f.terminal ? "bg-red-500/[0.18] text-red-200 border border-red-500/40" : "bg-white/[0.06] text-white/65 border border-white/15"}`}>
                    {f.terminal ? `terminal ${f.attempts}x` : `${f.attempts}/${4}x`}
                  </span>
                  <a href={f.adLink} target="_blank" rel="noreferrer" className="text-white/45 hover:text-white/75 truncate shrink-0 max-w-[180px] font-mono" title={f.adLink}>
                    {f.rowKey}
                  </a>
                  <span className="text-white/55 truncate flex-1" title={f.mediaError || ""}>{f.mediaError || "-"}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(f.adLink)}
                    className="text-white/35 hover:text-white/85 shrink-0 px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30 text-[9.5px] uppercase tracking-wider"
                    title="Copy URL"
                  >
                    copy
                  </button>
                  <span className="text-white/35 shrink-0">{new Date(f.updatedAt).toLocaleTimeString()}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
        </div>
      </details>
    </div>
  );
}

function StatusBar({
  lastSyncedAt,
  lastSyncOk,
  isAdmin,
  syncing,
  onSync,
  syncError,
  extraButton,
}: {
  lastSyncedAt: string | null | undefined;
  lastSyncOk: boolean | null | undefined;
  isAdmin: boolean;
  syncing: boolean;
  onSync: () => void;
  syncError: string | null;
  extraButton?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 px-4 py-3 rounded-xl bg-[#0a0a0a] border border-white/[0.06]">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-[#C9A44C] shadow-[0_0_8px_#C9A44C]" />
          <div>
            <p className="text-[11px] text-white/40 uppercase tracking-[0.18em] font-bold">
              Last synced
            </p>
            <p className="text-[13px] text-white/80 font-medium">
              {formatRelative(lastSyncedAt)}
              {lastSyncOk === false && (
                <span className="ml-2 text-[12px] text-red-400">(last sync failed)</span>
              )}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {extraButton}
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#C9A44C]/15 hover:bg-[#C9A44C]/25 text-[#C9A44C] text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              title="Force a fresh sync from the Google Sheet (admin only)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing" : "Sync Now"}
            </button>
          </div>
        )}
      </div>
      {syncError && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[12px] text-red-300">
          {syncError}
        </div>
      )}
    </>
  );
}

// Task #371: simplified to a plain count of cards rendered on the
// board. The previous popover-based inventory breakdown was noisy and
// the "of N total" number (raw sheet rows) was misleading.

// Shared error card for the board /items endpoints. Surfaces the API's
// structured error code when present (so support can spot schema_drift /
// db_unavailable / query_failed without digging through logs) and offers
// an inline Retry button that re-runs the failed query without a full
// page refresh. See Task #512.
function BoardLoadError({ query }: { query: { error?: unknown; isFetching?: boolean; refetch: () => void } }) {
  const err = query.error as { code?: string; error?: string; message?: string } | undefined;
  const code =
    (err && typeof err === "object" && typeof err.code === "string" && err.code) ||
    undefined;
  const label = code ? ` (${code})` : "";
  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-8 text-center text-[13px] text-red-300">
      <p className="mb-3">
        Board failed to load{label}. Refresh, or contact support if it keeps happening.
      </p>
      <button
        type="button"
        onClick={() => query.refetch()}
        disabled={!!query.isFetching}
        className="inline-flex items-center justify-center px-4 py-1.5 rounded-md border border-red-400/40 text-[12px] text-red-100 hover:bg-red-500/10 disabled:opacity-50"
      >
        {query.isFetching ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
        <Inbox className="w-5 h-5 text-white/40" />
      </div>
      <p className="text-[14px] text-white/65 font-bold mb-1">{title}</p>
      <p className="text-[12.5px] text-white/45 max-w-[460px] mx-auto">{body}</p>
    </div>
  );
}

// ----------------------------------------------------------------
// Color tokens chosen to match the Google Sheet's conditional fill colors.
function awarenessPillClasses(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "solution aware") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
  if (v === "product aware")  return "bg-sky-500/15 text-sky-300 border-sky-500/25";
  if (v === "problem aware")  return "bg-amber-500/15 text-amber-300 border-amber-500/25";
  if (v === "unaware")        return "bg-rose-500/15 text-rose-300 border-rose-500/25";
  if (v === "most aware")     return "bg-violet-500/15 text-violet-300 border-violet-500/25";
  return "bg-white/[0.06] text-white/65 border-white/10";
}

function typePillClasses(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "video") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
  if (v === "image" || v === "static") return "bg-sky-500/15 text-sky-300 border-sky-500/25";
  if (v === "carousel") return "bg-amber-500/15 text-amber-300 border-amber-500/25";
  return "bg-white/[0.06] text-white/65 border-white/10";
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-[3px] rounded-md text-[10.5px] font-semibold uppercase tracking-[0.06em] border ${className}`}
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------------------
// ADS TAB: masonry grid with filters
// ----------------------------------------------------------------
function AdsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();

  // Filter / sort / pagination state — the source of truth for the URL we
  // ship to the server. Anything that affects the result set is part of
  // the React Query queryKey so the cache buckets pages correctly.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 250);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [awarenessFilter, setAwarenessFilter] = useState<Set<string>>(new Set());
  const [styleFilter, setStyleFilter] = useState<Set<string>>(new Set());
  const [mediaOnly, setMediaOnly] = useState(false);
  // Sort mode lets the user flip between the default sheet order and the
  // most recently added cards (using createdAt from the DB).
  const [sortMode, setSortMode] = useState<AdsSortMode>("default");
  // Admin-only "Needs Fixing" view: when true, the grid swaps to showing
  // ONLY rows whose media download failed, so admins can re-fetch them.
  const [showNeedsFixing, setShowNeedsFixing] = useState(false);
  // Build the query payload. Sets are converted to sorted arrays so the
  // queryKey is stable regardless of insertion order. `page` is intentionally
  // omitted - infinite scroll passes it through `pageParam` instead, so
  // changing filters discards the whole infinite cache and starts at page 1.
  const queryPayload: Omit<AdResearchBoardQuery, "page" | "pageSize"> = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: Array.from(typeFilter).sort(),
      awarenessStage: Array.from(awarenessFilter).sort(),
      style: Array.from(styleFilter).sort(),
      mediaOnly,
      sort: sortMode,
      view: isAdmin && showNeedsFixing ? "needsFixing" : "default",
    }),
    [debouncedSearch, typeFilter, awarenessFilter, styleFilter, mediaOnly, sortMode, isAdmin, showNeedsFixing],
  );

  // Infinite scroll: pages of ADS_PAGE_SIZE are fetched and concatenated as
  // the user scrolls. Switching any filter changes the queryKey, which
  // discards the existing pages and re-starts at page 1 automatically.
  const boardQuery = useInfiniteQuery({
    queryKey: ["ad-research-board", queryPayload],
    queryFn: ({ pageParam }) =>
      api.getAdResearchBoard({ ...queryPayload, page: pageParam, pageSize: ADS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < (lastPage.total ?? 0) ? allPages.length + 1 : undefined;
    },
    refetchOnWindowFocus: false,
    retry: 2,
    // Poll while anything is mid-download server-side so previews appear
    // without a manual refresh. Pending count is read off the freshest page.
    refetchInterval: (q) => {
      const pages = (q.state.data as { pages?: Array<{ counts?: { pending?: number } }> } | undefined)?.pages;
      const pending = pages?.[pages.length - 1]?.counts?.pending ?? 0;
      return pending > 0 ? 8_000 : false;
    },
  });

  const [syncError, setSyncError] = useState<string | null>(null);
  // Invalidate every page of the board (any queryKey starting with
  // ["ad-research-board"]) after a mutation so the user sees fresh
  // state regardless of which page they were on.
  const invalidateBoard = () =>
    qc.invalidateQueries({ queryKey: ["ad-research-board"] });
  const syncMutation = useMutation({
    mutationFn: api.syncAdResearchBoard,
    onSuccess: (data) => {
      if (!data.ok) { setSyncError(data.error || "Sync failed"); return; }
      setSyncError(null);
      invalidateBoard();
    },
    onError: (err: any) => setSyncError(err?.message || "Sync failed"),
  });
  const refetchMediaMutation = useMutation({
    mutationFn: api.adminProcessPendingMedia,
    onSuccess: () => invalidateBoard(),
  });
  const requeueFailedMutation = useMutation({
    mutationFn: api.adminRequeueFailedAdMedia,
    onSuccess: () => invalidateBoard(),
  });
  // Carousel-incomplete triage: one-click reset for rows whose carousels
  // silently downgraded to a single slide. Always available to admins —
  // we don't surface a count badge under server-side pagination because
  // computing it requires scanning all rows; the server reports the actual
  // count back when the button is clicked.
  const requeueCarouselMutation = useMutation({
    mutationFn: api.adminRequeueIncompleteCarousels,
    onSuccess: () => invalidateBoard(),
  });
  // Retry Partials: re-queues just the rows whose carousel finished but
  // came back with fewer slides than expected. Lighter-weight than the
  // full Fix Carousels reset; uses the same residential-proxy chain.
  const retryPartialsMutation = useMutation({
    mutationFn: api.adminRetryPartialCarousels,
    onSuccess: () => invalidateBoard(),
  });
  // Pipeline counts surface a small admin-only chip so we can see how the
  // queue is balanced (ok / failed / pending / hidden / partial) without
  // having to scrape the full items list.
  const pipelineCountsQuery = useQuery({
    queryKey: ["ad-research-board", "pipeline-counts"],
    queryFn: api.adminAdResearchBoardPipelineCounts,
    enabled: isAdmin,
    refetchInterval: 30_000,
  });
  // Task #137 (next-stage hardening): comprehensive queue health snapshot
  // for the admin dashboard panel. Polled every 10s while the panel is
  // visible. Cheap server-side (single set of indexed-COUNT/LIMIT-25
  // queries in parallel) so the polling cadence is safe.
  const [showQueueHealth, setShowQueueHealth] = useState(false);
  // Global dashboard mode (live vs historical). Defaults to live so the
  // operator sees current-runtime data first.
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("live");
  const liveSessionQuery = useLiveSyncSession("ad-research", isAdmin);
  const queueHealthQuery = useQuery({
    queryKey: ["ad-research-board", "queue-health"],
    queryFn: api.adminAdResearchBoardQueueHealth,
    // Only poll in HISTORICAL mode (LIVE mode reads from
    // liveSessionQuery instead). Saves a 10s poll while admins are
    // looking at live data.
    enabled: isAdmin && dashboardMode === "historical",
    refetchInterval: 10_000,
  });
  // Task #401: dedicated current-state health query that only runs in
  // LIVE mode. Severity here is a pure function of current row state -
  // pending depth, retryable failures (attempts<MAX), stuck downloads,
  // active sync session - and never touches queue_metrics or 24h
  // aggregates, so terminal `failed_permanent` rows cannot poison it.
  const liveHealthQuery = useQuery({
    queryKey: ["ad-research-board", "live-health"],
    queryFn: api.adminAdResearchBoardLiveHealth,
    enabled: isAdmin && dashboardMode === "live",
    refetchInterval: 10_000,
  });

  // Dismissible "How Greg finds his ad ideas" info panel. Persisted so it
  // does not nag the user after they have read it once.
  const [infoDismissed, setInfoDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("apex.adresearch.info.dismissed") === "1"; } catch { return false; }
  });
  const dismissInfo = () => {
    setInfoDismissed(true);
    try { window.localStorage.setItem("apex.adresearch.info.dismissed", "1"); } catch { /* ignore */ }
  };

  // Server-derived data. Items come from every page the user has scrolled
  // through so far; counts/facets are read from the freshest page so the
  // header stats stay accurate as the queue drains.
  const pages = boardQuery.data?.pages ?? [];
  const lastPage = pages[pages.length - 1];
  const firstPage = pages[0];
  const items: AdResearchBoardItem[] = useMemo(
    () => pages.flatMap((p) => p.items),
    [pages],
  );
  const allTypes = firstPage?.facets.types || [];
  const allAwareness = firstPage?.facets.awarenessStages || [];
  const allStyles = firstPage?.facets.styles || [];
  const counts = lastPage?.counts || {
    ok: 0,
    failed: 0,
    pending: 0,
    partial: 0,
    downloading: 0,
    invalid: 0,
    dismissed: 0,
    hidden: 0,
    missingObjectPath: 0,
    sourceRowsSkipped: 0,
  };
  // Task #401: badge mirrors the admin "Needs Fixing" filter exactly
  // (failed + partial + hiddenFromSheet, never dismissed). Falls back to
  // counts.failed so older API payloads keep working during rollout.
  const failedCount = counts.needsFixing ?? counts.failed;
  const total = firstPage?.total ?? 0;
  // Task #373: header counter renders "{loadedCount} of {total}" so it
  // matches the footer's "End of list · loaded of total". `total` is the
  // filtered/browsable inventory the grid actually shows; using
  // inventoryTotal here was misleading because users can never scroll
  // to that absolute COUNT(*).
  const loadedCount = items.length;
  const activeFilters = typeFilter.size + awarenessFilter.size + styleFilter.size + (mediaOnly ? 1 : 0);

  // Selected card opened in the detail modal. We store the id only and
  // re-derive from the latest items[] so the modal stays in sync as media
  // downloads complete (live status updates from the polling refetch).
  const [openId, setOpenId] = useState<number | null>(null);
  const openItem = openId == null ? null : items.find((it) => it.id === openId) || null;

  return (
    <>
      <StatusBar
        lastSyncedAt={firstPage?.lastSyncedAt}
        lastSyncOk={firstPage?.lastSyncOk}
        isAdmin={isAdmin}
        syncing={syncMutation.isPending}
        onSync={() => { setSyncError(null); syncMutation.mutate(); }}
        syncError={syncError}
        extraButton={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNeedsFixing((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-colors ${
                  showNeedsFixing
                    ? "bg-red-500/15 text-red-300 border-red-500/40"
                    : failedCount > 0
                      ? "bg-red-500/[0.06] text-red-300/85 border-red-500/25 hover:bg-red-500/12"
                      : "bg-white/[0.04] text-white/55 border-white/10"
                }`}
                title="Show only cards whose media download failed (admin only)"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {showNeedsFixing ? "Back to Board" : `Needs Fixing (${failedCount})`}
              </button>
              <button
                type="button"
                onClick={() => refetchMediaMutation.mutate()}
                disabled={refetchMediaMutation.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-white/75 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                title="Re-queue media downloads for any pending or failed rows (admin only)"
              >
                <Play className="w-3.5 h-3.5" />
                Process Media
              </button>
              {failedCount > 0 && (
                <button
                  type="button"
                  onClick={() => requeueFailedMutation.mutate()}
                  disabled={requeueFailedMutation.isPending}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                  title="Reset every failed row and retry with the full downloader fallback chain (admin only)"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${requeueFailedMutation.isPending ? "animate-spin" : ""}`} />
                  {requeueFailedMutation.isPending ? "Retrying" : `Retry Failed (${failedCount})`}
                </button>
              )}
              {/* Always available to admins under server-side pagination —
                  computing the incomplete-carousel count would require
                  scanning every row, so we let the server report the
                  number of rows actually requeued in the response. */}
              <button
                type="button"
                onClick={() => requeueCarouselMutation.mutate()}
                disabled={requeueCarouselMutation.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                title="Reset incomplete carousel rows and retry with the residential-proxy + secondary-actor chain (admin only)"
              >
                <Layers className={`w-3.5 h-3.5 ${requeueCarouselMutation.isPending ? "animate-spin" : ""}`} />
                {requeueCarouselMutation.isPending ? "Retrying" : "Fix Carousels"}
              </button>
              {/* Retry Partials - lighter-weight than Fix Carousels; only
                  re-queues rows that ended with fewer slides than expected. */}
              {(pipelineCountsQuery.data?.partialCarousels ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => retryPartialsMutation.mutate()}
                  disabled={retryPartialsMutation.isPending}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] hover:bg-amber-500/[0.12] text-amber-300/85 text-[11px] font-bold uppercase tracking-wider border border-amber-500/25 transition-colors disabled:opacity-50"
                  title="Retry just the rows whose carousel finished with fewer slides than expected (admin only)"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${retryPartialsMutation.isPending ? "animate-spin" : ""}`} />
                  {retryPartialsMutation.isPending ? "Retrying" : `Retry Partials (${pipelineCountsQuery.data?.partialCarousels ?? 0})`}
                </button>
              )}
              {/* Compact pipeline-counts chip. Read-only. */}
              {/* Task #152: legacy `ok/fail/pend/stuck/hidden` chip
                  removed. The OperationalSummaryStrip rendered below the
                  StatusBar surfaces operational outcomes from the same
                  queue-health snapshot the panel uses, so the strip and
                  panel can never disagree (the old chip reported only
                  queue.status.failed and falsely looked healthy while
                  scraping was critically degraded). */}
              {/* Task #137 (next-stage): toggle to expand the queue-health
                  dashboard panel below. Defaults to hidden so the page
                  isn't noisier for admins who don't need it.
                  Task #361: Queue Health is a historical-only view, so
                  hide the toggle entirely while in Live Session. The
                  showQueueHealth preference is preserved across mode
                  switches. */}
              {dashboardMode === "historical" && (
                <button
                  type="button"
                  onClick={() => setShowQueueHealth((v) => !v)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-colors ${
                    showQueueHealth
                      ? "bg-white/[0.08] text-white border-white/20"
                      : "bg-white/[0.03] text-white/55 border-white/10 hover:bg-white/[0.06]"
                  }`}
                  title="Show / hide queue health dashboard"
                >
                  {showQueueHealth ? "Hide Queue Health" : "Queue Health"}
                </button>
              )}
            </div>
          ) : null
        }
      />

      {isAdmin && (
        <WorkerOfflineBanner worker={queueHealthQuery.data?.worker} />
      )}

      {isAdmin && (
        <DashboardModeBar
          mode={dashboardMode}
          onChange={setDashboardMode}
          sessionId={liveSessionQuery.data?.session?.id ?? null}
          sessionStatus={liveSessionQuery.data?.session?.status ?? null}
        />
      )}

      {isAdmin && dashboardMode === "settings" && (
        <AdminCookiesSettings />
      )}

      {isAdmin && dashboardMode !== "settings" && (
        <OperationalSummaryStrip
          data={queueHealthQuery.data}
          loading={queueHealthQuery.isLoading}
          error={queueHealthQuery.error as Error | null}
          mode={dashboardMode}
          liveSession={liveSessionQuery.data?.session ?? null}
          liveHealth={liveHealthQuery.data}
        />
      )}

      {isAdmin && showQueueHealth && dashboardMode === "historical" && (
        <>
          <QueueHealthPanel
            data={queueHealthQuery.data}
            loading={queueHealthQuery.isLoading}
            error={queueHealthQuery.error as Error | null}
            onFilterByErrorClass={(klass) => {
              setSearch(klass);
              setShowNeedsFixing(true);
              if (typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        </>
      )}

      {boardQuery.isLoading && (
        <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-12 text-center text-[13px] text-white/45">
          Loading board...
        </div>
      )}
      {boardQuery.isError && (
        <BoardLoadError query={boardQuery} />
      )}
      {firstPage && total === 0 && activeFilters === 0 && !debouncedSearch && !showNeedsFixing && (
        <EmptyState
          title="No ads on the board yet"
          body="We are curating the first batch right now. New ads appear here automatically once they hit the master sheet."
        />
      )}

      {firstPage && (total > 0 || activeFilters > 0 || !!debouncedSearch || showNeedsFixing) && (
        <>
          {/* Greg's notes on how he sources ad ideas */}
          {!infoDismissed && (
            <div className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-[#C9A44C]/[0.08] via-[#C9A44C]/[0.04] to-transparent border border-[#C9A44C]/25 relative">
              <button
                type="button"
                onClick={dismissInfo}
                className="absolute top-3 right-3 w-7 h-7 inline-flex items-center justify-center rounded-md text-white/45 hover:text-white/85 hover:bg-white/[0.06] transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-3 pr-8">
                <div className="w-8 h-8 rounded-lg bg-[#C9A44C]/15 border border-[#C9A44C]/30 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-[#C9A44C]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[10.5px] text-[#C9A44C] uppercase tracking-[0.22em] font-bold mb-2"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    How we find our ad ideas
                  </p>
                  <ul className="space-y-2 text-[12.5px] leading-[1.55] text-white/75">
                    <li className="flex gap-2">
                      <span className="text-[#C9A44C]/70 select-none">1.</span>
                      <span>
                        We get most of our ad ideas by looking at organic content and then turning it into ads, taking the different aspects of what made it go viral or what made that work, because the same people watching ads are the same people watching content.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-[#C9A44C]/70 select-none">2.</span>
                      <span>
                        We also look at a lot of other industries and take notes, then pull angles and concepts from them. You can always see those in the notes element of each card.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Filter bar */}
          <div className="mb-5 p-3 rounded-2xl bg-[#0a0a0a] border border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ID, link, or notes..."
                  className="w-full pl-9 pr-9 py-2 bg-[#050505] border border-white/[0.06] rounded-lg text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/40"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <FilterDropdown
                label="Type"
                values={allTypes}
                selected={typeFilter}
                onChange={setTypeFilter}
                pillClass={(v) => typePillClasses(v)}
              />
              <FilterDropdown
                label="Awareness"
                values={allAwareness}
                selected={awarenessFilter}
                onChange={setAwarenessFilter}
                pillClass={(v) => awarenessPillClasses(v)}
              />
              <FilterDropdown
                label="Style"
                values={allStyles}
                selected={styleFilter}
                onChange={setStyleFilter}
                pillClass={() => "bg-[#C9A44C]/12 text-[#C9A44C] border-[#C9A44C]/30"}
              />

              <button
                type="button"
                onClick={() => setMediaOnly((v) => !v)}
                className={`px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-colors ${
                  mediaOnly
                    ? "bg-[#C9A44C]/20 text-[#C9A44C] border-[#C9A44C]/40"
                    : "bg-white/[0.03] text-white/60 border-white/10 hover:text-white/85"
                }`}
              >
                With Preview
              </button>

              <SortDropdown sortMode={sortMode} setSortMode={setSortMode} />

              <div className="ml-auto text-right">
                <span className="text-[11px] text-white/40 uppercase tracking-[0.16em] font-bold">
                  {loadedCount.toLocaleString()} of {total.toLocaleString()}
                </span>
                {(counts.pending > 0 || counts.failed > 0) && (
                  <div className="text-[11px] text-[#C9A44C]/80 normal-case tracking-normal font-semibold mt-0.5">
                    {counts.pending > 0 && `${counts.pending} processing`}
                    {counts.pending > 0 && counts.failed > 0 && " - "}
                    {counts.failed > 0 && `${counts.failed} need a retry`}
                  </div>
                )}
              </div>
              {activeFilters > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter(new Set());
                    setAwarenessFilter(new Set());
                    setStyleFilter(new Set());
                    setMediaOnly(false);
                  }}
                  className="text-[11px] text-white/45 hover:text-[#C9A44C] uppercase tracking-[0.14em] font-bold"
                >
                  Clear ({activeFilters})
                </button>
              )}
            </div>
          </div>

          {/* Masonry grid */}
          {total === 0 ? (
            <EmptyState
              title={showNeedsFixing ? "Nothing needs fixing" : "No ads match these filters"}
              body={
                showNeedsFixing
                  ? "Every row either downloaded successfully or has been dismissed."
                  : "Try clearing one of the filters above or broadening your search."
              }
            />
          ) : (
            <>
              <MasonryGrid
                items={items}
                onOpen={(it) => setOpenId(it.id)}
                isAdmin={isAdmin}
              />
              {/* Infinite scroll: an invisible sentinel near the bottom of
                  the grid asks React Query for the next page once it
                  enters the viewport. The user just keeps scrolling. */}
              <InfiniteScrollSentinel
                hasNextPage={boardQuery.hasNextPage}
                isFetchingNextPage={boardQuery.isFetchingNextPage}
                onLoadMore={() => boardQuery.fetchNextPage()}
                loaded={loadedCount}
                total={total}
              />
            </>
          )}
        </>
      )}

      <AdDetailModal
        item={openItem}
        isAdmin={isAdmin}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}


function FilterDropdown({
  label,
  values,
  selected,
  onChange,
  pillClass,
}: {
  label: string;
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  pillClass: (v: string) => string;
}) {
  if (values.length === 0) return null;
  const count = selected.size;
  const active = count > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-colors ${
            active
              ? "bg-[#C9A44C]/15 text-[#C9A44C] border-[#C9A44C]/40"
              : "bg-white/[0.03] text-white/65 border-white/10 hover:text-white/90"
          }`}
        >
          {label}
          {active && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#C9A44C]/30 text-[10px] text-[#C9A44C] tabular-nums">
              {count}
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] p-3 bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-xl"
      >
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-white/45 uppercase tracking-[0.2em] font-bold">
            {label}
          </p>
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="text-[10px] text-white/45 hover:text-[#C9A44C] uppercase tracking-[0.14em] font-bold"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-[260px] overflow-y-auto">
          {values.map((v) => {
            const on = selected.has(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(v)) next.delete(v);
                  else next.add(v);
                  onChange(next);
                }}
                className={`px-2 py-[3px] rounded-md text-[10.5px] font-semibold uppercase tracking-[0.06em] border transition-all ${
                  on
                    ? pillClass(v) + " ring-1 ring-[#C9A44C]/60"
                    : "bg-white/[0.03] text-white/55 border-white/10 hover:text-white/85"
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortDropdown({
  sortMode,
  setSortMode,
}: {
  sortMode: AdsSortMode;
  setSortMode: (m: AdsSortMode) => void;
}) {
  const active = sortMode !== "default";
  const label = sortMode === "newest" ? "Newest First" : "Sort";
  const options: { value: AdsSortMode; label: string; hint: string }[] = [
    { value: "default", label: "Default Order", hint: "Original order from the master sheet" },
    { value: "newest", label: "Most Recently Added", hint: "Newest cards first, by date added" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-colors ${
            active
              ? "bg-[#C9A44C]/15 text-[#C9A44C] border-[#C9A44C]/40"
              : "bg-white/[0.03] text-white/65 border-white/10 hover:text-white/90"
          }`}
          title="Sort the board"
        >
          <ArrowDownNarrowWide className="w-3.5 h-3.5" />
          {label}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[240px] p-2 bg-[#0a0a0a] border border-white/[0.08] rounded-xl shadow-xl"
      >
        {options.map((opt) => {
          const on = opt.value === sortMode;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSortMode(opt.value)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                on ? "bg-[#C9A44C]/15 text-[#C9A44C]" : "text-white/75 hover:bg-white/[0.05]"
              }`}
            >
              <p className="text-[12px] font-semibold">{opt.label}</p>
              <p className="text-[10.5px] text-white/45 mt-0.5">{opt.hint}</p>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// Tiny IntersectionObserver hook. Once the element has been within
// `rootMargin` of the viewport at least once we flip `inView` to true and
// keep it true forever - the network fetch we're gating on is one-shot,
// re-toggling it would just thrash the cache.
function useInView<T extends Element>(rootMargin: string = "600px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

// Sentinel rendered at the bottom of the masonry grid. When it scrolls
// into view we ask React Query for the next page; otherwise we just show
// either a "loading more" spinner or an "end of list" caption.
function InfiniteScrollSentinel({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  loaded,
  total,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  loaded: number;
  total: number;
}) {
  // Non-sticky observer: we want `inView` to drop back to false when the
  // sentinel scrolls out of view so the load-more effect only fires once
  // per scroll advance. The shared `useInView` hook is intentionally
  // one-shot for media tiles, which would auto-chain every page here.
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [inView, hasNextPage, isFetchingNextPage, onLoadMore]);
  return (
    <div ref={ref} className="mt-6 mb-2 flex flex-col items-center justify-center gap-2 py-6">
      {hasNextPage ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-white/50" />
          <span className="text-[10.5px] text-white/45 uppercase tracking-[0.18em] font-bold">
            Loading more
          </span>
        </>
      ) : loaded > 0 ? (
        <span className="text-[10.5px] text-white/35 uppercase tracking-[0.18em] font-bold">
          End of list &middot; {loaded} of {total}
        </span>
      ) : null}
    </div>
  );
}

function MasonryGrid({
  items,
  onOpen,
  isAdmin,
}: {
  items: AdResearchBoardItem[];
  onOpen: (item: AdResearchBoardItem) => void;
  isAdmin: boolean;
}) {
  // Defensive client-side dedupe by id. The server now adds a stable id
  // tiebreaker to ORDER BY so OFFSET pagination shouldn't return overlap,
  // but a sheet sync that lands between two page fetches can still shift
  // sortIndex and produce a duplicate. Drop those before rendering so the
  // user never sees the same card twice.
  const uniqueItems = useMemo(() => {
    const seen = new Set<number>();
    const out: AdResearchBoardItem[] = [];
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [items]);
  return (
    <div
      className="
        [column-fill:balance]
        columns-1
        sm:columns-2
        lg:columns-3
        2xl:columns-4
        gap-4
      "
    >
      {uniqueItems.map((it) => (
        <div key={it.id} className="mb-4 break-inside-avoid">
          <AdCard item={it} onOpen={() => onOpen(it)} isAdmin={isAdmin} />
        </div>
      ))}
    </div>
  );
}

function AdCard({
  item,
  onOpen,
  isAdmin,
}: {
  item: AdResearchBoardItem;
  onOpen: () => void;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const refetchMutation = useMutation({
    mutationFn: () => api.adminRefetchAdMedia(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ad-research-board"] }),
  });
  // Admin "Skip" — permanently dismiss a row that we know we'll never be
  // able to download (deleted Facebook share, dead Instagram link, etc).
  // Dismissed rows are excluded from the public board AND the failed
  // counter, which is what makes "Retry Failed (N)" actually go to zero.
  const dismissMutation = useMutation({
    mutationFn: () => api.adminDismissAdResearchBoardItem(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ad-research-board"] }),
  });
  const isFailed = item.mediaStatus === "failed";
  // Use a div+role=button so the card can legally contain block descendants
  // (img, p, div). Enter/Space activate, matching native button behavior.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open details for ${displayRowKey(item)}`}
      className="group block w-full text-left cursor-pointer bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-[#C9A44C]/40 hover:shadow-[0_0_0_1px_rgba(201,164,76,0.15)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A44C]/60"
    >
      {/* Media block */}
      <div className="relative">
        <MediaPreview item={item} />
        {/* Hover affordance */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/70 backdrop-blur text-[10px] font-bold uppercase tracking-[0.14em] text-white">
            <Maximize2 className="w-3 h-3" /> View
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[13px] font-bold tracking-[0.04em] text-[#C9A44C]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {displayRowKey(item)}
          </span>
          <div className="flex items-center gap-2">
            <SlideCountChip item={item} />

            <span
              className="text-[10px] text-white/40 uppercase tracking-[0.14em] font-bold"
              title={`Added ${new Date(item.createdAt).toLocaleString()}`}
            >
              {formatRelative(item.createdAt)}
            </span>
          </div>
        </div>

        {(item.type || item.awarenessStage || item.style) && (
          <div className="flex flex-wrap gap-1.5">
            {item.type && item.type.trim() && (
              <Pill className={typePillClasses(item.type)}>{item.type}</Pill>
            )}
            {item.awarenessStage && item.awarenessStage.trim() && (
              <Pill className={awarenessPillClasses(item.awarenessStage)}>
                {item.awarenessStage}
              </Pill>
            )}
            {item.style && item.style.trim() && (
              <Pill className="bg-[#C9A44C]/12 text-[#C9A44C] border-[#C9A44C]/25">
                {item.style}
              </Pill>
            )}
          </div>
        )}

        {item.notes && item.notes.trim() ? (
          <div className="pt-2 border-t border-white/[0.05]">
            <p className="text-[10px] text-[#C9A44C]/80 uppercase tracking-[0.18em] font-bold mb-1.5">
              Research Notes
            </p>
            <p className="text-[13px] text-white/80 leading-[1.55] whitespace-pre-wrap line-clamp-4">
              {item.notes}
            </p>
          </div>
        ) : (
          <p className="pt-2 border-t border-white/[0.05] text-[11.5px] text-white/35 italic">
            No notes yet
          </p>
        )}

        {isAdmin && isFailed && (
          <div className="pt-2 border-t border-red-500/20 space-y-2">
            <p className="text-[10px] text-red-300 uppercase tracking-[0.18em] font-bold inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Media download failed
            </p>
            {item.mediaError && (
              <p className="text-[11px] text-red-300/70 leading-[1.45] line-clamp-3">
                {item.mediaError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); refetchMutation.mutate(); }}
                disabled={refetchMutation.isPending || dismissMutation.isPending}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#C9A44C]/40 text-[#C9A44C] text-[10.5px] font-bold uppercase tracking-[0.14em] hover:bg-[#C9A44C]/10 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${refetchMutation.isPending ? "animate-spin" : ""}`} />
                Re-fetch
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(); }}
                disabled={refetchMutation.isPending || dismissMutation.isPending}
                title="Permanently skip this row"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/15 text-white/65 text-[10.5px] font-bold uppercase tracking-[0.14em] hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// "X / Y slides" badge. For carousels we render expected vs captured so the
// admin team can spot rows where the downloader couldn't grab every slide.
// Non-carousel rows render nothing — a single image / video doesn't need a
// slide count badge.
function SlideCountChip({ item }: { item: AdResearchBoardItem }) {
  const meta = item.mediaMeta || null;
  const captured =
    meta?.capturedSlides ??
    (item.mediaItems ? item.mediaItems.length : 0);
  const expectedRaw = meta?.expectedSlides ?? captured;
  const isCarousel = meta?.isCarousel === true || captured > 1 || expectedRaw > 1;
  if (!isCarousel) return null;
  // Treat any expected ≥ captured as the source of truth, but never show
  // less than the actual captured count.
  const expected = Math.max(expectedRaw, captured, 1);
  const incomplete = captured > 0 && captured < expected;
  const empty = captured === 0;
  const cls = empty
    ? "text-red-300 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded"
    : incomplete
      ? "text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded"
      : "text-white/55";
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.16em] font-bold inline-flex items-center gap-1 ${cls}`}
      title={
        incomplete
          ? `Only captured ${captured} of ${expected} carousel slides`
          : empty
            ? `Carousel: 0 of ${expected} slides captured`
            : `${captured} carousel slides`
      }
    >
      <Layers className="w-3 h-3" />
      {expected > 0 && expected !== captured ? `${captured} / ${expected} slides` : `${captured} slides`}
    </span>
  );
}

// ----------------------------------------------------------------
// Card detail modal: bigger preview, full notes, all metadata, and
// the actions a user actually wants (open original, refetch).
// ----------------------------------------------------------------
function AdDetailModal({
  item,
  isAdmin,
  onClose,
}: {
  item: AdResearchBoardItem | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Both mutations are only triggered from buttons rendered inside the
  // `{item && (...)}` block below, so item is guaranteed to be non-null
  // at call time. We assert that with a thrown error rather than a
  // `null as any` cast so the types stay honest.
  const refetchMutation = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("No item selected");
      return api.adminRefetchAdMedia(item.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ad-research-board"] }),
  });
  // Modal admin "Skip" — same idea as the per-card button, but available
  // here too so an admin can triage a card from inside the detail view.
  // Closes the modal on success so the user sees the card disappear.
  const dismissMutation = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("No item selected");
      return api.adminDismissAdResearchBoardItem(item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-research-board"] });
      onClose();
    },
  });
  // Unhide: surfaces a previously sheet-removed row back to users without
  // waiting for the sheet to re-add it. Only meaningful when the row was
  // hidden by the non-destructive sync; otherwise it's a no-op.
  const unhideMutation = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("No item selected");
      return api.adminUnhideAdResearchBoardItem(item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-research-board"] });
    },
  });

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-[min(96vw,1100px)] w-[min(96vw,1100px)] p-0 overflow-hidden bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-h-[92vh]"
      >
        <DialogTitle className="sr-only">{item ? displayRowKey(item) : "Ad detail"}</DialogTitle>
        <DialogDescription className="sr-only">
          Larger preview and notes for this ad.
        </DialogDescription>
        {item && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-h-[92vh]">
            {/* Big preview pane */}
            <div className="bg-black flex items-center justify-center min-h-[320px] md:min-h-[560px] max-h-[92vh] overflow-hidden">
              <ModalMediaPreview item={item} />
            </div>

            {/* Detail pane */}
            <div className="flex flex-col max-h-[92vh]">
              <div className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
                <div className="min-w-0">
                  <p
                    className="text-[16px] font-bold uppercase tracking-[0.04em] text-[#C9A44C]"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {displayRowKey(item)}
                  </p>
                  <p className="text-[10.5px] text-white/45 uppercase tracking-[0.18em] font-bold mt-0.5">
                    {platformLabel(item.adLink)}
                  </p>
                  <div className="mt-1.5">
                    <SlideCountChip item={item} />
                  </div>
                </div>
                {/* Built-in DialogContent already renders a close X in the top
                    right; no custom button here. Right padding leaves room for
                    the built-in X so the title doesn't sit underneath it. */}
                <div className="shrink-0 w-8 h-8" aria-hidden />
              </div>

              <div className="overflow-y-auto p-5 space-y-5">
                {(item.type || item.awarenessStage || item.style) && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.type && item.type.trim() && (
                      <Pill className={typePillClasses(item.type)}>{item.type}</Pill>
                    )}
                    {item.awarenessStage && item.awarenessStage.trim() && (
                      <Pill className={awarenessPillClasses(item.awarenessStage)}>
                        {item.awarenessStage}
                      </Pill>
                    )}
                    {item.style && item.style.trim() && (
                      <Pill className="bg-[#C9A44C]/12 text-[#C9A44C] border-[#C9A44C]/25">
                        {item.style}
                      </Pill>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[10px] text-[#C9A44C]/85 uppercase tracking-[0.18em] font-bold mb-2">
                    Research Notes
                  </p>
                  {item.notes && item.notes.trim() ? (
                    <p className="text-[14px] text-white/85 leading-[1.65] whitespace-pre-wrap">
                      {item.notes}
                    </p>
                  ) : (
                    <p className="text-[13px] text-white/40 italic">
                      No notes yet for this ad.
                    </p>
                  )}
                </div>

                {isAdmin && (
                  <div className="pt-2 border-t border-white/[0.06] text-[11px] text-white/40 uppercase tracking-[0.16em] font-bold">
                    Status:{" "}
                    <span className="text-white/65">
                      {item.mediaStatus === "ok" ? "Cached" :
                       item.mediaStatus === "failed" ? "Failed" :
                       item.mediaStatus === "pending" ? "Downloading" : "Queued"}
                    </span>
                    {item.mediaStatus === "failed" && item.mediaError && (
                      <p className="mt-2 text-[11px] text-red-300/80 normal-case tracking-normal font-normal">
                        {item.mediaError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="border-t border-white/[0.06] p-4 flex flex-wrap items-center gap-2">
                  {item.hiddenFromSheet && (
                    <button
                      type="button"
                      onClick={() => unhideMutation.mutate()}
                      disabled={unhideMutation.isPending || refetchMutation.isPending || dismissMutation.isPending}
                      title="This row was removed from the master sheet but kept here because it has cached media. Unhide to surface it back to users."
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-400/40 text-amber-300 text-[12px] font-bold uppercase tracking-[0.14em] hover:bg-amber-400/10 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${unhideMutation.isPending ? "animate-spin" : ""}`} />
                      {unhideMutation.isPending ? "Unhiding..." : "Unhide Row"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => refetchMutation.mutate()}
                    disabled={refetchMutation.isPending || dismissMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#C9A44C]/35 text-[#C9A44C] text-[12px] font-bold uppercase tracking-[0.14em] hover:bg-[#C9A44C]/10 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refetchMutation.isPending ? "animate-spin" : ""}`} />
                    Re-fetch Media
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissMutation.mutate()}
                    disabled={refetchMutation.isPending || dismissMutation.isPending}
                    title="Permanently skip this row"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/15 text-white/70 text-[12px] font-bold uppercase tracking-[0.14em] hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {dismissMutation.isPending ? "Skipping…" : "Skip"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Modal-sized preview: shows a carousel gallery when the row has multiple
// downloaded slides, otherwise a single video / image. Falls back to a
// loading state while media is still being downloaded.
function ModalMediaPreview({ item }: { item: AdResearchBoardItem }) {
  // Build the gallery list. Prefer mediaItems[] (carousel), fall back to the
  // single mediaObjectPath shape so older rows still render.
  const slides = useMemo(() => {
    if (item.mediaItems && item.mediaItems.length > 0) {
      return item.mediaItems.map((m) => ({
        kind: m.kind,
        src: `/api/storage${m.objectPath}`,
        contentType: m.contentType,
      }));
    }
    if (item.mediaStatus === "ok" && item.mediaObjectPath) {
      return [{
        kind: (item.mediaKind || "image") as "image" | "video",
        src: `/api/storage${item.mediaObjectPath}`,
        contentType: item.mediaContentType || "application/octet-stream",
      }];
    }
    return [];
  }, [item.mediaItems, item.mediaObjectPath, item.mediaKind, item.mediaContentType, item.mediaStatus]);

  const [idx, setIdx] = useState(0);
  // Reset to first slide when the user opens a different card.
  useEffect(() => { setIdx(0); }, [item.id]);

  if (slides.length > 0) {
    const safeIdx = Math.min(idx, slides.length - 1);
    const slide = slides[safeIdx];
    const hasMultiple = slides.length > 1;
    // Preload the next and previous slide so swipes feel instant instead
    // of stalling on a fresh fetch each time. We render hidden <link
    // rel="preload"> equivalents via tiny off-screen <img>/preload videos.
    const neighbors = hasMultiple
      ? [
          slides[(safeIdx + 1) % slides.length],
          slides[(safeIdx - 1 + slides.length) % slides.length],
        ]
      : [];
    // Resolve the slide kind defensively — some legacy mediaItems entries
    // were saved without `kind` and we don't want a video to render as an
    // <img> tag (or vice versa, which is what causes the "carousel hangs"
    // symptom: an <img> trying to decode an mp4 just stalls forever).
    const slideKind = deriveMediaKind(
      slide.kind as "video" | "image" | null,
      slide.contentType,
    ) || "image";
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-black">
        {slideKind === "video" ? (
          // Audio fix (Task #318): no autoPlay. Browser autoplay policies
          // either block playback outright or force-mute it, which is what
          // produced the "videos play silently" symptom. With autoplay
          // removed, the user clicks the controls play button (a real user
          // gesture) and the browser plays with audio. muted={false} is
          // explicit so future edits don't accidentally re-enable autoplay
          // without addressing audio at the same time.
          <video
            key={slide.src}
            src={slide.src}
            controls
            playsInline
            muted={false}
            preload="metadata"
            className="w-full h-full max-h-[92vh] object-contain bg-black"
          />
        ) : (
          <img
            key={slide.src}
            src={slide.src}
            alt={`${displayRowKey(item)} slide ${safeIdx + 1}`}
            className="w-full h-full max-h-[92vh] object-contain bg-black"
          />
        )}
        {/* Hidden neighbour preloaders. Image slides preload via a tiny
            off-screen <img>; video slides preload metadata via a hidden
            <video> with preload="metadata". Both stop the modal from
            stalling when the user clicks Next/Prev. */}
        {neighbors.map((n, i) => {
          const nKind = deriveMediaKind(
            n.kind as "video" | "image" | null,
            n.contentType,
          ) || "image";
          return nKind === "image" ? (
            <img
              key={`pre-${i}-${n.src}`}
              src={n.src}
              alt=""
              aria-hidden
              className="absolute opacity-0 pointer-events-none w-px h-px"
            />
          ) : (
            <video
              key={`pre-${i}-${n.src}`}
              src={n.src}
              preload="metadata"
              muted
              playsInline
              aria-hidden
              tabIndex={-1}
              className="absolute opacity-0 pointer-events-none w-px h-px"
            />
          );
        })}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + slides.length) % slides.length); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white inline-flex items-center justify-center"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % slides.length); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white inline-flex items-center justify-center"
              aria-label="Next slide"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <div className="absolute top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur text-white/90 text-[11px] font-bold uppercase tracking-[0.16em]">
              <Layers className="w-3 h-3" />
              {safeIdx + 1} / {slides.length}
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setIdx(i); }}
                  aria-label={`Go to slide ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === safeIdx ? "bg-[#C9A44C]" : "bg-white/35 hover:bg-white/60"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (item.mediaStatus === "pending" || item.mediaStatus === null) {
    return (
      <div className="flex flex-col items-center justify-center text-white/45 gap-3 p-10">
        <Loader2 className="w-7 h-7 animate-spin" />
        <p className="text-[11px] uppercase tracking-[0.18em] font-bold">Downloading preview</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center text-white/45 gap-3 p-10 text-center">
      <ImageOff className="w-8 h-8" />
      <p className="text-[12px] uppercase tracking-[0.18em] font-bold">Preview not yet cached</p>
      <p className="text-[11px] text-white/35 max-w-[280px] leading-[1.5]">
        We are still pulling this one in. Check back shortly.
      </p>
    </div>
  );
}

function MediaPreview({ item }: { item: AdResearchBoardItem }) {
  // Storage routes are mounted at /storage/* on the api-server; the platform
  // router exposes the api-server under /api, so the browser-reachable URL is
  // /api/storage/objects/<entityId>.
  const mediaSrc = item.mediaObjectPath ? `/api/storage${item.mediaObjectPath}` : null;
  // Some legacy rows have mediaKind=null even though the cached file is a
  // valid mp4/jpeg. Derive from contentType so we don't misclassify them
  // as "no media" and render a video as a black "Preview unavailable" tile.
  const kind = deriveMediaKind(item.mediaKind, item.mediaContentType);
  // Cached video poster (cheap <img>) when present, so the grid doesn't have
  // to spawn a <video> element per tile just to get a first-frame preview.
  // Falls back to <video preload="metadata"> below when no thumbnail exists.
  const thumbSrc = item.mediaThumbnailObjectPath
    ? `/api/storage${item.mediaThumbnailObjectPath}`
    : null;

  // Task #137: self-heal state. On the first onError we retry once with a
  // cache-buster (handles transient CDN blips). If that also fails we
  // POST to the refetch endpoint and degrade to a "Preview unavailable"
  // tile so the card stays clickable.
  // - cacheBust: timestamp appended to src for the second attempt
  // - failed: hide the media element entirely once we've given up
  // The server-side endpoint is rate-limited / idempotent, so a noisy
  // page with many broken cards can call it freely without coordination.
  const [cacheBust, setCacheBust] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const refetchedRef = useRef(false);
  const handleMediaError = () => {
    if (cacheBust === null) {
      setCacheBust(Date.now());
      return;
    }
    if (!refetchedRef.current) {
      refetchedRef.current = true;
      // Fire-and-forget; server handles dedupe + rate limits.
      api.refetchAdResearchBoardItem(item.id).catch(() => {});
    }
    setFailed(true);
  };
  const withBuster = (src: string) => (cacheBust ? `${src}${src.includes("?") ? "&" : "?"}cb=${cacheBust}` : src);

  // Lazy-load gate: only attach <video>/<img> src once the card has been
  // (or is about to be) within ~600px of the viewport. With infinite scroll
  // we may have 30+ cards stacked off-screen, and the api-server's storage
  // proxy is the bottleneck - kicking off all those metadata fetches at
  // once is what made the board feel sluggish. Cards above the fold see
  // their src immediately because the observer's first callback fires
  // synchronously on mount.
  const [tileRef, tileInView] = useInView<HTMLDivElement>("600px");

  // The MediaPreview is rendered INSIDE the card <button>, so it must not
  // contain interactive elements (anchors, video controls, etc.). Clicking
  // anywhere on the preview should bubble up to the parent button and open
  // the detail modal, where the user can play video / open the original.
  if (item.mediaStatus === "ok" && mediaSrc && !failed && kind === "video") {
    // Prefer the cached poster <img> when we have one — it's a single tiny
    // image fetch instead of spinning up a <video> element per tile, which
    // is what made scrolling sluggish (each <video preload="metadata"> kicks
    // off a range request and a decoder). Fall back to the old <video>
    // poster path when no thumbnail is available.
    return (
      <div ref={tileRef} className="relative w-full aspect-[4/5] bg-black">
        {tileInView && (thumbSrc ? (
          <img
            src={withBuster(thumbSrc)}
            alt={displayRowKey(item)}
            loading="lazy"
            decoding="async"
            onError={handleMediaError}
            className="w-full h-full block object-contain bg-black pointer-events-none"
          />
        ) : (
          <video
            src={`${withBuster(mediaSrc)}#t=0.1`}
            preload="metadata"
            playsInline
            muted
            tabIndex={-1}
            onError={handleMediaError}
            className="w-full h-full block object-contain bg-black pointer-events-none"
          />
        ))}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="w-12 h-12 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
            <Play className="w-5 h-5 text-white fill-white" />
          </span>
        </div>
      </div>
    );
  }

  if (item.mediaStatus === "ok" && mediaSrc && !failed && kind === "image") {
    return (
      <div ref={tileRef} className="block bg-black min-h-[200px]">
        {tileInView && (
          <img
            src={withBuster(mediaSrc)}
            alt={displayRowKey(item)}
            loading="lazy"
            decoding="async"
            onError={handleMediaError}
            className="w-full h-auto block max-h-[600px] object-contain bg-black"
          />
        )}
      </div>
    );
  }

  if (item.mediaStatus === "pending" || item.mediaStatus === null) {
    return (
      <div className="aspect-[4/5] bg-[#050505] flex flex-col items-center justify-center text-white/40 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold">Downloading preview</p>
      </div>
    );
  }

  // failed or no media — keep card-clickable, modal will surface the source link
  return (
    <div className="aspect-[4/5] bg-gradient-to-br from-[#0a0a0a] to-[#050505] flex flex-col items-center justify-center text-white/40 gap-2">
      <ImageOff className="w-6 h-6" />
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold">Preview unavailable</p>
      <p className="text-[10px] text-white/30">Click card to view options</p>
    </div>
  );
}

// ----------------------------------------------------------------
// FUNNELS TAB: card grid with self-hosted preview thumbnail,
// Open Live Link + Download PDF buttons, and Greg's notes.
// ----------------------------------------------------------------
function FunnelsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();

  // Filters mirror the ads tab. Search is debounced so we don't fire a
  // request per keystroke.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [awarenessFilter, setAwarenessFilter] = useState<Set<string>>(new Set());

  // Server-side paginated infinite query, same shape as AdsTab. Switching
  // any filter changes the queryKey and resets to page 1.
  const queryPayload = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: Array.from(typeFilter).sort(),
      awarenessStage: Array.from(awarenessFilter).sort(),
    }),
    [debouncedSearch, typeFilter, awarenessFilter],
  );
  const boardQuery = useInfiniteQuery({
    queryKey: ["funnels-research-board", queryPayload],
    queryFn: ({ pageParam }) =>
      api.getFunnelsResearchBoard({ ...queryPayload, page: pageParam, pageSize: ADS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < (lastPage.total ?? 0) ? allPages.length + 1 : undefined;
    },
    refetchOnWindowFocus: false,
    retry: 2,
    refetchInterval: (q) => {
      const pages = (q.state.data as { pages?: Array<{ items: FunnelsResearchBoardItem[] }> } | undefined)?.pages;
      if (!pages?.length) return false;
      for (const p of pages) {
        for (const it of p.items) {
          if (it.previewSourceUrl && (it.previewStatus === "pending" || it.previewStatus === null)) {
            return 5_000;
          }
        }
      }
      return false;
    },
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncMutation = useMutation({
    mutationFn: api.syncFunnelsResearchBoard,
    onSuccess: (data) => {
      if (!data.ok) { setSyncError(data.error || "Sync failed"); return; }
      setSyncError(null);
      qc.invalidateQueries({ queryKey: ["funnels-research-board"] });
    },
    onError: (err: any) => setSyncError(err?.message || "Sync failed"),
  });

  const pages = boardQuery.data?.pages ?? [];
  const firstPage = pages[0];
  const items: FunnelsResearchBoardItem[] = useMemo(
    () => pages.flatMap((p) => p.items),
    [pages],
  );
  const total = firstPage?.total ?? 0;
  const loadedCount = items.length;

  // Detail modal selection. Re-derived from the latest items[] so live status
  // updates (preview cache completing, etc.) propagate into the open modal.
  const [openFunnelId, setOpenFunnelId] = useState<number | null>(null);
  const openFunnel = openFunnelId == null ? null : items.find((it) => it.id === openFunnelId) || null;

  const allTypes = firstPage?.facets.types || [];
  const allAwareness = firstPage?.facets.awarenessStages || [];

  // Server applies search + type + awareness filters; render items as-is.
  const filtered = items;

  const previewReadyCount = items.filter(
    (it) => it.previewStatus === "ok" && it.previewObjectPath,
  ).length;
  const previewExpectedCount = items.filter((it) => !!it.previewSourceUrl).length;

  // Sentinel for infinite scroll - identical pattern to the ads tab.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && boardQuery.hasNextPage && !boardQuery.isFetchingNextPage) {
            boardQuery.fetchNextPage();
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [boardQuery]);

  return (
    <>
      <StatusBar
        lastSyncedAt={firstPage?.lastSyncedAt}
        lastSyncOk={firstPage?.lastSyncOk}
        isAdmin={isAdmin}
        syncing={syncMutation.isPending}
        onSync={() => { setSyncError(null); syncMutation.mutate(); }}
        syncError={syncError}
        extraButton={
          previewExpectedCount > 0 ? (
            <span className="text-[10.5px] text-white/45 uppercase tracking-[0.18em] font-bold px-2">
              {previewReadyCount} / {previewExpectedCount} previews
            </span>
          ) : null
        }
      />

      {boardQuery.isLoading && (
        <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-12 text-center text-[13px] text-white/45">
          Loading board...
        </div>
      )}
      {boardQuery.isError && (
        <BoardLoadError query={boardQuery} />
      )}
      {boardQuery.data && items.length === 0 && (
        debouncedSearch || typeFilter.size || awarenessFilter.size ? (
          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-12 text-center text-[13px] text-white/45">
            No funnels or landing pages match those filters.
          </div>
        ) : (
          <EmptyState
            title="No funnels or landing pages on the board yet"
            body="We are curating the first batch right now. New funnels and landing pages appear here automatically once they hit the master sheet."
          />
        )
      )}

      {boardQuery.data && items.length > 0 && (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID, link, or notes..."
                className="w-full pl-9 pr-3 py-2.5 bg-[#0a0a0a] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:border-[#C9A44C]/45"
              />
            </div>
            <FilterDropdown
              label="Type"
              values={allTypes}
              selected={typeFilter}
              onChange={setTypeFilter}
              pillClass={(v) => typePillClasses(v)}
            />
            <FilterDropdown
              label="Awareness"
              values={allAwareness}
              selected={awarenessFilter}
              onChange={setAwarenessFilter}
              pillClass={(v) => awarenessPillClasses(v)}
            />
            {(typeFilter.size > 0 || awarenessFilter.size > 0 || search.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setTypeFilter(new Set());
                  setAwarenessFilter(new Set());
                  setSearch("");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-white/55 hover:text-white border border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
            <span className="text-[11px] text-white/45 uppercase tracking-[0.18em] font-bold">
              {loadedCount} of {total}
            </span>
          </div>

          <FunnelsGrid items={filtered} onOpen={(it) => setOpenFunnelId(it.id)} />
          <div ref={sentinelRef} className="h-px" aria-hidden />
          {boardQuery.isFetchingNextPage && (
            <div className="mt-6 text-center text-[12px] text-white/45 uppercase tracking-[0.18em] font-bold">
              Loading more…
            </div>
          )}
        </>
      )}

      <FunnelDetailModal
        item={openFunnel}
        onClose={() => setOpenFunnelId(null)}
      />
    </>
  );
}

function FunnelsGrid({
  items,
  onOpen,
}: {
  items: FunnelsResearchBoardItem[];
  onOpen: (item: FunnelsResearchBoardItem) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
      {items.map((it) => (
        <FunnelCard key={it.id} item={it} onOpen={() => onOpen(it)} />
      ))}
    </div>
  );
}

function FunnelCard({
  item,
  onOpen,
}: {
  item: FunnelsResearchBoardItem;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open details for ${item.rowKey}`}
      className="group block w-full text-left cursor-pointer bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-[#C9A44C]/40 hover:shadow-[0_0_0_1px_rgba(201,164,76,0.15)] transition-all flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A44C]/60"
    >
      <div className="relative">
        <FunnelPreview item={item} />
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-black/70 backdrop-blur text-[10px] font-bold uppercase tracking-[0.14em] text-white">
            <Maximize2 className="w-3 h-3" /> View
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[13px] font-bold tracking-[0.04em] text-[#C9A44C]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {item.rowKey}
          </span>
          <span className="text-[10px] text-white/35 uppercase tracking-[0.16em] font-bold">
            {hostLabel(item.funnelLink)}
          </span>
        </div>

        {(item.type || item.awarenessStage || item.style) && (
          <div className="flex flex-wrap gap-1.5">
            {item.type && item.type.trim() && (
              <Pill className={typePillClasses(item.type)}>{item.type}</Pill>
            )}
            {item.awarenessStage && item.awarenessStage.trim() && (
              <Pill className={awarenessPillClasses(item.awarenessStage)}>
                {item.awarenessStage}
              </Pill>
            )}
            {item.style && item.style.trim() && (
              <Pill className="bg-[#C9A44C]/12 text-[#C9A44C] border-[#C9A44C]/25">
                {item.style}
              </Pill>
            )}
          </div>
        )}

        {item.notes && item.notes.trim() ? (
          <div className="pt-2 border-t border-white/[0.05]">
            <p className="text-[10px] text-[#C9A44C]/80 uppercase tracking-[0.18em] font-bold mb-1.5">
              Research Notes
            </p>
            <p className="text-[13px] text-white/80 leading-[1.55] whitespace-pre-wrap line-clamp-4">
              {item.notes}
            </p>
          </div>
        ) : (
          <p className="pt-2 border-t border-white/[0.05] text-[11.5px] text-white/35 italic">
            No notes yet
          </p>
        )}
      </div>
    </div>
  );
}

// Funnels detail modal mirrors the ads modal: bigger preview, full notes,
// Open Live Link + Download PDF actions.
function FunnelDetailModal({
  item,
  onClose,
}: {
  item: FunnelsResearchBoardItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[min(96vw,1100px)] w-[min(96vw,1100px)] p-0 overflow-hidden bg-[#0a0a0a] border border-white/[0.08] rounded-2xl max-h-[92vh]">
        <DialogTitle className="sr-only">{item?.rowKey || "Funnel detail"}</DialogTitle>
        <DialogDescription className="sr-only">
          Larger preview and notes for this funnel or landing page.
        </DialogDescription>
        {item && (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-h-[92vh]">
            <div className="bg-black flex items-center justify-center min-h-[320px] md:min-h-[560px] max-h-[92vh] overflow-hidden">
              <FunnelModalPreview item={item} />
            </div>

            <div className="flex flex-col max-h-[92vh]">
              <div className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
                <div className="min-w-0">
                  <p
                    className="text-[16px] font-bold uppercase tracking-[0.04em] text-[#C9A44C]"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {item.rowKey}
                  </p>
                  <p className="text-[10.5px] text-white/45 uppercase tracking-[0.18em] font-bold mt-0.5">
                    {hostLabel(item.funnelLink)}
                  </p>
                </div>
                {/* Built-in DialogContent X (top-right) is the only close
                    affordance now; reserve space so the title doesn't run
                    underneath it. */}
                <div className="shrink-0 w-8 h-8" aria-hidden />
              </div>

              <div className="overflow-y-auto p-5 space-y-5">
                {(item.type || item.awarenessStage || item.style) && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.type && item.type.trim() && (
                      <Pill className={typePillClasses(item.type)}>{item.type}</Pill>
                    )}
                    {item.awarenessStage && item.awarenessStage.trim() && (
                      <Pill className={awarenessPillClasses(item.awarenessStage)}>
                        {item.awarenessStage}
                      </Pill>
                    )}
                    {item.style && item.style.trim() && (
                      <Pill className="bg-[#C9A44C]/12 text-[#C9A44C] border-[#C9A44C]/25">
                        {item.style}
                      </Pill>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[10px] text-[#C9A44C]/85 uppercase tracking-[0.18em] font-bold mb-2">
                    Research Notes
                  </p>
                  {item.notes && item.notes.trim() ? (
                    <p className="text-[14px] text-white/85 leading-[1.65] whitespace-pre-wrap">
                      {item.notes}
                    </p>
                  ) : (
                    <p className="text-[13px] text-white/40 italic">
                      No notes yet for this funnel.
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-white/[0.06]">
                  <p className="text-[10px] text-white/40 uppercase tracking-[0.18em] font-bold mb-2">
                    Live URL
                  </p>
                  <p className="text-[12px] text-white/55 break-all leading-[1.5]">
                    {item.funnelLink}
                  </p>
                </div>
              </div>

              <div className="border-t border-white/[0.06] p-4 flex flex-wrap items-center gap-2">
                <a
                  href={item.funnelLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_8px_24px_-8px_rgba(155,93,229,0.55)] hover:shadow-[0_10px_28px_-8px_rgba(155,93,229,0.7)] transition-shadow"
                  style={{ background: "linear-gradient(135deg, #9B5DE5 0%, #6E3CC4 100%)" }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Live Link
                </a>
                {item.pdfSourceUrl ? (
                  <a
                    href={item.pdfSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] border border-[#C9A44C]/40 hover:bg-[#C9A44C]/10"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </a>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] text-white/35 border border-white/[0.08] cursor-not-allowed">
                    <FileText className="w-3.5 h-3.5" />
                    No PDF Yet
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FunnelModalPreview({ item }: { item: FunnelsResearchBoardItem }) {
  const cached =
    item.previewStatus === "ok" && item.previewObjectPath
      ? `/api/storage${item.previewObjectPath}`
      : null;
  if (cached) {
    return (
      <img
        src={cached}
        alt={item.rowKey}
        className="w-full h-full max-h-[92vh] object-contain bg-black"
      />
    );
  }
  const driveFallback = driveThumbnailFromAny(item.previewSourceUrl || null);
  if (driveFallback) {
    return (
      <img
        src={driveFallback}
        alt={item.rowKey}
        className="w-full h-full max-h-[92vh] object-contain bg-black"
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center text-white/45 gap-3 p-10 text-center">
      <ImageOff className="w-8 h-8" />
      <p className="text-[12px] uppercase tracking-[0.18em] font-bold">No preview yet</p>
      <p className="text-[11px] text-white/35 max-w-[280px] leading-[1.5]">
        Use Open Live Link below to view the funnel in a new tab.
      </p>
    </div>
  );
}

function FunnelPreview({ item }: { item: FunnelsResearchBoardItem }) {
  // Rendered INSIDE the card <button> — must not contain interactive
  // elements. Live link + PDF download live in the modal action bar.
  const cached =
    item.previewStatus === "ok" && item.previewObjectPath
      ? `/api/storage${item.previewObjectPath}`
      : null;

  if (cached) {
    return (
      <div className="block bg-black aspect-[4/3] overflow-hidden">
        <img
          src={cached}
          alt={item.rowKey}
          loading="lazy"
          className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-300"
        />
      </div>
    );
  }

  if (!item.previewSourceUrl) {
    return (
      <div className="aspect-[4/3] bg-gradient-to-br from-[#0a0a0a] to-[#050505] flex flex-col items-center justify-center text-white/35 gap-2">
        <ImageOff className="w-6 h-6" />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold">No preview yet</p>
      </div>
    );
  }

  if (item.previewStatus === "pending" || item.previewStatus === null) {
    return (
      <div className="aspect-[4/3] bg-[#050505] flex flex-col items-center justify-center text-white/40 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold">Caching preview</p>
      </div>
    );
  }

  const driveFallback = driveThumbnailFromAny(item.previewSourceUrl);
  if (driveFallback) {
    return (
      <div className="block bg-black aspect-[4/3] overflow-hidden">
        <img
          src={driveFallback}
          alt={item.rowKey}
          loading="lazy"
          className="w-full h-full object-cover object-top"
        />
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] bg-gradient-to-br from-[#0a0a0a] to-[#050505] flex flex-col items-center justify-center text-white/35 gap-2">
      <ImageOff className="w-6 h-6" />
      <p className="text-[10.5px] uppercase tracking-[0.18em] font-bold">Preview unavailable</p>
    </div>
  );
}

function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return h.length > 28 ? h.slice(0, 26) + "..." : h;
  } catch {
    return "Link";
  }
}

function driveThumbnailFromAny(url: string | null | undefined): string | null {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return `https://drive.google.com/thumbnail?id=${m1[1]}&sz=w1200`;
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && /^[a-zA-Z0-9_-]{10,}$/.test(id)) {
      return `https://drive.google.com/thumbnail?id=${id}&sz=w1200`;
    }
  } catch {}
  return null;
}
