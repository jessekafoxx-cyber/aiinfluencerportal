// AI Video Studio gallery (Task #828) - admin-only. Grid of generated jobs,
// player modal (raw / edited tabs), downloads, soft-delete, auto-edit, and
// auto-refresh while any job is still generating/editing.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, fetchApi } from "../lib/api";
import { PortalLayout } from "../components/portal-layout";
import NotFound from "./not-found";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Play, Trash2, Download, Wand2, AlertCircle, RotateCcw } from "lucide-react";

const GOLD = "#C9A44C";

type VideoJob = {
  id: number;
  title: string | null;
  status: string;
  script: string;
  voiceId: string;
  quality: string;
  aspectRatio: string;
  rawVideoUrl: string | null;
  editedVideoUrl: string | null;
  editStatus: string | null;
  editStyle: string | null;
  editErrorMessage: string | null;
  thumbnailUrl: string | null;
  sourceImageUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
};
type EditStyle = { id: string; label: string; description: string };
type VideoStats = {
  total: number;
  completed: number;
  generating: number;
  failed: number;
  edited: number;
};

export default function VideoGalleryPage() {
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = (me as any)?.user?.role === "admin";

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: GOLD }} />
      </div>
    );
  }
  if (!isAdmin) return <NotFound />;
  return (
    <PortalLayout>
      <VideoGalleryInner />
    </PortalLayout>
  );
}

