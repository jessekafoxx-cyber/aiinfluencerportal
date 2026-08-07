import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Download,
  Eye,
  Image as ImageIcon,
  RefreshCw,
} from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { fetchApi, api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

type AdvertorialPage = {
  id: number;
  title: string;
  description: string | null;
  templateNumber: number | null;
  previewUrl: string;
  installUrl: string | null;
  previewImageUrl: string | null;
  sortOrder: number;
  source: "manual" | "sheet" | string;
};

export default function DfyAdvertorialPages() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = me?.user?.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["dfy-advertorial-pages"],
    queryFn: () =>
      fetchApi("/dfy/advertorial-pages") as Promise<{
        pages: AdvertorialPage[];
      }>,
  });
  const pages = data?.pages || [];

  const [editing, setEditing] = useState<AdvertorialPage | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const save = useMutation({
    mutationFn: (body: {
      id?: number;
      title: string;
      description: string;
      previewUrl: string;
      installUrl: string;
      previewImageUrl: string;
      templateNumber: number | null;
    }) =>
      fetchApi(`/dfy/advertorial-pages${body.id ? `/${body.id}` : ""}`, {
        method: body.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: body.title,
          description: body.description,
          previewUrl: body.previewUrl,
          installUrl: body.installUrl,
          previewImageUrl: body.previewImageUrl,
          templateNumber: body.templateNumber,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-advertorial-pages"] });
      setEditing(null);
      setShowAdd(false);
      toast({ title: "Saved" });
    },
    onError: (e: any) =>
      toast({
        title: "Save failed",
        description: e?.message || "",
        variant: "destructive",
      }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/dfy/advertorial-pages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-advertorial-pages"] });
      toast({ title: "Deleted" });
    },
  });

  const syncFromSheet = useMutation({
    mutationFn: () =>
      fetchApi("/dfy/advertorial-pages/sync-from-sheet", {
        method: "POST",
      }) as Promise<{
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        totalRows: number;
      }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dfy-advertorial-pages"] });
      toast({
        title: "Synced from sheet",
        description: `Added ${r.inserted}, updated ${r.updated}, unchanged ${r.skipped} (of ${r.totalRows})`,
      });
    },
    onError: (e: any) =>
      toast({
        title: "Sync failed",
        description: e?.message || "",
        variant: "destructive",
      }),
  });

  return (
    <DfySubPageShell
      title="20 Advertorial Page Templates"
      description="One-click import templates for Go High Level. Preview any template, then use the install link to import it straight into your GHL account and swap in your own copy, links and images."
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-bold uppercase tracking-[0.14em] text-white/85">
          Go High Level Import Templates
        </h3>
        {isAdmin && !showAdd && !editing && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => syncFromSheet.mutate()}
              disabled={syncFromSheet.isPending}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55 hover:text-white disabled:opacity-50"
            >
              {syncFromSheet.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Sync from sheet
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] hover:text-[#dfb960]"
            >
              <Plus className="w-3.5 h-3.5" />
              Add template
            </button>
          </div>
        )}
      </div>

      {(showAdd || editing) && isAdmin && (
        <AdvertorialForm
          initial={editing}
          onCancel={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSave={(body) => save.mutate({ ...body, id: editing?.id })}
          busy={save.isPending}
        />
      )}

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : pages.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <ImageIcon className="w-8 h-8 text-white/25 mx-auto mb-3" />
          <p className="text-[14px] text-white/65 font-semibold mb-1">
            No Go High Level import templates yet
          </p>
          <p className="text-[12.5px] text-white/45">
            Add one using the button above, or click Sync from sheet to import
            them from the Google Sheet.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {pages.map((p) => (
            <TemplateCard
              key={p.id}
              page={p}
              isAdmin={isAdmin}
              onEdit={() => setEditing(p)}
              onDelete={() => {
                if (confirm(`Delete "${p.title}"?`)) remove.mutate(p.id);
              }}
            />
          ))}
        </div>
      )}
    </DfySubPageShell>
  );
}

