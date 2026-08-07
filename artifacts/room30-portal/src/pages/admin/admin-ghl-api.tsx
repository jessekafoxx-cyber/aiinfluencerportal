import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { Link } from "wouter";
import {
  Webhook,
  Copy,
  Check,
  RefreshCw,
  Plug,
  Unplug,
  KeyRound,
  Activity as ActivityIcon,
  AlertTriangle,
} from "lucide-react";

type Settings = {
  webhookSecret: string;
  webhookUrl: string;
  ghl: { connected: boolean; locationId?: string; tokenLast4?: string };
  entitlementKeys: { key: string; label: string }[];
};

type WebhookEvent = {
  id: number;
  source: string;
  status: string;
  email: string | null;
  productSlug: string | null;
  detail: string | null;
  createdAt: string;
};

const API = {
  getSettings: (): Promise<Settings> => fetchApi("/admin/ghl/settings"),
  rotateSecret: (): Promise<{ webhookSecret: string; webhookUrl: string }> =>
    fetchApi("/admin/ghl/settings/rotate-webhook-secret", { method: "POST" }),
  connectGhl: (token: string, locationId: string): Promise<{ ok: true }> =>
    fetchApi("/admin/ghl/settings/ghl-connection", {
      method: "POST",
      body: JSON.stringify({ token, locationId }),
    }),
  disconnectGhl: (): Promise<{ ok: true }> =>
    fetchApi("/admin/ghl/settings/ghl-connection", { method: "DELETE" }),
  listEvents: (): Promise<{ events: WebhookEvent[] }> =>
    fetchApi("/admin/ghl/webhook-events?limit=100"),
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    processed: "bg-emerald-500/15 text-emerald-400",
    rejected: "bg-red-500/15 text-red-400",
    error: "bg-red-500/15 text-red-400",
    ignored: "bg-yellow-500/15 text-yellow-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? "bg-white/10 text-white/60"}`}>
      {status}
    </span>
  );
}

