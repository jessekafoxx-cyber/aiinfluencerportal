import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, Download, X } from "lucide-react";

type LogRow = {
  id: number;
  userId: number | null;
  userEmail: string | null;
  email: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  resourcePath: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export function AdminLogs() {
  const [page, setPage] = useState(1);
  // Two-tier inputs: `*Draft` is what the user is typing, the un-suffixed
  // value is the committed filter the query actually uses. Decouples
  // keystrokes from network traffic without needing a debounce hook.
  const [emailDraft, setEmailDraft] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [email, setEmail] = useState("");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = { email: email || undefined, q: q || undefined };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["admin-logs", page, email, q],
    queryFn: () => api.admin.getLogs(page, 50, filters),
  });

  const logs: LogRow[] = data?.logs || [];
  const total: number = data?.total || 0;
  const totalPages: number = data?.totalPages || Math.max(1, Math.ceil(total / 50));
  const filtersActive = !!(email || q);

  function applyFilters() {
    setEmail(emailDraft.trim());
    setQ(qDraft.trim());
    setPage(1);
  }
  function clearFilters() {
    setEmailDraft("");
    setQDraft("");
    setEmail("");
    setQ("");
    setPage(1);
  }

  async function exportPdf() {
    setExporting(true);
    try {
      // Pull up to 1000 rows in a single call so the PDF reflects the
      // current filter without re-paginating. Capped server-side too.
      const all = await api.admin.getLogs(1, 1000, filters);
      const rows: LogRow[] = all?.logs || [];
      const { jsPDF } = await import("jspdf");
      const autoTableMod = await import("jspdf-autotable");
      const autoTable = (autoTableMod as any).default || (autoTableMod as any);

      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header block - dark bar with title + filter summary for the
      // dispute reviewer.
      doc.setFillColor(10, 10, 10);
      doc.rect(0, 0, pageWidth, 64, "F");
      doc.setTextColor(201, 164, 76); // brand gold
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("AI INFLUENCER PORTFOLIO - ACCESS LOGS", 32, 28);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 32, 44);
      const filterLine = [
        email ? `email~"${email}"` : null,
        q ? `path/action~"${q}"` : null,
        !filtersActive ? "no filters - all users" : null,
      ].filter(Boolean).join("  |  ");
      doc.text(`Filter: ${filterLine}`, 32, 56);
      doc.text(`Rows in export: ${rows.length} of ${all?.total ?? rows.length}`, pageWidth - 32, 56, { align: "right" });

      autoTable(doc, {
        startY: 80,
        head: [["Time (UTC)", "User", "Action", "Path", "IP", "Resource Type"]],
        body: rows.map((r) => [
          new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19),
          r.userEmail || r.email || (r.userId ? `user#${r.userId}` : "-"),
          r.action || "-",
          (r.resourcePath || r.resourceId || "-").slice(0, 80),
          r.ipAddress || "-",
          r.resourceType || "-",
        ]),
        styles: { font: "helvetica", fontSize: 8, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [10, 10, 10], textColor: [201, 164, 76], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: {
          0: { cellWidth: 110 },
          1: { cellWidth: 150 },
          2: { cellWidth: 90 },
          3: { cellWidth: 230 },
          4: { cellWidth: 90 },
          5: { cellWidth: 70 },
        },
        margin: { left: 24, right: 24 },
      });

      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const label = email
        ? `room30-access-logs_${email.replace(/[^a-z0-9@._-]/gi, "_")}_${stamp}.pdf`
        : `room30-access-logs_${stamp}.pdf`;
      doc.save(label);
    } catch (err) {
      // Surface to console; non-blocking for the UI.
      console.error("[admin-logs] PDF export failed", err);
      alert("PDF export failed. Check the console for details.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Admin Panel
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Access Logs
          </h1>
          <p className="text-[13px] text-white/65 mt-2">
            {total.toLocaleString()} {filtersActive ? "matching" : "total"} log entries - IP tracking for dispute defense
          </p>
        </div>

        {/* Search + export toolbar */}
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-[11px] text-white/55 uppercase tracking-wider font-bold mb-1.5">
              Search by user email
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
                placeholder="e.g. shanegray784@gmail.com"
                className="w-full pl-9 pr-3 py-2 bg-[#1a1a1a] border border-white/[0.08] rounded-md text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/50"
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-white/55 uppercase tracking-wider font-bold mb-1.5">
              Search by path or action
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
                placeholder="e.g. upsell-3, lesson_view, login"
                className="w-full pl-9 pr-3 py-2 bg-[#1a1a1a] border border-white/[0.08] rounded-md text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/50"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyFilters}
              className="px-4 py-2 bg-[#C9A44C] hover:bg-[#d4b05a] text-black text-[12px] font-bold uppercase tracking-wider rounded-md transition-colors"
            >
              Search
            </button>
            {filtersActive && (
              <button
                onClick={clearFilters}
                title="Clear filters"
                className="px-3 py-2 border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white text-[12px] rounded-md transition-colors flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
            <button
              onClick={exportPdf}
              disabled={exporting || total === 0}
              title={total === 0 ? "No rows to export" : "Download current filter as PDF (up to 1000 rows)"}
              className="px-4 py-2 bg-[#1a1a1a] border border-[#C9A44C]/40 hover:border-[#C9A44C] text-[#C9A44C] text-[12px] font-bold uppercase tracking-wider rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? "Exporting..." : "Export PDF"}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="bg-[#0f0f0f] border border-red-500/30 rounded-xl p-8 text-center">
            <p className="text-[13px] text-red-400 font-bold mb-2">Failed to load access logs.</p>
            <p className="text-[12px] text-white/55 mb-4">
              {(error as any)?.message || "The server returned an error. Try again, or narrow the filter if you searched for a very common term."}
            </p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-[#1a1a1a] border border-white/[0.12] hover:border-white/30 text-[12px] text-white/80 uppercase tracking-wider rounded-md transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden mb-6 relative">
              {isFetching && (
                <div className="absolute top-2 right-3 text-[10px] text-white/40 uppercase tracking-wider">Loading...</div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">Time</th>
                      <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">User</th>
                      <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">Action</th>
                      <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">IP Address</th>
                      <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">Path</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-[13px] text-white/45">
                          No log entries match the current filter.
                        </td>
                      </tr>
                    ) : logs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.02]">
                        <td className="px-6 py-3 text-[12px] text-white/60 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-[12px] text-white/60">
                          {log.userEmail || log.email || (log.userId ? `user#${log.userId}` : "-")}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              log.action === "lesson_view"
                                ? "bg-blue-500/15 text-blue-400"
                                : log.action === "login"
                                  ? "bg-green-500/15 text-green-400"
                                  : "bg-white/[0.06] text-white/50"
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-[12px] text-white/65 font-mono">
                          {log.ipAddress || "-"}
                        </td>
                        <td className="px-6 py-3 text-[12px] text-white/65 font-mono max-w-[300px] truncate">
                          {log.resourcePath || log.resourceId || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-2 text-[12px] text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-[12px] text-white/55">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-2 text-[12px] text-white/50 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
