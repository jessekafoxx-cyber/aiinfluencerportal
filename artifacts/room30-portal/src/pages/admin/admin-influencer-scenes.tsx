// Admin-only bulk uploader for the global AI Influencer scene library.
// Drop a zip whose top-level folders are scene categories (e.g.
// "Interview & Panel", "Speaking & Stage", "Outdoor & Casual"); every
// image inside each folder lands in object storage and gets indexed
// against that category. The list below shows the current library
// roll-up by category + source + gender, and lets the admin disable
// or delete individual rows.
//
// Pairs with POST/GET /api/portal/admin/influencer-scenes/* on the
// api-server. Gated by requireInfluencerAdmin server-side; the page
// itself just lives at /admin/influencer-scenes.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, RefreshCw, Trash2, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchAuthed, getAuthHeaders } from "@/lib/api";

type StatsRow = {
  source: string;
  category: string | null;
  genderHint: string;
  enabled: boolean;
  count: number;
};
type StatsResponse = {
  totalAll: number;
  totalEnabled: number;
  rows: StatsRow[];
};
type SceneRow = {
  id: number;
  driveFileId: string;
  label: string | null;
  genderHint: string;
  gcsUrl: string;
  enabled: boolean;
  source: string;
  category: string | null;
  originalFilename: string | null;
  createdAt: string;
};
type UploadStats = {
  perCategory: Record<
    string,
    { inserted: number; skippedDuplicate: number; skippedUnsupported: number; failed: number }
  >;
  totalInserted: number;
  totalSkippedDuplicate: number;
  totalSkippedUnsupported: number;
  totalFailed: number;
};
type UploadResponse = { ok: true; stats: UploadStats; zipSizeBytes: number; zipName: string };

const GOLD = "#C9A44C";

