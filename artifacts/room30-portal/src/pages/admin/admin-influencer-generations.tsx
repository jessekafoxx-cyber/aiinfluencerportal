// Task #695: super-admin console for AI Influencer generations.
//
// Lists every generation job with buyer email + status, lets admin
// filter by status / email / stuck-only, exposes three intervention
// actions per row (Retry, Mark failed, Manual deliver), and renders
// a readable detail panel with form payload, scene-job grid, and a
// stage timeline.
//
// The OpenAPI contract is in lib/api-spec/openapi.yaml under
// `influencer-generations-admin`; the page uses raw fetch to stay
// consistent with the rest of the /portal/admin/* surface.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  XCircle,
  Send,
  ChevronRight,
  X,
  Plus,
  Image as ImageIcon,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { toast } from "@/hooks/use-toast";

type JobRow = {
  id: number;
  clientId: number;
  email: string | null;
  userName: string | null;
  status: string;
  failureReason: string | null;
  lastErrorCode: string | null;
  finalizeAttempts: number;
  etaAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  notifiedAt: string | null;
  emailSentAt: string | null;
  manuallyDeliveredAt: string | null;
  manuallyDeliveredByClerkId: string | null;
  isFreeTier: boolean;
  influencerId: number | null;
  influencerName: string | null;
  influencerStatus: string | null;
  sceneCount: number;
  hasPortrait: boolean;
};

type ListResp = { jobs: JobRow[]; pagination: { limit: number; offset: number; returned: number } };

