import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useState } from "react";
import {
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Search,
  BookOpen,
  Target,
  Palette,
  ShoppingCart,
  Megaphone,
  BarChart3,
  Layers,
  Copy,
  Check,
  Clock,
} from "lucide-react";

interface Asset {
  id: number;
  category: string;
  title: string;
  content: string;
  lessonSlug: string | null;
  assetType: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { key: "low-ticket-build", label: "Low Ticket Build (Offer & Funnel)", icon: Target, description: "Your DFY offer creation, funnel build, and sales page assets" },
  { key: "vsl-script", label: "Done For You VSL Script", icon: Megaphone, description: "Your custom VSL script and video sales letter assets" },
  { key: "upsell-pages", label: "3 Upsell Pages Done For You", icon: Layers, description: "Your 3 DFY upsell page copy, design, and assets" },
  { key: "content-scripts", label: "YouTube & Podcast Scripts", icon: BookOpen, description: "30 YouTube video scripts and 30 podcast ad scripts" },
  { key: "brand-assets", label: "Brand Assets", icon: Palette, description: "Brand guidelines, logos, color palettes, fonts" },
  { key: "research-docs", label: "Research Docs", icon: Search, description: "Avatars, market research, competitor analysis" },
  { key: "sales-assets", label: "Sales Assets", icon: ShoppingCart, description: "Sales pages, checkout flows, funnel copy" },
  { key: "kpis-tracking", label: "KPIs & Tracking", icon: BarChart3, description: "KPI dashboards, tracking docs, metrics" },
  { key: "other", label: "Other", icon: BookOpen, description: "Miscellaneous docs and notes" },
];

