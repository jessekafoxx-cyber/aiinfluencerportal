import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";

type OrderRow = {
  id: string;
  email: string | null;
  productSlugs: string | null;
  mainProductPaid: boolean | null;
  bump1Paid: boolean | null;
  bump2Paid: boolean | null;
  bump3Paid: boolean | null;
  upsell1Paid: boolean | null;
  downsell1Paid: boolean | null;
  upsell2Paid: boolean | null;
  upsell3Paid: boolean | null;
  whopUserId: string | null;
  whopReceiptId: string | null;
  whopBundlePlanId: string | null;
  totalAmount: number | null;
  createdAt: string | null;
};

type BuyerAccessResponse = {
  email: string;
  orders: OrderRow[];
  portalUser: {
    id: number;
    email: string | null;
    clerkId: string | null;
    whopUserId: string | null;
    isActive: boolean | null;
    isAList: boolean | null;
    createdAt: string | null;
    bonusInfluencerQuota: number | null;
  } | null;
  whopMemberships: Array<{
    id: string;
    product_id?: string;
    status: string;
    valid: boolean;
    created_at?: number | string;
  }>;
  whopLookupError: string | null;
  founderCode: {
    code: string;
    status: string;
    redeemedAt: string | null;
    redeemedForProductSlug: string | null;
  } | null;
};

type ResyncResponse = {
  email: string;
  orderId: string | null;
  flipped: boolean;
  fieldsFlipped: string[];
  fieldsAlreadyTrue: string[];
  unmappedSlugs: string[];
  founderCodeEnsured: boolean;
  enrollmentEmailStatus: "sent" | "skipped" | "not_attempted";
};

const FLAG_KEYS = [
  "mainProductPaid",
  "bump1Paid",
  "bump2Paid",
  "bump3Paid",
  "upsell1Paid",
  "downsell1Paid",
  "upsell2Paid",
  "upsell3Paid",
] as const;

function InfluencerBonusPanel({
  userId,
  email,
  initialValue,
  onUpdated,
}: {
  userId: number;
  email: string;
  initialValue: number;
  onUpdated: () => void;
}) {
  const [addAmount, setAddAmount] = useState<string>("1");
  const [setAmount, setSetAmount] = useState<string>(String(initialValue));
  const [lastResult, setLastResult] = useState<
    | { previous: number; bonusInfluencerQuota: number; delta: number }
    | null
  >(null);

  const mutation = useMutation({
    mutationFn: async (body: { add?: number; set?: number }) => {
      return api.fetchApi<{
        userId: number;
        email: string;
        bonusInfluencerQuota: number;
        previous: number;
        delta: number;
      }>(`/api/portal/admin/users/${userId}/influencer-bonus`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      setLastResult({
        previous: data.previous,
        bonusInfluencerQuota: data.bonusInfluencerQuota,
        delta: data.delta,
      });
      setSetAmount(String(data.bonusInfluencerQuota));
      onUpdated();
    },
  });

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">
        Bonus AI Influencer generations
      </h2>
      <p className="text-sm text-zinc-400 mb-3">
        Manually granted on top of the base entitlement (1 free + 5 from
        Upsell 2). Current bonus for <code>{email}</code>:{" "}
        <strong className="text-amber-400">{initialValue}</strong>.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <label className="text-xs text-zinc-400 flex flex-col">
            Add (negative to take back)
            <input
              type="number"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              className="mt-1 w-28 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white"
            />
          </label>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              const n = parseInt(addAmount, 10);
              if (Number.isNaN(n)) return;
              mutation.mutate({ add: n });
            }}
            className="px-3 py-1 rounded bg-amber-500 text-black font-semibold disabled:opacity-50"
          >
            Apply add
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-zinc-400 flex flex-col">
            Or set to exactly
            <input
              type="number"
              min={0}
              value={setAmount}
              onChange={(e) => setSetAmount(e.target.value)}
              className="mt-1 w-28 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white"
            />
          </label>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              const n = parseInt(setAmount, 10);
              if (Number.isNaN(n) || n < 0) return;
              mutation.mutate({ set: n });
            }}
            className="px-3 py-1 rounded bg-emerald-500 text-black font-semibold disabled:opacity-50"
          >
            Apply set
          </button>
        </div>
      </div>
      {mutation.isError && (
        <div className="mt-2 p-2 rounded bg-red-900/40 border border-red-700 text-red-200 text-sm">
          Update failed: {(mutation.error as Error)?.message}
        </div>
      )}
      {lastResult && !mutation.isError && (
        <div className="mt-2 text-sm text-zinc-300">
          Updated: {lastResult.previous} -&gt;{" "}
          <strong className="text-amber-400">
            {lastResult.bonusInfluencerQuota}
          </strong>{" "}
          (delta {lastResult.delta >= 0 ? "+" : ""}
          {lastResult.delta}). New total cap for this user:{" "}
          {1 + lastResult.bonusInfluencerQuota}+ (plus any upsell-driven
          bonuses on their orders).
        </div>
      )}
    </section>
  );
}