function VideoGalleryInner() {
  const [, setLocation] = useLocation();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [stats, setStats] = useState<VideoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [active, setActive] = useState<VideoJob | null>(null);
  const [editTarget, setEditTarget] = useState<VideoJob | null>(null);
  const [editStyles, setEditStyles] = useState<EditStyle[]>([]);
  const [editConfigured, setEditConfigured] = useState(false);
  const [editCost, setEditCost] = useState(3);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const qs = filter ? `?status=${filter}` : "";
      const d = await fetchApi<{ jobs: VideoJob[] }>(`/api/video/list${qs}`);
      setJobs(d.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
    try {
      const s = await fetchApi<VideoStats>("/api/video/stats");
      setStats(s);
    } catch {
      /* stats are best-effort */
    }
  }

  async function doRetry(job: VideoJob) {
    setRetryingId(job.id);
    try {
      await fetchApi("/api/video/generate", {
        method: "POST",
        body: JSON.stringify({
          influencerId: undefined,
          sourceImageUrl: job.sourceImageUrl,
          script: job.script,
          voiceId: job.voiceId,
          quality: job.quality,
          aspectRatio: job.aspectRatio,
          title: job.title ?? undefined,
          editStyle: job.editStyle ?? undefined,
        }),
      });
      toast({ title: "Retrying", description: "A fresh generation has started." });
      void load();
    } catch (e: any) {
      toast({ title: "Could not retry", description: e?.message, variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    (async () => {
      try {
        const d = await fetchApi<{ styles: EditStyle[]; configured: boolean; cost: number }>(
          "/api/video/edit-styles",
        );
        setEditStyles(d.styles ?? []);
        setEditConfigured(!!d.configured);
        setEditCost(d.cost ?? 3);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const hasPending = useMemo(
    () =>
      jobs.some(
        (j) =>
          j.status === "generating" ||
          j.status === "pending" ||
          j.editStatus === "editing" ||
          j.editStatus === "pending",
      ),
    [jobs],
  );

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (hasPending) {
      pollRef.current = setInterval(() => void load(), 6000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending, filter]);

  async function doDelete(job: VideoJob) {
    if (!confirm("Delete this video? This cannot be undone.")) return;
    try {
      await fetchApi(`/api/video/${job.id}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (active?.id === job.id) setActive(null);
      toast({ title: "Deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e?.message, variant: "destructive" });
    }
  }

  async function doAutoEdit(job: VideoJob, style: string) {
    try {
      await fetchApi("/api/video/auto-edit", {
        method: "POST",
        body: JSON.stringify({ jobId: job.id, style }),
      });
      setEditTarget(null);
      toast({ title: "Auto-edit started", description: `${editCost} credits deducted.` });
      void load();
    } catch (e: any) {
      toast({ title: "Could not start auto-edit", description: e?.message, variant: "destructive" });
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-white">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--app-font-display)" }}>
            Video Gallery
          </h1>
          <p className="text-sm text-white/55 mt-1">Your generated talking-head videos.</p>
        </div>
        <button
          onClick={() => setLocation("/video-studio")}
          className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em]"
          style={{ background: GOLD, color: "#0E0E10" }}
        >
          New video
        </button>
      </div>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mb-6">
          {[
            { l: "Total", v: stats.total, c: "rgba(255,255,255,0.85)" },
            { l: "Completed", v: stats.completed, c: "#6ee7a8" },
            { l: "Generating", v: stats.generating, c: GOLD },
            { l: "Edited", v: stats.edited, c: GOLD },
            { l: "Failed", v: stats.failed, c: "#f08a8a" },
          ].map((s) => (
            <div
              key={s.l}
              className="rounded-xl px-3 py-2.5 text-center"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-lg font-bold tabular-nums" style={{ color: s.c }}>
                {s.v}
              </p>
              <p className="text-[10px] uppercase tracking-[0.1em] text-white/45">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { v: "", l: "All" },
          { v: "completed", l: "Completed" },
          { v: "generating", l: "Generating" },
          { v: "failed", l: "Failed" },
        ].map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
            style={
              filter === f.v
                ? { background: GOLD, color: "#0E0E10" }
                : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)" }
            }
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-white/45">
          <p className="mb-3">No videos yet.</p>
          <button
            onClick={() => setLocation("/video-studio")}
            className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em]"
            style={{ background: GOLD, color: "#0E0E10" }}
          >
            Create your first video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="rounded-xl overflow-hidden relative group"
              style={{ background: "#0E0E10", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="aspect-[3/4] relative bg-black/40">
                {job.thumbnailUrl || job.sourceImageUrl ? (
                  <img src={job.thumbnailUrl || job.sourceImageUrl || ""} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">No preview</div>
                )}
                {job.status === "completed" && (job.rawVideoUrl || job.editedVideoUrl) && (
                  <button
                    onClick={() => setActive(job)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Play className="w-10 h-10" style={{ color: GOLD }} />
                  </button>
                )}
                {(job.status === "generating" || job.status === "pending") && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                    <Loader2 className="w-6 h-6 animate-spin mb-1" style={{ color: GOLD }} />
                    <span className="text-[10px] text-white/70">Generating</span>
                  </div>
                )}
                {job.status === "failed" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                    <AlertCircle className="w-6 h-6 mb-1 text-red-400" />
                    <span className="text-[10px] text-red-300">Failed</span>
                  </div>
                )}
                {job.editStatus === "completed" && (
                  <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: GOLD, color: "#0E0E10" }}>
                    Edited
                  </span>
                )}
                {job.editStatus === "editing" && (
                  <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/20 text-white">
                    Editing...
                  </span>
                )}
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[12px] font-semibold truncate">{job.title || "Untitled"}</p>
                <p className="text-[10px] text-white/40 truncate">{job.script.slice(0, 50)}</p>
                <div className="flex items-center gap-2 mt-2">
                  {job.status === "completed" && editConfigured && job.editStatus !== "completed" && job.editStatus !== "editing" && (
                    <button onClick={() => setEditTarget(job)} title="Auto-edit" className="text-white/50 hover:text-[#C9A44C]">
                      <Wand2 className="w-4 h-4" />
                    </button>
                  )}
                  {job.status === "failed" && (
                    <button
                      onClick={() => doRetry(job)}
                      disabled={retryingId === job.id}
                      title="Retry generation"
                      className="text-white/50 hover:text-[#C9A44C] disabled:opacity-50"
                    >
                      {retryingId === job.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button onClick={() => doDelete(job)} title="Delete" className="text-white/50 hover:text-red-400 ml-auto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Player modal */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="bg-[#0E0E10] border-[#C9A44C]/30 text-white max-w-lg">
          {active && <PlayerModal job={active} />}
        </DialogContent>
      </Dialog>

      {/* Auto-edit picker */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="bg-[#0E0E10] border-[#C9A44C]/30 text-white">
          <DialogHeader>
            <DialogTitle>Auto-edit video</DialogTitle>
            <DialogDescription className="text-white/55">
              Pick a style. This deducts {editCost} credits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {editStyles.map((s) => (
              <button
                key={s.id}
                onClick={() => editTarget && doAutoEdit(editTarget, s.id)}
                className="w-full text-left rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.06]"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="font-semibold text-sm">{s.label}</p>
                <p className="text-[12px] text-white/50">{s.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlayerModal(props: { job: VideoJob }) {
  const { job } = props;
  const hasEdited = !!job.editedVideoUrl;
  const [tab, setTab] = useState<"raw" | "edited">(hasEdited ? "edited" : "raw");
  const src = tab === "edited" ? job.editedVideoUrl : job.rawVideoUrl;

  return (
    <div>
      <DialogHeader>
        <DialogTitle>{job.title || "Video"}</DialogTitle>
      </DialogHeader>
      {hasEdited && (
        <div className="flex gap-1.5 mb-3">
          {(["edited", "raw"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={
                tab === t
                  ? { background: GOLD, color: "#0E0E10" }
                  : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)" }
              }
            >
              {t === "edited" ? "Edited" : "Raw"}
            </button>
          ))}
        </div>
      )}
      {src ? (
        <video src={src} controls autoPlay className="w-full rounded-lg bg-black max-h-[60vh]" />
      ) : (
        <p className="text-sm text-white/45 py-8 text-center">No video available.</p>
      )}
      {src && (
        <a
          href={src}
          download
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em]"
          style={{ background: GOLD, color: "#0E0E10" }}
        >
          <Download className="w-4 h-4" /> Download
        </a>
      )}
    </div>
  );
}
