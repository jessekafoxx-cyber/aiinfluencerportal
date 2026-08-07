import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { Film, ExternalLink, Check, Pencil, X, Sparkles, Loader2, Brain, Edit3, FileText, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Link } from "wouter";

type TemplateRow = {
  slug: string;
  title: string;
  isBonus?: boolean;
  // Backend OS_TOOL_PROMPTS slug for the AI script writer.
  aiSlug: string;
  // Realistic time estimate copy shown to the user.
  estimate: string;
  // Whether this template emits a slide deck on top of the script.
  hasSlides: boolean;
};

const TEMPLATES: TemplateRow[] = [
  { slug: "bonus-data-driven", title: "BONUS: 10-Minute Data Driven VSL", isBonus: true, aiSlug: "vsl-template-bonus-data-driven", estimate: "About 4 to 6 minutes", hasSlides: true },
  { slug: "fast-paced-hook", title: "VSL 1: The Fast Paced Hook Edit + Whiteboard Share", aiSlug: "vsl-template-fast-paced-hook", estimate: "About 1 to 2 minutes", hasSlides: false },
  { slug: "harmozi-alan", title: "VSL 2: The Harmozi 'Alan' Style", aiSlug: "vsl-template-harmozi-alan", estimate: "About 4 to 6 minutes", hasSlides: true },
  { slug: "power-punch", title: "VSL 3: 4 Minute Power Punch VSL", aiSlug: "vsl-template-power-punch", estimate: "About 3 to 4 minutes", hasSlides: true },
  { slug: "mini-webinar", title: "VSL 4: The Mini Webinar", aiSlug: "vsl-template-mini-webinar", estimate: "About 4 to 6 minutes", hasSlides: true },
  { slug: "60-minute", title: "VSL 5: The 60 Minute VSL", aiSlug: "vsl-template-60-minute", estimate: "About 8 to 15 minutes (long form)", hasSlides: true },
];

const WISTIA_MEDIA_ID = "xqucwlyhbe";

function ensureWistiaScripts() {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!document.querySelector('script[data-wistia-player="true"]')) {
    const s = document.createElement("script");
    s.src = "https://fast.wistia.com/player.js";
    s.async = true;
    s.setAttribute("data-wistia-player", "true");
    head.appendChild(s);
  }
  const mediaSrc = `https://fast.wistia.com/embed/${WISTIA_MEDIA_ID}.js`;
  if (!document.querySelector(`script[src="${mediaSrc}"]`)) {
    const s = document.createElement("script");
    s.src = mediaSrc;
    s.async = true;
    s.type = "module";
    head.appendChild(s);
  }
}

function VslHeaderVideo() {
  useEffect(() => {
    ensureWistiaScripts();
  }, []);

  return (
    <div className="mb-8 rounded-2xl overflow-hidden border border-white/[0.06] bg-[#050505]">
      <style>{`
        wistia-player[media-id='${WISTIA_MEDIA_ID}']:not(:defined) {
          background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${WISTIA_MEDIA_ID}/swatch');
          display: block;
          filter: blur(5px);
          padding-top: 56.25%;
        }
      `}</style>
      <div
        dangerouslySetInnerHTML={{
          __html: `<wistia-player media-id="${WISTIA_MEDIA_ID}" aspect="1.7777777777777777"></wistia-player>`,
        }}
      />
    </div>
  );
}

function AdminLinkEditor({
  slug,
  currentUrl,
  onSaved,
}: {
  slug: string;
  currentUrl: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentUrl || "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(currentUrl || "");
  }, [currentUrl, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = draft.trim();
      return api.setVslTemplateLink(slug, trimmed.length > 0 ? trimmed : null);
    },
    onSuccess: () => {
      setError(null);
      setEditing(false);
      onSaved();
    },
    onError: (err: any) => setError(err?.message || "Save failed"),
  });

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-white/55 hover:text-white/85 text-[10.5px] font-bold uppercase tracking-wider transition-colors"
        title="Edit link (admin only)"
      >
        <Pencil className="w-3 h-3" />
        Edit Link
      </button>
    );
  }

  return (
    <div className="w-full mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://..."
          autoFocus
          className="flex-1 min-w-0 bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none"
        />
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#C9A44C]/20 hover:bg-[#C9A44C]/30 text-[#C9A44C] text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {mutation.isPending ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); setDraft(currentUrl || ""); }}
          className="inline-flex items-center gap-1.5 px-2 py-2 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-white/55 text-[11px] font-bold uppercase tracking-wider transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {error && (
        <p className="text-[11.5px] text-red-300">{error}</p>
      )}
      <p className="text-[10.5px] text-white/35">
        Leave blank and save to clear the link (shows "coming soon" again).
      </p>
    </div>
  );
}

