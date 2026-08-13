import { useEffect, useRef, lazy, Suspense } from "react";
import { LandingPage } from "@/pages/landing";
import {
  ClerkProvider,
  useAuth,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Dashboard } from "./pages/dashboard";
import { Masterclass } from "./pages/masterclass";
import { StephChatWidget } from "./components/steph-chat-widget";
import { CoursePlayer } from "./pages/course-player";
import ScreenshotLesson from "@/pages/screenshot-lesson";
import { AdminDashboard } from "./pages/admin/admin-dashboard";
import { AdminUsers } from "./pages/admin/admin-users";
import { AdminLogs } from "./pages/admin/admin-logs";
import { AdminBuyerAccess } from "./pages/admin/admin-buyer-access";
import { AdminInvites } from "./pages/admin/admin-invites";
import { AdminAnnouncements } from "./pages/admin/admin-announcements";
import { AdminExternalApi } from "./pages/admin/admin-external-api";
import { AdminGhlApi } from "./pages/admin/admin-ghl-api";
import { AdminSetup } from "./pages/admin/admin-setup";
import { AdminGhlProducts } from "./pages/admin/admin-ghl-products";
import AdminInfluencerGenerations from "./pages/admin/admin-influencer-generations";
import AdminInfluencerScenes from "./pages/admin/admin-influencer-scenes";
import NotFound from "@/pages/not-found";
import Plugs from "@/pages/plugs";
import AssetsDocs from "@/pages/assets-docs";
import Support from "@/pages/support";
import Settings from "@/pages/settings";
import YourInfluencers from "@/pages/your-influencers";
import AnnouncementsFeed from "@/pages/announcements";
import Onboarding from "@/pages/onboarding";
import YourBuild from "@/pages/your-build";
import YourBrain from "@/pages/your-brain";
import OperatingSystem from "@/pages/operating-system";
import ScriptWriter from "@/pages/script-writer";
import InfluencerDetail from "@/pages/influencer-detail";
import BuyInfluencer from "@/pages/buy-influencer";
import Credits from "@/pages/credits";
import VideoStudioPage from "@/pages/video-studio";
import VideoGalleryPage from "@/pages/video-gallery";
import AutomatedInfluencers from "@/pages/automated-influencers";
import AutomationJobDetailPage from "@/pages/automation-job-detail";
import AdminAutomation, {
  AdminAutomationJobs,
  AdminAutomationStuck,
  AdminAutomationAudit,
  AdminAutomationProviderConfigs,
  AdminAutomationProviderCosts,
  AdminAutomationProviderErrors,
  AdminAutomationTransactions,
  AdminAutomationWallets,
  AdminAutomationWorkflowStats,
} from "@/pages/admin-automation";
import AList from "@/pages/a-list";
import DoneForYou from "@/pages/done-for-you";
import LowTicketPortal from "@/pages/low-ticket-portal";
import VslTemplates from "@/pages/vsl-templates";
import VslMasterclass from "@/pages/vsl-masterclass";
import VslMasterclassPrint from "@/pages/vsl-masterclass-print";
// Lazy-loaded so the ~2,600 line Ad Research Board page (and its modal /
// preview / admin sub-components) doesn't ship in the main portal bundle.
// Drops first-paint time on every other portal route and lets this page
// only download when the user clicks into it. See task #307.
const AdResearchBoard = lazy(() => import("@/pages/ad-research-board"));
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import FollowerHijack from "@/pages/follower-hijack";
import TikTokSlideshowMasterclass from "@/pages/tiktok-slideshow-masterclass";
import HookDemoLibrary from "@/pages/hook-demo-library";
import DoneForYouPack from "@/pages/done-for-you-pack";
import Dfy100AiInfluencers from "@/pages/dfy/100-ai-influencers";
import Dfy250Scenes, { Dfy250ScenesFolder } from "@/pages/dfy/250-scenes";
import DfyBridgePages from "@/pages/dfy/bridge-pages";
import DfyCanvaAdTemplates from "@/pages/dfy/canva-ad-templates";
import DfyCarouselTemplates from "@/pages/dfy/carousel-templates";
import DfyBackgroundMusic from "@/pages/dfy/background-music";
import DfyIgStoryTemplates from "@/pages/dfy/ig-story-templates";
import DfyIgStoryHighlights from "@/pages/dfy/ig-story-highlights";
import DfyAdSwipeFile from "@/pages/dfy/ad-swipe-file";
import DfyBRoll from "@/pages/dfy/b-roll";
import DfyScripts from "@/pages/dfy/scripts";
import DfyFunnelTemplates from "@/pages/dfy/funnel-templates";
import DfyAdvertorialAdTemplates from "@/pages/dfy/advertorial-ad-templates";
import DfyAdvertorialPages from "@/pages/dfy/advertorial-pages";
import DfyAdvertorialSwipeFile from "@/pages/dfy/advertorial-swipe-file";
import OurPortfolio from "@/pages/our-portfolio";
import PlatinumClub from "@/pages/platinum-club";
import ResearchGeneration from "@/pages/research-generation";
import DomainNameGenerator from "@/pages/domain-name-generator";
import AvatarPromptGenerator from "@/pages/avatar-prompt-generator";
import { AdminSupportKnowledge } from "./pages/admin/admin-support-knowledge";
import { Toaster } from "@/components/ui/toaster";
import { PortalErrorBoundary } from "@/components/error-boundary";
import { toast } from "@/hooks/use-toast";
import {
  api,
  getImpersonationToken,
  clearImpersonation,
} from "@/lib/api";
import { SignInPage } from "@/pages/sign-in";
import { SignUpPage } from "@/pages/sign-up";

