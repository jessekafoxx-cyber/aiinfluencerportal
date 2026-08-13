import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Save, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Plus, X, ChevronDown, ChevronUp, Download,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";

const POLL_MS = 3000;

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

function Field({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const cls = "w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40 resize-none";
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{label}</label>
      {multiline
        ? <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
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

  // Brain mode
  const [brainMode, setBrainMode] = useState<"own" | "prebuilt">("own");
  const [selectedPrebuiltId, setSelectedPrebuiltId] = useState<string | null>(null);

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
        // Prebuilt brains are instantly ready — just save the selection
        return api.saveBrainProfile(buildSavePayload());
      }
      // Own brain: save first, then kick off AI generation
      await api.saveBrainProfile(buildSavePayload());
      return api.generateBrain();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
      setDirty(false);
    },
  });

  // When user switches brain mode, mark dirty so save buttons appear
  const switchMode = (mode: "own" | "prebuilt", prebuiltId?: string) => {
    setBrainMode(mode);
    if (prebuiltId) setSelectedPrebuiltId(prebuiltId);
    setDirty(true);
  };

  const status = profile?.status ?? "pending";
  const isGenerating = status === "generating" || generateMutation.isPending;
  // Prebuilt brains are immediately "ready" once selected
  const isReady = status === "generated" || (brainMode === "prebuilt" && !!selectedPrebuiltId);

  const mark = (fn: () => void) => { fn(); setDirty(true); };

  // Determine the generated brain content to show
  const generatedBrainHtml = brainMode === "prebuilt" && prebuiltBrainDetail?.generatedBrain
    ? prebuiltBrainDetail.generatedBrain
    : profile?.generatedBrain;

  const handleDownload = () => {
    const html = generatedBrainHtml || "";
    const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Your Brain</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a}h2{font-size:18px;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #C9A44C;padding-bottom:6px}h3{font-size:15px;font-weight:600;margin:16px 0 8px}p{line-height:1.7;margin:8px 0}ul,ol{padding-left:24px;margin:8px 0}li{line-height:1.7;margin:3px 0}</style></head><body>${html}</body></html>`], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "your-brain.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 mb-2">
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
              <span className="hidden sm:inline">{isReady ? "Brain Active" : isGenerating ? "Generating…" : STATUS_LABELS[status] ?? status}</span>
              <span className="sm:hidden">{isReady ? "Active" : isGenerating ? "…" : "Not set"}</span>
            </span>
          </div>
        </div>

        {status === "error" && profile?.errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
            <AlertCircle className="w-4 h-4 inline mr-2" />{profile.errorMessage}
          </div>
        )}

        {isGenerating && brainMode === "own" && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 text-[#C9A44C] text-[13px] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Your Brain is being generated. This takes 30–90 seconds. You can leave this page and come back.
          </div>
        )}

        {/* ── Choose Your Brain ──────────────────────────────────────── */}
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    brainMode === "own" ? "border-[#C9A44C]" : "border-white/20"
                  }`}>
                    {brainMode === "own" && <div className="w-2 h-2 rounded-full bg-[#C9A44C]" />}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-white">Use My Own Brain</p>
                    <p className="text-[11px] text-white/40 mt-0.5">Fill in the form below and we generate your brain from your own positioning.</p>
                  </div>
                </div>
                {brainMode === "own" && <CheckCircle2 className="w-4 h-4 text-[#C9A44C] flex-shrink-0" />}
              </div>
            </button>

            {/* Prebuilt brains */}
            {prebuiltBrains.filter(b => !b.comingSoon).map(brain => (
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
                    {brain.highlights.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {brain.highlights.map((h, i) => (
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

          {/* Save Brain Choice button */}
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

        {/* ── Prebuilt Brain Preview ──────────────────────────────────── */}
        {brainMode === "prebuilt" && selectedPrebuiltId && (
          <div className="mb-8 space-y-6">
            {/* PRE-BUILT BRAIN data display */}
            {prebuiltBrainDetail && (
              <div className="rounded-xl border border-[#C9A44C]/20 bg-white/[0.02]">
                <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A44C]/60">Pre-built Brain Data</p>
                    <p className="text-[13px] font-semibold text-white mt-0.5">{prebuiltBrainDetail.name}</p>
                  </div>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Brain Active
                  </span>
                </div>
                <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Name", value: prebuiltBrainDetail.brainData.name },
                    { label: "Company", value: prebuiltBrainDetail.brainData.companyName },
                    { label: "Who They Help", value: prebuiltBrainDetail.brainData.whoDoYouHelp },
                    { label: "How They Help", value: prebuiltBrainDetail.brainData.howDoYouHelpThem },
                    { label: "Key Results", value: prebuiltBrainDetail.brainData.keyAchievements },
                  ].map(({ label, value }) => (
                    <div key={label} className={label === "Who They Help" || label === "How They Help" || label === "Key Results" ? "sm:col-span-2" : ""}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30 mb-1">{label}</p>
                      <p className="text-[13px] text-white/70 leading-relaxed">{value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Brain Content */}
            {generatedBrainHtml && (
              <div className="rounded-xl border border-[#C9A44C]/20 bg-white/[0.02]">
                <button
                  onClick={() => setShowGenerated(v => !v)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[13px] font-semibold text-white">Generated Brain (Full)</span>
                    <span className="text-[11px] text-white/30">— powers all OS tools</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleDownload(); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors"
                    >
                      <Download className="w-3 h-3" />Download Whole Brain
                    </button>
                    {showGenerated ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                  </div>
                </button>
                {showGenerated && (
                  <div className="px-6 pb-6 prose-brain border-t border-white/[0.06]" style={{ paddingTop: "20px" }}>
                    <style>{`
                      .prose-brain h2 { font-size: 13px; font-weight: 700; color: #C9A44C; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 8px; }
                      .prose-brain h3 { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); margin: 14px 0 6px; }
                      .prose-brain p { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.6; margin: 6px 0; }
                      .prose-brain ul { padding-left: 18px; margin: 6px 0; }
                      .prose-brain li { font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; margin: 3px 0; }
                      .prose-brain strong { color: rgba(255,255,255,0.85); font-weight: 600; }
                    `}</style>
                    <div className="prose-brain" dangerouslySetInnerHTML={{ __html: generatedBrainHtml }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Own Brain Form ──────────────────────────────────────────── */}
        {brainMode === "own" && (
          <>
            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-2 mb-6">
              {dirty && (
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white text-[13px] sm:text-[12px] font-medium transition-colors border border-white/[0.08]"
                >
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Profile
                </button>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={isGenerating || generateMutation.isPending}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2 rounded-lg text-[13px] sm:text-[12px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isReady ? "Regenerate Brain" : "Generate Brain"}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* About You & Your Business */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">About You & Your Business</h2>
                <Field label="Your Name" value={name} onChange={v => mark(() => setName(v))} placeholder="e.g. Alex Morgan" />
                <Field label="Company Name" value={companyName} onChange={v => mark(() => setCompanyName(v))} placeholder="e.g. Northwind Studio" />
                <Field label="Who Do You Help?" value={whoDoYouHelp} onChange={v => mark(() => setWhoDoYouHelp(v))} placeholder="e.g. Course creators and consultants doing $10K to $30K per month who want predictable client acquisition without burning out on manual outreach" multiline />
                <Field label="How Do You Help Them?" value={howDoYouHelpThem} onChange={v => mark(() => setHowDoYouHelpThem(v))} placeholder="e.g. I install a complete low-ticket funnel that turns small first purchases into qualified high-ticket calls inside 30 days, no paid traffic required" multiline />
                <Field label="Your Key Achievements / Results" value={keyAchievements} onChange={v => mark(() => setKeyAchievements(v))} placeholder="e.g. $80K per month in recurring revenue, 1,200 paying students, systems running inside 60 plus coaching businesses" multiline />
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
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Primary", value: brandColorPrimary, set: setBrandColorPrimary, placeholder: "#C9A44C" },
                    { label: "Secondary", value: brandColorSecondary, set: setBrandColorSecondary, placeholder: "#ffffff" },
                  ].map(({ label, value, set, placeholder }) => (
                    <div key={label}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{label} Colour</p>
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
                <Field label="Low-Ticket Offer" value={confirmedLowTicketOffer} onChange={v => mark(() => setConfirmedLowTicketOffer(v))} placeholder="e.g. AI Influencer OS — $47. Includes: 3-day build system, 10 AI script templates, ad blueprint" multiline />
                <Field label="Premium / High-Ticket Offer" value={confirmedPremiumOffer} onChange={v => mark(() => setConfirmedPremiumOffer(v))} placeholder="e.g. Done-With-You Accelerator — $15,000. 90 days 1-1 coaching + full funnel build" multiline />
                <Field label="$100K+ Offer" value={confirmed100kOffer} onChange={v => mark(() => setConfirmed100kOffer(v))} placeholder="e.g. 3-day Portugal retreat — $250,000. In-person strategy + 12 months consulting" multiline />
              </div>
            </div>

            {/* Generated Brain Output (own brain) */}
            {isReady && profile?.generatedBrain && (
              <div className="mt-6 rounded-xl border border-[#C9A44C]/20 bg-white/[0.02]">
                <button
                  onClick={() => setShowGenerated(v => !v)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[13px] font-semibold text-white">Your Generated Brain</span>
                    <span className="text-[11px] text-white/30">— powers all OS tools</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); handleDownload(); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors">
                      <Download className="w-3 h-3" />Download Whole Brain
                    </button>
                    {showGenerated ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                  </div>
                </button>
                {showGenerated && (
                  <div className="px-6 pb-6 prose-brain border-t border-white/[0.06]" style={{ paddingTop: "20px" }}>
                    <style>{`
                      .prose-brain h2 { font-size: 13px; font-weight: 700; color: #C9A44C; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 8px; }
                      .prose-brain h3 { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); margin: 14px 0 6px; }
                      .prose-brain p { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.6; margin: 6px 0; }
                      .prose-brain ul { padding-left: 18px; margin: 6px 0; }
                      .prose-brain li { font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; margin: 3px 0; }
                      .prose-brain strong { color: rgba(255,255,255,0.85); font-weight: 600; }
                    `}</style>
                    <div className="prose-brain" dangerouslySetInnerHTML={{ __html: profile.generatedBrain }} />
                  </div>
                )}
              </div>
            )}

            {/* Save footer */}
            <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-3">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !dirty}
                className="flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white text-[13px] font-medium transition-colors border border-white/[0.08] disabled:opacity-40"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Profile
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={isGenerating || generateMutation.isPending}
                className="flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isReady ? "Regenerate Brain" : "Generate Brain"}
              </button>
            </div>
          </>
        )}

        {/* ── Prebuilt: action row ────────────────────────────────────── */}
        {brainMode === "prebuilt" && selectedPrebuiltId && (
          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isReady ? "Refresh Brain Selection" : "Activate This Brain"}
            </button>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
