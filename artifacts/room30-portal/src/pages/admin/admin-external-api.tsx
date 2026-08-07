import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  ShieldOff,
  Shield,
  RefreshCw,
  Activity as ActivityIcon,
} from "lucide-react";

type ExternalApiKey = {
  id: number;
  name: string;
  last4: string;
  createdByEmail: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
};

type AuditRow = {
  id: number;
  keyName: string | null;
  keyLast4: string | null;
  method: string;
  path: string;
  action: string;
  targetEmail: string | null;
  reason: string | null;
  ip: string | null;
  statusCode: number;
  errorCode: string | null;
  errorMessage: string | null;
  beforeState: any;
  afterState: any;
  requestBody: any;
  createdAt: string;
};

type Settings = {
  killSwitchEnabled: boolean;
  killSwitchReason: string | null;
  killSwitchToggledAt: string | null;
  killSwitchToggledByEmail: string | null;
};

const API = {
  listKeys: (): Promise<{ keys: ExternalApiKey[] }> =>
    fetchApi("/admin/external-api/keys"),
  createKey: (name: string): Promise<{ key: ExternalApiKey; plaintext: string }> =>
    fetchApi("/admin/external-api/keys", { method: "POST", body: JSON.stringify({ name }) }),
  revokeKey: (id: number, reason: string): Promise<{ ok: true }> =>
    fetchApi(`/admin/external-api/keys/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  getAuditLog: (
    params: { email?: string; action?: string; limit?: number } = {},
  ): Promise<{ rows: AuditRow[] }> => {
    const qs = new URLSearchParams();
    if (params.email) qs.set("email", params.email);
    if (params.action) qs.set("action", params.action);
    if (params.limit) qs.set("limit", String(params.limit));
    const tail = qs.toString();
    return fetchApi(`/admin/external-api/audit-log${tail ? `?${tail}` : ""}`);
  },
  getSettings: (): Promise<{ settings: Settings }> =>
    fetchApi("/admin/external-api/settings"),
  toggleKillSwitch: (enabled: boolean, reason: string): Promise<{ settings: Settings }> =>
    fetchApi("/admin/external-api/settings/kill-switch", {
      method: "POST",
      body: JSON.stringify({ enabled, reason }),
    }),
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function AdminExternalApi() {
  const qc = useQueryClient();
  const keysQ = useQuery({ queryKey: ["external-api-keys"], queryFn: API.listKeys });
  const settingsQ = useQuery({ queryKey: ["external-api-settings"], queryFn: API.getSettings });

  const [auditEmail, setAuditEmail] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const auditQ = useQuery({
    queryKey: ["external-api-audit", auditEmail, auditAction],
    queryFn: () => API.getAuditLog({ email: auditEmail || undefined, action: auditAction || undefined, limit: 100 }),
  });

  const [newName, setNewName] = useState("");
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createMut = useMutation({
    mutationFn: (name: string) => API.createKey(name),
    onSuccess: (data) => {
      setCreatedPlaintext(data.plaintext);
      setNewName("");
      qc.invalidateQueries({ queryKey: ["external-api-keys"] });
    },
  });

  const revokeMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => API.revokeKey(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["external-api-keys"] }),
  });

  const [killReason, setKillReason] = useState("");
  const killMut = useMutation({
    mutationFn: ({ enabled, reason }: { enabled: boolean; reason: string }) =>
      API.toggleKillSwitch(enabled, reason),
    onSuccess: () => {
      setKillReason("");
      qc.invalidateQueries({ queryKey: ["external-api-settings"] });
    },
  });

  const settings = settingsQ.data?.settings;
  const killOn = !!settings?.killSwitchEnabled;

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="flex items-end justify-between gap-4 mb-10 flex-wrap">
          <div>
            <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
              Admin Panel
            </p>
            <h1
              className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              External Admin API
            </h1>
            <p className="text-white/55 text-[14px] mt-2 max-w-2xl">
              API keys for partner agents (e.g. GetViktor) to read and manage portal entitlements.
              Every authenticated call is logged below. Use the kill switch to disable the entire
              external API immediately.
            </p>
          </div>
        </div>

        <div
          className={`mb-10 rounded-xl border p-5 ${
            killOn
              ? "bg-red-950/30 border-red-500/40"
              : "bg-white/[0.03] border-white/[0.08]"
          }`}
        >
          <div className="flex items-start gap-3">
            {killOn ? (
              <ShieldOff className="w-5 h-5 text-red-400 mt-0.5" />
            ) : (
              <Shield className="w-5 h-5 text-emerald-400 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-semibold text-[15px]">
                {killOn ? "Kill switch is ENABLED" : "External API is live"}
              </h2>
              <p className="text-white/60 text-[13px] mt-1">
                {killOn
                  ? "Every external call is returning HTTP 503. Toggle off to restore service."
                  : "External callers with a valid key can hit every endpoint."}
              </p>
              {killOn && settings?.killSwitchReason && (
                <p className="text-red-300 text-[12px] mt-2">
                  Reason: {settings.killSwitchReason}
                </p>
              )}
              {settings?.killSwitchToggledAt && (
                <p className="text-white/40 text-[11px] mt-2">
                  Last toggled {formatTime(settings.killSwitchToggledAt)}
                  {settings.killSwitchToggledByEmail
                    ? ` by ${settings.killSwitchToggledByEmail}`
                    : ""}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {!killOn && (
                <input
                  type="text"
                  placeholder="Optional reason..."
                  value={killReason}
                  onChange={(e) => setKillReason(e.target.value)}
                  className="px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-white text-[12px] w-56"
                />
              )}
              <button
                onClick={() => killMut.mutate({ enabled: !killOn, reason: killReason })}
                disabled={killMut.isPending}
                className={`px-4 py-2 rounded-md text-[13px] font-semibold ${
                  killOn
                    ? "bg-emerald-500 text-black hover:bg-emerald-400"
                    : "bg-red-500 text-white hover:bg-red-400"
                } disabled:opacity-50`}
              >
                {killOn ? "Disable kill switch" : "Enable kill switch"}
              </button>
            </div>
          </div>
        </div>

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white text-[18px] font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-[#C9A44C]" /> API Keys
            </h2>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["external-api-keys"] })}
              className="text-white/50 hover:text-white text-[12px] flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
            <p className="text-white/65 text-[13px] mb-3">
              Create a new key. The plaintext value is shown once after creation - copy it
              immediately and store it in the partner agent's secret store. We only keep a
              hash plus the last 4 characters here.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Key label (e.g. GetViktor production)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white text-[13px]"
              />
              <button
                onClick={() => createMut.mutate(newName.trim())}
                disabled={!newName.trim() || createMut.isPending}
                className="px-4 py-2 rounded-md bg-[#C9A44C] text-black text-[13px] font-semibold hover:bg-[#d6b35a] disabled:opacity-50 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Create key
              </button>
            </div>
            {createdPlaintext && (
              <div className="mt-4 p-3 rounded-md bg-emerald-950/40 border border-emerald-500/30">
                <p className="text-emerald-300 text-[12px] font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Copy this key now - it will not be shown again
                </p>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 px-2 py-1.5 rounded bg-black/60 text-emerald-200 text-[12px] break-all font-mono">
                    {createdPlaintext}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdPlaintext);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="px-3 py-1.5 rounded bg-emerald-500 text-black text-[12px] font-semibold hover:bg-emerald-400 flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => setCreatedPlaintext(null)}
                    className="px-3 py-1.5 rounded bg-white/10 text-white text-[12px] hover:bg-white/15"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {keysQ.isLoading ? (
            <p className="text-white/55 text-[13px]">Loading keys...</p>
          ) : (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-white/[0.04] text-white/60 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Suffix</th>
                    <th className="text-left px-4 py-3">Created</th>
                    <th className="text-left px-4 py-3">Last used</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(keysQ.data?.keys ?? []).map((k) => (
                    <tr key={k.id} className="border-t border-white/[0.06] hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white">{k.name}</td>
                      <td className="px-4 py-3 text-white/65 font-mono text-[12px]">…{k.last4}</td>
                      <td className="px-4 py-3 text-white/55 text-[12px]">
                        {formatTime(k.createdAt)}
                        {k.createdByEmail && (
                          <div className="text-white/40 text-[11px]">by {k.createdByEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/55 text-[12px]">
                        {formatTime(k.lastUsedAt)}
                        {k.lastUsedIp && (
                          <div className="text-white/40 text-[11px]">{k.lastUsedIp}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {k.revokedAt ? (
                          <span className="text-red-300 text-[12px]">
                            Revoked {formatTime(k.revokedAt)}
                          </span>
                        ) : (
                          <span className="text-emerald-300 text-[12px]">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!k.revokedAt && (
                          <button
                            onClick={() => {
                              const reason = window.prompt(
                                `Revoke "${k.name}"? Provide an audit reason:`,
                                "",
                              );
                              if (reason && reason.trim()) {
                                revokeMut.mutate({ id: k.id, reason: reason.trim() });
                              }
                            }}
                            className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[12px] inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(keysQ.data?.keys ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-white/40 text-[13px]">
                        No keys yet. Create one above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-white text-[18px] font-semibold flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-[#C9A44C]" /> Audit log
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Filter by email"
                value={auditEmail}
                onChange={(e) => setAuditEmail(e.target.value)}
                className="px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-white text-[12px] w-48"
              />
              <input
                type="text"
                placeholder="Filter by action"
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value)}
                className="px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-white text-[12px] w-48"
              />
              <button
                onClick={() => qc.invalidateQueries({ queryKey: ["external-api-audit"] })}
                className="px-3 py-1.5 rounded-md bg-white/[0.06] text-white text-[12px] hover:bg-white/10 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
          </div>

          {auditQ.isLoading ? (
            <p className="text-white/55 text-[13px]">Loading log...</p>
          ) : (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-white/[0.04] text-white/60 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Key</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Target</th>
                    <th className="text-left px-3 py-2">Reason</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditQ.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-white/[0.06] align-top">
                      <td className="px-3 py-2 text-white/55 whitespace-nowrap">
                        {formatTime(r.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-white/70">
                        {r.keyName ? (
                          <>
                            {r.keyName}
                            <div className="text-white/40 text-[10px] font-mono">…{r.keyLast4}</div>
                          </>
                        ) : (
                          <span className="text-white/40">unauthenticated</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white">
                        {r.action}
                        <div className="text-white/40 text-[10px]">
                          {r.method} {r.path}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-white/70">{r.targetEmail || "—"}</td>
                      <td className="px-3 py-2 text-white/55 max-w-xs truncate" title={r.reason || ""}>
                        {r.reason || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            r.statusCode >= 500
                              ? "bg-red-500/15 text-red-300"
                              : r.statusCode >= 400
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {r.statusCode}
                        </span>
                        {r.errorCode && (
                          <div className="text-red-300 text-[10px] mt-1">{r.errorCode}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(auditQ.data?.rows ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-white/40 text-[13px]">
                        No audit entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
