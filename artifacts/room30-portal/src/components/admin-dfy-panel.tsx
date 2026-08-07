import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Crown,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Calendar,
  ListChecks,
  Phone,
  Folder,
} from "lucide-react";

type Props = {
  userId: number;
  userName: string;
};

const ASSET_STATUSES = ["in-progress", "ready", "needs-review"] as const;
const ASSET_TYPES = ["link", "file", "doc"] as const;
const MILESTONE_STATUSES = ["pending", "in-progress", "completed"] as const;

function fmtMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function StripeRevenue({ userId }: { userId: number }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dfy-revenue", userId],
    queryFn: () => api.alist.adminRevenue(userId),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-white/55">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Stripe revenue…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-[12px] text-red-400 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        {(error as any)?.message || "Failed to load revenue"}
      </div>
    );
  }
  if (data && data.connected === false) {
    return (
      <div className="text-[12px] text-white/55 flex items-center gap-2">
        <CreditCard className="w-3.5 h-3.5" />
        This client hasn't connected Stripe yet.
      </div>
    );
  }
  if (data?.authFailed) {
    return (
      <div className="text-[12px] text-red-400 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        Stripe rejected the saved key — ask the client to reconnect.
      </div>
    );
  }
  const w = data?.windows;
  if (!w) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-white/55">
          Stripe revenue {data.accountLabel ? `· ${data.accountLabel}` : ""}{" "}
          <span className="font-mono text-yellow-400/70">{data.maskedKey}</span>
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[10px] uppercase tracking-wider text-white/55 hover:text-yellow-400 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "7 day", val: w.last7Days },
          { label: "30 day", val: w.last30Days },
          { label: "90 day", val: w.last90Days },
        ].map((win) => (
          <div
            key={win.label}
            className="rounded-lg p-3 border border-yellow-500/15"
            style={{
              background: "linear-gradient(135deg, rgba(255,215,0,0.06), rgba(255,165,0,0.02))",
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-400/80">{win.label}</p>
            <p className="text-[18px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {fmtMoney(win.val.totalCents)}
            </p>
            <p className="text-[10px] text-white/45">{win.val.charges} charges</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildAssetsManager({ userId }: { userId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dfy-build-assets", userId],
    queryFn: () => api.alist.listAdminBuildAssets(userId),
  });

  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dfy-build-assets", userId] });
    qc.invalidateQueries({ queryKey: ["a-list-dashboard"] });
  };
  const createMut = useMutation({
    mutationFn: (payload: any) => api.alist.createBuildAsset({ ...payload, userId }),
    onSuccess: () => { invalidate(); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...payload }: any) => api.alist.updateBuildAsset(id, payload),
    onSuccess: () => { invalidate(); setEditing(null); setShowForm(false); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.alist.deleteBuildAsset(id),
    onSuccess: invalidate,
  });

  const assets = data?.buildAssets || [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-white/55 flex items-center gap-1.5">
          <Folder className="w-3 h-3" /> Build assets ({assets.length})
        </p>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80 hover:text-yellow-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {isLoading ? (
        <div className="text-[11px] text-white/45">Loading…</div>
      ) : assets.length === 0 && !showForm ? (
        <p className="text-[11px] text-white/40 italic">None yet.</p>
      ) : (
        <div className="space-y-1.5">
          {assets.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <span className="text-[10px] uppercase tracking-wider text-yellow-400/70 bg-yellow-500/10 px-1.5 py-0.5 rounded shrink-0">
                {a.category}
              </span>
              <span className="text-[12px] text-white truncate flex-1">{a.title}</span>
              <span className="text-[10px] uppercase text-white/45">{a.status}</span>
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-white/45 hover:text-yellow-400">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button onClick={() => { setEditing(a); setShowForm(true); }} className="text-white/45 hover:text-yellow-400">
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete asset "${a.title}"?`)) deleteMut.mutate(a.id); }}
                className="text-white/45 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <BuildAssetForm
          initial={editing}
          submitting={createMut.isPending || updateMut.isPending}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(payload) => {
            if (editing) updateMut.mutate({ id: editing.id, ...payload });
            else createMut.mutate(payload);
          }}
        />
      )}
    </div>
  );
}

function BuildAssetForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: any | null;
  submitting: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [category, setCategory] = useState(initial?.category || "general");
  const [assetType, setAssetType] = useState(initial?.assetType || "link");
  const [url, setUrl] = useState(initial?.url || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [status, setStatus] = useState(initial?.status || "ready");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-white/[0.02] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. VSL v1)"
          className="px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (funnel, ads, vsl…)"
          className="px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40" />
      </div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://... (optional)"
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-yellow-500/40" />
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[10px] uppercase tracking-wider text-white/55">Type</label>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)}
          className="px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white">
          {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="text-[10px] uppercase tracking-wider text-white/55">Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white">
          {ASSET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1 text-[11px] text-white/65 hover:text-white">Cancel</button>
        <button
          onClick={() => {
            setError(null);
            if (!title.trim()) return setError("Title required");
            onSubmit({
              title: title.trim(),
              category: category.trim() || "general",
              assetType,
              url: url.trim() || null,
              notes: notes.trim() || null,
              status,
            });
          }}
          disabled={submitting}
          className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded text-black"
          style={{ background: "linear-gradient(135deg, #FFD700, #FFA500)", opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function MilestonesManager({ userId }: { userId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["dfy-roadmap", userId],
    queryFn: () => api.alist.listAdminRoadmap(userId),
  });
  const roadmap = data?.roadmap || [];

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dfy-roadmap", userId] });
    qc.invalidateQueries({ queryKey: ["a-list-dashboard"] });
  };
  const createMut = useMutation({
    mutationFn: (payload: any) => api.alist.createRoadmap({ ...payload, userId }),
    onSuccess: () => { invalidate(); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...payload }: any) => api.alist.updateRoadmap(id, payload),
    onSuccess: () => { invalidate(); setEditing(null); setShowForm(false); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.alist.deleteRoadmap(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-white/55 flex items-center gap-1.5">
          <ListChecks className="w-3 h-3" /> Milestones ({roadmap.length})
        </p>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80 hover:text-yellow-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {roadmap.length === 0 && !showForm ? (
        <p className="text-[11px] text-white/40 italic">None yet.</p>
      ) : (
        <div className="space-y-1.5">
          {roadmap.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <select
                value={m.status}
                onChange={(e) => updateMut.mutate({ id: m.id, status: e.target.value })}
                className="text-[10px] uppercase tracking-wider bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 text-white"
              >
                {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-[12px] text-white truncate flex-1">{m.milestone}</span>
              {m.targetDate && (
                <span className="text-[10px] text-white/45">{new Date(m.targetDate).toLocaleDateString()}</span>
              )}
              <button onClick={() => { setEditing(m); setShowForm(true); }} className="text-white/45 hover:text-yellow-400">
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete milestone "${m.milestone}"?`)) deleteMut.mutate(m.id); }}
                className="text-white/45 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <MilestoneForm
          initial={editing}
          submitting={createMut.isPending || updateMut.isPending}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(payload) => {
            if (editing) updateMut.mutate({ id: editing.id, ...payload });
            else createMut.mutate(payload);
          }}
        />
      )}
    </div>
  );
}

function MilestoneForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: any | null;
  submitting: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [milestone, setMilestone] = useState(initial?.milestone || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [targetDate, setTargetDate] = useState(
    initial?.targetDate ? new Date(initial.targetDate).toISOString().slice(0, 10) : ""
  );
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-white/[0.02] p-3 space-y-2">
      <input value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="Milestone (e.g. War Map call complete)"
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30" />
      <textarea
        value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
        placeholder="Description (optional). Tip: include 'War Map' for Phase 1 or 'launch' for Phase 3 to auto-classify."
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30" />
      <div className="flex items-center gap-3">
        <label className="text-[10px] uppercase tracking-wider text-white/55">Target</label>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
          className="px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white" />
        <label className="text-[10px] uppercase tracking-wider text-white/55">Order</label>
        <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))}
          className="w-16 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white" />
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1 text-[11px] text-white/65 hover:text-white">Cancel</button>
        <button
          onClick={() => {
            setError(null);
            if (!milestone.trim()) return setError("Milestone required");
            onSubmit({
              milestone: milestone.trim(),
              description: description.trim() || null,
              targetDate: targetDate || null,
              sortOrder,
            });
          }}
          disabled={submitting}
          className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded text-black"
          style={{ background: "linear-gradient(135deg, #FFD700, #FFA500)", opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function CallsManager({ userId }: { userId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["dfy-calls", userId],
    queryFn: () => api.alist.listAdminCalls(userId),
  });
  const calls = data?.calls || [];

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dfy-calls", userId] });
    qc.invalidateQueries({ queryKey: ["a-list-dashboard"] });
  };
  const createMut = useMutation({
    mutationFn: (payload: any) => api.alist.createCall({ ...payload, userId }),
    onSuccess: () => { invalidate(); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...payload }: any) => api.alist.updateCall(id, payload),
    onSuccess: () => { invalidate(); setEditing(null); setShowForm(false); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.alist.deleteCall(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-white/55 flex items-center gap-1.5">
          <Phone className="w-3 h-3" /> 1-on-1 calls ({calls.length})
        </p>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80 hover:text-yellow-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {calls.length === 0 && !showForm ? (
        <p className="text-[11px] text-white/40 italic">None yet.</p>
      ) : (
        <div className="space-y-1.5">
          {calls.map((c: any) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <Calendar className="w-3 h-3 text-yellow-400/70 shrink-0" />
              <span className="text-[10px] text-white/55 shrink-0">{new Date(c.callDate).toLocaleDateString()}</span>
              <span className="text-[12px] text-white truncate flex-1">{c.title}</span>
              {c.recordingUrl && (
                <a href={c.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-yellow-400/70 hover:text-yellow-400">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button onClick={() => { setEditing(c); setShowForm(true); }} className="text-white/45 hover:text-yellow-400">
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => { if (confirm(`Delete call "${c.title}"?`)) deleteMut.mutate(c.id); }}
                className="text-white/45 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <CallForm
          initial={editing}
          submitting={createMut.isPending || updateMut.isPending}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(payload) => {
            if (editing) updateMut.mutate({ id: editing.id, ...payload });
            else createMut.mutate(payload);
          }}
        />
      )}
    </div>
  );
}

function CallForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: any | null;
  submitting: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const defaultDate = useMemo(
    () => (initial?.callDate ? new Date(initial.callDate) : new Date()),
    [initial]
  );
  const toLocalInput = (d: Date) => {
    const tz = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tz * 60000);
    return local.toISOString().slice(0, 16);
  };

  const [title, setTitle] = useState(initial?.title || "");
  const [callDate, setCallDate] = useState(toLocalInput(defaultDate));
  const [duration, setDuration] = useState<number | "">(initial?.duration || "");
  const [callType, setCallType] = useState(initial?.callType || "one-on-one");
  const [recordingUrl, setRecordingUrl] = useState(initial?.recordingUrl || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-white/[0.02] p-3 space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call title (e.g. War Map session)"
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30" />
      <div className="grid grid-cols-3 gap-2">
        <input type="datetime-local" value={callDate} onChange={(e) => setCallDate(e.target.value)}
          className="px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white" />
        <input type="number" value={duration}
          onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder="Duration (min)"
          className="px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white placeholder:text-white/30" />
        <select value={callType} onChange={(e) => setCallType(e.target.value)}
          className="px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[11px] text-white">
          {["war-map", "one-on-one", "build-review", "launch", "support"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <input value={recordingUrl} onChange={(e) => setRecordingUrl(e.target.value)} placeholder="Recording URL (optional)"
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
        className="w-full px-2 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded text-[12px] text-white placeholder:text-white/30" />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1 text-[11px] text-white/65 hover:text-white">Cancel</button>
        <button
          onClick={() => {
            setError(null);
            if (!title.trim()) return setError("Title required");
            if (!callDate) return setError("Date required");
            onSubmit({
              title: title.trim(),
              callDate: new Date(callDate).toISOString(),
              duration: duration === "" ? null : Number(duration),
              callType,
              recordingUrl: recordingUrl.trim() || null,
              notes: notes.trim() || null,
            });
          }}
          disabled={submitting}
          className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded text-black"
          style={{ background: "linear-gradient(135deg, #FFD700, #FFA500)", opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function AdminDfyPanel({ userId, userName }: Props) {
  return (
    <div
      className="mt-4 rounded-xl p-[1px]"
      style={{
        background: "linear-gradient(180deg, rgba(201,164,76,0.45) 0%, rgba(201,164,76,0.1) 100%)",
      }}
    >
      <div className="rounded-xl bg-[#0F0F0F] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-yellow-400" />
          <h4
            className="text-[13px] font-bold uppercase tracking-wider text-yellow-400"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Done-For-You manager — {userName}
          </h4>
        </div>

        <StripeRevenue userId={userId} />

        <div className="border-t border-white/[0.05] pt-3">
          <BuildAssetsManager userId={userId} />
        </div>

        <div className="border-t border-white/[0.05] pt-3">
          <MilestonesManager userId={userId} />
        </div>

        <div className="border-t border-white/[0.05] pt-3">
          <CallsManager userId={userId} />
        </div>

      </div>
    </div>
  );
}