// =============================================================================
// TemplateGenerator
// Per-card AI script + slide generator. Hooks into the existing OS tool
// generation pipeline (osToolGenerationJobsTable, runOsToolGenerationJob,
// /os-tools/:slug/generate routes). Lets the user pick between their saved
// brain offer and a one-off custom offer, kicks off a background job, polls
// it, surfaces the saved-versions list, and links to the existing
// /os-tool/:slug viewer for the actual output.
// =============================================================================

type OfferSource = "brain" | "custom";

function TemplateGenerator({
  template,
  hasBrainOffer,
}: {
  template: TemplateRow;
  hasBrainOffer: boolean;
}) {
  const qc = useQueryClient();
  const aiSlug = template.aiSlug;

  const [open, setOpen] = useState(false);
  const [offerSource, setOfferSource] = useState<OfferSource>(
    hasBrainOffer ? "brain" : "custom"
  );
  const [customOfferName, setCustomOfferName] = useState("");
  const [customOfferAudience, setCustomOfferAudience] = useState("");
  const [customOfferPromise, setCustomOfferPromise] = useState("");
  const [customOfferPrice, setCustomOfferPrice] = useState("");
  const [customOfferMechanism, setCustomOfferMechanism] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Active job: backend exposes the most-recent in-progress job for this slug
  // for this user, so refresh / new-tab / close-and-come-back all keep the
  // user pointed at their generation. We poll while it's running.
  const activeJobQuery = useQuery({
    queryKey: ["vsl-template-active-job", aiSlug],
    queryFn: () => api.getActiveOSToolGenerationJob(aiSlug),
    enabled: open,
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.job?.status;
      return status === "pending" || status === "processing" ? 2500 : false;
    },
    refetchOnWindowFocus: false,
  });
  const activeJob = activeJobQuery.data?.job || null;
  const isWorking = activeJob && (activeJob.status === "pending" || activeJob.status === "processing");

  // Saved versions (multi-save up to 4): we link each row to /os-tool/:slug
  // which already knows how to render the saved version selector.
  const savedListQuery = useQuery({
    queryKey: ["vsl-template-saved-list", aiSlug],
    queryFn: () => api.getOSToolSavedList(aiSlug),
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const savedAssets = savedListQuery.data?.assets || [];

  // Pricing / quota copy under the button.
  const quotaQuery = useQuery({
    queryKey: ["vsl-template-quota", aiSlug],
    queryFn: () => api.getOSToolGenerationQuota(aiSlug),
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const quota = quotaQuery.data;

  const generateMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const answers: Record<string, string> = {
        _offerSource: offerSource,
      };
      if (offerSource === "custom") {
        if (!customOfferName.trim() || !customOfferPromise.trim()) {
          throw new Error("Please fill in at least the offer name and the promise.");
        }
        answers.customOfferName = customOfferName.trim();
        answers.customOfferAudience = customOfferAudience.trim();
        answers.customOfferPromise = customOfferPromise.trim();
        answers.customOfferPrice = customOfferPrice.trim();
        answers.customOfferMechanism = customOfferMechanism.trim();
      }
      const result = await api.generateOSToolRaw(aiSlug, answers);
      if (!result.ok) {
        const body = result.body as any;
        if (result.status === 402 && body?.error === "needs_credit") {
          throw new Error("You're out of free generations for this template. Top up credits to continue.");
        }
        throw new Error(body?.message || body?.error || "Generation failed to start.");
      }
      return result.body as { jobId: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vsl-template-active-job", aiSlug] });
      qc.invalidateQueries({ queryKey: ["vsl-template-quota", aiSlug] });
    },
    onError: (err: any) => setError(err?.message || "Could not start generation."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetId: number) => api.deleteOSToolSavedAsset(aiSlug, assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vsl-template-saved-list", aiSlug] }),
  });

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gradient-to-r from-[#7c3aed]/15 to-[#ec4899]/10 hover:from-[#7c3aed]/25 hover:to-[#ec4899]/15 border border-[#7c3aed]/25 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-[#a78bfa] shrink-0" />
          <span className="text-[12.5px] font-bold uppercase tracking-wider text-white">
            AI Script Writer
          </span>
          <span className="text-[10.5px] text-white/45 normal-case font-normal tracking-normal hidden sm:inline">
            Rewrite this template around your offer
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-white/55" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/55" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4 px-1">
          {/* Offer source toggle */}
          <div>
            <p className="text-[10.5px] text-white/45 font-bold uppercase tracking-[0.12em] mb-2">
              Which offer should the script sell?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOfferSource("brain")}
                disabled={!hasBrainOffer}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: offerSource === "brain" ? "rgba(201,164,76,0.12)" : "rgba(255,255,255,0.02)",
                  borderColor: offerSource === "brain" ? "rgba(201,164,76,0.45)" : "rgba(255,255,255,0.08)",
                }}
              >
                <Brain className="w-3.5 h-3.5 shrink-0" style={{ color: offerSource === "brain" ? "#C9A44C" : "rgba(255,255,255,0.45)" }} />
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white">Use my brain offer</p>
                  <p className="text-[10.5px] text-white/45 leading-tight">
                    {hasBrainOffer ? "Pulls your saved low-ticket offer." : "Build your low-ticket offer first."}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setOfferSource("custom")}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors"
                style={{
                  background: offerSource === "custom" ? "rgba(124,58,237,0.14)" : "rgba(255,255,255,0.02)",
                  borderColor: offerSource === "custom" ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.08)",
                }}
              >
                <Edit3 className="w-3.5 h-3.5 shrink-0" style={{ color: offerSource === "custom" ? "#a78bfa" : "rgba(255,255,255,0.45)" }} />
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white">Write for a new offer</p>
                  <p className="text-[10.5px] text-white/45 leading-tight">
                    Type the offer details below.
                  </p>
                </div>
              </button>
            </div>
            {!hasBrainOffer && offerSource === "brain" && (
              <p className="mt-2 text-[11px] text-white/55">
                You don't have a saved low-ticket offer yet.{" "}
                <Link href="/os-tool/low-ticket-offer-build">
                  <a className="text-[#C9A44C] underline">Build one</a>
                </Link>
                {" "}or pick "write for a new offer".
              </p>
            )}
          </div>

          {/* Custom offer fields */}
          {offerSource === "custom" && (
            <div className="space-y-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] p-3">
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-white/55 mb-1">
                  Offer / system name
                </label>
                <input
                  type="text"
                  value={customOfferName}
                  onChange={(e) => setCustomOfferName(e.target.value)}
                  placeholder="e.g. The Founder Pipeline System"
                  className="w-full bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-white/55 mb-1">
                  Who it's for
                </label>
                <input
                  type="text"
                  value={customOfferAudience}
                  onChange={(e) => setCustomOfferAudience(e.target.value)}
                  placeholder="e.g. B2B founders doing $50k-$500k MRR"
                  className="w-full bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-white/55 mb-1">
                  The promise / outcome
                </label>
                <textarea
                  value={customOfferPromise}
                  onChange={(e) => setCustomOfferPromise(e.target.value)}
                  placeholder="e.g. Add an extra $30k MRR in 90 days without hiring"
                  rows={2}
                  className="w-full bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-white/55 mb-1">
                    Price
                  </label>
                  <input
                    type="text"
                    value={customOfferPrice}
                    onChange={(e) => setCustomOfferPrice(e.target.value)}
                    placeholder="e.g. $97 or $4,800"
                    className="w-full bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-white/55 mb-1">
                  Mechanism (the steps / how it works)
                </label>
                <textarea
                  value={customOfferMechanism}
                  onChange={(e) => setCustomOfferMechanism(e.target.value)}
                  placeholder="e.g. Step 1 build the asset. Step 2 launch the funnel. Step 3 optimize with paid ads."
                  rows={3}
                  className="w-full bg-[#050505] border border-white/[0.10] focus:border-[#C9A44C]/50 rounded-md px-3 py-2 text-[12.5px] text-white placeholder-white/25 outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Active job state */}
          {isWorking && activeJob && (
            <div className="rounded-lg border border-[#7c3aed]/30 bg-[#7c3aed]/[0.08] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#a78bfa]" />
                <p className="text-[12.5px] font-bold text-white">
                  {activeJob.label || "Writing your script"}
                </p>
              </div>
              <p className="text-[11.5px] text-white/55 leading-snug">
                {template.estimate}. You can close this tab and come back. Your generation runs in the background and will be saved automatically.
              </p>
              <Link href={`/os-tool/${aiSlug}`}>
                <a className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-bold uppercase tracking-wider text-[#a78bfa] hover:text-[#c4b5fd]">
                  <ExternalLink className="w-3 h-3" />
                  Watch progress
                </a>
              </Link>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-[11.5px] text-red-300 bg-red-500/[0.06] border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {/* Generate button */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={
                !!isWorking ||
                generateMutation.isPending ||
                (offerSource === "brain" && !hasBrainOffer)
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-bold uppercase tracking-wider text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)",
              }}
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Starting
                </>
              ) : isWorking ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Already running
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate {template.hasSlides ? "script + slides" : "script"}
                </>
              )}
            </button>
            <p className="text-[10.5px] text-white/45 leading-snug">
              {template.estimate}
              {quota && !quota.unlimited && (
                <>
                  {" "}·{" "}
                  {quota.freeRemaining > 0
                    ? `${quota.freeRemaining} free left`
                    : `${quota.creditCost} credits per run · ${quota.balance} on hand`}
                </>
              )}
            </p>
          </div>

          {/* Saved versions list */}
          {savedAssets.length > 0 && (
            <div className="pt-3 border-t border-white/[0.06]">
              <p className="text-[10.5px] text-white/45 font-bold uppercase tracking-[0.12em] mb-2">
                Saved versions ({savedAssets.length}/4)
              </p>
              <div className="space-y-1.5">
                {savedAssets.map((asset: any) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-white/[0.02] border border-white/[0.05]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-[#C9A44C] shrink-0" />
                      <p className="text-[12px] text-white truncate">
                        {asset.title || "Untitled version"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link href={`/os-tool/${aiSlug}?asset=${asset.id}`}>
                        <a className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-bold uppercase tracking-wider text-[#C9A44C] hover:bg-[#C9A44C]/10">
                          <ExternalLink className="w-3 h-3" />
                          Open
                        </a>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Delete this saved version?")) {
                            deleteMutation.mutate(asset.id);
                          }
                        }}
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-white/40 hover:text-red-300 hover:bg-red-500/10"
                        title="Delete this version"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VslTemplates() {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = (me?.user as any)?.role === "admin";
  const paid = !!(me?.user as any)?.bump1Paid || isAdmin;

  const linksQuery = useQuery({
    queryKey: ["vsl-template-links"],
    queryFn: api.getVslTemplateLinks,
    enabled: paid,
    refetchOnWindowFocus: false,
  });
  const links = linksQuery.data?.links || {};

  // Used by every TemplateGenerator to decide whether the brain-offer toggle
  // is selectable. We only need to know if the user has at least one saved
  // low-ticket-build asset; the generator itself doesn't render its content.
  const brainOfferQuery = useQuery({
    queryKey: ["vsl-template-brain-offer"],
    queryFn: () => api.getOSToolSavedList("low-ticket-offer-build"),
    enabled: paid,
    refetchOnWindowFocus: false,
  });
  const hasBrainOffer = (brainOfferQuery.data?.assets?.length || 0) > 0;

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Premium Add-On
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            VSL Templates Pack
          </h1>
          <p className="text-[14px] text-white/55 mt-2">
            5 plug-and-play VSL templates plus a bonus 10-Minute Data Driven VSL. Includes The Harmozi 'Alan' Style.
          </p>
        </div>

        <VslHeaderVideo />

        {meLoading ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : !paid ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <p className="text-[14px] text-white/60">
              You don't have access to this add-on yet. Use the sidebar to unlock it.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
            {TEMPLATES.map((template) => {
              const { slug, title } = template;
              const url = links[slug] || null;
              const ready = !!url;
              return (
                <div
                  key={slug}
                  className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-[#C9A44C]/15 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-[#C9A44C]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-white">{title}</p>
                        <p className="text-[11px] text-white/50">
                          Template, ready to swipe.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {ready ? (
                        <a
                          href={url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#C9A44C] hover:bg-[#D9B45C] text-black text-[12px] font-bold uppercase tracking-wider transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Template
                        </a>
                      ) : isAdmin ? (
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/35">
                          No link saved
                        </span>
                      ) : null}
                      {isAdmin && (
                        <AdminLinkEditor
                          slug={slug}
                          currentUrl={url}
                          onSaved={() => qc.invalidateQueries({ queryKey: ["vsl-template-links"] })}
                        />
                      )}
                    </div>
                  </div>
                  <TemplateGenerator template={template} hasBrainOffer={hasBrainOffer} />
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
