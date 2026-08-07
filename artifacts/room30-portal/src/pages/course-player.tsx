import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isLessonLocked } from "@/lib/locked-lessons";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useLocation } from "wouter";
import { useState, useCallback, useEffect } from "react";
import { RichTextEditor, RichTextViewer } from "@/components/rich-text-editor";
import { WistiaPlayer } from "@/components/wistia-player";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Play,
  FileText,
  Wrench,
  ListChecks,
  Download,
  Square,
  CheckSquare,
  Save,
  Check,
  BookOpen,
  Pencil,
  X,
  Maximize2,
  Minimize2,
  Sparkles,
  Sun,
  Moon,
  Loader2,
  Eye,
  Image,
  Copy,
  ChevronRight,
  Lock,
} from "lucide-react";

type TabKey = "brief" | "notes" | "build" | "action";

// Lessons that are intentionally text-only. The video player block,
// the "Add Video" admin affordance, and the video edit panel are all
// hidden for these slugs even if a wistiaVideoId happens to be set in
// the database, so the lesson reads cleanly as a written page.
//
// Declared at module scope (not inside the component) so it is never
// in the temporal dead zone for any hook or effect callback that runs
// from an early-returning render path.
const TEXT_ONLY_LESSON_SLUGS = new Set<string>([
  "getting-support",
  "r30-p1-getting-support",
  "r30-p1-pre-made-influencer-or-live-event",
  "r30-summary-live-events",
  "the-tool-stack",
  "1-1-help-workshops",
  "get-1-1-help",
]);

type LessonOsLink = {
  tabLabel: string;
  panelTitle: string;
  panelDescription: string;
  ctaLabel: string;
  route: string;
  steps?: { title: string; description: string }[];
  extras?: { panelTitle: string; panelDescription: string; ctaLabel: string; route: string }[];
};