export default function AdminInfluencerScenes() {
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ["admin-influencer-scenes-stats"],
    queryFn: async (): Promise<StatsResponse> => {
      const r = await fetchAuthed("/portal/admin/influencer-scenes/stats");
      if (!r.ok) throw new Error("Failed to load stats");
      return r.json();
    },
  });

  const [filterSource, setFilterSource] = useState<string>("admin-zip");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterEnabled, setFilterEnabled] = useState<string>("");

  const listQuery = useQuery({
    queryKey: ["admin-influencer-scenes-list", filterSource, filterCategory, filterEnabled],
    queryFn: async (): Promise<{ rows: SceneRow[] }> => {
      const qs = new URLSearchParams();
      if (filterSource) qs.set("source", filterSource);
      if (filterCategory) qs.set("category", filterCategory);
      if (filterEnabled) qs.set("enabled", filterEnabled);
      qs.set("limit", "200");
      const r = await fetchAuthed(`/portal/admin/influencer-scenes?${qs.toString()}`);
      if (!r.ok) throw new Error("Failed to load list");
      return r.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-influencer-scenes-stats"] });
    queryClient.invalidateQueries({ queryKey: ["admin-influencer-scenes-list"] });
  };

  const toggleMutation = useMutation({
    mutationFn: async (vars: { id: number; enabled: boolean }) => {
      const r = await fetchAuthed(`/portal/admin/influencer-scenes/${vars.id}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: vars.enabled }),
      });
      if (!r.ok) throw new Error("toggle failed");
      return r.json();
    },
    onSuccess: () => refresh(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetchAuthed(`/portal/admin/influencer-scenes/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      return r.json();
    },
    onSuccess: () => refresh(),
  });

  // Uploader state. We use raw fetch (not fetchAuthed) because fetchAuthed
  // assumes JSON; multer wants multipart/form-data.
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [categoryOverride, setCategoryOverride] = useState<string>("");
  const [genderHint, setGenderHint] = useState<string>("any");
  const [uploading, setUploading] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload() {
    if (!zipFile) return;
    setUploading(true);
    setUploadError(null);
    setLastUpload(null);
    try {
      const fd = new FormData();
      fd.append("zip", zipFile);
      if (categoryOverride.trim()) fd.append("categoryOverride", categoryOverride.trim());
      if (genderHint) fd.append("genderHint", genderHint);
      const auth = await getAuthHeaders();
      const r = await fetch("/api/portal/admin/influencer-scenes/bulk-upload", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "X-Portal-Key": "room30", ...auth },
        body: fd,
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data || !data.ok) {
        setUploadError((data && (data.message || data.error)) || `Upload failed (${r.status})`);
        return;
      }
      setLastUpload(data as UploadResponse);
      setZipFile(null);
      refresh();
    } catch (err: any) {
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    statsQuery.data?.rows?.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set).sort();
  }, [statsQuery.data]);

  // Group stats by category for the roll-up table.
  const categoryRollup = useMemo(() => {
    const map = new Map<
      string,
      { total: number; enabled: number; sources: Set<string>; genders: Set<string> }
    >();
    statsQuery.data?.rows?.forEach((r) => {
      const key = r.category || "(uncategorized)";
      const slot = map.get(key) || {
        total: 0,
        enabled: 0,
        sources: new Set<string>(),
        genders: new Set<string>(),
      };
      slot.total += r.count;
      if (r.enabled) slot.enabled += r.count;
      slot.sources.add(r.source);
      slot.genders.add(r.genderHint);
      map.set(key, slot);
    });
    return Array.from(map.entries())
      .map(([category, s]) => ({
        category,
        total: s.total,
        enabled: s.enabled,
        sources: Array.from(s.sources).sort().join(", "),
        genders: Array.from(s.genders).sort().join(", "),
      }))
      .sort((a, b) => b.total - a.total);
  }, [statsQuery.data]);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">AI Influencer Scene Library</h1>
              <p className="text-[12px] text-white/55 mt-1">
                Global reference scenes the in-process generation pipeline pulls from. Drop a zip
                whose top-level folders are scene categories (e.g. "Interview &amp; Panel",
                "Outdoor &amp; Casual"). Re-uploading the same image is a no-op.
              </p>
            </div>
            <button
              onClick={refresh}
              className="text-[11px] uppercase tracking-wider text-white/70 hover:text-white border border-white/[0.1] px-3 py-2 rounded-lg flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {/* Roll-up */}
          <div className="rounded-xl border border-white/[0.06] bg-black/30 p-5">
            <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-3">
              Library Roll-up
            </p>
            {statsQuery.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/40" />
            ) : statsQuery.data ? (
              <>
                <div className="flex flex-wrap gap-6 mb-4 text-[12px] text-white/70">
                  <div>
                    Total rows: <span className="text-white font-bold">{statsQuery.data.totalAll}</span>
                  </div>
                  <div>
                    Enabled: <span className="text-emerald-400 font-bold">{statsQuery.data.totalEnabled}</span>
                  </div>
                  <div>
                    Disabled:{" "}
                    <span className="text-white/60 font-bold">
                      {statsQuery.data.totalAll - statsQuery.data.totalEnabled}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="text-[10.5px] uppercase tracking-wider text-white/45">
                      <tr>
                        <th className="text-left py-2 pr-3">Category</th>
                        <th className="text-right py-2 pr-3">Total</th>
                        <th className="text-right py-2 pr-3">Enabled</th>
                        <th className="text-left py-2 pr-3">Sources</th>
                        <th className="text-left py-2 pr-3">Gender hints</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRollup.map((r) => (
                        <tr key={r.category} className="border-t border-white/[0.05]">
                          <td className="py-2 pr-3 text-white">{r.category}</td>
                          <td className="py-2 pr-3 text-right text-white/80">{r.total}</td>
                          <td className="py-2 pr-3 text-right text-emerald-400">{r.enabled}</td>
                          <td className="py-2 pr-3 text-white/60">{r.sources}</td>
                          <td className="py-2 pr-3 text-white/60">{r.genders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-[12px] text-rose-400">Failed to load stats.</p>
            )}
          </div>

          {/* Uploader */}
          <div className="rounded-xl border border-white/[0.06] bg-black/30 p-5">
            <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-3">
              Upload Zip
            </p>
            <p className="text-[11px] text-white/55 mb-4 leading-relaxed">
              Default behavior: every top-level folder inside the zip becomes a category, every
              image inside that folder gets indexed under it. Use "Category override" only if you
              zipped a flat folder and want everything in one category. Max 500 MB per upload -
              for huge libraries, upload one category folder at a time.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Zip file
                <input
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                  className="mt-1 text-[12px] text-white/80 file:bg-white/[0.06] file:border-0 file:px-3 file:py-1.5 file:rounded file:text-white/80 file:mr-3"
                />
              </label>
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Category override (optional)
                <input
                  type="text"
                  value={categoryOverride}
                  onChange={(e) => setCategoryOverride(e.target.value)}
                  placeholder="e.g. Interview & Panel"
                  className="mt-1 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
                />
              </label>
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Gender hint (applies to whole upload)
                <select
                  value={genderHint}
                  onChange={(e) => setGenderHint(e.target.value)}
                  className="mt-1 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
                >
                  <option value="any">any (matches male + female builds)</option>
                  <option value="female">female</option>
                  <option value="male">male</option>
                </select>
              </label>
            </div>
            <button
              onClick={handleUpload}
              disabled={!zipFile || uploading}
              className="px-4 py-2 rounded bg-[#C9A44C] text-black text-[12px] font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? "Uploading..." : zipFile ? `Upload ${zipFile.name}` : "Pick a zip first"}
            </button>
            {uploadError && (
              <p className="mt-3 text-[11px] text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-3 h-3" /> {uploadError}
              </p>
            )}
            {lastUpload && (
              <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-[12px] text-emerald-400 font-bold flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-3 h-3" /> Uploaded {lastUpload.zipName}
                </p>
                <p className="text-[11px] text-white/70">
                  Inserted <span className="font-bold text-white">{lastUpload.stats.totalInserted}</span>,
                  duplicates skipped {lastUpload.stats.totalSkippedDuplicate}, unsupported{" "}
                  {lastUpload.stats.totalSkippedUnsupported}, failed {lastUpload.stats.totalFailed}.
                </p>
                <div className="mt-2 text-[11px] text-white/55 space-y-0.5">
                  {Object.entries(lastUpload.stats.perCategory).map(([cat, s]) => (
                    <div key={cat}>
                      <span className="text-white/80">{cat}</span>: inserted {s.inserted},
                      duplicate {s.skippedDuplicate}, unsupported {s.skippedUnsupported}, failed{" "}
                      {s.failed}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* List */}
          <div className="rounded-xl border border-white/[0.06] bg-black/30 p-5">
            <p className="text-[11px] uppercase tracking-wider text-[#C9A44C] font-bold mb-3">
              Library Browser
            </p>
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Source
                <select
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  className="mt-1 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
                >
                  <option value="">All</option>
                  <option value="admin-zip">admin-zip</option>
                  <option value="drive">drive</option>
                </select>
              </label>
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Category
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="mt-1 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
                >
                  <option value="">All</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-[10.5px] uppercase tracking-wider text-white/45">
                Enabled
                <select
                  value={filterEnabled}
                  onChange={(e) => setFilterEnabled(e.target.value)}
                  className="mt-1 px-2 py-1.5 rounded bg-black/40 border border-white/[0.08] text-white text-[12px]"
                >
                  <option value="">Both</option>
                  <option value="true">Enabled only</option>
                  <option value="false">Disabled only</option>
                </select>
              </label>
            </div>
            {listQuery.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/40" />
            ) : listQuery.data ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {listQuery.data.rows.map((row) => (
                  <div
                    key={row.id}
                    className={`rounded-lg border ${row.enabled ? "border-white/[0.08]" : "border-rose-500/20 opacity-60"} bg-black/40 overflow-hidden`}
                  >
                    <div className="aspect-square bg-white/[0.04] flex items-center justify-center overflow-hidden">
                      {/* gcsUrl already includes the /api/portal/images/<file> base. */}
                      <img
                        src={row.gcsUrl}
                        alt={row.label || ""}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-2 space-y-1">
                      <p className="text-[10.5px] text-white/85 font-bold truncate" title={row.category || ""}>
                        {row.category || "(uncategorized)"}
                      </p>
                      <p className="text-[10px] text-white/45 truncate" title={row.originalFilename || row.label || ""}>
                        {row.originalFilename || row.label || `#${row.id}`}
                      </p>
                      <p className="text-[10px] text-white/40">
                        {row.source} · {row.genderHint}
                      </p>
                      <div className="flex gap-1 pt-1">
                        <button
                          onClick={() =>
                            toggleMutation.mutate({ id: row.id, enabled: !row.enabled })
                          }
                          disabled={toggleMutation.isPending}
                          className="flex-1 text-[10px] px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-white/80 flex items-center justify-center gap-1"
                          title={row.enabled ? "Disable" : "Enable"}
                        >
                          {row.enabled ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {row.enabled ? "Off" : "On"}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete scene #${row.id}? This cannot be undone from the UI.`)) {
                              deleteMutation.mutate(row.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="text-[10px] px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {listQuery.data.rows.length === 0 && (
                  <p className="col-span-full text-[12px] text-white/40">
                    No scenes match the current filter.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-rose-400">Failed to load list.</p>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
