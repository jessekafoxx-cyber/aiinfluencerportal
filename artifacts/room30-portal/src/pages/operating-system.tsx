import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu, Sparkles, Loader2, CheckCircle2, AlertCircle, Brain,
  X, ChevronDown, ChevronUp, Coins, Download, RefreshCw,
  Search, Target, TrendingUp, Layers, BarChart2, Mail,
  Video, FileText, Zap, Users, Star, Youtube, Mic, Monitor,
} from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api, type OsToolGenerationJob } from "@/lib/api";
import { useLocation } from "wouter";

// ─── Tool Definitions ────────────────────────────────────────────────────────

type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  options?: string[];
  optional?: boolean;
  placeholder?: string;
};

type ToolDef = {
  slug: string;
  label: string;
  description: string;
  credits: number;
  icon: any;
  fields: FieldDef[];
  category: string;
  color?: string;
  navigateTo?: string;
};

const TOOLS: ToolDef[] = [
  // Research
  {
    slug: "find-your-expertise",
    label: "Find Your Expertise",
    description: "Discover your niche, unique angle, and the ideal offer direction based on your background and skills.",
    credits: 1,
    icon: Search,
    category: "Research",
    color: "#8b5cf6",
    fields: [
      { key: "lifestyleVision", label: "Lifestyle & Vision", type: "textarea", placeholder: "What life do you want to live? Income goals, location, freedom?" },
      { key: "currentIncome", label: "Current Income & Runway", type: "text", placeholder: "e.g. £3,000/month, 6 months runway" },
      { key: "professionalAuthority", label: "Professional Authority", type: "textarea", placeholder: "What are you already known or respected for? Credentials, roles, results?" },
      { key: "superpowers", label: "Your Superpowers", type: "textarea", placeholder: "What feels easy to you but hard for others? What do people thank you for?" },
      { key: "livedExperience", label: "Lived Experience", type: "textarea", placeholder: "The journey you've personally been through that others want to take" },
      { key: "otherSkills", label: "Other Skills", type: "textarea", placeholder: "Transferable skills, hobbies, side capabilities", optional: true },
      { key: "whoAround", label: "Who Is Around You", type: "textarea", placeholder: "Your network, peers, ideal clients you already attract", optional: true },
    ],
  },
  {
    slug: "niche-audience-research",
    label: "Niche & Audience Research",
    description: "Deep research into your target market — pain points, desires, buying triggers, language, and where to find them.",
    credits: 1,
    icon: Users,
    category: "Research",
    color: "#8b5cf6",
    fields: [
      { key: "niche", label: "Niche / Market", type: "text", placeholder: "e.g. Online coaches selling high-ticket offers" },
      { key: "targetAudience", label: "Target Audience", type: "text", placeholder: "e.g. Coaches with an existing skill set wanting to go online" },
      { key: "knowAboutThem", label: "What You Already Know", type: "textarea", placeholder: "Any pain points, objections, or language they use (leave blank to infer)", optional: true },
    ],
  },
  {
    slug: "competitor-research",
    label: "Competitor Research",
    description: "Full competitive landscape analysis — gaps, positioning opportunities, pricing, and messaging angles.",
    credits: 1,
    icon: Target,
    category: "Research",
    color: "#8b5cf6",
    fields: [
      { key: "niche", label: "Niche / Market", type: "text", placeholder: "e.g. AI tools for coaches" },
      { key: "competitors", label: "Competitors You're Aware Of", type: "textarea", placeholder: "Name any you know (leave blank to infer from niche)", optional: true },
      { key: "differentiator", label: "Your Differentiator", type: "textarea", placeholder: "What makes you different? (leave blank to infer from Brain)", optional: true },
    ],
  },
  {
    slug: "offer-validation-research",
    label: "Offer Validation Research",
    description: "Validate your offer idea before building it — viability verdict, buyer readiness, pricing, and sharpening suggestions.",
    credits: 1,
    icon: CheckCircle2,
    category: "Research",
    color: "#8b5cf6",
    fields: [
      { key: "offerIdea", label: "Your Offer Idea", type: "textarea", placeholder: "What it is, who it's for, and what result it promises" },
      { key: "targetBuyer", label: "Target Buyer", type: "text", placeholder: "e.g. Online coaches wanting to launch their first course" },
      { key: "pricePoint", label: "Intended Price Point", type: "text", placeholder: "e.g. $47" },
    ],
  },
  {
    slug: "content-research",
    label: "Content Research",
    description: "Content strategy pack — top hook styles, 15–20 topic ideas, platform strategy, viral angles, and a 30-day framework.",
    credits: 1,
    icon: TrendingUp,
    category: "Research",
    color: "#8b5cf6",
    fields: [
      { key: "niche", label: "Niche", type: "text", placeholder: "e.g. Low-ticket offer strategies for coaches" },
      { key: "platforms", label: "Platforms", type: "text", placeholder: "e.g. Instagram, TikTok, YouTube", optional: true },
      { key: "contentGoal", label: "Content Goal", type: "text", placeholder: "e.g. Drive traffic to low-ticket offer", optional: true },
    ],
  },
  // Offer Building
  {
    slug: "low-ticket-offer-build",
    label: "Low-Ticket Offer Build",
    description: "Complete low-ticket offer stack — concept, name, promise, offer stack, pricing, order bumps, and ascension path.",
    credits: 1,
    icon: Layers,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "offerType", label: "Offer Type", type: "select", options: ["Done For You", "Templates / DFY Materials", "Operating System + Info", "Not sure — recommend the best fit"] },
      { key: "ideas", label: "Your Ideas & Notes", type: "textarea", placeholder: "Rough ideas or themes (leave blank to let the AI decide)", optional: true },
      { key: "orderBumps", label: "Include Order Bumps & Upsells?", type: "select", options: ["Yes", "No"] },
    ],
  },
  {
    slug: "low-ticket-funnel-build",
    label: "Low-Ticket Funnel Build",
    description: "Complete funnel architecture — every page's purpose, copy outline, tools, and implementation checklist.",
    credits: 1,
    icon: Layers,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "offerName", label: "Offer Name", type: "text", placeholder: "e.g. AI Influencer OS" },
      { key: "pricePoint", label: "Main Offer Price", type: "text", placeholder: "e.g. $47" },
      { key: "orderBumps", label: "Order Bumps", type: "text", placeholder: "e.g. Templates Bundle $37, Ad Swipe File $47", optional: true },
      { key: "upsellStack", label: "Upsell Stack", type: "text", placeholder: "e.g. Upsell 1 $197, Downsell $97, Upsell 2 $297", optional: true },
      { key: "trafficSource", label: "Traffic Source", type: "text", placeholder: "e.g. Meta Ads", optional: true },
    ],
  },
  {
    slug: "deliverables-builder",
    label: "Deliverables Builder",
    description: "Comprehensive starter deliverables list for your low-ticket offer — with AI automation opportunities and a 7-day build plan.",
    credits: 1,
    icon: FileText,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "offerType", label: "Offer Type", type: "select", options: ["Done For You", "Templates / DFY Materials", "Info / OS Style"] },
      { key: "extraNotes", label: "Additional Notes", type: "textarea", placeholder: "Anything specific to include", optional: true },
    ],
  },
  {
    slug: "premium-offer-build",
    label: "Premium Offer Build",
    description: "Design your $3K–$50K backend offer — structure, delivery model, pricing, onboarding, and ascension trigger.",
    credits: 2,
    icon: Star,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "offerType", label: "Offer Type", type: "select", options: ["1-1 Coaching / Consulting", "Group Program / Cohort", "Done For You Service", "Hybrid (mix of the above)", "Not sure — recommend the best fit"] },
      { key: "willingToDeliver", label: "What You're Willing to Deliver", type: "textarea", placeholder: "e.g. Weekly 1-1 calls, Slack access, done-for-you funnels, in-person sessions…" },
      { key: "pricingThoughts", label: "Pricing Thoughts", type: "text", placeholder: "e.g. $10,000, or unsure", optional: true },
    ],
  },
  {
    slug: "100k-offer-build",
    label: "$100K+ Offer Build",
    description: "Design your luxury $100K+ offer — premium experience, in-person elements, exclusivity, and high-status positioning.",
    credits: 2,
    icon: Star,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "deliverables", label: "Deliverable Ideas (one per line)", type: "textarea", placeholder: "e.g.\nIn-person strategy day\n1-1 WhatsApp for 12 months\nDone-for-you funnel build\nPrivate chef dinner" },
      { key: "suggestedPrice", label: "Suggested Price", type: "text", placeholder: "e.g. $100,000", optional: true },
    ],
  },
  {
    slug: "high-ticket-funnel",
    label: "High-Ticket Funnel Blueprint",
    description: "End-to-end high-ticket funnel — entry point, VSL/landing page, application, sales call framework, follow-up, and metrics.",
    credits: 1,
    icon: TrendingUp,
    category: "Offer Building",
    color: "#C9A44C",
    fields: [
      { key: "funnelType", label: "Funnel Type", type: "select", options: ["Application → Sales Call", "VSL → Application → Call", "Direct Opt-In → Call", "Low-ticket buyer → Upsell to HT"] },
      { key: "offerPrice", label: "Offer Price / Structure", type: "text", placeholder: "e.g. $15,000 one-time or $3,000/month retainer" },
      { key: "targetBuyer", label: "Target Buyer", type: "text", placeholder: "e.g. Agency owners doing $20K+/month", optional: true },
    ],
  },
  // Marketing & Content
  {
    slug: "vsl-creation",
    label: "Low-Ticket VSL",
    description: "Full VSL script for your low-ticket offer — built from your saved Brain and offer. Talking head or slide style.",
    credits: 2,
    icon: Video,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "vslStyle", label: "VSL Style", type: "select", options: ["Talking Head Style", "Classic Slide Style", "Hybrid (Talking Head + Slides)"] },
      { key: "socialProof", label: "Social Proof Notes", type: "textarea", placeholder: "Client results, testimonials, or revenue numbers to weave in", optional: true },
    ],
  },
  {
    slug: "upsell-vsl-creation",
    label: "Upsell VSL",
    description: "Post-purchase upsell VSL script — written specifically for the offer you're presenting after the initial buy.",
    credits: 2,
    icon: Video,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "vslStyle", label: "VSL Style", type: "select", options: ["Talking Head Style", "Classic Slide Style"] },
      { key: "upsellName", label: "Upsell Offer Name", type: "text", placeholder: "e.g. Done-With-You Accelerator" },
      { key: "upsellPrice", label: "Upsell Price", type: "text", placeholder: "e.g. $197" },
    ],
  },
  {
    slug: "high-ticket-vsl",
    label: "High-Ticket VSL",
    description: "VSL script for your premium or $100K+ offer — built from your saved high-ticket offer in the Brain.",
    credits: 2,
    icon: Video,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "offerType", label: "Offer Level", type: "select", options: ["Premium High Ticket ($3K–$50K)", "$100K+ Offer"] },
    ],
  },
  {
    slug: "direct-offer-ad-generator",
    label: "Direct Offer Ad Generator",
    description: "10 hooks + 3 bodies + 1 CTA = 30 modular ad combinations you can film in one session and remix forever.",
    credits: 2,
    icon: Zap,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [],
  },
  {
    slug: "objection-opinion-clips",
    label: "Objection & Opinion Clips",
    description: "30 short-form clip topics — 15 objection videos + 15 opinion/contrarian angles — each with an opening hook line.",
    credits: 1,
    icon: Mic,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [],
  },
  {
    slug: "youtube-idea-generator",
    label: "YouTube Idea Generator",
    description: "50 expertise-driven YouTube ideas across 6 categories — designed to attract ideal clients, not chase views.",
    credits: 2,
    icon: Youtube,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "includeTopics", label: "Topics / Pillars to Include", type: "textarea", placeholder: "e.g. AI tools, low-ticket offers, funnel strategy", optional: true },
      { key: "excludeTopics", label: "Topics to Avoid", type: "textarea", placeholder: "e.g. social media growth hacks, generic motivational content", optional: true },
    ],
  },
  {
    slug: "long-form-yt-framework",
    label: "Long-Form YouTube Script",
    description: "Full YouTube script using the 5-section framework: Intro, Proof, Emotion, Logic (prompts), End + CTA.",
    credits: 4,
    icon: Youtube,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "ideaDetail", label: "Video Idea / Title", type: "textarea", placeholder: "e.g. \"The exact funnel I used to make $50K in 30 days with one low-ticket offer\"" },
    ],
  },
  {
    slug: "email-whatsapp-sequence",
    label: "Email & WhatsApp Sequence",
    description: "Complete follow-up sequence for new buyers or cold leads — email and WhatsApp messages with angles and CTAs.",
    credits: 5,
    icon: Mail,
    category: "Marketing & Content",
    color: "#10b981",
    fields: [
      { key: "sequenceGoal", label: "Sequence Goal", type: "select", options: ["Nurture new buyers into the upsell", "Re-engage cold leads", "Pitch a high-ticket offer", "General follow-up sequence"] },
      { key: "sequenceLength", label: "Sequence Length", type: "select", options: ["5 messages", "7 messages", "10 messages", "14 messages"] },
      { key: "extraNotes", label: "Additional Context", type: "textarea", placeholder: "Specific angles, objections to address, or offers to mention", optional: true },
    ],
  },
  // Script Writer tools (navigate to dedicated script writer page)
  {
    slug: "sw-green-screen",
    label: "Green Screen Script",
    description: "60-second script built around images shown on the green screen — article headlines, charts, Stripe screenshots.",
    credits: 0,
    icon: Monitor,
    category: "Marketing & Content",
    color: "#10b981",
    navigateTo: "/script-writer?type=green-screen",
    fields: [],
  },
  {
    slug: "sw-hook-demo",
    label: "Hook + Demo Script",
    description: "15–25 second screen-recording demo. Upload step screenshots and get a spoken or silent script.",
    credits: 0,
    icon: Video,
    category: "Marketing & Content",
    color: "#10b981",
    navigateTo: "/script-writer?type=hook-demo",
    fields: [],
  },
  {
    slug: "sw-podcast-clip",
    label: "Podcast Clip Script",
    description: "Opinionated, contrarian 30–90 second mic clip. Recorded side-on — the kind people screenshot.",
    credits: 0,
    icon: Mic,
    category: "Marketing & Content",
    color: "#6366f1",
    navigateTo: "/script-writer?type=podcast-clip",
    fields: [],
  },
  {
    slug: "sw-speaking-clip",
    label: "Speaking Clip Script",
    description: "15–90 second on-stage authority clip. Certain, composed, conviction-loaded.",
    credits: 0,
    icon: Mic,
    category: "Marketing & Content",
    color: "#8b5cf6",
    navigateTo: "/script-writer?type=speaking-clip",
    fields: [],
  },
  {
    slug: "sw-selfie-clip",
    label: "Selfie Yapping Script",
    description: "Casual, raw 15–90 second clip — walking, in the car, outside. Honest and unfiltered.",
    credits: 0,
    icon: Users,
    category: "Marketing & Content",
    color: "#f59e0b",
    navigateTo: "/script-writer?type=selfie-clip",
    fields: [],
  },
  {
    slug: "sw-slideshow",
    label: "Viral Slideshow Script",
    description: "TikTok/IG slideshow copy — cover hook, per-slide text overlays, image prompts, and CTA slide.",
    credits: 0,
    icon: Layers,
    category: "Marketing & Content",
    color: "#ec4899",
    navigateTo: "/script-writer?type=slideshow",
    fields: [],
  },
  {
    slug: "sw-carousel",
    label: "Viral Carousel Script",
    description: "Instagram/LinkedIn carousel — swipe-stopping cover, per-slide headlines, body copy, and a follow CTA.",
    credits: 0,
    icon: FileText,
    category: "Marketing & Content",
    color: "#ec4899",
    navigateTo: "/script-writer?type=carousel",
    fields: [],
  },
  {
    slug: "sw-overlay",
    label: "Overlay Clip Script",
    description: "Voiceover script for b-roll overlay content — spoken over footage of your lifestyle or product.",
    credits: 0,
    icon: Star,
    category: "Marketing & Content",
    color: "#14b8a6",
    navigateTo: "/script-writer?type=overlay",
    fields: [],
  },
  {
    slug: "sw-fastmotion",
    label: "Fast Motion Clip Script",
    description: "Short punchy lines for fast-cut edit style — syncs with jump cuts, sped-up footage, or montage.",
    credits: 0,
    icon: Zap,
    category: "Marketing & Content",
    color: "#f97316",
    navigateTo: "/script-writer?type=fastmotion",
    fields: [],
  },
  // Business Systems
  {
    slug: "kpi-generator",
    label: "KPI Generator",
    description: "Calculate your 4 key numbers — AOV, Break-Even CAC, Max HT Spend, and Max Blended CAC — so you know exactly when to scale.",
    credits: 1,
    icon: BarChart2,
    category: "Business Systems",
    color: "#f59e0b",
    fields: [
      { key: "revenueGoal", label: "Monthly Revenue Goal", type: "text", placeholder: "e.g. $50,000/month" },
      { key: "ltToHtConversion", label: "LT → HT Conversion Rate", type: "select", options: ["Not sure — use 3% benchmark", "1%", "2%", "3%", "4%", "5%", "7%", "10%"] },
    ],
  },
  {
    slug: "portal-creation",
    label: "Portal Build Prompt Pack",
    description: "14 copy-paste Replit prompts that walk you through building your own custom client portal — personalised to your brand and offers.",
    credits: 5,
    icon: Cpu,
    category: "Business Systems",
    color: "#f59e0b",
    fields: [
      { key: "portalName", label: "Portal Name", type: "text", placeholder: "e.g. AI Influencer Portal" },
      { key: "brandColors", label: "Brand Colours (hex codes)", type: "text", placeholder: "e.g. #E32652 (red), #0A0A0A (black), #FFFFFF (white)" },
      { key: "fonts", label: "Fonts", type: "text", placeholder: "e.g. Oswald Bold headings, Inter body", optional: true },
      { key: "upsellNames", label: "Upsell / Offer Names", type: "textarea", placeholder: "e.g. Upsell 1: Done-With-You $197, Order Bump: Ad Template Pack $37", optional: true },
      { key: "extraNotes", label: "Extra Requests", type: "textarea", placeholder: "Anything specific you want in your portal build", optional: true },
    ],
  },
];

