import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import {
  CheckCircle2,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Clock,
} from "lucide-react";

type LessonStatus = "published" | "coming_soon" | "draft";

type CourseLesson = {
  id: number;
  slug: string;
  title: string;
  brief: string | null;
  sortOrder: number;
  wistiaVideoId: string | null;
  durationMinutes: number | null;
  status: LessonStatus;
  progress: { completed: boolean } | null;
};

type CoursePhase = {
  id: number;
  slug: string;
  title: string;
  lessons: CourseLesson[];
};

function isComingSoon(lesson: CourseLesson) {
  // Driven by status field; fall back to video-presence check for legacy rows.
  if (lesson.status === "coming_soon") return true;
  if (lesson.status === "published") return false;
  return !lesson.wistiaVideoId || lesson.wistiaVideoId.trim() === "";
}

// ── Phase section ──────────────────────────────────────────────────────────────

function PhaseSection({
  phase,
  phaseIndex,
  onLessonClick,
  globalLessonIndex,
}: {
  phase: CoursePhase;
  phaseIndex: number;
  onLessonClick: (slug: string) => void;
  /** Offset so lesson numbers are continuous across phases */
  globalLessonIndex: number;
}) {
  const [open, setOpen] = useState(true);

  const completedCount = phase.lessons.filter(
    (l) => l.progress?.completed,
  ).length;
  const totalCount = phase.lessons.length;

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden">
      {/* Phase header — click to collapse/expand */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-[#111] hover:bg-[#141414] transition-colors text-left group"
        aria-expanded={open}
      >
        {/* Collapse chevron */}
        <span className="shrink-0 text-white/40 group-hover:text-white/60 transition-colors">
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>

        {/* Phase title */}
        <span
          className="flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-white"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          Step {phaseIndex + 1}: {phase.title}
        </span>

        {/* Completion chip */}
        <span
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            completedCount === totalCount && totalCount > 0
              ? "bg-emerald-500/15 text-emerald-300"
              : completedCount > 0
                ? "bg-[#C9A44C]/15 text-[#C9A44C]"
                : "bg-white/[0.06] text-white/45"
          }`}
        >
          {completedCount}/{totalCount}
        </span>
      </button>

      {/* Lesson list */}
      {open && (
        <div className="divide-y divide-white/[0.05]">
          {phase.lessons.map((lesson, i) => {
            const done = !!lesson.progress?.completed;
            const coming = isComingSoon(lesson);
            const lessonNum = globalLessonIndex + i + 1;

            return (
              <LessonRow
                key={lesson.slug}
                lesson={lesson}
                lessonNum={lessonNum}
                done={done}
                coming={coming}
                onClick={() => !coming && onLessonClick(lesson.slug)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Individual lesson row ──────────────────────────────────────────────────────

function LessonRow({
  lesson,
  lessonNum,
  done,
  coming,
  onClick,
}: {
  lesson: CourseLesson;
  lessonNum: number;
  done: boolean;
  coming: boolean;
  onClick: () => void;
}) {
  const Tag = coming ? "div" : "button";

  return (
    <Tag
      onClick={coming ? undefined : onClick}
      className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors ${
        coming
          ? "opacity-60 cursor-default bg-[#0c0c0c]"
          : "cursor-pointer hover:bg-white/[0.025] group"
      }`}
      data-testid={coming ? undefined : `button-lesson-${lesson.slug}`}
    >
      {/* Lesson number / check */}
      <div
        className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-[13px] font-bold ${
          done
            ? "bg-[#C9A44C]/15 text-[#C9A44C]"
            : "bg-white/[0.04] text-white/50"
        }`}
      >
        {done ? <CheckCircle2 size={18} /> : lessonNum}
      </div>

      {/* Title + brief */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[14px] font-semibold leading-snug ${done ? "text-white/70" : "text-white"}`}
          >
            {lesson.title}
          </span>
          {coming && (
            <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-300">
              Coming Soon
            </span>
          )}
        </div>
        {lesson.brief && (
          <p className="text-[12px] text-white/40 mt-0.5 line-clamp-2 leading-relaxed">
            {lesson.brief}
          </p>
        )}
        {lesson.durationMinutes && !coming ? (
          <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-white/30">
            <Clock size={10} /> {lesson.durationMinutes} min
          </span>
        ) : null}
      </div>

      {/* Trailing arrow (available lessons only) */}
      {!coming && (
        <ChevronRight
          size={15}
          className="shrink-0 text-white/25 group-hover:text-white/55 transition-colors"
        />
      )}
    </Tag>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#C9A44C] to-[#e8c56a] transition-all duration-500"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function Masterclass() {
  const [, setLocation] = useLocation();

  const { data: course, isLoading } = useQuery<CoursePhase[]>({
    queryKey: ["course"],
    queryFn: () => api.getCourse(),
  });

  const allLessons = useMemo(
    () =>
      (course || [])
        .flatMap((p) => p.lessons)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [course],
  );

  const availableLessons = allLessons.filter((l) => !isComingSoon(l));
  const completedCount = availableLessons.filter(
    (l) => l.progress?.completed,
  ).length;
  const totalAvailable = availableLessons.length;
  const pct = totalAvailable > 0 ? (completedCount / totalAvailable) * 100 : 0;

  const firstIncomplete =
    availableLessons.find((l) => !l.progress?.completed) ||
    availableLessons[0];

  // Track cumulative lesson index so numbers are continuous across phases
  const phaseLessonOffsets = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const phase of course || []) {
      offsets.push(running);
      running += phase.lessons.length;
    }
    return offsets;
  }, [course]);

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        {/* Header */}
        <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
          Course
        </p>
        <h1
          className="text-[26px] md:text-[34px] font-bold uppercase text-white mb-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          AI Influencer Masterclass
        </h1>
        <p className="text-[14px] text-white/55 mb-5 max-w-[640px]">
          Build a profitable AI influencer business from scratch — no face, no
          complicated tech. Work the lessons in order and do the action steps as
          you go.
        </p>

        {/* Progress bar + CTA */}
        {!isLoading && totalAvailable > 0 && (
          <div className="mb-8 space-y-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-white/50">
                {completedCount} of {totalAvailable} lessons completed
              </span>
              <span className="font-semibold text-[#C9A44C]">
                {Math.round(pct)}%
              </span>
            </div>
            <ProgressBar value={pct} />
            <div className="pt-1">
              <button
                onClick={() =>
                  firstIncomplete &&
                  setLocation(`/lesson/${firstIncomplete.slug}`)
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A44C] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#d8b55e] transition-colors"
                data-testid="button-masterclass-continue"
              >
                <PlayCircle className="w-4 h-4" />
                {completedCount > 0 ? "Pick up where you left off" : "Start the course"}
              </button>
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[52px] rounded-xl bg-white/[0.03] animate-pulse"
              />
            ))}
          </div>
        ) : !course || course.length === 0 ? (
          <p className="text-[14px] text-white/55">No lessons available yet.</p>
        ) : (
          <div className="space-y-3">
            {course.map((phase, phaseIdx) => (
              <PhaseSection
                key={phase.id}
                phase={phase}
                phaseIndex={phaseIdx}
                onLessonClick={(slug) => setLocation(`/lesson/${slug}`)}
                globalLessonIndex={phaseLessonOffsets[phaseIdx] ?? 0}
              />
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
