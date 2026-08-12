import { useEffect, useMemo, useState, useRef, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import {
  ExternalLink,
  Heart,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  Image as ImageIcon,
  Download,
  X,
  Play,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { fetchApi, api, getAuthHeaders } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export type DfyTemplateCategory =
  | "ad_swipe"
  | "canva_ad_template"
  | "advertorial_swipe"
  | "funnel_template"
  | "landing_page_swipe";

type Template = {
  id: number;
  category: string;
  subCategory: string | null;
  title: string;
  imageUrl: string | null;
  mediaKind: "image" | "video";
  posterUrl: string | null;
  transcript: string | null;
  canvaUrl: string | null;
  liveUrl: string | null;
  pdfUrl: string | null;
  industry: string | null;
  awarenessStage: string | null;
  ratio: string | null;
  theme: string | null;
  theme2: string | null;
  theme3: string | null;
  platform: string | null;
  brandName: string | null;
  adCopy: string | null;
  sourceDisplayId: string | null;
  isFavourite: boolean;
};

type FilterOptions = {
  industry: string[];
  awarenessStage: string[];
  ratio: string[];
  theme: string[];
  platform: string[];
  subCategory: string[];
};

type ListResponse = {
  items: Template[];
  total: number;
  page: number;
  pageSize: number;
  filterOptions: FilterOptions;
};

type Props = {
  category: DfyTemplateCategory;
  title: string;
  description: string;
  pageSize?: number;
  banner?: React.ReactNode;
  /** Override display labels for any filter key. Keys not listed fall back to defaults. */
  filterLabels?: Partial<Record<keyof FilterOptions, string>>;
};

const FILTER_KEYS: { key: keyof FilterOptions; label: string; param: string }[] = [
  { key: "industry", label: "Industry", param: "industry" },
  { key: "awarenessStage", label: "Awareness", param: "awareness" },
  { key: "ratio", label: "Ratio", param: "ratio" },
  { key: "theme", label: "Theme", param: "theme" },
  { key: "platform", label: "Platform", param: "platform" },
  { key: "subCategory", label: "Source", param: "subCategory" },
];

// Map a template's `ratio` to a CSS aspect-ratio value. Falls back to a
// portrait-ish 4:5 when the field is missing so masonry tiles still
// vary in height instead of collapsing to identical squares.
function aspectFor(ratio: string | null): string {
  switch ((ratio || "").trim()) {
    case "1:1":
      return "1 / 1";
    case "9:16":
      return "9 / 16";
    case "4:5":
      return "4 / 5";
    case "16:9":
      return "16 / 9";
    default:
      return "4 / 5";
  }
}

function detailHeader(category: string): string {
  if (category === "ad_swipe") return "Ad Swipe Details";
  return "Template Details";
}

// Wouter v3's `useLocation` returns only the pathname - the query
// string is stripped. Reading `?page=2` / `?q=foo` from `useLocation`
// therefore always yielded an empty `URLSearchParams`, so pagination
// and search appeared to "reset" the URL without ever updating the
// gallery's controls (the search input stayed empty, the filter
// dropdowns collapsed back to "All", etc.). `useSearchParams` is the
// reactive query-string hook that does preserve the search params.
function useUrlState(): [URLSearchParams, (next: URLSearchParams) => void] {
  const [params, setSearchParams] = useSearchParams();
  const setParams = (next: URLSearchParams) => {
    setSearchParams(next, { replace: true });
  };
  return [params, setParams];
}

export function DfyTemplateGallery({
  category,
  title,
  description,
  pageSize = 60,
  banner,
  filterLabels,
}: Props) {
  const qc = useQueryClient();
  const [params, setParams] = useUrlState();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = me?.user?.role === "admin";

  const search = params.get("q") || "";
  const favouritesOnly = params.get("fav") === "1";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const filterValues: Record<string, string> = {};
  for (const f of FILTER_KEYS) {
    const v = params.get(f.param);
    if (v) filterValues[f.param] = v;
  }

  const queryKey = [
    "dfy-templates",
    category,
    page,
    pageSize,
    search,
    favouritesOnly,
    filterValues,
  ];
  const { data, isLoading, isFetching, isError, error } = useQuery<ListResponse>({
    queryKey,
    queryFn: () => {
      const sp = new URLSearchParams({
        category,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) sp.set("search", search);
      if (favouritesOnly) sp.set("favouritesOnly", "1");
      for (const f of FILTER_KEYS) {
        const v = params.get(f.param);
        if (v) sp.set(f.param, v);
      }
      return fetchApi(`/dfy/templates?${sp.toString()}`) as Promise<ListResponse>;
    },
    placeholderData: (prev) => prev,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const filterOptions = data?.filterOptions || {
    industry: [],
    awarenessStage: [],
    ratio: [],
    theme: [],
    platform: [],
    subCategory: [],
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    setParams(next);
  };

  const favourite = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/dfy/templates/${id}/favourite`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dfy-templates", category] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      fetchApi(`/dfy/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-templates", category] });
      toast({ title: "Template deleted" });
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [showCsv, setShowCsv] = useState(false);
  const [openDetail, setOpenDetail] = useState<Template | null>(null);

  const hasActiveFilters =
    search ||
    favouritesOnly ||
    Object.values(filterValues).some(Boolean);

  return (
    <DfySubPageShell title={title} description={description}>
      {banner}
      {/* Filter bar */}
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-4 md:p-5 mb-5 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              value={search}
              onChange={(e) => updateParam("q", e.target.value || null)}
              placeholder="Search templates by title..."
              className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2.5 text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-[#C9A44C]/50"
            />
          </div>
          <button
            type="button"
            onClick={() => updateParam("fav", favouritesOnly ? null : "1")}
            className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] border transition-colors ${
              favouritesOnly
                ? "bg-[#C9A44C]/15 text-[#C9A44C] border-[#C9A44C]/40"
                : "bg-white/[0.04] text-white/65 border-white/[0.08] hover:text-white hover:border-white/[0.16]"
            }`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${favouritesOnly ? "fill-current" : ""}`}
            />
            Favourites
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] bg-[#C9A44C] text-black hover:bg-[#dfb960]"
              >
                <Plus className="w-3.5 h-3.5" />
                Add template
              </button>
              <button
                onClick={() => setShowCsv(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] bg-white/[0.04] text-white/70 border border-white/[0.08] hover:text-white"
              >
                <Upload className="w-3.5 h-3.5" />
                Re-import CSV
              </button>
              {category === "funnel_template" && (
                <SyncFunnelTemplatesButton
                  onDone={() => qc.invalidateQueries({ queryKey: ["dfy-templates", category] })}
                />
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTER_KEYS.map((f) => {
            const opts = filterOptions[f.key] || [];
            if (!opts.length) return null;
            const value = params.get(f.param) || "";
            return (
              <select
                key={f.key}
                value={value}
                onChange={(e) =>
                  updateParam(f.param, e.target.value || null)
                }
                className="bg-[#0a0a0a] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[12px] text-white/80 focus:outline-none focus:border-[#C9A44C]/40"
              >
                <option value="">{filterLabels?.[f.key] ?? f.label}: All</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          })}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55 hover:text-white px-2 py-1.5"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
          <span className="ml-auto text-[12px] text-white/45">
            {isFetching ? "Loading..." : `${total.toLocaleString()} templates`}
          </span>
        </div>
      </div>

      {showAdd && isAdmin && (
        <TemplateForm
          category={category}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ["dfy-templates", category] });
          }}
        />
      )}
      {editing && isAdmin && (
        <TemplateForm
          category={category}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["dfy-templates", category] });
          }}
        />
      )}
      {showCsv && isAdmin && (
        <CsvReimportPanel
          category={category}
          onClose={() => setShowCsv(false)}
          onDone={() => {
            setShowCsv(false);
            qc.invalidateQueries({ queryKey: ["dfy-templates", category] });
          }}
        />
      )}

      {isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : isError && items.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <ImageIcon className="w-8 h-8 text-white/25 mx-auto mb-3" />
          <p className="text-[14px] text-white/65 font-semibold mb-1">
            {(error as { status?: number } | null)?.status === 403
              ? "This library is part of the Done For You Pack"
              : "We could not load this library"}
          </p>
          <p className="text-[12.5px] text-white/45 mb-4">
            {(error as { status?: number } | null)?.status === 403
              ? "Your account does not have access yet. If you just purchased, refresh in a moment or contact support."
              : "Something went wrong loading these templates. Please try again."}
          </p>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["dfy-templates", category] })}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] bg-white/[0.04] text-white/70 border border-white/[0.08] hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-12 text-center">
          <ImageIcon className="w-8 h-8 text-white/25 mx-auto mb-3" />
          <p className="text-[14px] text-white/65 font-semibold mb-1">
            No templates match your filters
          </p>
          <p className="text-[12.5px] text-white/45">
            Try clearing the filters or expanding your search.
          </p>
        </div>
      ) : (
        <>
          {/* Masonry layout via CSS columns: tiles keep their native
              ratio (1:1 / 9:16 / 4:5) and the column flow packs them
              tightly without cropping. */}
          <div
            className="columns-2 lg:columns-3 gap-3 md:gap-4 [column-fill:_balance]"
          >
            {items.map((t) => (
              <TemplateTile
                key={t.id}
                template={t}
                isAdmin={!!isAdmin}
                onOpen={() => setOpenDetail(t)}
                onFavourite={() => favourite.mutate(t.id)}
                onEdit={() => setEditing(t)}
                onDelete={() => {
                  if (confirm(`Delete "${t.title}"?`)) remove.mutate(t.id);
                }}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPage={(p) => updateParam("page", p === 1 ? null : String(p))}
            />
          )}
        </>
      )}

      <TemplateDetailDialog
        template={openDetail}
        onClose={() => setOpenDetail(null)}
        onFavourite={() => openDetail && favourite.mutate(openDetail.id)}
      />
    </DfySubPageShell>
  );
}

