import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { BookOpen, ChevronDown, ChevronUp, Loader2, Eye, EyeOff, Clock } from "lucide-react";

type LessonStatus = "draft" | "coming_soon" | "published";

type AdminLesson = {
  id: number;
  slug: string;
  title: string;
  status: LessonStatus;
  wistiaVideoId: string | null;
  sortOrder: number;
  phaseId: number;
};

type AdminPhase = {
  id: number;
  slug: string;
  title: string;
  sortOrder: number;
  lessons: AdminLesson[];
};

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  LessonStatus,
  { label: string; chipClass: string; dotClass: string }
> = {
  published: {
    label: "Published",
    chipClass: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
    dotClass: "bg-emerald-400",
  },
  coming_soon: {
    label: "Coming Soon",
    chipClass: "bg-blue-500/15 text-blue-300 border border-blue-400/20",
    dotClass: "bg-blue-400",
  },
  draft: {
    label: "Draft",
    chipClass: "bg-white/[0.06] text-white/45 border border-white/[0.08]",
    dotClass: "bg-white/30",
  },
};

function StatusChip({ status }: { status: LessonStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.1em] ${cfg.chipClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

// ── Three-way toggle ──────────────────────────────────────────────────────────

const STATUSES: LessonStatus[] = ["draft", "coming_soon", "published"];
const STATUS_LABELS: Record<LessonStatus, string> = {
  draft: "Draft",
  coming_soon: "Coming Soon",
  published: "Published",
};

function StatusToggle({
  slug,
  current,
  hasVideo,
  onChange,
  loading,
}: {
  slug: string;
  current: LessonStatus;
  hasVideo: boolean;
  onChange: (slug: string, status: LessonStatus) => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {STATUSES.map((s) => {
        const active = s === current;
        // Can't publish without a video — visually dim the Published button
        const disabled = loading || (s === "published" && !hasVideo);
        return (
          <button
            key={s}
            onClick={() => !disabled && !active && onChange(slug, s)}
            disabled={disabled || active}
            title={
              s === "published" && !hasVideo
                ? "Add a Wistia video first to publish this lesson"
                : STATUS_LABELS[s]
            }
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              active
                ? s === "published"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : s === "coming_soon"
                    ? "bg-blue-500/20 text-blue-300 border border-blue-400/30"
                    : "bg-white/[0.08] text-white/60 border border-white/[0.12]"
                : disabled
                  ? "text-white/20 cursor-not-allowed"
                  : "text-white/40 hover:text-white/65 hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            {loading && active ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              STATUS_LABELS[s]
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Phase section (collapsible) ───────────────────────────────────────────────

function PhaseSection({
  phase,
  phaseIndex,
  onStatusChange,
  updating,
}: {
  phase: AdminPhase;
  phaseIndex: number;
  onStatusChange: (slug: string, status: LessonStatus) => void;
  updating: Set<string>;
}) {
  const [open, setOpen] = useState(true);

  const publishedCount = phase.lessons.filter((l) => l.status === "published").length;
  const draftCount = phase.lessons.filter((l) => l.status === "draft").length;
  const comingCount = phase.lessons.filter((l) => l.status === "coming_soon").length;

  return (
    <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Phase header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-[#111] hover:bg-[#141414] transition-colors text-left group"
        aria-expanded={open}
      >
        <span className="shrink-0 text-white/40 group-hover:text-white/60 transition-colors">
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </span>
        <span
          className="flex-1 text-[12px] font-bold uppercase tracking-[0.12em] text-white"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Step {phaseIndex + 1}: {phase.title}
        </span>
        {/* Summary chips */}
        <div className="flex items-center gap-2 shrink-0">
          {publishedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              {publishedCount} live
            </span>
          )}
          {comingCount > 0 && (
            <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
              {comingCount} soon
            </span>
          )}
          {draftCount > 0 && (
            <span className="text-[10px] font-bold text-white/35 bg-white/[0.05] px-2 py-0.5 rounded-full">
              {draftCount} draft
            </span>
          )}
        </div>
      </button>

      {/* Lesson rows */}
      {open && (
        <div className="divide-y divide-white/[0.04]">
          {phase.lessons.map((lesson) => {
            const hasVideo = !!(lesson.wistiaVideoId && lesson.wistiaVideoId.trim());
            const isUpdating = updating.has(lesson.slug);
            return (
              <div
                key={lesson.slug}
                className="px-5 py-3.5 flex items-center gap-4"
              >
                {/* Video indicator */}
                <div
                  title={hasVideo ? "Has Wistia video" : "No video yet"}
                  className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${
                    hasVideo
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-white/[0.04] text-white/20"
                  }`}
                >
                  {hasVideo ? <Eye size={13} /> : <EyeOff size={13} />}
                </div>

                {/* Title + status chip */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-white/85 truncate">
                      {lesson.title}
                    </span>
                    <StatusChip status={lesson.status} />
                  </div>
                  <p className="text-[11px] text-white/30 font-mono mt-0.5">
                    {lesson.slug}
                  </p>
                </div>

                {/* Status toggle */}
                <StatusToggle
                  slug={lesson.slug}
                  current={lesson.status}
                  hasVideo={hasVideo}
                  onChange={onStatusChange}
                  loading={isUpdating}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminLessons() {
  const queryClient = useQueryClient();

  const { data: phases, isLoading } = useQuery<AdminPhase[]>({
    queryKey: ["admin-lessons"],
    queryFn: () => api.admin.getLessons(),
    refetchOnWindowFocus: false,
  });

  const [updating, setUpdating] = useState<Set<string>>(new Set());

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: LessonStatus }) =>
      api.admin.updateLessonStatus(slug, status),
    onMutate: ({ slug }) => {
      setUpdating((prev) => new Set([...prev, slug]));
    },
    onSuccess: (_, { slug, status }) => {
      // Optimistically update the cached lesson list
      queryClient.setQueryData<AdminPhase[]>(["admin-lessons"], (old) =>
        old?.map((phase) => ({
          ...phase,
          lessons: phase.lessons.map((l) =>
            l.slug === slug ? { ...l, status } : l,
          ),
        })),
      );
      // Also invalidate the member course so changes reflect immediately
      queryClient.invalidateQueries({ queryKey: ["course"] });
    },
    onSettled: (_, __, { slug }) => {
      setUpdating((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    },
  });

  const totalLessons = phases?.reduce((acc, p) => acc + p.lessons.length, 0) ?? 0;
  const publishedTotal = phases?.reduce(
    (acc, p) => acc + p.lessons.filter((l) => l.status === "published").length,
    0,
  ) ?? 0;
  const draftTotal = phases?.reduce(
    (acc, p) => acc + p.lessons.filter((l) => l.status === "draft").length,
    0,
  ) ?? 0;

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <div className="mb-8">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Admin Panel
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight mb-2"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Lesson Visibility
          </h1>
          <p className="text-[13.5px] text-white/50 max-w-[540px] leading-[1.6]">
            Control which lessons members can see. <strong className="text-white/70">Draft</strong> hides a lesson entirely.{" "}
            <strong className="text-white/70">Coming Soon</strong> shows the lesson but blocks playback.{" "}
            <strong className="text-white/70">Published</strong> gives full access (requires a Wistia video).
          </p>
        </div>

        {/* Stats row */}
        {!isLoading && phases && (
          <div className="flex items-center gap-4 mb-6 flex-wrap">
            <div className="flex items-center gap-2 text-[13px]">
              <BookOpen className="w-4 h-4 text-[#C9A44C]" />
              <span className="text-white/55">
                <span className="text-white font-semibold">{publishedTotal}</span> of{" "}
                <span className="text-white font-semibold">{totalLessons}</span> lessons live
              </span>
            </div>
            {draftTotal > 0 && (
              <span className="text-[12px] text-white/35 bg-white/[0.05] px-3 py-1 rounded-full">
                {draftTotal} hidden from members
              </span>
            )}
          </div>
        )}

        {/* Phase sections */}
        {isLoading ? (
          <div className="flex items-center gap-3 py-16 text-white/40 text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading lessons…
          </div>
        ) : !phases || phases.length === 0 ? (
          <p className="text-[14px] text-white/45 py-12">No lessons found.</p>
        ) : (
          <div className="space-y-3">
            {phases.map((phase, idx) => (
              <PhaseSection
                key={phase.id}
                phase={phase}
                phaseIndex={idx}
                onStatusChange={(slug, status) => updateStatus({ slug, status })}
                updating={updating}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        {!isLoading && phases && phases.length > 0 && (
          <div className="mt-8 p-4 rounded-xl border border-white/[0.05] bg-white/[0.02]">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 mb-3">
              Status legend
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["draft", "coming_soon", "published"] as LessonStatus[]).map((s) => {
                const cfg = STATUS_CONFIG[s];
                return (
                  <div key={s} className="flex items-start gap-2.5">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] shrink-0 ${cfg.chipClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
                      {cfg.label}
                    </span>
                    <span className="text-[11px] text-white/40 leading-[1.5]">
                      {s === "draft"
                        ? "Hidden from all members. Only admins can see this lesson."
                        : s === "coming_soon"
                          ? "Visible in the course list with a Coming Soon badge. No video plays."
                          : "Fully visible with video. Requires a Wistia ID to be set."}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
