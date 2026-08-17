import { useState } from "react";
import {
  Instagram, Users, Sparkles, Loader2, AlertCircle,
  Copy, Check, ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { fetchApi } from "@/lib/api";
import { useLocation } from "wouter";

const GOLD = "#C9A44C";

// ── Types ────────────────────────────────────────────────────────────────────

type Influencer = {
  id: number;
  name: string;
  customName?: string | null;
  niche?: string | null;
  avatarUrl?: string | null;
};

type PrebuiltBrain = {
  id: string;
  name: string;
  tagline: string;
  shortDescription?: string;
  comingSoon?: boolean;
};

type Bio = {
  pattern: string;
  patternName: string;
  lines: string[];
  rationale: string;
};

// ── Small components ─────────────────────────────────────────────────────────

function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5"
      style={{ background: `${GOLD}25`, color: GOLD }}
    >
      {n}
    </span>
  );
}

function SelectionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative w-full text-left rounded-xl border p-4 transition-all"
      style={{
        borderColor: selected ? GOLD : "rgba(255,255,255,0.1)",
        background: selected ? `${GOLD}12` : "rgba(255,255,255,0.03)",
      }}
    >
      {selected && (
        <span
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: GOLD }}
        >
          <Check className="w-3 h-3 text-black" strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  );
}