export default function AssetsDocs() {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [creatingCategory, setCreatingCategory] = useState<string | null>(null);
  const [viewingAsset, setViewingAsset] = useState<Asset | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: api.getAssets,
  });

  const createMutation = useMutation({
    mutationFn: (data: { category: string; title: string; content: string }) =>
      api.createAsset(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setCreatingCategory(null);
      setNewTitle("");
      setNewContent("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; title?: string; content?: string }) =>
      api.updateAsset(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setEditingAsset(null);
      setViewingAsset(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteAsset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setDeleteConfirm(null);
      setViewingAsset(null);
    },
  });

  const assets: Asset[] = data?.assets || [];

  const filteredAssets = searchQuery
    ? assets.filter(
        (a) =>
          a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.content?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : assets;

  const assetsByCategory = CATEGORIES.map((cat) => ({
    ...cat,
    assets: filteredAssets.filter((a) => a.category === cat.key),
  }));

  const categoriesWithAssets = assetsByCategory.filter(c => c.assets.length > 0);
  const categoriesEmpty = assetsByCategory.filter(c => c.assets.length === 0);

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyContent = (asset: Asset) => {
    navigator.clipboard.writeText(asset.content || "");
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-8">
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Assets
          </h1>
          <p className="text-[14px] text-white/65 mt-2">
            All your saved documents, research, scripts, and build assets in one place.
          </p>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/55" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl pl-11 pr-4 py-3 text-[14px] text-white placeholder:text-white/45 focus:outline-none focus:border-[#C9A44C]/30 transition-colors"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-4 text-center">
            <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {assets.length}
            </p>
            <p className="text-[11px] text-white/55 uppercase tracking-wider mt-0.5">Total Documents</p>
          </div>
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-4 text-center">
            <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {categoriesWithAssets.length}
            </p>
            <p className="text-[11px] text-white/55 uppercase tracking-wider mt-0.5">Categories Used</p>
          </div>
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-4 text-center">
            <p className="text-[24px] font-bold text-white" style={{ fontFamily: "var(--app-font-display)" }}>
              {CATEGORIES.length}
            </p>
            <p className="text-[11px] text-white/55 uppercase tracking-wider mt-0.5">Total Categories</p>
          </div>
        </div>

        {viewingAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#141414] border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden mx-4 flex flex-col">
              <div className="sticky top-0 bg-[#141414] border-b border-white/[0.06] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-[#C9A44C] shrink-0" />
                  {editingAsset?.id === viewingAsset.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[15px] font-bold text-white focus:outline-none focus:border-[#C9A44C]/30"
                      autoFocus
                    />
                  ) : (
                    <h3
                      className="text-[15px] font-bold text-white truncate"
                      style={{ fontFamily: "var(--app-font-display)" }}
                    >
                      {viewingAsset.title}
                    </h3>
                  )}
                </div>
                <button
                  onClick={() => { setViewingAsset(null); setEditingAsset(null); setDeleteConfirm(null); }}
                  className="text-white/65 hover:text-white/70 transition-colors ml-3 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {editingAsset?.id === viewingAsset.id ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={20}
                    className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-white/80 placeholder:text-white/45 focus:outline-none focus:border-[#C9A44C]/30 resize-y font-mono leading-[1.8]"
                  />
                ) : (
                  <pre className="text-[13px] text-white/70 leading-[1.8] whitespace-pre-wrap font-sans">
                    {viewingAsset.content || "(No content yet)"}
                  </pre>
                )}
              </div>

              <div className="border-t border-white/[0.06] px-6 py-3 flex items-center justify-between bg-[#141414]">
                <div className="flex items-center gap-2 text-[11px] text-white/45">
                  <Clock className="w-3 h-3" />
                  {new Date(viewingAsset.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
                <div className="flex items-center gap-2">
                  {editingAsset?.id === viewingAsset.id ? (
                    <>
                      <button
                        onClick={() => setEditingAsset(null)}
                        className="px-3 py-1.5 text-[12px] text-white/65 hover:text-white/70 rounded-lg hover:bg-white/[0.04] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => updateMutation.mutate({ id: viewingAsset.id, title: editTitle, content: editContent })}
                        disabled={updateMutation.isPending}
                        className="flex items-center gap-1.5 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" />
                        {updateMutation.isPending ? "Saving..." : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => copyContent(viewingAsset)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] rounded-lg transition-colors"
                      >
                        {copiedId === viewingAsset.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        {copiedId === viewingAsset.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={() => {
                          setEditingAsset(viewingAsset);
                          setEditTitle(viewingAsset.title);
                          setEditContent(viewingAsset.content || "");
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white/65 hover:text-white/70 hover:bg-white/[0.04] rounded-lg transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                      {deleteConfirm === viewingAsset.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-amber-400">Delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate(viewingAsset.id)}
                            className="text-[11px] text-amber-400 font-bold hover:text-amber-300 px-2 py-1 rounded bg-amber-500/10"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-[11px] text-white/65 hover:text-white/60 px-2 py-1"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(viewingAsset.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white/65 hover:text-amber-400 hover:bg-amber-500/5 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {[...categoriesWithAssets, ...categoriesEmpty].map((cat) => (
            <div
              key={cat.key}
              className="bg-[#111] border border-white/[0.06] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => toggleCategory(cat.key)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[#C9A44C]/10 flex items-center justify-center shrink-0">
                  <cat.icon className="w-4 h-4 text-[#C9A44C]" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white truncate">{cat.label}</span>
                    {cat.assets.length > 0 && (
                      <span className="text-[10px] font-bold text-[#C9A44C] bg-[#C9A44C]/10 px-1.5 py-0.5 rounded shrink-0">
                        {cat.assets.length}
                      </span>
                    )}
                  </div>
                  {!expandedCategories.has(cat.key) && (
                    <p className="text-[11px] text-white/50 mt-0.5 truncate">{cat.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCreatingCategory(cat.key);
                      setNewTitle("");
                      setNewContent("");
                      if (!expandedCategories.has(cat.key)) toggleCategory(cat.key);
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
                    title="Add document"
                  >
                    <Plus className="w-4 h-4 text-white/50 hover:text-[#C9A44C]" />
                  </button>
                  {expandedCategories.has(cat.key) ? (
                    <ChevronDown className="w-4 h-4 text-white/45" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-white/45" />
                  )}
                </div>
              </button>

              {expandedCategories.has(cat.key) && (
                <div className="px-5 pb-4 border-t border-white/[0.04]">
                  {creatingCategory === cat.key && (
                    <div className="mt-3 mb-3 bg-[#0a0a0a] border border-[#C9A44C]/20 rounded-xl p-4 space-y-3">
                      <input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Document title..."
                        className="w-full bg-[#141414] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[14px] text-white placeholder:text-white/45 focus:outline-none focus:border-[#C9A44C]/30"
                        autoFocus
                      />
                      <textarea
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        placeholder="Paste or type your content here..."
                        rows={6}
                        className="w-full bg-[#141414] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[13px] text-white/70 placeholder:text-white/45 focus:outline-none focus:border-[#C9A44C]/30 resize-y leading-relaxed"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setCreatingCategory(null)}
                          className="px-3 py-1.5 text-[12px] text-white/65 hover:text-white/70 rounded-lg hover:bg-white/[0.04] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (newTitle.trim()) {
                              createMutation.mutate({
                                category: cat.key,
                                title: newTitle.trim(),
                                content: newContent,
                              });
                            }
                          }}
                          disabled={!newTitle.trim() || createMutation.isPending}
                          className="flex items-center gap-1.5 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" />
                          {createMutation.isPending ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  )}

                  {cat.assets.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {cat.assets.map((asset) => (
                        <button
                          key={asset.id}
                          onClick={() => {
                            setViewingAsset(asset);
                            setEditingAsset(null);
                            setDeleteConfirm(null);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group"
                        >
                          <FileText className="w-4 h-4 text-white/15 group-hover:text-[#C9A44C] transition-colors shrink-0" />
                          <span className="text-[13px] text-white/60 group-hover:text-white/80 transition-colors truncate text-left flex-1">
                            {asset.title}
                          </span>
                          <span className="text-[11px] text-white/15 shrink-0">
                            {new Date(asset.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                          <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-white/55 shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : creatingCategory !== cat.key ? (
                    <div className="mt-3 text-center py-4">
                      <FolderOpen className="w-6 h-6 text-white/10 mx-auto mb-2" />
                      <p className="text-[12px] text-white/45 mb-2">{cat.description}</p>
                      <button
                        onClick={() => {
                          setCreatingCategory(cat.key);
                          setNewTitle("");
                          setNewContent("");
                        }}
                        className="inline-flex items-center gap-1.5 text-[12px] text-[#C9A44C]/50 hover:text-[#C9A44C] transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Add your first document
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </PortalLayout>
  );
}
