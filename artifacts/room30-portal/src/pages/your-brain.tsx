import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Save, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Plus, X, ChevronDown, ChevronUp, RefreshCw, ExternalLink,
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

  // Form state
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

  const profile = (data as any)?.profile ?? null;

  // Populate form when profile loads
  useEffect(() => {
    if (!profile) return;
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

  const saveMutation = useMutation({
    mutationFn: () => api.saveBrainProfile({
      name, companyName, whoDoYouHelp, howDoYouHelpThem, keyAchievements,
      website, landingPages, socialProfiles,
      brandColorPrimary, brandColorSecondary,
      confirmedLowTicketOffer, confirmedPremiumOffer, confirmed100kOffer,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
      setDirty(false);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Save first, then generate
      await api.saveBrainProfile({
        name, companyName, whoDoYouHelp, howDoYouHelpThem, keyAchievements,
        website, landingPages, socialProfiles,
        brandColorPrimary, brandColorSecondary,
        confirmedLowTicketOffer, confirmedPremiumOffer, confirmed100kOffer,
      });
      return api.generateBrain();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brain-profile"] });
      setDirty(false);
    },
  });

  const status = profile?.status ?? "pending";
  const isGenerating = status === "generating" || generateMutation.isPending;
  const isReady = status === "generated";

  const mark = (fn: () => void) => { fn(); setDirty(true); };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-[#C9A44C]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white">Your Brain</h1>
                <p className="text-white/40 text-[12px] mt-0.5">Your AI profile — powers every OS tool</p>
              </div>
            </div>
            {/* Status badge — always visible top-right */}
            <span className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              isReady ? "bg-emerald-500/10 text-emerald-400" :
              isGenerating ? "bg-[#C9A44C]/10 text-[#C9A44C]" :
              status === "error" ? "bg-red-500/10 text-red-400" :
              "bg-white/[0.06] text-white/40"
            }`}>
              {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> :
               isReady ? <CheckCircle2 className="w-3 h-3" /> :
               status === "error" ? <AlertCircle className="w-3 h-3" /> : null}
              <span className="hidden sm:inline">{isGenerating ? "Generating…" : STATUS_LABELS[status] ?? status}</span>
              <span className="sm:hidden">{isReady ? "Ready" : isGenerating ? "…" : status === "error" ? "Error" : "Not set"}</span>
            </span>
          </div>
          {/* Action buttons — full width on mobile, row on sm+ */}
          <div className="flex flex-col sm:flex-row gap-2">
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
        </div>

        {status === "error" && profile?.errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
            <AlertCircle className="w-4 h-4 inline mr-2" />
            {profile.errorMessage}
          </div>
        )}

        {isGenerating && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 text-[#C9A44C] text-[13px] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Your Brain is being generated. This takes 30–90 seconds. You can leave this page and come back.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Profile Info */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Profile</h2>
            <Field label="Your Name" value={name} onChange={v => mark(() => setName(v))} placeholder="e.g. Greg Cooke" />
            <Field label="Company / Brand Name" value={companyName} onChange={v => mark(() => setCompanyName(v))} placeholder="e.g. AI Influencer Portfolio" />
            <Field label="Who Do You Help?" value={whoDoYouHelp} onChange={v => mark(() => setWhoDoYouHelp(v))} placeholder="e.g. coaches, consultants, and online business owners" multiline />
            <Field label="How Do You Help Them?" value={howDoYouHelpThem} onChange={v => mark(() => setHowDoYouHelpThem(v))} placeholder="e.g. build low-ticket acquisition systems using AI influencers" multiline />
            <Field label="Key Achievements & Proof" value={keyAchievements} onChange={v => mark(() => setKeyAchievements(v))} placeholder="e.g. $724K/month, 3,000+ clients, 2.1M followers across portfolio" multiline />
          </div>

          {/* URLs */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Online Presence</h2>
            <Field label="Main Website" value={website} onChange={v => mark(() => setWebsite(v))} placeholder="https://yourwebsite.com" />
            <TagInput label="Landing Pages / Sales Pages" values={landingPages} onChange={v => { setLandingPages(v); setDirty(true); }} placeholder="Paste URL and press Enter" />
            <TagInput label="Social Profiles" values={socialProfiles} onChange={v => { setSocialProfiles(v); setDirty(true); }} placeholder="e.g. https://instagram.com/yourhandle" />
          </div>

          {/* Brand Colors */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">Brand Colours</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">Primary Colour</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColorPrimary || "#C9A44C"}
                    onChange={e => mark(() => setBrandColorPrimary(e.target.value))}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/[0.08]"
                  />
                  <input
                    value={brandColorPrimary}
                    onChange={e => mark(() => setBrandColorPrimary(e.target.value))}
                    placeholder="#C9A44C"
                    className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">Secondary Colour</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColorSecondary || "#ffffff"}
                    onChange={e => mark(() => setBrandColorSecondary(e.target.value))}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/[0.08]"
                  />
                  <input
                    value={brandColorSecondary}
                    onChange={e => mark(() => setBrandColorSecondary(e.target.value))}
                    placeholder="#ffffff"
                    className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/25 focus:outline-none focus:border-[#C9A44C]/40"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Offers */}
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

        {/* Generated Brain Output */}
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
              {showGenerated ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
            </button>
            {showGenerated && (
              <div
                className="px-6 pb-6 prose-brain border-t border-white/[0.06]"
                style={{ paddingTop: "20px" }}
              >
                <style>{`
                  .prose-brain h2 { font-size: 13px; font-weight: 700; color: #C9A44C; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 8px; }
                  .prose-brain h3 { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); margin: 14px 0 6px; }
                  .prose-brain p { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.6; margin: 6px 0; }
                  .prose-brain ul { padding-left: 18px; margin: 6px 0; }
                  .prose-brain li { font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; margin: 3px 0; }
                  .prose-brain strong { color: rgba(255,255,255,0.85); font-weight: 600; }
                `}</style>
                <div dangerouslySetInnerHTML={{ __html: profile.generatedBrain }} />
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
      </div>
    </PortalLayout>
  );
}
