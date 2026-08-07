import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { api } from "@/lib/api";
import { CheckCircle2, PlayCircle, ChevronRight } from "lucide-react";

type CourseLesson = {
  id: number;
  slug: string;
  title: string;
  sortOrder: number;
  wistiaVideoId: string | null;
  progress: { completed: boolean } | null;
};

type CoursePhase = {
  id: number;
  slug: string;
  title: string;
  lessons: CourseLesson[];
};

// Masterclass overview: lists every lesson of the main course in order with
// completion state. Linked from the sidebar ("Masterclass") and the
// dashboard "continue" card; each row opens /lesson/:slug.
export function Masterclass() {
  const [, setLocation] = useLocation();

  const { data: course, isLoading } = useQuery<CoursePhase[]>({
    queryKey: ["course"],
    queryFn: () => api.getCourse(),
  });

  const lessons: CourseLesson[] = (course || [])
    .flatMap((p) => p.lessons)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const completedCount = lessons.filter((l) => l.progress?.completed).length;
  const firstIncomplete = lessons.find((l) => !l.progress?.completed) || lessons[0];

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
          Course
        </p>
        <h1
          className="text-[26px] md:text-[34px] font-bold uppercase text-white mb-2"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          AI Influencer Masterclass
        </h1>
        <p className="text-[14px] text-white/55 mb-6 max-w-[640px]">
          Build a profitable AI influencer business from scratch — no face, no
          complicated tech. Work the lessons in order and do the action steps as
          you go.
        </p>

        {lessons.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 mb-8">
            <button
              onClick={() => firstIncomplete && setLocation(`/lesson/${firstIncomplete.slug}`)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A44C] text-black text-[12px] font-bold uppercase tracking-wider hover:bg-[#d8b55e] transition-colors"
              data-testid="button-masterclass-continue"
            >
              <PlayCircle className="w-4 h-4" />
              {completedCount > 0 ? "Continue" : "Start the course"}
            </button>
            <span className="text-[12px] text-white/55">
              {completedCount} of {lessons.length} lessons completed
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : lessons.length === 0 ? (
          <p className="text-[14px] text-white/55">No lessons available yet.</p>
        ) : (
          <div className="space-y-3">
            {lessons.map((lesson, idx) => {
              const done = !!lesson.progress?.completed;
              return (
                <button
                  key={lesson.slug}
                  onClick={() => setLocation(`/lesson/${lesson.slug}`)}
                  className="w-full bg-[#0f0f0f] border border-white/[0.06] rounded-xl px-5 py-4 flex items-center gap-4 text-left hover:bg-white/[0.02] hover:border-white/[0.12] transition-colors group"
                  data-testid={`button-lesson-${lesson.slug}`}
                >
                  <div
                    className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-[14px] font-bold ${
                      done ? "bg-[#C9A44C]/15 text-[#C9A44C]" : "bg-white/[0.05] text-white/60"
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-5 h-5" /> : idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-white truncate">
                      {lesson.title}
                    </p>
                    <p className="text-[12px] text-white/45 mt-0.5">
                      {done ? "Completed" : "Lesson " + (idx + 1)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white/60 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
