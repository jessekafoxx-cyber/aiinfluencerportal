import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ExternalLink, Loader2, Plus, Trash2, Pencil, Download, Eye, Image as ImageIcon, RefreshCw, Upload } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { fetchApi, api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

type BridgePage = {
  id: number;
  title: string;
  description: string | null;
  url: string;
  previewImageUrl: string | null;
  downloadUrl: string | null;
  sortOrder: number;
  bonusNumber: number | null;
  source: "manual" | "sheet" | string;
};

const GHL_LINK = "https://www.gohighlevel.com/?fp_ref=gcooke";

export default function DfyBridgePages() {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = me?.user?.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["dfy-bridge-pages"],
    queryFn: () =>
      fetchApi("/dfy/bridge-pages") as Promise<{ pages: BridgePage[] }>,
  });
  const pages = data?.pages || [];

  const [editing, setEditing] = useState<BridgePage | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const save = useMutation({
    mutationFn: (body: {
      id?: number; title: string; description: string; url: string;
      previewImageUrl: string; downloadUrl: string; bonusNumber: number | null;
    }) =>
      fetchApi(`/dfy/bridge-pages${body.id ? `/${body.id}` : ""}`, {
        method: body.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: body.title,
          description: body.description,
          url: body.url,
          previewImageUrl: body.previewImageUrl,
          downloadUrl: body.downloadUrl,
          bonusNumber: body.bonusNumber,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-bridge-pages"] });
      setEditing(null);
      setShowAdd(false);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message || "", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/dfy/bridge-pages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-bridge-pages"] });
      toast({ title: "Deleted" });
    },
  });

  // T402: admin-only manual trigger of the weekly sheet importer.
  const syncFromSheet = useMutation({
    mutationFn: () =>
      fetchApi("/dfy/bridge-pages/sync-from-sheet", { method: "POST" }) as Promise<{
        ok: boolean; inserted: number; updated: number; skipped: number; totalRows: number;
      }>,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dfy-bridge-pages"] });
      toast({
        title: "Synced from sheet",
        description: `Added ${r.inserted}, updated ${r.updated}, unchanged ${r.skipped} (of ${r.totalRows})`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Sync failed", description: e?.message || "", variant: "destructive" }),
  });

  return (
    <DfySubPageShell
      title="Bridge Pages"
      description="Pre-built bridge pages that pre-frame your offer. Build them on Go High Level using our affiliate link, then preview and download any of our ready-to-import templates."
    >
      {/* Go High Level banner */}
      <div className="bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] border border-[#C9A44C]/25 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6 mb-8">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Recommended Builder
          </p>
          <h3
            className="text-[22px] md:text-[26px] font-bold uppercase tracking-[0.01em] text-white leading-[1.1] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Build your bridge pages on Go High Level
          </h3>
          <p className="text-[13.5px] text-white/65 leading-[1.65]">
            You need a GoHighLevel account for this - get a 14-day free trial
            here. We build every one of our bridge pages on Go High Level -
            it's the single tool we use for landing pages, automations, email
            and SMS follow-up. Use our partner link to start your trial, then
            import any template below.
          </p>
        </div>
        <a
          href={GHL_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center justify-center gap-2 bg-[#C9A44C] text-black font-bold text-[12px] uppercase tracking-[0.14em] px-6 py-3 rounded-lg hover:bg-[#dfb960] transition-colors"
        >
          Open Go High Level
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Templates */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-bold uppercase tracking-[0.14em] text-white/85">
          Bridge Page Templates
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
        <BridgeForm
          initial={editing}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
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
          <p className="text-[14px] text-white/65 font-semibold mb-1">No bridge page templates yet</p>
          <p className="text-[12.5px] text-white/45">
            {isAdmin
              ? "Add your first template using the button above. Each template needs a title, preview image, preview URL, and a download URL."
              : "We're still loading the template library. Check back soon."}
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
              onDelete={() => { if (confirm(`Delete "${p.title}"?`)) remove.mutate(p.id); }}
            />
          ))}
        </div>
      )}
    </DfySubPageShell>
  );
}