// ── Clerk configuration ────────────────────────────────────────────────────
// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so
// the same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths; wouter's setLocation prepends the base — strip it.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// ── Impersonation listener ─────────────────────────────────────────────────
// Task #710: global toast for any 403 { error: "impersonation_read_only" }.
function ImpersonationToastListener() {
  useEffect(() => {
    let last = 0;
    const handler = () => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      toast({
        title: "Read-only while viewing as a user",
        description: "Click Exit in the gold banner to return to your admin session.",
      });
    };
    window.addEventListener("r30:impersonation-write-blocked", handler as EventListener);
    return () =>
      window.removeEventListener("r30:impersonation-write-blocked", handler as EventListener);
  }, []);

  // Boot-time + tab-focus reconciliation.
  useEffect(() => {
    let cancelled = false;
    async function reconcile() {
      if (!getImpersonationToken()) return;
      try {
        const status = await api.admin.getImpersonationStatus();
        if (cancelled) return;
        if (!status.active) {
          clearImpersonation();
          toast({
            title: "Impersonation session ended",
            description: "Returned to your admin identity.",
          });
        }
      } catch {
        if (cancelled) return;
        clearImpersonation();
      }
    }
    void reconcile();
    const onFocus = () => void reconcile();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return null;
}

// ── Auth-aware components ──────────────────────────────────────────────────

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return isSignedIn ? <Redirect to="/dashboard" /> : <LandingPage />;
}

// Task #774: Show a visible "session ended" notice instead of a silent bounce.
function SessionEndedNotice() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6">
      <div className="max-w-sm w-full text-center bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-8">
        <h1
          className="text-[20px] font-bold uppercase tracking-[0.02em] text-white mb-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Your session has ended
        </h1>
        <p className="text-[13.5px] text-white/55 leading-[1.6] mb-6">
          Please sign in again to get back into your account. Your access and
          purchases are safe.
        </p>
        <button
          onClick={() => setLocation("/sign-in")}
          className="w-full inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#C9A44C] text-black text-sm font-bold uppercase tracking-wider hover:bg-[#d8b566] transition-colors"
          data-testid="button-session-ended-signin"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!isSignedIn) {
    return <SessionEndedNotice />;
  }
  return <>{children}</>;
}

// Clears the React Query cache when the authenticated user changes so one
// account's cached data can never leak into another account's session.
function AuthUserCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function AuthedChatWidget() {
  const { isSignedIn } = useAuth();
  return isSignedIn ? <StephChatWidget /> : null;
}