export function AdminGhlApi() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["ghl-settings"], queryFn: API.getSettings });
  const eventsQ = useQuery({ queryKey: ["ghl-webhook-events"], queryFn: API.listEvents });

  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const rotateMut = useMutation({
    mutationFn: API.rotateSecret,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ghl-settings"] }),
  });

  const [token, setToken] = useState("");
  const [locationId, setLocationId] = useState("");
  const connectMut = useMutation({
    mutationFn: () => API.connectGhl(token.trim(), locationId.trim()),
    onSuccess: () => {
      setToken("");
      setLocationId("");
      qc.invalidateQueries({ queryKey: ["ghl-settings"] });
    },
  });
  const disconnectMut = useMutation({
    mutationFn: API.disconnectGhl,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ghl-settings"] }),
  });

  const s = settingsQ.data;

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Webhook className="w-6 h-6 text-[#D4AF37]" /> API &amp; Webhooks
          </h1>
          <p className="text-white/50 text-sm mt-1">
            Connect GoHighLevel, wire up the purchase webhook, and manage external API access.
          </p>
        </div>

        {/* Purchase webhook */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-6">
          <h2 className="text-lg font-semibold text-white mb-1">Purchase webhook</h2>
          <p className="text-sm text-white/50 mb-4">
            In your GoHighLevel workflow, add a <span className="text-white/80">Webhook</span> action that
            POSTs to this URL when a purchase completes. Send{" "}
            <code className="text-xs bg-black/40 px-1 py-0.5 rounded">{"{ email, name, product, action }"}</code>{" "}
            where <code className="text-xs bg-black/40 px-1 py-0.5 rounded">product</code> is a product slug from
            the Products page and <code className="text-xs bg-black/40 px-1 py-0.5 rounded">action</code> is{" "}
            <code className="text-xs bg-black/40 px-1 py-0.5 rounded">grant</code> (default) or{" "}
            <code className="text-xs bg-black/40 px-1 py-0.5 rounded">revoke</code> (for refunds).
          </p>
          {s ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={s.webhookUrl}
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 font-mono"
                />
                <button
                  onClick={() => copy("url", s.webhookUrl)}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-1.5"
                >
                  {copied === "url" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  Copy
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Rotate the webhook secret? The old URL stops working immediately and every GHL workflow must be updated with the new URL.",
                      )
                    )
                      rotateMut.mutate();
                  }}
                  disabled={rotateMut.isPending}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${rotateMut.isPending ? "animate-spin" : ""}`} /> Rotate secret
                </button>
                <span className="text-xs text-white/40">
                  Rotating invalidates the current URL — update your GHL workflows afterwards.
                </span>
              </div>
            </div>
          ) : (
            <div className="text-white/40 text-sm">Loading…</div>
          )}
        </div>

        {/* GHL connection */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-6">
          <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <Plug className="w-5 h-5 text-[#D4AF37]" /> GoHighLevel connection
          </h2>
          <p className="text-sm text-white/50 mb-4">
            Optional: connect a Private Integration token (with the <em>View Products</em> scope) and Location ID to
            import your GHL products on the Products page.
          </p>
          {s?.ghl.connected ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/80">
                Connected to location <span className="font-mono">{s.ghl.locationId}</span>{" "}
                <span className="text-white/40">(token ····{s.ghl.tokenLast4})</span>
              </div>
              <button
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
                className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm flex items-center gap-1.5"
              >
                <Unplug className="w-4 h-4" /> Disconnect
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input
                type="password"
                placeholder="Private Integration token (pit-…)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
              />
              <input
                placeholder="Location ID"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80"
              />
              <button
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending || !token.trim() || !locationId.trim()}
                className="px-4 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-semibold disabled:opacity-50"
              >
                {connectMut.isPending ? "Verifying…" : "Connect"}
              </button>
            </div>
          )}
          {connectMut.isError && (
            <p className="mt-2 text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {(connectMut.error as Error)?.message || "Connection failed"}
            </p>
          )}
        </div>

        {/* API keys pointer */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-6">
          <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#D4AF37]" /> External API keys
          </h2>
          <p className="text-sm text-white/50 mb-3">
            The external REST API lives at <code className="text-xs bg-black/40 px-1 py-0.5 rounded">/api/v1/…</code>{" "}
            and authenticates with <code className="text-xs bg-black/40 px-1 py-0.5 rounded">Authorization: Bearer &lt;key&gt;</code>.
            Keys are created and revoked on the External API page (they are shown only once).
          </p>
          <Link
            href="/admin/external-api"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            <KeyRound className="w-4 h-4" /> Manage API keys
          </Link>
          <div className="mt-4 text-xs text-white/40 font-mono space-y-1">
            <div>GET /api/v1/products · GET /api/v1/courses · GET /api/v1/users?email=…</div>
            <div>POST /api/v1/users · GET /api/v1/access?email=… · GET /api/v1/purchases</div>
            <div>POST /api/v1/grants {"{ email, product }"} · POST /api/v1/revocations {"{ email, product }"}</div>
          </div>
        </div>

        {/* Delivery log */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ActivityIcon className="w-5 h-5 text-[#D4AF37]" /> Webhook deliveries
            </h2>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["ghl-webhook-events"] })}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/40 text-xs uppercase">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(eventsQ.data?.events ?? []).map((e) => (
                  <tr key={e.id} className="text-white/70">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatTime(e.createdAt)}</td>
                    <td className="py-2 pr-4">{statusBadge(e.status)}</td>
                    <td className="py-2 pr-4">{e.email ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{e.productSlug ?? "—"}</td>
                    <td className="py-2 text-white/50 text-xs">{e.detail ?? "—"}</td>
                  </tr>
                ))}
                {eventsQ.data && eventsQ.data.events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-white/40">
                      No webhook deliveries yet. Send a test from your GHL workflow to see it here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
