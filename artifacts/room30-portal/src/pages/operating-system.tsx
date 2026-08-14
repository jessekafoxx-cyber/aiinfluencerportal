import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu, Sparkles, Loader2, CheckCircle2, AlertCircle, Brain,
  X, ChevronDown, ChevronUp, Coins, Download, ArrowRight,
  Search, Target, TrendingUp, Layers, BarChart2, Mail,
  Video, FileText, Zap, Users, Star, Youtube, Mic, Monitor,
  BookOpen, Globe, Lock,
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
  phase: string;        // which phase this tool belongs to
  isPremium?: boolean;  // hidden unless user has premium OS access
  color?: string;
  navigateTo?: string;
};

// ── Standard Phase Tools ─────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  // ── Phase 2 — Bridge Page ─────────────────────────────────────────────────
  {
    slug: "bridge-page-headlines",
    label: "Bridge Page Headline Generator",
    description: "Generate 11 headline + sub-headline variants and 3 bullet point sets for your bridge page — the page between the click and the sales page.",
    credits: 0,
    icon: FileText,
    phase: "bridge-page",
    color: "#C9A44C",
    fields: [],
  },
  {
    slug: "domain-name-generator",
    label: "Domain Name Generator",
    description: "Drop a short note about what your offer is about and we hand you 20 brandable domain ideas across .com, .io, .co and .ai with a fast availability check on every name.",
    credits: 0,
    icon: Globe,
    phase: "bridge-page",
    color: "#C9A44C",
    navigateTo: "/domain-name-generator",
    fields: [],
  },

  // ── Phase 3 — AI Avatar ───────────────────────────────────────────────────
  {
    slug: "avatar-prompt-generator",
    label: "Avatar Prompt Generator",
    description: "Upload 1-3 reference avatar images and get back a hyper-detailed JSON prompt (with consistency_id) for Higgsfield nano-banana pro, MidJourney, or any image generator.",
    credits: 0,
    icon: Users,
    phase: "avatar",
    color: "#8b5cf6",
    navigateTo: "/avatar-prompt-generator",
    fields: [],
  },

  // ── Phase 4 — Content: Script Writers ────────────────────────────────────
  {
    slug: "sw-green-screen",
    label: "Script Writer OS - Green Screen",
    description: "Drop your green-screen images plus context and your CTA comment word, and get a 60-second script built on proven hook formulas - the on-screen breakdown of whatever you put behind you.",
    credits: 0,
    icon: Monitor,
    phase: "content",
    color: "#10b981",
    navigateTo: "/script-writer?type=green-screen",
    fields: [],
  },
  {
    slug: "sw-hook-demo",
    label: "Script Writer OS - Hook + Demo",
    description: "Hand us the demo you want to film and we write the cold-open hook plus the on-screen step-by-step breakdown - pulled from your saved offer and Brain, using proven hook formulas.",
    credits: 0,
    icon: Video,
    phase: "content",
    color: "#10b981",
    navigateTo: "/script-writer?type=hook-demo",
    fields: [],
  },
  {
    slug: "sw-podcast-clip",
    label: "Script Writer OS - Podcast Clips",
    description: "Pick the clip length, hook style and CTA, and we generate a teleprompter-ready script for your next podcast cut - anchored to your offer, your Brain and the proven hook library.",
    credits: 0,
    icon: Mic,
    phase: "content",
    color: "#6366f1",
    navigateTo: "/script-writer?type=podcast-clip",
    fields: [],
  },
  {
    slug: "sw-speaking-clip",
    label: "Script Writer OS - Speaking Clips",
    description: "Choose your length, hook style and CTA mode, and we write a sharp speaking-style script ready to film - using only proven hook formulas, pulled from your offer and Brain.",
    credits: 0,
    icon: Mic,
    phase: "content",
    color: "#8b5cf6",
    navigateTo: "/script-writer?type=speaking-clip",
    fields: [],
  },
  {
    slug: "sw-selfie-clip",
    label: "Script Writer OS - Selfie Yapping",
    description: "Pick the formula (realisation, contrarian opinion, story-based), the hook style and the CTA, and we write a punchy selfie-style script - pulled from your offer and Brain.",
    credits: 0,
    icon: Users,
    phase: "content",
    color: "#f59e0b",
    navigateTo: "/script-writer?type=selfie-clip",
    fields: [],
  },
  {
    slug: "sw-slideshow",
    label: "Script Writer OS - Viral Slideshows",
    description: "Drop a short brief and we write the on-slide copy and caption - built around proven hook formulas, your offer and your Brain.",
    credits: 0,
    icon: Layers,
    phase: "content",
    color: "#ec4899",
    navigateTo: "/script-writer?type=slideshow",
    fields: [],
  },
  {
    slug: "sw-carousel",
    label: "Script Writer OS - Viral Carousels",
    description: "Pick the carousel type and slide count, and we write the full slide-by-slide copy plus image prompts - built on proven hooks, your offer and Brain.",
    credits: 0,
    icon: FileText,
    phase: "content",
    color: "#ec4899",
    navigateTo: "/script-writer?type=carousel",
    fields: [],
  },
  {
    slug: "sw-overlay",
    label: "Script Writer OS - Overlay Clips",
    description: "Get an on-screen text overlay hook plus a full caption and b-roll suggestions - built on proven hook formulas, your offer and Brain.",
    credits: 0,
    icon: Star,
    phase: "content",
    color: "#14b8a6",
    navigateTo: "/script-writer?type=overlay",
    fields: [],
  },
  {
    slug: "sw-fastmotion",
    label: "Script Writer OS - Fast-Motion Clips",
    description: "Get an on-screen hook, music direction and a fast-motion visual sequence with image prompts - built on proven hooks, your offer and Brain.",
    credits: 0,
    icon: Zap,
    phase: "content",
    color: "#f97316",
    navigateTo: "/script-writer?type=fastmotion",
    fields: [],
  },

  // ── Phase 5 — Ads & Scaling ───────────────────────────────────────────────
  {
    slug: "direct-offer-ad-generator",
    label: "Direct Offer Ad Generator",
    description: "Generate a modular direct-response ad pack - 10 hooks, 3 bodies, 2 CTAs - built from the offer you are promoting and your Brain. Use it for the Direct Sales Campaign in Phase 5.",
    credits: 0,
    icon: Zap,
    phase: "ads-scaling",
    color: "#10b981",
    fields: [],
  },
  {
    slug: "kpi-generator",
    label: "KPI Generator",
    description: "Generate your key performance indicators and tracking dashboard so you know exactly what to scale and where the bottleneck is.",
    credits: 0,
    icon: BarChart2,
    phase: "ads-scaling",
    color: "#f59e0b",
    fields: [
      { key: "revenueGoal", label: "Monthly Revenue Goal", type: "text", placeholder: "e.g. $50,000/month" },
      { key: "ltToHtConversion", label: "LT → HT Conversion Rate", type: "select", options: ["Not sure — use 3% benchmark", "1%", "2%", "3%", "4%", "5%", "7%", "10%"] },
    ],
  },

  // ── Premium OS Add-Ons ────────────────────────────────────────────────────
  {
    slug: "find-your-expertise",
    label: "Find Your Expertise",
    description: "Discover your niche, unique angle, and the ideal offer direction based on your background and skills.",
    credits: 1,
    icon: Search,
    phase: "premium-research",
    isPremium: true,
    color: "#8b5cf6",
    fields: [
      { key: "lifestyleVision", label: "Lifestyle & Vision", type: "textarea", placeholder: "What life do you want to live? Income goals, location, freedom?" },
      { key: "currentIncome", label: "Current Income & Runway", type: "text", placeholder: "e.g. £3,000/month, 6 months runway" },
      { key: "professionalAuthority", label: "Professional Authority", type: "textarea", placeholder: "What are you already known or respected for?" },
      { key: "superpowers", label: "Your Superpowers", type: "textarea", placeholder: "What feels easy to you but hard for others?" },
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
    phase: "premium-research",
    isPremium: true,
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
    phase: "premium-research",
    isPremium: true,
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
    phase: "premium-research",
    isPremium: true,
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
    phase: "premium-research",
    isPremium: true,
    color: "#8b5cf6",
    fields: [
      { key: "niche", label: "Niche", type: "text", placeholder: "e.g. Low-ticket offer strategies for coaches" },
      { key: "platforms", label: "Platforms", type: "text", placeholder: "e.g. Instagram, TikTok, YouTube", optional: true },
      { key: "contentGoal", label: "Content Goal", type: "text", placeholder: "e.g. Drive traffic to low-ticket offer", optional: true },
    ],
  },
  {
    slug: "low-ticket-offer-build",
    label: "Low-Ticket Offer Build",
    description: "Complete low-ticket offer stack — concept, name, promise, offer stack, pricing, order bumps, and ascension path.",
    credits: 1,
    icon: Layers,
    phase: "premium-offer",
    isPremium: true,
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
    phase: "premium-offer",
    isPremium: true,
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
    phase: "premium-offer",
    isPremium: true,
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
    phase: "premium-offer",
    isPremium: true,
    color: "#C9A44C",
    fields: [
      { key: "offerType", label: "Offer Type", type: "select", options: ["1-1 Coaching / Consulting", "Group Program / Cohort", "Done For You Service", "Hybrid (mix of the above)", "Not sure — recommend the best fit"] },
      { key: "willingToDeliver", label: "What You're Willing to Deliver", type: "textarea", placeholder: "e.g. Weekly 1-1 calls, Slack access, done-for-you funnels…" },
      { key: "pricingThoughts", label: "Pricing Thoughts", type: "text", placeholder: "e.g. $10,000, or unsure", optional: true },
    ],
  },
  {
    slug: "100k-offer-build",
    label: "$100K+ Offer Build",
    description: "Design your luxury $100K+ offer — premium experience, in-person elements, exclusivity, and high-status positioning.",
    credits: 2,
    icon: Star,
    phase: "premium-offer",
    isPremium: true,
    color: "#C9A44C",
    fields: [
      { key: "deliverables", label: "Deliverable Ideas (one per line)", type: "textarea", placeholder: "e.g.\nIn-person strategy day\n1-1 WhatsApp for 12 months\nDone-for-you funnel build" },
      { key: "suggestedPrice", label: "Suggested Price", type: "text", placeholder: "e.g. $100,000", optional: true },
    ],
  },
  {
    slug: "high-ticket-funnel",
    label: "High-Ticket Funnel Blueprint",
    description: "End-to-end high-ticket funnel — entry point, VSL/landing page, application, sales call framework, follow-up, and metrics.",
    credits: 1,
    icon: TrendingUp,
    phase: "premium-offer",
    isPremium: true,
    color: "#C9A44C",
    fields: [
      { key: "funnelType", label: "Funnel Type", type: "select", options: ["Application → Sales Call", "VSL → Application → Call", "Direct Opt-In → Call", "Low-ticket buyer → Upsell to HT"] },
      { key: "offerPrice", label: "Offer Price / Structure", type: "text", placeholder: "e.g. $15,000 one-time or $3,000/month retainer" },
      { key: "targetBuyer", label: "Target Buyer", type: "text", placeholder: "e.g. Agency owners doing $20K+/month", optional: true },
    ],
  },
  {
    slug: "vsl-creation",
    label: "Low-Ticket VSL",
    description: "Full VSL script for your low-ticket offer — built from your saved Brain and offer. Talking head or slide style.",
    credits: 2,
    icon: Video,
    phase: "premium-marketing",
    isPremium: true,
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
    phase: "premium-marketing",
    isPremium: true,
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
    phase: "premium-marketing",
    isPremium: true,
    color: "#10b981",
    fields: [
      { key: "offerType", label: "Offer Level", type: "select", options: ["Premium High Ticket ($3K–$50K)", "$100K+ Offer"] },
    ],
  },
  {
    slug: "objection-opinion-clips",
    label: "Objection & Opinion Clips",
    description: "30 short-form clip topics — 15 objection videos + 15 opinion/contrarian angles — each with an opening hook line.",
    credits: 1,
    icon: Mic,
    phase: "premium-marketing",
    isPremium: true,
    color: "#10b981",
    fields: [],
  },
  {
    slug: "youtube-idea-generator",
    label: "YouTube Idea Generator",
    description: "50 expertise-driven YouTube ideas across 6 categories — designed to attract ideal clients, not chase views.",
    credits: 2,
    icon: Youtube,
    phase: "premium-marketing",
    isPremium: true,
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
    phase: "premium-marketing",
    isPremium: true,
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
    phase: "premium-marketing",
    isPremium: true,
    color: "#10b981",
    fields: [
      { key: "sequenceGoal", label: "Sequence Goal", type: "select", options: ["Nurture new buyers into the upsell", "Re-engage cold leads", "Pitch a high-ticket offer", "General follow-up sequence"] },
      { key: "sequenceLength", label: "Sequence Length", type: "select", options: ["5 messages", "7 messages", "10 messages", "14 messages"] },
      { key: "extraNotes", label: "Additional Context", type: "textarea", placeholder: "Specific angles, objections to address, or offers to mention", optional: true },
    ],
  },
  {
    slug: "portal-creation",
    label: "Portal Build Prompt Pack",
    description: "14 copy-paste Replit prompts that walk you through building your own custom client portal — personalised to your brand and offers.",
    credits: 5,
    icon: Cpu,
    phase: "premium-systems",
    isPremium: true,
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

// ── Phase config ─────────────────────────────────────────────────────────────

const STANDARD_PHASES = [
  { key: "bridge-page", label: "Phase 2 - Bridge Page", color: "#C9A44C" },
  { key: "avatar",       label: "Phase 3 - AI Avatar",  color: "#C9A44C" },
  { key: "content",      label: "Phase 4 - Content",    color: "#C9A44C" },
  { key: "ads-scaling",  label: "Phase 5 - Ads & Scaling", color: "#C9A44C" },
];

const PREMIUM_PHASES = [
  { key: "premium-research",  label: "Research",            color: "#C9A44C" },
  { key: "premium-offer",     label: "Offer Building",      color: "#C9A44C" },
  { key: "premium-marketing", label: "Marketing & Content", color: "#C9A44C" },
  { key: "premium-systems",   label: "Business Systems",    color: "#C9A44C" },
];

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

  useEffect(() => {
    api.getActiveOSToolGenerationJob(tool.slug).then(d => {
      if (d.job) {
        setJob(d.job);
        setJobId(d.job.id);
        if (d.job.status === "done") setShowOutput(true);
      }
    }).catch(() => {});
  }, [tool.slug]);

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
    onError: (err: any) => setError(err?.message || "Failed to start generation"),
  });

  const isActive = job?.status === "pending" || job?.status === "processing";
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  const quota = quotaData;
  // Standard tools (credits: 0) are always free — no credit gate needed
  const canGenerate = tool.credits === 0 || !quota || quota.isAdmin || quota.unlimited || quota.freeRemaining > 0 || quota.balance >= tool.credits;
  const creditWarning = tool.credits > 0 && quota && !quota.isAdmin && !quota.unlimited && quota.freeRemaining === 0 && quota.balance < tool.credits;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-start sm:justify-center sm:p-4 sm:pt-16 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-2xl bg-[#0f0f0f] border border-white/[0.1] shadow-2xl rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] overflow-hidden">
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <div className="flex items-start justify-between px-5 py-4 sm:p-6 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#C9A44C]/15">
              <tool.icon className="w-4 h-4 text-[#C9A44C]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-white leading-tight">{tool.label}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] text-white/40">
                  {tool.credits === 0 ? "Free — unlimited generations" : `${tool.credits} credit${tool.credits !== 1 ? "s" : ""} per generation`}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 flex-shrink-0 p-2 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 sm:p-6 space-y-5">
          <p className="text-[13px] text-white/50 leading-relaxed">{tool.description}</p>

          {creditWarning && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />
              Not enough credits. This tool costs {tool.credits} credit{tool.credits !== 1 ? "s" : ""} — you have {quota?.balance ?? 0}.
              {" "}<a href="/settings" className="underline hover:no-underline">Buy credits in Settings.</a>
            </div>
          )}

          {tool.fields.length > 0 && (
            <div className="space-y-4">
              {tool.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">
                    {field.label}{field.optional && <span className="text-white/20 normal-case tracking-normal ml-1">(optional)</span>}
                  </label>
                  {field.type === "select" ? (
                    <select value={answers[field.key] ?? ""} onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full px-3 py-3 sm:py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] focus:outline-none focus:border-[#C9A44C]/40 appearance-none">
                      <option value="">Select…</option>
                      {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea rows={3} value={answers[field.key] ?? ""} onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-3 sm:py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40 resize-none" />
                  ) : (
                    <input value={answers[field.key] ?? ""} onChange={e => setAnswers(p => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-3 sm:py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#C9A44C]/40" />
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

          {isActive && (
            <div className="p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#C9A44C] animate-spin flex-shrink-0" />
              <div>
                <p className="text-[13px] text-[#C9A44C] font-medium">Generating…</p>
                <p className="text-[11px] text-[#C9A44C]/60 mt-0.5">This usually takes 30–90 seconds. Don't close this.</p>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />
              {job?.errorMessage || "Generation failed — please try again."}
            </div>
          )}

          <button
            onClick={() => generateMutation.mutate()}
            disabled={isActive || generateMutation.isPending || creditWarning}
            className="w-full flex items-center justify-center gap-2 py-3.5 sm:py-3 rounded-xl text-[14px] sm:text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[#C9A44C] hover:bg-[#b8933e] text-black"
          >
            {isActive || generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isDone ? "Regenerate" : isActive ? "Generating…" : "Generate"}
          </button>

          {isDone && job?.content && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <button onClick={() => setShowOutput(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-[13px] font-medium text-white">Output Ready</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={e => {
                    e.stopPropagation();
                    const html = job.content || "";
                    const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${tool.label}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;color:#1a1a1a}h2{font-size:18px;font-weight:700;margin:24px 0 10px;border-bottom:2px solid #C9A44C;padding-bottom:6px}h3{font-size:15px;font-weight:600;margin:16px 0 8px}p{line-height:1.7;margin:8px 0}ul,ol{padding-left:24px;margin:8px 0}li{line-height:1.7;margin:3px 0}</style></head><body>${html}</body></html>`], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${tool.label.replace(/[^a-z0-9]/gi, "_")}.html`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 text-[11px] transition-colors">
                    <Download className="w-3 h-3" />Export
                  </button>
                  {showOutput ? <ChevronUp className="w-3.5 h-3.5 text-white/40" /> : <ChevronDown className="w-3.5 h-3.5 text-white/40" />}
                </div>
              </button>
              {showOutput && (
                <div className="px-5 py-4 border-t border-white/[0.06] max-h-[55vh] overflow-y-auto">
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

// ─── Tool Card ─────────────────────────────────────────────────────────────────

function ToolCard({ tool, onClick }: { tool: ToolDef; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-[#C9A44C]/[0.04] hover:border-[#C9A44C]/20 p-4 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#C9A44C]/10">
          <tool.icon className="w-3.5 h-3.5 text-[#C9A44C]" />
        </div>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#C9A44C]">
          OPEN <ArrowRight className="w-3 h-3" />
        </span>
      </div>
      <h3 className="text-[13px] font-semibold text-white mb-1.5 leading-tight">{tool.label}</h3>
      <p className="text-[11.5px] text-white/40 leading-relaxed line-clamp-3">{tool.description}</p>
    </button>
  );
}

// ─── Research Docs Card ────────────────────────────────────────────────────────

function ResearchDocsCard({ research, onNavigate }: { research: any; onNavigate: () => void }) {
  const canGenerate = research?.canGenerate ?? true;
  const freeRemaining = research?.freeRunsRemaining ?? 0;
  const isAdmin = research?.isAdmin ?? false;

  return (
    <div className="rounded-xl border border-[#C9A44C]/30 bg-[#C9A44C]/[0.04] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A44C]/60">Foundation Step</span>
            {!canGenerate && !isAdmin && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-400">
                <Lock className="w-2.5 h-2.5" />Credits needed
              </span>
            )}
          </div>
          <h2 className="text-[18px] sm:text-[20px] font-bold text-white mb-2 uppercase tracking-wide">
            Generate Research Docs
          </h2>
          <p className="text-[13px] text-white/50 leading-relaxed mb-4 max-w-xl">
            Build all four core research documents from your brain profile - market research, marketing angles and hooks, market awareness stages, and 5 customer avatars. Works for our pre-made offers (like the AI Influencer Portfolio) and any offer of your own.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {["Market Research", "Angles & Hooks", "Awareness Stages", "5 Customer Avatars"].map(label => (
              <span key={label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.05] text-white/50 border border-white/[0.08]">
                <BookOpen className="w-2.5 h-2.5 text-[#C9A44C]" />{label}
              </span>
            ))}
          </div>
          {!isAdmin && (
            <p className="text-[11px] text-white/30">
              {freeRemaining > 0
                ? `${freeRemaining} free generation${freeRemaining !== 1 ? "s" : ""} remaining`
                : "Free runs used — requires research credits"}
            </p>
          )}
        </div>
        <button
          onClick={onNavigate}
          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
          style={{ background: "linear-gradient(135deg, #C9A44C 0%, #a07830 100%)", color: "#000" }}
        >
          GENERATE <ArrowRight className="w-3.5 h-3.5" />
        </button>
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

  const { data: meData } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
  });

  const brain = (brainData as any)?.profile ?? null;
  const brainReady = brain?.status === "generated";

  const me = (meData as any)?.user ?? null;
  const hasPremiumOs: boolean = !!(me?.isAdmin || me?.hasMarketingTool);
  const research = (meData as any)?.research ?? null;

  const handleToolClick = (tool: ToolDef) => {
    if (tool.navigateTo) {
      setLocation(tool.navigateTo);
    } else {
      setActiveTool(tool);
    }
  };

  const standardTools = TOOLS.filter(t => !t.isPremium);
  const premiumTools = TOOLS.filter(t => t.isPremium);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0">
              <Cpu className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white">Operating System</h1>
              <p className="text-white/40 text-[12px] mt-0.5">Your AI-powered build tools for the Room30 Masterclass</p>
            </div>
          </div>
        </div>

        {/* Brain warning */}
        {!brainReady && (
          <div className="mb-6 p-4 rounded-xl bg-[#C9A44C]/10 border border-[#C9A44C]/20">
            <div className="flex items-start gap-3">
              <Brain className="w-4 h-4 text-[#C9A44C] flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-[#C9A44C] leading-relaxed flex-1">
                {brain?.status === "generating"
                  ? "Your Brain is being generated — tools will be available shortly."
                  : "Set up your Brain first — tools use it to generate personalised output."}
              </p>
            </div>
            {brain?.status !== "generating" && (
              <button onClick={() => setLocation("/your-brain")}
                className="mt-3 w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-1.5 rounded-lg bg-[#C9A44C] text-black text-[13px] sm:text-[12px] font-semibold hover:bg-[#C9A44C]/90 transition-colors">
                Set Up Brain
              </button>
            )}
          </div>
        )}

        <div className="space-y-10">
          {/* ── Foundation Step: Research Docs ─────────────────────────── */}
          <ResearchDocsCard research={research} onNavigate={() => setLocation("/research-generation")} />

          {/* ── Standard Phase Sections ─────────────────────────────────── */}
          {STANDARD_PHASES.map(phase => {
            const phaseTools = standardTools.filter(t => t.phase === phase.key);
            if (phaseTools.length === 0) return null;
            return (
              <div key={phase.key}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-4 h-px" style={{ background: phase.color }} />
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: phase.color }}>
                    {phase.label}
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {phaseTools.map(tool => (
                    <ToolCard key={tool.slug} tool={tool} onClick={() => handleToolClick(tool)} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Premium OS Add-Ons ──────────────────────────────────────── */}
          {hasPremiumOs && premiumTools.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-6 pt-2">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 px-2">Premium OS Add-Ons</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <div className="space-y-8">
                {PREMIUM_PHASES.map(phase => {
                  const phaseTools = premiumTools.filter(t => t.phase === phase.key);
                  if (phaseTools.length === 0) return null;
                  return (
                    <div key={phase.key}>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-4 h-px" style={{ background: phase.color }} />
                        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: `${phase.color}99` }}>
                          {phase.label}
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {phaseTools.map(tool => (
                          <button
                            key={tool.slug}
                            onClick={() => handleToolClick(tool)}
                            className="group text-left rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-[#C9A44C]/[0.04] hover:border-[#C9A44C]/20 p-4 transition-all"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#C9A44C]/10">
                                <tool.icon className="w-3.5 h-3.5 text-[#C9A44C]" />
                              </div>
                              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-[#C9A44C]/10 text-[#C9A44C]">
                                <Coins className="w-2.5 h-2.5" />
                                {tool.credits === 0 ? "Free" : tool.credits}
                              </span>
                            </div>
                            <h3 className="text-[13px] font-semibold text-white mb-1.5 leading-tight">{tool.label}</h3>
                            <p className="text-[11.5px] text-white/40 leading-relaxed line-clamp-2">{tool.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {activeTool && <ToolModal tool={activeTool} onClose={() => setActiveTool(null)} />}
    </PortalLayout>
  );
}
