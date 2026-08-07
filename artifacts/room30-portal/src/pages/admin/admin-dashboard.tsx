import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { Users, BookOpen, Activity, TrendingUp, ShieldCheck, AlertTriangle, XCircle, Loader2 } from "lucide-react";

export function AdminDashboard() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: api.admin.getAnalytics,
    // The analytics endpoint is a heavy aggregation; refetching it on every
    // window focus made the dashboard feel like it was perpetually refreshing.
    refetchOnWindowFocus: false,
  });

  const {
    data: health,
    isLoading: healthLoading,
    isError: healthError,
  } = useQuery({
    queryKey: ["admin-health-check"],
    queryFn: api.admin.getHealthCheck,
    refetchOnWindowFocus: false,
  });

  const stats = [
    {
      label: "Total Users",
      value: analytics?.totalUsers || 0,
      icon: Users,
      color: "text-[#C9A44C]",
      bg: "bg-[#C9A44C]/10",
    },
    {
      label: "Total Lessons",
      value: analytics?.totalLessons || 0,
      icon: BookOpen,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Completions",
      value: analytics?.totalCompletions || 0,
      icon: Activity,
      color: "text-green-400",
      bg: "bg-green-400/10",
    },
    {
      label: "Avg. Progress",
      value: analytics?.averageProgress ? `${Math.round(analytics.averageProgress)}%` : "0%",
      icon: TrendingUp,
      color: "text-yellow-400",
      bg: "bg-yellow-400/10",
    },
  ];

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-10">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Admin Panel
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Analytics Overview
          </h1>
        </div>

        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-[#C9A44C]" />
            <h2
              className="text-[15px] font-bold uppercase tracking-[0.04em] text-white"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              System Health
            </h2>
          </div>
          {healthLoading ? (
            <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-6 flex items-center gap-3 text-white/55 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Running health checks...
            </div>
          ) : healthError ? (
            <div className="bg-red-500/[0.05] border border-red-500/30 rounded-xl p-5 text-[13px] text-red-300">
              Could not run health checks. Try refreshing the page.
            </div>
          ) : health ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="admin-health-check">
              {health.audits.map((a) => {
                const isOk = a.severity === "ok";
                const isError = a.severity === "error";
                const Icon = isOk ? ShieldCheck : isError ? XCircle : AlertTriangle;
                const tone = isOk
                  ? "border-white/[0.06] text-green-400"
                  : isError
                    ? "border-red-500/30 text-red-400"
                    : "border-yellow-500/30 text-yellow-400";
                return (
                  <div
                    key={a.name}
                    className={`bg-[#0f0f0f] border ${tone.split(" ").slice(0, 2).join(" ")} rounded-xl p-4`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone.split(" ").slice(2).join(" ")}`} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-white/85">{a.label}</p>
                        <p className="text-[12.5px] text-white/55 mt-1 leading-[1.5]">{a.summary}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] text-white/65 uppercase tracking-wider font-bold">
                      {stat.label}
                    </span>
                    <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                      <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                  </div>
                  <p
                    className="text-[32px] font-bold text-white"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {analytics?.lessonCompletions && analytics.lessonCompletions.length > 0 && (
              <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/[0.06]">
                  <h3
                    className="text-[16px] font-bold uppercase text-white"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    Lesson Completion Rates
                  </h3>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {analytics.lessonCompletions.map((lc: any) => (
                    <div key={lc.lessonId} className="px-6 py-3 flex items-center justify-between">
                      <span className="text-[13px] text-white/70">{lc.title}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#C9A44C] rounded-full"
                            style={{ width: `${Math.min(100, (lc.completions / (analytics.totalUsers || 1)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[12px] text-white/65 w-8 text-right">
                          {lc.completions}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
