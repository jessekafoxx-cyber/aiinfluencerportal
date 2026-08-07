// AI Video Studio (Task #828) - admin-only. Turn an existing AI influencer
// photo into a HeyGen talking-head video, with an optional one-click podcast
// edit (Task #839) that runs the FFmpeg SOP pipeline on the worker.
// Non-admins render NotFound (the backend also 404s every /api/video route).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, fetchApi } from "../lib/api";
import { PortalLayout } from "../components/portal-layout";
import NotFound from "./not-found";
import { PurchasingMovedNotice } from "../components/purchasing-moved-notice";
import {
  useCreditTopUpCelebration,
  useRefetchOnRefocus,
} from "@/hooks/use-unlock-celebration";
import { usePurchaseLinks } from "../hooks/use-purchase-links";
import { listJobs, runScriptJobToCompletion, type ScriptJobRow } from "../lib/script-jobs";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  Sparkles,
  Play,
  Wand2,
  Coins,
  X,
  Upload,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const GOLD = "#C9A44C";

type Influencer = { id: number; name: string; avatarUrl: string | null };
// A selectable image for an influencer (base avatar, an angle, or a scene image).
type Look = { url: string; label: string };
type Voice = {
  voiceId: string;
  name: string;
  language: string | null;
  gender: string | null;
  previewUrl: string | null;
};
type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
  labels: Record<string, string> | null;
};
type Photo = { influencerId: number | null; influencerName: string; url: string };
type VideoJob = {
  id: number;
  status: string;
  rawVideoUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  editStatus?: string | null;
  editedVideoUrl?: string | null;
  editErrorMessage?: string | null;
};
type CreditTransaction = {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
};

// Task #837: flat 1 credit per video, max 90 seconds. Keep the word/second
// math in lockstep with the backend (heygen.ts WORDS_PER_MINUTE = 150) so the
// UI over-length guard matches the server's pre-charge rejection.
const VIDEO_CREDIT_COST = 1;
const MAX_VIDEO_SECONDS = 90;
const WORDS_PER_MINUTE = 150;

function countScriptWords(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}
// Raw (unrounded) seconds - must match the backend's estimateScriptSeconds so
// the UI over-length gate stays in lockstep with the server-side 90s reject.
// Round only for display.
function estimateScriptSeconds(script: string): number {
  return (countScriptWords(script) / WORDS_PER_MINUTE) * 60;
}
// Credits can now be fractional (sub-unit ledger, step 5). Render without
// trailing-zero noise: 3 -> "3", 2.5 -> "2.5".
function fmtCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export default function VideoStudioPage() {
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
      <VideoStudioInner />
    </PortalLayout>
  );
}

