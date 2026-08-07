import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useInfiniteQuery,
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import {
  Loader2,
  Play,
  Pause,
  Download,
  Search,
  RefreshCw,
  Check,
  X,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { api, type BackgroundMusicJob } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

type Page = Awaited<ReturnType<typeof api.backgroundMusic.list>>;
type Track = Page["tracks"][number];

const PAGE_SIZE = 50;

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(b: number | null): string {
  if (b == null || !Number.isFinite(b) || b <= 0) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Parse ?q= from window.location.search. wouter's useLocation returns
// only the pathname so we read the search string directly.
function readQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  return (sp.get("q") || "").trim();
}

export default function DfyBackgroundMusic() {
  const [location, setLocation] = useLocation();
  const [rawQuery, setRawQuery] = useState<string>(() => readQueryFromUrl());
  const [query, setQuery] = useState<string>(() => readQueryFromUrl());

  // Debounce search input by 250ms and mirror it into the URL so refresh
  // and back-button preserve the search.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = rawQuery.trim();
      setQuery(trimmed);
      const sp = new URLSearchParams(window.location.search);
      if (trimmed) sp.set("q", trimmed);
      else sp.delete("q");
      const next = sp.toString();
      setLocation(`${location}${next ? `?${next}` : ""}`, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [rawQuery, location, setLocation]);

  // Re-sync from URL on history navigation (back/forward).
  useEffect(() => {
    const onPop = () => {
      const next = readQueryFromUrl();
      setRawQuery(next);
      setQuery(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<Page, Error>({
    queryKey: ["dfy-background-music", query],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api.backgroundMusic.list({
        q: query,
        cursor: (pageParam as string) || undefined,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const tracks = useMemo<Track[]>(
    () => (data?.pages || []).flatMap((p) => p.tracks),
    [data],
  );
  const isAdmin = !!data?.pages?.[0]?.isAdmin;

  return (
    <DfySubPageShell
      title="4,000+ Background Reel Music"
      description="A curated, royalty-friendly background track library for your reels and shorts. Tap a track to preview the first 30 seconds, then download the full file."
    >
      <div className="mb-5 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search by track name or code (e.g. BGM-A7K3X2)..."
            className="w-full bg-[#0f0f0f] border border-white/[0.08] rounded-lg pl-9 pr-4 py-2.5 text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/50"
          />
        </div>
        {isAdmin ? <AdminRefreshButton onDone={() => refetch()} /> : null}
      </div>

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : isError ? (
        <div className="bg-[#0f0f0f] border border-red-500/20 rounded-2xl p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-3" />
          <p className="text-[13px] text-white/75 mb-3">
            {error?.message || "Failed to load tracks."}
          </p>
          <button
            onClick={() => refetch()}
            className="text-[11px] uppercase tracking-[0.14em] font-bold text-[#C9A44C] hover:text-white border border-[#C9A44C]/40 hover:border-white/40 px-4 py-2 rounded"
          >
            Try again
          </button>
        </div>
      ) : tracks.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center text-white/55 text-[13px]">
          {query
            ? "No tracks match this search."
            : "No tracks have been imported yet. An admin can run Refresh from Drive to populate the library."}
        </div>
      ) : (
        <TrackList
          tracks={tracks}
          isAdmin={isAdmin}
          isFetching={isFetching && !isFetchingNextPage}
          hasNextPage={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
        />
      )}
    </DfySubPageShell>
  );
}

function TrackList({
  tracks,
  isAdmin,
  isFetching,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  tracks: Track[];
  isAdmin: boolean;
  isFetching: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);

  // Single shared audio element so only one preview plays at a time.
  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    audioRef.current = el;
    const onEnd = () => setPlayingId(null);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("ended", onEnd);
      el.pause();
      audioRef.current = null;
    };
  }, []);

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  useEffect(() => {
    if (!hasNextPage) return;
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !isFetchingNextPage) {
            onLoadMore();
            break;
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const togglePlay = useCallback((track: Track) => {
    const el = audioRef.current;
    if (!el) return;
    if (playingId === track.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.pause();
    el.src = api.backgroundMusic.previewSrc(track.id);
    el.currentTime = 0;
    el.play()
      .then(() => setPlayingId(track.id))
      .catch((err) => {
        toast({
          title: "Preview failed",
          description: err?.message || "Browser blocked playback.",
          variant: "destructive",
        });
        setPlayingId(null);
      });
  }, [playingId]);

  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] text-[10.5px] uppercase tracking-[0.16em] text-white/45 font-bold">
        <span>
          {tracks.length} loaded
          {hasNextPage ? " - more available" : ""}
        </span>
        {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            isPlaying={playingId === t.id}
            onToggle={() => togglePlay(t)}
            isAdmin={isAdmin}
          />
        ))}
      </ul>
      {hasNextPage ? (
        <div ref={sentinelRef} className="px-4 py-6 text-center">
          {isFetchingNextPage ? (
            <Loader2 className="w-5 h-5 text-white/40 animate-spin mx-auto" />
          ) : (
            <button
              onClick={onLoadMore}
              className="text-[11px] uppercase tracking-[0.14em] font-bold text-white/55 hover:text-[#C9A44C]"
            >
              Load more
            </button>
          )}
        </div>
      ) : tracks.length > PAGE_SIZE ? (
        <div className="px-4 py-4 text-center text-[10.5px] uppercase tracking-[0.14em] text-white/35">
          End of library
        </div>
      ) : null}
    </div>
  );
}

function TrackRow({
  track,
  isPlaying,
  onToggle,
  isAdmin,
}: {
  track: Track;
  isPlaying: boolean;
  onToggle: () => void;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.title);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (title: string) =>
      api.backgroundMusic.admin.update(track.id, { title }),
    onSuccess: () => {
      toast({ title: "Title updated" });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["dfy-background-music"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Update failed",
        description: err?.message || "Try again.",
        variant: "destructive",
      }),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
      <button
        onClick={onToggle}
        className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
          isPlaying
            ? "bg-[#C9A44C] text-black border-[#C9A44C]"
            : "bg-white/[0.04] text-white/85 border-white/[0.08] hover:border-[#C9A44C]/50 hover:text-white"
        }`}
        title={isPlaying ? "Pause preview" : "Play 30s preview"}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="flex-1 bg-[#0a0a0a] border border-white/[0.12] rounded px-2 py-1 text-[13px] text-white focus:outline-none focus:border-[#C9A44C]/60"
            />
            <button
              onClick={() => save.mutate(draft)}
              disabled={save.isPending || !draft.trim()}
              className="text-[#C9A44C] hover:text-white p-1 disabled:opacity-50"
              title="Save"
            >
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                setDraft(track.title);
                setEditing(false);
              }}
              className="text-white/45 hover:text-white p-1"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] text-white truncate font-medium">{track.title}</span>
            {isAdmin ? (
              <button
                onClick={() => {
                  setDraft(track.title);
                  setEditing(true);
                }}
                className="text-white/30 hover:text-[#C9A44C] p-0.5"
                title="Rename"
              >
                <Pencil className="w-3 h-3" />
              </button>
            ) : null}
          </div>
        )}
        <div className="text-[10.5px] text-white/40 mt-0.5 truncate">
          {track.trackCode ? (
            <span className="font-mono text-white/55 mr-2">{track.trackCode}</span>
          ) : null}
          {formatDuration(track.durationSeconds)} - {formatBytes(track.fileSize)}
        </div>
      </div>

      <a
        href={api.backgroundMusic.downloadHref(track.id)}
        className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-bold text-white/65 hover:text-[#C9A44C] border border-white/[0.08] hover:border-[#C9A44C]/40 px-3 py-1.5 rounded"
        title="Download original"
      >
        <Download className="w-3.5 h-3.5" /> Download
      </a>
    </li>
  );
}

function AdminRefreshButton({ onDone }: { onDone: () => void }) {
  const [job, setJob] = useState<BackgroundMusicJob | null>(null);

  // Pick up any in-flight job on mount so a page refresh doesn't lose it.
  useEffect(() => {
    api.backgroundMusic.admin
      .activeJob()
      .then((r) => {
        if (r?.job) setJob(r.job);
      })
      .catch(() => {});
  }, []);

  // Poll while a job is running.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const id = setInterval(async () => {
      try {
        const { job: next } = await api.backgroundMusic.admin.getJob(job.id);
        setJob(next);
        if (next.status === "done" || next.status === "failed") {
          clearInterval(id);
          onDone();
          toast({
            title: next.status === "done" ? "Library refreshed" : "Refresh failed",
            description: next.message || next.error || "",
            variant: next.status === "failed" ? "destructive" : undefined,
          });
        }
      } catch {
        // transient; keep polling
      }
    }, 2_000);
    return () => clearInterval(id);
  }, [job, onDone]);

  const start = useMutation({
    mutationFn: () => api.backgroundMusic.admin.refresh(),
    onSuccess: (r) => setJob(r.job),
    onError: (err: Error) =>
      toast({
        title: "Refresh failed to start",
        description: err?.message || "Try again.",
        variant: "destructive",
      }),
  });

  const running = job && (job.status === "pending" || job.status === "running");
  const progressLabel = useMemo(() => {
    if (!job) return null;
    if (job.status === "done") return `Done - ${job.added} new, ${job.updated} updated`;
    if (job.status === "failed") return `Failed - ${job.error || ""}`;
    if (job.total > 0) return `${job.processed} / ${job.total}`;
    return job.message || "Starting...";
  }, [job]);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => start.mutate()}
        disabled={!!running || start.isPending}
        className="inline-flex items-center gap-2 bg-[#C9A44C] text-black hover:bg-[#d4b260] disabled:opacity-60 disabled:cursor-not-allowed text-[11px] font-bold uppercase tracking-[0.14em] px-4 py-2 rounded-lg"
      >
        {running || start.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
        Refresh from Drive
      </button>
      {progressLabel ? (
        <span className="text-[11px] text-white/55">{progressLabel}</span>
      ) : null}
    </div>
  );
}
