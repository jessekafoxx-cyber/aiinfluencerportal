import { useEffect, useMemo, useRef, useState } from "react";
import { PortalLayout } from "@/components/portal-layout";
import {
  Users, Sparkles, Loader2, Camera, Image as ImageIcon, Search, Plus,
  Wand2, X as XIcon, CheckCircle2, AlertCircle, FastForward, Gift,
  Pencil, Check, Upload, Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchApi, fetchAuthed, getAuthHeaders } from "@/lib/api";
import { PurchasingMovedNotice } from "@/components/purchasing-moved-notice";
import {
  useCreditTopUpCelebration,
  useRefetchOnRefocus,
} from "@/hooks/use-unlock-celebration";
import { usePurchaseLinks } from "@/hooks/use-purchase-links";

const GOLD = "#C9A44C";

interface InfluencerListItem {
  id: number;
  // Server folds custom_name into `name` when set, so `name` always
  // holds the display value (custom if renamed, otherwise auto).
  // `customName` is the raw column - null until the buyer renames.
  name: string;
  customName: string | null;
  niche: string | null;
  avatarUrl: string | null;
  status: string;
  anglesCount: number;
  settingsCount: number;
}

interface InfluencersResponse {
  influencers: InfluencerListItem[];
}

export interface InfluencerJob {
  id: number;
  status:
    | "queued"
    | "generating_base"
    | "enhancing"
    | "swapping_scenes"
    | "ready"
    | "ready_degraded"
    | "failed";
  progress: number;
  prefs: {
    ageRange: string;
    ethnicity: string;
    gender: string;
    vibe: string;
    notes?: string | null;
  };
  baseImageUrl: string | null;
  enhancedImageUrl: string | null;
  sceneImageUrls: Array<{ url: string; label: string }>;
  etaAt: string;
  isFreeTier: boolean;
  failureReason: string | null;
  completedAt: string | null;
  influencerId: number | null;
  createdAt: string;
  stageLabel?: string;
  stageDetail?: string | null;
}

interface JobsResponse {
  jobs: InfluencerJob[];
}

interface InfluencerQuota {
  used: number;
  total: number;
  bonusUnlocked: boolean;
  unlockSeen: boolean;
}

const AGE_OPTIONS = [
  { value: "18-24", label: "18 - 24" },
  { value: "25-32", label: "25 - 32" },
  { value: "33-40", label: "33 - 40" },
  { value: "41-50", label: "41 - 50" },
  { value: "51-65", label: "51 - 65" },
];

const ETHNICITY_OPTIONS = [
  { value: "white", label: "White / European" },
  { value: "black", label: "Black / African" },
  { value: "east_asian", label: "East Asian" },
  { value: "south_asian", label: "South Asian" },
  { value: "hispanic_latino", label: "Hispanic / Latino" },
  { value: "middle_eastern", label: "Middle Eastern" },
  { value: "mixed", label: "Mixed" },
];

const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
];

// Task #442 / Task #446 - hairstyle and facial-hair were originally
// explicit dropdowns. The user requested a minimal, premium-looking
// modal, so both dropdowns are removed and the backend's
// `influencer-notes-extractor` now parses these traits out of the
// free-text "Anything else?" field (e.g. "slight beard", "quiff",
// "buzz cut", "blonde curly hair"). The route and the
// CharacterProfile builder fold the extracted canonical values into
// `prefs.facialHair` / `prefs.hairstyle` so the rest of the pipeline
// (DNA sampler, master prompt, scene swaps, retry prompts, QA) is
// unchanged.

const VIBE_PRESETS = [
  "Soft luxury, quiet wealth",
  "Bold, high-energy, creator vibes",
  "Athletic, outdoors, sun-kissed",
  "Cozy, warm, relatable",
  "Editorial, fashion-forward",
  "Minimalist, clean, professional",
];