// Map of lesson slug -> "Build" tab config. Lessons not in this map do
// not render the Build tab at all.
//
// Declared at module scope so the useEffect that reads it cannot end up
// in a temporal dead zone when the component returns early during the
// loading or error states (which previously caused a transient
// "Cannot access 'lessonOsLinks' before initialization" crash on
// navigation between lessons).
const LESSON_OS_LINKS: Record<string, LessonOsLink> = {
  "r30-p2-bridge-page-build": {
    tabLabel: "Bridge Page OS",
    panelTitle: "Domain Name Idea Generator",
    panelDescription: "Drop a short note about what your offer is about and we hand you back 20 brandable domain ideas across .com, .io, .co and .ai, with a fast availability check on every name. Use it to shortlist the open ones in seconds before you build the bridge page.",
    ctaLabel: "Open Domain Name Generator",
    route: "/domain-name-generator",
  },
  "r30-p2-bridge-page-copy": {
    tabLabel: "Bridge Page OS",
    panelTitle: "Bridge Page Headline Generator",
    panelDescription: "Generate 11 headline + sub-headline variants and 3 bullet point sets for your affiliate bridge page. Pulls your selected offer straight from your Brain (one of our pre-built offers like the AI Influencer Portfolio, or your own). Built around the only job a bridge page has: get the next click.",
    ctaLabel: "Open Bridge Page Headline Generator",
    route: "/os-tool/bridge-page-headlines",
  },
  "find-your-expertise": {
    tabLabel: "Find Your Expertise",
    panelTitle: "Find Your Expertise OS",
    panelDescription: "This lesson powers your foundation - the one positioning that gives you the highest leverage right now. Open the tool, answer the seven prompts honestly, and we hand you back your core expertise, sub-niche, unique angle and offer direction. This then auto-seeds your Brain and Research Docs.",
    ctaLabel: "Open Find Your Expertise",
    route: "/find-your-expertise",
  },
  "about-you": {
    tabLabel: "Brain OS",
    panelTitle: "Brain OS",
    panelDescription: "This lesson powers your Brain — the central hub that auto-fills every funnel, offer, and asset across the system. Open the Brain OS to fill in (or update) your business details.",
    ctaLabel: "Open Brain OS",
    route: "/your-brain",
  },
  "research-docs": {
    tabLabel: "Research Docs OS",
    panelTitle: "Research Docs OS",
    panelDescription: "This lesson powers your Research Docs — market research, marketing angles & hooks, market awareness stages, and 5 customer avatars. All generated from your Brain profile and used by every downstream OS.",
    ctaLabel: "Open Research Docs OS",
    route: "/research-generation",
  },
  "amending-copy": {
    tabLabel: "Sales Page Copy OS",
    panelTitle: "Sales Page Copy OS",
    panelDescription: "This lesson powers your sales page copy rewrite. Generate 9 proven-framework headline + subheadline options, pick the one that fits, then get a copy-paste prompt you drop straight into your coding agent to rewrite every section of your low-ticket funnel sales page — in an edgy, high-converting, direct-response voice.",
    ctaLabel: "Open Sales Page Copy OS",
    route: "/sales-page-copy-os",
  },
  "daily-youtube-video": {
    tabLabel: "YouTube OS",
    panelTitle: "YouTube Idea Generator",
    panelDescription: "Generate 50 unique YouTube video ideas built around your expertise — depth-driven, designed for your ideal client. Pulled straight from your Brain so every idea ladders back to your offer and your A-list buyer.",
    ctaLabel: "Open YouTube Idea Generator",
    route: "/os-tool/youtube-idea-generator",
    extras: [
      {
        panelTitle: "Long Form (YT Framework) OS",
        panelDescription: "Take any one idea and turn it into a full long-form YouTube video script using the proven daily-YouTube framework — hook, story, value, CTA. Pulled from your Brain, your offer, and your saved ideas.",
        ctaLabel: "Open Long Form (YT Framework) OS",
        route: "/os-tool/long-form-yt-framework",
      },
    ],
  },
  "30-content-pieces": {
    tabLabel: "Objection & Opinion Clips OS",
    panelTitle: "Objection & Opinion Clips OS",
    panelDescription: "Build a batch of scroll-stopping short-form clips that handle the top objections your buyers have, and share punchy opinions that polarise and pull in your A-list. Pulled from your Brain, your offer, and your saved research docs so every clip ladders back to the sale.",
    ctaLabel: "Open Objection & Opinion Clips OS",
    route: "/os-tool/objection-opinion-clips",
  },
  "direct-response-campaign": {
    tabLabel: "Ad Script Generator OS",
    panelTitle: "Direct Offer Ad Generator OS",
    panelDescription: "Generate a modular direct-response ad pack — 10 hooks, 3 bodies, 2 CTAs — built from your low-ticket offer, your Brain, and your saved OS assets. Mix and match to run scroll-stopping ad clips that drive cold traffic straight to your offer.",
    ctaLabel: "Open Ad Script Generator",
    route: "/os-tool/direct-offer-ad-generator",
  },
  "daily-email": {
    tabLabel: "Daily Email Writer OS",
    panelTitle: "Daily Email Writer OS",
    panelDescription: "Drop a YouTube URL or paste your context and we'll write a punchy direct-response daily email for your list. Hook, video embed, breakdown, and your full offer-ladder footer baked in. Pulls your brand voice and saved offers from Your Brain so every send ladders straight back to a buy link.",
    ctaLabel: "Open Daily Email Writer OS",
    route: "/ai-infrastructure/daily-email",
  },
  "vsl-offer": {
    tabLabel: "High Ticket VSL OS",
    panelTitle: "High Ticket VSL OS",
    panelDescription: "This lesson powers your high-ticket VSL. Open the OS to generate a teleprompter-ready video sales letter for your premium or $100K+ offer, pulled straight from your saved offer, brand voice, and Brain profile.",
    ctaLabel: "Open High Ticket VSL OS",
    route: "/os-tool/high-ticket-vsl",
  },
  "vsl-creation": {
    tabLabel: "Low Ticket VSL OS",
    panelTitle: "Low Ticket VSL OS",
    panelDescription: "This lesson powers your low-ticket VSL. Pick Classic Slide Style or Talking Head, and we'll generate a high-converting video sales letter script — pulled from your saved low-ticket offer, brand voice, and Brain profile.",
    ctaLabel: "Open Low Ticket VSL OS",
    route: "/os-tool/vsl-creation",
    extras: [
      {
        panelTitle: "Upsell VSL Creation OS",
        panelDescription: "Use this to script every post-purchase VSL on your funnel — Upsell #1, Upsell #2, Upsell #3, and the Downsell. Each script anchors to your saved low-ticket offer and the upsell slot you select, and you can save up to 4 (one per slot) back into your Brain. Generate one, save it, then come back and generate the next.",
        ctaLabel: "Open Upsell VSL Creation OS",
        route: "/os-tool/upsell-vsl-creation",
      },
    ],
  },
  "r30-p4-setting-up-social-media": {
    tabLabel: "IG Bio Generator",
    panelTitle: "Instagram Bio Generator",
    panelDescription: "Pulled straight from Your Brain and the offer you select, we'll write 5 scroll-stopping Instagram bios using the proven 3-4 line frameworks (founder story, big-number proof, manifesto, credential stack, and 'I help X without Y'). Each one ends with a CTA pointing at the offer you picked. Copy your favourite, line breaks included, straight into your profile.",
    ctaLabel: "Open IG Bio Generator",
    route: "/ig-bio-generator",
  },
  "r30-p3-creating-unique-avatar": {
    tabLabel: "Avatar Prompt Generator",
    panelTitle: "Avatar Prompt Generator",
    panelDescription: "Upload 1 to 3 reference images of avatars you like. We analyse each one (face, skin, hair, vibe, lighting, environment, camera feel) and hand you back a hyper-detailed JSON prompt - including a consistency_id - that you paste straight into Higgsfield (nano-banana pro), MidJourney, or any image generator. Built so you keep the same avatar across future generations.",
    ctaLabel: "Open Avatar Prompt Generator",
    route: "/avatar-prompt-generator",
  },
  "updating-images": {
    tabLabel: "JSON Prompt Generator",
    panelTitle: "JSON Prompt Generator",
    panelDescription: "Upload a reference image, add a short context note about what you want, and we'll generate a structured JSON prompt (for Higgsfield, nano-banana, MidJourney or DALL·E) plus a ready-to-paste Replit coding-agent prompt that tells your funnel project to swap in a brand-matched replacement image — same size, same slot.",
    ctaLabel: "Open JSON Prompt Generator",
    route: "/image-prompt-generator",
  },
  "build": {
    tabLabel: "Low Ticket Funnel Build OS",
    panelTitle: "Low Ticket Funnel Build OS",
    panelDescription: "This lesson powers your full 7-page funnel — sales page, checkout, 3 upsells, 1 downsell, and thank-you page. Open the OS to personalise the templates with your offer, brand colours, and pricing, then download the page packs.",
    ctaLabel: "Open Low Ticket Funnel Build OS",
    route: "/low-ticket-funnel-os",
  },
  "offer-page-build": {
    tabLabel: "High Ticket Funnel OS",
    panelTitle: "High Ticket Funnel OS",
    panelDescription: "This lesson powers your high-ticket offer page — the pre-frame, qualifier and pre-sell that does the heavy lifting before any call. Open the OS to personalise the page template with your offer, positioning, proof and brand, then ship it as your dedicated high-ticket landing page.",
    ctaLabel: "Open High Ticket Funnel OS",
    route: "/high-ticket-funnel-os",
  },
  "portal-creation": {
    tabLabel: "Portal Creation OS",
    panelTitle: "Portal Creation OS",
    panelDescription: "This lesson powers your low-ticket portal build. Open the OS to walk step-by-step through naming your portal, picking your colours and fonts, and generating the copy-paste Replit prompts that build it for you - all personalised from Your Brain.",
    ctaLabel: "Open Portal Creation OS",
    route: "/os-tool/portal-creation",
  },
  "correct-profile-setup": {
    tabLabel: "Bio Generator",
    panelTitle: "Instagram Bio Generator",
    panelDescription: "Pulled straight from Your Brain and your offer, we'll write 3 high-converting Instagram (or TikTok) bio variations following the proven 4-line framework: what you do, the proof, the transformation, and a strong CTA. Pick your favourite and one-click copy it - line breaks included - straight into your profile.",
    ctaLabel: "Open Bio Generator",
    route: "#",
  },
  "deliverables": {
    tabLabel: "Deliverables Builder",
    panelTitle: "Deliverables Builder OS",
    panelDescription: "This lesson powers your Deliverables Builder — generate a complete starter list of deliverables tailored to your saved low-ticket offer. Pick the offer type (Done For You, Templates, or Info / OS), and we'll structure the table, suggest AI automation opportunities, and tell you what to ship first.",
    ctaLabel: "Open Deliverables Builder",
    route: "/os-tool/deliverables-builder",
  },
  "premium-offer-stack": {
    tabLabel: "Premium Offer Build",
    panelTitle: "Premium Offer Build OS",
    panelDescription: "This lesson powers your Premium Offer — the $5K–$50K+ backend that turns low-ticket buyers into high-ticket clients. Open the OS to design your premium stack: positioning, deliverables, sales conversation framework, and ascension path from your front-end offer.",
    ctaLabel: "Open Premium Offer Build",
    route: "/os-tool/premium-offer-build",
  },
  "build-100k-offer": {
    tabLabel: "$100K+ Offer Build",
    panelTitle: "$100K+ Offer Build OS",
    panelDescription: "This lesson powers your $100K+ Offer — the elite-tier backend designed to attract A-list clients at premium price points. Open the OS to architect the structure: positioning, deliverables, ascension path, and the sales conversation framework that closes high-ticket buyers.",
    ctaLabel: "Open $100K+ Offer Build",
    route: "/os-tool/100k-offer-build",
  },
  // ─── Phase 4 — Creating Content ────────────────────────────────────────
  // Each Phase 4 lesson in the screenshot maps 1:1 to a content type in
  // the Script Writer OS. We surface a Build tab on every one of these
  // lessons that deep-links into /script-writer with the correct type
  // pre-selected via the ?type= query param.
  "r30-p4-creating-green-screen": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Green Screen",
    panelDescription: "Open the Script Writer OS pre-set to Green Screen. Drop your images in the order you'll show them, add a short note about what you're talking about, and we'll write a tight script using only proven hook formulas - pulled from your saved offer and Brain.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=green-screen",
  },
  "r30-p4-creating-hook-demo": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Hook + Demo",
    panelDescription: "Open the Script Writer OS pre-set to Hook + Demo. Hand it the demo you want to film and we'll write the cold-open hook plus the on-screen breakdown - pulled from your saved offer and Brain, using only proven hook formulas.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=hook-demo",
  },
  "r30-p4-creating-podcast-clips": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Podcast Clips",
    panelDescription: "Open the Script Writer OS pre-set to Podcast Clips. Pick the clip length, hook style and CTA, and we'll generate a teleprompter-ready script for your next podcast cut - anchored to your offer, your Brain and the proven hook library.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=podcast-clips",
  },
  "r30-p4-creating-speaking-clips": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Speaking Clips",
    panelDescription: "Open the Script Writer OS pre-set to Speaking Clips. Choose your length, hook style and CTA mode, and we'll write a sharp speaking-style script ready to film - using only proven hook formulas, pulled from your offer and Brain.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=speaking-clips",
  },
  "r30-p4-creating-selfie-yapping-clips": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Selfie Yapping",
    panelDescription: "Open the Script Writer OS pre-set to Selfie Yapping Clips. Pick the formula (realisation, contrarian opinion, story-based), the hook style and the CTA, and we'll write a punchy selfie-style script - pulled from your offer and Brain.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=selfie-yapping",
  },
  "r30-p4-creating-viral-slideshows": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Viral Slideshows",
    panelDescription: "Open the Script Writer OS pre-set to Viral Slideshows. Drop your slide images, give a short brief, and we'll write the on-slide copy and caption - built around proven hook formulas, your offer and your Brain.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=viral-slideshows",
  },
  "r30-p4-creating-viral-carousels": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Viral Carousels",
    panelDescription: "Open the Script Writer OS pre-set to Viral Carousels. We'll generate the full carousel - hook slide, value slides and CTA slide - pulled from your offer and Brain, using only proven hook formulas.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=viral-carousels",
  },
  "r30-p4-creating-overlay-clips": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Overlay Clips",
    panelDescription: "Open the Script Writer OS pre-set to Overlay Clips. Hand it the b-roll context and we'll write the overlay script and on-screen text - anchored to your offer, your Brain and the proven hook library.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=overlay-clips",
  },
  "r30-p4-creating-fastmotion-clips": {
    tabLabel: "Script Writer OS",
    panelTitle: "Script Writer OS - Fast-Motion Clips",
    panelDescription: "Open the Script Writer OS pre-set to Fast-Motion Clips. Brief us on what you're showing and we'll write the script and captions for the sped-up build - pulled from your offer, Brain and the proven hook library.",
    ctaLabel: "Open Script Writer OS",
    route: "/script-writer?type=fast-motion-clips",
  },
  "3-types-low-ticket-offers": {
    tabLabel: "Low Ticket Offer SOP",
    panelTitle: "Low Ticket Offer SOP",
    panelDescription: "Follow this standard operating procedure to build your low-ticket offer. Each step mirrors the exact flow inside the Low Ticket Offer Build tool — work through it here, then jump in and generate.",
    ctaLabel: "Open Low Ticket Offer Build",
    route: "/os-tool/low-ticket-offer-build",
    steps: [
      {
        title: "Pick your offer type",
        description: "Choose the format that fits what you sell: Done For You (you deliver the result), Operating System + Info (a portal of training + AI tools), or Templates / DFY Materials (plug-and-play files buyers can use immediately).",
      },
      {
        title: "Brain dump your offer ideas & info",
        description: "Drop in any thoughts, angles, modules, topics, or content you want included. Rough bullet points are fine — the more context you give, the sharper the generated offer.",
      },
      {
        title: "Decide on order bumps & upsells",
        description: "Toggle this on if you want order bumps and upsells added to the stack. Recommended to maximise average order value, and essential if you plan to scale with paid ads.",
      },
      {
        title: "Generate your offer",
        description: "Hit generate and the OS will build your full low-ticket offer doc — positioning, stack, bumps, and upsells — ready to plug into your funnel.",
      },
    ],
  },
};

