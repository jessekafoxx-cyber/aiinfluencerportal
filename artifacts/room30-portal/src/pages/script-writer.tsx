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
    label: "Podcast Clips",
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
    label: "Speaking Clips",
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
    label: "Selfie Yapping Clips",
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
    label: "Viral Slideshows",
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
    label: "Viral Carousels",
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
    label: "Overlay Clips",
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
    label: "Fast Motion Clips",
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
    influencerId: "",
    offerBrainId: "own",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<any>(externalResult ?? null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [influencers, setInfluencers] = useState<Array<{ id: number; name: string }>>([]);
  const [prebuiltBrains, setPrebuiltBrains] = useState<Array<{ id: string; name: string }>>([]);

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
      const influencerId = form.influencerId ? Number(form.influencerId) : null;
      const offerBrainId = form.offerBrainId && form.offerBrainId !== "own" ? form.offerBrainId : null;
      if (def.imageUpload) {
        const fd = new FormData();
        for (const f of files) fd.append("images", f);
        fd.append("context", context);
        if (form.commentWord) fd.append("commentWord", form.commentWord.trim().toUpperCase());
        if (form.version) fd.append("version", form.version);
        if (influencerId) fd.append("influencerId", String(influencerId));
        if (offerBrainId) fd.append("offerBrainId", offerBrainId);
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
        if (influencerId) payload.influencerId = influencerId;
        if (offerBrainId) payload.offerBrainId = offerBrainId;
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

        {/* AI Influencer + Offer/Brain */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
              <Users className="w-3 h-3" />
              AI Influencer (Optional)
            </label>
            <div className="relative">
              <select
                disabled={inputDisabled}
                value={form.influencerId || ""}
                onChange={(e) => setForm((p) => ({ ...p, influencerId: e.target.value }))}
                className="w-full appearance-none pl-3.5 pr-9 py-2.5 rounded-xl border border-white/[0.12] text-[12px] font-medium focus:outline-none focus:border-[#C9A44C]/50 cursor-pointer transition-colors disabled:opacity-40"
              >
                <option value="">— Owner's main brand —</option>
                {influencers.map((inf) => (
                  <option key={inf.id} value={String(inf.id)}>{inf.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
              <Cpu className="w-3 h-3" />
              Offer / Brain
            </label>
            <div className="relative">
              <select
                disabled={inputDisabled}
                value={form.offerBrainId || "own"}
                onChange={(e) => setForm((p) => ({ ...p, offerBrainId: e.target.value }))}
                className="w-full appearance-none pl-3.5 pr-9 py-2.5 rounded-xl border border-white/[0.12] text-[12px] font-medium focus:outline-none focus:border-[#C9A44C]/50 cursor-pointer transition-colors disabled:opacity-40"
              >
                <option value="own">— Your brain (default) —</option>
                {prebuiltBrains.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            </div>
          </div>
        </div>

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
                >
                  {field.options?.map((o) => (
                    <option key={o} value={o}>
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

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

// ─── GreenScreen Ideas types ──────────────────────────────────────────────────

interface GsIdea {
  id: number;
  hookType: string;
  title: string;
  angle: string;
  googleSearches: string[];
  notesPrompts: string[];
}

// ─── GreenScreen Panel ────────────────────────────────────────────────────────

function GreenScreenPanel() {
  const [influencers, setInfluencers] = useState<Array<{ id: number; name: string }>>([]);
  const [prebuiltBrains, setPrebuiltBrains] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ influencerId: "", offerBrainId: "own", context: "", commentWord: "" });
  // 10 image slots (null = empty)
  const [slots, setSlots] = useState<(File | null)[]>(Array(10).fill(null));
  const [ideas, setIdeas] = useState<GsIdea[]>([]);
  const [expandedIdea, setExpandedIdea] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submittingIdeas, setSubmittingIdeas] = useState(false);
  const [submittingScript, setSubmittingScript] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<number>(-1);
  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    listJobs("green-screen", 10).then(setHistory).finally(() => setLoadingHistory(false));
  }, []);

  const ideasJob = useScriptJob(
    "green-screen-ideas",
    (j) => { setIdeas(j.result?.ideas || []); },
    () => { toast({ title: "Ideas generation failed", variant: "destructive" }); },
    { autoResume: false }
  );

  const scriptJob = useScriptJob(
    "green-screen",
    (j) => { setResult(j.result); loadHistory(); },
    () => { toast({ title: "Script generation failed", description: "Something went wrong. Try again.", variant: "destructive" }); },
    { autoResume: true }
  );

  useEffect(() => {
    loadHistory();
    getAuthHeaders().then((headers) => {
      fetch("/api/influencers", { headers })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : (Array.isArray(data?.influencers) ? data.influencers : []);
          setInfluencers(list);
        })
        .catch(() => {});
    });
    api.getPrebuiltBrains()
      .then(({ brains }) => setPrebuiltBrains(brains.filter((b: any) => b.isActive !== false && !b.comingSoon)))
      .catch(() => {});
  }, [loadHistory]);

  const handleGenerateIdeas = async () => {
    setSubmittingIdeas(true);
    setIdeas([]);
    setExpandedIdea(null);
    try {
      const payload: any = {};
      if (form.context.trim()) payload.context = form.context.trim();
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      const jobId = await startScriptJobJson("/api/portal/script-writer/green-screen-ideas", payload);
      ideasJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingIdeas(false);
    }
  };

  const handleGenerateScript = async () => {
    const filled = slots.filter(Boolean) as File[];
    if (filled.length === 0) {
      toast({ title: "Upload at least one image", variant: "destructive" });
      return;
    }
    const cta = form.commentWord.trim().toUpperCase().replace(/[^\w\-]/g, "").slice(0, 24);
    if (!cta) {
      toast({ title: "Enter a CTA comment word", variant: "destructive" });
      return;
    }
    setSubmittingScript(true);
    setResult(null);
    try {
      const fd = new FormData();
      for (const f of filled) fd.append("images", f);
      if (form.context.trim()) fd.append("context", form.context.trim());
      fd.append("commentWord", cta);
      if (form.offerBrainId && form.offerBrainId !== "own") fd.append("offerBrainId", form.offerBrainId);
      if (form.influencerId) fd.append("influencerId", form.influencerId);
      const jobId = await startScriptJobFormData("/api/portal/script-writer/green-screen", fd);
      scriptJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start script", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingScript(false);
    }
  };

  const handleSlotClick = (idx: number) => {
    if (scriptJob.isActive || submittingScript) return;
    uploadSlotRef.current = idx;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const idx = uploadSlotRef.current;
    if (idx < 0 || idx >= 10) return;
    setSlots((prev) => { const next = [...prev]; next[idx] = file; return next; });
    e.target.value = "";
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => { const next = [...prev]; next[idx] = null; return next; });
  };

  const ideasActive = ideasJob.isActive || submittingIdeas;
  const scriptActive = scriptJob.isActive || submittingScript;
  const anyActive = ideasActive || scriptActive;
  const filledCount = slots.filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />

      {/* ── Active job banner ── */}
      {scriptActive && (
        <div className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GOLD }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">
                Working — You can leave this tab and come back
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[13px] font-bold" style={{ color: GOLD }}>{scriptJob.progressPct}%</span>
              <button
                onClick={() => { scriptJob.cancel(); setSubmittingScript(false); }}
                className="text-[11px] font-bold uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${scriptJob.progressPct}%`, background: GOLD }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-white/30">
            <span>{scriptJob.stage || "Processing…"}</span>
            <span>Elapsed {fmtElapsed(scriptJob.elapsedMs)}</span>
          </div>
        </div>
      )}

      {/* ── Recent Scripts ── */}
      {(history.length > 0 || loadingHistory) && !result && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileStack className="w-3.5 h-3.5" style={{ color: GOLD }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Recent Scripts</span>
            </div>
            <button onClick={loadHistory} className="text-[11px] text-white/30 hover:text-white/60 uppercase tracking-wider transition-colors">Refresh</button>
          </div>
          {loadingHistory ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 text-white/30 animate-spin" /></div>
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
                    <p className="text-[12px] text-white/80 truncate flex-1">{h.label || "Green screen script"}</p>
                    <span className={`text-[10px] font-bold flex-shrink-0 ${h.status === "succeeded" ? "text-emerald-400" : h.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
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
            <Users className="w-3 h-3" /> AI Influencer (Optional)
          </label>
          <FmSelect value={form.influencerId} onChange={(v) => setF("influencerId", v)} disabled={anyActive}
            options={[{ value: "", label: "— Owner's main brand —" }, ...influencers.map((inf) => ({ value: String(inf.id), label: inf.name }))]}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Cpu className="w-3 h-3" /> Offer / Brain
          </label>
          <FmSelect value={form.offerBrainId} onChange={(v) => setF("offerBrainId", v)} disabled={anyActive}
            options={[{ value: "own", label: "— Your brain (default) —" }, ...prebuiltBrains.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </div>
      </div>

      {/* ── Step 1: Ideas ── */}
      <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: GOLD }}>Step 1 — Need an Idea?</p>
          <p className="text-[12px] text-white/40 mt-0.5">
            Generate 8 green-screen concepts pulled from your brain + offer. Each one gives you Google searches to find the article screenshots, plus Apple-Notes blocks you can screenshot for the Notes-style overlay.
          </p>
        </div>
        <button
          onClick={handleGenerateIdeas}
          disabled={anyActive}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-semibold text-black transition-all disabled:opacity-50 flex-shrink-0"
          style={{ background: GOLD }}
        >
          {ideasActive ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate 8 Ideas</>}
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
          {ideas.map((idea) => {
            const isOpen = expandedIdea === idea.id;
            return (
              <div
                key={idea.id}
                className={`rounded-xl border transition-all ${isOpen ? "border-[#C9A44C]/40 bg-[#C9A44C]/[0.05]" : "border-white/[0.07] bg-white/[0.02]"}`}
              >
                <button
                  onClick={() => setExpandedIdea(isOpen ? null : idea.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3"
                >
                  <span className="text-[11px] font-bold text-white/25 mt-0.5 flex-shrink-0 w-5">{idea.id}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: `${GOLD}cc` }}>{idea.hookType}</span>
                    </div>
                    <p className="text-[14px] font-semibold text-white leading-snug">{idea.title}</p>
                    <p className="text-[12px] text-white/40 mt-1">{idea.angle}</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-white/30 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/[0.05] pt-3 ml-8">
                    {idea.googleSearches?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">Google Searches to Find Screenshots</p>
                        <div className="space-y-1">
                          {idea.googleSearches.map((q, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="text-[11px] text-white/25 flex-shrink-0">{i + 1}.</span>
                              <p className="text-[12px] text-white/60 font-mono leading-relaxed">{q}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {idea.notesPrompts?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">Apple Notes Templates (Screenshot These)</p>
                        <div className="space-y-2">
                          {idea.notesPrompts.map((np, i) => (
                            <div key={i} className="relative group">
                              <pre className="text-[12px] text-white/70 bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed">{np}</pre>
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <CopyButton text={np} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setF("context", `${idea.title} — ${idea.angle}`);
                        setExpandedIdea(null);
                      }}
                      className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
                      style={{ color: GOLD }}
                    >
                      <Check className="w-3.5 h-3.5" /> Use this angle as my context
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Image Grid ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-3">
          Green-Screen Images (up to 10, in the order you'll show them)
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, idx) => {
            const file = slots[idx];
            const imgUrl = file ? URL.createObjectURL(file) : null;
            return (
              <div
                key={idx}
                onClick={() => !file && handleSlotClick(idx)}
                className={`relative aspect-square rounded-xl border transition-all ${
                  file
                    ? "border-white/[0.15] cursor-default overflow-hidden"
                    : scriptActive
                    ? "border-white/[0.05] bg-white/[0.01] cursor-not-allowed"
                    : "border-dashed border-white/[0.15] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.25] cursor-pointer"
                }`}
              >
                {/* Slot number */}
                <span className="absolute top-1.5 left-2 text-[10px] font-bold text-white/25 z-10">{idx + 1}</span>

                {file && imgUrl ? (
                  <>
                    <img src={imgUrl} alt={`Slot ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSlotClick(idx); }}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                        title="Replace"
                      >
                        <Upload className="w-3 h-3 text-white" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSlot(idx); }}
                        className="p-1.5 rounded-lg bg-red-500/60 hover:bg-red-500/80 transition-colors"
                        title="Remove"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  </>
                ) : idx === filledCount && !scriptActive ? (
                  /* First empty slot — show ADD prompt */
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
                    <Upload className="w-4 h-4 text-white/30" />
                    <span className="text-[9px] text-white/30 font-medium uppercase tracking-wider">Add</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
          Image 1 is shown first while you talk, image 2 second, and so on. Click a filled slot to replace it.
        </p>
      </div>

      {/* ── Context ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Why Are You Talking About These?</label>
        <textarea
          disabled={scriptActive}
          value={form.context}
          onChange={(e) => setF("context", e.target.value)}
          rows={3}
          placeholder="e.g. I'm reacting to this article on AI agencies because most beginners read it and miss the real opportunity."
          className="w-full rounded-xl border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 resize-none focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
          style={{ background: "#111" }}
        />
      </div>

      {/* ── CTA Comment Word ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">CTA Comment Word</label>
        <input
          type="text"
          disabled={scriptActive}
          value={form.commentWord}
          onChange={(e) => setF("commentWord", e.target.value.toUpperCase().replace(/[^\w\-]/g, "").slice(0, 24))}
          placeholder="GO"
          className="w-56 rounded-xl border border-white/[0.08] text-[14px] font-bold text-white placeholder-white/20 px-4 py-3 focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40 tracking-widest"
          style={{ background: "#111" }}
        />
        <p className="text-[11px] text-white/30 mt-1.5">
          One word — "GO", "START", "SYSTEM", "X". This becomes "Comment GO below" in the CTA.
        </p>
      </div>

      {/* ── Generate Script button ── */}
      <button
        onClick={handleGenerateScript}
        disabled={anyActive || filledCount === 0}
        className="w-full py-4 rounded-2xl text-[13px] font-semibold text-black transition-all disabled:opacity-50"
        style={{ background: GOLD }}
      >
        {scriptActive ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Writing Your Script…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" />
            {filledCount > 0 ? `Generate Script (${filledCount} image${filledCount !== 1 ? "s" : ""})` : "Upload Images to Generate"}
          </span>
        )}
      </button>

      {/* ── Result ── */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/30">Generated Script</p>
            <button onClick={handleGenerateScript} disabled={anyActive || filledCount === 0}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-40">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
          </div>
          <ScriptResult result={result} def={{ slug: "green-screen", jobType: "green-screen", label: "Green Screen", description: "", icon: Monitor, color: "#10b981", fields: [], endpoint: "" }} />
        </div>
      )}
    </div>
  );
}