function TemplateTile({
  template,
  isAdmin,
  onOpen,
  onFavourite,
  onEdit,
  onDelete,
}: {
  template: Template;
  isAdmin: boolean;
  onOpen: () => void;
  onFavourite: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Lazy-mount media only when the tile scrolls near the viewport.
  // Avoids decoding hundreds of images and autoplaying every video at
  // once, which was the source of the prior gallery lag.
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = tileRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const isVideo = template.mediaKind === "video";

  return (
    <div
      ref={tileRef}
      className="group relative bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/[0.16] transition-colors mb-3 md:mb-4 break-inside-avoid"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full bg-[#0a0a0a] relative overflow-hidden text-left"
        style={{ aspectRatio: aspectFor(template.ratio) }}
        aria-label={`Open ${template.title}`}
      >
        {template.imageUrl && inView ? (
          isVideo ? (
            <>
              {template.posterUrl ? (
                <img
                  src={template.posterUrl}
                  alt={template.title}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={template.imageUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="bg-black/55 group-hover:bg-black/70 transition-colors rounded-full p-3 backdrop-blur-sm">
                  <Play className="w-6 h-6 text-white fill-white" />
                </span>
              </div>
            </>
          ) : (
            <img
              src={template.imageUrl}
              alt={template.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-white/15" />
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFavourite();
        }}
        className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-sm transition-all ${
          template.isFavourite
            ? "bg-[#C9A44C] text-black opacity-100"
            : "bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-[#C9A44C] hover:text-black"
        }`}
        aria-label="Toggle favourite"
      >
        <Heart
          className={`w-3.5 h-3.5 ${template.isFavourite ? "fill-current" : ""}`}
        />
      </button>

      {isAdmin && (
        <div className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1.5 rounded bg-black/60 text-white/85 hover:text-white"
            aria-label="Edit"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded bg-black/60 text-white/85 hover:text-red-300"
            aria-label="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateDetailDialog({
  template,
  onClose,
  onFavourite,
}: {
  template: Template | null;
  onClose: () => void;
  onFavourite: () => void;
}) {
  const open = !!template;
  const [downloading, setDownloading] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);

  // Reset transient UI state whenever the dialog re-opens for a new
  // template so stale "Copied!" pills don't flash.
  useEffect(() => {
    if (!open) {
      setTranscriptCopied(false);
      setDownloading(false);
    }
  }, [open]);

  const themeBadges = useMemo(() => {
    if (!template) return [] as string[];
    return [template.theme, template.theme2, template.theme3].filter(
      (v): v is string => !!v && v.trim() !== "",
    );
  }, [template]);

  const isVideo = template?.mediaKind === "video";

  const copyAdCopy = async () => {
    if (!template?.adCopy) return;
    try {
      await navigator.clipboard.writeText(template.adCopy);
      toast({ title: "Ad copy copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const copyTranscript = async () => {
    const text = (template?.transcript || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 2000);
      toast({ title: "Transcript copied" });
    } catch (err) {
      toast({ title: "Copy failed", description: String(err) });
    }
  };

  const downloadAsset = async () => {
    if (!template?.imageUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(template.imageUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ctype = res.headers.get("content-type") || "";
      const ext =
        (ctype.split("/").pop() || "").replace("jpeg", "jpg").replace(
          /[^a-z0-9]/gi,
          "",
        ) ||
        (template.mediaKind === "video" ? "mp4" : "jpg");
      const safeTitle = (template.title || "asset")
        .replace(/[^a-z0-9-_]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "asset";
      const prefix = template.sourceDisplayId
        ? `${template.sourceDisplayId}_`
        : "";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${prefix}${safeTitle}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      // Same-origin blob fetch can fail for cross-origin assets; fall
      // back to opening the asset in a new tab so the user has a path
      // to save it manually instead of seeing nothing happen.
      if (template.imageUrl) {
        window.open(template.imageUrl, "_blank", "noopener,noreferrer");
      }
      toast({
        title: "Download fell back to a new tab",
        description: e?.message || undefined,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#0b0b0b] border border-white/[0.08] text-white max-w-5xl w-[95vw] p-0 overflow-hidden">
        <DialogTitle className="sr-only">
          {template?.title || "Template details"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Preview, copy, and download options for {template?.title || "this template"}.
        </DialogDescription>
        {template && (
          <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-h-[88vh]">
            <div className="bg-black flex items-center justify-center p-3 md:p-5 min-h-[280px]">
              {template.imageUrl ? (
                isVideo ? (
                  <video
                    src={template.imageUrl}
                    poster={template.posterUrl || undefined}
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                    className="max-w-full max-h-[80vh] w-auto h-auto rounded-md"
                    style={{ aspectRatio: aspectFor(template.ratio) }}
                  />
                ) : (
                  <img
                    src={template.imageUrl}
                    alt={template.title}
                    className="max-w-full max-h-[80vh] w-auto h-auto object-contain rounded-md"
                  />
                )
              ) : (
                <div className="text-white/30 flex items-center justify-center">
                  <ImageIcon className="w-10 h-10" />
                </div>
              )}
            </div>

            <div className="p-5 md:p-6 overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                  {detailHeader(template.category)}
                </p>
                <button
                  type="button"
                  onClick={onFavourite}
                  className={`p-1.5 rounded-full border transition-colors ${
                    template.isFavourite
                      ? "bg-[#C9A44C]/15 text-[#C9A44C] border-[#C9A44C]/40"
                      : "bg-white/[0.03] text-white/55 border-white/[0.08] hover:text-white"
                  }`}
                  aria-label="Toggle favourite"
                >
                  <Heart
                    className={`w-4 h-4 ${template.isFavourite ? "fill-current" : ""}`}
                  />
                </button>
              </div>
              <h2 className="text-[18px] md:text-[20px] font-semibold leading-tight">
                {template.title}
              </h2>
              <p className="text-[12px] text-white/45 mt-1">
                {template.sourceDisplayId
                  ? `#${template.sourceDisplayId}`
                  : `#${template.id}`}
                {template.brandName ? ` - ${template.brandName}` : ""}
              </p>

              <div className="flex flex-wrap gap-1.5 mt-3">
                {template.industry && (
                  <Pill label="Industry" value={template.industry} />
                )}
                {themeBadges.map((t, i) => (
                  <Pill key={`theme-${i}`} label="Theme" value={t} />
                ))}
                {template.ratio && (
                  <Pill label="Ratio" value={template.ratio} />
                )}
                {template.awarenessStage && (
                  <Pill label="Awareness" value={template.awarenessStage} />
                )}
                {template.platform && (
                  <Pill label="Platform" value={template.platform} />
                )}
              </div>

              {template.adCopy && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                      Ad Copy
                    </p>
                    <button
                      type="button"
                      onClick={copyAdCopy}
                      className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#C9A44C] hover:text-[#dfb960]"
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-[13px] text-white/80 bg-[#0a0a0a] border border-white/[0.06] rounded-lg p-3 leading-relaxed max-h-[34vh] overflow-y-auto">
                    {template.adCopy}
                  </pre>
                </div>
              )}

              {isVideo && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                      Transcript
                    </p>
                    {template.transcript ? (
                      <button
                        type="button"
                        onClick={copyTranscript}
                        className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                          transcriptCopied
                            ? "text-[#C9A44C]"
                            : "text-white/65 hover:text-white"
                        }`}
                      >
                        {transcriptCopied ? (
                          <>
                            <Check className="w-3 h-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                  <div className="text-[13px] leading-[1.65] text-white/80 whitespace-pre-wrap bg-[#0a0a0a] border border-white/[0.06] rounded-lg p-3 max-h-[28vh] overflow-y-auto">
                    {template.transcript ? (
                      template.transcript
                    ) : (
                      <p className="text-white/40 italic">
                        Transcript is being generated and will appear here shortly. Refresh in a minute or two.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {template.canvaUrl && (
                  <a
                    href={template.canvaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[#C9A44C] hover:bg-[#dfb960] text-black text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-2 rounded"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {template.category === "funnel_template" ? "Use template" : "Open in Canva"}
                  </a>
                )}
                {template.liveUrl && (
                  <a
                    href={template.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-2 rounded border border-white/[0.08]"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open live page
                  </a>
                )}
                {template.pdfUrl && (
                  <a
                    href={template.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="inline-flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-2 rounded border border-white/[0.08]"
                  >
                    <Download className="w-3 h-3" />
                    Download PDF
                  </a>
                )}
                {template.imageUrl && !template.pdfUrl && (
                  <button
                    type="button"
                    onClick={downloadAsset}
                    disabled={downloading}
                    className="inline-flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white text-[11px] font-bold uppercase tracking-[0.12em] px-3 py-2 rounded border border-white/[0.08] disabled:opacity-50"
                  >
                    {downloading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    {isVideo ? "Download Video" : "Download Image"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-1 text-[11px] text-white/80">
      <span className="text-white/40 text-[9.5px] uppercase tracking-[0.14em]">
        {label}
      </span>
      <span>{value}</span>
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const window = 2;
  const start = Math.max(1, page - window);
  const end = Math.min(totalPages, page + window);
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="mt-6 flex items-center justify-center gap-1.5">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="p-2 rounded text-white/55 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Previous page"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {start > 1 && (
        <>
          <button onClick={() => onPage(1)} className="px-3 py-1.5 text-[12px] text-white/55 hover:text-white rounded">
            1
          </button>
          {start > 2 && <span className="text-white/30 text-[12px]">…</span>}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className={`px-3 py-1.5 text-[12px] rounded font-bold ${
            p === page
              ? "bg-[#C9A44C] text-black"
              : "text-white/65 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-white/30 text-[12px]">…</span>}
          <button onClick={() => onPage(totalPages)} className="px-3 py-1.5 text-[12px] text-white/55 hover:text-white rounded">
            {totalPages}
          </button>
        </>
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="p-2 rounded text-white/55 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Next page"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function TemplateForm({
  category,
  initial,
  onCancel,
  onSaved,
}: {
  category: DfyTemplateCategory;
  initial?: Template;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title || "");
  const [canvaUrl, setCanvaUrl] = useState(initial?.canvaUrl || "");
  const [industry, setIndustry] = useState(initial?.industry || "");
  const [awarenessStage, setAwareness] = useState(initial?.awarenessStage || "");
  const [ratio, setRatio] = useState(initial?.ratio || "");
  const [theme, setTheme] = useState(initial?.theme || "");
  const [platform, setPlatform] = useState(initial?.platform || "");
  const [subCategory, setSubCategory] = useState(initial?.subCategory || "");
  const [adCopy, setAdCopy] = useState(initial?.adCopy || "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!initial && !file) {
      toast({ title: "Please upload an image", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("category", category);
      fd.set("title", title.trim());
      if (canvaUrl) fd.set("canvaUrl", canvaUrl.trim());
      if (industry) fd.set("industry", industry.trim());
      if (awarenessStage) fd.set("awarenessStage", awarenessStage.trim());
      if (ratio) fd.set("ratio", ratio.trim());
      if (theme) fd.set("theme", theme.trim());
      if (platform) fd.set("platform", platform.trim());
      if (subCategory) fd.set("subCategory", subCategory.trim());
      if (adCopy) fd.set("adCopy", adCopy);
      if (file) fd.set("image", file);

      const url = initial
        ? `/api/portal/dfy/templates/${initial.id}`
        : `/api/portal/dfy/templates`;
      const method = initial ? "PATCH" : "POST";
      const headers = await getAuthHeaders();
      const res = await fetch(url, {
        method,
        headers: { ...headers, "X-Portal-Key": "room30" },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast({ title: initial ? "Template updated" : "Template added" });
      onSaved();
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#161616] border border-[#C9A44C]/25 rounded-2xl p-5 mb-5 space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={canvaUrl} onChange={(e) => setCanvaUrl(e.target.value)} placeholder="Canva URL (optional)" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={awarenessStage} onChange={(e) => setAwareness(e.target.value)} placeholder="Awareness Stage" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="Ratio (e.g. 1:1, 4:5)" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Theme" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
        <input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} placeholder="Sub-category (optional)" className="bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30" />
      </div>
      <textarea
        value={adCopy}
        onChange={(e) => setAdCopy(e.target.value)}
        placeholder="Ad copy (optional, multi-line)"
        rows={4}
        className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded px-3 py-2 text-[13px] text-white placeholder-white/30"
      />
      <input
        type="file"
        accept="image/*,video/*"
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          setFile(e.target.files?.[0] || null)
        }
        className="text-[12px] text-white/65"
      />
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="bg-[#C9A44C] text-black text-[11px] font-bold uppercase tracking-[0.14em] px-4 py-2 rounded hover:bg-[#dfb960] disabled:opacity-50">
          {busy ? "Saving..." : initial ? "Update template" : "Add template"}
        </button>
        <button onClick={onCancel} className="text-white/55 text-[11px] font-bold uppercase tracking-[0.14em] px-3 py-2 rounded hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}

function CsvReimportPanel({
  category,
  onClose,
  onDone,
}: {
  category: DfyTemplateCategory;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [subCategory, setSubCategory] = useState<string>("monthly_drop");
  const requiresSubCategory = category === "canva_ad_template";

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const payload: Record<string, string> = { category, csv: text };
      if (requiresSubCategory) payload.subCategory = subCategory;
      const res = (await fetchApi("/portal/dfy/templates/import-csv", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as {
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        missingImage?: number;
        failedDownload?: number;
      };
      toast({
        title: "CSV re-imported",
        description: `New: ${res.inserted}, Updated: ${res.updated}, Skipped: ${res.skipped}`,
      });
      onDone();
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message || "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#161616] border border-[#C9A44C]/25 rounded-2xl p-5 mb-5 space-y-3">
      <p className="text-[13px] text-white/75">
        Re-upload a CSV with the same shape as the original export. Rows are
        upserted on (category, display_id), so this is safe to re-run.
      </p>
      {requiresSubCategory && (
        <label className="block text-[12px] text-white/70">
          <span className="block mb-1 uppercase tracking-[0.14em] text-[10px] text-white/55">
            Sub-category
          </span>
          <select
            value={subCategory}
            onChange={(e) => setSubCategory(e.target.value)}
            className="bg-[#101010] border border-white/15 rounded px-2 py-1 text-[12px] text-white/85"
          >
            <option value="monthly_drop">Monthly drop</option>
            <option value="free_template">Free template</option>
            <option value="previous_drop">Previous drop</option>
          </select>
        </label>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="text-[12px] text-white/65"
      />
      <div className="flex items-center gap-2">
        <button onClick={onClose} disabled={busy} className="text-white/55 text-[11px] font-bold uppercase tracking-[0.14em] px-3 py-2 rounded hover:text-white">
          {busy ? "Importing..." : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function SyncFunnelTemplatesButton({ onDone }: { onDone: () => void }) {
  const sync = useMutation({
    mutationFn: () =>
      fetchApi("/dfy/templates/funnel-templates/sync-from-sheet", {
        method: "POST",
      }) as Promise<{
        ok: boolean;
        inserted: number;
        updated: number;
        skipped: number;
        totalRows: number;
      }>,
    onSuccess: (r) => {
      toast({
        title: "Synced from sheet",
        description: `Added ${r.inserted}, updated ${r.updated}, unchanged ${r.skipped} (of ${r.totalRows})`,
      });
      onDone();
    },
    onError: (e: any) =>
      toast({
        title: "Sync failed",
        description: e?.message || "",
        variant: "destructive",
      }),
  });
  const busy = sync.isPending;
  return (
    <button
      onClick={() => sync.mutate()}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-[0.14em] bg-white/[0.04] text-white/70 border border-white/[0.08] hover:text-white disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      {busy ? "Syncing..." : "Sync from sheet"}
    </button>
  );
}
