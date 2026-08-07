import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { Monitor, FileDown } from "lucide-react";
import { WistiaPlayer } from "@/components/wistia-player";

const WISTIA_VIDEO_ID = "8bejy33b9v";

export default function LowTicketPortal() {
  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Low Ticket Portal
          </h1>
          <p className="text-[14px] text-white/65 mt-2">
            Your 1-click install custom low-ticket portal template. Upload it to your own Replit and go live.
          </p>
        </div>

        <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl overflow-hidden mb-8">
          <div className="aspect-video bg-black relative">
            <WistiaPlayer
              mediaId={WISTIA_VIDEO_ID}
              title="Low Ticket Portal Setup Walkthrough"
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>

        <div className="space-y-3">
          <h2
            className="text-[18px] font-bold uppercase tracking-[0.02em] text-white mb-4"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Portal Files
          </h2>

          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#C9A44C]/10 flex items-center justify-center shrink-0">
              <Monitor className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] text-white font-medium">Custom Low-Ticket Portal Template</p>
              <p className="text-[12px] text-white/55 mt-0.5">Replit project files - upload to your own Replit account</p>
            </div>
            <div className="shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/45 bg-white/[0.06] px-2 py-1 rounded">
                Coming Soon
              </span>
            </div>
          </div>

          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
              <FileDown className="w-5 h-5 text-white/55" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] text-white/50 font-medium">Setup Instructions</p>
              <p className="text-[12px] text-white/45 mt-0.5">Step-by-step guide to deploy your portal</p>
            </div>
            <div className="shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/45 bg-white/[0.06] px-2 py-1 rounded">
                Coming Soon
              </span>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