const CATEGORIES = ["Research", "Offer Building", "Marketing & Content", "Business Systems"];
const CATEGORY_ICONS: Record<string, any> = {
  Research: Search,
  "Offer Building": Layers,
  "Marketing & Content": Zap,
  "Business Systems": Cpu,
};

const POLL_MS = 2500;

// ─── Tool Modal ───────────────────────────────────────────────────────────────

function ToolModal({ tool, onClose }: { tool: ToolDef; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<OsToolGenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: quotaData } = useQuery({
    queryKey: ["os-tool-quota", tool.slug],
    queryFn: () => api.getOSToolGenerationQuota(tool.slug),
  });

  // Load active job on mount
  useEffect(() => {
    api.getActiveOSToolGenerationJob(tool.slug).then(d => {
      if (d.job) {
        setJob(d.job);
        setJobId(d.job.id);
        if (d.job.status === "done") setShowOutput(true);
      }
    }).catch(() => {});
  }, [tool.slug]);

  // Poll while job is running
  useEffect(() => {
    const isActive = job?.status === "pending" || job?.status === "processing";
    if (isActive && jobId) {
      pollingRef.current = setInterval(async () => {
        try {
          const d = await api.getOSToolGenerationJob(jobId);
          setJob(d.job);
          if (d.job.status === "done") {
            clearInterval(pollingRef.current!);
            setShowOutput(true);
            queryClient.invalidateQueries({ queryKey: ["os-tool-quota", tool.slug] });
            queryClient.invalidateQueries({ queryKey: ["os-credit-balance"] });
          }
        } catch {}
      }, POLL_MS);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [job?.status, jobId]);

  const generateMutation = useMutation({
    mutationFn: () => api.generateOSTool(tool.slug, answers),
    onSuccess: (data) => {
      setJobId(data.job.id);
      setJob(data.job);
      setError(null);
      setShowOutput(false);
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to start generation";
      setError(msg);
    },
  });

  const isActive = job?.status === "pending" || job?.status === "processing";
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  const quota = quotaData;
  const canGenerate = !quota || quota.isAdmin || quota.unlimited || quota.freeRemaining > 0 || quota.balance >= tool.credits;
  const creditWarning = quota && !quota.isAdmin && !quota.unlimited && quota.freeRemaining === 0 && quota.balance < tool.credits;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0f0f0f] border border-white/[0.1] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${tool.color}20` }}>
              <tool.icon className="w-4 h-4" style={{ color: tool.color }} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">{tool.label}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Coins className="w-3 h-3 text-white/30" />
                <span className="text-[11px] text-white/40">{tool.credits === 0 ? "Free" : `${tool.credits} credit${tool.credits !== 1 ? "s" : ""}`}</span>
                {quota && <span className="text-[11px] text-white/25">· {quota.freeRemaining > 0 ? `${quota.freeRemaining} free run${quota.freeRemaining !== 1 ? "s" : ""} left` : `Balance: ${quota.balance} credits`}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Description */}
          <p className="text-[13px] text-white/50 leading-relaxed">{tool.description}</p>

          {creditWarning && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />
              Not enough credits. This tool costs {tool.credits} credit{tool.credits !== 1 ? "s" : ""} — you have {quota?.balance ?? 0}.
              {" "}<a href="/settings" className="underline hover:no-underline">Buy credits in Settings.</a>
            </div>
          )}

          {/* Fields */}
          {tool.fields.length > 0 && (
            <div className="space-y-4">
              {tool.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
                    {field.label}{field.optional && <span className="text-white/20 normal-case tracking-normal ml-1">(optional)</span>}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={answers[field.key] ?? ""}
                      onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-[#C9A44C]/40 appearance-none"
                    >
                      <option value="">Select…</option>
                      {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      rows={3}
                      value={answers[field.key] ?? ""}
                      onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 resize-none"
                    />
                  ) : (
                    <input
                      value={answers[field.key] ?? ""}
                      onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {tool.fields.length === 0 && (
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-white/40">
              <Brain className="w-3.5 h-3.5 inline mr-1.5 text-[#C9A44C]" />
              This tool uses your Brain profile and saved offers automatically — no extra inputs needed.
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />{error}
            </div>
          )}

          {/* Status */}
          {isActive && (
            <div className="p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#C9A44C] animate-spin flex-shrink-0" />
              <div>
                <p className="text-[13px] text-[#C9A44C] font-medium">Generating…</p>
                <p className="text-[11px] text-[#C9A44C]/60 mt-0.5">This usually takes 30–90 seconds. Don't close the modal.</p>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />
              {job?.errorMessage || "Generation failed — please try again."}
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={() => generateMutation.mutate()}
            disabled={isActive || generateMutation.isPending || creditWarning}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: `linear-gradient(135deg, ${tool.color} 0%, ${tool.color}bb 100%)`, color: tool.color === "#C9A44C" || tool.color === "#f59e0b" ? "#000" : "#fff" }}
          >
            {isActive || generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isDone ? "Regenerate" : isActive ? "Generating…" : "Generate"}
          </button>

          {/* Output */}
          {isDone && job?.content && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <button
                onClick={() => setShowOutput(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] font-medium text-white">Output Ready</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      const html = job.content || "";
                      const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${tool.label}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a}h2{font-size:18px;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #C9A44C;padding-bottom:6px}h3{font-size:15px;font-weight:600;margin:16px 0 8px}p{line-height:1.7;margin:8px 0}ul,ol{padding-left:24px;margin:8px 0}li{line-height:1.7;margin:3px 0}</style></head><body>${html}</body></html>`], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${tool.label.replace(/[^a-z0-9]/gi, "_")}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    Export
                  </button>
                  {showOutput ? <ChevronUp className="w-3.5 h-3.5 text-white/40" /> : <ChevronDown className="w-3.5 h-3.5 text-white/40" />}
                </div>
              </button>
              {showOutput && (
                <div className="px-5 py-4 border-t border-white/[0.06] max-h-[50vh] overflow-y-auto">
                  <style>{`
                    .os-output h2 { font-size: 13px; font-weight: 700; color: #C9A44C; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(201,164,76,0.2); }
                    .os-output h3 { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); margin: 12px 0 6px; }
                    .os-output p { font-size: 12.5px; color: rgba(255,255,255,0.6); line-height: 1.65; margin: 5px 0; }
                    .os-output ul, .os-output ol { padding-left: 18px; margin: 5px 0; }
                    .os-output li { font-size: 12.5px; color: rgba(255,255,255,0.6); line-height: 1.65; margin: 3px 0; }
                    .os-output strong { color: rgba(255,255,255,0.85); font-weight: 600; }
                    .os-output table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                    .os-output th { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.08em; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left; }
                    .os-output td { font-size: 12px; color: rgba(255,255,255,0.6); padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); }
                    .os-output .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }
                    .os-output .kpi-card { padding: 14px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); }
                    .os-output .kpi-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
                    .os-output .kpi-value { font-size: 22px; font-weight: 800; color: #C9A44C; margin-bottom: 6px; }
                    .os-output .kpi-explain { font-size: 11.5px; color: rgba(255,255,255,0.5); line-height: 1.55; }
                    .os-output .kpi-footnote p { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.6; margin-top: 12px; }
                    .os-output .replit-prompt { background: #0a0a0a; color: #fff; padding: 14px; border-left: 3px solid #C9A44C; font-family: monospace; white-space: pre-wrap; border-radius: 8px; margin: 10px 0; font-size: 11px; line-height: 1.5; }
                  `}</style>
                  <div className="os-output" dangerouslySetInnerHTML={{ __html: job.content }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OperatingSystem() {
  const [, setLocation] = useLocation();
  const [activeTool, setActiveTool] = useState<ToolDef | null>(null);

  const { data: brainData } = useQuery({
    queryKey: ["brain-profile"],
    queryFn: () => api.getBrainProfile(),
  });

  const { data: creditData, isLoading: creditsLoading } = useQuery({
    queryKey: ["os-credit-balance"],
    queryFn: () => api.getOSToolCreditBalance(),
  });

  const brain = (brainData as any)?.profile ?? null;
  const brainReady = brain?.status === "generated";
  const creditBalance = creditData?.balance ?? 0;

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Operating System</h1>
              <p className="text-white/40 text-[12px] mt-0.5">{TOOLS.length} AI tools — powered by your Brain</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              <Coins className="w-3.5 h-3.5 text-[#C9A44C]" />
              <span className="text-[12px] font-semibold text-white">{creditsLoading ? "…" : creditBalance}</span>
              <span className="text-[12px] text-white/40">credits</span>
            </div>
          </div>
        </div>

        {/* Brain warning */}
        {!brainReady && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Brain className="w-4 h-4 text-[#C9A44C] flex-shrink-0" />
              <p className="text-[13px] text-[#C9A44C]">
                {brain?.status === "generating"
                  ? "Your Brain is being generated — most tools will be available shortly."
                  : "Set up your Brain first — most tools use it to generate personalised output."}
              </p>
            </div>
            {brain?.status !== "generating" && (
              <button
                onClick={() => setLocation("/your-brain")}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A44C] text-black text-[12px] font-semibold hover:bg-[#C9A44C]/90 transition-colors"
              >
                Set Up Brain
              </button>
            )}
          </div>
        )}

        {/* Categories */}
        <div className="space-y-8">
          {CATEGORIES.map(cat => {
            const catTools = TOOLS.filter(t => t.category === cat);
            const Icon = CATEGORY_ICONS[cat];
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="w-3.5 h-3.5 text-white/30" />
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">{cat}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {catTools.map(tool => (
                    <button
                      key={tool.slug}
                      onClick={() => tool.navigateTo ? setLocation(tool.navigateTo) : setActiveTool(tool)}
                      className="group text-left rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] p-4 transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${tool.color}18` }}>
                          <tool.icon className="w-3.5 h-3.5" style={{ color: tool.color }} />
                        </div>
                        {tool.navigateTo ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: `${tool.color}15`, color: tool.color }}>
                            Script Writer
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: `${tool.color}15`, color: tool.color }}>
                            <Coins className="w-2.5 h-2.5" />
                            {tool.credits === 0 ? "Free" : tool.credits}
                          </span>
                        )}
                      </div>
                      <h3 className="text-[13px] font-semibold text-white group-hover:text-white mb-1.5">{tool.label}</h3>
                      <p className="text-[11.5px] text-white/40 leading-relaxed line-clamp-2">{tool.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {activeTool && <ToolModal tool={activeTool} onClose={() => setActiveTool(null)} />}
    </PortalLayout>
  );
}
