import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  BookOpen,
  Search,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  HOOK_LIBRARY,
  HOOK_CATEGORY_LABELS,
  TOTAL_HOOK_COUNT,
  type HookCategory,
} from "@/content/hook-library";

// Display order for the categories. Educational and Curiosity sit up front
// because those are the two the buyer is told about on the sales page; Alex
// Hormozi is flagged as the bonus row. Everything else follows in a sensible
// order.
const CATEGORY_ORDER: HookCategory[] = [
  "educational",
  "curiosity",
  "hormozi",
  "hundredFormulas",
  "storytelling",
  "question",
  "listBased",
  "problemSolving",
  "tipsTricks",
  "relatable",
];

const BONUS_CATEGORIES: ReadonlySet<HookCategory> = new Set(["hormozi"]);

// Page for the $27 "2,000 Hook Prompt Library" upgrade (sold as bump2 on the
// front-end checkout). Locked (un-entitled) users are bounced to /dashboard;
// admins always have access. Renders a vertical accordion of every hook
// bucket - one section open at a time, with a per-section search filter and
// per-hook copy-to-clipboard. The vertical layout makes all 10 categories
// visible at a glance instead of hiding most of them off-screen behind a
// scrollable tab strip.
export default function HookDemoLibrary() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const paid = !!(me?.user as any)?.bump2Paid;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = paid || isAdmin;

  useEffect(() => {
    if (!meLoading && !hasAccess) setLocation("/dashboard");
  }, [meLoading, hasAccess, setLocation]);

  // Single-open accordion. The first category is open by default so the
  // page never lands as a totally collapsed wall of headers.
  const [openCategory, setOpenCategory] = useState<HookCategory | null>(
    "educational",
  );
  // Search query is scoped per category so opening a different section does
  // not carry an unrelated query across.
  const [queries, setQueries] = useState<Partial<Record<HookCategory, string>>>(
    {},
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyHook = async (hook: string, key: string) => {
    try {
      await navigator.clipboard.writeText(hook);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      // Clipboard write can fail in iframes or older browsers - silently
      // ignore so the click still feels responsive.
    }
  };

  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-7">
          <p className="text-[11px] text-[#C9A44C] font-bold uppercase tracking-[0.22em] mb-3">
            Premium Add-On
          </p>
          <h1
            className="text-[30px] md:text-[40px] font-bold uppercase tracking-[0.01em] text-white leading-[1.05] mb-3"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Hook Prompt Library
          </h1>
          <p className="text-[14.5px] text-white/55 leading-[1.65] max-w-[760px]">
            Every proven hook formula my team and I use to open videos,
            slideshows and carousels - {TOTAL_HOOK_COUNT.toLocaleString()}{" "}
            openers across {Object.keys(HOOK_LIBRARY).length} categories.
            Click a category to expand it, scan the list, copy the opener you
            like and drop it into your AI influencer prompt.
          </p>
        </div>

        {meLoading || !hasAccess ? (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {CATEGORY_ORDER.map((cat) => {
              const open = cat === openCategory;
              const total = (HOOK_LIBRARY[cat] as readonly string[]).length;
              const isBonus = BONUS_CATEGORIES.has(cat);
              const query = queries[cat] ?? "";
              const all = HOOK_LIBRARY[cat] as readonly string[];
              const q = query.trim().toLowerCase();
              const filtered = q
                ? all.filter((h) => h.toLowerCase().includes(q))
                : all.slice();
              const panelId = `hook-panel-${cat}`;
              const headerId = `hook-header-${cat}`;

              return (
                <section
                  key={cat}
                  className={[
                    "bg-[#0f0f0f] border rounded-2xl overflow-hidden transition-colors",
                    open
                      ? "border-[#C9A44C]/40"
                      : "border-white/[0.06] hover:border-white/[0.12]",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenCategory(open ? null : cat)}
                    className={[
                      "w-full flex items-center gap-3 px-5 py-4 text-left transition-colors",
                      open ? "bg-white/[0.03]" : "hover:bg-white/[0.02]",
                    ].join(" ")}
                  >
                    {isBonus ? (
                      <Sparkles className="w-4 h-4 text-[#C9A44C] shrink-0" />
                    ) : (
                      <BookOpen
                        className={[
                          "w-4 h-4 shrink-0",
                          open ? "text-[#C9A44C]" : "text-white/45",
                        ].join(" ")}
                      />
                    )}
                    <h2 className="text-[13px] md:text-[13.5px] font-bold uppercase tracking-[0.16em] text-white truncate flex-1">
                      {HOOK_CATEGORY_LABELS[cat]}
                    </h2>
                    {isBonus ? (
                      <span className="hidden sm:inline-flex items-center text-[9.5px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-full bg-[#C9A44C]/15 text-[#C9A44C] border border-[#C9A44C]/30">
                        Bonus
                      </span>
                    ) : null}
                    <span
                      className={[
                        "text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full shrink-0",
                        open
                          ? "bg-[#C9A44C]/20 text-[#C9A44C]"
                          : "bg-white/[0.06] text-white/55",
                      ].join(" ")}
                    >
                      {total.toLocaleString()}
                    </span>
                    <ChevronDown
                      className={[
                        "w-4 h-4 shrink-0 transition-transform",
                        open ? "rotate-180 text-[#C9A44C]" : "text-white/40",
                      ].join(" ")}
                    />
                  </button>

                  {open ? (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={headerId}
                      className="border-t border-white/[0.05]"
                    >
                      <div className="relative px-4 pt-4">
                        <Search className="w-4 h-4 text-white/35 absolute left-7 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={query}
                          onChange={(e) =>
                            setQueries((prev) => ({
                              ...prev,
                              [cat]: e.target.value,
                            }))
                          }
                          placeholder={`Search ${HOOK_CATEGORY_LABELS[cat]} hooks...`}
                          className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-xl pl-10 pr-3 py-2.5 text-[13.5px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A44C]/60"
                        />
                      </div>

                      <div className="px-5 pt-3 pb-1 flex items-center justify-between gap-3">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/40">
                          {q ? "Matches" : "All hooks"}
                        </span>
                        <span className="text-[11.5px] text-white/45 tabular-nums">
                          {filtered.length.toLocaleString()} of{" "}
                          {total.toLocaleString()}
                        </span>
                      </div>

                      {filtered.length === 0 ? (
                        <div className="px-5 py-10 text-center text-white/45 text-[13px]">
                          No hooks match &ldquo;{query}&rdquo; in this category.
                        </div>
                      ) : (
                        <ol className="divide-y divide-white/[0.04]">
                          {filtered.map((hook, idx) => {
                            const key = `${cat}-${idx}-${hook.slice(0, 20)}`;
                            const copied = copiedKey === key;
                            return (
                              <li
                                key={key}
                                className="group flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02]"
                              >
                                <span className="text-[11.5px] text-white/35 tabular-nums w-10 shrink-0 pt-0.5">
                                  {(idx + 1).toString().padStart(3, "0")}
                                </span>
                                <p className="text-[13.5px] text-white/85 leading-[1.55] flex-1 break-words whitespace-pre-wrap">
                                  {hook}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => copyHook(hook, key)}
                                  aria-label={copied ? "Copied" : "Copy hook"}
                                  className={[
                                    "shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1.5 rounded-md border transition-colors",
                                    copied
                                      ? "bg-[#C9A44C]/15 text-[#C9A44C] border-[#C9A44C]/40"
                                      : "bg-white/[0.03] text-white/55 border-white/[0.08] hover:bg-white/[0.07] hover:text-white",
                                  ].join(" ")}
                                >
                                  {copied ? (
                                    <Check className="w-3 h-3" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span>{copied ? "Copied" : "Copy"}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