function TemplateCard({
  page, isAdmin, onEdit, onDelete,
}: {
  page: BridgePage;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.14] transition-colors flex flex-col">
      {/* Laptop mockup frame */}
      <div className="relative bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] p-4 pb-2">
        <div className="rounded-t-md overflow-hidden border border-white/[0.06] bg-[#0a0a0a]">
          <div className="bg-[#161616] px-2.5 py-1.5 flex items-center gap-1.5 border-b border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/15" />
          </div>
          <div className="aspect-[16/10] bg-[#0a0a0a] flex items-center justify-center overflow-hidden relative">
            {page.previewImageUrl ? (
              <>
                <img
                  src={page.previewImageUrl}
                  alt={page.title}
                  className="w-full h-full object-cover"
                  // Task #742: a private / restricted / deleted Drive
                  // file responds 403/404 so swap in the placeholder
                  // icon instead of the browser's broken-image glyph.
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = "none";
                    const fb = img.nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = "flex";
                  }}
                />
                <span
                  className="absolute inset-0 hidden items-center justify-center bg-[#0a0a0a]"
                  aria-hidden="true"
                >
                  <ImageIcon className="w-8 h-8 text-white/15" />
                </span>
              </>
            ) : (
              <ImageIcon className="w-8 h-8 text-white/15" />
            )}
          </div>
        </div>
        <div className="h-1.5 mx-auto bg-white/10 rounded-b-md" style={{ width: "70%" }} />
      </div>

      <div className="p-5 flex-1 flex flex-col">
        {page.bonusNumber != null && (
          <span className="inline-flex w-fit items-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A44C] border border-[#C9A44C]/35 bg-[#C9A44C]/[0.08] px-2 py-0.5 rounded mb-2">
            Bonus #{page.bonusNumber}
          </span>
        )}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="text-[15px] font-bold text-white leading-[1.25] flex-1">{page.title}</h4>
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={onEdit} className="p-1.5 rounded text-white/45 hover:text-white hover:bg-white/[0.06]" aria-label="Edit">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDelete} className="p-1.5 rounded text-white/45 hover:text-red-300 hover:bg-white/[0.06]" aria-label="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {page.description && (
          <p className="text-[12.5px] text-white/55 leading-[1.6] mb-4">{page.description}</p>
        )}
        <div className="mt-auto flex items-center gap-2">
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.10] text-white text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg border border-white/[0.08]"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </a>
          {page.downloadUrl ? (
            <a
              href={page.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#C9A44C] hover:bg-[#dfb960] text-black text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              Download Template
            </a>
          ) : (
            <span className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white/[0.03] text-white/30 text-[11.5px] font-bold uppercase tracking-[0.14em] px-3 py-2.5 rounded-lg border border-white/[0.06] cursor-not-allowed">
              <Download className="w-3.5 h-3.5" />
              No download
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BridgeForm({
  initial, onCancel, onSave, busy,
}: {
  initial: BridgePage | null;
  onCancel: () => void;
  onSave: (body: {
    title: string; description: string; url: string;
    previewImageUrl: string; downloadUrl: string; bonusNumber: number | null;
  }) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [previewImageUrl, setPreviewImageUrl] = useState(initial?.previewImageUrl || "");
  const [downloadUrl, setDownloadUrl] = useState(initial?.downloadUrl || "");
  const [bonusNumber, setBonusNumber] = useState<string>(
    initial?.bonusNumber != null ? String(initial.bonusNumber) : "",
  );
  return (
    <div className="bg-[#161616] border border-[#C9A44C]/25 rounded-2xl p-5 mb-5 space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Template title"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <ImageUploader
        currentUrl={previewImageUrl}
        onUploaded={(url) => setPreviewImageUrl(url)}
      />
      <div>
        <input
          value={previewImageUrl}
          onChange={(e) => setPreviewImageUrl(e.target.value)}
          placeholder="Preview image URL (shown inside laptop mockup)"
          className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
        />
        {/* Task #742: nudge admins when a Drive URL is pasted - Drive
            files only render here if link sharing is public. Task #745:
            suppress once the URL is one we host ourselves. */}
        {!previewImageUrl.startsWith("/api/portal/images/") &&
          /drive\.google\.com|docs\.google\.com/i.test(previewImageUrl) && (
          <p className="mt-1.5 text-[11px] text-[#C9A44C]/80">
            Drive hotlinks are unreliable - upload the image above
            instead so the laptop mockup always renders.
          </p>
        )}
      </div>
      <input
        value={bonusNumber}
        onChange={(e) => setBonusNumber(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="Bonus number (optional, e.g. 4)"
        inputMode="numeric"
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Preview URL (live page) - https://..."
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        value={downloadUrl}
        onChange={(e) => setDownloadUrl(e.target.value)}
        placeholder="Download / import URL (GHL share link, .zip, etc)"
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
          onClick={() => onSave({
            title: title.trim(),
            description: description.trim(),
            url: url.trim(),
            previewImageUrl: previewImageUrl.trim(),
            downloadUrl: downloadUrl.trim(),
            bonusNumber: bonusNumber.trim() ? Number(bonusNumber) : null,
          })}
          disabled={busy || !title.trim() || !url.trim()}
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

// Task #745: drag-and-drop / click-to-select uploader for the
// laptop-mockup preview image. Posts to the admin-only upload endpoint
// and hands the returned `/api/portal/images/<file>` URL back to the
// parent form so the existing text input + save flow keeps working.
function ImageUploader({
  currentUrl,
  onUploaded,
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isOwnUrl = currentUrl.startsWith("/api/portal/images/");

  async function upload(file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast({ title: "Unsupported file", description: "Upload a JPEG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 30 MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetchApi("/dfy/bridge-pages/upload-image", {
        method: "POST",
        body: fd,
      }) as { url: string };
      onUploaded(res.url);
      toast({ title: "Image uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message || "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void upload(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`rounded border border-dashed cursor-pointer px-3 py-4 flex items-center gap-3 transition-colors ${
        dragOver
          ? "border-[#C9A44C] bg-[#C9A44C]/[0.06]"
          : "border-white/[0.12] hover:border-white/[0.22] bg-[#0a0a0a]"
      }`}
    >
      {isOwnUrl ? (
        <img
          src={currentUrl}
          alt="Preview"
          className="w-14 h-10 object-cover rounded border border-white/[0.08] shrink-0"
        />
      ) : (
        <span className="w-14 h-10 rounded border border-white/[0.08] bg-[#0f0f0f] flex items-center justify-center shrink-0">
          <ImageIcon className="w-4 h-4 text-white/30" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] text-white/75 font-semibold flex items-center gap-1.5">
          {busy ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</>
          ) : (
            <><Upload className="w-3.5 h-3.5" /> {isOwnUrl ? "Replace preview image" : "Drop an image here, or click to upload"}</>
          )}
        </p>
        <p className="text-[11px] text-white/40 mt-0.5">JPEG, PNG, or WebP - max 30 MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
