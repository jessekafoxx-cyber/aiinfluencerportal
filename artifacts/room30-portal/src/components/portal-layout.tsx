// hint: Logic changed on both sides. Requires understanding intent of each change.
import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type OsToolSaveJob,
  getImpersonationMeta,
  clearImpersonation,
  stopImpersonationBeforeSignOut,
  trackEvent,
  type ImpersonationMeta,
} from "@/lib/api";
import { Room30Logo } from "@/components/room30-logo";
import {
  DfyAnnouncementBar,
  DFY_BAR_HEIGHT_PX,
  isDfyBarDismissed,
} from "@/components/dfy-announcement-bar";
import { Loader2, History, CheckCircle2, AlertCircle, RotateCw, X as XIcon } from "lucide-react";
import { PurchasingMovedNotice } from "@/components/purchasing-moved-notice";
import { usePurchaseLinks } from "@/hooks/use-purchase-links";
import { useUnlockCelebration } from "@/hooks/use-unlock-celebration";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AnnouncementPopup } from "@/components/announcement-popup";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  LogOut,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  PanelLeftOpen,
  Shield,
  Menu,
  X,
  HelpCircle,
  Settings,
  Cpu,
  Crown,
  ShoppingBag,
  Monitor,
  Grid3X3,
  LayoutDashboard,
  Brain,
  Mail,
  Lock,
  Film,
  Clapperboard,
  BookOpen,
  Users,
  GraduationCap,
  Video,
  Trash2,
  Pencil,
  ExternalLink,
  Clock,
  Image as ImageIcon,
  Package,
  Share2,
  CalendarDays,
  CalendarCheck,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { isPrelaunchLocked } from "@/lib/prelaunch-lock";
import { userCapabilities } from "@/lib/capabilities";

type PortalUpsellSlug =
  | "tiktok-slideshow-masterclass"
  | "hook-demo-library"
  | "done-for-you-pack"
  | "our-portfolio"
  | "platinum-club"
  | "order-bump-3"
  | "order-bump-2";

type PortalUpsellPaidKey =
  | "tiktokSlideshowPaid"
  | "hookDemoPaid"
  | "doneForYouPackPaid"
  | "portfolioPaid"
  | "upsell1Paid"
  | "upsell2Paid"
  | "downsell1Paid"
  | "platinumPaid"
  | "upsell3Paid"
  | "bump3Paid"
  | "bump2Paid";

type PortalUpsell = {
  href: string;
  label: string;
  icon: any;
  slug: PortalUpsellSlug;
  // Per-item price for items already on sale. New "Coming soon" items
  // omit this and render a Coming soon badge instead.
  price?: number;
  paidKey: PortalUpsellPaidKey;
  description: string;
  // True for the new placeholder upgrades whose pricing/Stripe flow is
  // not wired in yet. The sidebar shows a "Coming soon" pill instead of
  // a price + lock icon, and clicking the row is a no-op (toast).
  comingSoon?: boolean;
  // Optional override of the slug sent to /portal/charge-addon. Used
  // when two sidebar rows share the same underlying purchase (e.g. the
  // bump3 order bump unlocks both the TikTok AI Slideshow Masterclass
  // and the IG Follower Hijack pages, so clicking buy on either row
  // routes to the same `order-bump-3` charge).
  chargeSlug?: PortalUpsellSlug;
  // Additional paid-flag keys that should also be treated as "unlocked"
  // for this row. Used by the TikTok AI Slideshow Masterclass row to
  // honour legacy `tiktokSlideshowPaid` comps in addition to the new
  // bump3Paid bundle path.
  extraPaidKeys?: PortalUpsellPaidKey[];
  // Default external purchase URL (standalone funnel page) opened in a
  // new tab when a locked row is clicked. An admin-configured link for
  // the same product slug (admin Products page → "Purchase URL",
  // surfaced via usePurchaseLinks) always takes precedence, so template
  // installs can point each row at their own GHL sales page.
  purchaseUrl?: string;
};

// Sidebar ordering: 5 new "Coming soon" placeholders first, then the
// two existing live add-ons (IG Follower Hijack + Daily Ad Research
// Board). VSL Templates Pack and 1-on-1 Strategy Call have been removed
// from the sidebar; their pages and bump1Paid/upsell3Paid flags remain
// intact for buyers who already paid.
const PORTAL_UPSELLS: PortalUpsell[] = [
  {
    href: "/hook-demo-library",
    label: "2,000 Hook Library",
    icon: BookOpen,
    slug: "order-bump-2",
    price: 27,
    paidKey: "bump2Paid",
    description:
      "Every proven hook formula my team and I use - 2,000+ openers across Educational, Curiosity, Alex Hormozi (bonus) and 7 more categories.",
    // No default purchaseUrl: the old Stripe Checkout link is retired.
    // Configure a GHL sales page on the admin Products page instead.
  },
  {
    href: "/done-for-you-pack",
    label: "Done For You Pack",
    icon: Package,
    slug: "done-for-you-pack",
    price: 197,
    paidKey: "doneForYouPackPaid",
    // The funnel DFY SKU flips upsell1Paid / downsell1Paid (Greg AI
    // monthly/trial path) and delivers the same Done For You Pack page,
    // so a funnel buyer must see this row unlocked too. Mirrors the
    // portfolioPaid || upsell2Paid equivalence used for Our Portfolio.
    extraPaidKeys: ["upsell1Paid", "downsell1Paid"],
    description:
      "Plug-and-play creative pack - scripts, hooks, and assets ready to launch.",
    // No default purchaseUrl: configure a sales page on the admin
    // Products page instead.
  },
  {
    href: "/our-portfolio",
    label: "Our Portfolio",
    icon: ImageIcon,
    slug: "our-portfolio",
    price: 297,
    paidKey: "portfolioPaid",
    // upsell2 (funnel "Our Portfolio" SKU, flips upsell2Paid) delivers the
    // exact same page as the portfolio sidebar add-on (portfolioPaid), so a
    // funnel-upsell buyer must see this row unlocked too. Mirrors the
    // platinumPaid || upsell3Paid equivalence used for Platinum Club.
    extraPaidKeys: ["upsell2Paid"],
    description:
      "47 digital products and 5 unique AI influencers - the full behind-the-scenes portfolio of offers, funnels and ads we've built and run.",
    // No default purchaseUrl: configure a sales page on the admin
    // Products page instead.
  },
  {
    // Platinum Club is rendered as its own standalone, premium-styled
    // sidebar row (see the dedicated button below the My Influencers entry)
    // and is intentionally skipped inside the PORTAL_UPSELLS render map.
    // It is kept in this list so that shared lookups (e.g. the Stripe
    // hosted-checkout `addon_unlocked` return handler that does
    // `PORTAL_UPSELLS.find(u => u.slug === unlockedSlug)`) still resolve
    // it correctly.
    href: "/platinum-club",
    label: "Platinum Club",
    icon: Crown,
    slug: "platinum-club",
    price: 97,
    paidKey: "platinumPaid",
    // Platinum Club also unlocks via the funnel upsell3/downsell3 path
    // (upsell3Paid). Mirror the server-side OR-merge so the single
    // source-of-truth helper treats a funnel buyer as already owning it.
    extraPaidKeys: ["upsell3Paid"],
    description:
      "Inner-circle group with the highest-touch coaching and direct access to our team. $97/month - card details confirmed on Stripe's secure checkout.",
    // No default purchaseUrl: configure a sales page on the admin
    // Products page instead.
  },
  // The two rows below are deliberately the last entries in the
   // upgrades list so they sit visually next to each other. Both are
   // unlocked by a single $37 purchase of the bump3 order bump - the
   // TikTok row's `chargeSlug` redirects its buy click to the same
   // `order-bump-3` charge so either row triggers the same one-time
   // charge and flips both rows to "paid" via `bump3Paid`.
  {
    href: "/tiktok-slideshow-masterclass",
    label: "TikTok AI Slideshow Masterclass",
    icon: Video,
    slug: "tiktok-slideshow-masterclass",
    price: 37,
    paidKey: "bump3Paid",
    chargeSlug: "order-bump-3",
    extraPaidKeys: ["tiktokSlideshowPaid"],
    description:
      "Step-by-step masterclass on the slideshow ad format running on TikTok right now. Bundled with IG Follower Hijack for a single $37 unlock.",
    // No default purchaseUrl: the old Stripe Checkout link is retired.
  },
  {
    href: "/follower-hijack",
    label: "IG Follower Hijack",
    icon: Users,
    slug: "order-bump-3",
    price: 37,
    paidKey: "bump3Paid",
    extraPaidKeys: ["tiktokSlideshowPaid"],
    description:
      "Ethically pull your competitors' warmest IG followers into your world, then hit them with your organic content and paid ads on autopilot.",
    // No default purchaseUrl: the old Stripe Checkout link is retired.
  },
  // Note: the Daily Ad Research Board sidebar entry was removed when bump2
  // was repointed to the 2,000 Hook Library. The /ad-research-board route is
  // still mounted in App.tsx so any legacy customer who paid for the Ad
  // Board under the old bump2 SKU can still reach the page directly.
];

