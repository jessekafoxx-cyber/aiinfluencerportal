import { useState, useEffect, useCallback } from "react";
import { Save, Trash2, Zap } from "lucide-react";
import { getAuthHeaders } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "";

function useAdminFetch() {
  return useCallback(async (url: string, options: RequestInit = {}) => {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api${url}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders, ...options.headers },
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res;
  }, []);
}

interface IgCookiesMetadata {
  present: boolean;
  configured: boolean;
  status: string;
  savedAt: string | null;
  savedBy: string | null;
  cookieCount: number;
  sessionidPreview: string | null;
  inferredExpiresAt: string | null;
  hasRequiredCookies: boolean;
  missingRequired: string[];
  lastError: string | null;
}

export function InstagramCookiesPanel() {
  const fetchWithAuth = useAdminFetch();
  const [meta, setMeta] = useState<IgCookiesMetadata | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "quota"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/portal/admin/instagram-cookies");
      const data = await res.json();
      setMeta(data);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Failed to load" });
    }
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!paste.trim()) return;
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/portal/admin/instagram-cookies`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ cookiesJson: paste }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error || `HTTP ${res.status}` });
      } else {
        setMeta(data);
        setPaste("");
        setMsg({ kind: "ok", text: `Saved ${data.cookieCount} cookies.` });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Save failed" });
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!confirm("Delete the saved Instagram session cookies?")) return;
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      const res = await fetchWithAuth("/portal/admin/instagram-cookies", { method: "DELETE" });
      const data = await res.json();
      setMeta(data);
      setMsg({ kind: "ok", text: "Session cookies deleted." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Delete failed" });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      const res = await fetchWithAuth("/portal/admin/instagram-cookies/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data.result);
      if (data.metadata) setMeta(data.metadata);
      if (data.ok) setMsg({ kind: "ok", text: "Apify accepted the session." });
      else if (data.result?.status === "quota-exceeded") setMsg({ kind: "quota", text: "APIFY QUOTA EXCEEDED" });
      else setMsg({ kind: "err", text: `Probe failed: ${data.result?.error || data.result?.status || "unknown"}` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Test failed" });
    } finally { setBusy(false); }
  };

  const statusColor = meta?.status === "active"
    ? "bg-green-500/10 text-green-300 border-green-500/30"
    : meta?.status === "expired"
      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : "bg-white/5 text-white/65 border-white/10";

  return (
    <div className="space-y-4">
      <div className="bg-[#111] border border-white/[0.06] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              INSTAGRAM SESSION COOKIES
            </h3>
            <p className="text-[12px] text-white/55 mt-1">
              Paste a Cookie-Editor / EditThisCookie JSON export from a logged-in Instagram session. Stored encrypted and injected into every Apify Instagram actor call.
            </p>
          </div>
          <span className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded border ${statusColor}`}>
            {meta?.status || "loading"}
          </span>
        </div>

        {meta && !meta.configured && (
          <div className="text-[12px] rounded-lg px-3 py-2 mb-3 bg-amber-500/10 text-amber-300 border border-amber-500/30">
            INSTAGRAM_COOKIES_SECRET env var is not set. Set it before saving cookies.
          </div>
        )}

        {meta?.present && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-[12px] text-white/65">
            <div><span className="text-white/45">Saved:</span> {meta.savedAt ? new Date(meta.savedAt).toLocaleString() : "-"}</div>
            <div><span className="text-white/45">By:</span> {meta.savedBy || "-"}</div>
            <div><span className="text-white/45">Cookie count:</span> {meta.cookieCount}</div>
            <div><span className="text-white/45">sessionid:</span> <code>{meta.sessionidPreview || "-"}</code></div>
            <div><span className="text-white/45">Inferred expiry:</span> {meta.inferredExpiresAt ? new Date(meta.inferredExpiresAt).toLocaleDateString() : "-"}</div>
            <div><span className="text-white/45">Required cookies present:</span> {meta.hasRequiredCookies ? "yes" : `missing ${meta.missingRequired.join(", ")}`}</div>
            {meta.lastError && (
              <div className="md:col-span-2"><span className="text-white/45">Last error:</span> <span className="text-amber-300">{meta.lastError}</span></div>
            )}
          </div>
        )}

        <label className="text-[12px] text-white/65 uppercase tracking-wider block mb-1">
          Paste cookies JSON
        </label>
        <textarea
          value={paste}
          onChange={e => setPaste(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='[{"name":"sessionid","value":"…","domain":".instagram.com","path":"/", …}, …]'
          className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/70 font-mono leading-relaxed resize-y focus:outline-none focus:border-[#C9A44C]/40"
        />
        <p className="text-[11px] text-white/45 mt-1">
          Required cookies: sessionid, ds_user_id, csrftoken. Tip: install the Cookie-Editor browser extension, log into instagram.com, then click Export &rarr; JSON.
        </p>

        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={save}
            disabled={busy || !paste.trim()}
            className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-black text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Save className="w-4 h-4" /> Save
          </button>
          <button
            onClick={test}
            disabled={busy || !meta?.present || meta?.status === "missing"}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Zap className="w-4 h-4" /> Test session
          </button>
          <button
            onClick={clear}
            disabled={busy || !meta?.present}
            className="flex items-center gap-2 bg-white/5 hover:bg-red-500/10 text-white/65 hover:text-red-300 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>

        {msg && msg.kind === "quota" && (
          <div
            className="mt-3 rounded-lg px-3 py-2 border bg-amber-500/10 border-amber-500/30"
            title="Your Apify account hit its monthly hard limit. The cookies are still valid - top up Apify or wait for the cycle to reset."
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-amber-500/20 text-amber-200 border-amber-500/40">
                {msg.text}
              </span>
              <span className="text-[11px] text-amber-200/80">Cookies are still healthy.</span>
            </div>
            <p className="text-[11px] text-amber-200/70 mt-1.5 leading-relaxed">
              Your Apify account hit its monthly hard limit. The cookies are still valid - top up Apify or wait for the cycle to reset.
            </p>
          </div>
        )}

        {msg && msg.kind !== "quota" && (
          <div className={`mt-3 text-[12px] rounded-lg px-3 py-2 border ${
            msg.kind === "ok"
              ? "bg-green-500/10 text-green-300 border-green-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}>
            {msg.text}
          </div>
        )}

        {testResult && (
          <pre className="mt-3 bg-[#0a0a0a] border border-white/[0.08] rounded-lg p-3 text-[11px] text-white/65 overflow-x-auto">
{JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

interface FbJarMetadata {
  id: number;
  platform: "fb";
  uploadedBy: string | null;
  uploadedAt: string;
  lastValidatedAt: string | null;
  status: string;
  notes: string | null;
  ageHours: number;
  cookieCount: number | null;
  inferredExpiresAt: string | null;
  cUserPreview: string | null;
  hasRequiredCookies: boolean;
  missingRequired: string[];
}

interface FbHealthRecord {
  platform: "fb";
  status: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastErrorClass: string | null;
  lastProbeAt: string | null;
  probeUrl: string | null;
}

const FB_REQUIRED_COOKIES = ["c_user", "xs", "datr"];

export function FacebookCookiesPanel() {
  const fetchWithAuth = useAdminFetch();
  const [jar, setJar] = useState<FbJarMetadata | null>(null);
  const [, setHealth] = useState<FbHealthRecord | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "quota"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const [configured, setConfigured] = useState<boolean>(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/portal/admin/fb-cookies");
      const data = await res.json();
      setJar(data.jar ?? null);
      setHealth(data.health ?? null);
      setConfigured(data.configured !== false);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Failed to load" });
    }
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!paste.trim()) return;
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/portal/admin/fb-cookies`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ cookiesText: paste }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error || `HTTP ${res.status}` });
      } else {
        setJar(data.jar ?? null);
        setPaste("");
        setMsg({ kind: "ok", text: `Saved jar with ${data.rows ?? 0} cookie rows.` });
        load();
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Save failed" });
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!confirm("Delete the saved Facebook cookies.txt jar?")) return;
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      await fetchWithAuth("/portal/admin/fb-cookies", { method: "DELETE" });
      setJar(null);
      setMsg({ kind: "ok", text: "FB cookies jar deleted." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Delete failed" });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg(null); setTestResult(null);
    try {
      const res = await fetchWithAuth("/portal/admin/fb-cookies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setTestResult(data.result);
      if (data.ok && data.result?.ok) {
        const sample = data.result?.sample;
        const detail = sample?.pageName
          ? ` (${sample.pageName}${typeof sample.followers === "number" ? `, ${sample.followers.toLocaleString()} followers` : ""})`
          : "";
        setMsg({ kind: "ok", text: `Probe ok${detail}.` });
      } else if (data.result?.status === "quota-exceeded") {
        setMsg({ kind: "quota", text: "APIFY QUOTA EXCEEDED" });
      } else {
        const detail = data.result?.error || data.result?.status || data.error || "unknown";
        setMsg({ kind: "err", text: `Probe failed: ${detail}` });
      }
      load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Test failed" });
    } finally { setBusy(false); }
  };

  const statusColor = jar?.status === "active"
    ? "bg-green-500/10 text-green-300 border-green-500/30"
    : jar?.status === "expired" || jar?.status === "degraded"
      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : "bg-white/5 text-white/65 border-white/10";

  return (
    <div className="space-y-4">
      <div className="bg-[#111] border border-white/[0.06] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              FACEBOOK SESSION COOKIES
            </h3>
            <p className="text-[12px] text-white/55 mt-1">
              Paste a Cookie-Editor / EditThisCookie JSON export from a logged-in Facebook session. Stored encrypted and injected into every Apify Facebook actor call.
            </p>
          </div>
          <span className={`text-[11px] uppercase tracking-wider px-2.5 py-1 rounded border ${statusColor}`}>
            {jar?.status || "missing"}
          </span>
        </div>

        {!configured && (
          <div className="text-[12px] rounded-lg px-3 py-2 mb-3 bg-amber-500/10 text-amber-300 border border-amber-500/30">
            FACEBOOK_COOKIES_SECRET env var is not set. Set it before saving cookies.
          </div>
        )}

        {jar && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-[12px] text-white/65">
            <div><span className="text-white/45">Saved:</span> {jar.uploadedAt ? new Date(jar.uploadedAt).toLocaleString() : "-"}</div>
            <div><span className="text-white/45">By:</span> {jar.uploadedBy || "-"}</div>
            <div><span className="text-white/45">Cookie count:</span> {jar.cookieCount ?? "-"}</div>
            <div><span className="text-white/45">sessionid:</span> <code>{jar.cUserPreview || "-"}</code></div>
            <div><span className="text-white/45">Inferred expiry:</span> {jar.inferredExpiresAt ? new Date(jar.inferredExpiresAt).toLocaleDateString() : "-"}</div>
            <div><span className="text-white/45">Required cookies present:</span> {jar.hasRequiredCookies ? "yes" : `missing ${(jar.missingRequired || []).join(", ")}`}</div>
          </div>
        )}

        <label className="text-[12px] text-white/65 uppercase tracking-wider block mb-1">
          Paste cookies.txt or JSON
        </label>
        <textarea
          value={paste}
          onChange={e => setPaste(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"# Netscape HTTP Cookie File  ...OR...  [{\"name\":\"c_user\",\"value\":\"…\",\"domain\":\".facebook.com\",\"path\":\"/\", …}, …]"}
          className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/70 font-mono leading-relaxed resize-y focus:outline-none focus:border-[#C9A44C]/40"
        />
        <p className="text-[11px] text-white/45 mt-1">
          Required cookies: {FB_REQUIRED_COOKIES.join(", ")}. Tip: install the Cookie-Editor browser extension, log into facebook.com, then click Export &rarr; either Netscape (cookies.txt) or JSON. Both formats are accepted.
        </p>

        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={save}
            disabled={busy || !paste.trim() || !configured}
            className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-black text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Save className="w-4 h-4" /> Save
          </button>
          <button
            onClick={test}
            disabled={busy || !jar}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Zap className="w-4 h-4" /> Test session
          </button>
          <button
            onClick={clear}
            disabled={busy || !jar}
            className="flex items-center gap-2 bg-white/5 hover:bg-red-500/10 text-white/65 hover:text-red-300 text-[12px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>

        {msg && msg.kind === "quota" && (
          <div
            className="mt-3 rounded-lg px-3 py-2 border bg-amber-500/10 border-amber-500/30"
            title="Your Apify account hit its monthly hard limit. The cookies are still valid - top up Apify or wait for the cycle to reset."
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-amber-500/20 text-amber-200 border-amber-500/40">
                {msg.text}
              </span>
              <span className="text-[11px] text-amber-200/80">Cookies are still healthy.</span>
            </div>
            <p className="text-[11px] text-amber-200/70 mt-1.5 leading-relaxed">
              Your Apify account hit its monthly hard limit. The cookies are still valid - top up Apify or wait for the cycle to reset.
            </p>
          </div>
        )}

        {msg && msg.kind !== "quota" && (
          <div className={`mt-3 text-[12px] rounded-lg px-3 py-2 border ${
            msg.kind === "ok"
              ? "bg-green-500/10 text-green-300 border-green-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}>
            {msg.text}
          </div>
        )}

        {testResult && (
          <pre className="mt-3 bg-[#0a0a0a] border border-white/[0.08] rounded-lg p-3 text-[11px] text-white/65 overflow-x-auto">
{JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function AdminCookiesSettings() {
  const [tab, setTab] = useState<"ig" | "fb">("ig");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-[#111] rounded-xl p-1 border border-white/[0.06] w-fit">
        {(["ig", "fb"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[12px] font-medium uppercase tracking-wider px-5 py-2 rounded-lg transition-colors ${
              tab === t ? "bg-[#C9A44C] text-white" : "text-white/65 hover:text-white/85"
            }`}
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {t === "ig" ? "IG Cookies" : "FB Cookies"}
          </button>
        ))}
      </div>
      {tab === "ig" ? <InstagramCookiesPanel /> : <FacebookCookiesPanel />}
    </div>
  );
}