export function CoursePlayer({ slug }: { slug: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Legacy / stripped-prefix recovery: every Room30 lesson slug is stored
  // as `r30-...` in the database. Old shared links and bookmarks that
  // dropped the leading `r` (so `30-p2-bridge-page-build` instead of
  // `r30-p2-bridge-page-build`) used to dead-end on a 404 / 502 page.
  // Normalise the URL on the client before any data fetch fires so the
  // user lands on the correct lesson and the address bar self-heals.
  useEffect(() => {
    if (slug && /^30-/.test(slug)) {
      setLocation(`/lesson/r${slug}`, { replace: true });
    }
  }, [slug, setLocation]);
  const [activeTab, setActiveTab] = useState<TabKey>("brief");
  const [savedToAssets, setSavedToAssets] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesFullscreen, setNotesFullscreen] = useState(false);
  const [notesTheme, setNotesTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem("notesTheme") as "dark" | "light") || "dark";
  });
  const toggleNotesTheme = () => {
    setNotesTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem("notesTheme", next); } catch {}
      return next;
    });
  };
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [transcriptInput, setTranscriptInput] = useState("");
  const [contextInput, setContextInput] = useState("");
  const [generatedPreview, setGeneratedPreview] = useState("");
  const [noteStyle, setNoteStyle] = useState<"structured" | "general">("structured");
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [showDiagramModal, setShowDiagramModal] = useState(false);
  const [diagramDescription, setDiagramDescription] = useState("");
  const [diagramType, setDiagramType] = useState("flowchart");
  const [generatedDiagramUrl, setGeneratedDiagramUrl] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editingVideo, setEditingVideo] = useState(false);
  const [videoDraft, setVideoDraft] = useState("");
  const [videoSaved, setVideoSaved] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const { data: lessonData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["lesson", slug],
    queryFn: () => api.getLesson(slug),
    retry: 2,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
  });

  const { data: course } = useQuery({
    queryKey: ["course"],
    queryFn: api.getCourse,
  });

  const isAdmin = me?.user?.role === "admin";

  const markCompleteMutation = useMutation({
    mutationFn: () => api.updateProgress(slug, { completed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
      queryClient.invalidateQueries({ queryKey: ["course"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const saveToAssetsMutation = useMutation({
    mutationFn: (data: { category: string; title: string; content: string; lessonSlug: string }) =>
      api.createAsset(data),
    onSuccess: () => {
      setSavedToAssets(true);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setTimeout(() => setSavedToAssets(false), 3000);
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: (notes: string) => api.admin.updateLessonNotes(slug, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
      setEditingNotes(false);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 3000);
    },
  });

  const [editingDownloads, setEditingDownloads] = useState(false);
  const [downloadDrafts, setDownloadDrafts] = useState<Array<{ url: string; name: string }>>([]);
  const [downloadsSaved, setDownloadsSaved] = useState(false);
  const [downloadsError, setDownloadsError] = useState<string | null>(null);
  const saveDownloadsMutation = useMutation({
    mutationFn: (files: Array<{ url: string; name: string }> | null) => api.admin.updateLessonDownloads(slug, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
      setEditingDownloads(false);
      setDownloadsError(null);
      setDownloadsSaved(true);
      setTimeout(() => setDownloadsSaved(false), 3000);
    },
    onError: (err: any) => {
      setDownloadsError(err?.message || "Failed to save downloads");
    },
  });

  const generateNotesMutation = useMutation({
    mutationFn: ({ transcript, context, style }: { transcript: string; context?: string; style: "structured" | "general" }) =>
      api.admin.generateNotes(slug, transcript, context, style),
    onSuccess: (data: any) => {
      setGeneratedPreview(data.html);
    },
  });

  const editNotesAiMutation = useMutation({
    mutationFn: ({ currentHtml, editPrompt }: { currentHtml: string; editPrompt: string }) =>
      api.admin.editNotesAi(slug, currentHtml, editPrompt),
    onSuccess: (data: any) => {
      setGeneratedPreview(data.html);
      setAiEditPrompt("");
    },
  });

  const diagramMutation = useMutation({
    mutationFn: ({ description, type }: { description: string; type: string }) =>
      api.admin.generateDiagram(description, type),
    onSuccess: (data: any) => {
      setGeneratedDiagramUrl(data.svg || "");
    },
  });

  const actionTaskMutation = useMutation({
    mutationFn: (completed: boolean) => api.toggleActionTask(slug, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
    },
  });

  const actionTaskAtMutation = useMutation({
    mutationFn: ({ index, completed }: { index: number; completed: boolean }) =>
      api.toggleActionTaskAt(slug, index, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
    },
  });

  const [editingActionTasks, setEditingActionTasks] = useState(false);
  const [actionTaskDrafts, setActionTaskDrafts] = useState<string[]>([]);
  const [actionTasksError, setActionTasksError] = useState<string | null>(null);
  const saveActionTasksMutation = useMutation({
    mutationFn: (tasks: string[]) => api.admin.updateLessonActionTasks(slug!, tasks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
      setEditingActionTasks(false);
      setActionTasksError(null);
    },
    onError: (e: any) => setActionTasksError(e?.message || "Save failed"),
  });

  const lesson = lessonData?.lesson;
  const progress = lessonData?.progress;
  const isCompleted = progress?.completed;
  const isActionTaskDone = progress?.actionTaskCompleted;
  const lessonActionTasks: string[] = Array.isArray(lesson?.actionTasks)
    ? (lesson!.actionTasks as string[]).filter((t) => typeof t === "string" && t.trim().length > 0)
    : [];
  const actionTasksCompleted: boolean[] = Array.isArray(progress?.actionTasksCompleted)
    ? (progress!.actionTasksCompleted as boolean[])
    : [];

  // If the user landed on a tab that no longer exists for this lesson
  // (e.g. previous lesson had Build, current one does not), drop them
  // back to Brief instead of showing a blank panel.
  useEffect(() => {
    if (activeTab === "build" && !LESSON_OS_LINKS[slug || ""]) {
      setActiveTab("brief");
    }
    // Text-only lessons only have a Brief tab. If the user was on Notes
    // / Build / Action when they navigated in, snap them back to Brief
    // so the page is not stuck on a hidden tab.
    if (TEXT_ONLY_LESSON_SLUGS.has(slug || "") && activeTab !== "brief") {
      setActiveTab("brief");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const allLessons = course?.flatMap((p: any) => p.lessons) || [];
  const currentIndex = allLessons.findIndex((l: any) => l.slug === slug);
  // Admins can navigate into locked / coming-soon lessons. For everyone
  // else, the prev/next arrows skip over locked slugs so a regular user
  // never lands on a placeholder lesson by accident.
  const findAdjacentLesson = (direction: 1 | -1) => {
    if (currentIndex < 0) return null;
    let i = currentIndex + direction;
    while (i >= 0 && i < allLessons.length) {
      const candidate = allLessons[i];
      if (isAdmin || !isLessonLocked(candidate?.slug)) return candidate;
      i += direction;
    }
    return null;
  };
  const prevLesson = findAdjacentLesson(-1);
  const nextLesson = findAdjacentLesson(1);

  const currentPhase = course?.find((p: any) => p.lessons.some((l: any) => l.slug === slug));

  const startEditing = useCallback(() => {
    setNotesContent(lesson?.notes || "");
    setEditingNotes(true);
  }, [lesson?.notes]);

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
          <p className="text-white/40 text-[12px] uppercase tracking-wider">Loading lesson</p>
        </div>
      </PortalLayout>
    );
  }

  // Block locked lessons for non-admin users. Admins still see the full
  // lesson page so they can edit and preview it. Non-admins see a clean
  // "Coming Soon" panel with a button back to the Masterclass list.
  if (!isAdmin && isLessonLocked(slug)) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-5 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-[#C9A44C]/15 flex items-center justify-center">
            <Lock className="w-6 h-6 text-[#C9A44C]" />
          </div>
          <h1
            className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.04em] text-white"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Coming Soon
          </h1>
          <p className="text-white/60 text-[14px] max-w-md leading-relaxed">
            This lesson is being finished off and will unlock for you shortly. In the meantime, head back to the Masterclass and keep moving on the lessons that are already live.
          </p>
          <button
            onClick={() => setLocation("/masterclass")}
            className="px-6 py-3 rounded-lg bg-[#C9A44C] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Back to Masterclass
          </button>
        </div>
      </PortalLayout>
    );
  }

  if (isError || !lesson) {
    const msg = (error as any)?.message || "";
    const isNotFound = /not found/i.test(msg);
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
          <p className="text-white/70 text-[15px]">
            {isNotFound ? "Lesson not found." : "We hit a snag loading this lesson."}
          </p>
          {!isNotFound && msg && (
            <p className="text-white/40 text-[12px] max-w-md">{msg}</p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="px-5 py-2.5 rounded-lg bg-[#C9A44C] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setLocation("/dashboard")}
              className="px-5 py-2.5 rounded-lg bg-white/[0.06] text-white/70 text-[12px] font-bold uppercase tracking-wider hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  const isTextOnlyLesson = TEXT_ONLY_LESSON_SLUGS.has(slug || "");

  // Local alias kept so the rest of the JSX below can keep referencing
  // `lessonOsLinks` without a sweeping rename. The real source of truth
  // is the module-scope LESSON_OS_LINKS constant above.
  const lessonOsLinks = LESSON_OS_LINKS;
  const osLink = lessonOsLinks[slug || ""];
  const isBrainLesson = slug === "about-you";
  // Build tab is shown only when this lesson has an OS or SOP linked
  // (anything entered in lessonOsLinks). Lessons with no OS or SOP
  // attached do not get an empty "Build" placeholder tab.
  const hideBuildTab = !osLink;
  // Text-only lessons (e.g. simple written pages like "Get 1-1 Help") show
  // only the Brief tab. The Notes, Build and Action Task tabs are all
  // suppressed so the page reads as a clean written page.
  // Main masterclass layout: a single Brief view. The video placeholder
  // sits above and the lesson notes render directly underneath the brief.
  // The Notes / Build / Action Task tabs are intentionally removed.
  const tabs: { key: TabKey; label: string; icon: typeof FileText }[] = [
    { key: "brief", label: "Brief", icon: FileText },
  ];

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <button
          onClick={() => {
            const phases = course || [];
            const phaseIdx = phases.findIndex((p: any) => p.lessons.some((l: any) => l.slug === slug));
            sessionStorage.setItem("os-expand-phase", String(phaseIdx >= 0 ? phaseIdx : 0));
            sessionStorage.setItem("os-scroll-to", slug || "");
            setLocation("/masterclass");
          }}
          className="flex items-center gap-2 text-[13px] text-white/65 hover:text-white/70 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Masterclass
        </button>

        {currentPhase && (
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            {currentPhase.title}
          </p>
        )}

        {editingTitle && isAdmin ? (
          <div className="mb-6">
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditingTitle(false);
                  setTitleError(null);
                }
              }}
              className="w-full bg-[#0a0a0a] border border-white/[0.12] focus:border-[#C9A44C] outline-none rounded-lg px-4 py-3 text-[24px] md:text-[32px] font-bold uppercase tracking-[0.01em] text-white"
              style={{ fontFamily: "var(--app-font-display)" }}
            />
            {titleError && (
              <p className="text-[12px] text-amber-400 mt-2">{titleError}</p>
            )}
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                disabled={titleSaving}
                onClick={() => {
                  setEditingTitle(false);
                  setTitleError(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/60 text-[11px] font-bold uppercase tracking-wider hover:bg-white/[0.08] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={titleSaving || !titleDraft.trim() || titleDraft.trim() === lesson.title}
                onClick={async () => {
                  const next = titleDraft.trim();
                  if (!next || next === lesson.title) {
                    setEditingTitle(false);
                    return;
                  }
                  setTitleSaving(true);
                  setTitleError(null);
                  try {
                    await api.admin.updateLessonTitle(slug, next);
                    queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
                    queryClient.invalidateQueries({ queryKey: ["course"] });
                    setEditingTitle(false);
                  } catch (err: any) {
                    setTitleError(err?.message || "Failed to save title");
                  } finally {
                    setTitleSaving(false);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A44C] text-white text-[11px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors disabled:opacity-50"
              >
                {titleSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save Title
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 mb-6 group">
            <h1
              className="text-[24px] md:text-[32px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              {lesson.title}
            </h1>
            {isAdmin && (
              <button
                onClick={() => {
                  setTitleDraft(lesson.title);
                  setEditingTitle(true);
                  setTitleError(null);
                }}
                title="Edit lesson title (admin)"
                className="shrink-0 mt-2 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] text-white/65 hover:text-[#C9A44C] hover:bg-[#C9A44C]/10 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {!isTextOnlyLesson && (
        <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden mb-0 group/video relative">
          <div className="relative aspect-video bg-[#111] flex items-center justify-center overflow-hidden">
            {lesson.wistiaVideoId ? (
              <WistiaPlayer
                mediaId={lesson.wistiaVideoId}
                title={lesson.title}
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <>
                <img
                  src={`${import.meta.env.BASE_URL}greg-video-poster.jpg`}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/45" />
                <div className="relative text-center">
                  <div className="w-16 h-16 rounded-full bg-[#C9A44C]/90 flex items-center justify-center mx-auto shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
                    <Play className="w-7 h-7 text-black ml-1" />
                  </div>
                  {isAdmin && (
                    <p className="mt-3 text-[12px] text-white/70 font-medium">
                      No video set yet — admins can add one below.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          {isAdmin && !editingVideo && (
            <button
              onClick={() => {
                setVideoDraft(lesson.wistiaVideoId || "");
                setVideoError(null);
                setEditingVideo(true);
              }}
              title="Set or change Wistia video (admin)"
              className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/70 backdrop-blur text-white/85 text-[11px] font-bold uppercase tracking-wider hover:bg-black/85 hover:text-[#C9A44C] opacity-0 group-hover/video:opacity-100 transition-all border border-white/10"
            >
              <Pencil className="w-3 h-3" />
              {lesson.wistiaVideoId ? "Edit Video" : "Add Video"}
            </button>
          )}
        </div>
        )}

        {!isTextOnlyLesson && isAdmin && editingVideo && (
          <div className="mt-3 mb-4 p-4 rounded-2xl bg-[#0a0a0a] border border-[#C9A44C]/30">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[12px] text-white/65 font-bold uppercase tracking-wider">
                Wistia Video
              </h4>
              {videoSaved && (
                <span className="text-[11px] text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Saved
                </span>
              )}
            </div>
            <input
              type="text"
              value={videoDraft}
              onChange={(e) => { setVideoDraft(e.target.value); setVideoError(null); }}
              autoFocus
              placeholder="Paste Wistia URL or hashed ID (e.g. qjbs542d7e)"
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditingVideo(false); setVideoError(null); }
              }}
              className="w-full bg-[#111] border border-white/[0.12] focus:border-[#C9A44C] outline-none rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/35 font-mono"
            />
            <p className="text-[11px] text-white/45 mt-2">
              Accepts the bare ID (e.g. <span className="text-white/65 font-mono">qjbs542d7e</span>) or any Wistia URL like <span className="text-white/65 font-mono">https://your-account.wistia.com/medias/qjbs542d7e</span>. Leave empty and save to clear the video.
            </p>
            {videoError && (
              <p className="text-[12px] text-amber-400 mt-2">{videoError}</p>
            )}
            <div className="flex items-center justify-between gap-2 mt-3">
              <button
                disabled={!lesson.wistiaVideoId}
                onClick={async () => {
                  setVideoError(null);
                  try {
                    await api.admin.updateLessonWistia(slug, null);
                    queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
                    queryClient.invalidateQueries({ queryKey: ["course"] });
                    setEditingVideo(false);
                    setVideoSaved(true);
                    setTimeout(() => setVideoSaved(false), 3000);
                  } catch (err: any) {
                    setVideoError(err?.message || "Failed to clear video");
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/55 text-[11px] font-bold uppercase tracking-wider hover:bg-red-500/10 hover:text-red-300 transition-colors disabled:opacity-30 disabled:hover:bg-white/[0.04] disabled:hover:text-white/55"
              >
                Clear Video
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditingVideo(false); setVideoError(null); }}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/60 text-[11px] font-bold uppercase tracking-wider hover:bg-white/[0.08] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const next = videoDraft.trim();
                    setVideoError(null);
                    try {
                      // Empty input is treated as "clear the video" so the
                      // Save action matches the helper text below the input.
                      await api.admin.updateLessonWistia(slug, next === "" ? null : next);
                      queryClient.invalidateQueries({ queryKey: ["lesson", slug] });
                      queryClient.invalidateQueries({ queryKey: ["course"] });
                      setEditingVideo(false);
                      setVideoSaved(true);
                      setTimeout(() => setVideoSaved(false), 3000);
                    } catch (err: any) {
                      setVideoError(err?.message || "Failed to save video");
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#C9A44C] text-white text-[11px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Save Video
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#0a0a0a] border border-white/[0.06] border-t-0 rounded-b-2xl overflow-hidden mb-8 -mt-[1px]">
          {tabs.length > 1 && !isTextOnlyLesson && (
          <div className="flex border-b border-white/[0.06] overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3.5 text-[13px] font-bold uppercase tracking-wider transition-all relative whitespace-nowrap ${
                  activeTab === tab.key
                    ? "text-white"
                    : "text-white/55 hover:text-white/60"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#C9A44C]" />
                )}
              </button>
            ))}
          </div>
          )}

          <div className={`p-6 md:p-8 min-h-[180px] ${isTextOnlyLesson ? "flex flex-col-reverse gap-8" : ""}`}>
            {(activeTab === "brief" || isTextOnlyLesson) && (
              <div>
                {notesFullscreen && lesson.notes && !editingNotes ? (
                  <div className="notes-fullscreen" data-theme={notesTheme}>
                    <div className="notes-fullscreen-header sticky top-0 z-10 px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3
                          className="notes-fullscreen-title text-[16px] font-bold uppercase"
                          style={{ fontFamily: "var(--app-font-display)" }}
                        >
                          {lesson.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={toggleNotesTheme}
                          title={notesTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                          className="notes-fullscreen-btn flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                        >
                          {notesTheme === "dark" ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
                          {notesTheme === "dark" ? "Light" : "Dark"}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => { setNotesFullscreen(false); startEditing(); }}
                            className="notes-fullscreen-btn notes-fullscreen-btn-accent flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => setNotesFullscreen(false)}
                          className="notes-fullscreen-btn flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Minimize2 className="w-3 h-3" />
                          Exit
                        </button>
                      </div>
                    </div>
                    <div style={{ userSelect: "none", WebkitUserSelect: "none" }}>
                      <RichTextViewer content={lesson.notes} />
                    </div>
                  </div>
                ) : (
                  <>
                    {isAdmin && !editingNotes && (
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                          Lesson Notes
                        </h4>
                        <div className="flex items-center gap-2">
                          {notesSaved && (
                            <span className="text-[11px] text-green-400 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Saved
                            </span>
                          )}
                          {lesson.notes && (
                            <button
                              onClick={() => setNotesFullscreen(true)}
                              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-white/70 hover:bg-white/[0.08] transition-all"
                            >
                              <Maximize2 className="w-3 h-3" />
                              Full Screen
                            </button>
                          )}
                          <button
                            onClick={() => setShowGenerateModal(true)}
                            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-[#C9A44C]/10 text-[#C9A44C] hover:bg-[#C9A44C]/20 border border-[#C9A44C]/20 transition-all"
                          >
                            <Sparkles className="w-3 h-3" />
                            Generate with AI
                          </button>
                          <button
                            onClick={() => setShowDiagramModal(true)}
                            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-white/70 hover:bg-white/[0.08] transition-all"
                          >
                            <Image className="w-3 h-3" />
                            AI Diagram
                          </button>
                          <button
                            onClick={startEditing}
                            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-[#C9A44C] hover:bg-[#C9A44C]/10 transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                            {lesson.notes ? "Edit Notes" : "Write Notes"}
                          </button>
                        </div>
                      </div>
                    )}

                    {!isAdmin && !editingNotes && lesson.notes && (
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                          Lesson Notes
                        </h4>
                        <button
                          onClick={() => setNotesFullscreen(true)}
                          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-white/70 hover:bg-white/[0.08] transition-all"
                        >
                          <Maximize2 className="w-3 h-3" />
                          Full Screen
                        </button>
                      </div>
                    )}

                    {editingNotes && isAdmin ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                            Editing Notes
                          </h4>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEditingNotes(false)}
                              className="flex items-center gap-1.5 text-[12px] text-white/65 hover:text-white/70 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </button>
                            <button
                              onClick={() => saveNotesMutation.mutate(notesContent)}
                              disabled={saveNotesMutation.isPending}
                              className="flex items-center gap-1.5 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <Save className="w-3 h-3" />
                              {saveNotesMutation.isPending ? "Saving..." : "Save Notes"}
                            </button>
                          </div>
                        </div>
                        <RichTextEditor
                          content={notesContent}
                          onChange={setNotesContent}
                          editable={true}
                          placeholder="Write your lesson notes here... Use emoji headings like 🔴 WHAT: / 🟠 WHY: / 🟢 HOW: — add callout blocks with blockquotes, images, links, and more."
                        />
                      </div>
                    ) : lesson.notes ? (
                      <>
                        <div style={{ userSelect: "none", WebkitUserSelect: "none" }}>
                          <RichTextViewer content={lesson.notes} />
                        </div>
                        {isAdmin && (
                          <div className="mt-4 pt-4 border-t border-white/[0.06]">
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={aiEditPrompt}
                                onChange={(e) => setAiEditPrompt(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && aiEditPrompt.trim() && !editNotesAiMutation.isPending && !saveNotesMutation.isPending) {
                                    e.preventDefault();
                                    const promptText = aiEditPrompt;
                                    try {
                                      const data: any = await editNotesAiMutation.mutateAsync({ currentHtml: lesson.notes, editPrompt: promptText });
                                      if (data?.html) saveNotesMutation.mutate(data.html);
                                    } catch (err: any) {
                                      console.error("AI edit failed:", err);
                                    }
                                  }
                                }}
                                placeholder="Ask AI to edit these notes... e.g. 'Shorten the intro' or paste a long set of edit instructions. Press Cmd/Ctrl+Enter to send."
                                rows={6}
                                className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none font-sans resize-y min-h-[140px] leading-relaxed"
                              />
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] text-white/35">
                                  {aiEditPrompt.length.toLocaleString()} characters
                                  {editNotesAiMutation.isError && (
                                    <span className="ml-3 text-amber-400">
                                      {(editNotesAiMutation.error as any)?.message || "Failed to edit. Try again."}
                                    </span>
                                  )}
                                  {saveNotesMutation.isError && !editNotesAiMutation.isError && (
                                    <span className="ml-3 text-amber-400">
                                      Saved failed: {(saveNotesMutation.error as any)?.message || "Try again."}
                                    </span>
                                  )}
                                </span>
                                <button
                                  onClick={async () => {
                                    if (!aiEditPrompt.trim() || editNotesAiMutation.isPending || saveNotesMutation.isPending) return;
                                    const promptText = aiEditPrompt;
                                    try {
                                      const data: any = await editNotesAiMutation.mutateAsync({ currentHtml: lesson.notes, editPrompt: promptText });
                                      if (data?.html) saveNotesMutation.mutate(data.html);
                                    } catch (err: any) {
                                      console.error("AI edit failed:", err);
                                    }
                                  }}
                                  disabled={!aiEditPrompt.trim() || editNotesAiMutation.isPending || saveNotesMutation.isPending}
                                  className="flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 border border-white/[0.08]"
                                >
                                  {editNotesAiMutation.isPending || saveNotesMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-4 h-4" />
                                  )}
                                  {editNotesAiMutation.isPending ? "Editing..." : saveNotesMutation.isPending ? "Saving..." : "AI Edit"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-6">
                        <BookOpen className="w-8 h-8 text-white/15 mx-auto mb-3" />
                        <p className="text-[14px] text-white/55 italic">No notes added yet for this lesson.</p>
                        {isAdmin && (
                          <button
                            onClick={startEditing}
                            className="mt-3 text-[12px] text-[#C9A44C]/60 hover:text-[#C9A44C] transition-colors"
                          >
                            Click to add notes
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {showGenerateModal && isAdmin && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#141414] border border-white/[0.08] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
                      <div className="sticky top-0 bg-[#141414] border-b border-white/[0.06] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-[#C9A44C]" />
                          <h3 className="text-[15px] font-bold uppercase text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                            AI Notes Generator
                          </h3>
                        </div>
                        <button
                          onClick={() => { setShowGenerateModal(false); setGeneratedPreview(""); setTranscriptInput(""); setContextInput(""); setNoteStyle("structured"); setAiEditPrompt(""); }}
                          className="text-white/65 hover:text-white/70 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="p-6 space-y-5">
                        {!generatedPreview ? (
                          <>
                            <div>
                              <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                                Transcript / Lesson Content *
                              </label>
                              <textarea
                                value={transcriptInput}
                                onChange={(e) => setTranscriptInput(e.target.value)}
                                rows={12}
                                placeholder="Paste your lesson transcript, script, or raw content here..."
                                className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none resize-y font-sans"
                              />
                              <p className="text-[11px] text-white/50 mt-1">
                                {transcriptInput.length.toLocaleString()} / 100,000 characters
                              </p>
                            </div>

                            <div>
                              <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                                Additional Context (optional)
                              </label>
                              <textarea
                                value={contextInput}
                                onChange={(e) => setContextInput(e.target.value)}
                                rows={3}
                                placeholder="E.g. 'Focus on the email marketing angle' or 'This is about building AI chatbots for lead gen'"
                                className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none resize-y font-sans"
                              />
                            </div>

                            <div>
                              <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                                Note Style
                              </label>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => setNoteStyle("structured")}
                                  className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                                    noteStyle === "structured"
                                      ? "border-[#C9A44C] bg-[#C9A44C]/10"
                                      : "border-white/[0.08] bg-[#0a0a0a] hover:border-white/20"
                                  }`}
                                >
                                  <div className="text-[13px] font-bold text-white/90">🔴 What, Why & How</div>
                                  <div className="text-[11px] text-white/65 mt-0.5">Structured teaching format with action tasks</div>
                                </button>
                                <button
                                  onClick={() => setNoteStyle("general")}
                                  className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                                    noteStyle === "general"
                                      ? "border-[#C9A44C] bg-[#C9A44C]/10"
                                      : "border-white/[0.08] bg-[#0a0a0a] hover:border-white/20"
                                  }`}
                                >
                                  <div className="text-[13px] font-bold text-white/90">📝 General Summary</div>
                                  <div className="text-[11px] text-white/65 mt-0.5">Overview, key points & takeaways</div>
                                </button>
                              </div>
                            </div>

                            {generateNotesMutation.isError && (
                              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-[13px] text-amber-400">
                                {(generateNotesMutation.error as any)?.message || "Failed to generate notes. Please try again."}
                              </div>
                            )}

                            <div className="flex items-center justify-end gap-3 pt-2">
                              <button
                                onClick={() => { setShowGenerateModal(false); setTranscriptInput(""); setContextInput(""); setNoteStyle("structured"); }}
                                className="text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => generateNotesMutation.mutate({ transcript: transcriptInput, context: contextInput || undefined, style: noteStyle })}
                                disabled={!transcriptInput.trim() || generateNotesMutation.isPending}
                                className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {generateNotesMutation.isPending ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-4 h-4" />
                                    Generate Notes
                                  </>
                                )}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-2">
                              <Eye className="w-4 h-4 text-[#C9A44C]" />
                              <h4 className="text-[12px] text-white/50 font-bold uppercase tracking-wider">
                                Preview Generated Notes
                              </h4>
                            </div>

                            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-xl p-6 max-h-[40vh] overflow-y-auto">
                              <RichTextViewer content={generatedPreview} />
                            </div>

                            <div className="mt-3">
                              <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                                <Sparkles className="w-3 h-3 inline mr-1" />
                                AI Edit — Tell AI what to change
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={aiEditPrompt}
                                  onChange={(e) => setAiEditPrompt(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && aiEditPrompt.trim() && !editNotesAiMutation.isPending) {
                                      editNotesAiMutation.mutate({ currentHtml: generatedPreview, editPrompt: aiEditPrompt });
                                    }
                                  }}
                                  placeholder="E.g. 'Make the intro shorter' or 'Add more detail to the HOW section' or 'Remove the action tasks'"
                                  className="flex-1 bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none font-sans"
                                />
                                <button
                                  onClick={() => editNotesAiMutation.mutate({ currentHtml: generatedPreview, editPrompt: aiEditPrompt })}
                                  disabled={!aiEditPrompt.trim() || editNotesAiMutation.isPending}
                                  className="flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 border border-white/[0.08]"
                                >
                                  {editNotesAiMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-4 h-4" />
                                  )}
                                  {editNotesAiMutation.isPending ? "Editing..." : "Apply"}
                                </button>
                              </div>
                              {editNotesAiMutation.isError && (
                                <p className="text-[11px] text-amber-400 mt-1">
                                  {(editNotesAiMutation.error as any)?.message || "Failed to edit. Try again."}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between pt-2">
                              <button
                                onClick={() => { setGeneratedPreview(""); setAiEditPrompt(""); }}
                                className="flex items-center gap-1.5 text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                              >
                                <ArrowLeft className="w-3 h-3" />
                                Back to Edit
                              </button>
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => {
                                    setNotesContent(generatedPreview);
                                    setEditingNotes(true);
                                    setShowGenerateModal(false);
                                    setGeneratedPreview("");
                                    setTranscriptInput("");
                                    setContextInput("");
                                    setAiEditPrompt("");
                                  }}
                                  className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Edit Manually
                                </button>
                                <button
                                  onClick={() => {
                                    saveNotesMutation.mutate(generatedPreview, {
                                      onSuccess: () => {
                                        setShowGenerateModal(false);
                                        setGeneratedPreview("");
                                        setTranscriptInput("");
                                        setContextInput("");
                                        setAiEditPrompt("");
                                      },
                                    });
                                  }}
                                  disabled={saveNotesMutation.isPending}
                                  className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                                >
                                  {saveNotesMutation.isPending ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Saving...
                                    </>
                                  ) : (
                                    <>
                                      <Save className="w-4 h-4" />
                                      Save Notes
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {showDiagramModal && isAdmin && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <div className="bg-[#141414] border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
                  <div className="sticky top-0 bg-[#141414] border-b border-white/[0.06] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                    <div className="flex items-center gap-2">
                      <Image className="w-4 h-4 text-[#C9A44C]" />
                      <h3 className="text-[15px] font-bold uppercase text-white" style={{ fontFamily: "var(--app-font-display)" }}>
                        AI Diagram Generator
                      </h3>
                    </div>
                    <button
                      onClick={() => { setShowDiagramModal(false); setDiagramDescription(""); setGeneratedDiagramUrl(""); setDiagramType("flowchart"); diagramMutation.reset(); }}
                      className="text-white/65 hover:text-white/70 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-6 space-y-5">
                    {!generatedDiagramUrl ? (
                      <>
                        <div>
                          <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                            Diagram Type
                          </label>
                          <div className="flex gap-2 flex-wrap">
                            {[
                              { value: "flowchart", label: "Flowchart" },
                              { value: "process", label: "Process / Steps" },
                              { value: "funnel", label: "Funnel" },
                              { value: "comparison", label: "Comparison" },
                              { value: "hierarchy", label: "Hierarchy" },
                              { value: "cycle", label: "Cycle" },
                              { value: "infographic", label: "Infographic" },
                            ].map((t) => (
                              <button
                                key={t.value}
                                onClick={() => setDiagramType(t.value)}
                                className={`px-3 py-1.5 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-all border ${
                                  diagramType === t.value
                                    ? "border-[#C9A44C] bg-[#C9A44C]/10 text-[#C9A44C]"
                                    : "border-white/[0.08] bg-[#0a0a0a] text-white/65 hover:text-white/60 hover:border-white/20"
                                }`}
                              >
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[12px] text-white/50 font-bold uppercase tracking-wider mb-2">
                            Describe Your Diagram *
                          </label>
                          <textarea
                            value={diagramDescription}
                            onChange={(e) => setDiagramDescription(e.target.value)}
                            rows={6}
                            placeholder={"Describe what the diagram should show. For example:\n\n'A 5-step funnel: Build low-ticket offer → Create organic content → Run engagement ads → Retarget with direct response → Convert to high-ticket ($5K-$100K+)'"}
                            className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white/90 placeholder-white/20 focus:border-[#C9A44C]/40 focus:outline-none resize-y font-sans"
                          />
                        </div>

                        {diagramMutation.isError && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-[13px] text-amber-400">
                            {(diagramMutation.error as any)?.message || "Failed to generate diagram. Please try again."}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-3 pt-2">
                          <button
                            onClick={() => { setShowDiagramModal(false); setDiagramDescription(""); setDiagramType("flowchart"); }}
                            className="text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => diagramMutation.mutate({ description: diagramDescription, type: diagramType })}
                            disabled={!diagramDescription.trim() || diagramMutation.isPending}
                            className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {diagramMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Image className="w-4 h-4" />
                                Generate Diagram
                              </>
                            )}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Eye className="w-4 h-4 text-[#C9A44C]" />
                          <h4 className="text-[12px] text-white/50 font-bold uppercase tracking-wider">
                            Generated Diagram
                          </h4>
                        </div>

                        <div className="bg-white border border-white/[0.08] rounded-xl p-4 flex items-center justify-center overflow-auto">
                          <div
                            dangerouslySetInnerHTML={{ __html: generatedDiagramUrl }}
                            className="w-full [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-w-full"
                          />
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <button
                            onClick={() => { setGeneratedDiagramUrl(""); diagramMutation.reset(); }}
                            className="flex items-center gap-1.5 text-[12px] text-white/65 hover:text-white/70 px-4 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                          >
                            <ArrowLeft className="w-3 h-3" />
                            Generate Another
                          </button>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                const svgHtml = `<div style="width:100%;margin:16px 0;background:#fff;border-radius:12px;padding:16px;">${generatedDiagramUrl}</div>`;
                                navigator.clipboard.writeText(svgHtml);
                              }}
                              className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                              Copy HTML
                            </button>
                            <button
                              onClick={() => {
                                const svgHtml = `<div style="width:100%;margin:16px 0;background:#fff;border-radius:12px;padding:16px;">${generatedDiagramUrl}</div>`;
                                const currentNotes = lesson.notes || "";
                                const updatedNotes = currentNotes + "\n" + svgHtml;
                                saveNotesMutation.mutate(updatedNotes, {
                                  onSuccess: () => {
                                    setShowDiagramModal(false);
                                    setGeneratedDiagramUrl("");
                                    setDiagramDescription("");
                                    setDiagramType("flowchart");
                                  },
                                });
                              }}
                              disabled={saveNotesMutation.isPending}
                              className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                            >
                              {saveNotesMutation.isPending ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Inserting...
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4" />
                                  Insert Into Notes
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "build" && osLink && (
              <div className="space-y-6">
              <div className="bg-gradient-to-br from-[#C9A44C]/10 via-[#111] to-[#111] border border-[#C9A44C]/30 rounded-2xl p-8 md:p-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#C9A44C]/15 mb-5">
                  <Wrench className="w-6 h-6 text-[#C9A44C]" />
                </div>
                <h3 className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white mb-2" style={{ fontFamily: "var(--app-font-display)" }}>
                  {osLink.panelTitle}
                </h3>
                <p className="text-[14px] text-white/60 max-w-[560px] mx-auto mb-6 leading-relaxed">
                  {osLink.panelDescription}
                </p>
                {osLink.steps && osLink.steps.length > 0 && (
                  <ol className="text-left max-w-[640px] mx-auto mb-8 space-y-3">
                    {osLink.steps.map((step, idx) => (
                      <li
                        key={idx}
                        className="flex gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                      >
                        <span
                          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#C9A44C]/15 text-[#C9A44C] text-[13px] font-bold"
                          style={{ fontFamily: "var(--app-font-display)" }}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <div className="text-[14px] font-bold text-white uppercase tracking-wider mb-1">
                            {step.title}
                          </div>
                          <div className="text-[13px] text-white/60 leading-relaxed">
                            {step.description}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <button
                  onClick={() => setLocation(osLink.route)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#C9A44C] text-white text-[12px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors"
                >
                  {osLink.ctaLabel}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {osLink.extras && osLink.extras.map((extra, idx) => (
                <div key={idx} className="bg-gradient-to-br from-[#C9A44C]/10 via-[#111] to-[#111] border border-[#C9A44C]/30 rounded-2xl p-8 md:p-10 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#C9A44C]/15 mb-5">
                    <Wrench className="w-6 h-6 text-[#C9A44C]" />
                  </div>
                  <h3 className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white mb-2" style={{ fontFamily: "var(--app-font-display)" }}>
                    {extra.panelTitle}
                  </h3>
                  <p className="text-[14px] text-white/60 max-w-[560px] mx-auto mb-6 leading-relaxed">
                    {extra.panelDescription}
                  </p>
                  <button
                    onClick={() => setLocation(extra.route)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#C9A44C] text-white text-[12px] font-bold uppercase tracking-wider hover:bg-[#C9A44C]/90 transition-colors"
                  >
                    {extra.ctaLabel}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              </div>
            )}

            {activeTab === "build" && !hideBuildTab && (() => {
              const existing = Array.isArray(lesson.downloadFiles)
                ? (lesson.downloadFiles as any[])
                : lesson.downloadFiles
                  ? [lesson.downloadFiles as any]
                  : [];
              const normalised = existing.map((f: any, i: number) =>
                typeof f === "string"
                  ? { url: f, name: `File ${i + 1}` }
                  : { url: f?.url || "", name: f?.name || `File ${i + 1}` }
              ).filter((f) => f.url);
              if (normalised.length === 0 && !isAdmin) return null;
              return (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">Downloads</h4>
                    {isAdmin && !editingDownloads && (
                      <button
                        onClick={() => {
                          setDownloadDrafts(normalised.length > 0 ? normalised : [{ url: "", name: "" }]);
                          setDownloadsError(null);
                          setEditingDownloads(true);
                        }}
                        className="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-[#C9A44C] hover:bg-[#C9A44C]/10 transition-all"
                      >
                        {downloadsSaved ? "Saved" : normalised.length > 0 ? "Manage" : "Add Download"}
                      </button>
                    )}
                  </div>
                  {!editingDownloads && normalised.length > 0 && (
                    <div className="space-y-2">
                      {normalised.map((file, i) => (
                        <a
                          key={i}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 bg-[#111] border border-white/[0.06] rounded-lg px-4 py-3 hover:border-[#C9A44C]/30 transition-colors group"
                        >
                          <Download className="w-4 h-4 text-[#C9A44C]" />
                          <span className="text-[13px] text-white/70 group-hover:text-white transition-colors">
                            {file.name}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  {isAdmin && editingDownloads && (
                    <div className="bg-[#111] border border-white/[0.06] rounded-xl p-4 space-y-3">
                      <p className="text-[12px] text-white/50">
                        Paste a public URL to any file (zip, pdf, etc). Host on Google Drive, Dropbox, S3, or anywhere with a direct link. Make sure the link is set to public/anyone with the link.
                      </p>
                      {downloadDrafts.map((d, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={d.name}
                              onChange={(e) => {
                                const next = [...downloadDrafts];
                                next[i] = { ...next[i], name: e.target.value };
                                setDownloadDrafts(next);
                              }}
                              placeholder="Display name (e.g. Course Templates.zip)"
                              className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/40"
                            />
                            <input
                              type="url"
                              value={d.url}
                              onChange={(e) => {
                                const next = [...downloadDrafts];
                                next[i] = { ...next[i], url: e.target.value };
                                setDownloadDrafts(next);
                              }}
                              placeholder="https://..."
                              className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/40 font-mono"
                            />
                          </div>
                          <button
                            onClick={() => setDownloadDrafts(downloadDrafts.filter((_, idx) => idx !== i))}
                            className="text-[11px] text-white/50 hover:text-amber-400 px-2 py-2"
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setDownloadDrafts([...downloadDrafts, { url: "", name: "" }])}
                        className="text-[12px] text-white/60 hover:text-[#C9A44C] font-bold uppercase tracking-wider"
                      >
                        + Add another file
                      </button>
                      {downloadsError && (
                        <p className="text-[12px] text-amber-400">{downloadsError}</p>
                      )}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => {
                            const cleaned = downloadDrafts
                              .map((d) => ({ url: d.url.trim(), name: d.name.trim() }))
                              .filter((d) => d.url);
                            saveDownloadsMutation.mutate(cleaned.length > 0 ? cleaned : null);
                          }}
                          disabled={saveDownloadsMutation.isPending}
                          className="bg-[#C9A44C] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-[#C9A44C]/90 disabled:opacity-50"
                        >
                          {saveDownloadsMutation.isPending ? "Saving..." : "Save Downloads"}
                        </button>
                        <button
                          onClick={() => {
                            setEditingDownloads(false);
                            setDownloadsError(null);
                          }}
                          className="text-white/60 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-white/[0.06]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === "action" && (
              <div>
                {isAdmin && !editingActionTasks && (
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <h4 className="text-[13px] text-white/50 font-bold uppercase tracking-wider">
                      Action Tasks
                    </h4>
                    <button
                      onClick={() => {
                        setActionTaskDrafts(lessonActionTasks.length > 0 ? [...lessonActionTasks] : [""]);
                        setActionTasksError(null);
                        setEditingActionTasks(true);
                      }}
                      className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/65 hover:text-[#C9A44C] hover:bg-[#C9A44C]/10 transition-all"
                    >
                      <Pencil className="w-3 h-3" />
                      {lessonActionTasks.length > 0 ? "Edit Action Tasks" : "Add Action Tasks"}
                    </button>
                  </div>
                )}

                {editingActionTasks && isAdmin ? (
                  <div className="space-y-3">
                    {actionTaskDrafts.map((task, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className="flex-1">
                          <textarea
                            value={task}
                            onChange={(e) => {
                              const next = [...actionTaskDrafts];
                              next[idx] = e.target.value;
                              setActionTaskDrafts(next);
                            }}
                            rows={2}
                            placeholder="One short, concrete action the student should take after this lesson"
                            className="w-full bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-[14px] text-white/85 placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/40 resize-y"
                            maxLength={500}
                          />
                        </div>
                        <button
                          onClick={() => {
                            const next = actionTaskDrafts.filter((_, i) => i !== idx);
                            setActionTaskDrafts(next.length > 0 ? next : [""]);
                          }}
                          className="mt-1 text-white/40 hover:text-amber-400 p-2"
                          title="Remove this task"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        if (actionTaskDrafts.length >= 10) return;
                        setActionTaskDrafts([...actionTaskDrafts, ""]);
                      }}
                      disabled={actionTaskDrafts.length >= 10}
                      className="text-[12px] font-bold uppercase tracking-wider text-[#C9A44C]/80 hover:text-[#C9A44C] disabled:opacity-40"
                    >
                      + Add another task
                    </button>
                    {actionTasksError && (
                      <p className="text-[12px] text-amber-400">{actionTasksError}</p>
                    )}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          const cleaned = actionTaskDrafts.map((t) => t.trim()).filter(Boolean);
                          saveActionTasksMutation.mutate(cleaned);
                        }}
                        disabled={saveActionTasksMutation.isPending}
                        className="bg-[#C9A44C] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-[#C9A44C]/90 disabled:opacity-50"
                      >
                        {saveActionTasksMutation.isPending ? "Saving..." : "Save Action Tasks"}
                      </button>
                      <button
                        onClick={() => {
                          setEditingActionTasks(false);
                          setActionTasksError(null);
                        }}
                        className="text-white/60 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-white/[0.06]"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[11px] text-white/40 pt-1">
                      Tip: keep each task to one short imperative sentence. To clear all tasks, remove each row and save.
                    </p>
                  </div>
                ) : lessonActionTasks.length > 0 ? (
                  <div className="space-y-3">
                    {lessonActionTasks.map((taskText, idx) => {
                      const done = Boolean(actionTasksCompleted[idx]);
                      const pending = actionTaskAtMutation.isPending && actionTaskAtMutation.variables?.index === idx;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (pending) return;
                            actionTaskAtMutation.mutate({ index: idx, completed: !done });
                          }}
                          className={`flex items-start gap-4 bg-[#111] border rounded-xl p-5 cursor-pointer transition-all ${
                            done
                              ? "border-green-500/30 bg-green-500/5"
                              : "border-white/[0.06] hover:border-[#C9A44C]/20"
                          } ${pending ? "opacity-70" : ""}`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {done ? (
                              <CheckSquare className="w-5 h-5 text-green-400" />
                            ) : (
                              <Square className="w-5 h-5 text-white/55" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className={`text-[14px] leading-[1.7] ${done ? "text-white/50 line-through" : "text-white/80"}`}>
                              {taskText}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {actionTasksCompleted.length === lessonActionTasks.length &&
                      actionTasksCompleted.every(Boolean) && (
                        <p className="text-[12px] text-green-400/70 flex items-center gap-1.5 pt-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          All action tasks completed
                        </p>
                      )}
                  </div>
                ) : lesson.actionTask ? (
                  // Legacy single-task fallback for lessons that have not yet
                  // been migrated to the new actionTasks array.
                  <div className="space-y-5">
                    <div
                      onClick={() => actionTaskMutation.mutate(!isActionTaskDone)}
                      className={`flex items-start gap-4 bg-[#111] border rounded-xl p-5 cursor-pointer transition-all ${
                        isActionTaskDone
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-white/[0.06] hover:border-[#C9A44C]/20"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isActionTaskDone ? (
                          <CheckSquare className="w-5 h-5 text-green-400" />
                        ) : (
                          <Square className="w-5 h-5 text-white/55" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={`text-[14px] leading-[1.7] ${isActionTaskDone ? "text-white/50 line-through" : "text-white/80"}`}>
                          {lesson.actionTask}
                        </p>
                      </div>
                    </div>
                    {isActionTaskDone && (
                      <p className="text-[12px] text-green-400/60 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Action task completed
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <ListChecks className="w-8 h-8 text-white/15 mx-auto mb-3" />
                    <p className="text-[14px] text-white/55 italic">No action task set for this lesson.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-10">
          {!isCompleted ? (
            <button
              onClick={() => markCompleteMutation.mutate()}
              disabled={markCompleteMutation.isPending}
              className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[13px] font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {markCompleteMutation.isPending ? "Marking..." : "Mark as Complete"}
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-green-500/15 text-green-400 text-[13px] font-bold px-6 py-3 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              Completed
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-6 mb-20 md:mb-16 border-t border-white/[0.06]">
          {prevLesson ? (
            <button
              onClick={() => setLocation(`/lesson/${prevLesson.slug}`)}
              className="flex items-center gap-2 text-[13px] text-white/50 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">{prevLesson.title}</span>
              <span className="sm:hidden">Previous</span>
            </button>
          ) : (
            <div />
          )}

          {nextLesson ? (
            <button
              onClick={() => setLocation(`/lesson/${nextLesson.slug}`)}
              className="flex items-center gap-2 text-[13px] text-[#C9A44C] hover:text-white transition-colors font-medium"
            >
              <span className="hidden sm:inline">{nextLesson.title}</span>
              <span className="sm:hidden">Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
