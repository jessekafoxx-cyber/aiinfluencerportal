import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Lock, Sparkles, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { PageNotesPanel } from "@/components/page-notes-panel";
import { WistiaPlayer } from "@/components/wistia-player";
import { isPrelaunchLocked } from "@/lib/prelaunch-lock";

const WISTIA_VIDEO_ID = "3wr4zzrcgw";

export default function TikTokSlideshowMasterclass() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const user = me?.user as any;
  const isAdmin = user?.role === "admin";
  // Unlocked by either the bump3 ($37) order bump (which also unlocks the
  // adjacent IG Follower Hijack page) or the legacy tiktokSlideshowPaid
  // flag for any user an admin already comped before the split.
  const paid = !!user?.bump3Paid || !!user?.tiktokSlideshowPaid || isAdmin;
  // Pre-launch lock for the Friday 15th drop. Toggle via PRELAUNCH_LOCKED in
  // src/lib/prelaunch-lock.ts to unlock the video + notes for everyone.
  const locked = isPrelaunchLocked("/tiktok-slideshow-masterclass");

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-7">
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Premium Add-On
          </p>
          <h1
            className="text-[30px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            TikTok AI Slideshow Masterclass
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[680px]">
            Step-by-step masterclass on the slideshow ad format running on
            TikTok right now - hooks, image stacks, captions and the exact
            posting cadence we use to print views.
          </p>
        </div>

        {locked ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-14 text-center">
            <Lock className="w-8 h-8 text-[#C9A44C]/70 mx-auto mb-4" />
            <p
              className="text-[20px] md:text-[24px] font-bold uppercase tracking-[0.04em] text-white mb-2"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Coming Soon - dropping Friday 15th
            </p>
            <p className="text-[13.5px] text-white/55 max-w-[440px] mx-auto leading-[1.65]">
              The TikTok AI Slideshow Masterclass goes live Friday. We'll flip the page on the moment it's ready.
            </p>
          </div>
        ) : meLoading ? (
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
            {/* Video panel */}
            <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden mb-6 shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
              <div className="aspect-video relative bg-[#111] flex items-center justify-center">
                <WistiaPlayer
                  mediaId={WISTIA_VIDEO_ID}
                  title="TikTok AI Slideshow Masterclass"
                  className="absolute inset-0 w-full h-full"
                />
              </div>
            </div>

            {/* Slideshow Content OS - companion tool. Lives here under the
                masterclass video instead of as its own sidebar row. Same gate
                as this page (bump3Paid || tiktokSlideshowPaid || admin). */}
            <button
              onClick={() => setLocation("/tiktok-slideshow-content-os")}
              data-testid="link-slideshow-content-os"
              className="group w-full text-left bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-5 mb-6 hover:border-[#C9A44C]/40 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#C9A44C]/15 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-[#C9A44C]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-white mb-0.5">
                    Open Slideshow Content OS
                  </p>
                  <p className="text-[12.5px] text-white/55 leading-[1.5]">
                    Generate an in-depth content portfolio brief - niche, themes, 20 slideshow hooks and 20 UGC hooks - from your Brain + offer.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-white/40 group-hover:text-[#C9A44C] transition-colors shrink-0" />
              </div>
            </button>

            {/* Lesson notes - same generative-AI rich text editor as masterclass lessons */}
            <PageNotesPanel
              pageSlug="tiktok-slideshow-masterclass"
              fallbackTitle="TikTok AI Slideshow Masterclass"
            />
          </>
        )}
      </div>
    </PortalLayout>
  );
}
