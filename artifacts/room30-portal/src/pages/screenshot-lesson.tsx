import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Play, CheckCircle2, ChevronDown, Lock } from "lucide-react";

const API_BASE = "/api/portal";

type Lesson = {
  id: number;
  phaseId: number;
  title: string;
  slug: string;
  brief: string | null;
  wistiaVideoId: string | null;
  sortOrder: number;
};

type Phase = {
  id: number;
  title: string;
  sortOrder: number;
  lessons: (Lesson & { completed: boolean; locked: boolean })[];
};

export default function ScreenshotLesson() {
  const [, params] = useRoute("/screenshot/lesson/:slug");
  const slug = params?.slug || "";
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [phases, setPhases] = useState<Phase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !token) {
      setError("Missing slug or token");
      return;
    }
    let cancelled = false;
    const headers = { "X-Portal-Key": "room30" };
    Promise.all([
      fetch(`${API_BASE}/screenshot/lessons/${slug}?token=${encodeURIComponent(token)}`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/screenshot/course?token=${encodeURIComponent(token)}`, { headers }).then(r => r.json()),
    ]).then(([lessonRes, courseRes]) => {
      if (cancelled) return;
      if (lessonRes?.error) {
        setError(lessonRes.error);
        return;
      }
      setLesson(lessonRes.lesson);
      setPhases(courseRes);
    }).catch(e => setError(String(e)));
    return () => { cancelled = true; };
  }, [slug, token]);

  if (error) {
    return <div className="min-h-screen bg-[#050505] text-red-400 flex items-center justify-center p-8">{error}</div>;
  }
  if (!lesson || !phases) {
    return <div className="min-h-screen bg-[#050505]" />;
  }

  const activePhase = phases.find(p => p.lessons.some(l => l.slug === slug));
  const wistiaPoster = lesson.wistiaVideoId
    ? `https://embed-ssl.wistia.com/deliveries/${lesson.wistiaVideoId}.jpg`
    : null;

  return (
    <div className="min-h-screen bg-[#050505] text-white flex" style={{ fontFamily: "var(--app-font-body, system-ui)" }}>
      {/* Sidebar */}
      <aside className="w-[300px] shrink-0 border-r border-white/[0.06] bg-[#070707] flex flex-col">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold tracking-[0.18em] uppercase" style={{ background: "linear-gradient(135deg,#C9A44C,#F4E0A0,#B8902F)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Prompt &amp; Build
            </span>
          </div>
          <p className="text-[10px] text-white/35 uppercase tracking-[0.2em] mt-1">Masterclass</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {phases.map((phase, pi) => {
            const isActive = activePhase?.id === phase.id;
            return (
              <div key={phase.id}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-md ${isActive ? "bg-white/[0.04]" : ""}`}>
                  <span className="text-[10px] font-bold tracking-widest uppercase text-white/40 w-6">P{pi}</span>
                  <span className={`text-[12px] font-bold uppercase tracking-wide flex-1 ${isActive ? "text-white" : "text-white/65"}`}>
                    {phase.title}
                  </span>
                  <ChevronDown className={`w-3 h-3 ${isActive ? "text-[#C9A44C]" : "text-white/30"}`} />
                </div>
                {isActive && (
                  <div className="ml-6 mt-1 space-y-0.5">
                    {phase.lessons.map((l) => {
                      const current = l.slug === slug;
                      return (
                        <div
                          key={l.id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11.5px] leading-tight ${
                            current ? "bg-[#C9A44C]/10 text-white" : "text-white/55"
                          }`}
                        >
                          {current ? (
                            <span className="w-3 h-3 rounded-full border border-[#C9A44C] bg-[#C9A44C]/30 shrink-0" />
                          ) : (
                            <span className="w-3 h-3 rounded-full border border-white/20 shrink-0" />
                          )}
                          <span className="truncate">{l.title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        <div className="max-w-[920px] mx-auto px-8 py-10">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] uppercase mb-4">
            <span style={{ background: "linear-gradient(135deg,#C9A44C,#F4E0A0,#B8902F)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {activePhase?.title || "Lesson"}
            </span>
            <span className="text-white/25">/</span>
            <span className="text-white/45">Lesson {String(lesson.sortOrder + 1).padStart(2, "0")}</span>
          </div>

          <h1
            className="text-[34px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-7"
            style={{ fontFamily: "var(--app-font-display, system-ui)" }}
          >
            {lesson.title}
          </h1>

          {/* Video panel */}
          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden mb-6 shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
            <div className="aspect-video relative bg-[#111] flex items-center justify-center">
              <img
                src={wistiaPoster || `${import.meta.env.BASE_URL}greg-video-poster.jpg`}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-95"
                onError={(e) => {
                  const fallback = `${import.meta.env.BASE_URL}greg-video-poster.jpg`;
                  if (e.currentTarget.src.indexOf("greg-video-poster") === -1) {
                    e.currentTarget.src = fallback;
                  } else {
                    e.currentTarget.style.display = "none";
                  }
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/15 to-black/55" />
              <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#C9A44C,#B8902F)", boxShadow: "0 10px 30px rgba(201,164,76,0.45)" }}>
                <Play className="w-8 h-8 text-black ml-1" fill="currentColor" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden mb-8">
            <div className="flex border-b border-white/[0.06]">
              {["Brief", "Resources", "Action Tasks", "Notes"].map((t, i) => (
                <button
                  key={t}
                  className={`px-5 py-3.5 text-[12px] font-bold uppercase tracking-wider relative ${i === 0 ? "text-white" : "text-white/45"}`}
                >
                  {t}
                  {i === 0 && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#C9A44C]" />}
                </button>
              ))}
            </div>
            <div className="p-7">
              <h4 className="text-[11px] text-white/40 font-bold uppercase tracking-[0.2em] mb-3">Lesson Brief</h4>
              <div
                className="text-[14.5px] leading-[1.7] text-white/75 prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: lesson.brief || "<p>No brief yet.</p>" }}
              />
            </div>
          </div>

          {/* Mark complete bar */}
          <div className="flex items-center justify-between bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-[#C9A44C]/15 border border-[#C9A44C]/40 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-[#C9A44C]" />
              </span>
              <div>
                <p className="text-[13px] text-white font-bold">Mark this lesson complete</p>
                <p className="text-[11px] text-white/45">Track your progress through the masterclass.</p>
              </div>
            </div>
            <button
              className="px-5 py-2.5 rounded-lg text-[12px] font-bold uppercase tracking-wider text-black"
              style={{ background: "linear-gradient(135deg,#C9A44C,#F4E0A0,#B8902F)" }}
            >
              Complete &amp; Continue
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
