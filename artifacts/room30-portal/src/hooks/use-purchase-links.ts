import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

/**
 * Admin-configurable purchase links (Task #7).
 *
 * GET /portal/purchase-links returns `{ links: { [productSlug]: url } }` for
 * every active product whose "Purchase URL" is set on the admin Products
 * page. Locked upgrade surfaces look up their slug here and open the
 * GHL-hosted sales page in a new tab; the GHL purchase webhook then grants
 * the entitlement after checkout.
 *
 * Reserved slugs for surfaces that sell credits rather than a boolean
 * entitlement: `video-credits`, `influencer-credits`.
 */
export function usePurchaseLinks() {
  const q = useQuery({
    queryKey: ["purchase-links"],
    queryFn: () => fetchApi<{ links: Record<string, string> }>("/purchase-links"),
    staleTime: 5 * 60 * 1000,
  });
  return { links: q.data?.links ?? {}, isLoading: q.isLoading };
}