// ── Route tree ─────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <AuthUserCacheInvalidator />
        <Switch>
          <Route path="/screenshot/lesson/:slug" component={ScreenshotLesson} />
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/dashboard">
            <ProtectedRoute><Dashboard /></ProtectedRoute>
          </Route>
          <Route path="/your-influencers">
            <ProtectedRoute><YourInfluencers /></ProtectedRoute>
          </Route>
          <Route path="/masterclass">
            <ProtectedRoute><Masterclass /></ProtectedRoute>
          </Route>
          <Route path="/announcements">
            <ProtectedRoute><AnnouncementsFeed /></ProtectedRoute>
          </Route>
          <Route path="/onboarding">
            <ProtectedRoute><Onboarding /></ProtectedRoute>
          </Route>
          <Route path="/your-build">
            <ProtectedRoute><YourBuild /></ProtectedRoute>
          </Route>
          <Route path="/your-brain">
            <ProtectedRoute><YourBrain /></ProtectedRoute>
          </Route>
          <Route path="/operating-system">
            <ProtectedRoute><OperatingSystem /></ProtectedRoute>
          </Route>
          <Route path="/script-writer">
            <ProtectedRoute><ScriptWriter /></ProtectedRoute>
          </Route>
          <Route path="/influencer/:id">
            <ProtectedRoute><InfluencerDetail /></ProtectedRoute>
          </Route>
          <Route path="/buy-influencer">
            <ProtectedRoute><BuyInfluencer /></ProtectedRoute>
          </Route>
          <Route path="/credits">
            <ProtectedRoute><Credits /></ProtectedRoute>
          </Route>
          <Route path="/video-studio">
            <ProtectedRoute><VideoStudioPage /></ProtectedRoute>
          </Route>
          <Route path="/video-gallery">
            <ProtectedRoute><VideoGalleryPage /></ProtectedRoute>
          </Route>
          <Route path="/ai-tools/automated-influencers">
            <ProtectedRoute><AutomatedInfluencers /></ProtectedRoute>
          </Route>
          <Route path="/automation/jobs/:id">
            <ProtectedRoute><AutomationJobDetailPage /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation">
            <ProtectedRoute><AdminAutomation /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/jobs">
            <ProtectedRoute><AdminAutomationJobs /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/stuck">
            <ProtectedRoute><AdminAutomationStuck /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/audit-log">
            <ProtectedRoute><AdminAutomationAudit /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/provider-configs">
            <ProtectedRoute><AdminAutomationProviderConfigs /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/provider-costs">
            <ProtectedRoute><AdminAutomationProviderCosts /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/provider-errors">
            <ProtectedRoute><AdminAutomationProviderErrors /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/transactions">
            <ProtectedRoute><AdminAutomationTransactions /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/wallets">
            <ProtectedRoute><AdminAutomationWallets /></ProtectedRoute>
          </Route>
          <Route path="/admin/automation/workflow-stats">
            <ProtectedRoute><AdminAutomationWorkflowStats /></ProtectedRoute>
          </Route>
          <Route path="/research-generation">
            <ProtectedRoute><ResearchGeneration /></ProtectedRoute>
          </Route>
          <Route path="/domain-name-generator">
            <ProtectedRoute><DomainNameGenerator /></ProtectedRoute>
          </Route>
          <Route path="/avatar-prompt-generator">
            <ProtectedRoute><AvatarPromptGenerator /></ProtectedRoute>
          </Route>
          <Route path="/a-list">
            <ProtectedRoute><AList /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you">
            <ProtectedRoute><DoneForYou /></ProtectedRoute>
          </Route>
          <Route path="/lesson/:slug">
            {(params) => (
              <ProtectedRoute><CoursePlayer slug={params.slug} /></ProtectedRoute>
            )}
          </Route>
          <Route path="/plugs">
            <ProtectedRoute><Plugs /></ProtectedRoute>
          </Route>
          {/* The affiliate program is retired; old /promote links land on
              the Dashboard instead of a dead page. */}
          <Route path="/promote">
            <Redirect to="/dashboard" />
          </Route>
          <Route path="/workshops">
            <Redirect to="/platinum-club?tab=workshops" />
          </Route>
          <Route path="/assets">
            <ProtectedRoute><AssetsDocs /></ProtectedRoute>
          </Route>
          <Route path="/low-ticket-portal">
            <ProtectedRoute><LowTicketPortal /></ProtectedRoute>
          </Route>
          <Route path="/vsl-templates">
            <ProtectedRoute><VslTemplates /></ProtectedRoute>
          </Route>
          <Route path="/vsl-masterclass">
            <ProtectedRoute><VslMasterclass /></ProtectedRoute>
          </Route>
          <Route path="/vsl-masterclass/print">
            <ProtectedRoute><VslMasterclassPrint /></ProtectedRoute>
          </Route>
          <Route path="/ad-research-board">
            <ProtectedRoute>
              <PortalLayout>
                <div className={PORTAL_PAGE_CLASS}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center py-24 text-white/40 text-[12px] uppercase tracking-[0.18em]">
                        Loading…
                      </div>
                    }
                  >
                    <AdResearchBoard />
                  </Suspense>
                </div>
              </PortalLayout>
            </ProtectedRoute>
          </Route>
          <Route path="/follower-hijack">
            <ProtectedRoute><FollowerHijack /></ProtectedRoute>
          </Route>
          <Route path="/tiktok-slideshow-masterclass">
            <ProtectedRoute><TikTokSlideshowMasterclass /></ProtectedRoute>
          </Route>
          <Route path="/hook-demo-library">
            <ProtectedRoute><HookDemoLibrary /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack">
            <ProtectedRoute><DoneForYouPack /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/100-ai-influencers">
            <ProtectedRoute><Dfy100AiInfluencers /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/250-scenes">
            <ProtectedRoute><Dfy250Scenes /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/250-scenes/folder/:subfolderId">
            {(params) => (
              <ProtectedRoute>
                <Dfy250ScenesFolder subfolderId={params.subfolderId} />
              </ProtectedRoute>
            )}
          </Route>
          <Route path="/done-for-you-pack/bridge-pages">
            <ProtectedRoute><DfyBridgePages /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/canva-ad-templates">
            <ProtectedRoute><DfyCanvaAdTemplates /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/carousel-templates">
            <ProtectedRoute><DfyCarouselTemplates /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/background-music">
            <ProtectedRoute><DfyBackgroundMusic /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/ig-story-templates">
            <ProtectedRoute><DfyIgStoryTemplates /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/ig-story-highlights">
            <ProtectedRoute><DfyIgStoryHighlights /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/ad-swipe-file">
            <ProtectedRoute><DfyAdSwipeFile /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/b-roll">
            <ProtectedRoute><DfyBRoll /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/scripts">
            <ProtectedRoute><DfyScripts /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/funnel-templates">
            <ProtectedRoute><DfyFunnelTemplates /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/advertorial-ad-templates">
            <ProtectedRoute><DfyAdvertorialAdTemplates /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/advertorial-pages">
            <ProtectedRoute><DfyAdvertorialPages /></ProtectedRoute>
          </Route>
          <Route path="/done-for-you-pack/advertorial-swipe-file">
            <ProtectedRoute><DfyAdvertorialSwipeFile /></ProtectedRoute>
          </Route>
          <Route path="/our-portfolio">
            <ProtectedRoute><OurPortfolio /></ProtectedRoute>
          </Route>
          <Route path="/platinum-club">
            <ProtectedRoute><PlatinumClub /></ProtectedRoute>
          </Route>
          <Route path="/support">
            <ProtectedRoute><Support /></ProtectedRoute>
          </Route>
          <Route path="/settings">
            <ProtectedRoute><Settings /></ProtectedRoute>
          </Route>
          <Route path="/admin">
            <ProtectedRoute><AdminDashboard /></ProtectedRoute>
          </Route>
          <Route path="/admin/users">
            <ProtectedRoute><AdminUsers /></ProtectedRoute>
          </Route>
          <Route path="/admin/external-api">
            <ProtectedRoute><AdminExternalApi /></ProtectedRoute>
          </Route>
          <Route path="/admin/api-webhooks">
            <ProtectedRoute><AdminGhlApi /></ProtectedRoute>
          </Route>
          <Route path="/admin/setup">
            <ProtectedRoute><AdminSetup /></ProtectedRoute>
          </Route>
          <Route path="/admin/products">
            <ProtectedRoute><AdminGhlProducts /></ProtectedRoute>
          </Route>
          <Route path="/admin/logs">
            <ProtectedRoute><AdminLogs /></ProtectedRoute>
          </Route>
          <Route path="/admin/invites">
            <ProtectedRoute><AdminInvites /></ProtectedRoute>
          </Route>
          <Route path="/admin/buyer-access">
            <ProtectedRoute><AdminBuyerAccess /></ProtectedRoute>
          </Route>
          <Route path="/admin/support-knowledge">
            <ProtectedRoute><AdminSupportKnowledge /></ProtectedRoute>
          </Route>
          <Route path="/admin/announcements">
            <ProtectedRoute><AdminAnnouncements /></ProtectedRoute>
          </Route>
          <Route path="/admin/influencer-generations">
            <ProtectedRoute><AdminInfluencerGenerations /></ProtectedRoute>
          </Route>
          <Route path="/admin/influencer-scenes">
            <ProtectedRoute><AdminInfluencerScenes /></ProtectedRoute>
          </Route>
          <Route component={NotFound} />
        </Switch>
        <AuthedChatWidget />
      </QueryClientProvider>
    </>
  );
}

