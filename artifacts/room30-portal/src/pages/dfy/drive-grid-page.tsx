import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link } from "wouter";
import { Loader2, RefreshCw, Download, FolderOpen, ChevronLeft } from "lucide-react";
import { DfySubPageShell } from "@/components/dfy-sub-page-shell";
import { fetchApi, api } from "@/lib/api";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl: string;
  downloadUrl: string;
  width: number | null;
  height: number | null;
};

type SubfolderEntry = {
  id: string;
  name: string;
  count: number;
  coverThumbnailUrl: string | null;
};

type DriveListResponse =
  | { mode: "flat"; files: DriveFile[]; lastSyncedAt: string | null }
  | { mode: "subfolders"; subfolders: SubfolderEntry[]; lastSyncedAt: string | null };

type SubfolderResponse = {
  subfolder: { id: string; name: string };
  files: DriveFile[];
  lastSyncedAt: string | null;
};

type RefreshResponse = {
  ok: boolean;
  reason: string | null;
  count: number;
  lastSyncedAt: string | null;
};

type Props = {
  slug: string;
  title: string;
  description: string;
  // T392: when set, the page is rendered in drill-in mode and shows the
  // images for that subfolder instead of the folder index.
  subfolderId?: string;
  // Route prefix used to link folder cards back into the drill-in view.
  // E.g. "/done-for-you-pack/250-scenes". Required when the page might
  // be in subfolder mode.
  basePath?: string;
};

// Tailwind breakpoints used for the responsive column count. Kept in sync
// with the grid below: base=2, sm=3, md=4, lg=5.
function useColumnCount(): number {
  const get = () => {
    if (typeof window === "undefined") return 4;
    const w = window.innerWidth;
    if (w >= 1024) return 5;
    if (w >= 768) return 4;
    if (w >= 640) return 3;
    return 2;
  };
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const onResize = () => setCols(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

function formatLastSynced(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleString();
}

// Shared component for the two live Google Drive backed sub-pages
// (100 AI Influencers and 250+ Scenes). Renders a virtualized grid that
// reads from the persisted dfy_drive_assets catalog (mirrored on the
// Media Worker on a weekly cadence) and serves thumbnails / originals
// from our object storage with long cache lifetimes. Admins can force an
// immediate re-sync via "Refresh now". Subfolder-mode slugs render a
// folder-card index first and drill into per-folder image grids.
export function DfyDriveGridPage({ slug, title, description, subfolderId, basePath }: Props) {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const isAdmin = me?.user?.role === "admin";

  const indexQuery = useQuery({
    queryKey: ["dfy-drive", slug],
    queryFn: () => fetchApi(`/dfy/drive/${slug}`) as Promise<DriveListResponse>,
    staleTime: 60_000,
    enabled: !subfolderId,
  });

  const folderQuery = useQuery({
    queryKey: ["dfy-drive", slug, "folder", subfolderId],
    queryFn: () =>
      fetchApi(
        `/dfy/drive/${slug}/folder/${encodeURIComponent(subfolderId!)}`,
      ) as Promise<SubfolderResponse>,
    staleTime: 60_000,
    enabled: !!subfolderId,
  });

  const refresh = useMutation({
    mutationFn: () =>
      fetchApi(`/dfy/drive/${slug}/refresh`, { method: "POST" }) as Promise<RefreshResponse>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dfy-drive", slug] });
    },
  });

  // ── Drill-in view: per-folder image grid ─────────────────────────────────
  if (subfolderId) {
    const data = folderQuery.data;
    const files = data?.files || [];
    const folderName = data?.subfolder?.name || "Folder";
    const lastSyncedLabel = formatLastSynced(data?.lastSyncedAt || null);
    const indexHref = basePath || "";
    return (
      <DfySubPageShell title={title} description={description}>
        <div className="mb-5">
          {indexHref && (
            <Link
              href={indexHref}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55 hover:text-white/85 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              All folders
            </Link>
          )}
          <h2
            className="mt-3 text-[20px] md:text-[24px] font-bold uppercase tracking-[0.01em] text-white leading-[1.1]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {folderName}
          </h2>
          <p className="mt-1 text-[12.5px] text-white/45">
            {folderQuery.isLoading
              ? "Loading..."
              : `${files.length} item${files.length === 1 ? "" : "s"}`}
            {isAdmin && lastSyncedLabel && (
              <span className="ml-3 text-white/35">Last synced {lastSyncedLabel}</span>
            )}
          </p>
        </div>
        <FilesGrid
          files={files}
          loading={folderQuery.isLoading}
          error={folderQuery.error as Error | null}
          emptyText="No images in this folder yet."
        />
      </DfySubPageShell>
    );
  }

  // ── Index view: either a flat grid or a folder-card index ────────────────
  const data = indexQuery.data;
  const lastSyncedLabel = formatLastSynced(data?.lastSyncedAt || null);
  const isSubfolderMode = data?.mode === "subfolders";
  const flatFiles = data?.mode === "flat" ? data.files : [];
  const subfolders = data?.mode === "subfolders" ? data.subfolders : [];
  const itemCount = isSubfolderMode ? subfolders.length : flatFiles.length;
  const itemNoun = isSubfolderMode
    ? `folder${subfolders.length === 1 ? "" : "s"}`
    : `item${flatFiles.length === 1 ? "" : "s"}`;

  return (
    <DfySubPageShell title={title} description={description}>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <p className="text-[12.5px] text-white/45">
          {indexQuery.isLoading ? "Loading..." : `${itemCount} ${itemNoun}`}
          {isAdmin && lastSyncedLabel && (
            <span className="ml-3 text-white/35">Last synced {lastSyncedLabel}</span>
          )}
        </p>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {refresh.data && refresh.data.reason && !refresh.isPending && (
              <span className="text-[11px] text-white/50">{refresh.data.reason}</span>
            )}
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C9A44C] hover:text-[#dfb960] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
              Refresh now
            </button>
          </div>
        )}
      </div>

      {indexQuery.isLoading ? (
        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
        </div>
      ) : indexQuery.error ? (
        <div className="bg-[#0f0f0f] border border-red-500/20 rounded-2xl p-8 text-center text-red-300/80 text-[13px]">
          Could not load images. {(indexQuery.error as Error).message || ""}
        </div>
      ) : isSubfolderMode ? (
        subfolders.length === 0 ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center text-white/55 text-[13px]">
            No folders yet. New folders added in Drive show up here automatically after the next sync.
          </div>
        ) : (
          <SubfolderGrid subfolders={subfolders} basePath={basePath || ""} />
        )
      ) : (
        <FilesGrid
          files={flatFiles}
          loading={false}
          error={null}
          emptyText="No images in this folder yet."
        />
      )}
    </DfySubPageShell>
  );
}

