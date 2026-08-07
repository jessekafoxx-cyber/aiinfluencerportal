import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, Loader2, Camera, Image as ImageIcon, Upload,
  Trash2, X, User, FolderPlus, Download, Maximize2, AlertTriangle,
  Pencil, Check,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { ActiveJobCard, type InfluencerJob } from "@/pages/your-influencers";
import { fetchApi, getAuthHeaders } from "@/lib/api";

const GOLD = "#C9A44C";

interface LightboxState {
  url: string;
  alt: string;
  filename: string;
}

interface AiInfluencer {
  id: number;
  // Server folds custom_name into `name` when set, so `name` always
  // holds the display value (custom if renamed, otherwise auto).
  name: string;
  customName: string | null;
  niche: string | null;
  avatarUrl: string | null;
  status: string;
}
interface InfluencerAngle {
  id: number;
  label: string | null;
  imageUrl: string;
  prompt: string | null;
}
interface SettingImage {
  id: number;
  imageUrl: string;
  label: string | null;
}
interface InfluencerSettingWithImages {
  id: number;
  name: string;
  description: string | null;
  images: SettingImage[];
}
interface InfluencerDetailResponse {
  influencer: AiInfluencer;
  angles: InfluencerAngle[];
  settings: InfluencerSettingWithImages[];
}

