import { useParams, useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getGetAutomationJobQueryKey,
  type AutomationJobDetail,
} from "@workspace/api-client-react";

export default function AutomationJobDetailPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id ?? "";
  const { data, isLoading } = useQuery<AutomationJobDetail | null>({
    queryKey: getGetAutomationJobQueryKey(id),
    queryFn: async () => {
      const res = await fetch(`/api/automation/jobs/${id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <button
          onClick={() => setLocation("/ai-tools/automated-influencers")}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Back to automation
        </button>
        <h1 className="text-xl font-semibold text-white mb-6">Job {id}</h1>
        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-white/40" />
        ) : !data ? (
          <div className="text-white/60">Job not found.</div>
        ) : (
          <pre className="text-xs text-white/70 bg-black/40 rounded-lg p-4 overflow-x-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </PortalLayout>
  );
}
