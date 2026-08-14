import { useState, useEffect, useRef, useCallback } from "react";
import { useSearch, useLocation } from "wouter";
import {
  Monitor, Video, Mic, User, Layers, FileText, Zap,
  Film, Upload, X, Copy, Check, Loader2, RefreshCw,
  ChevronLeft, ChevronDown, ChevronRight, Clock, AlertCircle, FileStack,
  Sparkles, Users, Cpu,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import {
  useScriptJob,
  startScriptJobJson,
  startScriptJobFormData,
  listJobs,
  type ScriptJobRow,
  type ScriptJobType,
} from "@/lib/script-jobs";
import { toast } from "@/hooks/use-toast";
import { api, getAuthHeaders } from "@/lib/api";

const GOLD = "#C9A44C";

// ─── Script type definitions ───────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  options?: string[];
  placeholder?: string;
  optional?: boolean;
  hint?: string;
}

interface ScriptTypeDef {
  slug: string;
  jobType: ScriptJobType;
  label: string;
  description: string;
  icon: any;
  color: string;
  imageUpload?: { max: number; label: string; hint?: string };
  fields: FieldDef[];
  endpoint: string;
  resultFields?: { key: string; label: string }[];
}

const SCRIPT_TYPES: ScriptTypeDef[] = [
  {
    slug: "green-screen",
    jobType: "green-screen",
    label: "Green Screen",
    description:
      "60-second script built around images you show on the green screen — article headlines, Stripe screenshots, Apple Notes, charts.",
    icon: Monitor,
    color: "#10b981",
    imageUpload: {
      max: 10,
      label: "Upload green-screen images (in the order they appear on screen)",
      hint:
        "Image 1 = what you show first. Max 10. JPG, PNG, WebP, GIF accepted.",
    },
    fields: [
      {
        key: "context",
        label: "Context",
        type: "textarea",
        placeholder:
          "Why are you talking about these images? What's the hook / angle you want to take?",
        hint: "1–3 sentences is enough. The AI reads the images and builds the script around them.",
      },
      {
        key: "commentWord",
        label: "Comment word (CTA)",
        type: "text",
        placeholder: "e.g. GO  ·  START  ·  SYSTEM  ·  AI",
        hint: "One word, uppercase. Viewers comment this to get the payoff.",
      },
    ],
    endpoint: "/api/portal/script-writer/green-screen",
    resultFields: [{ key: "fullScript", label: "Full Script" }],
  },
  {
    slug: "hook-demo",
    jobType: "hook-demo",
    label: "Hook + Demo",
    description:
      "15–25 second screen-recording demo. Upload a screenshot per step — the AI reads each one and writes a spoken or silent hook+demo script.",
    icon: Video,
    color: "#10b981",
    imageUpload: {
      max: 6,
      label: "Upload one screenshot per step (in order)",
      hint:
        "Image 1 = Step 1's screen. Up to 6 steps. JPG, PNG, WebP accepted.",
    },
    fields: [
      {
        key: "context",
        label: "What the demo does",
        type: "textarea",
        placeholder:
          "Describe the flow — what tool are you walking through, and what does the viewer see at the end?",
      },
      {
        key: "commentWord",
        label: "Comment word (CTA)",
        type: "text",
        placeholder: "e.g. AI  ·  PROMPT  ·  DEMO",
      },
      {
        key: "version",
        label: "Script version",
        type: "select",
        options: ["voiceover", "silent", "both"],
        hint:
          "Voiceover = spoken script. Silent = on-screen captions only. Both = get both versions.",
      },
    ],
    endpoint: "/api/portal/script-writer/hook-demo",
    resultFields: [{ key: "fullScript", label: "Voiceover Script" }],
  },
  {
    slug: "podcast-clip",
    jobType: "podcast-clip",
    label: "Podcast Clip",
    description:
      "Opinionated, conversational 30–90 second clip recorded side-on with a mic. Contrarian, truth-bomb, or polarising — the kind of clip people screenshot.",
    icon: Mic,
    color: "#6366f1",
    fields: [
      {
        key: "context",
        label: "What to talk about",
        type: "textarea",
        placeholder:
          "Give it a topic, a strong opinion, or a contrarian angle. e.g. 'Most people using AI are actually becoming lazier, not more productive.'",
      },
      {
        key: "targetSeconds",
        label: "Target length",
        type: "select",
        options: ["30", "45", "60", "90"],
      },
      {
        key: "hookType",
        label: "Hook style",
        type: "select",
        options: ["any", "contrarian", "truthBomb", "polarising", "iRealised"],
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
        hint: "Soft = conversational close. Comment = 'Comment X below.' None = ends on punchline.",
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        placeholder: "e.g. AI  ·  FRAMEWORK  ·  YES",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/podcast-clip",
    resultFields: [{ key: "fullScript", label: "Full Script" }],
  },
  {
    slug: "speaking-clip",
    jobType: "speaking-clip",
    label: "Speaking Clip",
    description:
      "15–90 second on-stage authority clip. Certain, composed, conviction-loaded. Side-on or front-on with a mic, audience implied.",
    icon: Mic,
    color: "#8b5cf6",
    fields: [
      {
        key: "context",
        label: "What to talk about",
        type: "textarea",
        placeholder:
          "The topic, the belief you want to challenge, or the insight the audience has never heard put this way.",
      },
      {
        key: "targetSeconds",
        label: "Target length",
        type: "select",
        options: ["15", "30", "45", "60", "90"],
      },
      {
        key: "hookType",
        label: "Hook style",
        type: "select",
        options: [
          "any",
          "strongStatement",
          "contrarian",
          "audienceChallenge",
          "futureBased",
          "truthBomb",
        ],
      },
      {
        key: "ctaMode",
        label: "Ending",
        type: "select",
        options: ["soft", "none"],
        hint: "Stage clips never use 'Comment X' — it breaks the authority frame.",
      },
    ],
    endpoint: "/api/portal/script-writer/speaking-clip",
    resultFields: [{ key: "fullScript", label: "Full Script" }],
  },
  {
    slug: "selfie-clip",
    jobType: "selfie-clip",
    label: "Selfie Yapping",
    description:
      "Casual, raw 15–90 second clip filmed walking, in a car, or outside holding the phone. Honest, unfiltered, like a friend who had to say this.",
    icon: User,
    color: "#f59e0b",
    fields: [
      {
        key: "context",
        label: "What to rant about",
        type: "textarea",
        placeholder:
          "A topic, a realisation, or a strong opinion. e.g. 'I've realised most online advice is designed to keep you consuming, not doing.'",
      },
      {
        key: "targetSeconds",
        label: "Target length",
        type: "select",
        options: ["15", "30", "45", "60", "90"],
      },
      {
        key: "hookType",
        label: "Hook style",
        type: "select",
        options: [
          "any",
          "contrarian",
          "emotionalTruth",
          "futureBased",
          "curiosityBased",
          "polarising",
        ],
      },
      {
        key: "formula",
        label: "Rant formula",
        type: "select",
        options: ["any", "realisation", "contrarianOpinion", "storyBased"],
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        placeholder: "e.g. AI  ·  YES",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/selfie-clip",
    resultFields: [{ key: "fullScript", label: "Full Script" }],
  },
  {
    slug: "slideshow",
    jobType: "slideshow",
    label: "Viral Slideshow",
    description:
      "TikTok/IG slideshow copy — cover hook, per-slide text overlays, image prompts, and CTA slide. 5 to 12 slides.",
    icon: Layers,
    color: "#ec4899",
    fields: [
      {
        key: "context",
        label: "Topic / angle",
        type: "textarea",
        placeholder:
          "e.g. '5 signs you're using AI wrong', or 'Why most productivity systems fail by week 2'",
      },
      {
        key: "slideCount",
        label: "Number of slides",
        type: "select",
        options: ["5", "7", "9", "12"],
      },
      {
        key: "hookType",
        label: "Cover hook style",
        type: "select",
        options: [
          "any",
          "xThings",
          "contrarian",
          "emotionalTruth",
          "curiosityBased",
          "futureBased",
        ],
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        placeholder: "e.g. SLIDES",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/slideshow",
    resultFields: [{ key: "fullScript", label: "Slide Copy" }],
  },
  {
    slug: "carousel",
    jobType: "carousel",
    label: "Viral Carousel",
    description:
      "Instagram/LinkedIn carousel copy — swipe-stopping cover, per-slide headlines, body copy, and a strong follow/save CTA.",
    icon: FileText,
    color: "#ec4899",
    fields: [
      {
        key: "context",
        label: "Topic / angle",
        type: "textarea",
        placeholder:
          "e.g. '3 things I wish I knew before starting an online business'",
      },
      {
        key: "slideCount",
        label: "Number of slides",
        type: "select",
        options: ["5", "7", "9", "12"],
      },
      {
        key: "hookType",
        label: "Cover hook style",
        type: "select",
        options: [
          "any",
          "xThings",
          "contrarian",
          "emotionalTruth",
          "curiosityBased",
          "futureBased",
        ],
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/carousel",
    resultFields: [{ key: "fullScript", label: "Carousel Copy" }],
  },
  {
    slug: "overlay",
    jobType: "overlay",
    label: "Overlay Clip",
    description:
      "Script for b-roll overlay content — spoken over footage of your lifestyle, product, or workspace. No face needed.",
    icon: Film,
    color: "#14b8a6",
    fields: [
      {
        key: "context",
        label: "Topic / angle",
        type: "textarea",
        placeholder:
          "What's the message? What footage will play behind the voiceover?",
      },
      {
        key: "targetSeconds",
        label: "Target length",
        type: "select",
        options: ["15", "30", "45", "60"],
      },
      {
        key: "hookType",
        label: "Hook style",
        type: "select",
        options: ["any", "howI", "contrarian", "socialProof", "emotionalCuriosity", "futureBased"],
        hint: "'any' lets the AI pick the strongest hook for the topic.",
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
        hint: "Soft = conversational close. Comment = 'Comment X below.' None = ends on punchline.",
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/overlay",
    resultFields: [{ key: "fullScript", label: "Voiceover Script" }],
  },
  {
    slug: "fastmotion",
    jobType: "fastmotion",
    label: "Fast Motion Clip",
    description:
      "Script for fast-cut edit style — short punchy lines that sync with jump cuts, sped-up footage, or montage editing.",
    icon: Zap,
    color: "#f97316",
    fields: [
      {
        key: "context",
        label: "Topic / angle",
        type: "textarea",
        placeholder:
          "What's the message? What footage will be fast-cut behind this? e.g. 'A day in my life as an AI founder'",
      },
      {
        key: "targetSeconds",
        label: "Target length",
        type: "select",
        options: ["15", "30", "45", "60"],
      },
      {
        key: "hookType",
        label: "Hook style",
        type: "select",
        options: ["any", "pov", "identity", "futureBased", "emotional", "ambition"],
        hint: "'any' lets the AI pick the strongest hook for the footage.",
      },
      {
        key: "aesthetic",
        label: "Visual aesthetic",
        type: "select",
        options: ["auto", "luxury", "discipline", "freedom", "wealth", "ambition", "creator", "minimalist", "travel", "highPerformance"],
        hint: "'auto' matches the aesthetic to your Brain and offer automatically.",
      },
      {
        key: "ctaMode",
        label: "CTA",
        type: "select",
        options: ["soft", "comment", "none"],
        hint: "Soft = conversational close. Comment = 'Comment X below.' None = ends on punchline.",
      },
      {
        key: "commentWord",
        label: "Comment word (if CTA = comment)",
        type: "text",
        optional: true,
      },
    ],
    endpoint: "/api/portal/script-writer/fastmotion",
    resultFields: [{ key: "fullScript", label: "Script" }],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEta(ms: number | null): string {
  if (ms === null) return "Almost done";
  const s = Math.ceil(ms / 1000);
  return s > 60 ? `~${Math.ceil(s / 60)}m` : `~${s}s`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Image Upload Grid ────────────────────────────────────────────────────────

function ImageUploadGrid({
  files,
  onChange,
  max,
  label,
  hint,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return;
      const allowed = Array.from(incoming).filter((f) =>
        ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type)
      );
      onChange([...files, ...allowed].slice(0, max));
    },
    [files, max, onChange]
  );

  const removeFile = (idx: number) => {
    const next = [...files];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div>
      <label className="block text-[12px] font-medium text-white/60 mb-2">
        {label}{" "}
        <span className="text-white/30">
          ({files.length}/{max})
        </span>
      </label>
      {hint && (
        <p className="text-[11px] text-white/30 mb-3 leading-relaxed">{hint}</p>
      )}

      {/* Thumbnails */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {files.map((f, i) => {
            const url = URL.createObjectURL(f);
            return (
              <div key={i} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-white/[0.1]">
                <img src={url} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    onClick={() => removeFile(i)}
                    className="p-1 rounded-full bg-red-500/80 text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <span className="absolute bottom-0.5 left-0.5 text-[10px] font-bold text-white/80 bg-black/60 px-1 rounded">{i + 1}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Drop zone */}
      {files.length < max && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 transition-colors ${
            dragging
              ? "border-[#C9A44C]/60 bg-[#C9A44C]/5"
              : "border-white/[0.1] hover:border-white/20 hover:bg-white/[0.02]"
          }`}
        >
          <Upload className="w-5 h-5 text-white/30" />
          <p className="text-[12px] text-white/40 text-center">
            Click to upload or drag images here
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.1] text-white/60 hover:text-white text-[12px] font-medium transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Result Display ───────────────────────────────────────────────────────────

function ScriptResult({ result, def }: { result: any; def: ScriptTypeDef }) {
  const fullScript: string = result?.fullScript || result?.voiceover?.fullScript || "";

  // For green-screen / hook-demo, also show imageReadback
  const imageReadback: Array<{ index: number; summary: string }> =
    Array.isArray(result?.imageReadback) ? result.imageReadback : [];

  // For clip types, show sections
  const sections: Record<string, string> = result?.sections || {};

  // Screenshot line
  const screenshotLine: string = result?.screenshotLine || "";

  // Hook used
  const hookFormulaUsed: string = result?.hookFormulaUsed || "";

  // On-screen hook for selfie clips
  const onScreenHook: string = sections?.onScreenHook || "";

  // Silent version for hook-demo
  const silent = result?.silent || null;

  return (
    <div className="space-y-5">
      {/* Main script */}
      {fullScript && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-[12px] font-semibold text-white/60 uppercase tracking-wider">Full Script</span>
            <CopyButton text={fullScript} />
          </div>
          <div className="p-4">
            <p className="text-[14px] text-white/90 leading-relaxed whitespace-pre-wrap font-mono">{fullScript}</p>
          </div>
        </div>
      )}

      {/* On-screen hook (selfie clips) */}
      {onScreenHook && (
        <div className="rounded-xl border border-[#C9A44C]/20 bg-[#C9A44C]/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#C9A44C] mb-1">On-Screen Hook Text</p>
          <p className="text-[15px] font-bold text-white">{onScreenHook}</p>
        </div>
      )}

      {/* Screenshot line */}
      {screenshotLine && (
        <div className="rounded-xl border border-[#C9A44C]/20 bg-[#C9A44C]/5 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#C9A44C] mb-1">Screenshot Line</p>
          <p className="text-[14px] text-white italic">"{screenshotLine}"</p>
        </div>
      )}

      {/* Hook formula used */}
      {hookFormulaUsed && (
        <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1">Hook Formula Used</p>
          <p className="text-[12px] text-white/60">{hookFormulaUsed}</p>
        </div>
      )}

      {/* Sections breakdown */}
      {Object.keys(sections).filter(k => k !== "onScreenHook" && sections[k]).length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/30">Script Sections</p>
          {Object.entries(sections)
            .filter(([k, v]) => k !== "onScreenHook" && v)
            .map(([k, v]) => (
              <div key={k} className="px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1 capitalize">
                  {k.replace(/([A-Z])/g, " $1").trim()}
                </p>
                <p className="text-[13px] text-white/70 leading-relaxed">{v}</p>
              </div>
            ))}
        </div>
      )}

      {/* Image readback */}
      {imageReadback.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/30">What the AI Read From Your Images</p>
          {imageReadback.map((r) => (
            <div key={r.index} className="flex gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <span className="text-[11px] font-bold text-white/30 w-12 flex-shrink-0">Img {r.index}</span>
              <p className="text-[12px] text-white/60">{r.summary}</p>
            </div>
          ))}
        </div>
      )}

      {/* Silent version (hook-demo only) */}
      {silent && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <span className="text-[12px] font-semibold text-white/60 uppercase tracking-wider">Silent Version (On-Screen Captions)</span>
          </div>
          <div className="p-4 space-y-2">
            {silent.textHook && (
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Hook Caption</p>
                <p className="text-[14px] font-bold text-white">{silent.textHook}</p>
              </div>
            )}
            {Array.isArray(silent.stepCaptions) && silent.stepCaptions.map((s: any) => (
              <div key={s.index} className="flex gap-2">
                <span className="text-[10px] text-white/30 w-10 flex-shrink-0 pt-0.5">Step {s.index}</span>
                <p className="text-[13px] text-white/70">{s.caption}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Script Panel (one per type) ───────────────────────────────────────────────

function ScriptPanel({ def, externalResult }: { def: ScriptTypeDef; externalResult?: any }) {
  const [form, setForm] = useState<Record<string, string>>({
    targetSeconds: "60",
    version: "voiceover",
    ctaMode: "soft",
    hookType: "any",
    formula: "any",
    slideCount: "7",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<any>(externalResult ?? null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const job = useScriptJob(
    def.jobType,
    (j) => {
      setResult(j.result);
      setLoadingHistory(true);
      listJobs(def.jobType, 5).then(setHistory).finally(() => setLoadingHistory(false));
    },
    (j) => {
      toast({
        title: "Generation failed",
        description: j.errorMessage || "Something went wrong. Try again.",
        variant: "destructive",
      });
    },
    { autoResume: true }
  );

  useEffect(() => {
    setLoadingHistory(true);
    listJobs(def.jobType, 5).then(setHistory).finally(() => setLoadingHistory(false));
  }, [def.jobType]);

  const handleGenerate = async () => {
    const context = (form.context || "").trim();
    if (!context) {
      toast({ title: "Add some context first", variant: "destructive" });
      return;
    }
    if (def.imageUpload && files.length === 0) {
      toast({ title: "Upload at least one image", variant: "destructive" });
      return;
    }
    if (def.imageUpload) {
      const commentWord = (form.commentWord || "").trim();
      if (!commentWord) {
        toast({ title: "Enter a comment word for the CTA", variant: "destructive" });
        return;
      }
    }

    setSubmitting(true);
    try {
      let jobId: number;
      if (def.imageUpload) {
        const fd = new FormData();
        for (const f of files) fd.append("images", f);
        fd.append("context", context);
        if (form.commentWord) fd.append("commentWord", form.commentWord.trim().toUpperCase());
        if (form.version) fd.append("version", form.version);
        jobId = await startScriptJobFormData(
          `/api/portal/script-writer/${def.slug}`,
          fd
        );
      } else {
        const payload: any = { context };
        if (form.commentWord) payload.commentWord = form.commentWord.trim().toUpperCase();
        if (form.targetSeconds) payload.targetSeconds = Number(form.targetSeconds);
        if (form.hookType && form.hookType !== "any") payload.hookType = form.hookType;
        if (form.formula && form.formula !== "any") payload.formula = form.formula;
        if (form.ctaMode) payload.ctaMode = form.ctaMode;
        if (form.slideCount) payload.slideCount = Number(form.slideCount);
        jobId = await startScriptJobJson(
          `/api/portal/script-writer/${def.slug}`,
          payload
        );
      }
      job.start(jobId);
      setResult(null);
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const isActive = job.isActive;
  const inputDisabled = isActive || submitting;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${def.color}20` }}
        >
          <def.icon className="w-5 h-5" style={{ color: def.color }} />
        </div>
        <div>
          <h2 className="text-[17px] font-semibold text-white">{def.label}</h2>
          <p className="text-[13px] text-white/50 mt-0.5 leading-relaxed">{def.description}</p>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-5">
        {/* Image upload */}
        {def.imageUpload && (
          <ImageUploadGrid
            files={files}
            onChange={setFiles}
            max={def.imageUpload.max}
            label={def.imageUpload.label}
            hint={def.imageUpload.hint}
          />
        )}

        {/* Fields */}
        {def.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-[12px] font-medium text-white/60 mb-1.5">
              {field.label}
              {field.optional && <span className="text-white/30 ml-1">(optional)</span>}
            </label>
            {field.type === "textarea" ? (
              <textarea
                disabled={inputDisabled}
                value={form[field.key] || ""}
                onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                rows={4}
                className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 resize-none focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
              />
            ) : field.type === "select" ? (
              <div className="relative">
                <select
                  disabled={inputDisabled}
                  value={form[field.key] || field.options?.[0] || ""}
                  onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
                  className="w-full rounded-xl border border-white/[0.08] text-[13px] text-white pl-4 pr-9 py-3 focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40 appearance-none cursor-pointer"
                  style={{ background: "#111", color: "white" }}
                >
                  {field.options?.map((o) => (
                    <option key={o} value={o} style={{ background: "#111" }}>
                      {o}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              </div>
            ) : (
              <input
                disabled={inputDisabled}
                type="text"
                value={form[field.key] || ""}
                onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
              />
            )}
            {field.hint && (
              <p className="text-[11px] text-white/30 mt-1.5 leading-relaxed">{field.hint}</p>
            )}
          </div>
        ))}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={inputDisabled}
          className="w-full py-3.5 rounded-xl text-[13px] font-semibold text-black transition-all disabled:opacity-50"
          style={{ background: GOLD }}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Starting…
            </span>
          ) : isActive ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            "Generate Script"
          )}
        </button>

        {/* Progress */}
        {isActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-white/40">
              <span>{job.stage || "Processing…"}</span>
              <span>{fmtEta(job.etaMs)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${job.progressPct}%`, background: GOLD }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/30">Result</p>
            <button
              onClick={handleGenerate}
              disabled={inputDisabled}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          </div>
          <ScriptResult result={result} def={def} />
        </div>
      )}

      {/* History */}
      {!result && history.length > 0 && (
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wider text-white/30 mb-3">Recent Runs</p>
          <div className="space-y-2">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => h.result && setResult(h.result)}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${h.status === "succeeded" ? "bg-emerald-400" : h.status === "failed" ? "bg-red-400" : "bg-yellow-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-white/70 truncate">{h.label || "Script"}</p>
                </div>
                <span className="text-[11px] text-white/30 flex-shrink-0 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {fmtRelative(h.createdAt)}
                </span>
                {h.result && <ChevronRight className="w-3.5 h-3.5 text-white/20 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FastMotion Result ────────────────────────────────────────────────────────

function FastMotionResult({ result }: { result: any }) {
  const hook: string = result?.onScreen?.hook || "";
  const cta: string = result?.onScreen?.cta || "";
  const placement: string = result?.onScreen?.hookPlacement || "center";
  const music: string = result?.music || "";
  const visuals: any[] = Array.isArray(result?.visuals) ? result.visuals : [];
  const allTextPrompts = visuals.map((v, i) => `${i + 1}. ${v.textPrompt || v.prompt || ""}`).join("\n\n");
  const allJsonPrompts = JSON.stringify(visuals.map((v) => v.jsonPrompt || v.json || {}), null, 2);

  return (
    <div className="space-y-4">
      {/* On-screen text */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">On-Screen Text Overlay</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/25 uppercase tracking-wider">{placement}</span>
            <CopyButton text={hook + (cta ? `\n${cta}` : "")} />
          </div>
        </div>
        <p className="text-[18px] font-bold text-white leading-snug">{hook}</p>
        {cta && <p className="text-[13px] text-white/50 mt-2">{cta}</p>}
        {music && (
          <p className="text-[12px] text-white/35 mt-4 italic border-t border-white/[0.05] pt-3">
            Music vibe: {music}
          </p>
        )}
      </div>

      {/* Visuals */}
      {visuals.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">
              Background Visuals ({visuals.length})
            </span>
            <div className="flex items-center gap-2">
              <CopyButton text={allTextPrompts} />
              <CopyButton text={allJsonPrompts} />
            </div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {visuals.map((v, i) => {
              const textPrompt: string = v.textPrompt || v.prompt || "";
              const jsonPrompt: any = v.jsonPrompt || v.json || null;
              return (
                <div key={i} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] font-bold text-white/25 flex-shrink-0 w-6 mt-0.5">
                      {v.sequenceNumber || i + 1}.
                    </span>
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-[13px] text-white/80 leading-relaxed">{textPrompt}</p>
                      {jsonPrompt && (
                        <div className="relative group">
                          <pre className="text-[10px] text-white/30 bg-white/[0.02] rounded-xl p-3 overflow-x-auto font-mono leading-relaxed border border-white/[0.04]">
                            {JSON.stringify(jsonPrompt, null, 2)}
                          </pre>
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton text={JSON.stringify(jsonPrompt, null, 2)} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FastMotion Panel ─────────────────────────────────────────────────────────

interface FmIdea {
  id: number;
  hookType: string;
  topicCluster: string;
  hook: string;
  visualAngle: string;
}

function FmSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none pl-3.5 pr-9 py-3 rounded-xl border border-white/[0.12] text-[13px] font-medium focus:outline-none focus:border-[#C9A44C]/50 cursor-pointer transition-colors disabled:opacity-40"
        style={{ background: "#111", color: "white" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "#111" }}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
    </div>
  );
}

function FastMotionPanel() {
  const [influencers, setInfluencers] = useState<Array<{ id: number; name: string }>>([]);
  const [prebuiltBrains, setPrebuiltBrains] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({
    influencerId: "",
    offerBrainId: "own",
    hookType: "any",
    aesthetic: "auto",
    ctaMode: "none",
    visualCount: "10",
    context: "",
  });
  const [ideas, setIdeas] = useState<FmIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<FmIdea | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submittingIdeas, setSubmittingIdeas] = useState(false);
  const [submittingClip, setSubmittingClip] = useState(false);

  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    listJobs("fastmotion", 12).then(setHistory).finally(() => setLoadingHistory(false));
  }, []);

  const ideasJob = useScriptJob(
    "fastmotion-ideas",
    (j) => { setIdeas(j.result?.ideas || []); },
    () => { toast({ title: "Ideas generation failed", variant: "destructive" }); },
    { autoResume: false }
  );

  const clipJob = useScriptJob(
    "fastmotion",
    (j) => { setResult(j.result); loadHistory(); },
    () => { toast({ title: "Clip build failed", variant: "destructive" }); },
    { autoResume: true }
  );

  useEffect(() => {
    // Load AI influencers
    getAuthHeaders().then((headers) => {
      fetch("/api/influencers", { headers })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : (Array.isArray(data?.influencers) ? data.influencers : []);
          setInfluencers(list);
        })
        .catch(() => {});
    });
    // Load prebuilt offer brains
    api.getPrebuiltBrains()
      .then(({ brains }) => setPrebuiltBrains(brains.filter((b: any) => b.isActive !== false && !b.comingSoon)))
      .catch(() => {});
    loadHistory();
  }, [loadHistory]);

  const handleGenerateIdeas = async () => {
    setSubmittingIdeas(true);
    setIdeas([]);
    setSelectedIdea(null);
    try {
      const payload: any = { hookType: form.hookType, aesthetic: form.aesthetic };
      if (form.context.trim()) payload.context = form.context.trim();
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      const jobId = await startScriptJobJson("/api/portal/script-writer/fastmotion-ideas", payload);
      ideasJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingIdeas(false);
    }
  };

  const handleBuildClip = async () => {
    setSubmittingClip(true);
    setResult(null);
    try {
      const payload: any = {
        hookType: form.hookType,
        aesthetic: form.aesthetic,
        ctaMode: form.ctaMode,
        visualCount: Number(form.visualCount),
      };
      if (form.context.trim()) payload.context = form.context.trim();
      if (selectedIdea) payload.idea = selectedIdea;
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      const jobId = await startScriptJobJson("/api/portal/script-writer/fastmotion", payload);
      clipJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to build clip", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingClip(false);
    }
  };

  const ideasActive = ideasJob.isActive || submittingIdeas;
  const clipActive = clipJob.isActive || submittingClip;
  const anyActive = ideasActive || clipActive;

  return (
    <div className="space-y-6">
      {/* ── Recent Scripts ── */}
      {(history.length > 0 || loadingHistory) && !result && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileStack className="w-3.5 h-3.5" style={{ color: GOLD }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Recent Scripts</span>
            </div>
            <button
              onClick={loadHistory}
              className="text-[11px] text-white/30 hover:text-white/60 uppercase tracking-wider transition-colors"
            >
              Refresh
            </button>
          </div>
          {loadingHistory ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => h.result && setResult(h.result)}
                  disabled={!h.result}
                  className="text-left px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors disabled:opacity-50 disabled:cursor-default"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-white/80 truncate flex-1">{h.label || "Fast-motion"}</p>
                    <span className={`text-[10px] font-bold flex-shrink-0 ${
                      h.status === "succeeded" ? "text-emerald-400" :
                      h.status === "failed" ? "text-red-400" : "text-yellow-400"
                    }`}>
                      {h.status === "succeeded" ? "SUCCEEDED" : h.status === "failed" ? "FAILED" : "RUNNING"}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/30 mt-0.5">{fmtRelative(h.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AI Influencer + Offer/Brain ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Users className="w-3 h-3" />
            AI Influencer (Optional)
          </label>
          <FmSelect
            value={form.influencerId}
            onChange={(v) => setF("influencerId", v)}
            disabled={anyActive}
            options={[
              { value: "", label: "— Owner's main brand —" },
              ...influencers.map((inf) => ({ value: String(inf.id), label: inf.name })),
            ]}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Cpu className="w-3 h-3" />
            Offer / Brain
          </label>
          <FmSelect
            value={form.offerBrainId}
            onChange={(v) => setF("offerBrainId", v)}
            disabled={anyActive}
            options={[
              { value: "own", label: "— Your brain (default) —" },
              ...prebuiltBrains.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </div>
      </div>

      {/* ── Hook Style + Visual Aesthetic + CTA Mode ── */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Hook Style</label>
          <FmSelect
            value={form.hookType}
            onChange={(v) => setF("hookType", v)}
            disabled={anyActive}
            options={[
              { value: "any", label: "Any (mixed)" },
              { value: "pov", label: "POV" },
              { value: "identity", label: "Identity" },
              { value: "futureBased", label: "Future-based" },
              { value: "emotional", label: "Emotional" },
              { value: "ambition", label: "Ambition" },
            ]}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Visual Aesthetic</label>
          <FmSelect
            value={form.aesthetic}
            onChange={(v) => setF("aesthetic", v)}
            disabled={anyActive}
            options={[
              { value: "auto", label: "Auto (let the brain pick)" },
              { value: "luxury", label: "Luxury" },
              { value: "discipline", label: "Discipline" },
              { value: "freedom", label: "Freedom" },
              { value: "wealth", label: "Wealth" },
              { value: "ambition", label: "Ambition" },
              { value: "creator", label: "Creator" },
              { value: "minimalist", label: "Minimalist" },
              { value: "travel", label: "Travel" },
              { value: "highPerformance", label: "High Performance" },
            ]}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">CTA Mode</label>
          <FmSelect
            value={form.ctaMode}
            onChange={(v) => setF("ctaMode", v)}
            disabled={anyActive}
            options={[
              { value: "none", label: "None (hook does the work)" },
              { value: "soft", label: "Soft identity close" },
              { value: "keyword", label: "Comment keyword" },
              { value: "follow", label: "Follow" },
            ]}
          />
        </div>
      </div>

      {/* ── Visual Count ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2.5">
          How Many Background Visuals?
        </label>
        <div className="flex items-center gap-2">
          {(["5", "7", "10", "12", "15"] as const).map((n) => (
            <button
              key={n}
              onClick={() => !anyActive && setF("visualCount", n)}
              disabled={anyActive}
              className={`w-10 h-10 rounded-xl text-[13px] font-bold transition-all disabled:opacity-40 ${
                form.visualCount === n
                  ? "text-black"
                  : "bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white"
              }`}
              style={form.visualCount === n ? { background: GOLD } : undefined}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* ── Context ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
          What's the clip about?{" "}
          <span className="normal-case text-white/25 font-normal tracking-normal">(optional — feeds both ideas + the clip)</span>
        </label>
        <textarea
          disabled={anyActive}
          value={form.context}
          onChange={(e) => setF("context", e.target.value)}
          rows={3}
          placeholder="e.g. The version of me that built this from nothing. OR the moment everything changed after years of quiet work. OR leave blank and let the brain generate ideas."
          className="w-full rounded-xl border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 resize-none focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
          style={{ background: "#111" }}
        />
      </div>

      {/* ── Step 1 bar ── */}
      <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: GOLD }}>
            Step 1 — Pick a Fast-Motion Concept
          </p>
          <p className="text-[12px] text-white/40 mt-0.5">
            Generate 10 emotional / identity hooks. Click one to load it into the writer below.
          </p>
        </div>
        <button
          onClick={handleGenerateIdeas}
          disabled={anyActive}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-semibold text-black transition-all disabled:opacity-50 flex-shrink-0"
          style={{ background: GOLD }}
        >
          {ideasActive ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Generate 10 Ideas</>
          )}
        </button>
      </div>

      {/* Ideas progress */}
      {ideasActive && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-white/40">
            <span>{ideasJob.stage || "Brainstorming concepts…"}</span>
            <span>{fmtEta(ideasJob.etaMs)}</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ideasJob.progressPct}%`, background: GOLD }} />
          </div>
        </div>
      )}

      {/* Ideas list */}
      {ideas.length > 0 && (
        <div className="space-y-2">
          {ideas.map((idea) => (
            <button
              key={idea.id}
              onClick={() => !anyActive && setSelectedIdea(selectedIdea?.id === idea.id ? null : idea)}
              disabled={anyActive}
              className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                selectedIdea?.id === idea.id
                  ? "border-[#C9A44C]/50 bg-[#C9A44C]/[0.07]"
                  : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-bold text-white/25 mt-0.5 flex-shrink-0 w-5">{idea.id}.</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-white leading-snug">{idea.hook}</p>
                  {idea.visualAngle && (
                    <p className="text-[12px] text-white/40 mt-1 leading-relaxed">{idea.visualAngle}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: `${GOLD}bb` }}>{idea.hookType}</span>
                    {idea.topicCluster && (
                      <span className="text-[10px] text-white/25">· {idea.topicCluster}</span>
                    )}
                  </div>
                </div>
                {selectedIdea?.id === idea.id && (
                  <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: GOLD }} />
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Build Clip button ── */}
      <button
        onClick={handleBuildClip}
        disabled={anyActive}
        className="w-full py-4 rounded-2xl text-[13px] font-semibold transition-all disabled:opacity-50 border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.07] text-white"
        style={clipActive ? {} : { borderColor: `${GOLD}40` }}
      >
        {clipActive ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Building clip{clipJob.stage ? ` — ${clipJob.stage}` : "…"}
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: GOLD }} />
            {`Build the Clip From My Context (${form.visualCount} Visuals)`}
          </span>
        )}
      </button>

      {/* Clip progress */}
      {clipActive && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-white/40">
            <span>{clipJob.stage || "Generating visuals…"}</span>
            <span>{fmtEta(clipJob.etaMs)}</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clipJob.progressPct}%`, background: GOLD }} />
          </div>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/30">Generated Clip</p>
            <button
              onClick={handleBuildClip}
              disabled={anyActive}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
          </div>
          <FastMotionResult result={result} />
        </div>
      )}
    </div>
  );
}

// ─── Recent Scripts Drawer ────────────────────────────────────────────────────

function RecentScriptsDrawer({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (job: ScriptJobRow, def: ScriptTypeDef) => void;
}) {
  const [jobs, setJobs] = useState<ScriptJobRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Load recent jobs across all types (use first type as a proxy for the list endpoint)
    Promise.all(SCRIPT_TYPES.map((t) => listJobs(t.jobType, 3)))
      .then((results) => {
        const all = results.flat().sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setJobs(all.slice(0, 20));
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-end bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:w-[400px] sm:h-full sm:max-h-screen bg-[#0f0f0f] border border-white/[0.08] shadow-2xl rounded-t-2xl sm:rounded-none flex flex-col max-h-[85dvh] sm:max-h-full overflow-hidden">
        {/* Handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileStack className="w-4 h-4 text-[#C9A44C]" />
            <h3 className="text-[14px] font-semibold text-white">Recent Scripts</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/70 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
            </div>
          )}
          {!loading && jobs.length === 0 && (
            <p className="text-[13px] text-white/30 text-center py-8">No scripts yet</p>
          )}
          {!loading && jobs.map((j) => {
            const def = SCRIPT_TYPES.find((t) => t.jobType === j.type);
            if (!def) return null;
            return (
              <button
                key={j.id}
                onClick={() => { if (j.result) { onSelect(j, def); onClose(); } }}
                disabled={!j.result}
                className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors disabled:opacity-50 disabled:cursor-default"
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: `${def.color}20` }}
                >
                  <def.icon className="w-3.5 h-3.5" style={{ color: def.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white/80 truncate">{def.label}</p>
                  <p className="text-[11px] text-white/35 mt-0.5">{fmtRelative(j.createdAt)}</p>
                </div>
                <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  j.status === "succeeded" ? "bg-emerald-400" :
                  j.status === "failed" ? "bg-red-400" : "bg-yellow-400"
                }`} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScriptWriterPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const typeParam = params.get("type") || "green-screen";
  const [, setLocation] = useLocation();
  const [showRecent, setShowRecent] = useState(false);
  const [externalResult, setExternalResult] = useState<{ result: any; def: ScriptTypeDef } | null>(null);

  const activeDef = SCRIPT_TYPES.find((t) => t.slug === typeParam) || SCRIPT_TYPES[0];

  const handleTypeChange = (slug: string) => {
    setExternalResult(null);
    setLocation(`/script-writer?type=${slug}`);
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>

        {/* ── Back link ── */}
        <button
          onClick={() => setLocation("/operating-system")}
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-5"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>

        {/* ── Page header ── */}
        <div className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: GOLD }}>
            Script Writer OS
          </p>
          <h1 className="text-[28px] sm:text-[34px] font-black text-white leading-none tracking-tight uppercase mb-3">
            Write a Script
          </h1>
          <p className="text-[13px] text-white/45 leading-relaxed max-w-lg">
            Pick a content type, drop in your assets, and we write a script straight from your brain plus the offer you picked — using only proven hook formulas, never invented ones.
          </p>
        </div>

        {/* ── Type selector row ── */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 relative">
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
              Content Type
            </label>
            <div className="relative">
              <select
                value={activeDef.slug}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full appearance-none pl-4 pr-10 py-3 rounded-xl bg-[#111] border border-white/[0.12] text-white text-[14px] font-medium focus:outline-none focus:border-[#C9A44C]/50 cursor-pointer transition-colors"
                style={{ background: "#111" }}
              >
                {SCRIPT_TYPES.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            </div>
          </div>

          {/* Recent Scripts button — aligned to bottom of the select */}
          <div className="flex-shrink-0 flex flex-col justify-end">
            {/* spacer to match label + margin height */}
            <div className="h-[22px]" />
            <button
              onClick={() => setShowRecent(true)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/[0.12] bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white/90 text-[13px] font-medium transition-colors whitespace-nowrap"
            >
              <FileStack className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Recent Scripts</span>
              <span className="sm:hidden">Recent</span>
            </button>
          </div>
        </div>

        {/* ── Script Panel ── */}
        {activeDef.slug === "fastmotion" ? (
          <FastMotionPanel key="fastmotion" />
        ) : (
          /* key forces re-mount on type change so each type gets its own isolated state */
          <ScriptPanel
            key={activeDef.slug}
            def={activeDef}
            externalResult={externalResult?.def.slug === activeDef.slug ? externalResult.result : null}
          />
        )}

        {/* ── Recent Scripts Drawer ── */}
        <RecentScriptsDrawer
          open={showRecent}
          onClose={() => setShowRecent(false)}
          onSelect={(job, def) => {
            handleTypeChange(def.slug);
            setExternalResult({ result: job.result, def });
          }}
        />
      </div>
    </PortalLayout>
  );
}