function VideoStudioInner() {
  const [, setLocation] = useLocation();

  // Credit balance. `unlimited` admins (the studio is admin-only today) never
  // debit a wallet, so we render an "Unlimited" pill and hide every
  // balance/low-credit/buy affordance.
  const [balance, setBalance] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [showBuy, setShowBuy] = useState(false);

  // HeyGen-style multi-step flow:
  //   gallery -> pick an influencer (or open the custom-looks page)
  //   looks   -> pick which angle/look of that influencer to use
  //   custom  -> upload your own looks and pick which one to use
  //   editor  -> write/record the words + voice, then generate
  const [step, setStep] = useState<"gallery" | "looks" | "custom" | "editor">("gallery");
  const [activeInfluencer, setActiveInfluencer] = useState<Influencer | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [looksLoading, setLooksLoading] = useState(false);

  // Post-generate b-roll upsell (yes/no prompt shown once a video completes).
  const [showBroll, setShowBroll] = useState(false);
  const brollPromptedRef = useRef<Set<number>>(new Set());

  // Credit transaction history
  const [showHistory, setShowHistory] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[] | null>(null);

  // Selectors
  const [photos, setPhotos] = useState<Photo[]>([]);
  // Custom photos uploaded by the user (not tied to an influencer). Rendered
  // alongside influencer avatars; influencerId is null so /generate treats them
  // as a standalone source image.
  const [customPhotos, setCustomPhotos] = useState<Photo[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  // Voice changer (Task #838): record/upload audio -> ElevenLabs speech-to-speech.
  const [inputMode, setInputMode] = useState<"text" | "audio">("text");
  const [stsVoices, setStsVoices] = useState<ElevenLabsVoice[]>([]);
  const [stsVoiceId, setStsVoiceId] = useState<string>("");
  const [stsConfigured, setStsConfigured] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>("");
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editConfigured, setEditConfigured] = useState(false);
  const [editCost, setEditCost] = useState(0.5);
  const [editing, setEditing] = useState(false);

  // Inputs
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [hook, setHook] = useState("");
  // Task #837: quality is locked to "high", aspect to "9:16" - no toggles.

  // Podcast-clip script writer (Task #837 step 7)
  const [showWriter, setShowWriter] = useState(false);
  const [writerSeed, setWriterSeed] = useState("");
  const [writerSeconds, setWriterSeconds] = useState(60);
  const [writing, setWriting] = useState(false);
  const [prevClips, setPrevClips] = useState<ScriptJobRow[] | null>(null);

  // Generation
  const [showConfirm, setShowConfirm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  async function loadBalance() {
    try {
      const d = await fetchApi<{ balance: number | null; unlimited?: boolean }>(
        "/api/video/credits",
      );
      setUnlimited(!!d.unlimited);
      setBalance(d.unlimited ? null : d.balance ?? 0);
    } catch {
      setUnlimited(false);
      setBalance(0);
    }
  }

  // Task #9: while the buy-credits modal is open, the buyer completes the
  // purchase on the external GHL sales page in another tab. Balance lives in
  // local state (no focus refetch of its own), so re-pull it when they tab
  // back; if the webhook already credited the wallet, close the modal and
  // celebrate instead of leaving "Upgrade now" on screen.
  useRefetchOnRefocus(showBuy, () => void loadBalance());
  useCreditTopUpCelebration({
    active: showBuy,
    balance,
    label: "video credits",
    onToppedUp: () => setShowBuy(false),
  });

  async function loadTransactions() {
    try {
      const d = await fetchApi<{ transactions: CreditTransaction[] }>(
        "/api/video/credits/transactions?limit=100",
      );
      setTransactions(d.transactions ?? []);
    } catch {
      setTransactions([]);
    }
  }

  useEffect(() => {
    void loadBalance();
    // Influencer photos (avatars).
    (async () => {
      try {
        const list = await fetchApi<Influencer[] | { influencers?: Influencer[] }>("/api/influencers");
        const arr = Array.isArray(list) ? list : list.influencers ?? [];
        const ps: Photo[] = arr
          .filter((i) => !!i.avatarUrl)
          .map((i) => ({ influencerId: i.id, influencerName: i.name, url: i.avatarUrl as string }));
        setPhotos(ps);
      } catch {
        setPhotos([]);
      }
    })();
    // Voices.
    (async () => {
      try {
        const d = await fetchApi<{ voices: Voice[] }>("/api/video/voices");
        setVoices(d.voices ?? []);
        if (d.voices?.[0]) setVoiceId(d.voices[0].voiceId);
      } catch {
        setVoices([]);
      }
    })();
    // ElevenLabs voices for the voice-changer path (Task #838).
    (async () => {
      try {
        const d = await fetchApi<{ voices: ElevenLabsVoice[] }>("/api/video/voices/elevenlabs");
        setStsVoices(d.voices ?? []);
        setStsConfigured(true);
        if (d.voices?.[0]) setStsVoiceId(d.voices[0].voiceId);
      } catch {
        setStsVoices([]);
        setStsConfigured(false);
      }
    })();
    // One-click podcast edit availability + cost.
    (async () => {
      try {
        const d = await fetchApi<{ configured: boolean; cost: number }>(
          "/api/video/edit-styles",
        );
        setEditConfigured(!!d.configured);
        setEditCost(d.cost ?? 0.5);
      } catch {
        setEditConfigured(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (editPollRef.current) clearInterval(editPollRef.current);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Step 8: auto-select the voice last used for this character (if any).
  useEffect(() => {
    if (!selectedPhoto || selectedPhoto.influencerId == null) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchApi<{ voiceId: string | null; stsVoiceId: string | null }>(
          `/api/video/influencer-voice?influencerId=${selectedPhoto.influencerId}`,
        );
        if (!cancelled && d.voiceId) setVoiceId(d.voiceId);
        if (!cancelled && d.stsVoiceId) setStsVoiceId(d.stsVoiceId);
      } catch {
        /* keep whatever voice is currently selected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPhoto]);

  // Step 7: load this user's previous podcast-clip scripts when the writer opens.
  useEffect(() => {
    if (!showWriter) return;
    setPrevClips(null);
    let cancelled = false;
    listJobs("podcast-clip", 12)
      .then((jobs) => {
        if (!cancelled) setPrevClips(jobs.filter((j) => j.status === "succeeded" && j.result));
      })
      .catch(() => {
        if (!cancelled) setPrevClips([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showWriter]);

  const wordCount = countScriptWords(script);
  const estSeconds = estimateScriptSeconds(script);
  const overLength = estSeconds > MAX_VIDEO_SECONDS;
  // Best-effort client guard for the audio path; the server re-measures the
  // clip before charging, so an unknown duration (null) is allowed through.
  const audioOverLength = audioDuration != null && audioDuration > MAX_VIDEO_SECONDS;
  const genCost = VIDEO_CREDIT_COST;
  const totalCost = genCost;
  const canGenerate =
    inputMode === "text"
      ? !!selectedPhoto && !!voiceId && script.trim().length > 0 && !overLength && !generating
      : !!selectedPhoto &&
        !!stsVoiceId &&
        !!audioBlob &&
        !audioOverLength &&
        !recording &&
        !generating;

  function playPreview(url: string | null) {
    if (!url) return;
    if (previewAudioRef.current) previewAudioRef.current.pause();
    const a = new Audio(url);
    previewAudioRef.current = a;
    void a.play().catch(() => {});
  }

  // --- Voice changer: record / upload audio (Task #838) ---------------------
  function resetAudio() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioName("");
    setAudioDuration(null);
    setRecordSeconds(0);
  }

  // Best-effort duration probe for an uploaded/recorded clip. MediaRecorder
  // webm blobs often report Infinity, so callers tolerate a null result.
  function probeDuration(blob: Blob): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => {
        const d = a.duration;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) && d > 0 ? d : null);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      a.src = url;
    });
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function startRecording() {
    resetAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        recordStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        setRecording(false);
        const blob = new Blob(recordChunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setAudioName("recording.webm");
        const probed = await probeDuration(blob);
        setAudioDuration(probed);
      };
      rec.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          const next = s + 1;
          // Hard-stop at the cap so a recording can never exceed 90s.
          if (next >= MAX_VIDEO_SECONDS) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      toast({
        title: "Microphone blocked",
        description: "Allow mic access, or upload an audio file instead.",
        variant: "destructive",
      });
    }
  }

  async function onAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    resetAudio();
    const url = URL.createObjectURL(file);
    setAudioBlob(file);
    setAudioUrl(url);
    setAudioName(file.name);
    const probed = await probeDuration(file);
    setAudioDuration(probed);
    if (probed != null && probed > MAX_VIDEO_SECONDS) {
      toast({
        title: "Clip too long",
        description: `That clip is ~${Math.round(probed)}s. Audio is capped at ${MAX_VIDEO_SECONDS}s.`,
        variant: "destructive",
      });
    }
  }

  // Map a podcast-clip job result onto the studio inputs (step 7):
  // screenshotLine -> on-screen hook, fullScript -> spoken script.
  function applyPodcastResult(result: any) {
    const fullScript = typeof result?.fullScript === "string" ? result.fullScript : "";
    const screenshotLine =
      typeof result?.screenshotLine === "string" ? result.screenshotLine : "";
    setScript(fullScript);
    if (screenshotLine) setHook(screenshotLine);
    setShowWriter(false);
    toast({ title: "Script loaded", description: "Review and tweak before generating." });
  }

  async function runWriter() {
    if (!writerSeed.trim()) return;
    setWriting(true);
    try {
      const job = await runScriptJobToCompletion("/api/portal/script-writer/podcast-clip", {
        context: writerSeed.trim(),
        targetSeconds: writerSeconds,
        influencerId: selectedPhoto?.influencerId,
      });
      applyPodcastResult(job.result);
    } catch (e: any) {
      toast({
        title: "Could not write script",
        description: e?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setWriting(false);
    }
  }

  function startPolling(jobId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetchApi<{ job: VideoJob }>(`/api/video/status/${jobId}`);
        setActiveJob(d.job);
        if (d.job.status === "completed" || d.job.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          void loadBalance();
          if (d.job.status === "completed") {
            toast({ title: "Video ready", description: "Find it in your gallery." });
            // Offer the optional b-roll edit once (per job), only when the
            // pipeline is configured and no edit has been kicked off yet.
            if (
              editConfigured &&
              !d.job.editStatus &&
              !brollPromptedRef.current.has(d.job.id)
            ) {
              brollPromptedRef.current.add(d.job.id);
              setShowBroll(true);
            }
          } else {
            toast({
              title: "Generation failed",
              description: d.job.errorMessage || "Your credits were refunded.",
              variant: "destructive",
            });
          }
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  async function onCustomImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast({
        title: "Unsupported image",
        description: "Use a JPG, PNG, or WebP photo.",
        variant: "destructive",
      });
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("image", file, file.name || "photo.jpg");
      const up = await fetchApi<{ sourceImageUrl: string }>("/api/video/image/upload", {
        method: "POST",
        body: form,
        timeoutMs: 120000,
      });
      const photo: Photo = {
        influencerId: null,
        influencerName: "Custom upload",
        url: up.sourceImageUrl,
      };
      setCustomPhotos((prev) => [photo, ...prev]);
      // Stay on the custom-looks page; select the freshly uploaded look so the
      // user can add more or pick which one to use before opening the editor.
      setSelectedPhoto(photo);
      setActiveInfluencer(null);
      setStep("custom");
      toast({ title: "Photo uploaded", description: "Your custom look is ready to use." });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Could not upload that photo.",
        variant: "destructive",
      });
    } finally {
      setUploadingImage(false);
    }
  }

  async function doGenerate() {
    if (!selectedPhoto) return;
    setGenerating(true);
    setShowConfirm(false);
    try {
      let job: VideoJob;
      if (inputMode === "audio") {
        if (!stsVoiceId || !audioBlob) return;
        // 1) Upload the raw clip (server validates duration before any charge).
        const form = new FormData();
        form.append("audio", audioBlob, audioName || "recording.webm");
        const up = await fetchApi<{ sourceAudioUrl: string }>("/api/video/audio/upload", {
          method: "POST",
          body: form,
          timeoutMs: 120000,
        });
        // 2) Convert + lip-sync.
        const d = await fetchApi<{ job: VideoJob }>("/api/video/generate-from-audio", {
          method: "POST",
          body: JSON.stringify({
            influencerId: selectedPhoto.influencerId,
            sourceImageUrl: selectedPhoto.url,
            sourceAudioUrl: up.sourceAudioUrl,
            stsVoiceId,
            title: title.trim() || undefined,
            hook: hook.trim() || undefined,
          }),
          timeoutMs: 120000,
        });
        job = d.job;
      } else {
        if (!voiceId) return;
        const d = await fetchApi<{ job: VideoJob }>("/api/video/generate", {
          method: "POST",
          body: JSON.stringify({
            influencerId: selectedPhoto.influencerId,
            sourceImageUrl: selectedPhoto.url,
            script: script.trim(),
            voiceId,
            title: title.trim() || undefined,
            hook: hook.trim() || undefined,
          }),
          timeoutMs: 60000,
        });
        job = d.job;
      }
      setActiveJob(job);
      void loadBalance();
      startPolling(job.id);
      toast({ title: "Generation started", description: "This usually takes 1-3 minutes." });
    } catch (e: any) {
      const msg = e?.message || "Could not start generation.";
      if (/insufficient/i.test(msg)) {
        setShowBuy(true);
      }
      toast({ title: "Could not generate", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function startEditPolling(jobId: number) {
    if (editPollRef.current) clearInterval(editPollRef.current);
    editPollRef.current = setInterval(async () => {
      try {
        const d = await fetchApi<{ job: VideoJob }>(`/api/video/status/${jobId}`);
        setActiveJob(d.job);
        const es = d.job.editStatus;
        if (es === "completed" || es === "failed") {
          if (editPollRef.current) clearInterval(editPollRef.current);
          void loadBalance();
          toast(
            es === "completed"
              ? { title: "Podcast edit ready", description: "Find the edited cut in your gallery." }
              : {
                  title: "Edit failed",
                  description: d.job.editErrorMessage || "Your credit was refunded.",
                  variant: "destructive",
                },
          );
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
  }

  async function doAutoEdit(jobId: number) {
    setEditing(true);
    try {
      const d = await fetchApi<{ job: VideoJob }>("/api/video/auto-edit", {
        method: "POST",
        body: JSON.stringify({ jobId, style: "podcast_clip" }),
      });
      setActiveJob(d.job);
      void loadBalance();
      startEditPolling(jobId);
      toast({ title: "Editing started", description: "Your podcast edit is rendering." });
    } catch (e: any) {
      const msg = e?.message || "Could not start edit.";
      if (/insufficient/i.test(msg)) setShowBuy(true);
      toast({ title: "Could not edit", description: msg, variant: "destructive" });
    } finally {
      setEditing(false);
    }
  }

  const lowCredits = !unlimited && balance !== null && balance < totalCost;

  // Step 1 -> 2: open an influencer and load its angles/looks/settings.
  async function openInfluencer(inf: Influencer) {
    setActiveInfluencer(inf);
    setSelectedPhoto(null);
    setStep("looks");
    setLooks([]);
    setLooksLoading(true);
    try {
      const d = await fetchApi<{
        influencer: { avatarUrl?: string | null };
        angles?: Array<{ imageUrl?: string | null; label?: string | null }>;
        settings?: Array<{
          name?: string | null;
          images?: Array<{ imageUrl?: string | null; label?: string | null }>;
        }>;
      }>(`/api/influencers/${inf.id}`);
      const out: Look[] = [];
      const baseAvatar = d.influencer?.avatarUrl ?? inf.avatarUrl;
      if (baseAvatar) out.push({ url: baseAvatar, label: "Avatar" });
      for (const a of d.angles ?? []) {
        if (a.imageUrl) out.push({ url: a.imageUrl, label: a.label || "Angle" });
      }
      for (const s of d.settings ?? []) {
        for (const img of s.images ?? []) {
          if (img.imageUrl) out.push({ url: img.imageUrl, label: img.label || s.name || "Scene" });
        }
      }
      const seen = new Set<string>();
      setLooks(out.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true))));
    } catch {
      setLooks(inf.avatarUrl ? [{ url: inf.avatarUrl, label: "Avatar" }] : []);
    } finally {
      setLooksLoading(false);
    }
  }

  // Step 2 -> 3: lock in a look as the source photo and open the editor.
  function chooseLook(look: Look) {
    setSelectedPhoto({
      influencerId: activeInfluencer?.id ?? null,
      influencerName: activeInfluencer?.name ?? "Influencer",
      url: look.url,
    });
  }

  function backFromEditor() {
    if (activeInfluencer) setStep("looks");
    else setStep("custom");
  }

  const creditLabel = unlimited
    ? "Unlimited"
    : balance === null
      ? "..."
      : `${fmtCredits(balance)} credits`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-white">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--app-font-display)" }}>
            AI Video Studio
          </h1>
          <p className="text-sm text-white/55 mt-1">
            Turn an influencer photo into a talking-head video.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3.5 py-2 rounded-full"
            style={{ background: "rgba(201,164,76,0.08)", border: `1px solid ${GOLD}40` }}
          >
            <Coins className="w-4 h-4" style={{ color: GOLD }} />
            <span className="text-sm font-semibold tabular-nums" style={{ color: GOLD }}>
              {creditLabel}
            </span>
          </div>
          <button
            onClick={() => {
              setShowHistory(true);
              void loadTransactions();
            }}
            className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em] text-white/70 hover:text-white"
            style={{ border: "1px solid rgba(255,255,255,0.14)" }}
          >
            History
          </button>
          {!unlimited && (
            <button
              onClick={() => setShowBuy(true)}
              className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em]"
              style={{ background: GOLD, color: "#0E0E10" }}
            >
              Buy Credits
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb / step trail */}
      <div className="flex items-center gap-2 text-[12px] mb-6">
        <StepCrumb active={step === "gallery"} done={step !== "gallery"} onClick={() => setStep("gallery")}>
          1. Avatar
        </StepCrumb>
        <span className="text-white/25">/</span>
        <StepCrumb
          active={step === "looks" || step === "custom"}
          done={step === "editor"}
          disabled={!activeInfluencer && step !== "custom" && !(step === "editor" && !activeInfluencer)}
          onClick={() => setStep(activeInfluencer ? "looks" : "custom")}
        >
          2. Look
        </StepCrumb>
        <span className="text-white/25">/</span>
        <StepCrumb active={step === "editor"} done={false} disabled={!selectedPhoto} onClick={() => selectedPhoto && setStep("editor")}>
          3. Script &amp; voice
        </StepCrumb>
        <button
          onClick={() => setLocation("/video-gallery")}
          className="ml-auto text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60 hover:text-white"
        >
          View gallery -&gt;
        </button>
      </div>

      {/* ── STEP 1: avatar gallery ─────────────────────────────────────── */}
      {step === "gallery" && (
        <Section title="Pick an avatar">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => {
                setActiveInfluencer(null);
                setSelectedPhoto(null);
                setStep("custom");
              }}
              className="relative aspect-[3/4] rounded-xl border-2 border-dashed border-white/15 hover:border-[#C9A44C]/60 transition-colors flex flex-col items-center justify-center gap-1.5 cursor-pointer text-white/50 hover:text-white/80"
              title="Use your own looks"
            >
              <Upload className="w-5 h-5" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-center px-1">
                Custom looks
              </span>
              {customPhotos.length > 0 && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-black/55 text-white/80">
                  {customPhotos.length}
                </span>
              )}
            </button>
            {photos.map((p) => (
              <button
                key={`${p.influencerId}-${p.url}`}
                onClick={() =>
                  openInfluencer({
                    id: p.influencerId as number,
                    name: p.influencerName,
                    avatarUrl: p.url,
                  })
                }
                className="group relative aspect-[3/4] rounded-xl overflow-hidden border-2 border-transparent hover:border-[#C9A44C]/60 transition-all"
              >
                <img src={p.url} alt={p.influencerName} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 px-2 py-1.5 text-[11px] bg-black/60 truncate text-left">
                  {p.influencerName}
                </span>
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.1em] bg-black/55 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">
                  View looks
                </span>
              </button>
            ))}
          </div>
          {photos.length === 0 && customPhotos.length === 0 && (
            <p className="text-sm text-white/45 mt-3">
              No influencer photos yet - upload your own to get started.
            </p>
          )}
        </Section>
      )}

      {/* ── STEP 2: avatar detail / looks ──────────────────────────────── */}
      {step === "looks" && activeInfluencer && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => setStep("gallery")}
              className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> Avatars
            </button>
            <h2 className="text-lg font-bold" style={{ fontFamily: "var(--app-font-display)" }}>
              {activeInfluencer.name}
            </h2>
          </div>
          {looksLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
            </div>
          ) : looks.length === 0 ? (
            <p className="text-sm text-white/45">No looks found for this avatar.</p>
          ) : (
            <>
              <p className="text-[12px] text-white/50 mb-3">
                Pick the angle or scene you want this avatar to appear in.
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {looks.map((l) => (
                  <button
                    key={l.url}
                    onClick={() => chooseLook(l)}
                    className="relative aspect-[3/4] rounded-xl overflow-hidden border-2 transition-all"
                    style={{ borderColor: selectedPhoto?.url === l.url ? GOLD : "transparent" }}
                  >
                    <img src={l.url} alt={l.label} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] bg-black/60 truncate text-left">
                      {l.label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <button
                  disabled={!selectedPhoto}
                  onClick={() => setStep("editor")}
                  className="px-6 py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  style={{ background: GOLD, color: "#0E0E10" }}
                >
                  Use in video <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 2 (custom): upload your own looks and pick one ─────────── */}
      {step === "custom" && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => setStep("gallery")}
              className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> Avatars
            </button>
            <h2 className="text-lg font-bold" style={{ fontFamily: "var(--app-font-display)" }}>
              Custom looks
            </h2>
          </div>
          <p className="text-[12px] text-white/50 mb-3">
            Upload your own photos, then pick which look you want to use in the video.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <label
              className="relative aspect-[3/4] rounded-xl border-2 border-dashed border-white/15 hover:border-[#C9A44C]/60 transition-colors flex flex-col items-center justify-center gap-1.5 cursor-pointer text-white/50 hover:text-white/80"
              title="Upload a photo"
            >
              {uploadingImage ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: GOLD }} />
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-center px-1">
                    Upload photo
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploadingImage}
                onChange={onCustomImage}
              />
            </label>
            {customPhotos.map((p) => (
              <button
                key={`custom-${p.url}`}
                onClick={() => {
                  setActiveInfluencer(null);
                  setSelectedPhoto(p);
                }}
                className="relative aspect-[3/4] rounded-xl overflow-hidden border-2 transition-all"
                style={{ borderColor: selectedPhoto?.url === p.url ? GOLD : "transparent" }}
              >
                <img src={p.url} alt={p.influencerName} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] bg-black/60 truncate text-left">
                  {p.influencerName}
                </span>
              </button>
            ))}
          </div>
          {customPhotos.length === 0 && (
            <p className="text-sm text-white/45 mt-3">
              No custom looks yet - upload a photo above to get started.
            </p>
          )}
          <div className="mt-6">
            <button
              disabled={!selectedPhoto}
              onClick={() => setStep("editor")}
              className="px-6 py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              style={{ background: GOLD, color: "#0E0E10" }}
            >
              Use in video <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: editor (script left, avatar right) ─────────────────── */}
      {step === "editor" && selectedPhoto && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={backFromEditor}
              className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4" /> {activeInfluencer ? "Looks" : "Custom looks"}
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* LEFT: words + voice */}
            <div>
              <Section title="Script">
                <div className="flex gap-2 mb-4">
                  <ModeChip
                    active={inputMode === "text"}
                    label="Type a script"
                    onClick={() => setInputMode("text")}
                  />
                  <ModeChip
                    active={inputMode === "audio"}
                    label="Record / upload audio"
                    onClick={() => setInputMode("audio")}
                    disabled={!stsConfigured}
                    title={stsConfigured ? undefined : "Voice changer is not configured"}
                  />
                </div>

                {inputMode === "text" ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => setShowWriter(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold"
                        style={{ background: "rgba(201,164,76,0.12)", color: GOLD, border: `1px solid ${GOLD}40` }}
                      >
                        <Wand2 className="w-3.5 h-3.5" /> Generate from podcast / Brain
                      </button>
                    </div>
                    <input
                      value={hook}
                      onChange={(e) => setHook(e.target.value)}
                      placeholder="On-screen hook (optional)"
                      className="w-full mb-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60"
                    />
                    <textarea
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      placeholder="What should they say to camera? Write naturally - line breaks become spoken pauses."
                      rows={8}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60 resize-y"
                    />
                    <p className="text-[11px] text-white/40 mt-1.5">
                      Tip: leave a blank line between thoughts - we turn your layout into
                      natural pauses so the delivery doesn't sound rushed.
                    </p>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12px] text-white/55">
                      Record yourself or upload a clip (up to {MAX_VIDEO_SECONDS}s). We convert
                      it to your chosen voice, then lip-sync the photo to it.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {recording ? (
                        <button
                          onClick={stopRecording}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-bold"
                          style={{ background: "#f0676740", color: "#f08a8a", border: "1px solid #f0676760" }}
                        >
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                          Stop ({recordSeconds}s / {MAX_VIDEO_SECONDS}s)
                        </button>
                      ) : (
                        <button
                          onClick={startRecording}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-bold"
                          style={{ background: "rgba(201,164,76,0.12)", color: GOLD, border: `1px solid ${GOLD}40` }}
                        >
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                          {audioBlob ? "Re-record" : "Record"}
                        </button>
                      )}
                      <label className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[13px] font-semibold cursor-pointer bg-white/[0.06] hover:bg-white/[0.1]">
                        Upload file
                        <input type="file" accept="audio/*" className="hidden" onChange={onAudioFile} />
                      </label>
                    </div>
                    {audioUrl && !recording && (
                      <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-white/[0.04] border border-white/10">
                        <audio src={audioUrl} controls className="h-8 max-w-full" />
                        <div className="text-[12px] text-white/55 min-w-0">
                          <p className="truncate">{audioName}</p>
                          {audioDuration != null && (
                            <p className={audioOverLength ? "text-red-400" : ""}>
                              ~{Math.round(audioDuration)}s
                            </p>
                          )}
                        </div>
                        <button onClick={resetAudio} className="ml-auto text-white/40 hover:text-white/70">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {audioOverLength && (
                      <p className="text-[11px] text-red-400">
                        That clip is too long - keep it under {MAX_VIDEO_SECONDS} seconds.
                      </p>
                    )}
                  </div>
                )}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title (optional)"
                  className="w-full mt-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60"
                />
              </Section>

              <Section title="Voice">
                {inputMode === "text" ? (
                  voices.length === 0 ? (
                    <p className="text-sm text-white/45">No voices available.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={voiceId}
                        onChange={(e) => setVoiceId(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60 max-w-full"
                      >
                        {voices.map((v) => (
                          <option key={v.voiceId} value={v.voiceId} className="bg-[#0E0E10]">
                            {v.name}
                            {v.language ? ` (${v.language})` : ""}
                            {v.gender ? ` - ${v.gender}` : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => playPreview(voices.find((v) => v.voiceId === voiceId)?.previewUrl ?? null)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white/[0.06] hover:bg-white/[0.1]"
                      >
                        <Play className="w-3.5 h-3.5" /> Preview
                      </button>
                    </div>
                  )
                ) : stsVoices.length === 0 ? (
                  <p className="text-sm text-white/45">No voices available.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={stsVoiceId}
                      onChange={(e) => setStsVoiceId(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60 max-w-full"
                    >
                      {stsVoices.map((v) => (
                        <option key={v.voiceId} value={v.voiceId} className="bg-[#0E0E10]">
                          {v.name}
                          {v.category ? ` (${v.category})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => playPreview(stsVoices.find((v) => v.voiceId === stsVoiceId)?.previewUrl ?? null)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white/[0.06] hover:bg-white/[0.1]"
                    >
                      <Play className="w-3.5 h-3.5" /> Preview
                    </button>
                  </div>
                )}
              </Section>
            </div>

            {/* RIGHT: avatar preview */}
            <div className="lg:sticky lg:top-6 self-start">
              <div className="rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03]">
                <div className="aspect-[9/16] bg-black/40">
                  <img src={selectedPhoto.url} alt={selectedPhoto.influencerName} className="w-full h-full object-cover" />
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-sm font-semibold truncate">{selectedPhoto.influencerName}</p>
                  <p className="text-[11px] text-white/45">9:16 vertical - High quality</p>
                </div>
              </div>
              <button
                onClick={() => setStep(activeInfluencer ? "looks" : "custom")}
                className="w-full mt-2 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-white/65 hover:text-white"
                style={{ border: "1px solid rgba(255,255,255,0.14)" }}
              >
                Change look
              </button>
            </div>
          </div>

          {/* Estimate + generate */}
          <div
            className="sticky bottom-4 mt-8 rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: "#0E0E10", border: `1px solid ${GOLD}40` }}
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Estimated cost</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: GOLD }}>
                {unlimited
                  ? "Unlimited"
                  : `${fmtCredits(totalCost)} credit${totalCost === 1 ? "" : "s"}`}
              </p>
              {script.trim().length > 0 && (
                <p
                  className="text-[11px] mt-0.5 tabular-nums"
                  style={{ color: overLength ? "#f08a8a" : "rgba(255,255,255,0.45)" }}
                >
                  ~{Math.round(estSeconds)}s / {MAX_VIDEO_SECONDS}s max ({wordCount} words)
                </p>
              )}
              {overLength && (
                <p className="text-[11px] text-red-400 mt-0.5">
                  Script is too long - trim it under {MAX_VIDEO_SECONDS} seconds to generate.
                </p>
              )}
              {lowCredits && !overLength && (
                <p className="text-[11px] text-red-400 mt-0.5">
                  Not enough credits.{" "}
                  <button onClick={() => setShowBuy(true)} className="underline">
                    Buy more
                  </button>
                </p>
              )}
            </div>
            <button
              disabled={!canGenerate}
              onClick={() => setShowConfirm(true)}
              className="px-6 py-3 rounded-full text-[14px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              style={{ background: GOLD, color: "#0E0E10" }}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate
            </button>
          </div>
        </div>
      )}

      {/* Active job progress */}
      {activeJob && activeJob.status !== "completed" && activeJob.status !== "failed" && (
        <div className="mt-6 rounded-xl px-5 py-4 flex items-center gap-3" style={{ background: "rgba(201,164,76,0.06)", border: `1px solid ${GOLD}30` }}>
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: GOLD }} />
          <div>
            <p className="text-sm font-semibold">Generating your video...</p>
            <p className="text-[12px] text-white/55">Status: {activeJob.status}. This page will update automatically.</p>
          </div>
        </div>
      )}
      {activeJob?.status === "completed" && (
        <div className="mt-6 rounded-xl px-5 py-4 space-y-3" style={{ background: "rgba(201,164,76,0.06)", border: `1px solid ${GOLD}30` }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Your video is ready.</p>
            <button onClick={() => setLocation("/video-gallery")} className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em] border border-white/20 text-white/80">
              Open gallery
            </button>
          </div>
          {editConfigured &&
            (activeJob.editStatus === "completed" ? (
              <p className="text-[12px] text-white/70">
                Podcast edit ready - find the edited cut in your gallery.
              </p>
            ) : activeJob.editStatus === "pending" || activeJob.editStatus === "editing" ? (
              <div className="flex items-center gap-2 text-[12px] text-white/70">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
                Editing your podcast clip... this page updates automatically.
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] text-white/70">
                    One-click podcast edit: white-border crop, keyword b-roll, hook overlay,
                    single-word captions, and background music.
                  </p>
                  {activeJob.editStatus === "failed" && (
                    <p className="text-[11px] text-red-400 mt-0.5">
                      Last edit failed - your {fmtCredits(editCost)} credit was refunded.
                    </p>
                  )}
                </div>
                <button
                  disabled={editing}
                  onClick={() => doAutoEdit(activeJob.id)}
                  className="shrink-0 px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 flex items-center gap-2"
                  style={{ background: GOLD, color: "#0E0E10" }}
                >
                  {editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Podcast Edit ({fmtCredits(editCost)} credit)
                </button>
              </div>
            ))}
        </div>
      )}

      {/* AI writer modal */}
      <Dialog open={showWriter} onOpenChange={setShowWriter}>
        <DialogContent className="bg-[#0E0E10] border-[#C9A44C]/30 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Use a podcast clip</DialogTitle>
            <DialogDescription className="text-white/55">
              Pull from a script you already wrote in the Script Writer, or
              generate a fresh podcast clip from your Brain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/45 mb-2">
                Your podcast clips
              </p>
              {prevClips === null ? (
                <div className="py-4 flex justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
                </div>
              ) : prevClips.length === 0 ? (
                <p className="text-[12px] text-white/45">
                  No podcast clips yet. Generate one below.
                </p>
              ) : (
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                  {prevClips.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => applyPodcastResult(j.result)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 hover:border-[#C9A44C]/60 transition-colors"
                    >
                      <p className="text-sm text-white/85 truncate">
                        {j.label || j.result?.screenshotLine || "Podcast clip"}
                      </p>
                      <p className="text-[11px] text-white/40">
                        {new Date(j.createdAt).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-white/10" />

            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">
                Generate a new clip
              </p>
              <textarea
                value={writerSeed}
                onChange={(e) => setWriterSeed(e.target.value)}
                placeholder="What should this clip be about? (e.g. why most creators quit too early)"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60 resize-y"
              />
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-white/55">Length</span>
                <select
                  value={writerSeconds}
                  onChange={(e) => setWriterSeconds(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none"
                >
                  <option value={30} className="bg-[#0E0E10]">30s</option>
                  <option value={45} className="bg-[#0E0E10]">45s</option>
                  <option value={60} className="bg-[#0E0E10]">60s</option>
                  <option value={90} className="bg-[#0E0E10]">90s</option>
                </select>
              </div>
              <button
                disabled={writing || !writerSeed.trim()}
                onClick={runWriter}
                className="w-full py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: GOLD, color: "#0E0E10" }}
              >
                {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {writing ? "Writing..." : "Generate clip"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm modal */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-[#0E0E10] border-[#C9A44C]/30 text-white">
          <DialogHeader>
            <DialogTitle>Confirm generation</DialogTitle>
            <DialogDescription className="text-white/55">
              {unlimited
                ? "Admins generate for free - no credits will be deducted."
                : `This will deduct ${fmtCredits(totalCost)} credit${totalCost === 1 ? "" : "s"} from your balance.`}
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-white/70 space-y-1">
            <p>Photo: {selectedPhoto?.influencerName}</p>
            <p>Format: 9:16 vertical - High quality</p>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={() => setShowConfirm(false)} className="px-4 py-2.5 rounded-full text-[12px] font-semibold text-white/65 border border-white/20">
              Cancel
            </button>
            <button onClick={doGenerate} className="flex-1 py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em]" style={{ background: GOLD, color: "#0E0E10" }}>
              {unlimited
                ? "Generate"
                : `Generate for ${fmtCredits(totalCost)} credit${totalCost === 1 ? "" : "s"}`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post-generate b-roll upsell (Task #005) */}
      <Dialog open={showBroll} onOpenChange={setShowBroll}>
        <DialogContent className="bg-[#0E0E10] border-[#C9A44C]/30 text-white">
          <DialogHeader>
            <DialogTitle>Add a podcast b-roll edit?</DialogTitle>
            <DialogDescription className="text-white/55">
              Your video is ready. Want a one-click podcast edit on top? We add a
              white-border crop, keyword b-roll, hook overlay, single-word captions,
              and background music.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-white/70">
            {unlimited
              ? "Included for admins - no credits will be deducted."
              : `This adds ${fmtCredits(editCost)} credit${editCost === 1 ? "" : "s"} to this video.`}
          </p>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => setShowBroll(false)}
              className="px-4 py-2.5 rounded-full text-[12px] font-semibold text-white/65 border border-white/20"
            >
              No thanks
            </button>
            <button
              disabled={editing}
              onClick={() => {
                setShowBroll(false);
                if (activeJob) void doAutoEdit(activeJob.id);
              }}
              className="flex-1 py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em] disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: GOLD, color: "#0E0E10" }}
            >
              {editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {unlimited
                ? "Yes, add b-roll edit"
                : `Yes, add b-roll (${fmtCredits(editCost)} credit${editCost === 1 ? "" : "s"})`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Buy credits modal */}
      <Dialog open={showBuy} onOpenChange={setShowBuy}>
        <DialogContent className="bg-transparent border-0 p-0 shadow-none max-w-md">
          <BuyCreditsPanel
            onClose={() => setShowBuy(false)}
            onPurchased={() => {
              void loadBalance();
              setShowBuy(false);
              toast({ title: "Credits added", description: "Your balance has been updated." });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Credit transaction history */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="bg-[#121214] border border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "var(--app-font-display)" }}>
              Credit history
            </DialogTitle>
            <DialogDescription className="text-white/50">
              Every video credit added, spent, or refunded.
            </DialogDescription>
          </DialogHeader>
          {transactions === null ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: GOLD }} />
            </div>
          ) : transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/45">No transactions yet.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/8">
              {transactions.map((t) => {
                const positive = t.amount >= 0;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-white/85 truncate">{t.reason ?? t.type}</p>
                      <p className="text-[11px] text-white/40">
                        {new Date(t.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="text-sm font-semibold tabular-nums"
                        style={{ color: positive ? "#6ee7a8" : "#f08a8a" }}
                      >
                        {positive ? "+" : ""}
                        {fmtCredits(t.amount)}
                      </p>
                      <p className="text-[11px] text-white/40 tabular-nums">
                        bal {fmtCredits(t.balanceAfter)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type CreditPricing = {
  pricePerCreditCents: number;
  min: number;
  max: number;
  presets: number[];
};

function BuyCreditsPanel(props: { onClose: () => void; onPurchased: () => void }) {
  const [pricing, setPricing] = useState<CreditPricing | null>(null);
  const [qty, setQty] = useState(10);
  const [checkout, setCheckout] = useState(false);
  const { links: purchaseLinks } = usePurchaseLinks();

  useEffect(() => {
    (async () => {
      try {
        const d = await fetchApi<CreditPricing>("/api/video/credits/packs");
        setPricing(d);
        if (d.presets?.length) setQty(d.presets[Math.min(1, d.presets.length - 1)]);
        else setQty(Math.max(1, d.min ?? 1));
      } catch {
        setPricing(null);
      }
    })();
  }, []);

  const perCredit = pricing?.pricePerCreditCents ?? 250;
  const min = pricing?.min ?? 1;
  const max = pricing?.max ?? 1000;
  const clampedQty = Math.min(Math.max(qty || min, min), max);
  const amountCents = clampedQty * perCredit;

  if (checkout) {
    return (
      <PurchasingMovedNotice
        label="Video credit"
        // Reserved slug: admins configure a "video-credits" product with a
        // Purchase URL to point this at their GHL credits sales page.
        purchaseUrl={purchaseLinks["video-credits"]}
        onCancel={() => setCheckout(false)}
      />
    );
  }

  return (
    <div className="rounded-2xl px-5 py-6" style={{ background: "#0E0E10", border: `1px solid ${GOLD}40` }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
          Buy video credits
        </h3>
        <button onClick={props.onClose} className="text-white/50 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <p className="text-[12px] text-white/45 mb-4">
        ${(perCredit / 100).toFixed(2)} per credit. 1 credit = 1 video.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {(pricing?.presets ?? [5, 10, 25, 50]).map((p) => (
          <button
            key={p}
            onClick={() => setQty(p)}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
            style={
              clampedQty === p
                ? { background: GOLD, color: "#0E0E10" }
                : { background: "rgba(201,164,76,0.08)", color: GOLD, border: `1px solid ${GOLD}40` }
            }
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-[12px] text-white/55">Credits</span>
        <input
          type="number"
          min={min}
          max={max}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          onBlur={() => setQty(clampedQty)}
          className="w-24 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm outline-none focus:border-[#C9A44C]/60 tabular-nums"
        />
        <span className="ml-auto text-lg font-extrabold tabular-nums" style={{ color: GOLD }}>
          ${(amountCents / 100).toFixed(2)}
        </span>
      </div>

      <button
        onClick={() => setCheckout(true)}
        className="w-full py-3 rounded-full text-[13px] font-bold uppercase tracking-[0.12em]"
        style={{ background: GOLD, color: "#0E0E10" }}
      >
        Continue - {clampedQty} credit{clampedQty === 1 ? "" : "s"}
      </button>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/50 mb-3" style={{ fontFamily: "var(--app-font-display)" }}>
        {props.title}
      </h2>
      {props.children}
    </div>
  );
}

function ModeChip(props: {
  active: boolean;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled}
      className="px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-[0.1em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={
        props.active
          ? { background: GOLD, color: "#0E0E10" }
          : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)" }
      }
    >
      {props.label}
    </button>
  );
}

function StepCrumb(props: {
  active: boolean;
  done: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const color = props.active
    ? GOLD
    : props.done
      ? "rgba(255,255,255,0.7)"
      : "rgba(255,255,255,0.4)";
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="font-bold uppercase tracking-[0.12em] disabled:cursor-not-allowed transition-colors"
      style={{ color }}
    >
      {props.children}
    </button>
  );
}
