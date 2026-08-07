import { PortalLayout } from "@/components/portal-layout";
import { Coins } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface CreditsBalance {
  balance: number;
  reservedBalance: number;
}

export default function Credits() {
  const { data } = useQuery<CreditsBalance>({
    queryKey: ["credits", "balance"],
    queryFn: async (): Promise<CreditsBalance> => {
      const res = await fetch("/api/automation/credits/balance", {
        credentials: "include",
      });
      if (!res.ok) return { balance: 0, reservedBalance: 0 };
      return (await res.json()) as CreditsBalance;
    },
  });
  const balance = data?.balance ?? 0;
  const reserved = data?.reservedBalance ?? 0;

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <Coins className="w-6 h-6" style={{ color: "#C9A44C" }} />
          <h1 className="text-2xl font-semibold text-white">Credits</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
              Available
            </div>
            <div className="text-3xl font-semibold" style={{ color: "#C9A44C" }}>
              {balance}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
              Reserved
            </div>
            <div className="text-3xl font-semibold text-white/70">{reserved}</div>
          </div>
        </div>
        <div className="text-sm text-white/50">Credit purchase flow coming soon.</div>
      </div>
    </PortalLayout>
  );
}