function BioCard({ bio, index }: { bio: Bio; index: number }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(index === 0);

  const fullText = bio.lines.join("\n");
  const totalChars = fullText.length;
  const over = totalChars > 150;

  const copy = () => {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: open ? `${GOLD}35` : "rgba(255,255,255,0.08)" }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{ background: `${GOLD}20`, color: GOLD }}
          >
            {bio.pattern || String.fromCharCode(64 + index + 1)}
          </span>
          <span className="text-[13px] font-semibold text-white text-left">
            {bio.patternName || `Variation ${index + 1}`}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              over ? "bg-red-500/15 text-red-400" : "bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {totalChars}/150
          </span>
          {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div
            className="rounded-xl p-4 mb-3"
            style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}20` }}
          >
            {bio.lines.map((line, i) => (
              <p key={i} className="text-[14px] text-white leading-snug py-0.5">{line}</p>
            ))}
          </div>
          {bio.rationale && (
            <p className="text-[11px] text-white/35 mb-3 italic">{bio.rationale}</p>
          )}
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-all"
            style={{
              background: copied ? "#10b98125" : `${GOLD}20`,
              color: copied ? "#10b981" : GOLD,
            }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy bio"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function IgBioGenerator() {
  const [, setLocation] = useLocation();

  // Selections
  const [influencerId, setInfluencerId] = useState<number | null>(null); // null = My main brand
  const [offerBrainId, setOfferBrainId] = useState<string>("own"); // "own" = My own Brain

  // Inputs
  const [igHandle, setIgHandle] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  // Generate state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bios, setBios] = useState<Bio[] | null>(null);

  // ── Data fetches ────────────────────────────────────────────────────────

  const { data: influencerData } = useQuery<{ influencers: Influencer[] }>({
    queryKey: ["my-influencers-picker"],
    queryFn: async () => {
      const res = await fetch("/api/influencers", { credentials: "include" });
      if (!res.ok) return { influencers: [] };
      return res.json();
    },
  });

  const { data: brainData } = useQuery<{ brains: PrebuiltBrain[] }>({
    queryKey: ["prebuilt-brains-picker"],
    queryFn: () => fetchApi("/brain/prebuilt"),
  });

  const influencers = influencerData?.influencers ?? [];
  const prebuiltBrains = (brainData?.brains ?? []).filter(b => !b.comingSoon);

  // ── Generate ────────────────────────────────────────────────────────────

  const generate = async () => {
    setLoading(true);
    setError(null);
    setBios(null);
    try {
      const data = await fetchApi("/ig-bio-generator", {
        method: "POST",
        body: JSON.stringify({
          influencerId: influencerId ?? null,
          offerBrainId: offerBrainId === "own" ? null : offerBrainId,
          igHandle: igHandle.trim().replace(/^@+/, "") || null,
          extraNotes: extraNotes.trim() || null,
        }),
      });
      if (!data?.bios?.length) throw new Error("No bios returned — please try again.");
      setBios(data.bios);
    } catch (e: any) {
      setError(e?.message || "Failed to generate bios. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>

        {/* Back button */}
        <button
          onClick={() => setLocation(-1 as any)}
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Setting Up Social Media Accounts
        </button>

        {/* Header */}
        <div className="mb-8">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2"
            style={{ color: GOLD }}
          >
            Phase 4 — Creating Content
          </p>
          <h1 className="text-3xl font-black text-white mb-3 uppercase tracking-tight">
            Instagram Bio Generator
          </h1>
          <p className="text-[14px] text-white/50 max-w-2xl leading-relaxed">
            Pick the AI Influencer this profile belongs to, then pick the offer it should sell.
            We'll write 5 scroll-stopping Instagram bios using 5 proven 3–4 line frameworks —
            one-click copy with line breaks ready for your profile.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-5 space-y-8">

          {/* Step 1 — Influencer */}
          <div>
            <div className="flex items-start gap-3 mb-4">
              <StepBadge n={1} />
              <div>
                <p className="text-[14px] font-semibold text-white leading-tight">
                  Which AI influencer is this bio for?
                  <span className="text-white/35 font-normal ml-2 text-[12px]">(optional)</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* My main brand */}
              <SelectionCard
                selected={influencerId === null}
                onClick={() => setInfluencerId(null)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${GOLD}20` }}
                  >
                    <Users className="w-4 h-4" style={{ color: GOLD }} />
                  </div>
                  <span className="text-[13px] font-semibold text-white">My main brand</span>
                </div>
                <p className="text-[11px] text-white/35 leading-snug">
                  No specific influencer — bio for the owner's main profile
                </p>
              </SelectionCard>

              {/* User's influencers */}
              {influencers.map(inf => (
                <SelectionCard
                  key={inf.id}
                  selected={influencerId === inf.id}
                  onClick={() => setInfluencerId(inf.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {inf.avatarUrl ? (
                      <img
                        src={inf.avatarUrl}
                        alt={inf.name}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white/60"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      >
                        {(inf.customName || inf.name).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-[13px] font-semibold text-white truncate">
                      {inf.customName || inf.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/35 truncate">
                    {inf.niche || "no niche set"}
                  </p>
                </SelectionCard>
              ))}
            </div>
          </div>

          {/* Step 2 — Offer */}
          <div>
            <div className="flex items-start gap-3 mb-4">
              <StepBadge n={2} />
              <p className="text-[14px] font-semibold text-white leading-tight">
                Which offer is this bio promoting?
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* My own Brain */}
              <SelectionCard
                selected={offerBrainId === "own"}
                onClick={() => setOfferBrainId("own")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🧠</span>
                  <span className="text-[13px] font-semibold text-white">My own Brain</span>
                </div>
                <p className="text-[11px] text-white/35 leading-snug">
                  Sell my own offer / positioning from Your Brain
                </p>
              </SelectionCard>

              {/* Prebuilt brains */}
              {prebuiltBrains.map(brain => (
                <SelectionCard
                  key={brain.id}
                  selected={offerBrainId === brain.id}
                  onClick={() => setOfferBrainId(brain.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">✨</span>
                    <span className="text-[13px] font-semibold text-white leading-tight">
                      {brain.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/35 leading-snug">
                    {brain.tagline || brain.shortDescription || ""}
                  </p>
                </SelectionCard>
              ))}
            </div>
          </div>

          {/* Handle */}
          <div>
            <label className="block text-[13px] font-medium text-white/70 mb-2">
              Instagram handle for this profile{" "}
              <span className="text-white/35 font-normal">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 text-[13px] select-none flex items-center gap-1.5">
                <Instagram className="w-4 h-4" />
                @
              </span>
              <input
                value={igHandle}
                onChange={e => setIgHandle(e.target.value.replace(/^@+/, ""))}
                placeholder="yourhandle"
                maxLength={65}
                className="w-full pl-14 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-white/20"
              />
            </div>
          </div>

          {/* Extra notes */}
          <div>
            <label className="block text-[13px] font-medium text-white/70 mb-2">
              Anything else?{" "}
              <span className="text-white/35 font-normal">
                (optional — tone, vibe, specific proof point you want featured)
              </span>
            </label>
            <textarea
              rows={3}
              value={extraNotes}
              onChange={e => setExtraNotes(e.target.value.slice(0, 600))}
              placeholder="e.g. lean into the faceless angle, mention the $57K/day proof, keep it dry and confident"
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-white/20 resize-none"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-white/25">{extraNotes.length}/600</span>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-[13px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: GOLD, color: "#000" }}
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {loading ? "Writing your bios…" : "Generate 5 Bio Variations"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div
            className="mb-6 p-4 rounded-xl text-[13px] flex items-center gap-2"
            style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}25`, color: GOLD }}
          >
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            Reading your Brain and writing 5 bio variations — takes about 15 seconds…
          </div>
        )}

        {/* Results */}
        {bios && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[14px] font-semibold text-white">
                5 bios ready — pick your favourite and copy straight into your profile
              </p>
              <button
                onClick={() => setBios(null)}
                className="text-[12px] text-white/30 hover:text-white/60 transition-colors"
              >
                ← Regenerate
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {bios.map((bio, i) => (
                <BioCard key={i} bio={bio} index={i} />
              ))}
            </div>

            <div
              className="p-3.5 rounded-xl text-[11px] text-white/35 leading-relaxed"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <strong className="text-white/50">Tip:</strong> Instagram's bio field caps at 150 characters total.
              Bios showing <span className="text-red-400">red</span> are over the limit and need a quick trim before posting.
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
