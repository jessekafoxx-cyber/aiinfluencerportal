import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { PageNotesPanel } from "@/components/page-notes-panel";
import { isPrelaunchLocked } from "@/lib/prelaunch-lock";

export default function FollowerHijack() {
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const user = me?.user as any;
  const isAdmin = user?.role === "admin";
  // bump3Paid is the new bundle unlock; tiktokSlideshowPaid is kept as a
  // legacy unlock path so anyone an admin already comped on the old flag
  // keeps access to both adjacent pages without needing a new charge.
  const paid = !!user?.bump3Paid || !!user?.tiktokSlideshowPaid || isAdmin;
  // Pre-launch lock for the Friday 15th drop. Toggle via PRELAUNCH_LOCKED in
  // src/lib/prelaunch-lock.ts. Locks everyone (incl. paid users) out of the
  // video + notes until launch. Admins are also held back so the placeholder
  // can be QA'd against production.
  const locked = isPrelaunchLocked("/follower-hijack");

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
            IG Follower Hijack
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[680px]">
            Ethically pull your competitors' warmest IG followers into your
            world, then hit them with your organic content and paid ads on
            autopilot.
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
              The IG Follower Hijack masterclass goes live Friday. We'll flip the page on the moment it's ready.
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
          <PageNotesPanel pageSlug="follower-hijack" fallbackTitle="IG Follower Hijack" />
        )}
      </div>
    </PortalLayout>
  );
}
