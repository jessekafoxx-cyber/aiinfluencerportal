import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Save, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Plus, X, ChevronDown, ChevronUp, Download, Copy, Check,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";

const POLL_MS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert backend-generated HTML to plain readable text for display / copy. */
function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<\/h[23]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "$1")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(k => k === key ? null : k), 2000);
    });
  }, []);
  return { copiedKey, copy };
}

// ── Small reusable components ─────────────────────────────────────────────────

function CopyButton({ text, id, copiedKey, onCopy }: { text: string; id: string; copiedKey: string | null; onCopy: (t: string, k: string) => void }) {
  const active = copiedKey === id;
  return (
    <button
      onClick={() => onCopy(text, id)}
      title="Copy"
      className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
        active ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.1]"
      }`}
    >
      {active ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {active ? "Copied" : "Copy"}
    </button>
  );
}

function TagInput({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput("");
  };
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#C9A44C]/15 text-[#C9A44C] text-[11px]">
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-white transition-colors"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder || "Add and press Enter"}
          className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40"
        />
        <button onClick={add} className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-[#C9A44C]/15 text-white/60 hover:text-[#C9A44C] transition-colors border border-white/[0.08]">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; hint?: string;
}) {
  const cls = "w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40 resize-none";
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{label}</label>
      {multiline
        ? <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
      {hint && <p className="mt-1 text-[11px] text-white/25 leading-relaxed">{hint}</p>}
    </div>
  );
}

/** Editable field for prebuilt brain data — pre-populated but fully typeable, copy button copies current value. */
function EditablePrebuiltField({ label, value, onChange, id, copiedKey, onCopy }: {
  label: string; value: string; onChange: (v: string) => void; id: string;
  copiedKey: string | null; onCopy: (t: string, k: string) => void;
}) {
  const isMultiline = value.length > 80 || label.toLowerCase().includes("how") || label.toLowerCase().includes("achiev") || label.toLowerCase().includes("help");
  const cls = "w-full px-4 py-3 bg-transparent text-[13px] text-white/80 leading-relaxed resize-none focus:outline-none focus:bg-white/[0.02] transition-colors placeholder-white/20";
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] focus-within:border-[#C9A44C]/30 transition-colors">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">{label}</span>
        <CopyButton text={value} id={id} copiedKey={copiedKey} onCopy={onCopy} />
      </div>
      {isMultiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={Math.min(Math.max(Math.ceil(value.length / 80), 2), 6)}
          className={cls}
          placeholder={`Enter ${label.toLowerCase()}…`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cls + " block"}
          placeholder={`Enter ${label.toLowerCase()}…`}
        />
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Not set up",
  saved: "Saved — not generated yet",
  generating: "Generating…",
  generated: "Brain ready",
  error: "Error",
};

export default function YourBrain() {
  const queryClient = useQueryClient();
  const [showGenerated, setShowGenerated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { copiedKey, copy } = useCopy();

  // Brain mode
  const [brainMode, setBrainMode] = useState<"own" | "prebuilt">("own");
  const [selectedPrebuiltId, setSelectedPrebuiltId] = useState<string | null>(null);

  // Editable prebuilt brain fields (pre-populated from preset, but user can type)
  const [prebuiltEdits, setPrebuiltEdits] = useState({
    name: "", companyName: "", whoDoYouHelp: "", howDoYouHelpThem: "", keyAchievements: "",
  });
  const setPrebuiltField = (key: keyof typeof prebuiltEdits) => (v: string) =>
    setPrebuiltEdits(prev => ({ ...prev, [key]: v }));

  // Own-brain form state
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [whoDoYouHelp, setWhoDoYouHelp] = useState("");
  const [howDoYouHelpThem, setHowDoYouHelpThem] = useState("");
  const [keyAchievements, setKeyAchievements] = useState("");
  const [website, setWebsite] = useState("");
  const [landingPages, setLandingPages] = useState<string[]>([]);
  const [socialProfiles, setSocialProfiles] = useState<string[]>([]);
  const [brandColorPrimary, setBrandColorPrimary] = useState("");
  const [brandColorSecondary, setBrandColorSecondary] = useState("");
  const [confirmedLowTicketOffer, setConfirmedLowTicketOffer] = useState("");
  const [confirmedPremiumOffer, setConfirmedPremiumOffer] = useState("");
  const [confirmed100kOffer, setConfirmed100kOffer] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["brain-profile"],
    queryFn: () => api.getBrainProfile(),
  });

  const { data: prebuiltData } = useQuery({
    queryKey: ["prebuilt-brains"],
    queryFn: () => api.getPrebuiltBrains(),
  });

  const profile = (data as any)?.profile ?? null;
  const prebuiltBrains = prebuiltData?.brains ?? [];

  // Load selected prebuilt brain details
  const activePrebuiltId = brainMode === "prebuilt" ? selectedPrebuiltId : null;
  const { data: prebuiltDetail } = useQuery({
    queryKey: ["prebuilt-brain-detail", activePrebuiltId],
    queryFn: () => api.getPrebuiltBrain(activePrebuiltId!),
    enabled: !!activePrebuiltId,
  });
  const prebuiltBrainDetail = prebuiltDetail?.brain ?? null;

  // Populate form when profile loads
  useEffect(() => {
    if (!profile) return;
    const mode = profile.brainMode === "prebuilt" ? "prebuilt" : "own";
    setBrainMode(mode);
    if (profile.selectedPrebuiltBrainId) setSelectedPrebuiltId(profile.selectedPrebuiltBrainId);
    setName(profile.name || "");
    setCompanyName(profile.companyName || "");
    setWhoDoYouHelp(profile.whoDoYouHelp || "");
    setHowDoYouHelpThem(profile.howDoYouHelpThem || "");
    setKeyAchievements(profile.keyAchievements || "");
    setWebsite(profile.website || "");
    setLandingPages(Array.isArray(profile.landingPages) ? profile.landingPages : []);
    setSocialProfiles(Array.isArray(profile.socialProfiles) ? profile.socialProfiles : []);
    setBrandColorPrimary(profile.brandColorPrimary || "");
    setBrandColorSecondary(profile.brandColorSecondary || "");
    setConfirmedLowTicketOffer(profile.confirmedLowTicketOffer || "");
    setConfirmedPremiumOffer(profile.confirmedPremiumOffer || "");
    setConfirmed100kOffer(profile.confirmed100kOffer || "");
    setDirty(false);
  }, [profile?.id]);

  // Populate editable prebuilt fields when preset detail loads
  useEffect(() => {
    if (!prebuiltBrainDetail?.brainData) return;
    const bd = prebuiltBrainDetail.brainData;
    setPrebuiltEdits({
      name: bd.name || "",
      companyName: bd.companyName || "",
      whoDoYouHelp: bd.whoDoYouHelp || "",
      howDoYouHelpThem: bd.howDoYouHelpThem || "",
      keyAchievements: bd.keyAchievements || "",
    });
  }, [prebuiltBrainDetail?.id]);

  // Poll while generating
  useEffect(() => {
    if (profile?.status !== "generating") return;
    const t = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [profile?.status]);

  const buildSavePayload = (mode = brainMode, prebuiltId = selectedPrebuiltId) => ({
    name, companyName, whoDoYouHelp, howDoYouHelpThem, keyAchievements,
    website, landingPages, socialProfiles,
    brandColorPrimary, brandColorSecondary,
    confirmedLowTicketOffer, confirmedPremiumOffer, confirmed100kOffer,
    brainMode: mode,
    selectedPrebuiltBrainId: mode === "prebuilt" ? prebuiltId : null,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.saveBrainProfile(buildSavePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
      setDirty(false);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (brainMode === "prebuilt") {
        return api.saveBrainProfile(buildSavePayload());
      }
      await api.saveBrainProfile(buildSavePayload());
      return api.generateBrain();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
      setDirty(false);
    },
  });

  const switchMode = (mode: "own" | "prebuilt", prebuiltId?: string) => {
    setBrainMode(mode);
    if (prebuiltId) setSelectedPrebuiltId(prebuiltId);
    setDirty(true);
  };

  const status = profile?.status ?? "pending";
  const isGenerating = status === "generating" || generateMutation.isPending;
  const isReady = status === "generated" || (brainMode === "prebuilt" && !!selectedPrebuiltId);

  const mark = (fn: () => void) => { fn(); setDirty(true); };

  // Plain text for generated brain — strip HTML for display and copy
  const generatedHtml = brainMode === "prebuilt" && prebuiltBrainDetail?.generatedBrain
    ? prebuiltBrainDetail.generatedBrain
    : profile?.generatedBrain;
  const generatedText = generatedHtml ? htmlToPlainText(generatedHtml) : "";

  const handleDownload = () => {
    const blob = new Blob([generatedText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "your-brain.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0">
              <Brain className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white">Your Brain</h1>
              <p className="text-white/40 text-[12px] mt-0.5">Tell us about your business so we can build everything for you</p>
            </div>
          </div>
          <span className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
            isReady ? "bg-emerald-500/10 text-emerald-400" :
            isGenerating ? "bg-[#C9A44C]/10 text-[#C9A44C]" :
            status === "error" ? "bg-red-500/10 text-red-400" :
            "bg-white/[0.06] text-white/40"
          }`}>
            {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> :
             isReady ? <CheckCircle2 className="w-3 h-3" /> :
             status === "error" ? <AlertCircle className="w-3 h-3" /> : null}
            {isReady ? "Brain Active" : isGenerating ? "Generating…" : STATUS_LABELS[status] ?? status}
          </span>
        </div>

        {status === "error" && profile?.errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{profile.errorMessage}
          </div>
        )}

        {isGenerating && brainMode === "own" && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 text-[#C9A44C] text-[13px] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Your Brain is being generated. This takes 30–90 seconds. You can leave this page and come back.
          </div>
        )}

        {/* ── Choose Your Brain ──────────────────────────────────────────── */}
        <div className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30 mb-1">Choose Your Brain</h2>
          <p className="text-white/40 text-[12px] mb-5">Promote one of our pre-built offers as an affiliate, or build your own brain below.</p>

          <div className="space-y-3">
            {/* Use My Own Brain */}
            <button
              onClick={() => switchMode("own")}
              className={`w-full text-left rounded-xl border p-4 transition-all ${
                brainMode === "own"
                  ? "border-[#C9A44C]/40 bg-[#C9A44C]/05"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  brainMode === "own" ? "border-[#C9A44C]" : "border-white/20"
                }`}>
                  {brainMode === "own" && <div className="w-2 h-2 rounded-full bg-[#C9A44C]" />}
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-white">Use My Own Brain</p>
                  <p className="text-[11px] text-white/40 mt-0.5">Fill in the form below and we generate your brain from your own positioning.</p>
                </div>
                {brainMode === "own" && <CheckCircle2 className="w-4 h-4 text-[#C9A44C] flex-shrink-0" />}
              </div>
            </button>

            {/* Prebuilt brains */}
            {prebuiltBrains.filter((b: any) => !b.comingSoon).map((brain: any) => (
              <button
                key={brain.id}
                onClick={() => switchMode("prebuilt", brain.id)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  brainMode === "prebuilt" && selectedPrebuiltId === brain.id
                    ? "border-[#C9A44C]/40 bg-[#C9A44C]/05"
                    : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    brainMode === "prebuilt" && selectedPrebuiltId === brain.id ? "border-[#C9A44C]" : "border-white/20"
                  }`}>
                    {brainMode === "prebuilt" && selectedPrebuiltId === brain.id && <div className="w-2 h-2 rounded-full bg-[#C9A44C]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-[13px] font-semibold text-white">{brain.name}</p>
                      {brain.badge && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#C9A44C]/15 text-[#C9A44C]">{brain.badge}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/50 mb-2">{brain.tagline}</p>
                    <p className="text-[12px] text-white/40 leading-relaxed">{brain.shortDescription}</p>
                    {brain.highlights?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {brain.highlights.map((h: string, i: number) => (
                          <li key={i} className="flex items-center gap-1.5 text-[11px] text-white/50">
                            <CheckCircle2 className="w-3 h-3 text-[#C9A44C] flex-shrink-0" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {brainMode === "prebuilt" && selectedPrebuiltId === brain.id && (
                    <CheckCircle2 className="w-4 h-4 text-[#C9A44C] flex-shrink-0 mt-0.5" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {dirty && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Brain Choice
              </button>
            </div>
          )}
        </div>

        {/* ── Pre-built Brain Preview ────────────────────────────────────── */}
        {brainMode === "prebuilt" && selectedPrebuiltId && (
          <div className="mb-8 space-y-5">
            {/* Field-by-field data */}
            {prebuiltBrainDetail && (
              <div className="rounded-xl border border-[#C9A44C]/20 bg-white/[0.02] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A44C]/60">Pre-built Brain Preview</p>
                    <p className="text-[14px] font-bold text-white mt-0.5">{prebuiltBrainDetail.name}</p>
                    {prebuiltBrainDetail.tagline && (
                      <p className="text-[12px] text-white/40 mt-0.5">{prebuiltBrainDetail.tagline}</p>
                    )}
                  </div>
                  {generatedText && (
                    <CopyButton text={generatedText} id="entire-brain" copiedKey={copiedKey} onCopy={copy} />
                  )}
                </div>

                <div className="p-5 space-y-3">
                  {([
                    { label: "Your Name", field: "name" as const },
                    { label: "Company Name", field: "companyName" as const },
                    { label: "Who Do You Help?", field: "whoDoYouHelp" as const },
                    { label: "How Do You Help Them?", field: "howDoYouHelpThem" as const },
                    { label: "Key Achievements / Results", field: "keyAchievements" as const },
                  ]).map(({ label, field }) => (
                    <EditablePrebuiltField
                      key={field}
                      label={label}
                      value={prebuiltEdits[field]}
                      onChange={setPrebuiltField(field)}
                      id={`field-${field}`}
                      copiedKey={copiedKey}
                      onCopy={copy}
                    />
                  ))}
                </div>

                {/* Note about own brain still being saved */}
                <div className="px-5 pb-5">
                  <p className="text-[11px] text-white/25 leading-relaxed">
                    This pre-built brain is preserved and you can switch back any time with "Use My Own Brain". Your own brain data below is still saved.
                  </p>
                </div>
              </div>
            )}

            {/* Generated Brain full text */}
            {generatedText && (
              <div className="rounded-xl border border-[#C9A44C]/20 bg-white/[0.02] overflow-hidden">
                <div
                  onClick={() => setShowGenerated(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[13px] font-semibold text-white">Generated Brain</span>
                    <span className="text-[11px] text-white/30">— powers all OS tools</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <CopyButton text={generatedText} id="generated-brain-copy" copiedKey={copiedKey} onCopy={copy} />
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors"
                    >
                      <Download className="w-3 h-3" />Download
                    </button>
                    <span onClick={() => setShowGenerated(v => !v)}>
                      {showGenerated ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                    </span>
                  </div>
                </div>
                {showGenerated && (
                  <div className="border-t border-white/[0.06]">
                    <textarea
                      readOnly
                      value={generatedText}
                      className="w-full px-5 py-4 bg-transparent text-[12.5px] text-white/65 leading-relaxed font-mono resize-none focus:outline-none cursor-text"
                      style={{ minHeight: "400px" }}
                      onClick={e => (e.target as HTMLTextAreaElement).select()}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Activate button */}
            <div className="flex">
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isReady ? "Refresh Brain Selection" : "Activate This Brain"}
              </button>
            </div>
          </div>
        )}

        {/* ── Own Brain Form ─────────────────────────────────────────────── */}
        {brainMode === "own" && (
          <>
            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2 mb-6">
              {dirty && (
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white text-[13px] font-medium transition-colors border border-white/[0.08]"
                >
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Profile
                </button>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={isGenerating || generateMutation.isPending}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isReady ? "Regenerate Brain" : "Generate Brain"}
              </button>
            </div>

            {/* Single-column form */}
            <div className="space-y-5">

              {/* About You */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">About You & Your Business</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Your Name" value={name} onChange={v => mark(() => setName(v))} placeholder="e.g. Alex Morgan" />
                  <Field label="Company Name" value={companyName} onChange={v => mark(() => setCompanyName(v))} placeholder="e.g. Northwind Studio" />
                </div>
                <Field
                  label="Who Do You Help?"
                  value={whoDoYouHelp}
                  onChange={v => mark(() => setWhoDoYouHelp(v))}
                  placeholder="e.g. Course creators and consultants doing $10K to $30K per month who want predictable client acquisition without burning out on manual outreach"
                  multiline
                />
                <Field
                  label="How Do You Help Them?"
                  value={howDoYouHelpThem}
                  onChange={v => mark(() => setHowDoYouHelpThem(v))}
                  placeholder="e.g. I install a complete low-ticket funnel that turns small first purchases into qualified high-ticket calls inside 30 days, no paid traffic required"
                  multiline
                />
                <Field
                  label="Your Key Achievements / Results"
                  value={keyAchievements}
                  onChange={v => mark(() => setKeyAchievements(v))}
                  placeholder="e.g. $80K per month in recurring revenue, 1,200 paying students, systems running inside 60 plus coaching businesses"
                  multiline
                />
              </div>

              {/* Online Presence */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Your Online Presence</h2>
                <Field label="Website" value={website} onChange={v => mark(() => setWebsite(v))} placeholder="https://yourwebsite.com" />
                <TagInput label="Landing Pages" values={landingPages} onChange={v => { setLandingPages(v); setDirty(true); }} placeholder="https://yourdomain.com/landing-page" />
                <TagInput label="Social Media Profiles" values={socialProfiles} onChange={v => { setSocialProfiles(v); setDirty(true); }} placeholder="https://youtube.com/@yourchannel" />
              </div>

              {/* Brand Colours */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Brand Colours</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Primary Colour", value: brandColorPrimary, set: setBrandColorPrimary, placeholder: "#C9A44C" },
                    { label: "Secondary Colour", value: brandColorSecondary, set: setBrandColorSecondary, placeholder: "#ffffff" },
                  ].map(({ label, value, set, placeholder }) => (
                    <div key={label}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{label}</p>
                      <div className="flex items-center gap-2">
                        <input type="color" value={value || placeholder} onChange={e => mark(() => set(e.target.value))}
                          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/[0.08]" />
                        <input value={value} onChange={e => mark(() => set(e.target.value))} placeholder={placeholder}
                          className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Confirmed Offers */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Your Confirmed Offers</h2>
                <p className="text-white/40 text-[12px] -mt-2">OS tools use these to generate personalised output.</p>
                <Field
                  label="Low-Ticket Offer"
                  value={confirmedLowTicketOffer}
                  onChange={v => mark(() => setConfirmedLowTicketOffer(v))}
                  placeholder="e.g. AI Influencer OS — $47. Includes: 3-day build system, 10 AI script templates, ad blueprint"
                  multiline
                />
                <Field
                  label="Premium / High-Ticket Offer"
                  value={confirmedPremiumOffer}
                  onChange={v => mark(() => setConfirmedPremiumOffer(v))}
                  placeholder="e.g. Done-With-You Accelerator — $15,000. 90 days 1-1 coaching + full funnel build"
                  multiline
                />
                <Field
                  label="$100K+ Offer"
                  value={confirmed100kOffer}
                  onChange={v => mark(() => setConfirmed100kOffer(v))}
                  placeholder="e.g. 3-day Portugal retreat — $250,000. In-person strategy + 12 months consulting"
                  multiline
                />
              </div>
            </div>

            {/* Generated Brain — own mode */}
            {isReady && generatedText && (
              <div className="mt-6 rounded-xl border border-[#C9A44C]/20 bg-white/[0.02] overflow-hidden">
                <div
                  onClick={() => setShowGenerated(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[13px] font-semibold text-white">Your Generated Brain</span>
                    <span className="text-[11px] text-white/30">— powers all OS tools</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <CopyButton text={generatedText} id="own-brain-copy" copiedKey={copiedKey} onCopy={copy} />
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors"
                    >
                      <Download className="w-3 h-3" />Download
                    </button>
                    <span onClick={() => setShowGenerated(v => !v)}>
                      {showGenerated ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                    </span>
                  </div>
                </div>
                {showGenerated && (
                  <div className="border-t border-white/[0.06]">
                    <textarea
                      readOnly
                      value={generatedText}
                      className="w-full px-5 py-4 bg-transparent text-[12.5px] text-white/65 leading-relaxed font-mono resize-none focus:outline-none cursor-text"
                      style={{ minHeight: "400px" }}
                      onClick={e => (e.target as HTMLTextAreaElement).select()}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Save / Generate footer */}
            <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-3">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !dirty}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white text-[13px] font-medium transition-colors border border-white/[0.08] disabled:opacity-40"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Profile
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={isGenerating || generateMutation.isPending}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isReady ? "Regenerate Brain" : "Generate Brain"}
              </button>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