export default function InfluencerDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id;
  const qc = useQueryClient();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newSettingName, setNewSettingName] = useState("");
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  // Inline rename for the header. `isRenaming` toggles edit mode;
  // `renameError` surfaces validation/auth errors next to the input
  // (the list page uses a toast, but here we have room next to the
  // field).
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const renameInfluencer = useMutation({
    mutationFn: async (name: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/influencers/${id}/name`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Key": "room30",
          ...headers,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error || `http_${res.status}`);
      }
      return (await res.json()) as {
        id: number;
        customName: string | null;
        previousName: string;
      };
    },
    onSuccess: (result) => {
      qc.setQueryData<InfluencerDetailResponse | null>(["influencer", id], (prev) =>
        prev
          ? {
              ...prev,
              influencer: {
                ...prev.influencer,
                name: result.customName ?? prev.influencer.name,
                customName: result.customName,
              },
            }
          : prev,
      );
      qc.invalidateQueries({ queryKey: ["influencer", id] });
      qc.invalidateQueries({ queryKey: ["my-influencers"] });
      setIsRenaming(false);
      setRenameValue("");
      setRenameError(null);
    },
    onError: (e: Error) => {
      const code = e.message;
      setRenameError(
        code === "name_required"
          ? "Please enter a name."
          : code === "name_too_long"
            ? "Name must be 50 characters or fewer."
            : code === "name_invalid_chars"
              ? "Use only letters, numbers, spaces, hyphens, apostrophes, or periods."
              : code === "not_found"
                ? "Influencer not found."
                : code === "unauthenticated"
                  ? "Please sign in again."
                  : "Couldn't rename - please try again.",
      );
    },
  });

  function beginRename() {
    if (!data) return;
    setRenameValue(data.influencer.customName ?? data.influencer.name);
    setRenameError(null);
    setIsRenaming(true);
  }
  function cancelRename() {
    setIsRenaming(false);
    setRenameValue("");
    setRenameError(null);
  }
  function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Please enter a name.");
      return;
    }
    renameInfluencer.mutate(trimmed);
  }

  function openLightbox(url: string, alt: string, kind: string) {
    const fname = url.split("/").pop() || `${kind}-${Date.now()}.png`;
    setLightbox({ url, alt, filename: fname });
  }

  const detailKey = ["influencer", id];
  const { data, isLoading } = useQuery<InfluencerDetailResponse | null>({
    queryKey: detailKey,
    queryFn: async () => {
      // The influencers router is mounted at /api/influencers (NOT under
      // /api/portal). fetchApi() prepends API_BASE = "/api/portal" so
      // calling fetchApi("/influencers/55") hit /api/portal/influencers/55
      // which 404s. The catch swallowed it and returned null, which the
      // page renders as "Influencer not found." Use raw fetch with the
      // Bearer token, mirroring the working list query in your-influencers.
      const authHeaders = await getAuthHeaders();
      try {
        const res = await fetch(`/api/influencers/${id}`, {
          credentials: "include",
          headers: { "X-Portal-Key": "room30", ...authHeaders },
        });
        if (!res.ok) return null;
        return (await res.json()) as InfluencerDetailResponse;
      } catch {
        return null;
      }
    },
  });

  // Live cinematic pipeline: poll the user's jobs and surface any that
  // belong to this influencer. While in-flight we tighten the polling so
  // the timeline + placement grid feel real-time. Backend creates the
  // influencer at job creation time, so the workspace mounts immediately
  // with the pipeline card on top.
  const { data: jobsData } = useQuery<{ jobs: InfluencerJob[] }>({
    queryKey: ["influencer-jobs"],
    queryFn: async () => {
      try {
        return (await fetchApi("/influencer-jobs")) as { jobs: InfluencerJob[] };
      } catch {
        return { jobs: [] };
      }
    },
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.find(
        (j) =>
          j.influencerId === Number(id) &&
          j.status !== "ready" &&
          j.status !== "failed",
      );
      return active ? 2_500 : false;
    },
  });

  const [dismissedFailedIds, setDismissedFailedIds] = useState<Set<number>>(
    () => new Set(),
  );

  const pipelineJob = useMemo<InfluencerJob | null>(() => {
    const jobs = jobsData?.jobs ?? [];
    const mine = jobs.filter((j) => j.influencerId === Number(id));
    if (mine.length === 0) return null;
    // The visible pipeline state on the detail page is purely
    // ETA-driven, matching the gallery queue card. We keep showing the
    // in-flight banner until the simulated 28min-3h window elapses,
    // regardless of how the backend job is actually progressing.
    const inFlight = mine.find((j) => {
      if (j.status === "failed") return false;
      const etaMs = new Date(j.etaAt).getTime();
      if (!Number.isFinite(etaMs)) return false;
      return Date.now() < etaMs;
    });
    if (inFlight) return inFlight;
    const failed = mine.find((j) => j.status === "failed" && !dismissedFailedIds.has(j.id));
    if (failed) return failed;
    return null;
  }, [jobsData, id, dismissedFailedIds]);

  // When a job for this influencer flips from in-flight to terminal,
  // refresh the detail (avatar, settings, scene images may have
  // appeared) and the gallery quota.
  const prevPipelineStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPipelineStatusRef.current;
    const now = pipelineJob?.status ?? null;
    if (prev && prev !== now && (prev === "queued" || prev === "generating_base" || prev === "enhancing" || prev === "swapping_scenes")) {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: ["my-influencers"] });
      qc.invalidateQueries({ queryKey: ["influencer-quota"] });
    }
    prevPipelineStatusRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineJob?.status]);

  // One-click retry: re-dispatch a fresh pipeline run with the same
  // brief the failed job used. No modal needed - the workspace is
  // already the user's home for this influencer.
  // Task #388: retry through the dedicated /influencer-jobs/retry
  // endpoint, which REUSES the existing ai_influencers row instead of
  // creating a fresh "Influencer N" row. Quota is not double-consumed
  // (failed jobs already don't count) and the workspace URL stays the
  // same so the user does not have to navigate.
  const retry = useMutation({
    mutationFn: async (_job: InfluencerJob) => {
      return await fetchApi("/influencer-jobs/retry", {
        method: "POST",
        body: JSON.stringify({ influencerId: Number(id) }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["influencer-jobs"] });
      qc.invalidateQueries({ queryKey: ["influencer-quota"] });
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: ["my-influencers"] });
    },
  });

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await fetchApi("/me");
      } catch {
        return null;
      }
    },
  });
  const isSuperAdmin = !!me.data?.user?.isSuperAdmin;

  function refresh() {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: ["my-influencers"] });
  }

  async function api(
    path: string,
    init: RequestInit & { busy: string },
  ): Promise<Response> {
    setErr(null);
    setBusyKey(init.busy);
    const url = `/api/influencers/${id}${path}`;
    const { busy: _busy, ...fetchInit } = init as RequestInit & { busy: string };
    try {
      // eslint-disable-next-line no-console
      console.info("[influencer]", init.method || "GET", url);
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        credentials: "include",
        ...fetchInit,
        headers: { "X-Portal-Key": "room30", ...authHeaders, ...(fetchInit.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) {
        const t = await res.text();
        let msg = t || `Request failed (${res.status})`;
        try {
          const j = JSON.parse(t);
          msg = j?.message || j?.error || msg;
        } catch {}
        // eslint-disable-next-line no-console
        console.error("[influencer] failed", res.status, msg);
        throw new Error(msg);
      }
      return res;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("[influencer] network error", url, e);
      setErr(e?.message || "Something went wrong");
      throw e;
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadMain(file: File) {
    const fd = new FormData();
    fd.append("image", file);
    try {
      await api("/main-image", { method: "POST", body: fd, busy: "main" });
      refresh();
    } catch {}
  }

  async function clearMain() {
    if (!confirm("Remove main image?")) return;
    try {
      await api("/main-image", { method: "DELETE", busy: "main" });
      refresh();
    } catch {}
  }

  async function uploadAngles(files: FileList) {
    if (files.length === 0) return;
    // One file per request. Batching multiple phone-camera photos into a
    // single multipart body trips the upstream proxy's ~32MB inbound cap
    // (returns HTML 413 before reaching Express), even though multer
    // itself allows 100MB per file. Sequential single uploads stay well
    // under the cap and let partial successes through if one file fails.
    let failed = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("images", f);
      try {
        await api("/angles", { method: "POST", body: fd, busy: "angles" });
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      alert(
        `${failed} of ${files.length} image(s) failed to upload. Try the failed ones again, or use smaller files.`,
      );
    }
    refresh();
  }

  async function deleteAngle(angleId: number) {
    if (!confirm("Delete this angle image?")) return;
    try {
      await api(`/angles/${angleId}`, { method: "DELETE", busy: `angle-${angleId}` });
      refresh();
    } catch {}
  }

  async function addSetting() {
    const name = newSettingName.trim();
    if (!name) return;
    try {
      await api("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        busy: "new-setting",
      });
      setNewSettingName("");
      refresh();
    } catch {}
  }

  async function deleteSetting(settingId: number, name: string) {
    if (!confirm(`Delete the "${name}" bucket and all its images?`)) return;
    try {
      await api(`/settings/${settingId}`, {
        method: "DELETE",
        busy: `setting-${settingId}`,
      });
      refresh();
    } catch {}
  }

  async function uploadSettingImages(settingId: number, files: FileList) {
    if (files.length === 0) return;
    // Same proxy 32MB cap rationale as uploadAngles - send one file per
    // request instead of batching. Server route already accepts arrays
    // of 1..N, so the single-file path is the same code path on the API.
    let failed = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("images", f);
      try {
        await api(`/settings/${settingId}/images`, {
          method: "POST",
          body: fd,
          busy: `setting-up-${settingId}`,
        });
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      alert(
        `${failed} of ${files.length} image(s) failed to upload. Try the failed ones again, or use smaller files.`,
      );
    }
    refresh();
  }

  async function deleteSettingImage(settingId: number, imageId: number) {
    if (!confirm("Delete this image?")) return;
    try {
      await api(`/settings/${settingId}/images/${imageId}`, {
        method: "DELETE",
        busy: `simg-${imageId}`,
      });
      refresh();
    } catch {}
  }

  async function deleteInfluencer() {
    if (!data) return;
    if (!confirm(`Delete ${data.influencer.name}? This removes all uploaded images.`)) return;
    try {
      await api("", { method: "DELETE", busy: "delete-influencer" });
      qc.invalidateQueries({ queryKey: ["my-influencers"] });
      setLocation("/your-influencers");
    } catch {}
  }

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-6 py-10" data-page="my-influencers">
        <button
          onClick={() => setLocation("/your-influencers")}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Back to influencers
        </button>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        ) : !data ? (
          <div className="text-white/60">Influencer not found.</div>
        ) : (
          <>
            {/* Task #388: surface failed (and any in-flight) pipeline state
                directly on the workspace so a stuck-in-queue user can see
                why and click Retry without leaving the page. */}
            {pipelineJob && ((job: InfluencerJob) => (
                <ActiveJobCard
                  job={job}
                  isSuperAdmin={isSuperAdmin}
                  onView={() => {
                    /* already on the workspace */
                  }}
                  onSkipped={() =>
                    qc.invalidateQueries({ queryKey: ["influencer-jobs"] })
                  }
                  onRetry={() => retry.mutate(job)}
                  onDismiss={
                    job.status === "failed"
                      ? () =>
                          setDismissedFailedIds((prev) => {
                            const next = new Set(prev);
                            next.add(job.id);
                            return next;
                          })
                      : undefined
                  }
                />
            ))(pipelineJob as InfluencerJob)}

            {/* Header card */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 mb-8">
              <div className="flex gap-6 items-start flex-wrap">
                <div className="w-28 h-28 rounded-xl overflow-hidden bg-white/[0.05] flex-shrink-0 flex items-center justify-center">
                  {data.influencer.avatarUrl ? (
                    <img
                      src={data.influencer.avatarUrl}
                      alt={data.influencer.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-10 h-10 text-white/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {isRenaming ? (
                    <div className="mb-2">
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={50}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            submitRename();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        disabled={renameInfluencer.isPending}
                        placeholder="e.g. Luna Martinez"
                        data-testid="input-rename-detail"
                        className="w-full max-w-md rounded-lg border border-[#C9A44C]/40 bg-white/[0.04] px-3 py-2 text-2xl font-semibold text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]"
                      />
                      <div className="text-[10px] text-white/40 mt-1">
                        {renameValue.trim().length}/50 - letters, numbers, spaces, - ' . only
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={submitRename}
                          disabled={renameInfluencer.isPending || !renameValue.trim()}
                          data-testid="button-save-rename-detail"
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-black text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                          style={{ background: GOLD }}
                        >
                          {renameInfluencer.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving</>
                          ) : (
                            <><Check className="w-3.5 h-3.5" /> Save</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          disabled={renameInfluencer.isPending}
                          data-testid="button-cancel-rename-detail"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-white/70 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.06]"
                        >
                          Cancel
                        </button>
                      </div>
                      {renameError && (
                        <div className="text-xs text-red-300 mt-2" role="alert">{renameError}</div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1 min-w-0">
                      <h1 className="text-2xl font-semibold text-white truncate min-w-0">
                        {data.influencer.name}
                      </h1>
                      <button
                        type="button"
                        onClick={beginRename}
                        aria-label={`Rename ${data.influencer.name}`}
                        title="Rename"
                        data-testid="button-rename-detail"
                        className="inline-flex items-center justify-center w-7 h-7 rounded text-white/40 hover:text-white hover:bg-white/[0.06] flex-shrink-0"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {data.influencer.niche && (
                    <div className="text-white/55 text-sm mb-3 truncate">{data.influencer.niche}</div>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs uppercase tracking-wider text-white/40">
                    <span>{data.angles.length} angles</span>
                    <span>{data.settings.length} settings</span>
                  </div>
                </div>
                <button
                  onClick={deleteInfluencer}
                  disabled={busyKey === "delete-influencer"}
                  className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-red-400 border border-white/10 hover:border-red-400/40 rounded-lg px-3 py-2"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>

            {err && (
              <div className="mb-6 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                {err}
              </div>
            )}

            {/* MAIN IMAGE */}
            <Section title="Main Image" icon={<User className="w-4 h-4" style={{ color: GOLD }} />}>
              <div className="flex items-start gap-4 flex-wrap">
                <div className="relative w-48 h-48 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.06] group">
                  {data.influencer.avatarUrl ? (
                    <>
                      <ImageWithFallback
                        src={thumb(data.influencer.avatarUrl, 500)}
                        alt={data.influencer.name}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={() =>
                          openLightbox(
                            data.influencer.avatarUrl!,
                            data.influencer.name,
                            "main",
                          )
                        }
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none flex items-center justify-center">
                        <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-90 transition-opacity" />
                      </div>
                      <button
                        onClick={clearMain}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-red-500/80 text-white flex items-center justify-center z-10"
                        title="Remove main image"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30">
                      <User className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm text-white/55 mb-3">
                    The hero shot for this influencer. Upload one image; replace
                    it any time.
                  </p>
                  <UploadButton
                    label={data.influencer.avatarUrl ? "Replace main image" : "Upload main image"}
                    busy={busyKey === "main"}
                    accept="image/*"
                    onFiles={(fl) => fl[0] && uploadMain(fl[0])}
                  />
                </div>
              </div>
            </Section>

            {/* ANGLES */}
            <Section
              title="Angles"
              icon={<Camera className="w-4 h-4" style={{ color: GOLD }} />}
              right={
                <UploadButton
                  label="Add angle images"
                  busy={busyKey === "angles"}
                  multiple
                  accept="image/*"
                  onFiles={uploadAngles}
                />
              }
            >
              {data.angles.length === 0 ? (
                <EmptyHint text="No angle shots yet. Upload a few to build out your roster." />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {data.angles.map((a) => (
                    <ImageTile
                      key={a.id}
                      url={a.imageUrl}
                      alt={a.label ?? "angle"}
                      onDelete={() => deleteAngle(a.id)}
                      onOpen={() =>
                        openLightbox(a.imageUrl, a.label ?? "angle", "angle")
                      }
                      busy={busyKey === `angle-${a.id}`}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* SETTINGS */}
            <Section
              title="Settings"
              icon={<ImageIcon className="w-4 h-4" style={{ color: GOLD }} />}
              right={
                <div className="flex items-center gap-2">
                  <input
                    value={newSettingName}
                    onChange={(e) => setNewSettingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSetting();
                    }}
                    placeholder="New setting (e.g. podcast, car, walking)"
                    className="text-sm bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none w-64 max-w-[60vw]"
                    maxLength={80}
                  />
                  <button
                    onClick={addSetting}
                    disabled={!newSettingName.trim() || busyKey === "new-setting"}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-black font-bold uppercase text-[11px] tracking-wider disabled:opacity-50"
                    style={{ background: GOLD }}
                  >
                    {busyKey === "new-setting" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderPlus className="w-3.5 h-3.5" />
                    )}
                    Add
                  </button>
                </div>
              }
            >
              {data.settings.length === 0 ? (
                <EmptyHint text="No settings yet. Create a bucket above (podcast, car, walking, gym, anywhere you want consistent shots) and start uploading." />
              ) : (
                <div className="space-y-5">
                  {data.settings.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
                    >
                      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                        <div>
                          <div className="text-white font-semibold">{s.name}</div>
                          <div className="text-xs text-white/40 mt-0.5">
                            {s.images.length} {s.images.length === 1 ? "image" : "images"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <UploadButton
                            label="Add images"
                            busy={busyKey === `setting-up-${s.id}`}
                            multiple
                            accept="image/*"
                            small
                            onFiles={(fl) => uploadSettingImages(s.id, fl)}
                          />
                          <button
                            onClick={() => deleteSetting(s.id, s.name)}
                            disabled={busyKey === `setting-${s.id}`}
                            className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-red-400 border border-white/10 hover:border-red-400/40 rounded-lg px-3 py-2"
                            title="Delete this setting"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {s.images.length === 0 ? (
                        <div className="text-xs text-white/40">No images yet.</div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                          {s.images.map((img) => (
                            <ImageTile
                              key={img.id}
                              url={img.imageUrl}
                              alt={img.label ?? s.name}
                              onDelete={() => deleteSettingImage(s.id, img.id)}
                              onOpen={() =>
                                openLightbox(img.imageUrl, img.label ?? s.name, "setting")
                              }
                              busy={busyKey === `simg-${img.id}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
      {lightbox && (
        <Lightbox state={lightbox} onClose={() => setLightbox(null)} />
      )}
    </PortalLayout>
  );
}

// ── tiny components ─────────────────────────────────────────────

function Section({
  title, icon, children, right,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="text-sm text-white/50 rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
      {text}
    </div>
  );
}

function UploadButton({
  label, busy, accept, multiple, small, onFiles,
}: {
  label: string;
  busy: boolean;
  accept?: string;
  multiple?: boolean;
  small?: boolean;
  onFiles: (files: FileList) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const padding = small ? "px-3 py-2 text-[11px]" : "px-4 py-2.5 text-[12px]";
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-lg text-black font-bold uppercase tracking-wider disabled:opacity-50 ${padding}`}
        style={{ background: GOLD }}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept ?? "image/*"}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
          }
          if (ref.current) ref.current.value = "";
        }}
      />
    </>
  );
}

function ImageTile({
  url, alt, onDelete, onOpen, busy,
}: {
  url: string;
  alt: string;
  onDelete: () => void;
  onOpen: () => void;
  busy: boolean;
}) {
  return (
    <div className="relative group rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06]">
      <button
        type="button"
        onClick={onOpen}
        className="block aspect-square w-full cursor-zoom-in"
        title="Click to preview full size"
      >
        <ImageWithFallback
          src={thumb(url, 400)}
          alt={alt}
          className="w-full h-full object-cover"
        />
      </button>
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors pointer-events-none flex items-center justify-center">
        <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-90 transition-opacity" />
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={busy}
        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 hover:bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 z-10"
        title="Delete"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// Append ?w=NUMBER to ask the API for an on-the-fly webp thumbnail. Grid
// tiles render at ~150-200 CSS px so 400 covers retina displays comfortably
// while shrinking a 4 MB original PNG down to ~30 KB.
function thumb(url: string, width: number) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${width}`;
}

function ImageWithFallback({
  src, alt, className, onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 text-center text-[10px] text-amber-300/80 bg-amber-500/[0.06] p-2 ${className ?? ""}`}
        title={src}
      >
        <AlertTriangle className="w-4 h-4" />
        <div className="leading-tight break-all px-1">Failed to load</div>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      loading="lazy"
      decoding="async"
      onError={() => {
        // eslint-disable-next-line no-console
        console.error("[influencer] image failed to load", src);
        setFailed(true);
      }}
    />
  );
}

async function downloadImage(url: string, filename: string) {
  // Ask the image proxy for an attachment response (?download=1) so the
  // browser saves the file rather than rendering it inline. The route is
  // same-origin and public, and ?download=1 is a distinct cache key from
  // the inline preview bytes, so the two never collide.
  const sep = url.includes("?") ? "&" : "?";
  const dlUrl = `${url}${sep}download=1`;
  try {
    const res = await fetch(dlUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[influencer] download failed", e);
    // Fallback: navigate straight to the attachment URL. With
    // Content-Disposition: attachment the browser saves the file instead
    // of opening it inline in a new tab (the old window.open behaviour).
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function Lightbox({
  state, onClose,
}: {
  state: LightboxState;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadImage(state.url, state.filename);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview uses a 1600px webp (~150 KB) so it appears instantly. The
            Download button still grabs the full-resolution original from
            state.url so the saved file is the master asset, not the thumbnail. */}
        <img
          src={thumb(state.url, 1600)}
          alt={state.alt}
          className="max-w-[95vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          decoding="async"
          onError={() => {
            // eslint-disable-next-line no-console
            console.error("[influencer] lightbox image failed", state.url);
          }}
        />
        <div className="mt-4 flex items-center gap-3 flex-wrap justify-center">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-black font-bold uppercase tracking-wider text-[12px] disabled:opacity-50"
            style={{ background: GOLD }}
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white/85 font-medium tracking-wide text-[12px] border border-white/15 hover:bg-white/5"
          >
            <X className="w-4 h-4" /> Close
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 w-9 h-9 rounded-full bg-black/80 hover:bg-white/10 text-white flex items-center justify-center border border-white/20"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