// Single source of truth for whether a sidebar add-on is already owned
// (Task #758). Several products sell through two paths - the funnel
// (upsell1/downsell1, upsell2, upsell3) and the portal sidebar add-on
// columns (doneForYouPackPaid, portfolioPaid, platinumPaid). The server
// OR-merges these in computePurchaseEntitlements, and each upsell row
// lists the funnel-equivalent columns in `extraPaidKeys`. Centralising
// the merge here guarantees the lock/price state AND the buy actions
// (purchaseUrl + buy modal) agree, so a funnel buyer never sees a live
// "buy" price or a payment form for something they already own.
function isUpsellOwned(
  u: PortalUpsell,
  userAny: any,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  if (userAny?.[u.paidKey]) return true;
  return (u.extraPaidKeys ?? []).some((k) => !!userAny?.[k]);
}


// Sub-items shown under "Done For You Pack" once unlocked. Order mirrors
// the published Done For You Pack roadmap.
const DFY_SUB_ITEMS: { href: string; label: string; external?: boolean; adminOnly?: boolean; comingSoonForNonAdmin?: boolean }[] = [
  { href: "/done-for-you-pack/100-ai-influencers", label: "100 AI Influencers" },
  { href: "/done-for-you-pack/250-scenes", label: "250+ Scenes" },
  { href: "/done-for-you-pack/bridge-pages", label: "Bridge Pages" },
  { href: "/done-for-you-pack/canva-ad-templates", label: "3,000+ Canva Ad Templates" },
  { href: "https://canva.link/v9phllr4tx7fv1c", label: "Faceless Hook Templates", external: true },
  { href: "/done-for-you-pack/carousel-templates", label: "50+ Viral Carousel Templates" },
  { href: "/done-for-you-pack/background-music", label: "4,000+ Background Reel Music" },
  { href: "/done-for-you-pack/ig-story-templates", label: "100+ IG Story Templates" },
  { href: "/done-for-you-pack/ig-story-highlights", label: "Instagram Story Highlights" },
  { href: "/done-for-you-pack/ad-swipe-file", label: "Ad Swipe File" },
  { href: "/done-for-you-pack/b-roll", label: "70K Viral Video B-Roll" },
  { href: "/done-for-you-pack/scripts", label: "1,000+ Proven Content Scripts" },
  { href: "/done-for-you-pack/funnel-templates", label: "5+ Sales Funnel Templates" },
  { href: "/done-for-you-pack/advertorial-ad-templates", label: "Advertorial Ad Templates" },
  { href: "/done-for-you-pack/advertorial-pages", label: "20 Advertorial Page Templates" },
  { href: "/done-for-you-pack/advertorial-swipe-file", label: "Advertorial Page Swipe File", adminOnly: true },
];

const SIDEBAR_COLLAPSED_KEY = "apex-portal-sidebar-collapsed";

