import { useEffect } from "react";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  useGetOnboardingStatus,
  type OnboardingStatus,
} from "@workspace/api-client-react";

const FALLBACK: OnboardingStatus = {
  status: "pending",
  progress: 0,
  log: [],
  avatarUrl: null,
  influencerId: null,
  profile: null,
};

export default function YourBuild() {
  const [, setLocation] = useLocation();
  const { data, refetch } = useGetOnboardingStatus({
    query: { refetchInterval: 4000 },
  });
  const s: OnboardingStatus = data ?? FALLBACK;

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Once the build is complete, redirect into the new influencer's detail
  // page (per requirements). Fall back to the list if no id was returned.
  useEffect(() => {
    if (s.status !== "complete") return undefined;
    const t = setTimeout(() => {
      setLocation(
        s.influencerId ? `/influencer/${s.influencerId}` : "/your-influencers",
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [s.status, s.influencerId, setLocation]);

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
          {s.status === "complete" ? (
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-400" />
          ) : s.status === "failed" ? (
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
          ) : (
            <Loader2
              className="w-12 h-12 mx-auto mb-4 animate-spin"
              style={{ color: "#C9A44C" }}
            />
          )}
          <h1 className="text-2xl font-semibold text-white mb-2">
            {s.status === "complete"
              ? "Your influencer is ready"
              : s.status === "failed"
              ? "Build failed"
              : "Building your influencer"}
          </h1>
          <p className="text-white/60 mb-6">
            {s.status === "complete"
              ? "Opening your new influencer…"
              : s.status === "failed"
              ? "Please try again or contact support."
              : "This usually takes a few minutes. You can leave this page and come back."}
          </p>

          {s.avatarUrl && (
            <img
              src={s.avatarUrl}
              alt="avatar"
              className="w-32 h-32 rounded-full mx-auto mb-6 object-cover"
            />
          )}

          <div className="w-full bg-white/[0.05] rounded-full h-2 mb-6">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${s.progress}%`, background: "#C9A44C" }}
            />
          </div>

          {s.log.length > 0 && (
            <div className="text-left text-xs text-white/50 max-h-40 overflow-y-auto bg-black/30 rounded-lg p-3">
              {s.log.map((l, i) => (
                <div key={i}>• {l}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