export function AdminBuyerAccess() {
  const [emailInput, setEmailInput] = useState("");
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [lastResync, setLastResync] = useState<ResyncResponse | null>(null);

  const query = useQuery<BuyerAccessResponse>({
    queryKey: ["admin-buyer-access", activeEmail],
    enabled: !!activeEmail,
    queryFn: async () => {
      return api.fetchApi<BuyerAccessResponse>(
        `/api/portal/admin/buyer-access?email=${encodeURIComponent(activeEmail!)}`,
      );
    },
  });

  const resync = useMutation({
    mutationFn: async (email: string) => {
      return api.fetchApi<ResyncResponse>(
        `/api/portal/admin/buyer-access/resync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
    },
    onSuccess: (data) => {
      setLastResync(data);
      query.refetch();
    },
  });

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <h1 className="text-2xl font-bold mb-4">Buyer access lookup</h1>
        <p className="text-sm text-zinc-400 mb-6">
          Find a buyer's full entitlement state across our DB and Whop. Press
          Resync to call <code>reconcileBuyerFromWhop</code> — same helper used
          by the webhook fallback and the MAY2026 backfill script.
        </p>
        <form
          className="flex gap-2 mb-6"
          onSubmit={(e) => {
            e.preventDefault();
            const v = emailInput.trim().toLowerCase();
            if (v) setActiveEmail(v);
            setLastResync(null);
          }}
        >
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="buyer@example.com"
            className="flex-1 px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-white"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-amber-500 text-black font-semibold"
          >
            Look up
          </button>
        </form>

        {query.isError && (
          <div className="p-3 rounded bg-red-900/40 border border-red-700 text-red-200 mb-4">
            Lookup failed: {(query.error as Error)?.message}
          </div>
        )}

        {query.data && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => resync.mutate(query.data!.email)}
                disabled={resync.isPending}
                className="px-4 py-2 rounded bg-emerald-500 text-black font-semibold disabled:opacity-50"
              >
                {resync.isPending ? "Resyncing..." : "Resync from Whop"}
              </button>
              {lastResync && (
                <span className="text-sm text-zinc-300">
                  {lastResync.flipped
                    ? `Flipped: ${lastResync.fieldsFlipped.join(", ")}`
                    : "No changes (already matched Whop)"}
                  {lastResync.founderCodeEnsured && " · founder code ok"}
                  {lastResync.enrollmentEmailStatus === "sent" &&
                    " · enrollment email sent"}
                </span>
              )}
            </div>

            <section>
              <h2 className="text-lg font-semibold mb-2">Portal user</h2>
              {query.data.portalUser ? (
                <pre className="text-xs bg-zinc-900 p-3 rounded overflow-auto">
                  {JSON.stringify(query.data.portalUser, null, 2)}
                </pre>
              ) : (
                <p className="text-zinc-400 text-sm">No portal_users row.</p>
              )}
            </section>

            {query.data.portalUser && (
              <InfluencerBonusPanel
                userId={query.data.portalUser.id}
                email={query.data.email}
                initialValue={query.data.portalUser.bonusInfluencerQuota ?? 0}
                onUpdated={() => query.refetch()}
              />
            )}

            <section>
              <h2 className="text-lg font-semibold mb-2">
                Orders ({query.data.orders.length})
              </h2>
              {query.data.orders.length === 0 ? (
                <p className="text-zinc-400 text-sm">No orders.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-400">
                        <th className="pr-3 py-1">id</th>
                        <th className="pr-3 py-1">created</th>
                        {FLAG_KEYS.map((k) => (
                          <th key={k} className="pr-3 py-1">
                            {k.replace("Paid", "")}
                          </th>
                        ))}
                        <th className="pr-3 py-1">whopUserId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.orders.map((o) => (
                        <tr key={o.id} className="border-t border-zinc-800">
                          <td className="pr-3 py-1 font-mono">{o.id}</td>
                          <td className="pr-3 py-1">
                            {o.createdAt
                              ? new Date(o.createdAt).toISOString().slice(0, 19)
                              : ""}
                          </td>
                          {FLAG_KEYS.map((k) => (
                            <td key={k} className="pr-3 py-1">
                              {o[k] ? "✓" : "·"}
                            </td>
                          ))}
                          <td className="pr-3 py-1 font-mono">
                            {o.whopUserId || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">
                Whop memberships ({query.data.whopMemberships.length})
              </h2>
              {query.data.whopLookupError && (
                <div className="p-2 rounded bg-amber-900/40 border border-amber-700 text-amber-200 text-sm mb-2">
                  Lookup error: {query.data.whopLookupError}
                </div>
              )}
              <pre className="text-xs bg-zinc-900 p-3 rounded overflow-auto">
                {JSON.stringify(query.data.whopMemberships, null, 2)}
              </pre>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-2">
                Platinum Founder Code
              </h2>
              {query.data.founderCode ? (
                <pre className="text-xs bg-zinc-900 p-3 rounded overflow-auto">
                  {JSON.stringify(query.data.founderCode, null, 2)}
                </pre>
              ) : (
                <p className="text-zinc-400 text-sm">Not issued.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