// ─── Hook + Demo Panel ───────────────────────────────────────────────────────

interface HdIdea {
  id: number;
  hookType: string;
  title: string;
  angle: string;
  demoSteps: string[];
  toolsUsed: string[];
  payoff: string;
}

function HookDemoPanel() {
  const [influencers, setInfluencers] = useState<Array<{ id: number; name: string }>>([]);
  const [prebuiltBrains, setPrebuiltBrains] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ influencerId: "", offerBrainId: "own", context: "", commentWord: "", version: "voiceover" });
  const [slots, setSlots] = useState<(File | null)[]>(Array(6).fill(null));
  const [ideas, setIdeas] = useState<HdIdea[]>([]);
  const [expandedIdea, setExpandedIdea] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submittingIdeas, setSubmittingIdeas] = useState(false);
  const [submittingScript, setSubmittingScript] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<number>(-1);
  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    listJobs("hook-demo", 10).then(setHistory).finally(() => setLoadingHistory(false));
  }, []);

  const ideasJob = useScriptJob(
    "hook-demo-ideas",
    (j) => { setIdeas((j.result?.ideas || []).map((idea: any, i: number) => ({ ...idea, id: i + 1 }))); },
    () => { toast({ title: "Ideas generation failed", variant: "destructive" }); },
    { autoResume: false }
  );

  const scriptJob = useScriptJob(
    "hook-demo",
    (j) => { setResult(j.result); loadHistory(); },
    () => { toast({ title: "Script generation failed", description: "Something went wrong. Try again.", variant: "destructive" }); },
    { autoResume: true }
  );

  useEffect(() => {
    loadHistory();
    getAuthHeaders().then((headers) => {
      fetch("/api/influencers", { headers })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : (Array.isArray(data?.influencers) ? data.influencers : []);
          setInfluencers(list);
        })
        .catch(() => {});
    });
    api.getPrebuiltBrains()
      .then(({ brains }) => setPrebuiltBrains(brains.filter((b: any) => b.isActive !== false && !b.comingSoon)))
      .catch(() => {});
  }, [loadHistory]);

  const handleGenerateIdeas = async () => {
    setSubmittingIdeas(true);
    setIdeas([]);
    setExpandedIdea(null);
    try {
      const payload: any = {};
      if (form.context.trim()) payload.context = form.context.trim();
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      const jobId = await startScriptJobJson("/api/portal/script-writer/hook-demo-ideas", payload);
      ideasJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingIdeas(false);
    }
  };

  const handleGenerateScript = async () => {
    const filled = slots.filter(Boolean) as File[];
    if (filled.length === 0) {
      toast({ title: "Upload at least one screenshot", variant: "destructive" });
      return;
    }
    const cta = form.commentWord.trim().toUpperCase().replace(/[^\w\-]/g, "").slice(0, 24);
    if (!cta) {
      toast({ title: "Enter a CTA comment word", variant: "destructive" });
      return;
    }
    setSubmittingScript(true);
    setResult(null);
    try {
      const fd = new FormData();
      for (const f of filled) fd.append("images", f);
      if (form.context.trim()) fd.append("context", form.context.trim());
      fd.append("commentWord", cta);
      fd.append("version", form.version);
      if (form.offerBrainId && form.offerBrainId !== "own") fd.append("offerBrainId", form.offerBrainId);
      if (form.influencerId) fd.append("influencerId", form.influencerId);
      const jobId = await startScriptJobFormData("/api/portal/script-writer/hook-demo", fd);
      scriptJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start script", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingScript(false);
    }
  };

  const handleSlotClick = (idx: number) => {
    if (scriptJob.isActive || submittingScript) return;
    uploadSlotRef.current = idx;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const idx = uploadSlotRef.current;
    if (idx < 0 || idx >= 6) return;
    setSlots((prev) => { const next = [...prev]; next[idx] = file; return next; });
    e.target.value = "";
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => { const next = [...prev]; next[idx] = null; return next; });
  };

  const ideasActive = ideasJob.isActive || submittingIdeas;
  const scriptActive = scriptJob.isActive || submittingScript;
  const anyActive = ideasActive || scriptActive;
  const filledCount = slots.filter(Boolean).length;

  return (
    <div className="space-y-5">
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />

      {/* ── Active job banner ── */}
      {scriptActive && (
        <div className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GOLD }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">
                Working — You can leave this tab and come back
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[13px] font-bold" style={{ color: GOLD }}>{scriptJob.progressPct}%</span>
              <button
                onClick={() => { scriptJob.cancel(); setSubmittingScript(false); }}
                className="text-[11px] font-bold uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors"
              >Reset</button>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${scriptJob.progressPct}%`, background: GOLD }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-white/30">
            <span>{scriptJob.stage || "Processing…"}</span>
            <span>Elapsed {fmtElapsed(scriptJob.elapsedMs)}</span>
          </div>
        </div>
      )}

      {/* ── Recent Scripts ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileStack className="w-3.5 h-3.5" style={{ color: GOLD }} />
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Recent Scripts</span>
          </div>
          <button onClick={loadHistory} className="text-[11px] text-white/30 hover:text-white/60 uppercase tracking-wider transition-colors">Refresh</button>
        </div>
        {loadingHistory ? (
          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 text-white/30 animate-spin" /></div>
        ) : history.length === 0 ? (
          <p className="text-[12px] text-white/25 py-1">No scripts yet for this SOP.</p>
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
                  <p className="text-[12px] text-white/80 truncate flex-1">{h.label || "Hook + Demo script"}</p>
                  <span className={`text-[10px] font-bold flex-shrink-0 ${h.status === "succeeded" ? "text-emerald-400" : h.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
                    {h.status === "succeeded" ? "SUCCEEDED" : h.status === "failed" ? "FAILED" : "RUNNING"}
                  </span>
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">{fmtRelative(h.createdAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── AI Influencer + Offer/Brain ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Users className="w-3 h-3" /> AI Influencer (Optional)
          </label>
          <FmSelect value={form.influencerId} onChange={(v) => setF("influencerId", v)} disabled={anyActive}
            options={[{ value: "", label: "— Owner's main brand —" }, ...influencers.map((inf) => ({ value: String(inf.id), label: inf.name }))]}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Cpu className="w-3 h-3" /> Offer / Brain
          </label>
          <FmSelect value={form.offerBrainId} onChange={(v) => setF("offerBrainId", v)} disabled={anyActive}
            options={[{ value: "own", label: "— Your brain (default) —" }, ...prebuiltBrains.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </div>
      </div>

      {/* ── Step 1: Ideas ── */}
      <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: GOLD }}>Step 1 — Need an Idea?</p>
          <p className="text-[12px] text-white/40 mt-0.5">
            Generate 8 demo concepts pulled from your brain + offer. Each one tells you which tools to screen-record and the exact steps to capture.
          </p>
        </div>
        <button
          onClick={handleGenerateIdeas}
          disabled={anyActive}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-semibold text-black transition-all disabled:opacity-50 flex-shrink-0"
          style={{ background: GOLD }}
        >
          {ideasActive ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate 8 Ideas</>}
        </button>
      </div>

      {/* Ideas progress */}
      {ideasActive && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-white/40">
            <span>{ideasJob.stage || "Brainstorming demo concepts…"}</span>
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
          {ideas.map((idea) => {
            const isOpen = expandedIdea === idea.id;
            return (
              <div key={idea.id} className={`rounded-xl border transition-all ${isOpen ? "border-[#C9A44C]/40 bg-[#C9A44C]/[0.05]" : "border-white/[0.07] bg-white/[0.02]"}`}>
                <button onClick={() => setExpandedIdea(isOpen ? null : idea.id)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                  <span className="text-[11px] font-bold text-white/25 mt-0.5 flex-shrink-0 w-5">{idea.id}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: `${GOLD}cc` }}>{idea.hookType}</span>
                    </div>
                    <p className="text-[14px] font-semibold text-white leading-snug">{idea.title}</p>
                    <p className="text-[12px] text-white/40 mt-1">{idea.angle}</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-white/30 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/[0.05] pt-3 ml-8">
                    {idea.toolsUsed?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1.5">Tools to Screen-Record</p>
                        <div className="flex flex-wrap gap-1.5">
                          {idea.toolsUsed.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-white/[0.1] bg-white/[0.04] text-white/60">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {idea.demoSteps?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1.5">Steps to Capture</p>
                        <div className="space-y-1">
                          {idea.demoSteps.map((step, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="text-[11px] font-bold text-white/25 flex-shrink-0 mt-0.5">{i + 1}.</span>
                              <p className="text-[12px] text-white/60 leading-relaxed">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {idea.payoff && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-1">Final Payoff Shot</p>
                        <p className="text-[12px] text-white/50 italic">{idea.payoff}</p>
                      </div>
                    )}
                    <button
                      onClick={() => { setF("context", `${idea.title} — ${idea.angle}`); setExpandedIdea(null); }}
                      className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
                      style={{ color: GOLD }}
                    >
                      <Check className="w-3.5 h-3.5" /> Use this concept as my context
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Screenshot Grid (6 slots: 5 + 1) ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-3">
          Step Screenshots (up to 6, image 1 = step 1's screen)
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Array.from({ length: 6 }, (_, idx) => {
            const file = slots[idx];
            const imgUrl = file ? URL.createObjectURL(file) : null;
            const isNextEmpty = idx === filledCount;
            return (
              <div
                key={idx}
                onClick={() => !file && handleSlotClick(idx)}
                className={`relative aspect-square rounded-xl border transition-all ${
                  file
                    ? "border-white/[0.15] cursor-default overflow-hidden"
                    : scriptActive
                    ? "border-white/[0.05] bg-white/[0.01] cursor-not-allowed"
                    : "border-dashed border-white/[0.15] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.25] cursor-pointer"
                }`}
              >
                <span className="absolute top-1.5 left-2 text-[10px] font-bold text-white/25 z-10">{idx + 1}</span>
                {file && imgUrl ? (
                  <>
                    <img src={imgUrl} alt={`Step ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); handleSlotClick(idx); }}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors" title="Replace">
                        <Upload className="w-3 h-3 text-white" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); removeSlot(idx); }}
                        className="p-1.5 rounded-lg bg-red-500/60 hover:bg-red-500/80 transition-colors" title="Remove">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  </>
                ) : isNextEmpty && !scriptActive ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
                    <Upload className="w-4 h-4 text-white/30" />
                    <span className="text-[9px] text-white/30 font-medium uppercase tracking-wider">Add</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
          Drop one screenshot per step in the exact order the viewer will see them on screen. Click a filled slot to replace it.
        </p>
      </div>

      {/* ── Version pill toggle ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Version</label>
        <div className="flex gap-2">
          {(["voiceover", "silent", "both"] as const).map((v) => (
            <button
              key={v}
              disabled={anyActive}
              onClick={() => setF("version", v)}
              className={`px-5 py-2 rounded-xl text-[12px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 ${
                form.version === v ? "text-black" : "text-white/40 border border-white/[0.1] bg-white/[0.02] hover:text-white/70"
              }`}
              style={form.version === v ? { background: GOLD } : {}}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-white/30 mt-1.5">
          Voiceover = you talking over the demo; Silent = no audio, big on-screen captions only. Both = we write you both versions.
        </p>
      </div>

      {/* ── Context ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">What Does This Demo Actually Show?</label>
        <textarea
          disabled={scriptActive}
          value={form.context}
          onChange={(e) => setF("context", e.target.value)}
          rows={3}
          placeholder="e.g. Step 1 is Higgsfield where you build the avatar, step 2 is ChatGPT for the script prompt, step 3 is HeyGen to generate the video, step 4 shows our AI Influencer Portfolio sales page where the $10k commission comes from."
          className="w-full rounded-xl border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 resize-none focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
          style={{ background: "#111" }}
        />
      </div>

      {/* ── CTA Comment Word ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">CTA Comment Word</label>
        <input
          type="text"
          disabled={scriptActive}
          value={form.commentWord}
          onChange={(e) => setF("commentWord", e.target.value.toUpperCase().replace(/[^\w\-]/g, "").slice(0, 24))}
          placeholder="GO"
          className="w-56 rounded-xl border border-white/[0.08] text-[14px] font-bold text-white placeholder-white/20 px-4 py-3 focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40 tracking-widest"
          style={{ background: "#111" }}
        />
        <p className="text-[11px] text-white/30 mt-1.5">
          One word — "GO", "START", "SYSTEM", "X". This becomes "Comment GO below" in the CTA.
        </p>
      </div>

      {/* ── Generate Script button ── */}
      <button
        onClick={handleGenerateScript}
        disabled={anyActive || filledCount === 0}
        className="w-full py-4 rounded-2xl text-[13px] font-semibold text-black transition-all disabled:opacity-50"
        style={{ background: GOLD }}
      >
        {scriptActive ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Writing Hook + Demo Script…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" /> Generate Hook + Demo Script
          </span>
        )}
      </button>

      {/* ── Result ── */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/30">Generated Script</p>
            <button onClick={handleGenerateScript} disabled={anyActive || filledCount === 0}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-40">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
          </div>
          <ScriptResult result={result} def={{ slug: "hook-demo", jobType: "hook-demo", label: "Hook + Demo", description: "", icon: Video, color: "#10b981", fields: [], endpoint: "" }} />
        </div>
      )}
    </div>
  );
}

// ─── TextScriptPanel (podcast, speaking, selfie, slideshow, carousel, overlay) ─

const HOOK_LABELS: Record<string, string> = {
  any: "Any (mixed)", contrarian: "Contrarian", truthBomb: "Truth bomb",
  polarising: "Polarising", iRealised: "I realised...", strongStatement: "Strong statement",
  audienceChallenge: "Audience challenge", futureBased: "Future-based",
  emotionalTruth: "Emotional truth", curiosityBased: "Curiosity-based",
  howI: "How I...", socialProof: "Social proof", emotionalCuriosity: "Emotional curiosity",
  xThings: "X things list",
};
const FORMULA_LABELS: Record<string, string> = {
  any: "Any (mixed)", realisation: "Realisation", contrarianOpinion: "Contrarian opinion", storyBased: "Story-based",
};
const VISUAL_STYLE_LABELS: Record<string, string> = {
  cinematic: "Cinematic", minimal: "Minimal", moody: "Moody", luxury: "Luxury", documentary: "Documentary", retro: "Retro",
};
const BROLL_LABELS: Record<string, string> = {
  auto: "Auto (let the brain pick)", walking: "Walking shot", gym: "Gym shot",
  lifestyle: "Lifestyle shot", laptop: "Laptop / desk", driving: "Driving shot",
  cinematic: "Cinematic b-roll", city: "City footage",
};
const OVERLAY_CTA_LABELS: Record<string, string> = {
  engagement: 'Engagement ("Anyone else relate?")', keyword: "Keyword (Comment X below)",
  identity: "Identity check", save: "Save / share bait",
};

interface TspDropdownDef { key: string; label: string; options: string[]; labelMap?: Record<string, string>; hint?: string }
interface TspCarouselType { value: string; label: string; description: string }

interface TspConfig {
  ideasJobType: ScriptJobType;
  ideasEndpoint: string;
  step1Label: string;
  step1Desc: (form: Record<string, string>) => string;
  contextLabel: string;
  contextPlaceholder: string;
  generateLabel: (form: Record<string, string>) => string;
  ideaPrimary: (idea: any) => string;
  ideaSecondary?: (idea: any) => string;
  ideaBadge?: (idea: any) => string | null;
  ideaExtra?: (idea: any) => string | null;
  ideaToContext: (idea: any) => string;
  pillField?: { key: string; label: string; options: string[] };
  dropdowns: TspDropdownDef[];
  carouselTypes?: TspCarouselType[];
  hasCommentWord?: boolean;
  ctaModeNote?: string;
  overlayCheckbox?: boolean;
  overlayCtaKey?: string; // "ctaType" for overlay vs "ctaMode" for others
  buildIdeasExtra?: (form: Record<string, string>) => Record<string, any>;
  buildScriptExtra?: (form: Record<string, string>) => Record<string, any>;
}

const TSP_CONFIGS: Record<string, TspConfig> = {
  "podcast-clip": {
    ideasJobType: "podcast-ideas",
    ideasEndpoint: "/api/portal/script-writer/podcast-ideas",
    step1Label: "STEP 1 — PICK AN ANGLE",
    step1Desc: () => "Generate 10 contrarian / polarising / truth-bomb ideas pulled straight from your brain. Click one to load it into the writer below.",
    contextLabel: "WHAT'S ON YOUR MIND? (OPTIONAL — FEEDS BOTH IDEAS + THE SCRIPT)",
    contextPlaceholder: "e.g. I want to talk about why most people building AI agencies are wasting time on the wrong stack. OR leave blank and let the brain generate ideas.",
    generateLabel: () => "Write Clip from My Context",
    ideaPrimary: (i) => i.title,
    ideaSecondary: (i) => i.angle,
    ideaBadge: (i) => HOOK_LABELS[i.hookType] ?? i.hookType,
    ideaToContext: (i) => `${i.title}${i.angle ? `\n\n${i.angle}` : ""}`,
    pillField: { key: "targetSeconds", label: "TARGET LENGTH", options: ["30", "45", "60", "90"] },
    dropdowns: [
      { key: "hookType", label: "HOOK STYLE", options: ["any", "contrarian", "truthBomb", "polarising", "iRealised"], labelMap: HOOK_LABELS },
      { key: "ctaMode", label: "CTA", options: ["soft", "comment", "none"], labelMap: { soft: "Soft conversational close", comment: "Comment X below", none: "Ends on punchline" } },
    ],
    hasCommentWord: true,
    buildIdeasExtra: (f) => ({ hookType: f.hookType || "any" }),
    buildScriptExtra: (f) => ({ targetSeconds: Number(f.targetSeconds || 60), hookType: f.hookType || "any", ctaMode: f.ctaMode || "soft", ...(f.ctaMode === "comment" && f.commentWord ? { commentWord: f.commentWord.toUpperCase() } : {}) }),
  },
  "speaking-clip": {
    ideasJobType: "speaking-ideas",
    ideasEndpoint: "/api/portal/script-writer/speaking-ideas",
    step1Label: "STEP 1 — PICK A STAGE ANGLE",
    step1Desc: () => "Generate 10 authority angles pulled straight from your brain. Click one to load it into the writer below.",
    contextLabel: "WHAT'S THE TALK ABOUT? (OPTIONAL — FEEDS BOTH IDEAS + THE SCRIPT)",
    contextPlaceholder: "e.g. The future belongs to operators, not strategists. OR leave blank and let the brain generate ideas.",
    generateLabel: () => "Write Clip from My Context",
    ideaPrimary: (i) => i.title,
    ideaSecondary: (i) => i.angle,
    ideaBadge: (i) => HOOK_LABELS[i.hookType] ?? i.hookType,
    ideaToContext: (i) => `${i.title}${i.angle ? `\n\n${i.angle}` : ""}`,
    pillField: { key: "targetSeconds", label: "TARGET LENGTH", options: ["15", "30", "45", "60", "90"] },
    dropdowns: [
      { key: "hookType", label: "HOOK STYLE", options: ["any", "strongStatement", "contrarian", "audienceChallenge", "futureBased", "truthBomb"], labelMap: HOOK_LABELS },
      { key: "ctaMode", label: "CTA", options: ["soft", "none"], labelMap: { soft: "Soft authoritative close", none: "No punchline" } },
    ],
    ctaModeNote: 'No "comment X" — breaks the stage frame.',
    buildIdeasExtra: (f) => ({ hookType: f.hookType || "any" }),
    buildScriptExtra: (f) => ({ targetSeconds: Number(f.targetSeconds || 60), hookType: f.hookType || "any", ctaMode: f.ctaMode || "soft" }),
  },
  "selfie-clip": {
    ideasJobType: "selfie-ideas",
    ideasEndpoint: "/api/portal/script-writer/selfie-ideas",
    step1Label: "STEP 1 — PICK A RANT ANGLE",
    step1Desc: () => "Generate 10 selfie-yapping angles — each comes with the on-screen hook (visual text overlay) AND the spoken opening.",
    contextLabel: "WHAT DO YOU NEED TO RANT ABOUT? (OPTIONAL — FEEDS BOTH IDEAS + THE SCRIPT)",
    contextPlaceholder: "e.g. I'm so over creators pretending the algorithm is broken when they post once a week. OR leave blank and let the brain generate ideas.",
    generateLabel: () => "Write Clip from My Context",
    ideaPrimary: (i) => i.title,
    ideaSecondary: (i) => i.angle,
    ideaBadge: (i) => HOOK_LABELS[i.hookType] ?? i.hookType,
    ideaExtra: (i) => i.onScreenHook ? `ON-SCREEN: "${i.onScreenHook}"` : null,
    ideaToContext: (i) => `${i.title}${i.angle ? `\n\n${i.angle}` : ""}`,
    pillField: { key: "targetSeconds", label: "TARGET LENGTH", options: ["15", "30", "45", "60", "90"] },
    dropdowns: [
      { key: "hookType", label: "HOOK STYLE", options: ["any", "contrarian", "emotionalTruth", "futureBased", "curiosityBased", "polarising"], labelMap: HOOK_LABELS },
      { key: "formula", label: "RANT FORMULA", options: ["any", "realisation", "contrarianOpinion", "storyBased"], labelMap: FORMULA_LABELS },
      { key: "ctaMode", label: "CTA", options: ["soft", "comment", "none"], labelMap: { soft: "Soft reflective close", comment: "Comment X below", none: "Ends on punchline" } },
    ],
    hasCommentWord: true,
    buildIdeasExtra: (f) => ({ hookType: f.hookType || "any", formula: f.formula || "any" }),
    buildScriptExtra: (f) => ({ targetSeconds: Number(f.targetSeconds || 45), hookType: f.hookType || "any", formula: f.formula || "any", ctaMode: f.ctaMode || "soft", ...(f.ctaMode === "comment" && f.commentWord ? { commentWord: f.commentWord.toUpperCase() } : {}) }),
  },
  "slideshow": {
    ideasJobType: "slideshow-ideas",
    ideasEndpoint: "/api/portal/script-writer/slideshow-ideas",
    step1Label: "STEP 1 — PICK A SLIDESHOW CONCEPT",
    step1Desc: () => "Generate 10 cover-hook concepts. Click one to load it into the slideshow writer below.",
    contextLabel: "WHAT'S THE SLIDESHOW ABOUT? (OPTIONAL — FEEDS BOTH IDEAS + THE SLIDES)",
    contextPlaceholder: "e.g. The 5 morning habits I built when I went from broke to running my own AI agency. OR leave blank and let the brain generate ideas.",
    generateLabel: (f) => `Build ${f.slideCount || "7"}-Slide Deck from My Context`,
    ideaPrimary: (i) => i.coverHook,
    ideaSecondary: (i) => i.angle,
    ideaBadge: (i) => HOOK_LABELS[i.hookType] ?? i.hookType,
    ideaExtra: (i) => i.subHook || null,
    ideaToContext: (i) => `${i.coverHook}${i.subHook ? `\n${i.subHook}` : ""}${i.angle ? `\n\n${i.angle}` : ""}`,
    pillField: { key: "slideCount", label: "SLIDE COUNT", options: ["5", "7", "9", "12"] },
    dropdowns: [
      { key: "hookType", label: "COVER HOOK STYLE", options: ["any", "xThings", "contrarian", "emotionalTruth", "curiosityBased", "futureBased"], labelMap: HOOK_LABELS },
      { key: "visualStyle", label: "VISUAL STYLE", options: ["cinematic", "minimal", "moody", "luxury", "documentary", "retro"], labelMap: VISUAL_STYLE_LABELS },
      { key: "ctaMode", label: "CTA", options: ["soft", "comment", "none"], labelMap: { soft: "Soft (Follow / Save / Send / Part 2?)", comment: "Comment X below", none: "Ends on punchline" } },
    ],
    hasCommentWord: true,
    buildIdeasExtra: (f) => ({ hookType: f.hookType || "any", visualStyle: f.visualStyle || "cinematic" }),
    buildScriptExtra: (f) => ({ slideCount: Number(f.slideCount || 7), hookType: f.hookType || "any", visualStyle: f.visualStyle || "cinematic", ctaMode: f.ctaMode || "soft", ...(f.ctaMode === "comment" && f.commentWord ? { commentWord: f.commentWord.toUpperCase() } : {}) }),
  },
  "carousel": {
    ideasJobType: "carousel-ideas",
    ideasEndpoint: "/api/portal/script-writer/carousel-ideas",
    step1Label: "STEP 1 — PICK A CAROUSEL CONCEPT",
    step1Desc: (f) => `Generate 10 cover-hook concepts shaped for the ${f.carouselType || "tips"} carousel persona.`,
    contextLabel: "WHAT'S THIS CAROUSEL ABOUT? (OPTIONAL — FEEDS BOTH IDEAS + THE SLIDES)",
    contextPlaceholder: "e.g. The 5 client signals I learned to walk away from. OR leave blank and let the brain generate ideas.",
    generateLabel: (f) => `Build ${f.slideCount || "7"}-Slide Carousel from My Context`,
    ideaPrimary: (i) => i.coverHook,
    ideaSecondary: (i) => i.angle,
    ideaExtra: (i) => i.subHook || null,
    ideaToContext: (i) => `${i.coverHook}${i.subHook ? `\n${i.subHook}` : ""}${i.angle ? `\n\n${i.angle}` : ""}`,
    pillField: { key: "slideCount", label: "SLIDE COUNT", options: ["5", "7", "8", "10"] },
    dropdowns: [
      { key: "ctaMode", label: "CTA", options: ["soft", "comment", "none"], labelMap: { soft: "Soft (Follow / Save / Send / Part 2?)", comment: "Comment X below", none: "Ends on punchline" } },
    ],
    hasCommentWord: true,
    carouselTypes: [
      { value: "creative", label: "Creative", description: "Bold, art-directed, single-line per slide" },
      { value: "tips", label: "Tips", description: "Numbered, screenshot-worthy, actionable" },
      { value: "education", label: "Education", description: "Teaches one concept across the deck" },
      { value: "spotlight", label: "Spotlight", description: "Profile-style. Features one subject in depth" },
      { value: "personal", label: "Personal · B&W", description: "Reflective, intimate, black and white" },
    ],
    buildIdeasExtra: (f) => ({ carouselType: f.carouselType || "tips" }),
    buildScriptExtra: (f) => ({ carouselType: f.carouselType || "tips", slideCount: Number(f.slideCount || 7), ctaMode: f.ctaMode || "soft", ...(f.ctaMode === "comment" && f.commentWord ? { commentWord: f.commentWord.toUpperCase() } : {}) }),
  },
  "overlay": {
    ideasJobType: "overlay-ideas",
    ideasEndpoint: "/api/portal/script-writer/overlay-ideas",
    step1Label: "STEP 1 — PICK AN OVERLAY CLIP CONCEPT",
    step1Desc: () => "Generate 10 on-screen hook concepts. Click one to load it into the writer below.",
    contextLabel: "WHAT'S THE CLIP ABOUT? (OPTIONAL — FEEDS BOTH IDEAS + THE CLIP)",
    contextPlaceholder: "e.g. The moment I realised motivation was the wrong target and discipline was the trainable one. OR leave blank and let the brain generate ideas.",
    generateLabel: () => "Build the Overlay Clip from My Context",
    ideaPrimary: (i) => i.onScreenHook,
    ideaSecondary: (i) => i.captionAngle,
    ideaBadge: (i) => HOOK_LABELS[i.hookType] ?? i.hookType,
    ideaToContext: (i) => i.onScreenHook,
    dropdowns: [
      { key: "hookType", label: "ON-SCREEN HOOK STYLE", options: ["any", "howI", "contrarian", "socialProof", "emotionalCuriosity", "futureBased"], labelMap: HOOK_LABELS },
      { key: "brollStyle", label: "B-ROLL STYLE", options: ["auto", "walking", "gym", "lifestyle", "laptop", "driving", "cinematic", "city"], labelMap: BROLL_LABELS },
      { key: "ctaType", label: "CAPTION CTA", options: ["engagement", "keyword", "identity", "save"], labelMap: OVERLAY_CTA_LABELS },
    ],
    hasCommentWord: true,
    overlayCheckbox: true,
    overlayCtaKey: "ctaType",
    buildIdeasExtra: (f) => ({ hookType: f.hookType || "any", brollStyle: f.brollStyle || "auto" }),
    buildScriptExtra: (f) => ({ hookType: f.hookType || "any", brollStyle: f.brollStyle || "auto", ctaType: f.ctaType || "engagement", readCaption: f.readCaption !== "false", ...(f.ctaType === "keyword" && f.commentWord ? { commentWord: f.commentWord.toUpperCase() } : {}) }),
  },
};

const CAROUSEL_TYPE_DEFAULTS: Record<string, string> = {
  "podcast-clip": "soft", "speaking-clip": "soft", "selfie-clip": "soft",
  "slideshow": "soft", "carousel": "soft", "overlay": "engagement",
};

function TextScriptPanel({ def }: { def: ScriptTypeDef }) {
  const cfg = TSP_CONFIGS[def.slug];
  if (!cfg) return null;

  const [influencers, setInfluencers] = useState<Array<{ id: number; name: string }>>([]);
  const [prebuiltBrains, setPrebuiltBrains] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<Record<string, string>>({
    influencerId: "", offerBrainId: "own", context: "", commentWord: "",
    targetSeconds: "60", slideCount: "7", hookType: "any", formula: "any",
    visualStyle: "cinematic", brollStyle: "auto", readCaption: "true",
    ctaMode: "soft", ctaType: CAROUSEL_TYPE_DEFAULTS[def.slug] || "soft",
    carouselType: "tips",
  });
  const [ideas, setIdeas] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<ScriptJobRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [submittingIdeas, setSubmittingIdeas] = useState(false);
  const [submittingScript, setSubmittingScript] = useState(false);
  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    listJobs(def.jobType, 10).then((rows) => {
      setHistory(rows);
    }).finally(() => setLoadingHistory(false));
  }, [def.jobType]);

  const ideasJob = useScriptJob(
    cfg.ideasJobType,
    (j) => { setIdeas((j.result?.ideas || []).map((idea: any, i: number) => ({ ...idea, _idx: i }))); },
    () => { toast({ title: "Ideas generation failed", variant: "destructive" }); },
    { autoResume: false }
  );

  const scriptJob = useScriptJob(
    def.jobType,
    (j) => { setResult(j.result); loadHistory(); },
    () => { toast({ title: "Script generation failed", description: "Something went wrong. Try again.", variant: "destructive" }); },
    { autoResume: true }
  );

  useEffect(() => {
    loadHistory();
    getAuthHeaders().then((headers) => {
      fetch("/api/influencers", { headers })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : (Array.isArray(data?.influencers) ? data.influencers : []);
          setInfluencers(list);
        }).catch(() => {});
    });
    api.getPrebuiltBrains()
      .then(({ brains }) => setPrebuiltBrains(brains.filter((b: any) => b.isActive !== false && !b.comingSoon)))
      .catch(() => {});
  }, [loadHistory]);

  const handleGenerateIdeas = async () => {
    setSubmittingIdeas(true);
    setIdeas([]);
    try {
      const payload: any = {};
      if (form.context.trim()) payload.context = form.context.trim();
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      Object.assign(payload, cfg.buildIdeasExtra?.(form) ?? {});
      const jobId = await startScriptJobJson(cfg.ideasEndpoint, payload);
      ideasJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingIdeas(false);
    }
  };

  const handleGenerateScript = async () => {
    setSubmittingScript(true);
    setResult(null);
    try {
      const payload: any = { context: form.context.trim() };
      if (form.offerBrainId && form.offerBrainId !== "own") payload.offerBrainId = form.offerBrainId;
      if (form.influencerId) payload.influencerId = Number(form.influencerId);
      Object.assign(payload, cfg.buildScriptExtra?.(form) ?? {});
      const jobId = await startScriptJobJson(def.endpoint, payload);
      scriptJob.start(jobId);
    } catch (e: any) {
      toast({ title: "Failed to start script", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingScript(false);
    }
  };

  const ideasActive = ideasJob.isActive || submittingIdeas;
  const scriptActive = scriptJob.isActive || submittingScript;
  const anyActive = ideasActive || scriptActive;
  const ctaKey = cfg.overlayCtaKey || "ctaMode";
  const needsCommentWord = cfg.hasCommentWord && (form[ctaKey] === "comment" || form[ctaKey] === "keyword");

  return (
    <div className="space-y-5">

      {/* ── Active job banner ── */}
      {scriptActive && (
        <div className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GOLD }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Working — You can leave this tab and come back</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[13px] font-bold" style={{ color: GOLD }}>{scriptJob.progressPct}%</span>
              <button onClick={() => { scriptJob.cancel(); setSubmittingScript(false); }}
                className="text-[11px] font-bold uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors">Reset</button>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${scriptJob.progressPct}%`, background: GOLD }} />
          </div>
          <div className="flex justify-between text-[11px] text-white/30">
            <span>{scriptJob.stage || "Processing…"}</span>
            <span>Elapsed {fmtElapsed(scriptJob.elapsedMs)}</span>
          </div>
        </div>
      )}

      {/* ── Recent Scripts (collapsible) ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left"
        >
          <div className="flex items-center gap-2">
            <FileStack className="w-3.5 h-3.5" style={{ color: GOLD }} />
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Recent Scripts</span>
            {history.length > 0 && <span className="text-[11px] text-white/25">({history.length})</span>}
          </div>
          <div className="flex items-center gap-3">
            {historyOpen && (
              <button onClick={(e) => { e.stopPropagation(); loadHistory(); }}
                className="text-[11px] text-white/30 hover:text-white/60 uppercase tracking-wider transition-colors">Refresh</button>
            )}
            <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </div>
        </button>

        {historyOpen && (
          <div className="px-4 pb-4 border-t border-white/[0.05]">
            {loadingHistory ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 text-white/30 animate-spin" /></div>
            ) : history.length === 0 ? (
              <p className="text-[12px] text-white/25 pt-3">No scripts yet for this SOP.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-3">
                {history.map((h) => (
                  <button key={h.id} onClick={() => h.result && setResult(h.result)} disabled={!h.result}
                    className="text-left px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors disabled:opacity-50 disabled:cursor-default">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] text-white/80 truncate flex-1">{h.label || def.label}</p>
                      <span className={`text-[10px] font-bold flex-shrink-0 ${h.status === "succeeded" ? "text-emerald-400" : h.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
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
      </div>

      {/* ── AI Influencer + Offer/Brain ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Users className="w-3 h-3" /> AI Influencer (Optional)
          </label>
          <FmSelect value={form.influencerId} onChange={(v) => setF("influencerId", v)} disabled={anyActive}
            options={[{ value: "", label: "— Owner's main brand —" }, ...influencers.map((inf) => ({ value: String(inf.id), label: inf.name }))]} />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            <Cpu className="w-3 h-3" /> Offer / Brain
          </label>
          <FmSelect value={form.offerBrainId} onChange={(v) => setF("offerBrainId", v)} disabled={anyActive}
            options={[{ value: "own", label: "— Your brain (default) —" }, ...prebuiltBrains.map((b) => ({ value: b.id, label: b.name }))]} />
        </div>
      </div>

      {/* ── Carousel type card picker ── */}
      {cfg.carouselTypes && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Carousel Type</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {cfg.carouselTypes.map((ct) => (
              <button key={ct.value} disabled={anyActive}
                onClick={() => setF("carouselType", ct.value)}
                className={`p-3 rounded-xl border text-left transition-all disabled:opacity-40 ${form.carouselType === ct.value ? "border-[#C9A44C]/60 bg-[#C9A44C]/[0.08]" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"}`}
              >
                <p className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${form.carouselType === ct.value ? "text-white" : "text-white/50"}`}>{ct.label}</p>
                <p className="text-[10px] text-white/30 leading-snug">{ct.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Pill field (target length / slide count) ── */}
      {cfg.pillField && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
            {cfg.pillField.label}
          </label>
          <div className="flex gap-2 flex-wrap">
            {cfg.pillField.options.map((opt) => (
              <button key={opt} disabled={anyActive}
                onClick={() => setF(cfg.pillField!.key, opt)}
                className={`px-5 py-2 rounded-xl text-[13px] font-bold tracking-wide transition-all disabled:opacity-40 ${form[cfg.pillField!.key] === opt ? "text-black" : "text-white/40 border border-white/[0.1] hover:text-white/60"}`}
                style={form[cfg.pillField!.key] === opt ? { background: GOLD } : {}}
              >
                {opt}{cfg.pillField!.key === "targetSeconds" ? "S" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Dropdowns ── */}
      {cfg.dropdowns.length > 0 && (
        <div className={`grid gap-3 ${cfg.dropdowns.length === 1 ? "grid-cols-1" : cfg.dropdowns.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {cfg.dropdowns.map((dd) => (
            <div key={dd.key}>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{dd.label}</label>
              <div className="relative">
                <select disabled={anyActive} value={form[dd.key] || dd.options[0] || ""}
                  onChange={(e) => setF(dd.key, e.target.value)}
                  className="w-full appearance-none pl-3.5 pr-9 py-2.5 rounded-xl border border-white/[0.12] text-[12px] font-medium focus:outline-none focus:border-[#C9A44C]/50 cursor-pointer transition-colors disabled:opacity-40"
                >
                  {dd.options.map((o) => (
                    <option key={o} value={o}>
                      {dd.labelMap?.[o] ?? o}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              </div>
              {dd.key === (cfg.overlayCtaKey || "ctaMode") && cfg.ctaModeNote && (
                <p className="text-[11px] text-white/30 mt-1">{cfg.ctaModeNote}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── "Read caption" checkbox (overlay only) ── */}
      {cfg.overlayCheckbox && (
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <input type="checkbox" checked={form.readCaption !== "false"}
            onChange={(e) => setF("readCaption", e.target.checked ? "true" : "false")}
            className="w-4 h-4 rounded accent-[#C9A44C]" disabled={anyActive}
          />
          <span className="text-[12px] text-white/60 group-hover:text-white/80 transition-colors select-none">
            Include "Read caption" bridge text
          </span>
        </label>
      )}

      {/* ── Comment word (shown when ctaMode=comment or ctaType=keyword) ── */}
      {needsCommentWord && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">Comment Word</label>
          <input type="text" disabled={anyActive} value={form.commentWord}
            onChange={(e) => setF("commentWord", e.target.value.toUpperCase().replace(/[^\w\-]/g, "").slice(0, 24))}
            placeholder="GO"
            className="w-48 rounded-xl border border-white/[0.08] text-[14px] font-bold text-white placeholder-white/20 px-4 py-2.5 focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40 tracking-widest"
            style={{ background: "#111" }} />
        </div>
      )}

      {/* ── Context textarea ── */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-2">
          {cfg.contextLabel}
        </label>
        <textarea disabled={anyActive} value={form.context}
          onChange={(e) => setF("context", e.target.value)}
          rows={3} placeholder={cfg.contextPlaceholder}
          className="w-full rounded-xl border border-white/[0.08] text-[13px] text-white placeholder-white/25 px-4 py-3 resize-none focus:outline-none focus:border-[#C9A44C]/40 transition-colors disabled:opacity-40"
          style={{ background: "#111" }} />
      </div>

      {/* ── Step 1 ideas bar ── */}
      <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: GOLD }}>{cfg.step1Label}</p>
          <p className="text-[12px] text-white/40 mt-0.5">{cfg.step1Desc(form)}</p>
        </div>
        <button onClick={handleGenerateIdeas} disabled={anyActive}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-semibold text-black transition-all disabled:opacity-50 flex-shrink-0"
          style={{ background: GOLD }}>
          {ideasActive
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            : <><Sparkles className="w-4 h-4" /> Generate 10 Ideas</>}
        </button>
      </div>

      {/* Ideas progress */}
      {ideasActive && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-white/40">
            <span>{ideasJob.stage || "Brainstorming ideas…"}</span>
            <span>{fmtEta(ideasJob.etaMs)}</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ideasJob.progressPct}%`, background: GOLD }} />
          </div>
        </div>
      )}

      {/* Ideas list */}
      {ideas.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {ideas.map((idea, idx) => {
            const primary = cfg.ideaPrimary(idea);
            const secondary = cfg.ideaSecondary?.(idea);
            const badge = cfg.ideaBadge?.(idea);
            const extra = cfg.ideaExtra?.(idea);
            return (
              <button key={idx}
                onClick={() => { setF("context", cfg.ideaToContext(idea)); }}
                className="text-left px-3.5 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#C9A44C]/30 transition-all group"
              >
                <div className="flex items-start gap-2">
                  <span className="text-[11px] font-bold text-white/20 flex-shrink-0 mt-0.5">{idx + 1}.</span>
                  <div className="min-w-0">
                    {badge && <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${GOLD}99` }}>{badge}</p>}
                    <p className="text-[13px] font-semibold text-white/90 leading-snug group-hover:text-white transition-colors">{primary}</p>
                    {secondary && <p className="text-[11px] text-white/40 mt-1 leading-relaxed">{secondary}</p>}
                    {extra && <p className="text-[11px] mt-1.5 italic" style={{ color: `${GOLD}88` }}>{extra}</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Generate Script button ── */}
      <button onClick={handleGenerateScript} disabled={anyActive}
        className="w-full py-4 rounded-2xl text-[13px] font-semibold text-black transition-all disabled:opacity-50"
        style={{ background: GOLD }}>
        {scriptActive
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating…</span>
          : <span className="flex items-center justify-center gap-2"><Sparkles className="w-4 h-4" />{cfg.generateLabel(form)}</span>}
      </button>

      {/* ── Result ── */}
      {result && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-white/30">Generated Script</p>
            <button onClick={handleGenerateScript} disabled={anyActive}
              className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-40">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </button>
          </div>
          <ScriptResult result={result} def={def} />
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
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
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
        ) : activeDef.slug === "green-screen" ? (
          <GreenScreenPanel key="green-screen" />
        ) : activeDef.slug === "hook-demo" ? (
          <HookDemoPanel key="hook-demo" />
        ) : TSP_CONFIGS[activeDef.slug] ? (
          <TextScriptPanel key={activeDef.slug} def={activeDef} />
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
