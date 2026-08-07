import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronLeft, X, Megaphone, RotateCcw } from "lucide-react";
import { PortalLayout } from "@/components/portal-layout";
import { fetchApi, getAuthHeaders } from "@/lib/api";
import { EmbedWithFallback } from "@/components/embed-with-fallback";

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

const GOLD = "#C9A44C";

export default function AnnouncementsFeed() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ announcements: ArchiveAnnouncement[] }>({
    queryKey: ["portal-announcements-archive"],
    queryFn: async () => {
      try {
        return await fetchApi<{ announcements: ArchiveAnnouncement[] }>(
          "/announcements/archive",
        );
      } catch {
        return { announcements: [] };
      }
    },
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-announcements-archive"] });
      queryClient.invalidateQueries({ queryKey: ["portal-announcements"] });
    },
  });

  const items = data?.announcements ?? [];
  const activeCount = items.filter((a) => !a.dismissed).length;

  // Task #719 - Record one impression the first time the user lands on
  // the archive page for each announcement currently visible to them.
  // Server is idempotent via unique (announcement_id, portal_user_id)
  // so retries / refetches don't inflate the count; the ref just keeps
  // us from re-POSTing within the same tab session.
  const sentImpressionsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const fresh = items
      .map((a) => a.id)
      .filter((id) => !sentImpressionsRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => sentImpressionsRef.current.add(id));
    (async () => {
      try {
        const auth = await getAuthHeaders();
        await Promise.all(
          fresh.map((id) =>
            fetch(`/api/portal/announcements/${id}/seen`, {
              method: "POST",
              credentials: "include",
              headers: { "X-Portal-Key": "room30", ...auth },
            }).catch(() => {}),
          ),
        );
      } catch {
        // Best-effort; never block the UI.
      }
    })();
  }, [items]);

  return (
    <PortalLayout>
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <button
            onClick={() => setLocation("/dashboard")}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6"
            data-testid="button-back"
          >
            <ChevronLeft className="w-4 h-4" /> Back to dashboard
          </button>

          <div className="flex items-end justify-between mb-8">
            <div>
              <h1
                className="text-3xl font-bold tracking-tight flex items-center gap-3"
                style={{ fontFamily: "var(--app-font-display)" }}
              >
                <Megaphone className="w-7 h-7" style={{ color: GOLD }} />
                Announcements
              </h1>
              <p className="text-sm text-white/55 mt-1">
                Everything we have shipped, in one place. {activeCount} active.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="text-white/50 text-sm py-12 text-center">Loading...</div>
          ) : items.length === 0 ? (
            <div className="border border-white/10 rounded-lg p-10 text-center">
              <Megaphone className="w-8 h-8 mx-auto mb-3 text-white/30" />
              <p className="text-white/55 text-sm">
                No announcements yet. Check back soon.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((a) => (
                <li
                  key={a.id}
                  className={`border rounded-lg p-5 transition-colors ${
                    a.dismissed
                      ? "border-white/[0.06] bg-white/[0.01] opacity-70"
                      : "border-white/10 bg-[#0e0e0e]"
                  }`}
                  data-testid={`feed-announcement-${a.id}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-lg font-semibold text-white leading-snug">
                          {a.title}
                        </h2>
                        {!a.dismissed && (
                          <span
                            className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                            style={{ background: GOLD, color: "black" }}
                          >
                            New
                          </span>
                        )}
                        {a.dismissed && (
                          <span className="text-[10px] uppercase tracking-wider text-white/35 px-1.5 py-0.5 rounded border border-white/10">
                            Read
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {a.publishedAt
                          ? new Date(a.publishedAt).toLocaleString()
                          : new Date(a.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {!a.dismissed && (
                      <button
                        type="button"
                        onClick={() => dismissMutation.mutate(a.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-white/40 hover:text-white shrink-0"
                        title="Mark as read"
                        data-testid={`button-feed-dismiss-${a.id}`}
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Mark read</span>
                      </button>
                    )}
                  </div>

                  {a.mediaUrl && (
                    <div className="my-3 rounded overflow-hidden border border-white/[0.06]">
                      {a.mediaKind === "embed" ? (
                        <EmbedWithFallback key={a.mediaUrl} src={a.mediaUrl} title={a.title} />
                      ) : a.mediaKind === "video" ? (
                        <video
                          src={a.mediaUrl}
                          controls
                          className="max-w-full max-h-80"
                        />
                      ) : (
                        <img
                          src={a.mediaUrl}
                          alt=""
                          className="max-w-full max-h-80 object-cover"
                        />
                      )}
                    </div>
                  )}

                  {a.bodyHtml && (
                    <div
                      className="prose prose-invert prose-sm max-w-none text-[13px] text-white/80 leading-relaxed [&_a]:text-[#C9A44C]"
                      dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                    />
                  )}

                  {a.ctaLabel && a.ctaHref && (
                    <a
                      href={a.ctaHref}
                      target={a.ctaNewTab ? "_blank" : undefined}
                      rel={a.ctaNewTab ? "noopener noreferrer" : undefined}
                      className="inline-block mt-3 px-4 py-2 rounded text-[12px] font-bold uppercase tracking-wider bg-[#C9A44C] text-black hover:bg-[#d4b15c]"
                      data-testid={`feed-cta-${a.id}`}
                    >
                      {a.ctaLabel}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {dismissMutation.isError && (
            <div className="mt-4 text-[12px] text-red-300/80 inline-flex items-center gap-2">
              <RotateCcw className="w-3.5 h-3.5" /> Could not mark as read. Try again.
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