export default function YourInfluencers() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [showManualUpload, setShowManualUpload] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const { links: purchaseLinks } = usePurchaseLinks();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isSuperAdmin = !!me?.user?.isSuperAdmin;

  // Auto-open the Generate modal when arriving from the first-time intro
  // popup. Two triggers are supported so the modal opens whether or not the
  // page remounts:
  //   1) URL ?open=generate (handled on mount and on subsequent location
  //      changes via a popstate listener)
  //   2) A custom "room30:open-generate-influencer" window event the popup
  //      dispatches right before navigating, so users already on this page
  //      still see the modal pop open.
  // The query param is stripped after handling so a refresh does not
  // re-trigger the modal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function maybeOpenFromUrl() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("open") === "generate") {
        setShowGenerate(true);
        params.delete("open");
        const rest = params.toString();
        const next = window.location.pathname + (rest ? `?${rest}` : "");
        window.history.replaceState({}, "", next);
      }
    }
    function onCustom() {
      setShowGenerate(true);
    }
    maybeOpenFromUrl();
    window.addEventListener("popstate", maybeOpenFromUrl);
    window.addEventListener(
      "room30:open-generate-influencer",
      onCustom as EventListener,
    );
    return () => {
      window.removeEventListener("popstate", maybeOpenFromUrl);
      window.removeEventListener(
        "room30:open-generate-influencer",
        onCustom as EventListener,
      );
    };
  }, []);

  const { data, isLoading } = useQuery<InfluencersResponse>({
    queryKey: ["my-influencers"],
    queryFn: async () => {
      // requireAuth on the API side checks the Clerk Bearer token, so this
      // GET MUST send the Authorization header. Plain credentials-only
      // fetch returned 401, the !res.ok branch silently swallowed it, and
      // the page rendered "No influencers yet" even when ai_influencers
      // rows existed for this client. Use the same auth helper as
      // fetchApi/fetchAuthed (the /api/influencers prefix is outside
      // API_BASE so we cannot reuse fetchAuthed directly here).
      const headers = await getAuthHeaders();
      const res = await fetch("/api/influencers", {
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        // Surface auth/storage failures (e.g. 401/403 token drift, 500
        // object-storage errors) instead of silently rendering an empty
        // "No influencers yet" page, which hides the real cause from CS.
        console.error(`[your-influencers] GET /api/influencers failed: ${res.status}`);
        return { influencers: [] };
      }
      return (await res.json()) as InfluencersResponse;
    },
  });

  const { data: jobsData } = useQuery<JobsResponse>({
    queryKey: ["influencer-jobs"],
    queryFn: async () => {
      // Same auth fix as the influencers list above. fetchAuthed prepends
      // API_BASE ("/api/portal") so calling fetchAuthed("/influencer-jobs")
      // hits the right route with the Bearer token attached.
      const res = await fetchAuthed("/influencer-jobs");
      if (!res.ok) {
        console.error(`[your-influencers] GET /api/portal/influencer-jobs failed: ${res.status}`);
        return { jobs: [] };
      }
      return (await res.json()) as JobsResponse;
    },
    // Cinematic refactor (T354): tighten polling so the stage timeline
    // and progress bar feel real-time. Stops polling once the job is
    // terminal (ready or failed) to avoid wasting cycles.
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.find((j) => j.status !== "ready" && j.status !== "ready_degraded" && j.status !== "failed");
      return active ? 2_500 : false;
    },
  });

  const allJobs = jobsData?.jobs ?? [];
  // A job stays "in-flight" for the UI until its persisted ETA window
  // has fully elapsed - even if the backend pipeline finishes early.
  // This keeps the queue card and countdown honest to the time we
  // promised the user, instead of snapping to "almost ready" the moment
  // the real generation completes.
  const inFlightJob = useMemo(() => {
    // The visible queue is purely ETA-driven now. Even if the backend
    // pipeline finishes early, we keep the influencer "in the queue"
    // until the randomized 28min-3h window elapses, so the experience
    // feels like a real hand-crafted build. The only state that breaks
    // out of the queue early is an explicit failure.
    return (
      allJobs.find((j) => {
        if (j.status === "failed") return false;
        const etaMs = new Date(j.etaAt).getTime();
        if (!Number.isFinite(etaMs)) return false;
        return Date.now() < etaMs;
      }) ?? null
    );
  }, [allJobs]);

  // When an in-flight job transitions to ready/failed, refresh the
  // gallery + quota so the new influencer tile / counter update without
  // a manual reload. The identity pipeline card itself now lives on the
  // /influencer/:id workspace, not on this page.
  const prevInFlightIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevInFlightIdRef.current;
    const currentId = inFlightJob?.id ?? null;
    if (prev != null && currentId !== prev) {
      queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
    }
    prevInFlightIdRef.current = currentId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlightJob?.id]);

  // Task #283: quota state for the bonus AR influencer pack. Drives the
  // quota indicator near the top of the page, the Generate button enable
  // state, and the one-time celebratory unlock popup for Upsell 2 buyers.
  const { data: quota } = useQuery<InfluencerQuota>({
    queryKey: ["influencer-quota"],
    queryFn: async () => {
      try {
        return (await fetchApi("/influencer-jobs/quota")) as InfluencerQuota;
      } catch {
        return { used: 0, total: 1, bonusUnlocked: false, unlockSeen: true };
      }
    },
  });

  const total = quota?.total ?? 1;
  const used = quota?.used ?? (jobsData?.jobs ?? []).length;
  const bonusUnlocked = !!quota?.bonusUnlocked;
  const remaining = Math.max(0, total - used);
  const canGenerate = remaining > 0 && !inFlightJob;

  // Task #9: the buy-credits overlay sends the buyer to the external GHL
  // sales page in a new tab. When they tab back after paying, force-refresh
  // the quota (React Query's focus refetch respects staleTime) and, once the
  // webhook has granted the extra generation(s), close the overlay and toast
  // instead of leaving the "Upgrade now" CTA sitting open.
  useRefetchOnRefocus(showBuyCredits, () => {
    void queryClient.refetchQueries({ queryKey: ["influencer-quota"] });
  });
  useCreditTopUpCelebration({
    active: showBuyCredits,
    balance: quota ? remaining : null,
    label: "influencer generation",
    onToppedUp: () => setShowBuyCredits(false),
  });

  // One-time unlock popup: render when the buyer has the bonus pack but
  // has not yet acknowledged it. The flag is server-tracked so the popup
  // never reappears once dismissed, even on a different device.
  const [showUnlockPopup, setShowUnlockPopup] = useState(false);
  useEffect(() => {
    if (quota && quota.bonusUnlocked && !quota.unlockSeen) {
      setShowUnlockPopup(true);
    }
  }, [quota]);

  const markUnlockSeen = useMutation({
    mutationFn: async () => {
      await fetchAuthed("/influencer-jobs/unlock-seen", { method: "POST" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
    },
  });

  function dismissUnlockPopup() {
    setShowUnlockPopup(false);
    markUnlockSeen.mutate();
  }

  const influencers = data?.influencers ?? [];

  // Task #388: index the latest failed job per influencerId so the
  // gallery card can surface a short failure reason and a one-click
  // Retry button without forcing the user into the workspace.
  const failedJobByInfluencerId = useMemo(() => {
    const map = new Map<number, InfluencerJob>();
    for (const j of allJobs) {
      if (j.status !== "failed" || j.influencerId == null) continue;
      const prior = map.get(j.influencerId);
      if (!prior || j.id > prior.id) map.set(j.influencerId, j);
    }
    return map;
  }, [allJobs]);

  // An "orphan failed" job is the latest job overall, in a failed state, that
  // never materialized an influencer row (influencerId == null) - e.g. a job
  // the team never delivered that the overdue watchdog auto-failed at 72h, or
  // a base-generation failure before any ai_influencers row existed. Such a
  // job is represented by NEITHER the in-flight QueueCard (it's terminal) nor
  // the gallery's failedJobByInfluencerId map (that needs influencerId != null),
  // so without this branch the buyer would just see the empty/build state with
  // no acknowledgement that their previous build failed. We surface the same
  // QueueCard in its failed state with a Retry that opens the Generate modal
  // (a fresh job, since there's no influencer row to retry against).
  const orphanFailedJob = useMemo(() => {
    if (inFlightJob) return null;
    let latest: InfluencerJob | null = null;
    for (const j of allJobs) {
      if (!latest || j.id > latest.id) latest = j;
    }
    if (!latest || latest.status !== "failed" || latest.influencerId != null) {
      return null;
    }
    return latest;
  }, [allJobs, inFlightJob]);

  // Retry directly from the gallery card. Hits the dedicated retry
  // endpoint which reuses the existing ai_influencers row.
  const retryFromList = useMutation({
    mutationFn: async (influencerId: number) => {
      return await fetchApi("/influencer-jobs/retry", {
        method: "POST",
        body: JSON.stringify({ influencerId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["influencer-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
      queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
    },
  });

  // Inline rename state: which card is currently in edit mode and the
  // transient input value. Optimistic UI is handled by patching the
  // ["my-influencers"] cache on success; we keep a small toast for
  // failures so the buyer sees a clear reason.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameToast, setRenameToast] = useState<string | null>(null);
  useEffect(() => {
    if (!renameToast) return;
    const t = window.setTimeout(() => setRenameToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [renameToast]);

  const renameInfluencer = useMutation({
    mutationFn: async (vars: { id: number; name: string }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/influencers/${vars.id}/name`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Key": "room30",
          ...headers,
        },
        body: JSON.stringify({ name: vars.name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const code = body?.error || `http_${res.status}`;
        throw new Error(code);
      }
      return (await res.json()) as {
        id: number;
        customName: string | null;
        previousName: string;
      };
    },
    onSuccess: (result) => {
      // Optimistic cache patch so the new name shows immediately,
      // before the next list refetch lands.
      queryClient.setQueryData<InfluencersResponse | undefined>(
        ["my-influencers"],
        (prev) =>
          prev
            ? {
                ...prev,
                influencers: prev.influencers.map((inf) =>
                  inf.id === result.id
                    ? { ...inf, name: result.customName ?? inf.name, customName: result.customName }
                    : inf,
                ),
              }
            : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
      setRenamingId(null);
      setRenameValue("");
    },
    onError: (err: Error) => {
      const msg =
        err.message === "name_required"
          ? "Please enter a name."
          : err.message === "name_too_long"
            ? "Name must be 50 characters or fewer."
            : err.message === "name_invalid_chars"
              ? "Use only letters, numbers, spaces, hyphens, apostrophes, or periods."
              : err.message === "not_found"
                ? "Influencer not found."
                : err.message === "unauthenticated"
                  ? "Please sign in again."
                  : "Couldn't rename - please try again.";
      setRenameToast(msg);
    },
  });

  function beginRename(inf: InfluencerListItem) {
    setRenamingId(inf.id);
    setRenameValue(inf.customName ?? inf.name);
  }
  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }
  function submitRename(id: number) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameToast("Please enter a name.");
      return;
    }
    renameInfluencer.mutate({ id, name: trimmed });
  }

  // Custom confirm dialog state for the Cancel action - matches our
  // dark gold theme instead of the browser's native alert dialog.
  const [cancelTarget, setCancelTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

  // Cancel a failed influencer: deletes the row so the gallery is
  // clean if the user decides not to retry. Quota is unaffected
  // (failed jobs already don't count).
  const cancelFromList = useMutation({
    mutationFn: async (influencerId: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/influencers/${influencerId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Portal-Key": "room30", ...headers },
      });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
      queryClient.invalidateQueries({ queryKey: ["influencer-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
    },
  });
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return influencers;
    return influencers.filter((i) =>
      [i.name, i.niche ?? ""].some((s) => s.toLowerCase().includes(needle)),
    );
  }, [influencers, q]);

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto px-6 py-10" data-page="my-influencers">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6" style={{ color: GOLD }} />
            <h1 className="text-2xl font-semibold text-white">My Influencers</h1>
          </div>
          <div className="flex items-center gap-2">
            {canGenerate ? (
              <button
                onClick={() => setShowGenerate(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-black font-bold uppercase text-[12px] tracking-wider"
                style={{ background: GOLD }}
                data-testid="button-generate-free-influencer"
                title={
                  bonusUnlocked
                    ? `${remaining} of ${total} generations remaining`
                    : undefined
                }
              >
                <Wand2 className="w-4 h-4" />
                {bonusUnlocked ? "Generate Influencer" : "Generate Free Influencer"}
              </button>
            ) : null}
            <button
              onClick={() => setShowBuyCredits(true)}
              className={
                remaining === 0
                  ? "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-black font-bold uppercase text-[12px] tracking-wider"
                  : "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white border border-[#C9A44C]/40 hover:bg-[#C9A44C]/10 text-[12px] font-bold uppercase tracking-wider"
              }
              style={remaining === 0 ? { background: GOLD } : { color: GOLD }}
              data-testid="button-buy-influencer-credits"
              title="Buy more influencer generations ($29 each)"
            >
              <Sparkles className="w-4 h-4" />
              {remaining === 0 ? "Buy a Generation - $29" : "Buy More - $29 each"}
            </button>
            {canGenerate ? (
              <button
                onClick={() => setLocation("/buy-influencer")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white border border-white/15 hover:bg-white/[0.04] text-[12px] font-bold uppercase tracking-wider"
                data-testid="button-new-influencer"
                title={`${remaining} of ${total} generations remaining`}
              >
                <Plus className="w-4 h-4" /> Use a Generation
              </button>
            ) : null}
            <button
              onClick={() => setShowManualUpload(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white border border-white/15 hover:bg-white/[0.04] text-[12px] font-bold uppercase tracking-wider"
              data-testid="button-upload-your-own"
              title="Upload your own images - free, no generation used"
            >
              <Upload className="w-4 h-4" /> Upload Your Own
            </button>
          </div>
        </div>

        {showManualUpload && (
          <ManualUploadModal
            onClose={() => setShowManualUpload(false)}
            onCreated={(newId) => {
              setShowManualUpload(false);
              queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
              setLocation(`/influencer/${newId}`);
            }}
          />
        )}

        {showBuyCredits && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md">
              <PurchasingMovedNotice
                label="Influencer credit"
                // Reserved slug: admins configure an "influencer-credits"
                // product with a Purchase URL for this surface.
                purchaseUrl={purchaseLinks["influencer-credits"]}
                onCancel={() => setShowBuyCredits(false)}
              />
            </div>
          </div>
        )}

        {quota && quota.total > 0 ? (
          <QuotaIndicator
            used={used}
            total={total}
            bonusUnlocked={bonusUnlocked}
            atCap={remaining === 0}
          />
        ) : null}

        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or niche..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none text-sm"
          />
        </div>

        {inFlightJob ? (
          <QueueCard
            job={inFlightJob}
            onOpen={() => {
              if (inFlightJob.influencerId) {
                setLocation(`/influencer/${inFlightJob.influencerId}`);
              }
            }}
            onRetry={() => setShowGenerate(true)}
          />
        ) : orphanFailedJob ? (
          <QueueCard
            job={orphanFailedJob}
            onOpen={() => {}}
            onRetry={() => setShowGenerate(true)}
          />
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        ) : influencers.length === 0 && !inFlightJob && !orphanFailedJob && remaining > 0 ? (
          <div className="rounded-2xl border border-[#C9A44C]/30 bg-gradient-to-b from-[#C9A44C]/[0.06] to-white/[0.01] p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center" style={{ background: `${GOLD}1f`, border: `1px solid ${GOLD}55` }}>
              <Sparkles className="w-8 h-8" style={{ color: GOLD }} />
            </div>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: GOLD }}>
              Included with your purchase
            </p>
            <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: "var(--app-font-display)" }}>
              Build your first AI influencer - free
            </h2>
            <p className="text-white/60 mb-7 max-w-md mx-auto leading-[1.6]">
              We'll craft a unique portrait, refine the skin, then place her into
              10 different real-world settings - delivered straight to this page.
              It only takes a minute to start.
            </p>
            <button
              onClick={() => setShowGenerate(true)}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-black text-base font-bold uppercase tracking-wider shadow-lg hover:scale-[1.02] transition-transform"
              style={{ background: GOLD, boxShadow: `0 10px 30px -8px ${GOLD}80` }}
              data-testid="button-generate-empty"
            >
              <Wand2 className="w-5 h-5" /> Build my free influencer
            </button>
          </div>
        ) : influencers.length === 0 && !inFlightJob && !orphanFailedJob ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
            <Sparkles className="w-10 h-10 mx-auto mb-4 text-white/30" />
            <h2 className="text-lg font-medium text-white mb-2">
              No influencers yet
            </h2>
            <p className="text-white/60 mb-6 max-w-md mx-auto">
              You've used all your generations. Buy another to build a new AI
              influencer.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-white/50 rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 text-center">
            No influencers match "{q}".
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((inf) => {
              // Lock any influencer that has an in-flight job tied to it
              // (the queue card up top is generating its assets) or whose
              // status hasn't reached "active" yet. Everything else - i.e.
              // every previously-finished influencer - stays clickable.
              const isLockedByJob =
                !!inFlightJob &&
                inFlightJob.influencerId !== null &&
                inFlightJob.influencerId === inf.id;
              const isActive = inf.status === "active" && !isLockedByJob;
              // Task #388: a pipeline failure now mirrors onto the
              // influencer row as status='failed'. Surface it as a
              // distinct "Generation failed" badge instead of the
              // generic "In the queue" placeholder so the user can
              // tell the build is dead and click Generate again.
              const isFailedInfluencer = inf.status === "failed" && !isLockedByJob;
              const failedJob = isFailedInfluencer
                ? failedJobByInfluencerId.get(inf.id) ?? null
                : null;
              const failureReason = failedJob?.failureReason ?? null;
              const isRetrying =
                retryFromList.isPending &&
                retryFromList.variables === inf.id;
              const isCanceling =
                cancelFromList.isPending &&
                cancelFromList.variables === inf.id;
              const isRenaming = renamingId === inf.id;
              return (
              <div key={inf.id} className="relative">
              {isRenaming && (
                <div
                  className="absolute inset-0 z-10 rounded-xl border border-[#C9A44C]/40 bg-[#0a0a0a] p-4 flex flex-col"
                  data-testid={`rename-card-${inf.id}`}
                >
                  <div className="text-xs uppercase tracking-wider text-white/50 mb-2">
                    Rename influencer
                  </div>
                  <input
                    autoFocus
                    value={renameValue}
                    maxLength={50}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitRename(inf.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    disabled={renameInfluencer.isPending}
                    placeholder="e.g. Luna Martinez"
                    data-testid={`input-rename-${inf.id}`}
                    className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/60"
                  />
                  <div className="text-[10px] text-white/40 mt-1.5">
                    {renameValue.trim().length}/50 - letters, numbers, spaces, - ' . only
                  </div>
                  <div className="flex-1" />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => submitRename(inf.id)}
                      disabled={renameInfluencer.isPending || !renameValue.trim()}
                      data-testid={`button-save-rename-${inf.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg text-black text-xs font-bold uppercase tracking-wider py-2 disabled:opacity-50"
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
                      data-testid={`button-cancel-rename-${inf.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] text-white/70 text-xs font-bold uppercase tracking-wider py-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  // Task #388: failed influencers stay clickable so the
                  // workspace can show the failure reason + Retry CTA
                  // via ActiveJobCard. Locked (in-flight) cards remain
                  // disabled.
                  if (!isActive && !isFailedInfluencer) return;
                  setLocation(`/influencer/${inf.id}`);
                }}
                disabled={(!isActive && !isFailedInfluencer) || isRetrying || isCanceling}
                aria-disabled={!isActive && !isFailedInfluencer}
                title={
                  isActive
                    ? undefined
                    : isFailedInfluencer
                      ? "Generation failed. Open to see why and retry."
                      : "Still in the queue - we'll notify you the moment it's ready."
                }
                data-testid={`card-influencer-${inf.id}`}
                className={
                  isActive
                    ? "text-left rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 hover:border-[#C9A44C]/40 hover:bg-white/[0.04] transition-colors"
                    : isFailedInfluencer
                      ? "text-left rounded-xl border border-red-500/30 bg-white/[0.02] p-4 hover:border-red-400/60 hover:bg-white/[0.04] transition-colors"
                      : "text-left rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 opacity-60 cursor-not-allowed"
                }
              >
                <div className="aspect-square rounded-lg overflow-hidden bg-white/[0.05] mb-3 relative">
                  {/* While the build is in flight we never reveal the
                      avatar - not even blurred. The user should feel
                      like our team is hand-crafting the influencer
                      from scratch and only sees the result when it's
                      fully done. The tile is a clean placeholder with
                      a quiet countdown so the wait feels intentional
                      and human, not pipelined. */}
                  {isActive && inf.avatarUrl ? (
                    <img
                      src={`${inf.avatarUrl}${inf.avatarUrl.includes("?") ? "&" : "?"}w=400`}
                      alt={inf.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : isFailedInfluencer ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        className="text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider"
                        style={{
                          background: "rgba(0,0,0,0.65)",
                          color: "rgb(252,165,165)",
                          border: "1px solid rgba(239,68,68,0.6)",
                        }}
                      >
                        Generation failed
                      </span>
                    </div>
                  ) : (
                    <CardQueuePlaceholder
                      createdAt={inFlightJob?.createdAt ?? null}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="text-white font-medium truncate flex-1 min-w-0">{inf.name}</div>
                  {isActive ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Rename ${inf.name}`}
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        beginRename(inf);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          e.preventDefault();
                          beginRename(inf);
                        }
                      }}
                      data-testid={`button-rename-influencer-${inf.id}`}
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/[0.06] cursor-pointer flex-shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </span>
                  ) : null}
                </div>
                {inf.niche && (
                  <div className="text-xs text-white/50 mt-0.5 truncate">{inf.niche}</div>
                )}
                {isFailedInfluencer ? (
                  <>
                    {failureReason ? (
                      <div
                        className="text-[11px] text-red-300/80 mt-2 line-clamp-2"
                        title={failureReason}
                      >
                        {failureReason}
                      </div>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Retry generation for ${inf.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (isRetrying || isCanceling) return;
                          retryFromList.mutate(inf.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            if (!isRetrying && !isCanceling) retryFromList.mutate(inf.id);
                          }
                        }}
                        data-testid={`button-retry-influencer-${inf.id}`}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 text-xs font-bold uppercase tracking-wider py-2 ${isCanceling ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        {isRetrying ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Retrying
                          </>
                        ) : (
                          <>Retry</>
                        )}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Cancel and remove ${inf.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (isRetrying || isCanceling) return;
                          setCancelTarget({ id: inf.id, name: inf.name });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            if (isRetrying || isCanceling) return;
                            setCancelTarget({ id: inf.id, name: inf.name });
                          }
                        }}
                        data-testid={`button-cancel-influencer-${inf.id}`}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] text-white/70 text-xs font-bold uppercase tracking-wider py-2 ${isRetrying ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        {isCanceling ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Removing
                          </>
                        ) : (
                          <>Cancel</>
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3 mt-3 text-xs text-white/60">
                    <span className="inline-flex items-center gap-1">
                      <Camera className="w-3.5 h-3.5" style={{ color: GOLD }} />
                      {inf.anglesCount} angles
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="w-3.5 h-3.5" style={{ color: GOLD }} />
                      {inf.settingsCount} settings
                    </span>
                  </div>
                )}
              </button>
              </div>
              );
            })}
            <button
              type="button"
              onClick={() => setShowBuyCredits(true)}
              className="group relative flex flex-col items-center justify-center rounded-xl border border-dashed border-[#C9A44C]/35 bg-[#C9A44C]/[0.03] hover:bg-[#C9A44C]/[0.08] hover:border-[#C9A44C]/60 transition-colors min-h-[260px] p-6 text-center"
              data-testid="button-add-influencer-tile"
              title="Buy another influencer generation ($29)"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3 border"
                style={{ borderColor: "rgba(201,164,76,0.45)", background: "rgba(201,164,76,0.08)" }}
              >
                <Plus className="w-6 h-6" style={{ color: GOLD }} />
              </div>
              <div className="text-sm font-bold uppercase tracking-wider text-white mb-1">
                Add Influencer
              </div>
              <div className="text-[12px] text-white/55">
                $29 each · unlocks instantly
              </div>
            </button>
          </div>
        )}
      </div>

      {renameToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 backdrop-blur"
          role="status"
          data-testid="toast-rename-error"
        >
          {renameToast}
        </div>
      )}

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onCreated={() => {
            // Restored DFY queue UX: stay on My Influencers and let the
            // QueueCard at the top of the list show the live pipeline
            // state. The user can manually click into the workspace when
            // they're ready - no auto-routing.
            setShowGenerate(false);
            queryClient.invalidateQueries({ queryKey: ["influencer-jobs"] });
            queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
            queryClient.invalidateQueries({ queryKey: ["my-influencers"] });
          }}
        />
      )}

      {showUnlockPopup && (
        <UnlockPopup
          onDismiss={dismissUnlockPopup}
          onGenerate={() => {
            dismissUnlockPopup();
            setShowGenerate(true);
          }}
        />
      )}

      {cancelTarget && (
        <CancelInfluencerDialog
          name={cancelTarget.name}
          isRemoving={
            cancelFromList.isPending &&
            cancelFromList.variables === cancelTarget.id
          }
          onConfirm={() => {
            const target = cancelTarget;
            cancelFromList.mutate(target.id, {
              onSettled: () => setCancelTarget((cur) => (cur?.id === target.id ? null : cur)),
            });
          }}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </PortalLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel dialog. Custom dark/gold themed modal replacing the native
// browser confirm() so the destructive action matches the rest of the
// portal's visual language.
// ─────────────────────────────────────────────────────────────────────────────
function CancelInfluencerDialog({
  name,
  isRemoving,
  onConfirm,
  onClose,
}: {
  name: string;
  isRemoving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isRemoving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isRemoving]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-influencer-title"
      onClick={() => {
        if (!isRemoving) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="dialog-cancel-influencer"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="cancel-influencer-title"
              className="text-white text-base font-semibold"
            >
              Remove {name}?
            </h2>
            <p className="text-white/60 text-sm mt-1">
              This deletes the failed influencer from your gallery. You
              can always generate a new one - this won't use up a
              generation slot.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isRemoving}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-white/15 text-white/80 hover:bg-white/[0.05] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-cancel-dialog-keep"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRemoving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-cancel-dialog-confirm"
          >
            {isRemoving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Removing
              </>
            ) : (
              <>Remove influencer</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quota indicator. Shown near the top of the page so the buyer always
// knows how many of their AR influencer generations are left.
// ─────────────────────────────────────────────────────────────────────────────
function QuotaIndicator({
  used,
  total,
  bonusUnlocked,
  atCap,
}: {
  used: number;
  total: number;
  bonusUnlocked: boolean;
  atCap: boolean;
}) {
  const remaining = Math.max(0, total - used);
  // Bonus pool sits on top of the 1 free build everyone gets, so the
  // free build is consumed first and bonuses only start ticking down
  // after that. Without this clamp the label could read e.g. "6 of 5
  // bonus generations remaining" before any build is used.
  const bonusPool = Math.max(0, total - 1);
  const bonusUsed = Math.min(bonusPool, Math.max(0, used - 1));
  const bonusRemaining = Math.max(0, bonusPool - bonusUsed);
  return (
    <div
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 mb-5 flex items-center justify-between gap-4 flex-wrap"
      data-testid="influencer-quota-indicator"
    >
      <div className="flex items-center gap-3">
        {bonusUnlocked ? (
          <Gift className="w-4 h-4" style={{ color: GOLD }} />
        ) : (
          <Sparkles className="w-4 h-4" style={{ color: GOLD }} />
        )}
        <div>
          <div className="text-sm text-white font-medium">
            Generations used: {used} of {total}
          </div>
          <div className="text-[11px] text-white/50 mt-0.5">
            {bonusUnlocked
              ? `${bonusRemaining} of ${bonusPool} bonus generation${bonusPool === 1 ? "" : "s"} remaining`
              : "Upgrade to unlock more AI Influencers"}
          </div>
        </div>
      </div>
      {atCap ? (
        <span className="text-[11px] uppercase tracking-wider text-red-300/80">
          Cap reached
        </span>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task #283: One-time celebratory popup shown the first time an Upsell 2
// buyer lands on this page after the entitlement flips on. Server-tracked
// (portal_users.upsell2_influencer_unlock_seen) so it never re-fires.
// ─────────────────────────────────────────────────────────────────────────────
function UnlockPopup({
  onDismiss,
  onGenerate,
}: {
  onDismiss: () => void;
  onGenerate: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-popup-title"
      data-testid="influencer-unlock-popup"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141417] p-6 shadow-2xl text-center">
        <div className="flex items-center justify-end">
          <button
            onClick={onDismiss}
            className="text-white/60 hover:text-white"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <div
          className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4"
          style={{ background: "rgba(201,164,76,0.12)" }}
        >
          <Gift className="w-7 h-7" style={{ color: GOLD }} />
        </div>
        <div className="text-[11px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: GOLD }}>
          Bonus pack unlocked
        </div>
        <h2 id="unlock-popup-title" className="text-2xl font-semibold text-white mb-3">
          You unlocked more AI Influencers
        </h2>
        <p className="text-sm text-white/65 mb-6">
          Your recent purchase comes with extra AR influencer generations.
          Spin up another personality, niche or look - they go straight into
          your library when they're ready.
        </p>
        <button
          onClick={onGenerate}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-black text-sm font-bold uppercase tracking-wider"
          style={{ background: GOLD }}
          data-testid="button-unlock-popup-generate"
        >
          <Wand2 className="w-4 h-4" /> Generate the next one
        </button>
        <button
          onClick={onDismiss}
          className="block mx-auto mt-3 text-xs text-white/50 hover:text-white"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity workspace generation pipeline.
//
// Maps the 5 backend job statuses to a 5-stage display timeline. Each
// stage cycles through evocative AI-system sub-step labels so it feels
// computationally active even between status polls. The pipeline now
// finalizes into a reusable workspace (Main Image / Angles / Settings)
// rather than a cinematic placement gallery.
// ─────────────────────────────────────────────────────────────────────────────
const PIPELINE_STAGES: Array<{
  key: InfluencerJob["status"];
  label: string;
  substeps: string[];
}> = [
  {
    key: "queued",
    label: "Initializing AI pipeline",
    substeps: [
      "Allocating compute slot",
      "Warming up render workers",
      "Reserving GPU bandwidth",
    ],
  },
  {
    key: "generating_base",
    label: "Generating identity reference",
    substeps: [
      "Drafting facial geometry",
      "Sampling identity tokens",
      "Composing canonical headshot",
      "Locking core likeness",
    ],
  },
  {
    key: "enhancing",
    label: "Refining identity reference",
    substeps: [
      "Resolving micro-detail",
      "Balancing studio lighting",
      "Refining skin texture",
      "Sharpening eye detail",
    ],
  },
  {
    key: "swapping_scenes",
    label: "Preparing reference set",
    substeps: [
      "Building identity anchor set",
      "Validating consistency",
      "Indexing reference images",
      "Running quality checks",
      "Finalizing influencer workspace",
    ],
  },
  {
    key: "ready",
    label: "Opening workspace",
    substeps: ["Uploading reference assets"],
  },
];

function stageIndexFor(status: InfluencerJob["status"]): number {
  if (status === "failed") return -1;
  const i = PIPELINE_STAGES.findIndex((s) => s.key === status);
  return i < 0 ? 0 : i;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// CardQueuePlaceholder - the locked-tile placeholder shown in the
// gallery grid while an influencer is being built. Deliberately shows
// no preview image (not even blurred). Just a subtle gold pulse, a
// short "Our team is on it" line, and a quiet HH:MM countdown so the
// experience feels human and intentional rather than automated.
// ─────────────────────────────────────────────────────────────────────────────
function CardQueuePlaceholder({ createdAt }: { createdAt: string | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Mirror the QueueCard's flat 24h promise window so both clocks
  // stay in sync. We keep this purely visual - the real backend ETA
  // is shorter and flips the tile to "active" the moment it's ready.
  const DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  const deadlineMs = Number.isFinite(createdMs)
    ? createdMs + DISPLAY_WINDOW_MS
    : Date.now() + DISPLAY_WINDOW_MS;
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const hh = Math.floor(remainingMs / 3_600_000);
  const mm = Math.floor((remainingMs % 3_600_000) / 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clockLabel = remainingMs <= 0 ? "Almost ready" : `${pad(hh)}:${pad(mm)}`;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-3"
      style={{
        background:
          "radial-gradient(circle at 50% 40%, rgba(201,164,76,0.06), rgba(0,0,0,0) 70%)",
      }}
      data-testid="card-queue-placeholder"
    >
      <style>{`
        @keyframes r30-card-pulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @media (prefers-reduced-motion: reduce) {
          .r30-card-pulse { animation: none !important; opacity: 1 !important; }
        }
      `}</style>
      <span
        className="r30-card-pulse w-2 h-2 rounded-full mb-3"
        style={{
          background: GOLD,
          animation: "r30-card-pulse 1.6s ease-in-out infinite",
        }}
      />
      <div
        className="text-[9px] tracking-[0.22em] uppercase font-bold mb-2"
        style={{ color: GOLD }}
      >
        Our team is on it
      </div>
      <div
        className="text-base font-bold tabular-nums"
        style={{ color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}
      >
        {clockLabel}
      </div>
      {remainingMs > 0 && (
        <div className="text-[10px] text-white/40 mt-1">delivery within</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QueueCard - the minimal in-flight card shown above the gallery on
// My Influencers. Persisted ETA, a single sentence of reassurance, a
// thin progress bar, and the brief chips. No auto-routing - the user
// stays on this page and clicks "Open Workspace" once the influencer
// is ready (or "Retry" if it failed).
// ─────────────────────────────────────────────────────────────────────────────
function QueueCard({
  job,
  onOpen,
  onRetry,
}: {
  job: InfluencerJob;
  onOpen: () => void;
  onRetry: () => void;
}) {
  // Tick every second so the visible countdown clock advances in real
  // time. The backend ETA itself (28 min - 3h 30 min, randomized) is
  // unaffected; we just paint a 24h promise window and flip to "Ready"
  // the moment the backend reports it.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  // Ready / failed state come straight off the backend job status now,
  // so an early finish (which is the common case given the 28 min -
  // 3h 30 min real ETA) flips the card to "Ready" immediately and the
  // user gets the "they did it early" delight moment.
  const isReady = job.status === "ready" || job.status === "ready_degraded";
  const isFailed = job.status === "failed";

  // Visible countdown is a flat 24h promise window from job creation,
  // regardless of the backend's randomized internal ETA. Format as
  // HH:MM:SS so it reads like a real countdown clock.
  const DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const createdMs = new Date(job.createdAt).getTime();
  const deadlineMs = Number.isFinite(createdMs)
    ? createdMs + DISPLAY_WINDOW_MS
    : Date.now() + DISPLAY_WINDOW_MS;
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const countdownLabel = (() => {
    if (remainingMs <= 0) return "Finalizing";
    const totalSec = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  })();

  const headerTitle = isReady
    ? "Ready"
    : isFailed
      ? "Generation failed"
      : "In the queue";

  const subtitle = isReady
    ? "Your AI influencer is ready. Click Open Workspace to start creating content."
    : isFailed
      ? job.failureReason ||
        "Something went wrong while generating your influencer. You can retry with the same brief."
      : "Our team is building your AI influencer now. You'll have it back within 24 hours - we'll notify you by email and inside the portal the moment it's ready. No need to keep this tab open.";

  const ageDisplay = job.prefs.ageRange.replace("-", " - ");
  const genderDisplay = job.prefs.gender.replace(/_/g, " ");
  const ethnicityDisplay = job.prefs.ethnicity.replace(/_/g, " ");

  return (
    <div
      className="mb-6 rounded-2xl border bg-white/[0.02] p-5"
      style={{ borderColor: "rgba(201,164,76,0.25)" }}
      data-testid="queue-card"
    >
      <div className="flex items-start gap-4">
        {/* Avatar circle */}
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
          style={{
            background: "rgba(201,164,76,0.10)",
            border: `1px solid ${GOLD}`,
          }}
        >
          {isReady ? (
            <CheckCircle2 className="w-5 h-5" style={{ color: GOLD }} />
          ) : isFailed ? (
            <AlertCircle className="w-5 h-5 text-red-400" />
          ) : (
            <Sparkles className="w-5 h-5" style={{ color: GOLD }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-sm font-bold"
              style={{ color: isFailed ? "#fca5a5" : GOLD }}
              data-testid="queue-card-title"
            >
              {headerTitle}
            </span>
          </div>

          {/* Subtitle */}
          <p className="mt-1 text-[13px] leading-relaxed text-white/70">
            {subtitle}
          </p>

          {/* 24h countdown clock - replaces the live progress bar.
              Real backend completion (28 min - 3h 30 min) flips
              isReady early via job.status, so users almost always
              get the influencer well before this clock runs out. */}
          {!isReady && !isFailed && (
            <div
              className="mt-4 inline-flex items-center gap-3 rounded-lg border px-3 py-2"
              style={{
                borderColor: "rgba(201,164,76,0.25)",
                background: "rgba(201,164,76,0.06)",
              }}
              data-testid="queue-card-countdown"
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">
                Delivery within
              </span>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: GOLD, letterSpacing: "0.04em" }}
              >
                {countdownLabel}
              </span>
            </div>
          )}

          {/* Brief chips */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-white/50">
            <span>
              <span className="text-white/35">Age</span>{" "}
              <span className="text-white/70">{ageDisplay}</span>
            </span>
            <span>
              <span className="text-white/35">Gender</span>{" "}
              <span className="text-white/70 capitalize">{genderDisplay}</span>
            </span>
            <span>
              <span className="text-white/35">Ethnicity</span>{" "}
              <span className="text-white/70 capitalize">{ethnicityDisplay}</span>
            </span>
            <span>
              <span className="text-white/35">Vibe:</span>{" "}
              <span className="text-white/70">{job.prefs.vibe}</span>
            </span>
          </div>

          {/* CTAs */}
          {(isReady || isFailed) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {isReady && (
                <button
                  onClick={onOpen}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-black text-xs font-bold uppercase tracking-wider"
                  style={{ background: GOLD }}
                  data-testid="button-open-workspace"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Open Workspace
                </button>
              )}
              {isFailed && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-black text-xs font-bold uppercase tracking-wider"
                  style={{ background: GOLD }}
                  data-testid="button-retry-pipeline"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActiveJobCard({
  job,
  isSuperAdmin,
  onView,
  onSkipped,
  onRetry,
  onDismiss,
}: {
  job: InfluencerJob;
  isSuperAdmin: boolean;
  onView: () => void;
  onSkipped: () => void;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  const [substepTick, setSubstepTick] = useState(0);
  const [, setNowTick] = useState(0);
  const reduceMotion = prefersReducedMotion();

  // Cycle the active stage's substep label every 1.8s so the card feels
  // alive between polls. Disabled under prefers-reduced-motion.
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setSubstepTick((n) => n + 1), 1800);
    return () => clearInterval(t);
  }, [reduceMotion]);

  // Re-render every 30s so the ETA countdown ticks down without
  // requiring a network poll. The etaAt timestamp itself is server-
  // assigned at job creation and persisted, so refreshes preserve it.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const skip = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/portal/influencer-jobs/${job.id}/admin/skip-wait`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message ?? data?.error ?? "skip_failed");
      }
      return res.json();
    },
    onSuccess: () => onSkipped(),
  });

  const isFailed = job.status === "failed";
  // ready_degraded is a successful terminal state - the identity
  // reference is delivered, just with one or more enhancement passes
  // skipped. Treat it identically to "ready" for navigation/CTA
  // purposes but surface a small note so the user knows.
  const isReady = job.status === "ready" || job.status === "ready_degraded";
  const activeIdx = isReady ? PIPELINE_STAGES.length - 1 : stageIndexFor(job.status);

  // Smooth, monotonically-increasing progress so the bar never jumps
  // backwards between polls. Backend `progress` is clamped to a
  // floor that reflects the current stage.
  const stageFloor = Math.round((activeIdx / PIPELINE_STAGES.length) * 100);
  const displayProgress = Math.max(8, Math.min(100, Math.max(stageFloor, job.progress)));

  return (
    <div
      className="relative rounded-2xl border bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-6 mb-6 overflow-hidden"
      style={{ borderColor: isFailed ? "rgba(239,68,68,0.4)" : "rgba(201,164,76,0.35)" }}
      data-testid="card-active-job"
    >
      {/* Inline keyframes - scoped via unique class names so they don't
          leak into the global stylesheet. */}
      <style>{`
        @keyframes r30-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes r30-pulse-dot {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes r30-bar-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes r30-fade-in {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .r30-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(201,164,76,0.10) 50%,
            transparent 100%);
          animation: r30-shimmer 1.8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .r30-shimmer::after { animation: none; }
          .r30-bar-flow { animation: none !important; }
          .r30-pulse-dot { animation: none !important; opacity: 1 !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="r30-pulse-dot inline-block w-2 h-2 rounded-full"
            style={{
              background: isFailed ? "rgb(239,68,68)" : GOLD,
              animation: reduceMotion ? "none" : "r30-pulse-dot 1.4s ease-in-out infinite",
            }}
          />
          <span
            className="text-[10px] tracking-[0.28em] uppercase font-bold"
            style={{ color: isFailed ? "rgb(252,165,165)" : GOLD }}
          >
            {isFailed ? "Pipeline halted" : "AI pipeline · Live"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && !isFailed && !isReady && (
            <button
              onClick={() => skip.mutate()}
              disabled={skip.isPending}
              className="text-[10px] uppercase tracking-wider inline-flex items-center gap-1 px-2 py-1 rounded border border-[#C9A44C]/40 text-[#C9A44C] hover:bg-[#C9A44C]/10 disabled:opacity-50"
              title="Admin only: fast-forward this job to ready"
              data-testid="button-admin-skip-wait"
            >
              {skip.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FastForward className="w-3 h-3" />
              )}
              Skip wait (admin)
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-white/50 hover:text-white p-1 rounded"
              aria-label="Dismiss"
              data-testid="button-dismiss-failed-job"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <h3
        className="text-2xl md:text-[28px] font-bold uppercase tracking-[0.01em] text-white mb-1"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        {isFailed
          ? "Generation halted"
          : isReady
            ? "Workspace ready"
            : "Building your identity workspace"}
      </h3>
      <p className="text-sm text-white/55 mb-5 max-w-xl">
        {isFailed
          ? job.failureReason
            ? `Pipeline error: ${job.failureReason}. Retry to dispatch a fresh run.`
            : "The pipeline hit an error. Retry to dispatch a fresh run."
          : isReady
            ? "Identity reference is ready. Opening your workspace now."
            : "A multi-stage AI render is composing the canonical identity, refining the likeness, then preparing your reusable Main Image, Angles, and Settings workspace."}
      </p>

      {/* Generation brief chips */}
      <div className="flex flex-wrap gap-1.5 mb-5 items-center">
        {[
          `Age ${job.prefs.ageRange}`,
          job.prefs.gender.replace("_", " "),
          job.prefs.ethnicity.replace("_", " "),
          job.prefs.vibe,
        ].map((chip, i) => (
          <span
            key={i}
            className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-white/65 bg-white/[0.03] capitalize"
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Progress bar with flowing gradient */}
      {!isFailed && (
        <div className="mb-5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/50 mb-1.5">
            <span>{isReady ? "Complete" : PIPELINE_STAGES[activeIdx]?.label}</span>
            <span style={{ color: GOLD }}>{displayProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden relative">
            <div
              className="r30-bar-flow h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${displayProgress}%`,
                background: `linear-gradient(90deg, ${GOLD}, #f0d27a, ${GOLD})`,
                backgroundSize: "200% 100%",
                animation: reduceMotion ? "none" : "r30-bar-flow 2.8s linear infinite",
              }}
            />
          </div>
        </div>
      )}

      {/* Stage timeline */}
      {!isFailed && (
        <ol className="space-y-2.5 mb-6" data-testid="pipeline-stage-list">
          {PIPELINE_STAGES.slice(0, -1).map((stage, idx) => {
            const isDone = idx < activeIdx || isReady;
            const isActive = idx === activeIdx && !isReady;
            const subs = stage.substeps;
            const sub = isActive ? subs[substepTick % subs.length] : null;
            return (
              <li
                key={stage.key}
                className="flex items-start gap-3 text-sm transition-opacity duration-500"
                style={{ opacity: isDone || isActive ? 1 : 0.35 }}
              >
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 border"
                  style={{
                    borderColor: isDone
                      ? GOLD
                      : isActive
                        ? "rgba(201,164,76,0.6)"
                        : "rgba(255,255,255,0.15)",
                    background: isDone ? GOLD : "transparent",
                  }}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                  ) : isActive ? (
                    <Loader2 className="w-3 h-3 animate-spin" style={{ color: GOLD }} />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="font-medium"
                    style={{ color: isActive ? GOLD : isDone ? "white" : "rgba(255,255,255,0.7)" }}
                  >
                    {stage.label}
                  </div>
                  {isActive && sub && (
                    <div
                      key={sub}
                      className="text-[11px] text-white/50 mt-0.5"
                      style={{
                        animation: reduceMotion ? "none" : "r30-fade-in 400ms ease-out",
                      }}
                    >
                      {sub}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Ready CTA - manual open only, no auto-route */}
      {isReady && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={onView}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-black text-sm font-bold uppercase tracking-wider"
            style={{ background: GOLD }}
            data-testid="button-open-workspace"
          >
            <Sparkles className="w-4 h-4" /> Open Workspace
          </button>
          <span className="text-[11px] text-white/40">
            Your influencer is ready. Click to open the workspace.
          </span>
        </div>
      )}

      {/* Failure CTA */}
      {isFailed && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-black text-sm font-bold uppercase tracking-wider"
            style={{ background: GOLD }}
            data-testid="button-retry-pipeline"
          >
            <Wand2 className="w-4 h-4" /> Retry pipeline
          </button>
          <span className="text-[11px] text-white/40">
            Your last brief is pre-loaded so you can adjust and re-dispatch.
          </span>
        </div>
      )}

      {skip.isError && (
        <p className="mt-3 text-[11px] text-red-400">
          Could not skip the wait. {(skip.error as Error)?.message}
        </p>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate modal. Five fields - matches the API contract one-to-one.
// ─────────────────────────────────────────────────────────────────────────────
function GenerateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (job: InfluencerJob) => void;
}) {
  const [ageRange, setAgeRange] = useState(AGE_OPTIONS[1].value);
  const [ethnicity, setEthnicity] = useState(ETHNICITY_OPTIONS[0].value);
  const [gender, setGender] = useState(GENDER_OPTIONS[0].value);
  const [vibe, setVibe] = useState(VIBE_PRESETS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  // Scroll the error banner into view exactly once when it first
  // appears, not on every subsequent re-render. The earlier ref-
  // callback version would re-fire scrollIntoView on any unrelated
  // re-render (e.g. select dropdowns) and fight the user as they
  // tried to scroll away to read a field.
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [error]);

  const generate = useMutation({
    mutationFn: async () => {
      const data = (await fetchApi("/influencer-jobs", {
        method: "POST",
        body: JSON.stringify({
          ageRange,
          ethnicity,
          gender,
          vibe,
          notes: notes || null,
          // Task #446 - hairstyle / facial-hair dropdowns were removed
          // from the modal in favour of free-text extraction. The
          // backend parses these traits out of `notes` and folds the
          // canonical values into prefs before the DNA sampler runs.
          facialHair: null,
          hairstyle: null,
        }),
      })) as { job: InfluencerJob };
      return data;
    },
    onSuccess: (data) => onCreated(data.job),
    onError: (err: Error & { body?: { message?: string; error?: string } }) => {
      // Multiple buyers reported the submit "did nothing". Root cause was
      // a mix of (a) no parent <form> so Enter never fired, (b) the
      // error banner showing the cryptic code ("quota_exceeded",
      // "bad_body", "provider_auth_failed") instead of the friendly
      // `body.message` the backend already provides, and (c) no
      // console signal so support couldn't tell what happened. We now:
      //   - prefer body.message > err.message > generic fallback
      //   - log the full error to the browser console so support can
      //     ask the buyer to screenshot it
      //   - scroll the error banner into view so it's visible on the
      //     short tablet/mobile viewports where the buttons sit below
      //     the fold (this was the silent killer reported in
      //     Intercom 215474386509060)
      // eslint-disable-next-line no-console
      console.error("[your-influencers] generate failed:", err);
      const friendly =
        err?.body?.message ||
        err?.body?.error ||
        err?.message ||
        "Something went wrong. Please try again or message support.";
      setError(friendly);
    },
  });

  // Submit handler shared by the form (Enter key) and the button
  // (click). Wrapping in try/catch makes any synchronous throw from
  // useMutation visible instead of silently swallowed.
  function submit() {
    setError(null);
    try {
      generate.mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[your-influencers] submit threw:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-modal-title"
    >
      {/* Intentionally no backdrop-click-to-close: the form has 5 fields and
          accidental dismissal would lose the user's progress. The X button
          and the Cancel button are the only dismissal paths. */}
      <form
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#141417] p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onSubmit={(e) => {
          // Wrap in a <form> so pressing Enter inside the vibe input
          // submits the modal. Without this, the previous <div> wrapper
          // meant Enter did literally nothing — matching the multi-
          // browser bug report in Intercom 215474386509060.
          e.preventDefault();
          if (generate.isPending) return;
          submit();
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase font-bold mb-2" style={{ color: GOLD }}>
              <Wand2 className="w-3.5 h-3.5" /> Free AI Influencer
            </div>
            <h2 id="generate-modal-title" className="text-xl font-semibold text-white">Personalise your influencer</h2>
            <p className="text-sm text-white/60 mt-1">
              Tell us a bit about who you want and our team will craft her for
              you. Delivered straight to your account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/60 hover:text-white"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Age range">
            <Select value={ageRange} onChange={setAgeRange} options={AGE_OPTIONS} testId="select-age" />
          </Field>
          <Field label="Ethnicity">
            <Select value={ethnicity} onChange={setEthnicity} options={ETHNICITY_OPTIONS} testId="select-ethnicity" />
          </Field>
          <Field label="Gender">
            <Select value={gender} onChange={setGender} options={GENDER_OPTIONS} testId="select-gender" />
          </Field>
          <Field label="Style and vibe">
            <input
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="Describe her energy"
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none text-sm"
              maxLength={120}
              data-testid="input-vibe"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VIBE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setVibe(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${
                    vibe === p
                      ? "border-[#C9A44C]/60 text-[#C9A44C] bg-[#C9A44C]/[0.08]"
                      : "border-white/10 text-white/60 hover:bg-white/[0.04]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Anything else? (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hairstyle, facial hair, hair colour, freckles, tattoos, height, niche, anything specific you'd love..."
              rows={3}
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none text-sm resize-none"
              maxLength={800}
              data-testid="input-notes"
            />
          </Field>
        </div>

        {error && (
          <div
            ref={errorRef}
            role="alert"
            className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
            data-testid="generate-error"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-white/70 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-black text-sm font-bold uppercase tracking-wider disabled:opacity-60"
            style={{ background: GOLD }}
            data-testid="button-submit-generate"
          >
            {generate.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {generate.isPending ? "Starting..." : "Start generation"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.18em] text-white/50 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-white focus:border-[#C9A44C]/50 focus:outline-none text-sm"
      data-testid={testId}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#141417]">
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────
// Manual Upload Modal
// ─────────────────────────────────────────────────────────────
// Buyer-uploaded influencer flow: free, uncapped, static-only
// (no Viktor pipeline, no scene swaps). Posts multipart to
// /api/influencers/manual. The proxy caps individual requests
// at ~32 MB, but multer caps each file at 10 MB. We send all
// images in a single multipart request - if any one file is
// rejected (size, type) the whole submission fails fast with
// a JSON error.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ANGLES = 20;
const MAX_SETTINGS = 20;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function ManualUploadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (influencerId: number) => void;
}) {
  const [name, setName] = useState("");
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [angleFiles, setAngleFiles] = useState<File[]>([]);
  const [settingFiles, setSettingFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cached object URLs for previews. Cleaned up on unmount.
  const mainPreview = useMemo(
    () => (mainFile ? URL.createObjectURL(mainFile) : null),
    [mainFile],
  );
  const anglePreviews = useMemo(
    () => angleFiles.map((f) => URL.createObjectURL(f)),
    [angleFiles],
  );
  const settingPreviews = useMemo(
    () => settingFiles.map((f) => URL.createObjectURL(f)),
    [settingFiles],
  );
  useEffect(() => {
    return () => {
      if (mainPreview) URL.revokeObjectURL(mainPreview);
      anglePreviews.forEach((u) => URL.revokeObjectURL(u));
      settingPreviews.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPreview, anglePreviews, settingPreviews]);

  function validateFiles(files: File[]): string | null {
    for (const f of files) {
      if (!ACCEPT.split(",").includes(f.type)) {
        return `${f.name}: unsupported type (use JPG, PNG, WebP, or GIF)`;
      }
      if (f.size > MAX_FILE_BYTES) {
        return `${f.name}: too large (max 10 MB)`;
      }
    }
    return null;
  }

  function pickMain(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const err = validateFiles([f]);
    if (err) { setError(err); return; }
    setError(null);
    setMainFile(f);
  }

  function pickAngles(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (incoming.length === 0) return;
    const next = [...angleFiles, ...incoming].slice(0, MAX_ANGLES);
    const err = validateFiles(incoming);
    if (err) { setError(err); return; }
    setError(null);
    setAngleFiles(next);
  }

  function pickSettings(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (incoming.length === 0) return;
    const next = [...settingFiles, ...incoming].slice(0, MAX_SETTINGS);
    const err = validateFiles(incoming);
    if (err) { setError(err); return; }
    setError(null);
    setSettingFiles(next);
  }

  const canSubmit =
    name.trim().length > 0 && name.trim().length <= 50 && !!mainFile && !submitting;

  async function submit() {
    if (!canSubmit || !mainFile) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("mainImage", mainFile);
      angleFiles.forEach((f) => fd.append("angleImages", f));
      settingFiles.forEach((f) => fd.append("settingImages", f));
      const headers = await getAuthHeaders();
      const res = await fetch("/api/influencers/manual", {
        method: "POST",
        credentials: "include",
        headers: { "X-Portal-Key": "room30", ...headers },
        body: fd,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = String(j.message);
          else if (j?.error) msg = String(j.error);
        } catch { /* keep default */ }
        throw new Error(msg);
      }
      const j = (await res.json()) as { influencer?: { id?: number } };
      const newId = j.influencer?.id;
      if (typeof newId !== "number") throw new Error("Bad server response");
      onCreated(newId);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      data-testid="modal-manual-upload"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="w-full max-w-2xl my-8 rounded-2xl border border-white/10 bg-[#141417] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5" style={{ color: GOLD }} />
            <h2 className="text-lg font-semibold text-white">Upload Your Own Influencer</h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-white/50 hover:text-white disabled:opacity-40"
            data-testid="button-close-manual-upload"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <p className="text-sm text-white/60">
            Free - use your own images. This does not count against your
            generation quota.
          </p>

          <Field label="Influencer name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="e.g. James, Sophia..."
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#C9A44C]/50 focus:outline-none text-sm"
              data-testid="input-manual-name"
            />
          </Field>

          <Field label="Main portrait (required)">
            <label
              className="block rounded-lg border border-dashed border-white/15 hover:border-[#C9A44C]/40 bg-white/[0.02] hover:bg-[#C9A44C]/[0.04] cursor-pointer transition"
              data-testid="dropzone-manual-main"
            >
              {mainPreview ? (
                <div className="relative">
                  <img src={mainPreview} alt="Main portrait" className="w-full h-64 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setMainFile(null); }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-black text-white"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <ImageIcon className="w-8 h-8 mx-auto mb-2 text-white/40" />
                  <div className="text-sm text-white/70">Click to upload main portrait</div>
                  <div className="text-xs text-white/40 mt-1">JPG, PNG, WebP, GIF - up to 10 MB</div>
                </div>
              )}
              <input
                type="file"
                accept={ACCEPT}
                onChange={pickMain}
                className="hidden"
                data-testid="input-manual-main-file"
              />
            </label>
          </Field>

          <ManualMultiUpload
            label="Angles"
            help="Upload different angles of your influencer (three-quarter, profile, etc.)."
            files={angleFiles}
            previews={anglePreviews}
            max={MAX_ANGLES}
            onPick={pickAngles}
            onRemove={(idx) => setAngleFiles((prev) => prev.filter((_, i) => i !== idx))}
            testIdPrefix="manual-angles"
          />

          <ManualMultiUpload
            label="Settings"
            help="Upload your influencer in different scenes (office, podcast, outdoors, etc.)."
            files={settingFiles}
            previews={settingPreviews}
            max={MAX_SETTINGS}
            onPick={pickSettings}
            onRemove={(idx) => setSettingFiles((prev) => prev.filter((_, i) => i !== idx))}
            testIdPrefix="manual-settings"
          />

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-white/70 hover:text-white text-sm font-medium disabled:opacity-40"
            data-testid="button-cancel-manual-upload"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-black text-sm font-bold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: GOLD }}
            data-testid="button-submit-manual-upload"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
            ) : (
              <><Check className="w-4 h-4" /> Create Influencer</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualMultiUpload({
  label, help, files, previews, max, onPick, onRemove, testIdPrefix,
}: {
  label: string;
  help: string;
  files: File[];
  previews: string[];
  max: number;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (idx: number) => void;
  testIdPrefix: string;
}) {
  const atMax = files.length >= max;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="block text-[11px] uppercase tracking-[0.18em] text-white/50">
          {label} <span className="text-white/30 normal-case tracking-normal">({files.length}/{max})</span>
        </span>
      </div>
      <p className="text-xs text-white/50 mb-2">{help}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {previews.map((src, i) => (
          <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-white/10">
            <img src={src} alt={`${label} ${i + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-1 right-1 p-1 rounded-full bg-black/70 hover:bg-black text-white"
              title="Remove"
              data-testid={`${testIdPrefix}-remove-${i}`}
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {!atMax && (
          <label
            className="aspect-square rounded-lg border border-dashed border-white/15 hover:border-[#C9A44C]/40 bg-white/[0.02] hover:bg-[#C9A44C]/[0.04] cursor-pointer flex items-center justify-center"
            data-testid={`${testIdPrefix}-dropzone`}
          >
            <Plus className="w-6 h-6 text-white/40" />
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={onPick}
              className="hidden"
              data-testid={`${testIdPrefix}-input`}
            />
          </label>
        )}
      </div>
    </div>
  );
}