// hint: Logic changed on both sides. Requires understanding intent of each change.
export function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [portugalBarVisible, setPortugalBarVisible] = useState<boolean>(() => !isDfyBarDismissed());
  const portugalOffset = portugalBarVisible ? DFY_BAR_HEIGHT_PX : 0;
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {}
  }, [sidebarCollapsed]);

  // Fire a server-side page_view on every route change so CS can see the
  // actual portal pages a buyer visited (not just the opaque API URLs the
  // auto-logging middleware records). Fire-and-forget; trackEvent swallows
  // its own errors. Skipped while impersonating so CS sessions never
  // pollute the buyer's own activity log.
  useEffect(() => {
    if (!user) return;
    trackEvent("page_view", {
      path: location,
      resourceType: "page",
      resourceId: location,
      metadata: typeof document !== "undefined" && document.title ? { title: document.title } : undefined,
    });
  }, [location, user?.id]);

  // The Ad Research Board page itself triggers an auto-collapse on first
  // visit per session (it dispatches `apex-portal-sidebar-collapsed-changed`
  // after writing the localStorage key). We listen here so the sidebar
  // state stays in sync no matter which component initiates the change.
  // Keeping this listener in PortalLayout (rather than firing the collapse
  // from a location effect here) ensures the sidebar remains visible while
  // the lazy board chunk is still downloading - the collapse only happens
  // once the board page actually mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      try {
        const v = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        setSidebarCollapsed(v === "1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("apex-portal-sidebar-collapsed-changed", handler);
    return () => {
      window.removeEventListener("apex-portal-sidebar-collapsed-changed", handler);
    };
  }, []);


  // Task #774: /portal/me previously had no staleTime, so React Query's
  // default cache meant a buyer who just purchased an add-on could see the
  // product stay locked until a hard reload. Refetch on window focus (and
  // on mount) so a fresh purchase reflects when the buyer tabs back, plus a
  // visible "Refresh access" control (below) for an explicit re-pull.
  const {
    data: me,
    isFetching: meRefetching,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ["me"],
    queryFn: api.getMe,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // OS tool credit balance pill in the sidebar.
  const { data: creditBalanceData } = useQuery({
    queryKey: ["os-tool-credit-balance"],
    queryFn: api.getOSToolCreditBalance,
    refetchOnWindowFocus: false,
  });
  const osToolCreditBalance = creditBalanceData?.balance ?? null;

  // AI usage status. The pill below stays hidden until the user crosses the
  // free allowance threshold, so the credit system stays silent for new users.
  const { data: aiCreditsStatus } = useQuery<{ overLimit?: boolean }>({
    queryKey: ["me-credits-status"],
    queryFn: () => api.me.creditsStatus() as any,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
  const overLimit = !!aiCreditsStatus?.overLimit;

  const isAdmin = me?.user?.role === "admin";
  // Task #796: a "team" member with any granted staff capability needs the
  // Admin entry button so they can reach the user-management tools they're
  // permitted to use. The admin-only sub-tools (Influencer generations, Video
  // Studio) stay gated on `isAdmin`. AdminLayout redirects a team member off
  // the admin-only Analytics landing to their first permitted page.
  const canSeeAdminPanel =
    isAdmin || userCapabilities(me?.user as any, isAdmin).size > 0;
  const hasMarketingTool = !!me?.user?.hasMarketingTool;
  const queryClient = useQueryClient();

  // 1-1 Onboarding Call (GHL booking). Drives the conditional sidebar entry
  // and the one-time first-login booking popup for brand-new buyers.
  const { data: onboardingCall } = useQuery({
    queryKey: ["onboarding-call-status"],
    queryFn: api.getOnboardingCallStatus,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const onboardingBookingUrl =
    onboardingCall?.bookingUrl ||
    "https://api.leadconnectorhq.com/widget/booking/eUBO2GGTIzk59M2DGrN1";
  const showOnboardingCall =
    onboardingCall?.configured === true && onboardingCall?.hasBooked === false;

  const [buyModal, setBuyModal] = useState<PortalUpsell | null>(null);
  const [buyError, setBuyError] = useState("");

  // Admin-configured GHL purchase links (products table → purchase_url).
  // A configured link for a row's slug (or its shared chargeSlug) always
  // wins over the hard-coded default so each install can plug in its own
  // GHL sales pages.
  const { links: purchaseLinks } = usePurchaseLinks();
  const purchaseUrlFor = (u: PortalUpsell): string | undefined =>
    purchaseLinks[u.slug] ??
    (u.chargeSlug ? purchaseLinks[u.chargeSlug] : undefined) ??
    u.purchaseUrl;

  // Task #9: the buy modal opens the GHL sales page in a new tab; when the
  // buyer tabs back after paying, the focus refetch of /portal/me flips the
  // merged entitlement. Detect that flip while the modal is open, close it,
  // toast the unlock, and drop the buyer into the newly unlocked page.
  useUnlockCelebration({
    active: !!buyModal,
    unlocked: !!buyModal && isUpsellOwned(buyModal, me?.user as any, isAdmin),
    label: buyModal?.label ?? "",
    description: buyModal
      ? `${buyModal.label} is now unlocked. Taking you there.`
      : undefined,
    onUnlocked: () => {
      const href = buyModal?.href;
      setBuyModal(null);
      setBuyError("");
      setSidebarOpen(false);
      if (href) setLocation(href);
    },
  });

  // After Stripe Hosted Checkout sends the buyer back to the portal we wait
  // for the webhook to flip the paidField, then drop the user into the
  // unlocked page. The Stripe webhook usually arrives within ~2 seconds.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const unlockedSlug = params.get("addon_unlocked");
    const cancelledSlug = params.get("addon_cancelled");
    if (cancelledSlug) {
      toast({
        title: "Purchase cancelled",
        description: "No charge was made to your card.",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("addon_cancelled");
      window.history.replaceState({}, "", url.toString());
      return;
    }
    if (!unlockedSlug) return;
    const upsell = PORTAL_UPSELLS.find((u) => u.slug === unlockedSlug);
    if (!upsell) return;
    let attempts = 0;
    const MAX = 15;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const fresh = await api.getMe().catch(() => null);
      if (cancelled) return;
      const unlocked = !!(fresh as any)?.user?.[upsell.paidKey];
      if (unlocked) {
        queryClient.setQueryData(["me"], fresh);
        toast({
          title: "Purchase complete",
          description: `${upsell.label} has been unlocked. Welcome aboard.`,
        });
        const url = new URL(window.location.href);
        url.searchParams.delete("addon_unlocked");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
        setTimeout(() => setLocation(upsell.href), 250);
        return;
      }
      if (attempts >= MAX) {
        toast({
          title: "Confirming your purchase",
          description:
            "Your payment is being finalised. Refresh in a few seconds if the unlock has not appeared.",
        });
        const url = new URL(window.location.href);
        url.searchParams.delete("addon_unlocked");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
        return;
      }
      window.setTimeout(tick, 1000);
    };
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Greg AI and the Daily Ad Research Board are bundled into Platinum Club, so
  // they no longer get their own Upgrades rows. The /greg-ai and
  // /ad-research-board pages still work by direct URL for entitled buyers.
  const isGregAiRoute = location.startsWith("/greg-ai");

  const isUpgradesRoute =
    isGregAiRoute ||
    location === "/low-ticket-portal" ||
    location === "/vsl-templates" ||
    location === "/ad-research-board" ||
    location === "/follower-hijack" ||
    location === "/tiktok-slideshow-masterclass" ||
    location === "/hook-demo-library" ||
    location === "/done-for-you-pack" ||
    location === "/our-portfolio" ||
    location === "/platinum-club";
  // Done For You Pack expandable parent. Defaults open whenever the user is
  // already on a /done-for-you-pack[/...] route so the active sub-page is
  // always visible without an extra click.
  const isDfyRouteCurrent = location === "/done-for-you-pack" || location.startsWith("/done-for-you-pack/");
  const [dfyOpen, setDfyOpen] = useState(isDfyRouteCurrent);
  useEffect(() => { if (isDfyRouteCurrent) setDfyOpen(true); }, [isDfyRouteCurrent]);
  // Starts collapsed; only expands when the user clicks the section header.

  const isUserAList = me?.user?.isAList;


  const renderNavButton = (item: { href: string; label: string; icon: any }) => {
    const active = location === item.href;
    return (
      <button
        key={item.href}
        onClick={() => {
          setLocation(item.href);
          setSidebarOpen(false);
        }}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
          active
            ? "bg-[#C9A44C]/15 text-[#C9A44C]"
            : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
        }`}
      >
        <item.icon className="w-4 h-4" />
        {item.label}
        {active && <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
    );
  };


  return (
    <div className="min-h-screen bg-background flex">
      <NotificationPoller />
      <ImpersonationBanner />
      {portugalBarVisible && (
        <DfyAnnouncementBar onDismiss={() => setPortugalBarVisible(false)} />
      )}
      <aside
        style={{ top: portugalOffset }}
        className={`fixed left-0 bottom-0 z-50 w-[260px] bg-[#0a0a0a] border-r border-white/[0.06] flex flex-col transform transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${sidebarCollapsed ? "md:-translate-x-full" : "md:translate-x-0"}`}
        aria-hidden={!sidebarOpen && sidebarCollapsed ? true : undefined}
        inert={!sidebarOpen && sidebarCollapsed}
      >
        <div className="px-5 pt-5 pb-3 border-b border-white/[0.06] flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Room30Logo className="text-[56px] flex-1 min-w-0" />
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="hidden md:inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-[#C9A44C]/10 text-white/55 hover:text-[#C9A44C] border border-white/[0.06] hover:border-[#C9A44C]/30 transition-colors text-[10.5px] uppercase tracking-[0.18em] font-bold"
            title="Hide sidebar"
            aria-label="Hide sidebar"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Collapse
          </button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-1">
            {renderNavButton({ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard })}
            <div className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
              Masterclass & Tools
            </div>
            <button
              key="/masterclass"
              onClick={() => {
                setLocation("/masterclass");
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                location === "/masterclass" || location.startsWith("/lesson/")
                  ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
              }`}
              data-testid="button-sidebar-masterclass"
            >
              <GraduationCap className="w-4 h-4" />
              <span className="flex-1 text-left">Masterclass</span>
              {location === "/masterclass" && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
            {renderNavButton({ href: "/your-brain", label: "Your Brain", icon: Brain })}
            {renderNavButton({ href: "/operating-system", label: "Operating System", icon: Cpu })}
            <button
              key="/your-influencers"
              onClick={() => {
                setLocation("/your-influencers");
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                location === "/your-influencers"
                  ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
              }`}
            >
              <Users className="w-4 h-4" />
              <span className="flex-1 text-left">My Influencers</span>
              {location === "/your-influencers" && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
            {/* 1-1 Onboarding Call: shown only while GHL is configured and the
                buyer has not yet booked (book-once-ever). Opens the same GHL
                booking popup as the /thankyou page and the first-login prompt. */}
            {showOnboardingCall && (
              <a
                key="onboarding-call"
                href={onboardingBookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSidebarOpen(false)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
                data-testid="button-sidebar-book-call"
              >
                <CalendarCheck className="w-4 h-4" />
                <span className="flex-1 text-left">Book Your 1-1 Onboarding Call</span>
              </a>
            )}

            <div className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
              Upgrades
            </div>
            {/* Platinum Club: promoted to its own standalone, premium-styled
                row outside the PORTAL_UPSELLS map. Gold→purple gradient marks
                it as the inner-circle, highest-tier add-on. */}
            {(() => {
              const platinumUpsell = PORTAL_UPSELLS.find(
                (u) => u.slug === "platinum-club",
              );
              // Platinum Club unlocks via either the funnel upsell3/downsell3
              // (upsell3Paid) or the portal sidebar / manual grant
              // (platinumPaid). The /platinum-club page already checks both;
              // mirror that here so the sidebar row never shows "locked" for a
              // funnel buyer who has upsell3Paid but not platinumPaid.
              const paid = platinumUpsell
                ? isUpsellOwned(platinumUpsell, me?.user as any, isAdmin)
                : isAdmin;
              const active = location === "/platinum-club";
              return (
                <button
                  onClick={() => {
                    if (paid) {
                      setLocation("/platinum-club");
                      setSidebarOpen(false);
                    } else {
                      window.open("https://checkout.aiinfluencerpublishing.com/join-platinum-club", "_blank", "noopener,noreferrer");
                      setSidebarOpen(false);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                    active
                      ? "text-[#E8C97A]"
                      : "text-[#E8C97A]/80 hover:text-[#E8C97A]"
                  }`}
                  style={{
                    background: active
                      ? "linear-gradient(135deg, rgba(212,178,85,0.22), rgba(168,85,247,0.22))"
                      : "linear-gradient(135deg, rgba(212,178,85,0.10), rgba(168,85,247,0.10))",
                    border: active
                      ? "1px solid rgba(212,178,85,0.45)"
                      : "1px solid rgba(168,85,247,0.22)",
                    boxShadow: active
                      ? "0 0 12px rgba(168,85,247,0.18), inset 0 1px 0 rgba(255,255,255,0.06)"
                      : "inset 0 1px 0 rgba(255,255,255,0.04)",
                  }}
                >
                  <Crown className="w-4 h-4" />
                  <span className="flex-1 text-left">Platinum Club</span>
                  {paid
                    ? (active
                        ? <ChevronRight className="w-3 h-3" />
                        : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />)
                    : (
                      <span
                        className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full text-[#0A0A0A]"
                        style={{
                          background: "linear-gradient(135deg, #E8C97A 0%, #A855F7 100%)",
                          boxShadow: "0 0 8px rgba(168,85,247,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
                        }}
                      >
                        Premium
                      </span>
                    )}
                </button>
              );
            })()}
            {/* Sidebar-level "Manage subscription" pill for paid Platinum
                users. Renders directly under the Platinum Club row so the
                billing-portal affordance is reachable from every page,
                not only the /platinum-club tab. */}
            {(!!(me?.user as any)?.platinumPaid ||
              !!(me?.user as any)?.upsell3Paid) && (
              <SidebarManagePlatinumSubscription />
            )}

            {/* Upgrades flattened: render PORTAL_UPSELLS as top-level sidebar
                items (no collapsible parent). The Done For You Pack item is
                special: once doneForYouPackPaid (or admin) the row becomes a
                parent-with-chevron that expands to show the 14 sub-pages. */}
            {PORTAL_UPSELLS.map((u) => {
              // Platinum Club has its own dedicated standalone row above
              // (gold→purple gradient). Skip it here so it isn't rendered
              // twice. The entry is kept in PORTAL_UPSELLS so shared
              // lookups (Stripe checkout-return handler, etc.) still work.
              if (u.slug === "platinum-club") return null;
              const userAny = me?.user as any;
              const paid = isUpsellOwned(u, userAny, isAdmin);
              const active = location === u.href;
              if (u.slug === "done-for-you-pack" && paid) {
                const isDfyRoute = location === "/done-for-you-pack" || location.startsWith("/done-for-you-pack/");
                return (
                  <div key={u.slug}>
                    <div
                      className={`w-full flex items-center rounded-lg text-[13px] font-medium transition-colors ${
                        isDfyRoute
                          ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                          : "text-white/65 hover:text-white/90 hover:bg-white/[0.04]"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setLocation("/done-for-you-pack");
                          setSidebarOpen(false);
                          setDfyOpen(true);
                        }}
                        className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left rounded-l-lg"
                      >
                        <u.icon className="w-4 h-4" />
                        <span className="flex-1">{u.label}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDfyOpen((v) => !v); }}
                        className="px-2 py-2.5 rounded-r-lg hover:bg-white/[0.04]"
                        aria-label={dfyOpen ? "Collapse" : "Expand"}
                      >
                        {dfyOpen
                          ? <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                          : <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
                      </button>
                    </div>
                    {dfyOpen && (
                      <div className="mt-1 ml-4 pl-3 border-l border-white/[0.06] space-y-0.5">
                        {DFY_SUB_ITEMS.map((it) => {
                          const subActive = !it.external && location === it.href;
                          const showSoon = !!it.comingSoonForNonAdmin && !isAdmin;
                          const baseClass = `w-full text-left px-3 py-2 rounded-md text-[13px] leading-snug transition-colors ${
                            subActive
                              ? "text-[#C9A44C] bg-[#C9A44C]/10"
                              : "text-white/55 hover:text-white/85 hover:bg-white/[0.03]"
                          }`;
                          if (it.adminOnly && !isAdmin) {
                            return (
                              <button
                                key={it.href}
                                onClick={() => {
                                  toast({
                                    title: "Coming soon",
                                    description: `${it.label} isn't ready yet - we'll let you know the moment it goes live.`,
                                  });
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] leading-snug text-white/40 hover:text-white/55 hover:bg-white/[0.03] transition-colors"
                              >
                                <span className="flex-1 text-left">{it.label}</span>
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.06]">
                                  Coming soon
                                </span>
                              </button>
                            );
                          }
                          const labelNode = showSoon ? (
                            <span className="flex items-center gap-2">
                              <span className="flex-1">{it.label}</span>
                              <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.06]">
                                Soon
                              </span>
                            </span>
                          ) : (
                            it.label
                          );
                          if (it.external) {
                            return (
                              <a
                                key={it.href}
                                href={it.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setSidebarOpen(false)}
                                className={`${baseClass} block`}
                              >
                                {labelNode}
                              </a>
                            );
                          }
                          return (
                            <button
                              key={it.href}
                              onClick={() => { setLocation(it.href); setSidebarOpen(false); }}
                              className={baseClass}
                            >
                              {labelNode}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              // Pre-launch lock for the Friday 15th drop. Wins over `paid` so
              // even users who already own bump3 see Coming Soon until launch.
              // Toggle via PRELAUNCH_LOCKED in src/lib/prelaunch-lock.ts.
              if (isPrelaunchLocked(u.href)) {
                // Truly non-interactive: no onClick, no buy modal, no
                // navigation. Rendered as a static div so even keyboard
                // activation can't reach a handler. Toggle via
                // PRELAUNCH_LOCKED in src/lib/prelaunch-lock.ts.
                return (
                  <div key={u.slug}>
                    <div
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-white/40 cursor-not-allowed select-none opacity-70"
                      aria-disabled="true"
                      title="Coming Soon - dropping Friday 15th"
                    >
                      <Lock className="w-4 h-4 opacity-60" />
                      <span className="flex-1 text-left">{u.label}</span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.06]">
                        Coming Soon
                      </span>
                    </div>
                  </div>
                );
              }
              if (paid) {
                return (
                  <div key={u.slug}>
                    <button
                      onClick={() => { setLocation(u.href); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                        active
                          ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                          : "text-white/65 hover:text-white/90 hover:bg-white/[0.04]"
                      }`}
                    >
                      <u.icon className="w-4 h-4" />
                      <span className="flex-1 text-left">{u.label}</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
                    </button>
                  </div>
                );
              }
              if (u.comingSoon) {
                return (
                  <div key={u.slug}>
                    <button
                      onClick={() => {
                        toast({
                          title: "Coming soon",
                          description: `${u.label} isn't on sale yet - we'll let you know the moment it goes live.`,
                        });
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-white/40 hover:text-white/55 hover:bg-white/[0.03] transition-colors"
                    >
                      <u.icon className="w-4 h-4 opacity-60" />
                      <span className="flex-1 text-left">{u.label}</span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.06]">
                        Coming soon
                      </span>
                    </button>
                  </div>
                );
              }
              return (
                <div key={u.slug}>
                  <button
                    onClick={() => {
                      // Defense-in-depth (Task #758): if the merged
                      // entitlement is already true (e.g. the buyer paid via
                      // the funnel and `me` refreshed after this row first
                      // rendered), never start a second purchase. Drop them
                      // into the owned page instead of the buy flow.
                      if (isUpsellOwned(u, me?.user as any, isAdmin)) {
                        setLocation(u.href);
                        setSidebarOpen(false);
                        return;
                      }
                      const url = purchaseUrlFor(u);
                      if (url) {
                        window.open(url, "_blank", "noopener,noreferrer");
                        setSidebarOpen(false);
                        return;
                      }
                      setBuyError("");
                      setBuyModal(u);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors group"
                  >
                    <u.icon className="w-4 h-4 opacity-60" />
                    <span className="flex-1 text-left">{u.label}</span>
                    {typeof u.price === "number" && (
                      <span className="text-[10px] font-bold text-[#C9A44C]/70 group-hover:text-[#C9A44C]">
                        ${u.price}
                      </span>
                    )}
                    <Lock className="w-3 h-3 opacity-50 group-hover:opacity-90" />
                  </button>
                </div>
              );
            })}

            {/* Support - in-portal help center (articles + Steph chat) */}
            <Link
              href="/support"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
            >
              <HelpCircle className="w-4 h-4" />
              <span className="flex-1 text-left">Support</span>
            </Link>
                      </div>

        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 mb-3">
            {user?.imageUrl ? (
              <img
                src={user.imageUrl}
                alt={user?.firstName || "Profile"}
                className="w-8 h-8 rounded-full object-cover border border-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#C9A44C]/20 flex items-center justify-center text-[12px] font-bold text-[#C9A44C]">
                {user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white truncate">
                {[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.primaryEmailAddress?.emailAddress || "User"}
              </p>
              <p className="text-[11px] text-white/55 truncate">
                {user?.primaryEmailAddress?.emailAddress || ""}
              </p>
            </div>
            {overLimit && osToolCreditBalance !== null && !isAdmin && (
              <div
                className="shrink-0 px-2.5 py-1 rounded-full bg-[#C9A44C]/10 border border-[#C9A44C]/30"
                title="OS tool credits, used after your included AI usage is exhausted. Top up from Settings."
              >
                <p className="text-[11px] font-semibold text-[#C9A44C] tabular-nums">
                  {osToolCreditBalance} credit{osToolCreditBalance === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>
          <div className="space-y-1">
            {canSeeAdminPanel && (
              <button
                onClick={() => {
                  setLocation("/admin");
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] transition-colors ${
                  location === "/admin" || (location.startsWith("/admin") && location !== "/admin/influencer-generations")
                    ? "text-[#C9A44C] bg-[#C9A44C]/10"
                    : "text-white/65 hover:text-white/70 hover:bg-white/[0.04]"
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                Admin
              </button>
            )}
            {isAdmin && (
              <>
                <button
                  onClick={() => {
                    setLocation("/admin/influencer-generations");
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-[11.5px] transition-colors ${
                    location === "/admin/influencer-generations"
                      ? "text-[#C9A44C] bg-[#C9A44C]/10"
                      : "text-white/55 hover:text-white/70 hover:bg-white/[0.04]"
                  }`}
                >
                  Influencer generations
                </button>
              </>
            )}
            <button
              onClick={() => {
                setLocation("/settings");
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] transition-colors ${
                location === "/settings"
                  ? "text-[#C9A44C] bg-[#C9A44C]/10"
                  : "text-white/65 hover:text-white/70 hover:bg-white/[0.04]"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              onClick={() => {
                void refetchMe();
              }}
              disabled={meRefetching}
              title="Just bought something and it's still locked? Pull your latest access."
              data-testid="button-refresh-access"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] transition-colors disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${meRefetching ? "animate-spin" : ""}`} />
              {meRefetching ? "Refreshing..." : "Refresh access"}
            </button>
            <button
              onClick={async () => {
                await stopImpersonationBeforeSignOut().catch(() => {});
                await signOut();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
            <div className="px-3 pt-3 mt-1 border-t border-white/[0.05] flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-white/40">
              <a href="/terms" target="_blank" rel="noopener" className="hover:text-white/65 transition-colors">Terms</a>
              <a href="/privacy" target="_blank" rel="noopener" className="hover:text-white/65 transition-colors">Privacy</a>
              <a href="/refund-policy" target="_blank" rel="noopener" className="hover:text-white/65 transition-colors">Refunds</a>
            </div>
          </div>
        </div>
      </aside>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{ top: portugalOffset + 16 }}
        className="fixed left-4 z-[60] md:hidden bg-[#0a0a0a] border border-white/[0.06] rounded-lg p-2"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <AnnouncementPopup />

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          style={{ top: portugalOffset + 16 }}
          className="hidden md:inline-flex fixed left-4 z-[60] items-center justify-center w-9 h-9 bg-[#0a0a0a] border border-white/[0.08] rounded-lg text-white/65 hover:text-[#C9A44C] hover:border-[#C9A44C]/40 transition-colors shadow-lg"
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main
        style={{ paddingTop: portugalOffset }}
        className={`flex-1 min-h-screen min-w-0 overflow-x-hidden ${
          sidebarCollapsed
            ? "md:ml-0 md:w-full"
            : "md:ml-[260px] md:w-[calc(100%-260px)]"
        }`}
      >
        <CreditsOverlimitBanner />
        {children}
      </main>
      <SavingToBrainIndicator />

      <FirstTimeIntroPopup
        clerkId={me?.user?.clerkId ?? null}
        onGo={() => setLocation("/your-influencers?open=generate")}
      />

      <Dialog
        open={!!buyModal}
        onOpenChange={(open) => {
          if (!open) {
            setBuyModal(null);
            setBuyError("");
          }
        }}
      >
        <DialogContent className="bg-[#0f0f0f] border border-white/[0.08] text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle
              className="text-[20px] uppercase tracking-[0.02em]"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Unlock {buyModal?.label}
            </DialogTitle>
            <DialogDescription className="text-white/60 text-[13px] leading-relaxed pt-2">
              {buyModal?.description}
            </DialogDescription>
          </DialogHeader>
          {buyError && (
            <div className="text-[12px] text-red-400 bg-red-500/[0.06] border border-red-500/20 rounded-md px-3 py-2 mt-2">
              {buyError}
            </div>
          )}
          {buyModal &&
            (isUpsellOwned(buyModal, me?.user as any, isAdmin) ? (
              // Defense-in-depth (Task #758): the merged entitlement flipped
              // to owned while this modal was open (e.g. the buyer completed
              // the funnel path in another tab). Never show a live payment
              // form for something they already own - send them to the page.
              <div className="mt-2 space-y-4">
                <p className="text-[13px] text-emerald-400/90 leading-relaxed">
                  You already own {buyModal.label}. No need to pay again.
                </p>
                <button
                  onClick={() => {
                    const href = buyModal.href;
                    setBuyModal(null);
                    setBuyError("");
                    setLocation(href);
                    setSidebarOpen(false);
                  }}
                  className="w-full px-4 py-2.5 rounded-md text-[13px] font-semibold bg-[#C9A44C] text-[#0A0A0A] hover:bg-[#D9B45C] transition-colors"
                >
                  Open {buyModal.label}
                </button>
              </div>
            ) : (
              <PurchasingMovedNotice
                label={buyModal.label}
                purchaseUrl={purchaseUrlFor(buyModal)}
                onCancel={() => {
                  setBuyModal(null);
                  setBuyError("");
                }}
              />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TRACKED_JOBS_KEY = "savingToBrain.trackedJobIds";
const TOASTED_JOBS_KEY = "savingToBrain.toastedJobIds";

const STRIPE_CUSTOMER_PORTAL_URL = "https://billing.stripe.com/p/login/9B6dR881G2rbgzAdd6cV200";

function SidebarManagePlatinumSubscription() {
  return (
    <a
      href={STRIPE_CUSTOMER_PORTAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center gap-3 px-3 py-2 ml-0 rounded-lg text-[11.5px] font-medium text-white/45 hover:text-[#E8C97A] hover:bg-white/[0.04] transition-colors"
    >
      <span className="w-4 h-4 inline-flex items-center justify-center">
        <ExternalLink className="w-3.5 h-3.5" />
      </span>
      <span className="flex-1 text-left">Manage subscription</span>
    </a>
  );
}

function readIdList(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-50)));
  } catch {}
}

function CreditsOverlimitBanner() {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const { data, refetch } = useQuery<{
    overLimit?: boolean;
    dismissedAt?: string | null;
  }>({
    queryKey: ["me-credits-status"],
    queryFn: () => api.me.creditsStatus() as any,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (!data || !data.overLimit) return null;
  if (dismissed || data.dismissedAt) return null;

  async function onDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setDismissed(true);
    try {
      await api.me.dismissCreditsNotice();
      refetch();
    } catch {}
  }

  return (
    <div
      role="alert"
      className="border-b border-amber-500/25 bg-gradient-to-r from-[#1a1108] via-[#221408] to-[#1a1108]"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-2.5 flex items-center gap-3">
        <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-[13px] text-amber-100/90 leading-snug">
          You have used your included AI credits. Top up from Settings to keep
          generating.
        </div>
        <button
          onClick={() => setLocation("/settings")}
          className="hidden sm:inline-flex items-center rounded-md bg-gradient-to-br from-[#7c3aed] via-[#a855f7] to-[#c026d3] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_4px_12px_rgba(124,58,237,0.3)] hover:opacity-95 transition"
        >
          Open Settings
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1.5 text-amber-200/70 hover:text-white hover:bg-white/10 transition"
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function SavingToBrainIndicator() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const checkingRef = useRef<Set<number>>(new Set());
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["active-os-save-job"],
    queryFn: api.getActiveOSToolSaveJob,
    refetchInterval: 4000,
  });
  const job = data?.job;

  // Remember any active job we observe so we can detect its completion later.
  useEffect(() => {
    if (!job?.id) return;
    const tracked = readIdList(TRACKED_JOBS_KEY);
    if (!tracked.includes(job.id)) {
      writeIdList(TRACKED_JOBS_KEY, [...tracked, job.id]);
    }
  }, [job?.id]);

  // When a tracked job is no longer the active one, fetch its final state and toast.
  useEffect(() => {
    const tracked = readIdList(TRACKED_JOBS_KEY);
    if (tracked.length === 0) return;
    const toasted = new Set(readIdList(TOASTED_JOBS_KEY));
    const activeId = job?.id;
    const candidates = tracked.filter(
      (id) => id !== activeId && !toasted.has(id) && !checkingRef.current.has(id),
    );
    if (candidates.length === 0) return;

    candidates.forEach((id) => {
      checkingRef.current.add(id);
      (async () => {
        try {
          const result = await api.getOSToolSaveJob(id);
          const final = result?.job;
          if (!final) {
            // Job missing — drop from tracked.
            writeIdList(
              TRACKED_JOBS_KEY,
              readIdList(TRACKED_JOBS_KEY).filter((x) => x !== id),
            );
            return;
          }
          if (final.status !== "done" && final.status !== "failed") {
            return;
          }

          if (final.status === "done") {
            toast({
              title: "Saved to your Brain",
              description: final.primaryTitle
                ? `“${final.primaryTitle}” is ready in your Brain.`
                : "Your document has been saved to your Brain.",
            });
          } else {
            toast({
              variant: "destructive",
              title: "Save to Brain failed",
              description:
                final.errorMessage ||
                "Something went wrong saving your document to your Brain.",
              action: (
                <ToastAction
                  altText="Retry saving to your Brain"
                  onClick={async () => {
                    try {
                      await api.retryOSToolSaveJob(id);
                      const stillToasted = new Set(readIdList(TOASTED_JOBS_KEY));
                      stillToasted.delete(id);
                      writeIdList(TOASTED_JOBS_KEY, Array.from(stillToasted));
                      const stillTracked = readIdList(TRACKED_JOBS_KEY);
                      if (!stillTracked.includes(id)) {
                        writeIdList(TRACKED_JOBS_KEY, [...stillTracked, id]);
                      }
                      queryClient.invalidateQueries({
                        queryKey: ["active-os-save-job"],
                      });
                    } catch {}
                  }}
                >
                  Retry
                </ToastAction>
              ),
            });
          }

          const nextToasted = new Set(readIdList(TOASTED_JOBS_KEY));
          nextToasted.add(id);
          writeIdList(TOASTED_JOBS_KEY, Array.from(nextToasted));
          writeIdList(
            TRACKED_JOBS_KEY,
            readIdList(TRACKED_JOBS_KEY).filter((x) => x !== id),
          );
          queryClient.invalidateQueries({ queryKey: ["active-os-save-job"] });
        } catch (err: any) {
          // If the job is gone (e.g. 404 after account switch), prune it
          // so we don't keep retrying on every poll. Otherwise leave it
          // and let the next poll try again.
          const msg = String(err?.message || "");
          if (/\b404\b|not found/i.test(msg)) {
            writeIdList(
              TRACKED_JOBS_KEY,
              readIdList(TRACKED_JOBS_KEY).filter((x) => x !== id),
            );
          }
        } finally {
          checkingRef.current.delete(id);
        }
      })();
    });
  }, [job?.id, dataUpdatedAt, queryClient, setLocation]);

  const label = job?.label || "Saving to your Brain…";
  return (
    <div className="fixed bottom-4 right-4 z-[55] flex items-center gap-2">
      {job && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#0a0a0a] border border-[#C9A44C]/30 shadow-lg group"
          title="A document is saving to your Brain."
        >
          <Loader2 className="w-4 h-4 text-[#C9A44C] animate-spin" />
          <div className="text-left">
            <p className="text-[11px] font-bold text-[#C9A44C] uppercase tracking-wider leading-none">Saving to Brain</p>
            <p className="text-[11px] text-white/50 mt-1 leading-none">{label}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (!isFinite(diff)) return "";
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

function RecentSavesHistory() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ["recent-os-save-jobs"],
    queryFn: api.getRecentOSToolSaveJobs,
    refetchInterval: open ? 4000 : false,
  });
  const jobs: OsToolSaveJob[] = data?.jobs || [];

  const handleRetry = async (id: number) => {
    try {
      await api.retryOSToolSaveJob(id);
      const stillToasted = new Set(readIdList(TOASTED_JOBS_KEY));
      stillToasted.delete(id);
      writeIdList(TOASTED_JOBS_KEY, Array.from(stillToasted));
      const stillTracked = readIdList(TRACKED_JOBS_KEY);
      if (!stillTracked.includes(id)) {
        writeIdList(TRACKED_JOBS_KEY, [...stillTracked, id]);
      }
      queryClient.invalidateQueries({ queryKey: ["active-os-save-job"] });
      refetch();
    } catch {}
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) refetch(); }}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0a0a0a] border border-white/[0.08] shadow-lg hover:border-white/20 text-white/60 hover:text-white/90 transition-colors"
          title="Recent Brain saves"
          aria-label="Recent Brain saves"
        >
          <History className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-80 p-0 bg-[#0a0a0a] border-white/[0.08] text-white"
      >
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">Recent Brain saves</p>
          <p className="text-[11px] text-white/65 mt-0.5">Your last {Math.min(jobs.length, 10) || 10} saves</p>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-white/65">
              No recent saves yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {jobs.map((j) => {
                const title = j.primaryTitle || j.label || "Untitled save";
                const isDone = j.status === "done";
                const isFailed = j.status === "failed";
                const inProgress = !isDone && !isFailed;
                return (
                  <li key={j.id} className="px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">
                        {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {isFailed && <AlertCircle className="w-4 h-4 text-amber-400" />}
                        {inProgress && <Loader2 className="w-4 h-4 text-[#C9A44C] animate-spin" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-white truncate" title={title}>{title}</p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-white/65">
                          <span>
                            {isDone ? "Saved" : isFailed ? "Failed" : (j.label || "Saving…")}
                          </span>
                          <span className="text-white/45">·</span>
                          <span>{formatRelativeTime(j.updatedAt || j.createdAt)}</span>
                        </div>
                        {isFailed && j.errorMessage && (
                          <p className="text-[11px] text-amber-300/70 mt-1 line-clamp-2" title={j.errorMessage}>
                            {j.errorMessage}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          {isFailed && (
                            <button
                              onClick={() => handleRetry(j.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-white/70 hover:text-white transition-colors"
                            >
                              <RotateCw className="w-3 h-3" />
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NotificationPoller
// Polls /api/portal/notifications every 60s for unread items, fires a toast
// for each, then marks them read so we never double-notify. Renders nothing.
// Lives at the layout level so toasts work on every authenticated page.
// ─────────────────────────────────────────────────────────────────────────────
type PortalNotificationDto = {
  id: number;
  type: string;
  title: string;
  body: string;
  href: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

function NotificationPoller() {
  const [, setLocation] = useLocation();
  const seen = useRef<Set<number>>(new Set());

  const { data } = useQuery<{ notifications: PortalNotificationDto[] }>({
    queryKey: ["portal-notifications"],
    queryFn: async () => {
      const res = await fetch("/api/portal/notifications", { credentials: "include" });
      if (!res.ok) return { notifications: [] };
      return (await res.json()) as { notifications: PortalNotificationDto[] };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Avoid spamming the toast on hot-reload by remembering seen ids in a ref.
    staleTime: 30_000,
  });

  useEffect(() => {
    const list = data?.notifications ?? [];
    if (list.length === 0) return;
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      toast({
        title: n.title,
        description: n.body,
        action: n.href ? (
          <ToastAction altText="Open" onClick={() => setLocation(n.href!)}>
            Open
          </ToastAction>
        ) : undefined,
      });
      // Fire-and-forget mark-read so the same toast does not reappear.
      fetch(`/api/portal/notifications/${n.id}/read`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    }
  }, [data, setLocation]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// First-time intro popup. Shown ~5 seconds after a user's first portal load
// to tell them where to start. Dismissed forever via localStorage keyed on
// the Clerk user id, so clearing one user's flag does not affect another
// signed-in account on the same browser.
// ─────────────────────────────────────────────────────────────────────────────
function FirstTimeIntroPopup({
  clerkId,
  onGo,
}: {
  clerkId: string | null;
  onGo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const storageKey = clerkId ? `room30_intro_seen_v1__${clerkId}` : null;

  useEffect(() => {
    if (!storageKey) return;
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(storageKey) === "1";
    } catch {
      // localStorage blocked — fall back to once-per-session via sessionStorage
      try {
        seen = window.sessionStorage.getItem(storageKey) === "1";
      } catch {
        seen = true;
      }
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 5000);
    return () => clearTimeout(t);
  }, [storageKey]);

  function markSeen() {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      try {
        window.sessionStorage.setItem(storageKey, "1");
      } catch {
        // ignore
      }
    }
  }

  function handleGo() {
    markSeen();
    setOpen(false);
    onGo();
    // Also fire a custom event so the destination page opens its generate
    // modal even when no remount happens (e.g., user already viewing
    // /your-influencers when the popup appears).
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new Event("room30:open-generate-influencer"));
      } catch {
        // ignore
      }
    }
  }

  function handleDismiss() {
    markSeen();
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleDismiss();
      }}
    >
      <DialogContent className="bg-[#0f0f0f] border border-[#C9A44C]/30 text-white max-w-md">
        <DialogHeader>
          <div className="text-[11px] tracking-[0.22em] uppercase font-bold text-[#C9A44C] mb-2">
            Welcome to AI Influencer Portfolio
          </div>
          <DialogTitle
            className="text-[22px] uppercase tracking-[0.01em] leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            First things first, you generate your AI influencer.
          </DialogTitle>
          <DialogDescription className="text-white/65 text-[13px] leading-relaxed pt-3">
            Your AI influencer is the foundation of everything you'll build
            inside AI Influencer Portfolio. Tap the button below to set yours up - takes about
            a minute and the team handles the rest.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 gap-2 sm:gap-2 flex-col sm:flex-col">
          <button
            onClick={handleGo}
            className="w-full px-5 py-3 rounded-lg text-[13px] font-bold uppercase tracking-wider text-black"
            style={{ background: "#C9A44C" }}
            data-testid="button-intro-go"
          >
            Generate my AI influencer
          </button>
          <button
            onClick={handleDismiss}
            className="w-full px-5 py-2 rounded-lg text-[12px] uppercase tracking-wider text-white/55 hover:text-white"
            data-testid="button-intro-dismiss"
          >
            I'll do this later
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ImpersonationBanner() {
  const [meta, setMeta] = useState<ImpersonationMeta | null>(() => getImpersonationMeta());
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const handler = () => setMeta(getImpersonationMeta());
    window.addEventListener("r30:impersonation-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("r30:impersonation-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  if (!meta) return null;

  const targetName =
    [meta.target.firstName, meta.target.lastName].filter(Boolean).join(" ") ||
    meta.target.email ||
    `User #${meta.target.id}`;

  async function exit() {
    if (exiting) return;
    setExiting(true);
    try {
      try {
        await api.admin.stopImpersonation();
      } catch {
        // Even if the server call fails (expired session, network) we still
        // want to drop the local token so the UI returns to admin identity.
      }
      clearImpersonation();
      await queryClient.invalidateQueries();
      setLocation("/admin/users");
    } finally {
      setExiting(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-3 px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.14em] text-black"
      style={{
        background: "linear-gradient(90deg, #C9A44C 0%, #E8C97A 50%, #C9A44C 100%)",
        boxShadow: "0 2px 12px rgba(201,164,76,0.35)",
      }}
    >
      <Shield className="w-3.5 h-3.5" />
      <span className="text-black/70 normal-case tracking-normal">
        {meta.admin.email || "Admin"}
      </span>
      <span className="text-black/40">·</span>
      <span>
        Viewing as {targetName}
        {meta.target.email ? (
          <span className="normal-case tracking-normal font-medium">
            {" "}
            ({meta.target.email})
          </span>
        ) : null}
      </span>
      <span className="text-black/55 normal-case tracking-normal hidden sm:inline">
        (read-only)
      </span>
      <button
        onClick={exit}
        disabled={exiting}
        className="ml-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-black text-[#E8C97A] hover:bg-black/85 transition-colors disabled:opacity-60 text-[11px]"
      >
        {exiting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
        Exit
      </button>
    </div>
  );
}