function SubfolderGrid({
  subfolders,
  basePath,
}: {
  subfolders: SubfolderEntry[];
  basePath: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {subfolders.map((sf) => (
        <Link
          key={sf.id}
          href={basePath ? `${basePath}/folder/${encodeURIComponent(sf.id)}` : "#"}
          className="group relative bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden aspect-[3/4] hover:border-[#C9A44C]/40 transition-colors flex flex-col"
        >
          <div className="relative flex-1 bg-[#0a0a0a]">
            {sf.coverThumbnailUrl ? (
              <img
                src={sf.coverThumbnailUrl}
                alt={sf.name}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FolderOpen className="w-8 h-8 text-white/30" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
          </div>
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p
              className="text-[13px] font-bold uppercase tracking-[0.04em] text-white truncate"
              style={{ fontFamily: "var(--app-font-display)" }}
              title={sf.name}
            >
              {sf.name}
            </p>
            <p className="mt-0.5 text-[10.5px] text-white/55">
              {sf.count} item{sf.count === 1 ? "" : "s"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function FilesGrid({
  files,
  loading,
  error,
  emptyText,
}: {
  files: DriveFile[];
  loading: boolean;
  error: Error | null;
  emptyText: string;
}) {
  const cols = useColumnCount();
  const rowCount = Math.ceil(files.length / cols);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const estimatedRowHeight = useMemo(() => {
    if (typeof window === "undefined") return 320;
    const containerWidth = Math.min(window.innerWidth - 64, 1200);
    const tileWidth = (containerWidth - (cols - 1) * 12) / cols;
    return Math.round(tileWidth * (4 / 3)) + 12; // +12 = grid gap
  }, [cols]);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });

  if (loading) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-[#0f0f0f] border border-red-500/20 rounded-2xl p-8 text-center text-red-300/80 text-[13px]">
        Could not load images. {error.message || ""}
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center text-white/55 text-[13px]">
        {emptyText}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((vRow) => {
        const rowStart = vRow.index * cols;
        const rowFiles = files.slice(rowStart, rowStart + cols);
        return (
          <div
            key={vRow.key}
            ref={virtualizer.measureElement}
            data-index={vRow.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {rowFiles.map((f) => (
                <Tile key={f.id} file={f} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tile({ file: f }: { file: DriveFile }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDownload() {
    if (downloading) return;
    setError(null);
    setDownloading(true);
    try {
      // downloadUrl is a same-origin `/api/portal/...` path. The route already
      // returns `Content-Disposition: attachment` and authenticates off the
      // Clerk session cookie (same as the <img> thumbnails), so a native anchor
      // download streams the file straight to disk. This avoids the previous
      // fetch()->res.blob() path that buffered the whole multi-MB original in
      // memory and failed when the streamed response was aborted mid-transfer.
      const a = document.createElement("a");
      a.href = f.downloadUrl;
      a.download = f.name || "download";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError("Download failed. Please try again.");
    } finally {
      // The browser owns the transfer once the click fires; clear the spinner
      // shortly after so the button gives feedback without a fake progress bar.
      setTimeout(() => setDownloading(false), 1200);
    }
  }

  return (
    <div className="group relative bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden aspect-[3/4] hover:border-[#C9A44C]/40 transition-colors mt-3 first:mt-0 sm:mt-0">
      <img
        src={f.thumbnailUrl}
        alt={f.name}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
        <p className="text-[11px] text-white/85 truncate mb-2" title={f.name}>{f.name}</p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center justify-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] bg-[#C9A44C] text-black px-3 py-1.5 rounded hover:bg-[#dfb960] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Download className="w-3 h-3" />
          )}
          {downloading ? "Downloading" : "Download"}
        </button>
        {error && (
          <p className="text-[10px] text-red-400 mt-1.5" role="alert">{error}</p>
        )}
      </div>
    </div>
  );
}
