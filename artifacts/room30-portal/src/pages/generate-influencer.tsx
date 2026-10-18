import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Wand2, Loader2, AlertCircle, ImagePlus, X,
  CheckCircle2, Sparkles, Upload,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi, getAuthHeaders } from "@/lib/api";
import { useInfluencerQuota } from "@/hooks/use-influencer-quota";

const GOLD = "#C9A44C";

// ── Options ─────────────────────────────────────────────────────────────────

const AGE_OPTIONS = [
  { value: "18-24", label: "18 – 24" },
  { value: "25-32", label: "25 – 32" },
  { value: "33-40", label: "33 – 40" },
  { value: "41-50", label: "41 – 50" },
  { value: "51-65", label: "51 – 65" },
];

const ETHNICITY_OPTIONS = [
  { value: "white",            label: "White / European" },
  { value: "black",            label: "Black / African" },
  { value: "east_asian",       label: "East Asian" },
  { value: "south_asian",      label: "South Asian" },
  { value: "hispanic_latino",  label: "Hispanic / Latino" },
  { value: "middle_eastern",   label: "Middle Eastern" },
  { value: "mixed",            label: "Mixed" },
];

const GENDER_OPTIONS = [
  { value: "female",     label: "Female" },
  { value: "male",       label: "Male" },
  { value: "non_binary", label: "Non-binary" },
];

const VIBE_PRESETS = [
  "Soft luxury, quiet wealth",
  "Bold, high-energy, creator vibes",
  "Athletic, outdoors, sun-kissed",
  "Cozy, warm, relatable",
  "Editorial, fashion-forward",
  "Minimalist, clean, professional",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 mb-2">
      {children}
    </span>
  );
}

function SelectField({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-[14px] focus:outline-none focus:border-[#C9A44C]/50 appearance-none"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff60' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Reference image upload ────────────────────────────────────────────────────

interface UploadedRef {
  file: File;
  objectPath: string;
  previewUrl: string;
  uploading: boolean;
  error?: string;
}

async function uploadRefImage(file: File, userId: number): Promise<string> {
  // Step 1: request presigned URL
  const { uploadURL, objectPath } = await fetchApi<{ uploadURL: string; objectPath: string }>(
    "/api/storage/uploads/request-url",
    {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    },
  );
  // Step 2: PUT the file directly to the presigned URL
  const headers = await getAuthHeaders();
  await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type, ...headers },
    body: file,
  });
  return objectPath;
}

