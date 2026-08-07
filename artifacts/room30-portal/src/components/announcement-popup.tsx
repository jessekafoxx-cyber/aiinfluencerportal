import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchApi, getAuthHeaders } from "@/lib/api";
import { EmbedWithFallback } from "@/components/embed-with-fallback";

// Auto-popup variant of the announcements UX.
//
// Reuses the same /announcements/archive query the bell uses (and the
// same /announcements/:id/dismiss endpoint) so a dismiss from either
// surface immediately mutes the other. Behavior:
//   - On portal load, the most-recent undismissed announcement is shown
//     as a centered preview modal.
//   - Hitting the X (or the backdrop) writes the dismiss to the server.
//     The popup will not reappear for that announcement on any device.
//   - When a fresh announcement is published, it pops the next time the
//     portal is opened (or within the 60s archive poll interval).
// The bell stays mounted as a discreet archive entry-point for past
// announcements.

type AnnouncementAudience = "all" | "admins";
type AnnouncementMediaKind = "image" | "video" | "embed";

type ArchiveAnnouncement = {
  id: number;
  title: string;
  bodyHtml: string;
  mediaUrl: string | null;
  mediaKind: AnnouncementMediaKind | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  ctaNewTab: boolean;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  createdAt: string;
  dismissed: boolean;
  dismissedAt: string | null;
};

const ARCHIVE_QUERY_KEY = ["portal-announcements-archive"] as const;

export function AnnouncementPopup() {
  const queryClient = useQueryClient();
  // Per-session suppression: if the user dismisses (or X-es) the popup,
  // don't re-pop it on every route change in the same tab even before
  // the server round-trip lands. The server dismiss is the durable
  // truth across sessions; this is just to keep the UX snappy.
  const [suppressedIds, setSuppressedIds] = useState<Set<number>>(new Set());

  const { data } = useQuery<{ announcements: ArchiveAnnouncement[] }>({
    queryKey: ARCHIVE_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchApi<{ announcements: ArchiveAnnouncement[] }>(
          "/announcements/archive",
        );
      } catch {
        return { announcements: [] };
      }
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const all = data?.announcements ?? [];
  // Pick the most-recent undismissed announcement that the user hasn't
  // hidden in this session. The archive endpoint already filters by
  // audience, so anything we see here is fair game to show.
  const candidates = all
    .filter((a) => !a.dismissed && !suppressedIds.has(a.id))
    .sort((a, b) => {
      const at = new Date(a.publishedAt ?? a.createdAt).getTime();
      const bt = new Date(b.publishedAt ?? b.createdAt).getTime();
      return bt - at;
    });
  const current = candidates[0];

  const dismissMutation = useMutation({
    mutationFn: async (id: number) => {
      const auth = await getAuthHeaders();
      const res = await fetch(`/api/portal/announcements/${id}/dismiss`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Portal-Key": "room30", ...auth },
      });
      if (!res.ok) throw new Error(`dismiss_failed_${res.status}`);
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ARCHIVE_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        announcements: ArchiveAnnouncement[];
      }>(ARCHIVE_QUERY_KEY);
      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData<{ announcements: ArchiveAnnouncement[] }>(
          ARCHIVE_QUERY_KEY,
          {
            announcements: previous.announcements.map((a) =>
              a.id === id ? { ...a, dismissed: true, dismissedAt: now } : a,
            ),
          },
        );
      }
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(ARCHIVE_QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ARCHIVE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["portal-announcements"] });
    },
  });

  // Lock body scroll while the popup is up so the underlying portal
  // doesn't scroll behind the modal.
  useEffect(() => {
    if (!current) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [current?.id]);

  // Task #719 - Record one impression the first time this announcement
  // actually renders for this user. Server is idempotent via unique
  // index on (announcement_id, portal_user_id) so the fire-and-forget
  // POST is safe to repeat across remounts.
  useEffect(() => {
    if (!current) return;
    const id = current.id;
    (async () => {
      try {
        const auth = await getAuthHeaders();
        await fetch(`/api/portal/announcements/${id}/seen`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Portal-Key": "room30", ...auth },
        });
      } catch {
        // Impression tracking is best-effort; never block the UI.
      }
    })();
  }, [current?.id]);

  // ESC key dismisses (same as clicking X).
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSuppressedIds((prev) => new Set(prev).add(current.id));
        dismissMutation.mutate(current.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current?.id]);

  if (!current) return null;

  const close = () => {
    setSuppressedIds((prev) => new Set(prev).add(current.id));
    dismissMutation.mutate(current.id);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-popup-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      data-testid="announcement-popup"
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl bg-[#0f0f0f] border border-[#C9A44C]/30 shadow-[0_20px_80px_-10px_rgba(201,164,76,0.25)]"
        data-testid={`announcement-popup-card-${current.id}`}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss announcement"
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/60 text-white/70 hover:text-white hover:bg-black/80 transition-colors"
          data-testid={`button-popup-dismiss-${current.id}`}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-white/[0.06]">
          <div
            className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#C9A44C] mb-2"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Announcement
          </div>
          <h2
            id="announcement-popup-title"
            className="text-2xl sm:text-3xl font-bold text-white leading-tight pr-10"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {current.title}
          </h2>
        </div>

        <div className="overflow-y-auto px-6 sm:px-8 py-5 space-y-5">
          {current.mediaUrl && (
            <div className="rounded-lg overflow-hidden border border-white/[0.06] bg-black">
              {current.mediaKind === "embed" ? (
                <EmbedWithFallback key={current.mediaUrl} src={current.mediaUrl} title={current.title} />
              ) : current.mediaKind === "video" ? (
                <video
                  src={current.mediaUrl}
                  controls
                  className="w-full max-h-[60vh] bg-black"
                />
              ) : (
                <img
                  src={current.mediaUrl}
                  alt={current.title}
                  className="w-full max-h-[60vh] object-contain bg-black"
                />
              )}
            </div>
          )}

          <div
            className="prose prose-invert prose-sm sm:prose-base max-w-none text-white/85 leading-relaxed [&_a]:text-[#C9A44C] [&_a:hover]:underline"
            // bodyHtml is sanitized server-side (see
            // artifacts/api-server/src/routes/announcements.ts:sanitizeAnnouncementHtml)
            // before it ever reaches the client.
            dangerouslySetInnerHTML={{ __html: current.bodyHtml }}
          />
        </div>

        <div className="px-6 sm:px-8 py-4 border-t border-white/[0.06] flex items-center justify-between gap-3 bg-black/30">
          <button
            type="button"
            onClick={close}
            className="text-[12px] uppercase tracking-wide font-medium text-white/55 hover:text-white transition-colors"
            data-testid={`button-popup-later-${current.id}`}
          >
            Dismiss
          </button>
          {current.ctaLabel && current.ctaHref && (
            <a
              href={current.ctaHref}
              target={current.ctaNewTab ? "_blank" : undefined}
              rel={current.ctaNewTab ? "noopener noreferrer" : undefined}
              onClick={close}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-[#C9A44C] text-black text-[13px] font-bold uppercase tracking-wide hover:bg-[#d4b15a] transition-colors"
              data-testid={`button-popup-cta-${current.id}`}
            >
              {current.ctaLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
