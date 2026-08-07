import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RotateCcw, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { fetchAuthed } from "@/lib/api";
import { safeJson } from "../lib/safe-json";

const GOLD = "#C9A44C";

interface HistoryListItem {
  id: number;
  toolSlug: string;
  label: string | null;
  createdAt: string;
}

interface HistoryFullItem<I = unknown, O = unknown> {
  id: number;
  toolSlug: string;
  label: string | null;
  createdAt: string;
  input: I;
  output: O;
}

interface ToolHistoryProps<I = unknown, O = unknown> {
  toolSlug: string;
  /**
   * Bump this counter (or pass a number that increases) after each successful
   * generation in the parent page so the history reloads automatically.
   */
  refreshKey?: number;
  /**
   * Called when the user clicks "Restore" on a row. The parent should
   * repopulate its form / result state from `input` and `output`.
   */
  onRestore?: (item: HistoryFullItem<I, O>) => void;
  /**
   * Optional override for the empty-state copy.
   */
  emptyMessage?: string;
  /**
   * Optional default-open. Defaults to false (collapsed until clicked).
   */
  defaultOpen?: boolean;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diffMs < min) return "just now";
  if (diffMs < hr) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hr)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toLocaleDateString();
}

/**
 * Generic per-tool history panel. Backed by /portal/tool-generations.
 * Pages drop this in below their main UI so users can browse, restore, and
 * delete previous AI generations.
 */
export function ToolHistory<I = unknown, O = unknown>({
  toolSlug,
  refreshKey = 0,
  onRestore,
  emptyMessage = "No previous generations yet.",
  defaultOpen = false,
}: ToolHistoryProps<I, O>) {
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<HistoryListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuthed(
        `/tool-generations?tool=${encodeURIComponent(toolSlug)}&limit=25`,
      );
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message || "Could not load history");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toolSlug]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load, refreshKey]);

  // When refreshKey changes while open, reload silently. The effect above
  // already covers it; this is just to make the dependency intent explicit.

  const handleRestore = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetchAuthed(`/tool-generations/${id}`);
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
        if (data?.item && onRestore) {
          onRestore(data.item as HistoryFullItem<I, O>);
        }
      } catch (e: any) {
        setError(e?.message || "Could not restore");
      } finally {
        setBusyId(null);
      }
    },
    [onRestore],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this generation from your history? This cannot be undone.")) return;
      setBusyId(id);
      try {
        const res = await fetchAuthed(`/tool-generations/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await safeJson(res);
          throw new Error(data?.error || `Failed (${res.status})`);
        }
        setItems((prev) => (prev ? prev.filter((row) => row.id !== id) : prev));
      } catch (e: any) {
        setError(e?.message || "Could not delete");
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return (
    <div className="mt-8 bg-[#0a0a0a] border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <History size={16} style={{ color: GOLD }} />
          <span
            className="text-[12px] font-bold uppercase tracking-[0.14em]"
            style={{ color: GOLD, fontFamily: "var(--app-font-display)" }}
          >
            History
          </span>
          {items && items.length > 0 && (
            <span className="text-[11px] text-white/40">({items.length})</span>
          )}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-white/40" />
        ) : (
          <ChevronDown size={16} className="text-white/40" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-white/50">
              <Loader2 size={14} className="animate-spin" />
              Loading...
            </div>
          )}
          {error && !loading && (
            <div className="text-[12px] text-red-400 mb-3">{error}</div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="text-[12px] text-white/40">{emptyMessage}</div>
          )}
          {!loading && items && items.length > 0 && (
            <ul className="divide-y divide-white/[0.05]">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-white truncate">
                      {row.label || "Untitled generation"}
                    </div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {formatWhen(row.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onRestore && (
                      <button
                        type="button"
                        onClick={() => handleRestore(row.id)}
                        disabled={busyId === row.id}
                        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] px-2.5 py-1.5 rounded border border-white/10 hover:border-[#C9A44C]/40 hover:text-white text-white/70 transition-colors disabled:opacity-50"
                        title="Load this generation back into the form"
                      >
                        {busyId === row.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      disabled={busyId === row.id}
                      className="p-1.5 rounded border border-white/10 hover:border-red-500/40 text-white/50 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Delete from history"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
