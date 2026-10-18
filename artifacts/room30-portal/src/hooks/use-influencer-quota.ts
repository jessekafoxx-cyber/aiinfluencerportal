import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

export type InfluencerQuota = {
  used: number;
  total: number;
  bonusUnlocked: boolean;
  unlockSeen: boolean;
};

// Both the gallery and request form must use the server's quota, not
// guessed defaults or the unrelated /me response.
export function useInfluencerQuota() {
  return useQuery<InfluencerQuota>({
    queryKey: ["influencer-quota"],
    queryFn: () => fetchApi("/influencer-jobs/quota"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
}
