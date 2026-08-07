import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, getAuthHeaders } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { RichTextEditor } from "@/components/rich-text-editor";
import {
  Plus,
  Save,
  Trash2,
  ChevronLeft,
  Loader2,
  Upload,
  X,
  Send,
  EyeOff,
  Eye,
} from "lucide-react";

type AnnouncementAudience = "all" | "admins";
type AnnouncementStatus = "draft" | "published" | "unpublished";
type AnnouncementMediaKind = "image" | "video" | "embed";

type Announcement = {
  id: number;
  title: string;
  bodyHtml: string;
  mediaPath: string | null;
  mediaUrl: string | null;
  mediaKind: AnnouncementMediaKind | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  ctaNewTab: boolean;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  seenCount?: number;
  dismissedCount?: number;
};

const EMPTY: Omit<Announcement, "id" | "createdAt" | "updatedAt" | "publishedAt" | "mediaUrl" | "seenCount" | "dismissedCount"> = {
  title: "",
  bodyHtml: "",
  mediaPath: null,
  mediaKind: null,
  ctaLabel: null,
  ctaHref: null,
  ctaNewTab: true,
  audience: "all",
  status: "draft",
};

// fetchApi() automatically prepends `/api/portal` to any path that does
// not start with `/api/` (see lib/api.ts), so the path here must be the
// route relative to `/api/portal/` - NOT include another `/portal/`
// prefix, otherwise the URL becomes `/api/portal/portal/admin/...` and
// the server returns "Not found: POST /portal/portal/admin/announcements".
const ADMIN_BASE = "/admin/announcements";

// Minimal client-side sanitizer used ONLY by the admin preview pane.
// Mirrors the first defensive passes of the server's sanitizer
// (artifacts/api-server/src/routes/announcements.ts:sanitizeAnnouncementHtml)
// so an admin pasting `<img src=x onerror=alert(1)>` cannot self-XSS
// their own session while previewing a draft. The server is still the
// authoritative sanitizer at save time; this is purely a render-time
// safety net.
const PREVIEW_ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "u", "a", "ul", "ol", "li",
  "h2", "h3", "blockquote",
]);

function sanitizePreviewHtml(input: string): string {
  if (!input) return "";
  let out = input.replace(
    /<\s*(script|style|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/javascript:/gi, "");
  out = out.replace(/<\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!PREVIEW_ALLOWED_TAGS.has(tag)) return "";
    const isClosing = full.startsWith("</");
    if (isClosing) return `</${tag}>`;
    if (tag === "a") {
      const hrefMatch = String(rawAttrs).match(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i);
      const href = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? "") : "";
      if (!/^https?:\/\//i.test(href)) return "";
      const safeHref = href.replace(/"/g, "&quot;");
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer nofollow">`;
    }
    if (tag === "br") return "<br />";
    return `<${tag}>`;
  });
  return out.trim();
}

async function requestUploadUrl(
  file: File,
): Promise<{ uploadURL: string; objectPath: string; mediaKind: AnnouncementMediaKind }> {
  const auth = await getAuthHeaders();
  const res = await fetch("/api/portal/admin/announcements/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Portal-Key": "room30", ...auth },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || "Could not get upload URL");
  }
  return res.json();
}

