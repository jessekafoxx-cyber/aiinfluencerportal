import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useLocation } from "wouter";
import { Play, CheckCircle2, Zap, Lock, RefreshCw, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });

  const enrollMutation = useMutation({
    mutationFn: api.enroll,
    onSuccess: (data) => {
      if (data.enrolled) {
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["course"] });
      }
    },
  });

  useEffect(() => {
    if (me?.user && !me.user.isActive) {
      enrollMutation.mutate();
    }
  }, [me?.user?.id, me?.user?.isActive]);

  const isActive = me?.user?.isActive;

  const { data: course } = useQuery({
    queryKey: ["course"],
    queryFn: api.getCourse,
    enabled: isActive === true,
  });

  const completedLessons = me?.progress?.completedLessons || 0;
  const totalLessons = me?.progress?.totalLessons || 0;
  const progressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  if (me?.user && !isActive) {
    return (
      <PortalLayout>
        <div className="p-6 md:p-10 max-w-[700px] mx-auto">
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-[#C9A44C]/20 flex items-center justify-center mx-auto mb-6">
              <Lock className="w-7 h-7 text-[#C9A44C]" />
            </div>
            <h1
              className="text-[24px] md:text-[28px] font-bold uppercase tracking-[0.01em] text-white leading-tight mb-3"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              Access Required
            </h1>
            <p className="text-[14px] text-white/50 mb-8 max-w-[400px] mx-auto">
              Your account is pending activation. Complete your purchase or contact support to get access.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="/"
                className="inline-flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[13px] font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-colors"
              >
                Get Access Now
              </a>
              <button
                onClick={() => enrollMutation.mutate()}
                disabled={enrollMutation.isPending}
                className="inline-flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] text-white text-[13px] font-medium px-6 py-3 rounded-lg transition-colors border border-white/[0.06] disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${enrollMutation.isPending ? "animate-spin" : ""}`} />
                Check Access
              </button>
            </div>
            {enrollMutation.isError && (
              <p className="text-[12px] text-amber-400 mt-4">
                {(enrollMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Welcome back{me?.user?.firstName ? `, ${me.user.firstName}` : ""}
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Dashboard
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-white/65 uppercase tracking-wider font-bold">Progress</span>
              <Zap className="w-4 h-4 text-[#C9A44C]" />
            </div>
            <p className="text-[32px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {progressPercent}%
            </p>
            <div className="w-full h-2 bg-white/[0.06] rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-[#C9A44C] rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-white/55 mt-2">
              {completedLessons} of {totalLessons} lessons completed
            </p>
          </div>

          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-white/65 uppercase tracking-wider font-bold">Phases</span>
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-[32px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {course?.length || 0}
            </p>
            <p className="text-[11px] text-white/55 mt-2">Total training phases</p>
          </div>

          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-white/65 uppercase tracking-wider font-bold">Lessons</span>
              <Play className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-[32px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {totalLessons}
            </p>
            <p className="text-[11px] text-white/55 mt-2">Total lessons available</p>
          </div>
        </div>

        <button
          onClick={() => setLocation("/masterclass")}
          className="w-full bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#C9A44C]/10 flex items-center justify-center">
              <Play className="w-5 h-5 text-[#C9A44C]" />
            </div>
            <div className="text-left">
              <p
                className="text-[16px] font-bold uppercase text-white group-hover:text-white/90"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Continue Training
              </p>
              <p className="text-[12px] text-white/55 mt-0.5">
                {completedLessons} of {totalLessons} lessons completed
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-white/45 group-hover:text-white/50 transition-colors" />
        </button>
      </div>
    </PortalLayout>
  );
}