function TemplateCard({
  page,
  isAdmin,
  onEdit,
  onDelete,
}: {
  page: AdvertorialPage;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.14] transition-colors flex flex-col">
      <div className="relative bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] p-4 pb-2">
        <div className="rounded-t-md overflow-hidden border border-white/[0.06] bg-[#0a0a0a]">
          <div className="bg-[#161616] px-2.5 py-1.5 flex items-center gap-1.5 border-b border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
          </div>
          <div className="aspect-[16/10] bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
            {page.previewImageUrl ? (
              <img
                src={page.previewImageUrl}
                alt={page.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="w-8 h-8 text-white/15" />
            )}
          </div>
        </div>
        <div
          className="h-1.5 mx-auto bg-white/10 rounded-b-md"
          style={{ width: "70%" }}
        />
      </div>

      <div className="p-5 flex-1 flex flex-col">
        {page.templateNumber != null && (
          <span className="inline-flex w-fit items-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] border border-[#C9A44C]/35 bg-[#C9A44C]/[0.08] px-2 py-0.5 rounded mb-2">
            Template #{String(page.templateNumber).padStart(2, "0")}
          </span>
        )}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="text-[15px] font-bold text-white leading-[1.25] flex-1">
            {page.title}
          </h4>
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onEdit}
                className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06]"
                aria-label="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded text-white/45 hover:text-red-300 hover:bg-white/[0.06]"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {page.description && (
          <p className="text-[12.5px] text-white/55 leading-[1.6] mb-4">
            {page.description}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2">
          <a
            href={page.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] text-white text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg border border-white/[0.08]"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </a>
          {page.installUrl ? (
            <a
              href={page.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#C9A44C] hover:bg-[#dfb960] text-black text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Install Template
            </a>
          ) : (
            <span className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.03] text-white/30 text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg border border-white/[0.06] cursor-not-allowed">
              <Download className="w-3.5 h-3.5" />
              No install link
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AdvertorialForm({
  initial,
  onCancel,
  onSave,
  busy,
}: {
  initial: AdvertorialPage | null;
  onCancel: () => void;
  onSave: (body: {
    title: string;
    description: string;
    previewUrl: string;
    installUrl: string;
    previewImageUrl: string;
    templateNumber: number | null;
  }) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [previewUrl, setPreviewUrl] = useState(initial?.previewUrl || "");
  const [installUrl, setInstallUrl] = useState(initial?.installUrl || "");
  const [previewImageUrl, setPreviewImageUrl] = useState(
    initial?.previewImageUrl || "",
  );
  const [templateNumber, setTemplateNumber] = useState<string>(
    initial?.templateNumber != null ? String(initial.templateNumber) : "",
  );
  return (
    <div className="bg-[#161616] border border-[#C9A44C]/25 rounded-2xl p-5 mb-5 space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Template title"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={previewImageUrl}
        onChange={(e) => setPreviewImageUrl(e.target.value)}
        placeholder="Preview image URL (shown inside laptop mockup)"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={templateNumber}
        onChange={(e) =>
          setTemplateNumber(e.target.value.replace(/[^0-9]/g, ""))
        }
        placeholder="Template number (optional, e.g. 7)"
        inputMode="numeric"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={previewUrl}
        onChange={(e) => setPreviewUrl(e.target.value)}
        placeholder="Preview URL (live page) - https://..."
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={installUrl}
        onChange={(e) => setInstallUrl(e.target.value)}
        placeholder="Install URL (one-click GHL import link)"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Short description (optional)"
        rows={2}
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            onSave({
              title: title.trim(),
              description: description.trim(),
              previewUrl: previewUrl.trim(),
              installUrl: installUrl.trim(),
              previewImageUrl: previewImageUrl.trim(),
              templateNumber: templateNumber.trim()
                ? Number(templateNumber)
                : null,
            })
          }
          disabled={busy || !title.trim() || !previewUrl.trim()}
          className="bg-[#C9A44C] text-black text-[11px] font-bold uppercase tracking-[0.14em] px-4 py-2 rounded hover:bg-[#dfb960] disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save template"}
        </button>
        <button
          onClick={onCancel}
          className="text-white/55 text-[11px] font-bold uppercase tracking-[0.14em] px-3 py-2 rounded hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
