import { useState, useEffect, useCallback, useRef } from "react";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import {
  BookOpen, FileText, Youtube, Trash2, RefreshCw, Plus, X,
  CheckCircle2, AlertCircle, Loader2, GraduationCap, Link2, Video,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface KnowledgeDoc {
  id: number;
  sourceType: string;
  title: string;
  group: string;
  sourceUrl: string | null;
  chunkCount: number;
  updatedAt: string;
}

interface Overview {
  stats: {
    totalDocs: number;
    totalChunks: number;
    lessonNotes: number;
    lessonTranscripts: number;
    manualDocs: number;
    youtubeDocs: number;
    wistiaDocs?: number;
  };
  docs: KnowledgeDoc[];
  wistiaConfigured: boolean;
  masterclassResyncRunning: boolean;
  youtubeJob: {
    state: "idle" | "running" | "done" | "failed";
    url: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    videosFound: number;
    videosIngested: number;
    videosSkipped: number;
    error: string | null;
  };
}

function useApi() {
  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}) => {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api${url}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders, ...options.headers },
    });
    if (!res.ok) {
      let message = `API error: ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* keep default */ }
      throw new Error(message);
    }
    return res;
  }, []);
  return { fetchWithAuth };
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  lesson_notes: { label: "LESSON NOTES", color: "bg-amber-500/10 text-amber-300" },
  lesson_transcript: { label: "VIDEO TRANSCRIPT", color: "bg-purple-500/10 text-purple-300" },
  manual: { label: "CUSTOM DOC", color: "bg-green-500/10 text-green-300" },
  youtube: { label: "YOUTUBE", color: "bg-red-500/10 text-red-300" },
  wistia: { label: "WISTIA VIDEO", color: "bg-blue-500/10 text-blue-300" },
};

// Scheduler-managed source types (auto-synced, not deletable in the UI).
const AUTO_MANAGED = (t: string) => t.startsWith("lesson_") || t === "wistia";

export function AdminSupportKnowledge() {
  const { fetchWithAuth } = useApi();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "masterclass" | "custom">("all");

  const [showAddDoc, setShowAddDoc] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  const [showAddYoutube, setShowAddYoutube] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytMax, setYtMax] = useState(25);
  const [startingYt, setStartingYt] = useState(false);

  const [resyncing, setResyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchWithAuth("/portal/admin/support-knowledge/overview");
      const json = (await res.json()) as Overview;
      setData(json);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  // Poll while a YouTube import or masterclass resync is running.
  const busy = data?.youtubeJob?.state === "running" || data?.masterclassResyncRunning;
  useEffect(() => {
    if (busy && !pollRef.current) {
      pollRef.current = setInterval(() => void load(true), 5000);
    }
    if (!busy && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [busy, load]);

  const addDoc = async () => {
    setSavingDoc(true);
    setNotice(null);
    try {
      await fetchWithAuth("/portal/admin/support-knowledge/docs", {
        method: "POST",
        body: JSON.stringify({ title: docTitle, content: docContent }),
      });
      setDocTitle(""); setDocContent(""); setShowAddDoc(false);
      setNotice("Doc added - Steph can use it immediately.");
      await load(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to add doc");
    } finally {
      setSavingDoc(false);
    }
  };

  const startYoutube = async () => {
    setStartingYt(true);
    setNotice(null);
    try {
      await fetchWithAuth("/portal/admin/support-knowledge/youtube", {
        method: "POST",
        body: JSON.stringify({ url: ytUrl, maxVideos: ytMax }),
      });
      setYtUrl(""); setShowAddYoutube(false);
      setNotice("YouTube import started - videos with transcripts will appear below as they finish.");
      await load(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to start import");
    } finally {
      setStartingYt(false);
    }
  };

  const deleteDoc = async (doc: KnowledgeDoc) => {
    if (!confirm(`Remove "${doc.title}" from Steph's knowledge?`)) return;
    try {
      await fetchWithAuth(`/portal/admin/support-knowledge/docs/${doc.id}`, { method: "DELETE" });
      await load(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const resync = async () => {
    setResyncing(true);
    setNotice(null);
    try {
      await fetchWithAuth("/portal/admin/support-knowledge/resync", { method: "POST" });
      setNotice("Masterclass sync started - new or edited lessons will be re-learned.");
      await load(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to start sync");
    } finally {
      setResyncing(false);
    }
  };

  const docs = (data?.docs ?? []).filter((d) => {
    if (filter === "masterclass") return AUTO_MANAGED(d.sourceType);
    if (filter === "custom") return !AUTO_MANAGED(d.sourceType);
    return true;
  });

  const yt = data?.youtubeJob;

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-6 h-6 text-[#D4AF37]" /> Steph Support Knowledge
            </h1>
            <p className="text-white/55 text-sm mt-1">
              Everything the support bot can draw on when answering customers. The masterclass syncs automatically - add extra docs and YouTube content here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowAddYoutube(true); setShowAddDoc(false); }}
              className="flex items-center gap-1.5 text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-2 rounded-lg"
            >
              <Youtube className="w-4 h-4 text-red-400" /> Add YouTube
            </button>
            <button
              onClick={() => { setShowAddDoc(true); setShowAddYoutube(false); }}
              className="flex items-center gap-1.5 text-sm bg-[#D4AF37] hover:bg-[#c8a22e] text-black font-semibold px-3 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" /> Add Doc
            </button>
          </div>
        </div>

        {notice && (
          <div className="mb-4 text-sm bg-white/5 border border-white/10 text-white/80 px-3 py-2 rounded-lg flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-white/55 py-12 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading knowledge base...
          </div>
        ) : error ? (
          <div className="text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm">{error}</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard icon={GraduationCap} label="Lesson Notes" value={data.stats.lessonNotes} />
              <StatCard icon={Video} label="Video Transcripts" value={data.stats.lessonTranscripts + (data.stats.wistiaDocs ?? 0)} hint={data.wistiaConfigured ? undefined : "Waiting on Wistia key"} />
              <StatCard icon={FileText} label="Custom Docs" value={data.stats.manualDocs} />
              <StatCard icon={Youtube} label="YouTube Videos" value={data.stats.youtubeDocs} />
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                onClick={resync}
                disabled={resyncing || data.masterclassResyncRunning}
                className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
              >
                {data.masterclassResyncRunning
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing masterclass...</>
                  : <><RefreshCw className="w-3.5 h-3.5" /> Re-sync masterclass now</>}
              </button>
              {yt && yt.state !== "idle" && (
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                  yt.state === "running" ? "bg-blue-500/10 text-blue-300 border-blue-500/20"
                  : yt.state === "failed" ? "bg-red-500/10 text-red-300 border-red-500/20"
                  : "bg-green-500/10 text-green-300 border-green-500/20"
                }`}>
                  {yt.state === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {yt.state === "done" && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {yt.state === "failed" && <AlertCircle className="w-3.5 h-3.5" />}
                  {yt.state === "running"
                    ? `Importing YouTube... ${yt.videosIngested} learned so far`
                    : yt.state === "failed"
                      ? `YouTube import failed: ${yt.error}`
                      : `YouTube import done - ${yt.videosIngested} learned, ${yt.videosSkipped} skipped (no transcript / unchanged)`}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {(["all", "masterclass", "custom"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border ${filter === f ? "bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30" : "bg-white/5 text-white/55 border-white/10 hover:text-white"}`}
                  >
                    {f === "all" ? `All (${data.stats.totalDocs})` : f === "masterclass" ? "Masterclass" : "Custom"}
                  </button>
                ))}
              </div>
            </div>

            {showAddDoc && (
              <div className="mb-4 bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold text-sm">Add a custom doc</h3>
                  <button onClick={() => setShowAddDoc(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <input
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Title (e.g. Refund policy details, ManyChat setup FAQ)"
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 mb-2"
                />
                <textarea
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="Paste the content Steph should learn - docs, FAQs, SOPs, transcripts, anything text."
                  rows={8}
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 mb-3"
                />
                <button
                  onClick={addDoc}
                  disabled={savingDoc || !docTitle.trim() || docContent.trim().length < 40}
                  className="flex items-center gap-1.5 text-sm bg-[#D4AF37] hover:bg-[#c8a22e] text-black font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                >
                  {savingDoc ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Teach Steph this doc
                </button>
              </div>
            )}

            {showAddYoutube && (
              <div className="mb-4 bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold text-sm">Import from YouTube</h3>
                  <button onClick={() => setShowAddYoutube(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-white/45 text-xs mb-3">
                  Paste a video, channel, or playlist link. Only videos with real transcripts are learned - shorts, streams, and videos without captions are filtered out automatically. You can delete any video from the list afterwards.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <input
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="https://youtube.com/@channel or a video link"
                    className="flex-1 min-w-[240px] bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30"
                  />
                  <label className="flex items-center gap-2 text-xs text-white/55">
                    Max videos
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={ytMax}
                      onChange={(e) => setYtMax(Number(e.target.value))}
                      className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-2 text-sm text-white"
                    />
                  </label>
                </div>
                <button
                  onClick={startYoutube}
                  disabled={startingYt || !ytUrl.trim() || yt?.state === "running"}
                  className="flex items-center gap-1.5 text-sm bg-[#D4AF37] hover:bg-[#c8a22e] text-black font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                >
                  {startingYt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />} Start import
                </button>
              </div>
            )}

            <div className="bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden">
              {docs.length === 0 ? (
                <div className="text-white/40 text-sm text-center py-10">Nothing here yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-white/40 text-xs border-b border-white/10">
                      <th className="px-4 py-2.5 font-medium">Title</th>
                      <th className="px-4 py-2.5 font-medium hidden md:table-cell">Group</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Chunks</th>
                      <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Updated</th>
                      <th className="px-4 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => {
                      const badge = SOURCE_LABEL[d.sourceType] ?? { label: d.sourceType.toUpperCase(), color: "bg-white/5 text-white/55" };
                      const custom = !AUTO_MANAGED(d.sourceType);
                      return (
                        <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-2.5 text-white/85">
                            <span className="flex items-center gap-1.5">
                              {d.title}
                              {d.sourceUrl && (
                                <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="text-white/30 hover:text-[#D4AF37]">
                                  <Link2 className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-white/45 hidden md:table-cell">{d.group}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-white/45 hidden sm:table-cell">{d.chunkCount}</td>
                          <td className="px-4 py-2.5 text-white/45 hidden lg:table-cell">{relTime(d.updatedAt)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {custom && (
                              <button onClick={() => void deleteDoc(d)} className="text-white/30 hover:text-red-400" title="Remove from Steph's knowledge">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number; hint?: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 text-white/45 text-xs mb-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {hint && <div className="text-[11px] text-amber-300/80 mt-1">{hint}</div>}
    </div>
  );
}