function ReferenceUploader({
  refs, onChange,
}: { refs: UploadedRef[]; onChange: (refs: UploadedRef[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const MAX = 5;

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, MAX - refs.length);
    if (!accepted.length) return;

    const previews: UploadedRef[] = accepted.map(f => ({
      file: f,
      objectPath: "",
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }));
    const next = [...refs, ...previews];
    onChange(next);

    // Upload each in parallel
    const results = await Promise.allSettled(
      accepted.map(f => uploadRefImage(f, 0)),
    );
    const updated = [...next];
    let idx = refs.length;
    for (const result of results) {
      if (result.status === "fulfilled") {
        updated[idx] = { ...updated[idx], objectPath: result.value, uploading: false };
      } else {
        updated[idx] = { ...updated[idx], uploading: false, error: "Upload failed" };
      }
      idx++;
    }
    onChange(updated);
  }

  function remove(i: number) {
    URL.revokeObjectURL(refs[i].previewUrl);
    onChange(refs.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {refs.map((r, i) => (
          <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-white/[0.1] bg-white/[0.03]">
            <img src={r.previewUrl} alt="" className="w-full h-full object-cover" />
            {r.uploading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-[#C9A44C] animate-spin" />
              </div>
            )}
            {r.error && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
            )}
            {!r.uploading && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center hover:bg-black/90 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            )}
          </div>
        ))}

        {refs.length < MAX && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] hover:bg-[#C9A44C]/[0.04] hover:border-[#C9A44C]/30 flex flex-col items-center justify-center gap-1.5 transition-all group"
          >
            <ImagePlus className="w-5 h-5 text-white/30 group-hover:text-[#C9A44C]/60 transition-colors" />
            <span className="text-[10px] text-white/25 group-hover:text-[#C9A44C]/50 transition-colors">Add</span>
          </button>
        )}
      </div>

      {/* Drop zone (shown when empty) */}
      {refs.length === 0 && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="border border-dashed border-white/[0.12] rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-[#C9A44C]/30 hover:bg-[#C9A44C]/[0.02] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/10 flex items-center justify-center">
            <Upload className="w-5 h-5 text-[#C9A44C]" />
          </div>
          <div className="text-center">
            <p className="text-[13px] text-white/60">Drop images here or <span className="text-[#C9A44C]">browse</span></p>
            <p className="text-[11px] text-white/30 mt-1">Up to 5 photos · JPG, PNG, WebP · 10 MB each</p>
          </div>
        </div>
      )}

      {refs.length > 0 && refs.length < MAX && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[12px] text-[#C9A44C]/70 hover:text-[#C9A44C] transition-colors"
        >
          + Add more ({MAX - refs.length} remaining)
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ number, title, subtitle, children }: {
  number: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-8 h-8 rounded-lg bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-[12px] font-black text-[#C9A44C]">{number}</span>
        </div>
        <div>
          <h2 className="text-[15px] font-bold text-white">{title}</h2>
          {subtitle && <p className="text-[12px] text-white/40 mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GenerateInfluencer() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Form state
  const [ageRange,  setAgeRange]  = useState(AGE_OPTIONS[1].value);
  const [ethnicity, setEthnicity] = useState(ETHNICITY_OPTIONS[0].value);
  const [gender,    setGender]    = useState(GENDER_OPTIONS[0].value);
  const [vibe,      setVibe]      = useState(VIBE_PRESETS[0]);
  const [notes,     setNotes]     = useState("");
  const [refs,      setRefs]      = useState<UploadedRef[]>([]);
  const [error,     setError]     = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);

  // Scroll error into view
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [error]);

  // Quota check
  const { data: quota, isPending: quotaLoading, isError: quotaError, refetch: refetchQuota } = useInfluencerQuota();
  const used: number = quota?.used ?? 0;
  const total: number = quota?.total ?? 1;
  const remaining = Math.max(0, total - used);
  const canGenerate = !!quota && !quotaLoading && !quotaError && remaining > 0;

  const generate = useMutation({
    mutationFn: async () => {
      const readyRefs = refs.filter(r => r.objectPath && !r.uploading && !r.error);
      return fetchApi("/influencer-jobs", {
        method: "POST",
        body: JSON.stringify({
          ageRange,
          ethnicity,
          gender,
          vibe,
          notes: notes || null,
          facialHair: null,
          hairstyle: null,
          referenceImagePaths: readyRefs.map(r => r.objectPath),
        }),
      }) as Promise<{ job: any }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
      queryClient.invalidateQueries({ queryKey: ["influencer-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["me-credits-status"] });
      setSubmitted(true);
    },
    onError: (err: Error & { body?: { message?: string; error?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["influencer-quota"] });
      console.error("[generate-influencer] failed:", err);
      setError(
        err?.body?.message || err?.body?.error || err?.message ||
        "Something went wrong. Please try again or contact support.",
      );
    },
  });

  const anyUploading = refs.some(r => r.uploading);
  const isPending = generate.isPending || anyUploading;

  if (submitted) {
    return (
      <PortalLayout>
        <div className={PORTAL_PAGE_CLASS}>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#C9A44C]/15 flex items-center justify-center mb-6">
              <CheckCircle2 className="w-8 h-8 text-[#C9A44C]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Generation Started!</h1>
            <p className="text-[14px] text-white/50 max-w-sm leading-relaxed mb-8">
              Your AI influencer is being crafted. This usually takes a few hours — we'll deliver it straight to your account.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setLocation("/your-influencers")}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-[13px] uppercase tracking-wider text-black"
                style={{ background: GOLD }}
              >
                <Sparkles className="w-4 h-4" /> View My Influencers
              </button>
              <button
                onClick={() => { setSubmitted(false); setError(null); setRefs([]); }}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-[13px] uppercase tracking-wider text-white border border-white/[0.12] hover:bg-white/[0.04] transition-colors"
              >
                Generate Another
              </button>
            </div>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>

        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => setLocation("/your-influencers")}
            className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to My Influencers
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A44C]/70 mb-0.5">
                Free AI Influencer
              </div>
              <h1 className="text-xl font-bold text-white">Build Your AI Influencer</h1>
            </div>
          </div>
          {quota && (
            <div className="mt-4 flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: total }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-6 h-1.5 rounded-full ${i < used ? "bg-[#C9A44C]/30" : "bg-[#C9A44C]"}`}
                  />
                ))}
              </div>
              <span className="text-[11px] text-white/40">
                {remaining} of {total} generation{total !== 1 ? "s" : ""} remaining
              </span>
            </div>
          )}
        </div>

        {quotaLoading && <p role="status" className="mb-6 text-sm text-white/60">Checking your remaining generations…</p>}
        {quotaError && (
          <p role="alert" className="mb-6 text-sm text-amber-300">
            Unable to check your generations.{" "}
            <button onClick={() => void refetchQuota()} className="underline">Retry</button>
          </p>
        )}
        {quota && !quotaLoading && !quotaError && remaining === 0 && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] text-amber-400 font-medium">No generations remaining</p>
              <p className="text-[12px] text-amber-400/70 mt-0.5">
                You've used all your included and purchased generations.{" "}
                <button onClick={() => setLocation("/credits")} className="underline hover:no-underline">
                  Buy more here.
                </button>
              </p>
            </div>
          </div>
        )}

        <form
          onSubmit={e => { e.preventDefault(); if (!isPending && canGenerate) { setError(null); generate.mutate(); } }}
          className="space-y-4"
        >
          {/* Section 1 — Demographics */}
          <Section
            number="01"
            title="Who are they?"
            subtitle="The foundation — age, background, and gender shape everything about the character."
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <FieldLabel>Age range</FieldLabel>
                <SelectField value={ageRange} onChange={setAgeRange} options={AGE_OPTIONS} />
              </div>
              <div>
                <FieldLabel>Ethnicity</FieldLabel>
                <SelectField value={ethnicity} onChange={setEthnicity} options={ETHNICITY_OPTIONS} />
              </div>
              <div>
                <FieldLabel>Gender</FieldLabel>
                <SelectField value={gender} onChange={setGender} options={GENDER_OPTIONS} />
              </div>
            </div>
          </Section>

          {/* Section 2 — Vibe */}
          <Section
            number="02"
            title="Their vibe & style"
            subtitle="Pick a preset or write your own — this drives the aesthetic, energy, and fashion direction."
          >
            <div className="flex flex-wrap gap-2 mb-3">
              {VIBE_PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setVibe(p)}
                  className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                    vibe === p
                      ? "border-[#C9A44C]/60 text-[#C9A44C] bg-[#C9A44C]/[0.08]"
                      : "border-white/[0.1] text-white/50 hover:bg-white/[0.04]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              value={vibe}
              onChange={e => setVibe(e.target.value)}
              placeholder="Or describe it yourself..."
              maxLength={120}
              className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 focus:border-[#C9A44C]/50 focus:outline-none text-[14px]"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-white/25">{vibe.length}/120</span>
            </div>
          </Section>

          {/* Section 3 — Reference images */}
          <Section
            number="03"
            title="Reference examples"
            subtitle="Optional but powerful — upload photos of the look, style, or aesthetic you're going for. These guide our team when crafting your influencer."
          >
            <ReferenceUploader refs={refs} onChange={setRefs} />
            {anyUploading && (
              <p className="text-[11px] text-[#C9A44C]/70 mt-2 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading images…
              </p>
            )}
          </Section>

          {/* Section 4 — Extra details */}
          <Section
            number="04"
            title="Anything else?"
            subtitle="Optional — hairstyle, hair colour, facial hair, tattoos, freckles, niche, height, or any other details."
          >
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={"e.g. Long brunette waves, slight freckles, no visible tattoos, fitness niche, 5'7\"..."}
              rows={4}
              maxLength={800}
              className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-white/25 focus:border-[#C9A44C]/50 focus:outline-none text-[14px] resize-none"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-white/25">{notes.length}/800</span>
            </div>
          </Section>

          {/* Error */}
          {error && (
            <div
              ref={errorRef}
              role="alert"
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3"
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-red-300">{error}</p>
            </div>
          )}

          {/* Submit */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isPending || !canGenerate}
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl text-black text-[14px] font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ background: GOLD }}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {anyUploading ? "Uploading images…" : generate.isPending ? "Starting…" : "Generate My Influencer"}
            </button>
            <button
              type="button"
              onClick={() => setLocation("/your-influencers")}
              className="w-full sm:w-auto px-6 py-4 rounded-xl text-white/50 hover:text-white/80 text-[13px] font-medium transition-colors"
            >
              Cancel
            </button>
          </div>

          <p className="text-[11px] text-white/25 text-center pb-4">
            Your preferences are saved and our team personally reviews every generation before delivery.
          </p>
        </form>
      </div>
    </PortalLayout>
  );
}