// ClerkProvider must live inside WouterRouter so useLocation is available
// for routerPush / routerReplace.
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={{
        theme: shadcn,
        cssLayerName: "clerk",
        variables: {
          colorPrimary: "#C9A44C",
          colorForeground: "#ffffff",
          colorMutedForeground: "rgba(255,255,255,0.45)",
          colorDanger: "#ef4444",
          colorBackground: "#161616",
          colorInput: "#1a1a1a",
          colorInputForeground: "#ffffff",
          colorNeutral: "rgba(255,255,255,0.12)",
          fontFamily: "'Inter', system-ui, sans-serif",
          borderRadius: "0.5rem",
        },
        elements: {
          rootBox: "w-full",
          cardBox: "w-full bg-transparent shadow-none rounded-none",
          card: "!shadow-none !border-0 !bg-transparent !rounded-none",
          footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
          headerTitle: "text-white font-bold",
          headerSubtitle: "text-white/45",
          socialButtonsBlockButtonText: "text-white",
          formFieldLabel: "text-white/40 uppercase text-[11px] tracking-[0.12em] font-bold",
          footerActionLink: "text-[#C9A44C] hover:text-[#d8b566]",
          footerActionText: "text-white/35",
          dividerText: "text-white/30",
          identityPreviewEditButton: "text-[#C9A44C]",
          formFieldSuccessText: "text-green-400",
          alertText: "text-white",
          logoBox: "hidden",
          logoImage: "hidden",
          socialButtonsBlockButton: "border border-white/10 bg-white/5 hover:bg-white/10 text-white",
          formButtonPrimary: "bg-[#C9A44C] hover:bg-[#d8b566] text-black font-bold uppercase tracking-wider",
          formFieldInput: "bg-[#161616] border border-white/10 text-white",
          footerAction: "border-t border-white/5 pt-4",
          dividerLine: "bg-white/10",
          alert: "border border-red-500/20 bg-red-500/10",
          otpCodeFieldInput: "bg-[#161616] border border-white/10 text-white text-center",
          main: "gap-6",
        },
      }}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <AppRoutes />
    </ClerkProvider>
  );
}

function App() {
  return (
    <PortalErrorBoundary>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
        <Toaster />
        <ImpersonationToastListener />
      </WouterRouter>
    </PortalErrorBoundary>
  );
}

export default App;