async function uploadToSignedUrl(file: File, uploadURL: string): Promise<void> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export function AdminAnnouncements() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Announcement | "new" | null>(null);

  const listQuery = useQuery<{ announcements: Announcement[] }>({
    queryKey: ["admin-announcements"],
    queryFn: () => fetchApi(ADMIN_BASE),
  });

  const announcements = listQuery.data?.announcements ?? [];

  return (
    <AdminLayout>
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-5xl mx-auto p-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1
                className="text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                Announcements
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                Compose and publish in-portal announcements. Users see them as a popup when they open the portal, and it won't show again once they dismiss it.
              </p>
            </div>
            <button
              onClick={() => setSelected("new")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#C9A44C] text-black font-semibold hover:bg-[#d4b15c] transition"
              data-testid="button-new-announcement"
            >
              <Plus className="w-4 h-4" /> New Announcement
            </button>
          </div>

          {selected ? (
            <AnnouncementEditor
              initial={selected === "new" ? null : selected}
              onClose={() => {
                setSelected(null);
                queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
              }}
            />
          ) : (
            <div className="border border-white/10 rounded-lg overflow-hidden">
              {listQuery.isLoading ? (
                <div className="p-6 text-white/60 text-sm">Loading...</div>
              ) : announcements.length === 0 ? (
                <div className="p-6 text-white/60 text-sm">
                  No announcements yet. Click "New Announcement" to compose one.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03] text-white/55 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-3">Title</th>
                      <th className="text-left px-4 py-3">Audience</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Published</th>
                      <th className="text-right px-4 py-3">Seen</th>
                      <th className="text-right px-4 py-3">Dismissed</th>
                      <th className="text-left px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map((a) => (
                      <tr
                        key={a.id}
                        className="border-t border-white/[0.06] hover:bg-white/[0.02] cursor-pointer"
                        onClick={() => setSelected(a)}
                        data-testid={`row-announcement-${a.id}`}
                      >
                        <td className="px-4 py-3 text-white">{a.title}</td>
                        <td className="px-4 py-3 text-white/70">
                          {a.audience === "all" ? "All users" : "Admins only"}
                        </td>
                        <td className="px-4 py-3">
                          {a.status === "published" ? (
                            <span className="text-[11px] uppercase tracking-wider text-green-300/80">
                              Published
                            </span>
                          ) : a.status === "unpublished" ? (
                            <span className="text-[11px] uppercase tracking-wider text-amber-300/80">
                              Unpublished
                            </span>
                          ) : (
                            <span className="text-[11px] uppercase tracking-wider text-white/40">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/55 text-xs">
                          {a.publishedAt ? new Date(a.publishedAt).toLocaleString() : "-"}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-white/70 tabular-nums"
                          data-testid={`cell-seen-${a.id}`}
                        >
                          {a.seenCount ?? 0}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-white/70 tabular-nums"
                          data-testid={`cell-dismissed-${a.id}`}
                        >
                          {a.dismissedCount ?? 0}
                        </td>
                        <td className="px-4 py-3 text-white/40 text-xs">Edit</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function AnnouncementEditor({
  initial,
  onClose,
}: {
  initial: Announcement | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() =>
    initial
      ? {
          title: initial.title,
          bodyHtml: initial.bodyHtml,
          mediaPath: initial.mediaPath,
          mediaUrl: initial.mediaUrl,
          mediaKind: initial.mediaKind,
          ctaLabel: initial.ctaLabel ?? "",
          ctaHref: initial.ctaHref ?? "",
          ctaNewTab: initial.ctaNewTab,
          audience: initial.audience,
          status: initial.status,
        }
      : { ...EMPTY, ctaLabel: "", ctaHref: "", mediaUrl: null as string | null },
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mediaUrlError, setMediaUrlError] = useState<string | null>(null);
  const isExisting = initial !== null;

  const payload = useMemo(() => {
    return {
      title: form.title.trim(),
      bodyHtml: form.bodyHtml,
      mediaPath: form.mediaPath,
      mediaKind: form.mediaKind,
      ctaLabel: form.ctaLabel.trim() || null,
      ctaHref: form.ctaHref.trim() || null,
      ctaNewTab: form.ctaNewTab,
      audience: form.audience,
      status: form.status,
    };
  }, [form]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!payload.title) throw new Error("Title is required");
      if (isExisting) {
        return fetchApi<{ announcement: Announcement }>(`${ADMIN_BASE}/${initial!.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return fetchApi<{ announcement: Announcement }>(ADMIN_BASE, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["portal-announcements"] });
      onClose();
    },
    onError: (err: any) => setError(err?.message || "Save failed"),
  });

  const lifecycleMutation = useMutation({
    mutationFn: async (action: "publish" | "unpublish") => {
      return fetchApi<{ announcement: Announcement }>(`${ADMIN_BASE}/${initial!.id}/${action}`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["portal-announcements"] });
      onClose();
    },
    onError: (err: any) => setError(err?.message || "Action failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () =>
      fetchApi<{ ok: true }>(`${ADMIN_BASE}/${initial!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["portal-announcements"] });
      onClose();
    },
    onError: (err: any) => setError(err?.message || "Delete failed"),
  });

  async function handleMediaUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      // Lightweight client-side guard so the user gets instant feedback;
      // the server enforces the same rules authoritatively in
      // /portal/admin/announcements/uploads/request-url.
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) throw new Error("Only image or video files are supported");
      if (file.size > 100 * 1024 * 1024) throw new Error("File must be under 100 MB");
      const { uploadURL, objectPath, mediaKind } = await requestUploadUrl(file);
      await uploadToSignedUrl(file, uploadURL);
      // Preview from the local file blob so the admin sees the upload right
      // away; the server hands back a signed mediaUrl once the row is saved.
      const previewUrl = URL.createObjectURL(file);
      setForm((f) => ({
        ...f,
        mediaPath: objectPath,
        mediaUrl: previewUrl,
        mediaKind,
      }));
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border border-white/10 rounded-lg p-6 bg-[#0e0e0e]">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 text-white/65 hover:text-white text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Back to list
        </button>
        <div className="flex gap-2">
          {isExisting && initial!.status !== "published" && (
            <button
              onClick={() => lifecycleMutation.mutate("publish")}
              disabled={lifecycleMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] bg-green-700/30 text-green-200 hover:bg-green-700/50"
              data-testid="button-publish"
            >
              <Send className="w-3.5 h-3.5" />
              {initial!.status === "unpublished" ? "Republish" : "Publish"}
            </button>
          )}
          {isExisting && initial!.status === "published" && (
            <button
              onClick={() => lifecycleMutation.mutate("unpublish")}
              disabled={lifecycleMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] bg-white/10 text-white/80 hover:bg-white/20"
              data-testid="button-unpublish"
            >
              <EyeOff className="w-3.5 h-3.5" /> Unpublish
            </button>
          )}
          {isExisting && (
            <button
              onClick={() => {
                if (confirm("Delete this announcement?")) deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] bg-red-900/30 text-red-200 hover:bg-red-900/50"
              data-testid="button-delete"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] bg-white/10 text-white/85 hover:bg-white/20"
            data-testid="button-toggle-preview"
          >
            <Eye className="w-3.5 h-3.5" />
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] bg-[#C9A44C] text-black font-semibold hover:bg-[#d4b15c]"
            data-testid="button-save"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-red-700/40 bg-red-900/20 text-red-200 text-sm">
          {error}
        </div>
      )}

      {showPreview && (
        <AnnouncementPreview
          title={form.title}
          bodyHtml={sanitizePreviewHtml(form.bodyHtml)}
          mediaUrl={form.mediaUrl}
          mediaKind={form.mediaKind}
          ctaLabel={form.ctaLabel}
          ctaHref={form.ctaHref}
          ctaNewTab={form.ctaNewTab}
        />
      )}

      <Field label="Title">
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white"
          placeholder="What's new in AI Influencer Portfolio..."
          data-testid="input-title"
        />
      </Field>

      <Field label="Body">
        <div className="border border-white/10 rounded bg-black/40 p-2">
          <RichTextEditor
            content={form.bodyHtml}
            onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
            placeholder="Write your announcement..."
          />
        </div>
        <p className="text-[11px] text-white/40 mt-1">
          Allowed formatting: bold, italic, links, bullet/number lists, headings.
          The server strips anything else for safety.
        </p>
      </Field>

      <Field label="Media (optional)">
        {form.mediaPath ? (
          <MediaAttachedPreview
            mediaPath={form.mediaPath}
            mediaUrl={form.mediaUrl}
            mediaKind={form.mediaKind}
            onRemove={() =>
              setForm((f) => ({ ...f, mediaPath: null, mediaUrl: null, mediaKind: null }))
            }
          />
        ) : (
          <MediaPicker
            uploading={uploading}
            urlError={mediaUrlError}
            onUpload={handleMediaUpload}
            onUrlSubmit={(url) => {
              setMediaUrlError(null);
              // We optimistically classify on the client so the admin sees
              // an instant preview, but the server is authoritative -- on
              // save the URL is re-classified and normalized to the
              // canonical embed/direct form. Rejection here just blocks
              // bad input early.
              const classified = classifyMediaUrlClient(url);
              if (!classified) {
                setMediaUrlError(
                  "Paste a Wistia, YouTube, Vimeo, or Loom link, or a direct image/video URL.",
                );
                return;
              }
              setForm((f) => ({
                ...f,
                mediaPath: classified.mediaPath,
                mediaUrl: classified.mediaPath,
                mediaKind: classified.mediaKind,
              }));
            }}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="CTA button label (optional)">
          <input
            type="text"
            value={form.ctaLabel}
            onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
            className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white"
            placeholder="Read more"
            data-testid="input-cta-label"
          />
        </Field>
        <Field label="CTA link (https://...)">
          <input
            type="url"
            value={form.ctaHref}
            onChange={(e) => setForm((f) => ({ ...f, ctaHref: e.target.value }))}
            className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white"
            placeholder="https://room30.ai/..."
            data-testid="input-cta-href"
          />
          <label className="inline-flex items-center gap-2 mt-2 text-[12px] text-white/65 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ctaNewTab}
              onChange={(e) => setForm((f) => ({ ...f, ctaNewTab: e.target.checked }))}
              className="rounded border-white/20"
              data-testid="checkbox-cta-new-tab"
            />
            Open link in a new tab
          </label>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <Field label="Audience">
          <select
            value={form.audience}
            onChange={(e) =>
              setForm((f) => ({ ...f, audience: e.target.value as AnnouncementAudience }))
            }
            className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white"
            data-testid="select-audience"
          >
            <option value="all">All users</option>
            <option value="admins">Admins only</option>
          </select>
        </Field>
        {!isExisting && (
          <Field label="On save">
            <select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as AnnouncementStatus }))
              }
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white"
              data-testid="select-status"
            >
              <option value="draft">Save as draft</option>
              <option value="published">Publish immediately</option>
            </select>
          </Field>
        )}
      </div>
    </div>
  );
}

// Mirrors the bell popover card exactly so admins see what a buyer
// would see before they publish. Kept inline (not imported from the
// bell component) so admin tweaks never accidentally break the user
// surface, but the JSX/colors track the bell one-to-one.
function AnnouncementPreview({
  title,
  bodyHtml,
  mediaUrl,
  mediaKind,
  ctaLabel,
  ctaHref,
  ctaNewTab,
}: {
  title: string;
  bodyHtml: string;
  mediaUrl: string | null;
  mediaKind: AnnouncementMediaKind | null;
  ctaLabel: string;
  ctaHref: string;
  ctaNewTab: boolean;
}) {
  const trimmedTitle = title.trim() || "Untitled announcement";
  const trimmedCtaLabel = ctaLabel.trim();
  const trimmedCtaHref = ctaHref.trim();
  const hasCta = !!trimmedCtaLabel && !!trimmedCtaHref;
  return (
    <div className="mb-6 border border-white/10 rounded-lg p-4 bg-black/40">
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[11px] uppercase tracking-[0.18em] font-bold text-[#C9A44C]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Live preview - what users will see in the popup
        </span>
      </div>
      <div className="max-w-[360px] mx-auto bg-[#0f0f0f] border border-white/10 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <span
            className="text-[12px] uppercase tracking-[0.18em] font-bold text-[#C9A44C]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Announcements
          </span>
          <span className="text-[11px] text-white/40">1 active</span>
        </div>
        <div className="px-4 py-3 text-white">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-[13px] font-semibold text-white leading-snug">
              {trimmedTitle}
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-white/40 shrink-0">
              <X className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </span>
          </div>
          {mediaUrl && (
            <div className="my-2 rounded overflow-hidden border border-white/[0.06]">
              {mediaKind === "image" ? (
                <img
                  src={mediaUrl}
                  alt=""
                  className="max-w-full max-h-40 object-cover"
                />
              ) : (
                <video src={mediaUrl} controls className="max-w-full max-h-40" />
              )}
            </div>
          )}
          {bodyHtml ? (
            <div
              className="prose prose-invert prose-sm max-w-none text-[12px] text-white/75 leading-relaxed [&_a]:text-[#C9A44C]"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <p className="text-[12px] text-white/35 italic">
              Body is empty - users will only see the title.
            </p>
          )}
          {hasCta && (
            <a
              href={trimmedCtaHref}
              target={ctaNewTab ? "_blank" : undefined}
              rel={ctaNewTab ? "noopener noreferrer" : undefined}
              className="inline-block mt-2 px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider bg-[#C9A44C] text-black hover:bg-[#d4b15c]"
              data-testid="preview-cta"
            >
              {trimmedCtaLabel}
            </a>
          )}
          <div className="text-[10px] text-white/35 mt-2">
            {new Date().toLocaleString()}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-white/40 mt-3 text-center">
        Newsfeed view at <code className="text-white/55">/announcements</code> uses the same card, full width.
      </p>
    </div>
  );
}

// Mirror of the server's classifyExternalMediaUrl. Kept in sync by hand
// (small surface, no shared helper to import). The server is still the
// authoritative classifier at save time; this is only used for the
// optimistic in-editor preview.
function classifyMediaUrlClient(
  input: string,
): { mediaPath: string; mediaKind: AnnouncementMediaKind } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname;

  if (host.endsWith("wistia.com") || host.endsWith("wistia.net")) {
    const embed = path.match(/\/embed\/iframe\/([A-Za-z0-9]+)/);
    if (embed) return { mediaPath: `https://fast.wistia.net/embed/iframe/${embed[1]}`, mediaKind: "embed" };
    const medias = path.match(/\/medias\/([A-Za-z0-9]+)/);
    if (medias) return { mediaPath: `https://fast.wistia.net/embed/iframe/${medias[1]}`, mediaKind: "embed" };
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) {
      return { mediaPath: `https://www.youtube.com/embed/${v}`, mediaKind: "embed" };
    }
    const shorts = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
    if (shorts) return { mediaPath: `https://www.youtube.com/embed/${shorts[1]}`, mediaKind: "embed" };
    const embed = path.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
    if (embed) return { mediaPath: `https://www.youtube.com/embed/${embed[1]}`, mediaKind: "embed" };
  }
  if (host === "youtu.be") {
    const id = path.replace(/^\//, "").split("/")[0];
    if (/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      return { mediaPath: `https://www.youtube.com/embed/${id}`, mediaKind: "embed" };
    }
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = path.match(/(?:^|\/)(\d{6,})(?:\/|$)/);
    if (id) return { mediaPath: `https://player.vimeo.com/video/${id[1]}`, mediaKind: "embed" };
  }
  if (host === "loom.com") {
    const m = path.match(/^\/(?:share|embed)\/([A-Za-z0-9]+)/);
    if (m) return { mediaPath: `https://www.loom.com/embed/${m[1]}`, mediaKind: "embed" };
  }
  if (/\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?.*)?$/i.test(path)) {
    return { mediaPath: u.toString(), mediaKind: "image" };
  }
  if (/\.(?:mp4|webm|mov|m4v)(?:\?.*)?$/i.test(path)) {
    return { mediaPath: u.toString(), mediaKind: "video" };
  }
  return null;
}

// Renders the in-editor media preview. Handles uploaded assets
// (server-signed mediaUrl), direct image/video URLs, and provider
// iframe embeds. The actual bell/feed renderers use a shared helper
// (renderAnnouncementMedia) but the admin needs an inline variant with
// the "X to remove" affordance so we keep this component local.
function MediaAttachedPreview({
  mediaPath,
  mediaUrl,
  mediaKind,
  onRemove,
}: {
  mediaPath: string;
  mediaUrl: string | null;
  mediaKind: AnnouncementMediaKind | null;
  onRemove: () => void;
}) {
  const isExternal = /^https?:\/\//i.test(mediaPath);
  const src = isExternal ? mediaPath : mediaUrl;
  return (
    <div className="flex items-start gap-3">
      <div className="border border-white/10 rounded overflow-hidden max-w-xs w-full">
        {!src ? (
          <div className="p-6 text-xs text-white/55">
            Media attached (preview unavailable).
          </div>
        ) : mediaKind === "embed" ? (
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={src}
              title="Announcement media"
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            />
          </div>
        ) : mediaKind === "video" ? (
          <video src={src} controls className="max-w-full max-h-48" />
        ) : (
          <img src={src} alt="Announcement media" className="max-w-full max-h-48 object-cover" />
        )}
      </div>
      <button
        onClick={onRemove}
        className="text-white/60 hover:text-white"
        data-testid="button-remove-media"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function MediaPicker({
  uploading,
  urlError,
  onUpload,
  onUrlSubmit,
}: {
  uploading: boolean;
  urlError: string | null;
  onUpload: (file: File) => void;
  onUrlSubmit: (url: string) => void;
}) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [urlInput, setUrlInput] = useState("");
  return (
    <div>
      <div className="inline-flex rounded border border-white/10 overflow-hidden mb-3">
        <button
          type="button"
          onClick={() => setTab("upload")}
          className={`px-3 py-1.5 text-[12px] ${
            tab === "upload" ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
          }`}
          data-testid="tab-media-upload"
        >
          Upload
        </button>
        <button
          type="button"
          onClick={() => setTab("url")}
          className={`px-3 py-1.5 text-[12px] border-l border-white/10 ${
            tab === "url" ? "bg-white/10 text-white" : "text-white/55 hover:text-white"
          }`}
          data-testid="tab-media-url"
        >
          Paste link
        </button>
      </div>
      {tab === "upload" ? (
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-black/40 text-white/70 cursor-pointer hover:border-white/30">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "Uploading..." : "Upload image or video"}
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
            data-testid="input-media"
          />
        </label>
      ) : (
        <div>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://wistia.com/medias/... , https://youtu.be/... , or direct .mp4/.jpg URL"
              className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-[13px]"
              data-testid="input-media-url"
            />
            <button
              type="button"
              onClick={() => {
                const v = urlInput.trim();
                if (!v) return;
                onUrlSubmit(v);
              }}
              className="px-3 py-2 rounded bg-white/10 text-white text-[12px] hover:bg-white/20"
              data-testid="button-attach-media-url"
            >
              Attach
            </button>
          </div>
          <p className="text-[11px] text-white/40 mt-1">
            Supported: Wistia, YouTube, Vimeo, Loom, or a direct https URL ending in
            .jpg / .png / .gif / .webp / .mp4 / .webm / .mov.
          </p>
          {urlError && (
            <p className="text-[11px] text-red-300 mt-1" data-testid="media-url-error">
              {urlError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[11px] uppercase tracking-wider text-white/55 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
