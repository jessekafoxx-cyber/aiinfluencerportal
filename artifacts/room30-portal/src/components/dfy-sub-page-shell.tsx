import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
  comingSoon?: boolean;
  comingSoonNote?: string;
  banner?: ReactNode;
};

type MeUser = {
  role?: string;
  doneForYouPackPaid?: boolean;
};
type MeResponse = { user?: MeUser };

// Shared layout for every Done For You Pack sub-page. Handles the access
// gate (doneForYouPackPaid || admin), the gold "Premium Add-On" eyebrow
// header, and a consistent "content is being added" empty state.
export function DfySubPageShell({
  title,
  description,
  children,
  comingSoon,
  comingSoonNote,
  banner,
}: Props) {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: meLoading } = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: api.getMe as () => Promise<MeResponse>,
  });
  const paid = !!me?.user?.doneForYouPackPaid;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = paid || isAdmin;

  useEffect(() => {
    if (!meLoading && !hasAccess) setLocation("/dashboard");
  }, [meLoading, hasAccess, setLocation]);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-7">
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Premium Add-On
          </p>
          <h1
            className="text-[30px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {title}
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[760px]">
            {description}
          </p>
        </div>

        {banner}

        {meLoading || !hasAccess ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : comingSoon ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Package className="w-8 h-8 text-[#C9A44C] mx-auto mb-3 opacity-80" />
            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-1 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.06] mb-4">
              Coming soon
            </span>
            <p className="text-[14px] text-white/70 mb-1.5 font-semibold">
              Content is being added.
            </p>
            <p className="text-[13px] text-white/50">
              {comingSoonNote ||
                "This drop lands here as soon as we publish it."}
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </PortalLayout>
  );
}