type SceneJob = {
  id: number;
  sceneIndex: number;
  label: string | null;
  provider: string;
  status: string;
  attemptCount: number;
  retryCount: number;
  nextAttemptAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  generatedAssetUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type TimelineEntry = { stage: string; at: string };

type JobDetail = {
  job: Record<string, any>;
  // API returns `owner` (see routes/admin-influencer-generations.ts); we
  // accept `buyer` as a legacy alias so older builds don't crash here.
  buyer?: { id: number; email: string | null; name: string | null } | null;
  owner?: { id: number; email: string | null; name: string | null } | null;
  influencer: {
    id: number;
    name: string;
    status: string;
    avatarUrl: string | null;
    angleCount: number;
    settingCount: number;
  } | null;
  sceneJobs?: SceneJob[];
  timeline?: TimelineEntry[];
};

const STATUS_OPTIONS = [
  "",
  "queued",
  "generating_base",
  "enhancing",
  "swapping_scenes",
  "ready",
  "ready_degraded",
  "failed",
];

function statusBadgeClass(status: string): string {
  if (status === "ready" || status === "completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "ready_degraded") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (status === "failed") return "bg-red-500/15 text-red-300 border-red-500/30";
  if (status === "generating" || status === "retrying" || status === "swapping_scenes" || status === "enhancing" || status === "generating_base")
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return "bg-white/[0.06] text-white/70 border-white/[0.1]";
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function AdminInfluencerGenerations() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [emailQ, setEmailQ] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [stuckOnly, setStuckOnly] = useState(false);
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [deliverModalJob, setDeliverModalJob] = useState<JobRow | null>(null);

  const params = useMemo(() => {
    const u = new URLSearchParams();
    u.set("limit", "150");
    if (status) u.set("status", status);
    if (emailQ) u.set("email", emailQ);
    if (stuckOnly) u.set("stuck", "1");
    return u.toString();
  }, [status, emailQ, stuckOnly]);

  const { data, isLoading, refetch, isFetching, error: listError } = useQuery<ListResp>({
    queryKey: ["admin-influencer-generations", params],
    queryFn: async () => {
      const r = await fetch(`/api/portal/admin/influencer-generations?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        // Surface the real reason instead of silently rendering "No
        // generations match the current filters." A 403 here means the
        // signed-in user is not on the super-admin allow-list - the
        // exact wedge that made this page look empty to the canonical
        // admin (his app_users row had email=null so the ADMIN_EMAILS
        // check could never pass).
        const body = await r.json().catch(() => ({}));
        const detail = body?.message || body?.error || `HTTP ${r.status}`;
        const err = new Error(detail) as Error & { status?: number };
        err.status = r.status;
        throw err;
      }
      return r.json();
    },
    refetchOnWindowFocus: false,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-influencer-generations"] });
    if (selected) qc.invalidateQueries({ queryKey: ["admin-influencer-generation-detail", selected.id] });
  };

  const retryMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/portal/admin/influencer-generations/${id}/retry`, {
        method: "POST", credentials: "include", cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => { toast({ title: "Retry queued", description: `New job #${j.newJobId}` }); invalidate(); },
    onError: (e: any) => toast({ title: "Retry failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const failMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/portal/admin/influencer-generations/${id}/mark-failed`, {
        method: "POST", credentials: "include", cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => {
      toast({
        title: j.alreadyTerminal ? "Already terminal" : "Marked failed",
        description: j.alreadyTerminal ? `Status ${j.status}` : `Email: ${j.emailStatus}`,
      });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Mark failed errored", description: String(e?.message || e), variant: "destructive" }),
  });

  const deliverMut = useMutation({
    mutationFn: async (args: { id: number; coverImageUrl: string; scenes: Array<{ url: string; label?: string }> }) => {
      const r = await fetch(`/api/portal/admin/influencer-generations/${args.id}/manual-deliver`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverImageUrl: args.coverImageUrl, scenes: args.scenes }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => {
      toast({
        title: j.alreadyDelivered ? "Already delivered" : "Manual delivery sent",
        description: `Status: ${j.status} - scenes: ${j.sceneCount ?? 0} - email: ${j.emailStatus ?? "-"}`,
      });
      setDeliverModalJob(null);
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: "Manual deliver failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setEmailQ(emailInput.trim()); };

  const jobs = data?.jobs ?? [];
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const j of jobs) out[j.status] = (out[j.status] ?? 0) + 1;
    return out;
  }, [jobs]);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1
                className="text-[28px] md:text-[34px] tracking-[0.02em] uppercase text-white"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Influencer Generations
              </h1>
              <p className="text-[13px] text-white/55 mt-1">
                Super-admin console for the AI Influencer pipeline. Inspect, retry, mark failed, or manually deliver any generation.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] text-[12px] text-white/70 hover:text-[#C9A44C] hover:border-[#C9A44C]/40 transition-colors disabled:opacity-60"
            >
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>
          </div>

          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-4 flex flex-wrap items-center gap-3">
            <form onSubmit={onSearch} className="flex items-center gap-2 flex-1 min-w-[260px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Search by buyer email..."
                  className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:border-[#C9A44C]/50"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-[#C9A44C]/10 text-[#C9A44C] border border-[#C9A44C]/30 text-[12px] hover:bg-[#C9A44C]/20"
              >
                Search
              </button>
            </form>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="bg-[#0a0a0a] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#C9A44C]/50"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>{s || "All statuses"}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] text-[12px] text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={stuckOnly}
                onChange={(e) => setStuckOnly(e.target.checked)}
                className="accent-[#C9A44C]"
              />
              Stuck only (1h+ or finalize cap)
            </label>
          </div>

          {jobs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts).map(([s, n]) => (
                <span key={s} className={`text-[11px] px-2.5 py-1 rounded-full border ${statusBadgeClass(s)}`}>
                  {s} · {n}
                </span>
              ))}
            </div>
          )}

          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="p-8 flex items-center justify-center text-white/50 text-[13px]">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading...
              </div>
            ) : listError ? (
              <div className="p-6 text-[13px]" role="alert" data-testid="admin-list-error">
                <div className="flex items-start gap-2 text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 mt-[2px] shrink-0" />
                  <div>
                    <div className="font-semibold">
                      {(listError as Error & { status?: number }).status === 403
                        ? "Forbidden - your account is not on the super-admin allow-list."
                        : "Failed to load generations."}
                    </div>
                    <div className="text-white/60 mt-1">
                      {String((listError as Error).message || listError)}
                    </div>
                    {(listError as Error & { status?: number }).status === 403 && (
                      <div className="text-white/50 mt-2">
                        If you should have access, ask Greg / engineering to run
                        <code className="mx-1 px-1 py-0.5 rounded bg-white/10 text-white/80">
                          pnpm --filter @workspace/scripts run grant:super-admin
                        </code>
                        against the prod DB with your Clerk id + email.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : jobs.length === 0 ? (
              <div className="p-8 text-center text-white/50 text-[13px]">No generations match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-white/[0.02] text-white/55 text-[11px] uppercase tracking-[0.04em]">
                    <tr>
                      <th className="text-left px-3 py-2 font-normal">Job</th>
                      <th className="text-left px-3 py-2 font-normal">Buyer</th>
                      <th className="text-left px-3 py-2 font-normal">Status</th>
                      <th className="text-left px-3 py-2 font-normal">Influencer</th>
                      <th className="text-left px-3 py-2 font-normal">Portrait</th>
                      <th className="text-left px-3 py-2 font-normal">Scenes</th>
                      <th className="text-left px-3 py-2 font-normal">Age</th>
                      <th className="text-left px-3 py-2 font-normal">Heartbeat</th>
                      <th className="text-left px-3 py-2 font-normal">Last error</th>
                      <th className="text-right px-3 py-2 font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => {
                      const busy =
                        (retryMut.isPending && retryMut.variables === j.id) ||
                        (failMut.isPending && failMut.variables === j.id) ||
                        (deliverMut.isPending && deliverMut.variables?.id === j.id);
                      const terminal = j.status === "ready" || j.status === "ready_degraded" || j.status === "failed";
                      return (
                        <tr
                          key={j.id}
                          className={`border-t border-white/[0.04] hover:bg-white/[0.02] ${selected?.id === j.id ? "bg-white/[0.03]" : ""}`}
                        >
                          <td className="px-3 py-2 text-white/80 font-mono">
                            #{j.id}{j.isFreeTier && <span className="ml-1 text-[10px] text-white/40">free</span>}
                          </td>
                          <td className="px-3 py-2 text-white/75">
                            <div className="truncate max-w-[200px]">{j.email ?? `client ${j.clientId}`}</div>
                            {j.userName && <div className="text-[10.5px] text-white/40 truncate max-w-[200px]">{j.userName}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[10.5px] px-2 py-0.5 rounded-full border ${statusBadgeClass(j.status)}`}>
                              {j.status}
                            </span>
                            {j.manuallyDeliveredAt && (
                              <div className="text-[10px] text-amber-300/70 mt-0.5">admin acted</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-white/70">
                            {j.influencerName ?? <span className="text-white/35">-</span>}
                            {j.influencerStatus && <div className="text-[10px] text-white/40">{j.influencerStatus}</div>}
                          </td>
                          <td className="px-3 py-2">
                            {j.hasPortrait ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/80" /> : <XCircle className="w-3.5 h-3.5 text-red-400/70" />}
                          </td>
                          <td className="px-3 py-2 text-white/70">{j.sceneCount}</td>
                          <td className="px-3 py-2 text-white/55 whitespace-nowrap">{fmtAgo(j.createdAt)}</td>
                          <td className="px-3 py-2 text-white/55 whitespace-nowrap">{fmtAgo(j.heartbeatAt)}</td>
                          <td className="px-3 py-2 text-white/55">
                            <div className="truncate max-w-[160px]">{j.lastErrorCode ?? j.failureReason ?? "-"}</div>
                            <div className="text-[10px] text-white/35">attempts: {j.finalizeAttempts}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              {j.status !== "ready" && j.status !== "ready_degraded" && (
                                <button
                                  onClick={() => { if (!busy) setDeliverModalJob(j); }}
                                  disabled={busy}
                                  title="Manual deliver (paste cover + scene URLs)"
                                  className="p-1.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                                >
                                  <Send className="w-3 h-3" />
                                </button>
                              )}
                              {!terminal && (
                                <button
                                  onClick={() => {
                                    if (busy) return;
                                    if (!confirm(`Mark job #${j.id} failed? This refunds the slot and emails the buyer.`)) return;
                                    failMut.mutate(j.id);
                                  }}
                                  disabled={busy}
                                  title="Mark failed (refunds slot)"
                                  className="p-1.5 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  <XCircle className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (busy) return;
                                  const note = terminal
                                    ? "Uses the same buyer + influencer slot."
                                    : "WARNING: source job is still running. It will be marked failed (superseded) and a new job queued.";
                                  if (!confirm(`Queue a fresh retry for job #${j.id}?\n\n${note}`)) return;
                                  retryMut.mutate(j.id);
                                }}
                                disabled={busy}
                                title="Retry (new job)"
                                className="p-1.5 rounded border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setSelected(selected?.id === j.id ? null : j)}
                                title="Details"
                                className="p-1.5 rounded border border-white/[0.08] text-white/65 hover:text-[#C9A44C] hover:border-[#C9A44C]/40"
                              >
                                <ChevronRight className="w-3 h-3" />
                              </button>
                              {busy && <Loader2 className="w-3 h-3 animate-spin text-white/60 ml-1" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selected && (
            <div className="bg-[#0f0f0f] border border-[#C9A44C]/30 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2
                  className="text-[18px] uppercase tracking-[0.02em] text-[#C9A44C]"
                  style={{ fontFamily: "var(--app-font-display)" }}
                >
                  Job #{selected.id} - {selected.email ?? `client ${selected.clientId}`}
                </h2>
                <button onClick={() => setSelected(null)} className="text-white/50 hover:text-white text-[12px]">
                  Close
                </button>
              </div>
              <JobDetailPanel
                id={selected.id}
                onManualDeliver={() => setDeliverModalJob(selected)}
              />
            </div>
          )}

          <div className="text-[11px] text-white/35 pt-2 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>
              Manual delivery requires a cover image URL (and optionally up to 20 scene URLs). The job flips to <b>ready</b>,
              the buyer gets the standard influencer-ready notification + email, and the audit fields are stamped with your Clerk id.
            </p>
          </div>
        </div>
      </div>

      {deliverModalJob && (
        <ManualDeliverModal
          job={deliverModalJob}
          onClose={() => setDeliverModalJob(null)}
          onSubmit={(coverImageUrl, scenes) =>
            deliverMut.mutate({ id: deliverModalJob.id, coverImageUrl, scenes })
          }
          isSubmitting={deliverMut.isPending}
        />
      )}
    </PortalLayout>
  );
}

function JobDetailPanel({ id, onManualDeliver }: { id: number; onManualDeliver: () => void }) {
  const { data, isLoading, error } = useQuery<JobDetail>({
    queryKey: ["admin-influencer-generation-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/portal/admin/influencer-generations/${id}`, {
        credentials: "include", cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="text-white/50 text-[12px] flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading job detail...
      </div>
    );
  }
  if (error || !data?.job) {
    return <div className="text-red-300 text-[12px]">Could not load job. {error ? String((error as any).message) : ""}</div>;
  }

  const job = data.job;
  const prefs = (job.prefs ?? {}) as Record<string, any>;
  const characterProfile = (job.characterProfile ?? job.character_profile ?? null) as Record<string, any> | null;
  // Defensive: API may omit timeline (currently does) or sceneJobs on
  // partial responses; never crash the detail panel because of it.
  const buyer = data.buyer ?? data.owner ?? null;
  const timeline: TimelineEntry[] = Array.isArray(data.timeline) ? data.timeline : [];
  const sceneJobs: SceneJob[] = Array.isArray(data.sceneJobs) ? data.sceneJobs : [];
  // sceneImageUrls is stored as Array<{url,label}> in the jsonb column,
  // but legacy rows may still hold plain string[]; normalise here so the
  // tile grid always shows the label exactly as stored.
  const rawScenes: any[] = Array.isArray(job.sceneImageUrls) ? job.sceneImageUrls : [];
  const sceneTiles: Array<{ url: string; label: string }> = rawScenes
    .map((s, i) => {
      if (typeof s === "string") return { url: s, label: `Scene ${i + 1}` };
      if (s && typeof s === "object" && typeof s.url === "string") {
        return { url: s.url, label: typeof s.label === "string" && s.label ? s.label : `Scene ${i + 1}` };
      }
      return null;
    })
    .filter((v): v is { url: string; label: string } => v !== null);
  const portraitUrl: string | null = job.enhancedImageUrl || job.baseImageUrl || null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Buyer">
          <KV label="Email" value={buyer?.email ?? "-"} />
          <KV label="Name" value={buyer?.name ?? "-"} />
          <KV label="Client id" value={String(job.clientId)} />
          <KV label="Free tier" value={job.isFreeTier ? "yes" : "no"} />
        </Card>

        <Card title="Form payload">
          {Object.keys(prefs).length === 0 ? (
            <div className="text-white/40 text-[12px]">No prefs captured.</div>
          ) : (
            <>
              {Object.entries(prefs).map(([k, v]) => (
                <KV key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} />
              ))}
            </>
          )}
          {characterProfile && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="text-[10.5px] uppercase tracking-[0.05em] text-white/40 mb-1">Character profile</div>
              {Object.entries(characterProfile).map(([k, v]) => (
                <KV key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Pipeline state">
          <KV label="Status" value={job.status} pillClass={statusBadgeClass(job.status)} />
          <KV label="Last error code" value={job.lastErrorCode ?? "-"} />
          <KV label="Last error message" value={job.lastErrorMessage ?? "-"} />
          <KV label="Failure reason" value={job.failureReason ?? "-"} />
          <KV label="Finalize attempts" value={String(job.finalizeAttempts ?? 0)} />
          <KV label="ETA at" value={fmtAbs(job.etaAt)} />
          <KV label="Next attempt" value={fmtAbs(job.nextAttemptAt)} />
          <KV label="Heartbeat" value={fmtAbs(job.heartbeatAt)} />
          {job.manuallyDeliveredAt && (
            <KV
              label="Admin acted"
              value={`${fmtAbs(job.manuallyDeliveredAt)} (${job.manuallyDeliveredByClerkId ?? "?"})`}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`Artifacts (${(portraitUrl ? 1 : 0) + sceneTiles.length})`}>
          <div className="grid grid-cols-3 gap-2">
            {portraitUrl ? (
              <ArtifactTile url={portraitUrl} label="Portrait" />
            ) : (
              <div className="aspect-square rounded border border-white/[0.06] bg-white/[0.02] flex flex-col items-center justify-center text-white/30 text-[10px] gap-1">
                <ImageIcon className="w-4 h-4" /> No portrait
              </div>
            )}
            {sceneTiles.map((s, i) => (
              <ArtifactTile key={i} url={s.url} label={s.label} />
            ))}
          </div>
          {!portraitUrl && (
            <div className="text-[11px] text-red-300/80 mt-2">
              Manual deliver is blocked without a portrait. Use Mark failed to refund the slot.
            </div>
          )}
        </Card>

        <Card title="Stage timeline">
          {timeline.length === 0 ? (
            <div className="text-white/40 text-[12px]">No timeline events.</div>
          ) : (
            <ol className="space-y-1.5">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[12px]">
                  <span className="text-white/45 font-mono w-[150px] shrink-0">{fmtAbs(e.at)}</span>
                  <span className="text-white/80">{e.stage}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title={`Scene jobs (${sceneJobs.length})`}>
        {sceneJobs.length === 0 ? (
          <div className="text-white/40 text-[12px]">No child scene-job rows seeded for this job.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-white/45 text-[10.5px] uppercase tracking-[0.05em]">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">#</th>
                  <th className="text-left px-2 py-1 font-normal">Label</th>
                  <th className="text-left px-2 py-1 font-normal">Provider</th>
                  <th className="text-left px-2 py-1 font-normal">Status</th>
                  <th className="text-left px-2 py-1 font-normal">Attempts</th>
                  <th className="text-left px-2 py-1 font-normal">Error</th>
                  <th className="text-left px-2 py-1 font-normal">Asset</th>
                </tr>
              </thead>
              <tbody>
                {sceneJobs.map((s) => (
                  <tr key={s.id} className="border-t border-white/[0.04]">
                    <td className="px-2 py-1 text-white/55 font-mono">{s.sceneIndex}</td>
                    <td className="px-2 py-1 text-white/80">{s.label ?? "-"}</td>
                    <td className="px-2 py-1 text-white/55">{s.provider}</td>
                    <td className="px-2 py-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadgeClass(s.status)}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-white/55">{s.attemptCount}/{s.retryCount}</td>
                    <td className="px-2 py-1 text-white/55">
                      {s.lastErrorCode ? (
                        <div>
                          <div className="text-amber-300/80">{s.lastErrorCode}</div>
                          {s.lastErrorMessage && (
                            <div className="text-[10px] text-white/40 truncate max-w-[260px]">{s.lastErrorMessage}</div>
                          )}
                        </div>
                      ) : "-"}
                    </td>
                    <td className="px-2 py-1">
                      {s.generatedAssetUrl ? (
                        <a href={s.generatedAssetUrl} target="_blank" rel="noreferrer" className="text-[#C9A44C] hover:underline text-[11px]">
                          open
                        </a>
                      ) : (
                        <span className="text-white/30 text-[11px]">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.influencer && (
        <Card title="Linked influencer">
          <KV label="ID" value={`#${data.influencer.id}`} />
          <KV label="Name" value={data.influencer.name} />
          <KV label="Status" value={data.influencer.status} pillClass={statusBadgeClass(data.influencer.status)} />
          <KV label="Angles populated" value={String(data.influencer.angleCount)} />
          <KV label="Settings populated" value={String(data.influencer.settingCount)} />
          {data.influencer.avatarUrl && (
            <div className="mt-3">
              <img src={data.influencer.avatarUrl} alt="avatar" className="w-24 h-24 rounded object-cover border border-white/[0.08]" />
            </div>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <button
          onClick={onManualDeliver}
          className="text-[12px] px-3 py-1.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
        >
          Open manual deliver
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-lg p-4">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/40 mb-2.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value, pillClass }: { label: string; value: string; pillClass?: string }) {
  return (
    <div className="flex items-start gap-3 text-[12px] leading-snug">
      <span className="text-white/45 min-w-[110px] capitalize">{label}</span>
      {pillClass ? (
        <span className={`text-[10.5px] px-2 py-0.5 rounded-full border ${pillClass}`}>{value}</span>
      ) : (
        <span className="text-white/80 break-all">{value}</span>
      )}
    </div>
  );
}

function ArtifactTile({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group relative aspect-square rounded border border-white/[0.06] overflow-hidden bg-white/[0.02]"
      title={label}
    >
      <img src={url} alt={label} className="w-full h-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] text-white/85 px-1.5 py-1 truncate">
        {label}
      </div>
    </a>
  );
}

function ManualDeliverModal({
  job,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  job: JobRow;
  onClose: () => void;
  onSubmit: (coverImageUrl: string, scenes: Array<{ url: string; label?: string }>) => void;
  isSubmitting: boolean;
}) {
  const [cover, setCover] = useState("");
  const [scenes, setScenes] = useState<Array<{ url: string; label: string }>>([{ url: "", label: "" }]);

  const valid = useMemo(() => {
    if (!cover.trim()) return false;
    try { new URL(cover.trim()); } catch { return false; }
    for (const s of scenes) {
      if (!s.url.trim()) continue;
      try { new URL(s.url.trim()); } catch { return false; }
    }
    return true;
  }, [cover, scenes]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const cleaned = scenes
      .filter((s) => s.url.trim())
      .map((s) => ({ url: s.url.trim(), label: s.label.trim() || undefined }));
    onSubmit(cover.trim(), cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={submit}
        className="bg-[#0a0a0a] border border-[#C9A44C]/30 rounded-xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.05em] text-white/40">Manual deliver</div>
            <div className="text-white text-[15px]">
              Job #{job.id} - {job.email ?? `client ${job.clientId}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-white/55 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.05em] text-white/55 mb-1.5">
              Cover image URL <span className="text-red-300">*</span>
            </label>
            <input
              type="url"
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              placeholder="https://storage.googleapis.com/..."
              required
              className="w-full bg-[#050505] border border-white/[0.1] rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/50"
            />
            <p className="text-[11px] text-white/45 mt-1">
              Becomes the avatar on `ai_influencers` and the "Front" angle in the workspace.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] uppercase tracking-[0.05em] text-white/55">
                Scene images (optional, up to 10)
              </label>
              <button
                type="button"
                onClick={() => setScenes((s) => (s.length < 10 ? [...s, { url: "", label: "" }] : s))}
                className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-white/[0.1] text-white/65 hover:text-[#C9A44C] hover:border-[#C9A44C]/40"
              >
                <Plus className="w-3 h-3" /> Add row
              </button>
            </div>
            <div className="space-y-2">
              {scenes.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="url"
                    value={s.url}
                    onChange={(e) => setScenes((arr) => arr.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))}
                    placeholder={`Scene ${i + 1} URL`}
                    className="flex-1 bg-[#050505] border border-white/[0.1] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/50"
                  />
                  <input
                    type="text"
                    value={s.label}
                    onChange={(e) => setScenes((arr) => arr.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                    placeholder="Label"
                    maxLength={120}
                    className="w-[160px] bg-[#050505] border border-white/[0.1] rounded-lg px-3 py-2 text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/50"
                  />
                  <button
                    type="button"
                    onClick={() => setScenes((arr) => arr.filter((_, idx) => idx !== i))}
                    className="px-2 rounded border border-white/[0.08] text-white/55 hover:text-red-300 hover:border-red-300/40"
                    title="Remove row"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-lg p-3 text-[11.5px] text-amber-200/80 leading-snug flex gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>
              Submitting will flip the job to <b>ready</b>, write/update the influencer + angle + settings rows, send the
              buyer the standard ready notification + Resend email (unless already sent), and stamp the audit fields with
              your Clerk id. The action is idempotent.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/[0.08] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-white/[0.1] text-[12.5px] text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || isSubmitting}
            className="px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-[12.5px] hover:bg-emerald-500/15 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Deliver to buyer
          </button>
        </div>
      </form>
    </div>
  );
}
